import express from "express";
import crypto from "crypto";
import { EmbedBuilder } from "discord.js";
import { getAircraftStatus, updateAircraftStatus } from './utils/supabase.js';
import { setAircraftVisibility } from './utils/vamsys.js';
import { updateGSheet } from './utils/gsheet.js';

const router = express.Router();

// Variable globale pour stocker le client Discord
let discordClient = null;

/**
 * Exporte la fonction attendue par index.js pour lier le bot
 */
export const attachWebhookClient = (client) => {
  discordClient = client;
};

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
  if (s === "pending") return { label: "Pending", color: "#f1c40f" };
  if (s === "rejected") return { label: "Rejected", color: "#e74c3c" };
  return { label: s.toUpperCase(), color: "#95a5a6" };
}

router.post("/vamsys/*", async (req, res) => {
  const route = routes.find(r => req.path.endsWith(r.path.split('/').pop()));
  if (!route) return res.status(404).send("Route not found");

  const signature = req.headers["x-vamsys-signature"];
  if (!signature) return res.status(401).send("No signature");

  const expected = crypto.createHmac("sha256", route.secret).update(req.rawBody).digest("hex");
  if (signature !== expected) return res.status(401).send("Invalid signature");

  res.status(200).send("OK");

  try {
    const payload = req.body;
    
    // On utilise le client Discord attaché
    if (!discordClient) return console.error("Discord client not attached to webhooks");
    const channel = await discordClient.channels.fetch(route.channel);
    if (!channel) return;

    if (route.type === "pirep") {
      const d = payload.data || {};
      const p = d.pirep || {};
      const a = p.aircraft || {};
      
      const aircraftReg = safe(a.registration);
      const flightTimeRaw = p.flight_time || "0:00";
      const [h, m] = flightTimeRaw.split(':').map(Number);
      const flightHours = h + (m / 60);

      // --- LOGIQUE MAINTENANCE ---
      const currentStatus = await getAircraftStatus(aircraftReg);
      const newTotalHours = (currentStatus.total_hours || 0) + flightHours;

      let maintenanceType = null;
      let maintenanceEnd = null;
      let maintenanceAlerts = [];

      if (newTotalHours - (currentStatus.last_check_d || 0) >= THRESHOLDS.D) maintenanceType = 'D';
      else if (newTotalHours - (currentStatus.last_check_c || 0) >= THRESHOLDS.C) maintenanceType = 'C';
      else if (newTotalHours - (currentStatus.last_check_b || 0) >= THRESHOLDS.B) maintenanceType = 'B';
      else if (newTotalHours - (currentStatus.last_check_a || 0) >= THRESHOLDS.A) maintenanceType = 'A';

      const updatedStatus = {
        total_hours: newTotalHours,
        last_flight_at: new Date().toISOString()
      };

      if (maintenanceType) {
        maintenanceEnd = new Date();
        maintenanceEnd.setHours(maintenanceEnd.getHours() + MAINT_DURATIONS[maintenanceType]);
        
        updatedStatus.is_aog = true;
        updatedStatus.maint_end_at = maintenanceEnd.toISOString();
        updatedStatus[`last_check_${maintenanceType.toLowerCase()}`] = newTotalHours;

        if (currentStatus.fleet_id && currentStatus.vamsys_internal_id) {
          await setAircraftVisibility(currentStatus.fleet_id, currentStatus.vamsys_internal_id, true);
        }

        // --- SYNCHRO GOOGLE SHEET ---
        const rtsFormatted = maintenanceEnd.toLocaleString('fr-FR', { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' 
        }) + "Z";
        
        await updateGSheet(aircraftReg, `${maintenanceType} CHECK`, rtsFormatted);
        // ----------------------------

        maintenanceAlerts.push(`🔧 **Automatic Check ${maintenanceType} started**. RTS: <t:${Math.floor(maintenanceEnd.getTime()/1000)}:f>`);
      }

      await updateAircraftStatus(aircraftReg, updatedStatus);

      // --- ENVOI DE L'EMBED DISCORD ---
      const statusInfo = getPirepStatus(p.status);
      const embed = new EmbedBuilder()
        .setTitle(`✈️ PIREP ${statusInfo.label}`)
        .setColor(statusInfo.color)
        .setThumbnail(a.image || null)
        .addFields(
          { name: "Aircraft", value: `**${aircraftReg}** (${safe(a.name)})`, inline: true },
          { name: "Route", value: `**${safe(p.departure_icao)}** ➡️ **${safe(p.arrival_icao)}**`, inline: true },
          { name: "Flight Time", value: `\`${flightTimeRaw}\``, inline: true },
          { name: "Pilot", value: safe(d.pilot?.username), inline: true },
          { name: "Total Airframe", value: `\`${newTotalHours.toFixed(1)}h\``, inline: true }
        )
        .setTimestamp();

      if (maintenanceAlerts.length > 0) {
        embed.addFields({ name: "⚠️ Maintenance Notice", value: maintenanceAlerts.join('\n') });
      }

      await channel.send({ embeds: [embed] });

    } else if (route.type === "pilot") {
      const d = payload.data || {};
      const p = d.pilot || {};
      const u = d.user || {};
      const vaId = d.va_id || p.va_id || "N/A";
      const pilotName = u.username || p.username || d.username || "Pending";
      const eventType = payload.event;

      let eventTitle = "👤 Pilot Update";
      let eventColor = "#3498db";

      switch (eventType) {
        case "pilot.registered": eventTitle = "🆕 New Registration"; break;
        case "pilot.approved": eventTitle = "✅ Pilot Approved"; eventColor = "#2ecc71"; break;
        case "pilot.rejected": eventTitle = "❌ Registration Rejected"; eventColor = "#e74c3c"; break;
        case "pilot.rank_changed": eventTitle = "📈 Rank Promoted"; eventColor = "#9b59b6"; break;
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

      await channel.send({ embeds: [embed] });
    }

  } catch (err) {
    console.error("Webhook Error:", err);
  }
});

export default router;
