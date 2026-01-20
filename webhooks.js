import express from "express";
import crypto from "crypto";
import { EmbedBuilder } from "discord.js";

const router = express.Router();

// Conservation du corps brut pour la vérification de signature vAMSYS
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

// Helper pour éviter les valeurs vides (N/A par défaut)
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

      if (!signature || !raw) {
        return res.status(401).json({ error: "Missing signature or body" });
      }

      const expected = crypto
        .createHmac("sha256", route.secret)
        .update(raw)
        .digest("hex");

      if (signature !== expected) {
        console.log(`❌ Signature invalide pour ${route.path}`);
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Répondre immédiatement à vAMSYS pour éviter les timeouts
      res.status(200).json({ received: true });

      const payload = req.body;
      if (!payload.event || !payload.event.startsWith(route.type)) return;

      const channel = router.client?.channels.cache.get(route.channel);
      if (!channel) {
        console.log(`❌ Salon Discord introuvable : ${route.channel}`);
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
            { name: "Appareil", value: safe(pirep.aircraft?.name), inline: true },
            { name: "Réseau", value: safe(pirep.network, "Offline"), inline: true },
            { name: "Temps de vol", value: pirep.flight_length !== undefined ? `${Math.round(pirep.flight_length / 60)} min` : "N/A", inline: true },
            { name: "Taux d'atterrissage", value: pirep.landing_rate !== undefined ? `${pirep.landing_rate} fpm` : "N/A", inline: true },
            { name: "Statut", value: statusInfo.label, inline: true }
          )
          .setFooter({ text: `ID PIREP : ${safe(pirep.id)} • vAMSYS` })
          .setTimestamp(pirep.created_at ? new Date(pirep.created_at) : new Date());

        if (pirep.id) {
          embed.addFields({ name: "Lien", value: `[Voir sur vAMSYS](https://vamsys.io/phoenix/flight-center/pireps/${pirep.id})`, inline: true });
        }
        await channel.send({ embeds: [embed] });
      }

      // ===== LOGIQUE PILOT ROSTER (Structure API Protocol) =====
      if (route.type === "pilot") {
        const d = payload.data;
        // On cherche l'objet pilote ou utilisateur dans toutes les structures possibles
        const p = d?.pilot || d; 
        const u = d?.user || p?.user;

        // Extraction ultra-robuste selon la doc vAMSYS
        const pilotName = d?.user_name || p?.name || u?.name || d?.username || "Inconnu";
        const vaId = p?.callsign || p?.username || d?.username || "En attente";
        const eventType = payload.event;

        let eventTitle = "👤 Mise à jour Pilote";
        let eventColor = "#3498db";

        // Mapping des événements cochés sur vAMSYS
        switch (eventType) {
          case "pilot.registered": 
            eventTitle = "🆕 Nouvelle Inscription"; 
            eventColor = "#3498db"; 
            break;
          case "pilot.approved": 
            eventTitle = "✅ Pilote Approuvé"; 
            eventColor = "#2ecc71"; 
            break;
          case "pilot.rejected": 
            eventTitle = "❌ Inscription Refusée"; 
            eventColor = "#e74c3c"; 
            break;
          case "pilot.banned": 
            eventTitle = "🔨 Pilote Banni"; 
            eventColor = "#000000"; 
            break;
          case "pilot.unbanned": 
            eventTitle = "🔓 Pilote Débanni"; 
            eventColor = "#f1c40f"; 
            break;
          case "pilot.deleted": 
            eventTitle = "🗑️ Compte Supprimé"; 
            eventColor = "#95a5a6"; 
            break;
          case "pilot.rank_changed": 
            eventTitle = "📈 Changement de Grade"; 
            eventColor = "#9b59b6"; 
            break;
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

        // Affichage du grade si l'info est présente (utile pour rank_changed)
        const rankName = d?.rank?.name || p?.rank?.name || d?.new_rank?.name;
        if (rankName) {
          embed.addFields({ name: "Grade", value: safe(rankName), inline: false });
        }

        // Image de profil (Thumbnail)
        const profilePic = p?.profile_picture || u?.profile_picture || d?.image;
        if (profilePic) {
          embed.setThumbnail(profilePic);
        }

        await channel.send({ embeds: [embed] });
      }

      console.log(`📨 Webhook vAMSYS traité : ${payload.event}`);

    } catch (err) {
      console.error("❌ Erreur lors du traitement du Webhook :", err);
    }
  });
});

// Attachement du client Discord
export function attachWebhookClient(client) {
  router.client = client;
}

export default router;
