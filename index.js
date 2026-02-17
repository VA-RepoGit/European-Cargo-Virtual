import dotenv from 'dotenv';
import express from 'express';
import { Client, GatewayIntentBits, Partials, Collection, REST, Routes, EmbedBuilder } from 'discord.js'; // Ajout EmbedBuilder pour le checker
import { fetchAndPostRSS } from './rss.js';
import { supabase } from './utils/supabase.js'; // Import pour le checker de maintenance

// === Import des commandes ===
import { data as announceData, execute as announceExecute } from './commands/announce.js';
import { data as statusData } from './commands/status.js';
import { execute as statusExec } from './commands/status-exec.js';
import { data as handlingData, execute as handlingExec } from './commands/handling.js';
import { data as maintResetData } from './commands/maint-reset.js';
import { execute as maintResetExec } from './commands/maint-reset-exec.js';
import { data as fleetStatusData } from './commands/fleet-status.js';
import { execute as fleetStatusExec } from './commands/fleet-status-exec.js';
import { execute as fleetStatusExec } from './commands/fleet-status-exec.js';
// 🆕 Ajout de la commande Maint Start
import { data as maintStartData, execute as maintStartExec } from './commands/maint-start.js';

dotenv.config();

const CHECK_INTERVAL_MINUTES = 30;

// === Création du bot Discord ===
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// === Initialisation des commandes slash ===
client.commands = new Collection();
client.commands.set(announceData.name, { data: announceData, execute: announceExecute });
client.commands.set(statusData.name, { data: statusData, execute: statusExec });
client.commands.set(handlingData.name, { data: handlingData, execute: handlingExec });
client.commands.set(maintResetData.name, { data: maintResetData, execute: maintResetExec });
client.commands.set(fleetStatusData.name, { data: fleetStatusData, execute: fleetStatusExec });
client.commands.set(maintStartData.name, { data: maintStartData, execute: maintStartExec }); // 🆕

// === Enregistrement des commandes sur Discord ===
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🚀 Enregistrement des commandes slash...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { 
        body: [
          announceData.toJSON(), 
          statusData.toJSON(), 
          handlingData.toJSON(),
          maintResetData.toJSON(),
          fleetStatusData.toJSON(),
          maintStartData.toJSON() // 🆕
        ] 
      }
    );
    console.log('✅ Commandes slash enregistrées avec succès.');
  } catch (error) {
    console.error('❌ Erreur lors de l’enregistrement des commandes slash :', error);
  }
})();

// === Fonction Automatique : Maintenance Checker ===
function startMaintenanceChecker(client) {
    setInterval(async () => {
        const { data: aircrafts, error } = await supabase
            .from('aircraft_status')
            .select('*')
            .not('maint_end_at', 'is', null)
            .lte('maint_end_at', new Date().toISOString());

        if (error || !aircrafts || aircrafts.length === 0) return;

        for (const ac of aircrafts) {
            const channel = client.channels.cache.get(process.env.MAINTENANCE_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle(`✅ Maintenance terminée - ${ac.registration}`)
                    .setDescription(`L'avion **${ac.registration}** a terminé sa maintenance et est de nouveau disponible !`)
                    .setColor('#2ecc71')
                    .setTimestamp();
                
                await channel.send({ content: `🔔 <@${process.env.OWNER_ID}>`, embeds: [embed] });
            }

            await supabase
                .from('aircraft_status')
                .update({ maint_end_at: null, is_aog: false })
                .eq('registration', ac.registration);
            
            console.log(`🔧 [Maintenance] ${ac.registration} libéré.`);
        }
    }, 60000); // Vérification toutes les minutes
}

// === Événement "ready" ===
client.once('ready', async () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
  
  // Démarrage du checker de maintenance 🆕
  startMaintenanceChecker(client);

  try {
    await fetchAndPostRSS(client);
  } catch (error) {
    console.error(`❌ Erreur RSS initial :`, error);
  }

  setInterval(async () => {
    try {
      await fetchAndPostRSS(client);
    } catch (error) {
      console.error(`❌ Erreur intervalle RSS :`, error);
    }
  }, CHECK_INTERVAL_MINUTES * 60 * 1000);
});

// === Gestion des commandes slash ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ Erreur /${interaction.commandName} :`, error);
    const errorMsg = { content: '⚠️ Une erreur est survenue.', flags: 64 };
    interaction.replied || interaction.deferred ? await interaction.followUp(errorMsg) : await interaction.reply(errorMsg);
  }
});

client.login(process.env.DISCORD_TOKEN);

// === Serveur Express & Webhooks ===
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🤖 Bot vURO OPS actif.'));

app.listen(PORT, () => console.log(`🌐 Port : ${PORT}`));

import webhookRouter, { attachWebhookClient } from "./webhooks.js";
attachWebhookClient(client);
app.use("/", webhookRouter);
