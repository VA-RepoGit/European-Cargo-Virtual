import express from "express";
import crypto from "crypto";
import { EmbedBuilder } from "discord.js";
import { getAircraftStatus, updateAircraftStatus } from './utils/supabase.js';
import { setAircraftVisibility } from './utils/vamsys.js';
import { updateGSheet } from './utils/gsheet.js'; // AJOUT : Importation de l'utilitaire Google Sheet

const router = express.Router();

router.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const routes = [
  { path: "/vamsys/webhook1", channel: process.env.VAMSYS_WEBHOOK1_CHANNEL, secret: process.env.VAMSYS_WEBHOOK1_SECRET, type: "pirep" },
  { path: "/vamsys/webhook2", channel: process.env.VAMSYS_WEBHOOK2_CHANNEL, secret: process.env.VAMSYS_WEBHOOK2_SECRET, type: "pilot" },
];

const THRESHOLDS = { D: 20000, C: 4000, B: 1000, A: 500 };
const MAINT_DURATIONS = { A: 12, B: 48, C: 336, D: 720 }; 

function safe(value, fallback = "N/A") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function getPirepStatus(status) {
  const s = (status || "").toLowerCase();
  if (s === "accepted") return { label: "Accepted", color: "#2ecc71" };
  if (s === "pending" || s === "failed" || s.includes("await")) return { label: "Awaiting Review", color: "#f39c12" };
  if (s === "rejected") return { label: "Rejected", color: "#e74c3c" };
  return { label: "Unknown", color: "#95a5a6" };
}

routes.forEach((route) => {
  router.post(route.path, async (req, res) => {
    try {
      const signature = req.headers["x-vamsys-signature"];
      const raw = req.rawBody;
      if (!signature || !raw) return res.status(401).json({ error: "Missing signature" });

      const expected = crypto.createHmac("sha256", route.secret).update(raw).digest("hex");
      if (signature !== expected) return res.status(401).json({ error: "Invalid signature" });

      res.status(200).json({ received: true });

      const payload = req.body;
      if (!payload.event || !payload.event.startsWith(route.type)) return;

      const channel = router.client?.channels.cache.get(route.channel);
      if (!channel) return;

      if (route.type === "pirep") {
        const pirep = payload.data?.pirep ?? payload.data;
        if (!pirep) return;

        const aircraftReg = safe(pirep.aircraft?.registration, "UNKNOWN");
        const aircraftName = safe(pirep.aircraft?.name, "N/A");
        const pirepId = safe(pirep.id);
        const flightHours = (pirep.flight_length || 0) / 60;
        const landingRate = pirep.landing_rate || 0;
        const arrivalIcao = safe(pirep.arrival_airport?.icao, "----");
        const departureIcao = safe(pirep.departure_airport?.icao, "----");
        const callsign = safe(pirep.callsign, "N/A");

        const currentStatus = await getAircraftStatus(aircraftReg);
        const isAlreadyProcessed = currentStatus.last_pirep_id && String(currentStatus.last_pirep_id) === String(pirepId);
        
        let newTotalHours = currentStatus.total_flight_hours;
        if (!isAlreadyProcessed) {
            newTotalHours += flightHours;
        }

        let maintenanceAlerts = [];
        let updatedStatus = { 
            ...currentStatus, 
            registration: aircraftReg,
            total_flight_hours: newTotalHours,
            last_pirep_id: pirepId 
        };

        let maintenanceType = null;
        let maintenanceEnd = null;
        const isAtRPLL = arrivalIcao === "RPLL";

        if (landingRate <= -600) {
            maintenanceAlerts.push("🚨 **AOG - HARD LANDING DETECTED**");
            updatedStatus.is_aog = true;
        }

        if (Math.floor(newTotalHours / THRESHOLDS.D) > Math.floor(currentStatus.last_check_d / THRESHOLDS.D)) {
            if (isAtRPLL) {
                maintenanceType = "D";
                maintenanceEnd = new Date(Date.now() + MAINT_DURATIONS.D * 3600000);
            } else { maintenanceAlerts.push("🚨 **FERRY FLIGHT REQUIRED**: Check D overdue."); }
        } 
        else if (Math.floor(newTotalHours / THRESHOLDS.C) > Math.floor(currentStatus.last_check_c / THRESHOLDS.C)) {
            if (isAtRPLL) {
                maintenanceType = "C";
                maintenanceEnd = new Date(Date.now() + MAINT_DURATIONS.C * 3600000);
            } else { maintenanceAlerts.push("🛠️ **FERRY FLIGHT REQUIRED**: Check C overdue."); }
        }
        else if (Math.floor(newTotalHours / THRESHOLDS.B) > Math.floor(currentStatus.last_check_b / THRESHOLDS.B)) {
            maintenanceType = "B";
            maintenanceEnd = new Date(Date.now() + MAINT_DURATIONS.B * 3600000);
        }
        else if (Math.floor(newTotalHours / THRESHOLDS.A) > Math.floor(currentStatus.last_check_a / THRESHOLDS.A)) {
            maintenanceType = "A";
            maintenanceEnd = new Date(Date.now() + MAINT_DURATIONS.A * 3600000);
        }

        if (maintenanceType && maintenanceEnd) {
            updatedStatus.is_aog = true;
            updatedStatus.maint_end_at = maintenanceEnd.toISOString();
            updatedStatus[`last_check_${maintenanceType.toLowerCase()}`] = newTotalHours;

            if (currentStatus.fleet_id && currentStatus.vamsys_internal_id) {
                await setAircraftVisibility(currentStatus.fleet_id, currentStatus.vamsys_internal_id, true);
            }
            
            // --- SYNC GOOGLE SHEET ---
            const rtsFormatted = maintenanceEnd.toLocaleString('fr-FR', { 
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' 
            }) + "Z";
            
            await updateGSheet(aircraftReg, `${maintenanceType} CHECK`, rtsFormatted);
            // --------------------------

            maintenanceAlerts.push(`🔧 **Automatic Check ${maintenanceType} started**. Finished at: <t:${Math.floor(maintenanceEnd.getTime()/1000)}:f>`);
        }

        await updateAircraftStatus(updatedStatus);

        const statusInfo = getPirepStatus(pirep.status);
        const embed = new EmbedBuilder()
          .setTitle(`PIREP – ${callsign}`)
          .setColor(statusInfo.color)
          .addFields(
            { name: "Route", value: `${departureIcao} → ${arrivalIcao}`, inline: true },
            { name: "Aircraft", value: aircraftName, inline: true },
            { name: "Network", value: safe(pirep.network, "Offline"), inline: true },
            { name: "Flight Time", value: pirep.flight_length !== undefined ? `${Math.round(pirep.flight_length)} min` : "N/A", inline: true },
            { name: "Landing Rate", value: `${landingRate} fpm`, inline: true },
            { name: "Status", value: statusInfo.label, inline: true }
          )
          .setFooter({ text: `PIREP ID: ${pirepId} • vAMSYS` })
          .setTimestamp(pirep.created_at ? new Date(pirep.created_at) : new Date());

        if (pirepId !== "N/A") {
          embed.addFields({ name: "Link", value: `[See on vAMSYS](https://vamsys.io/phoenix/flight-center/pireps/${pirepId})`, inline: true });
        }
        await channel.send({ embeds: [embed] });

        const maintenanceChannel = router.client?.channels.cache.get(process.env.MAINTENANCE_CHANNEL_ID);
        if (maintenanceAlerts.length > 0 && maintenanceChannel) {
            const maintEmbed = new EmbedBuilder()
                .setTitle(`🛠️ TECHNICAL REPORT - ${aircraftReg}`)
                .setColor("#ff0000")
                .setDescription(`Maintenance required after flight **${callsign}**.`)
                .addFields(
                    { name: "Issue(s)", value: maintenanceAlerts.join("\n") },
                    { name: "Total Airframe Hours", value: `\`${newTotalHours.toFixed(1)}h\``, inline: true }
                )
                .setTimestamp();
            await maintenanceChannel.send({ content: "⚠️ **MAINTENANCE ALERT**", embeds: [maintEmbed] });
        }
      }

      if (route.type === "pilot") {
        const d = payload.data;
        const p = d?.pilot || d; 
        const u = d?.user || p?.user;
        const pilotName = d?.user_name || p?.name || u?.name || d?.username || "Unknown";
        const vaId = p?.callsign || p?.username || d?.username || "Pending";
        const eventType = payload.event;

        let eventTitle = "👤 Pilot Update";
        let eventColor = "#3498db";

        switch (eventType) {
          case "pilot.registered": eventTitle = "🆕 New Registration"; break;
          case "pilot.approved": eventTitle = "✅ Pilot Approved"; eventColor = "#2ecc71"; break;
          case "pilot.rejected": eventTitle = "❌ Registration Rejected"; eventColor = "#e74c3c"; break;
          case "pilot.rank_changed": eventTitle = "📈 Rank Changed"; eventColor = "#9b59b6"; break;
        }

        const embed = new EmbedBuilder()
          .setTitle(eventTitle)
          .setColor(eventColor)
          .addFields(
            { name: "Pilot", value: safe(pilotName), inline: true },
            { name: "VA ID", value: `\`${safe(vaId)}\``, inline: true },
            { name: "Event", value: `\`${eventType}\``, inline: true }
          )
          .setTimestamp();

        const rankName = d?.rank?.name || p?.rank?.name || d?.new_rank?.name;
        if (rankName) embed.addFields({ name: "Rank", value: safe(rankName), inline: false });

        const profilePic = p?.profile_picture || u?.profile_picture || d?.image;
        if (profilePic) embed.setThumbnail(profilePic);

        await channel.send({ embeds: [embed] });
      }

    } catch (err) {
      console.error("❌ Webhook Error :", err);
    }
  });
});

export function attachWebhookClient(client) { router.client = client; }
export default router;
