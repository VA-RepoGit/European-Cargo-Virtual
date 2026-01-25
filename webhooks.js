import express from "express";
import crypto from "crypto";
import { EmbedBuilder } from "discord.js";
import { getAircraftStatus, updateAircraftStatus } from './utils/supabase.js';

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

// Constantes de maintenance (Heures)
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

      // ===== LOGIQUE PIREP & MAINTENANCE =====
      if (route.type === "pirep") {
        const pirep = payload.data?.pirep ?? payload.data;
        if (!pirep) return;

        // 1. Données de vol
        const aircraftReg = safe(pirep.aircraft?.registration, "UNKNOWN");
        const flightMinutes = pirep.flight_length || 0;
        const flightHours = flightMinutes / 60;
        const landingRate = pirep.landing_rate || 0;

        // 2. Calcul Maintenance
        const currentStatus = await getAircraftStatus(aircraftReg);
        const newTotalHours = currentStatus.total_flight_hours + flightHours;
        
        let maintenanceAlerts = [];
        let updatedStatus = { ...currentStatus, total_flight_hours: newTotalHours };

        // Détection Hard Landing
        if (landingRate <= -600) {
            maintenanceAlerts.push("🚨 **AOG - HARD LANDING DÉTECTÉ** (" + landingRate + " fpm)");
            updatedStatus.is_aog = true;
        }

        // Détection des seuils de Checks
        if (Math.floor(newTotalHours / THRESHOLDS.D) > Math.floor(currentStatus.last_check_d / THRESHOLDS.D)) {
            maintenanceAlerts.push("🏥 **CHECK D REQUIS** (Immobilisation Majeure)");
        } else if (Math.floor(newTotalHours / THRESHOLDS.C) > Math.floor(currentStatus.last_check_c / THRESHOLDS.C)) {
            maintenanceAlerts.push("🛠️ **CHECK C REQUIS** (Convoyage RPLL / Lufthansa Technik)");
        } else if (Math.floor(newTotalHours / THRESHOLDS.B) > Math.floor(currentStatus.last_check_b / THRESHOLDS.B)) {
            maintenanceAlerts.push("🔧 **CHECK B REQUIS**");
        } else if (Math.floor(newTotalHours / THRESHOLDS.A) > Math.floor(currentStatus.last_check_a / THRESHOLDS.A)) {
            maintenanceAlerts.push("🩹 **CHECK A REQUIS**");
        }

        // Sauvegarde Supabase
        await updateAircraftStatus(updatedStatus);

        // 3. Envoi Embed PIREP (Salon Normal)
        const statusInfo = getPirepStatus(pirep.status);
        const embed = new EmbedBuilder()
          .setTitle(`PIREP – ${safe(pirep.callsign)} [${aircraftReg}]`)
          .setColor(maintenanceAlerts.length > 0 ? "#ff0000" : statusInfo.color)
          .addFields(
            { name: "Route", value: `${safe(pirep.departure_airport?.icao)} → ${safe(pirep.arrival_airport?.icao)}`, inline: true },
            { name: "Landing Rate", value: `${landingRate} fpm`, inline: true },
            { name: "Heures Cellule", value: `\`${newTotalHours.toFixed(1)}h\``, inline: true }
          )
          .setFooter({ text: `vAMSYS • Prochain Check C dans ${(THRESHOLDS.C - (newTotalHours % THRESHOLDS.C)).toFixed(0)}h` })
          .setTimestamp();

        await channel.send({ embeds: [embed] });

        // 4. Envoi Alerte Salon Maintenance (Si alerte)
        const maintenanceChannel = router.client?.channels.cache.get(process.env.MAINTENANCE_CHANNEL_ID);
        if (maintenanceAlerts.length > 0 && maintenanceChannel) {
            const maintEmbed = new EmbedBuilder()
                .setTitle(`🛠️ RAPPORT TECHNIQUE - ${aircraftReg}`)
                .setColor("#ff0000")
                .setDescription(`L'avion nécessite une maintenance après le vol **${safe(pirep.callsign)}**.`)
                .addFields(
                    { name: "Statut", value: maintenanceAlerts.join("\n") },
                    { name: "Heures Totales", value: `\`${newTotalHours.toFixed(1)}h\``, inline: true },
                    { name: "Lieu Maintenance", value: "Lufthansa Technik (RPLL)", inline: true }
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
            { name: "Pilote", value: safe(d?.user_name || p?.name), inline: true },
            { name: "Identifiant", value: `\`${safe(p?.callsign || p?.username)}\``, inline: true },
            { name: "Événement", value: `\`${eventType}\``, inline: true }
          )
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }

      console.log(`📨 Webhook vAMSYS traité : ${payload.event}`);
    } catch (err) {
      console.error("❌ Erreur Webhook :", err);
    }
  });
});

export function attachWebhookClient(client) {
  router.client = client;
}

export default router;
