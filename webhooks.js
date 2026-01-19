import express from "express";
import crypto from "crypto";
import { EmbedBuilder } from "discord.js";

const router = express.Router();

// Conservation du corps brut pour la vérification de signature
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Configuration des routes Webhook
const routes = [
  {
    path: "/vamsys/webhook1", // PIREP
    channel: process.env.VAMSYS_WEBHOOK1_CHANNEL,
    secret: process.env.VAMSYS_WEBHOOK1_SECRET,
    type: "pirep",
  },
  {
    path: "/vamsys/webhook2", // Pilot roster
    channel: process.env.VAMSYS_WEBHOOK2_CHANNEL,
    secret: process.env.VAMSYS_WEBHOOK2_SECRET,
    type: "pilot",
  },
];

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
      // 1. Vérification de la signature vAMSYS
      const signature = req.headers["x-vamsys-signature"];
      const raw = req.rawBody;

      const expected = crypto
        .createHmac("sha256", route.secret)
        .update(raw)
        .digest("hex");

      if (signature !== expected) {
        console.log(`❌ Invalid signature for ${route.path}`);
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Répondre immédiatement à vAMSYS
      res.status(200).json({ received: true });

      const payload = req.body;
      if (!payload.event || !payload.event.startsWith(route.type)) return;

      const channel = router.client?.channels.cache.get(route.channel);
      if (!channel) {
        console.log(`❌ Discord channel not found: ${route.channel}`);
        return;
      }

      // ===== LOGIQUE PIREP =====
      if (route.type === "pirep") {
        const pirep = payload.data?.pirep ?? payload.data;
        if (!pirep) return;

        const statusInfo = getPirepStatus(pirep.status);
        const embed = new EmbedBuilder()
          .setTitle(`PIREP – ${safe(pirep.callsign)}`)
          .setColor(statusInfo.color)
          .addFields(
            { name: "Route", value: `${safe(pirep.departure_airport?.icao, "----")} → ${safe(pirep.arrival_airport?.icao, "----")}`, inline: true },
            { name: "Aircraft", value: safe(pirep.aircraft?.name), inline: true },
            { name: "Network", value: safe(pirep.network, "Offline"), inline: true },
            { name: "Flight Time", value: pirep.flight_length !== undefined ? `${Math.round(pirep.flight_length / 60)} min` : "N/A", inline: true },
            { name: "Landing Rate", value: pirep.landing_rate !== undefined ? `${pirep.landing_rate} fpm` : "N/A", inline: true },
            { name: "Status", value: statusInfo.label, inline: true }
          )
          .setFooter({ text: `PIREP ID ${safe(pirep.id)} • vAMSYS` })
          .setTimestamp(pirep.created_at ? new Date(pirep.created_at) : new Date());

        if (pirep.id) {
          embed.addFields({ name: "Lien", value: `[Voir sur vAMSYS](https://vamsys.io/phoenix/flight-center/pireps/${pirep.id})`, inline: true });
        }
        await channel.send({ embeds: [embed] });
      }

      // ===== LOGIQUE PILOT ROSTER (Infos cochées) =====
      if (route.type === "pilot") {
        const pilotData = payload.data?.pilot || payload.data;
        if (!pilotData) return;

        const pilotName = pilotData.name || (pilotData.user ? pilotData.user.name : "Inconnu");
        const vaId = pilotData.callsign || pilotData.username || "N/A";
        const eventType = payload.event;

        let eventTitle = "👤 Mise à jour Pilote";
        let eventColor = "#3498db";

        // Personnalisation selon les options choisies sur vAMSYS
        switch (eventType) {
          case "pilot.registered": eventTitle = "🆕 Nouveau Pilote Enregistré"; eventColor = "#3498db"; break;
          case "pilot.approved": eventTitle = "✅ Pilote Approuvé"; eventColor = "#2ecc71"; break;
          case "pilot.rejected": eventTitle = "❌ Inscription Refusée"; eventColor = "#e74c3c"; break;
          case "pilot.banned": eventTitle = "🔨 Pilote Banni"; eventColor = "#000000"; break;
          case "pilot.unbanned": eventTitle = "🔓 Pilote Débanni"; eventColor = "#f1c40f"; break;
          case "pilot.deleted": eventTitle = "🗑️ Compte Pilote Supprimé"; eventColor = "#95a5a6"; break;
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

        if (eventType === "pilot.rank_changed" && pilotData.rank) {
          embed.addFields({ name: "Nouveau Grade", value: safe(pilotData.rank.name), inline: false });
        }

        const profilePic = pilotData.profile_picture || (pilotData.user ? pilotData.user.profile_picture : null);
        if (profilePic) embed.setThumbnail(profilePic);

        await channel.send({ embeds: [embed] });
      }

      console.log(`📨 Webhook vAMSYS traité : ${payload.event}`);

    } catch (err) {
      console.error("❌ Erreur lors du traitement du Webhook :", err);
    }
  });
});

export function attachWebhookClient(client) {
  router.client = client;
}

export default router;
