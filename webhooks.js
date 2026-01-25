import express from "express";
import crypto from "crypto";
import { EmbedBuilder } from "discord.js";
import { getAircraftStatus, updateAircraftStatus } from './utils/supabase.js';

const router = express.Router();

// Conservation du corps brut pour la vérification de signature vAMSYS
router.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Configuration des routes Webhook
const routes = [
  { path: "/vamsys/webhook1", channel: process.env.VAMSYS_WEBHOOK1_CHANNEL, secret: process.env.VAMSYS_WEBHOOK1_SECRET, type: "pirep" },
  { path: "/vamsys/webhook2", channel: process.env.VAMSYS_WEBHOOK2_CHANNEL, secret: process.env.VAMSYS_WEBHOOK2_SECRET, type: "pilot" },
];

const THRESHOLDS = { D: 20000, C: 4000, B: 1000, A: 500 };

// Helper pour éviter les valeurs vides
function safe(value, fallback = "N/A") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

// Mapper de statut pour les PIREPs
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

      // ===== LOGIQUE PIREP & MAINTENANCE (AVEC PROTECTION DOUBLONS) =====
      if (route.type === "pirep") {
        const pirep = payload.data?.pirep ?? payload.data;
        if (!pirep) return;

        const aircraftReg = safe(pirep.aircraft?.registration, "UNKNOWN");
        const pirepId = safe(pirep.id);
        const flightHours = (pirep.flight_length || 0) / 60;
        const landingRate = pirep.landing_rate || 0;

        // 1. Récupération du statut actuel et vérification du doublon
        const currentStatus = await getAircraftStatus(aircraftReg);
        
        // On vérifie si ce PIREP a déjà été comptabilisé
        const isAlreadyProcessed = (currentStatus.last_pirep_id === pirepId);
        
        let newTotalHours = currentStatus.total_flight_hours;
        if (!isAlreadyProcessed) {
            newTotalHours += flightHours;
        }

        let maintenanceAlerts = [];
        let updatedStatus = { 
            ...currentStatus, 
            registration: aircraftReg,
            total_flight_hours: newTotalHours,
            last_pirep_id: pirepId // On met à jour l'ID pour bloquer le prochain doublon
        };

        // Détection Hard Landing (Seuil modifiable ici)
        if (landingRate <= -600) {
            maintenanceAlerts.push(`🚨 **AOG - HARD LANDING DÉTECTÉ** (${landingRate} fpm)`);
            updatedStatus.is_aog = true;
        }

        // Détection des Checks
        if (Math.floor(newTotalHours / THRESHOLDS.C) > Math.floor(currentStatus.last_check_c / THRESHOLDS.C)) {
            maintenanceAlerts.push("🛠️ **CHECK C REQUIS** (Convoyage RPLL)");
        } else if (Math.floor(newTotalHours / THRESHOLDS.A) > Math.floor(currentStatus.last_check_a / THRESHOLDS.A)) {
            maintenanceAlerts.push("🩹 **CHECK A REQUIS**");
        }

        // Mise à jour Supabase
        await updateAircraftStatus(updatedStatus);

        // 2. ENVOI DE L'EMBED ORIGINAL (SANS HEURE CELLULE DANS LE TITRE/FIELDS)
        const statusInfo = getPirepStatus(pirep.status);
        const embed = new EmbedBuilder()
          .setTitle(`PIREP – ${safe(pirep.callsign)}`)
          .setColor(statusInfo.color)
          .addFields(
            { name: "Route", value: `${safe(pirep.departure_airport?.icao, "----")} → ${safe(pirep.arrival_airport?.icao, "----")}`, inline: true },
            { name: "Aircraft", value: safe(pirep.aircraft?.name), inline: true },
            { name: "Network", value: safe(pirep.network, "Offline"), inline: true },
            { name: "Flight Time", value: pirep.flight_length !== undefined ? `${Math.round(pirep.flight_length)} min` : "N/A", inline: true },
            { name: "Landing Rate", value: pirep.landing_rate !== undefined ? `${pirep.landing_rate} fpm` : "N/A", inline: true },
            { name: "Status", value: statusInfo.label, inline: true }
          )
          .setFooter({ text: `ID PIREP : ${safe(pirep.id)} • vAMSYS` })
          .setTimestamp(pirep.created_at ? new Date(pirep.created_at) : new Date());

        if (pirep.id) {
          embed.addFields({ name: "Link", value: `[See on vAMSYS](https://vamsys.io/phoenix/flight-center/pireps/${pirep.id})`, inline: true });
        }
        await channel.send({ embeds: [embed] });

        // 3. ENVOI ALERTE (UNIQUEMENT DANS LE SALON MAINTENANCE)
        const maintenanceChannel = router.client?.channels.cache.get(process.env.MAINTENANCE_CHANNEL_ID);
        if (maintenanceAlerts.length > 0 && maintenanceChannel) {
            const maintEmbed = new EmbedBuilder()
                .setTitle(`🛠️ RAPPORT TECHNIQUE - ${aircraftReg}`)
                .setColor("#ff0000")
                .setDescription(`L'avion nécessite une maintenance après le vol **${safe(pirep.callsign)}**.`)
                .addFields(
                    { name: "Problème(s)", value: maintenanceAlerts.join("\n") },
                    { name: "Heures Totales Cellule", value: `\`${newTotalHours.toFixed(1)}h\``, inline: true }
                )
                .setTimestamp();
            await maintenanceChannel.send({ content: "⚠️ **ALERTE MAINTENANCE**", embeds: [maintEmbed] });
        }
      }

      // ===== LOGIQUE PILOT ROSTER =====
      if (route.type === "pilot") {
        const d = payload.data;
        const p = d?.pilot || d; 
        const u = d?.user || p?.user;
        const pilotName = d?.user_name || p?.name || u?.name || d?.username || "Inconnu";
        const vaId = p?.callsign || p?.username || d?.username || "En attente";
        const eventType = payload.event;

        let eventTitle = "👤 Mise à jour Pilote";
        let eventColor = "#3498db";

        switch (eventType) {
          case "pilot.registered": eventTitle = "🆕 Nouvelle Inscription"; break;
          case "pilot.approved": eventTitle = "✅ Pilote Approuvé"; eventColor = "#2ecc71"; break;
          case "pilot.rejected": eventTitle = "❌ Inscription Refusée"; eventColor = "#e74c3c"; break;
          case "pilot.rank_changed": eventTitle = "📈 Changement de Grade"; eventColor = "#9b59b6"; break;
        }

        const embed = new EmbedBuilder()
          .setTitle(eventTitle)
          .setColor(eventColor)
          .addFields(
            { name: "Pilote", value: safe(pilotName), inline: true },
            { name: "Identifiant VA", value: `\`${safe(vaId)}\``, inline: true },
            { name: "Événement", value: `\`${eventType}\``, inline: true }
          )
          .setTimestamp();

        const rankName = d?.rank?.name || p?.rank?.name || d?.new_rank?.name;
        if (rankName) embed.addFields({ name: "Grade", value: safe(rankName), inline: false });

        const profilePic = p?.profile_picture || u?.profile_picture || d?.image;
        if (profilePic) embed.setThumbnail(profilePic);

        await channel.send({ embeds: [embed] });
      }

      console.log(`📨 Webhook vAMSYS traité : ${payload.event}`);
    } catch (err) {
      console.error("❌ Erreur Webhook :", err);
    }
  });
});

export function attachWebhookClient(client) { router.client = client; }
export default router;
