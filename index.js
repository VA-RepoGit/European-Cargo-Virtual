import dotenv from 'dotenv';
import express from 'express';
import { Client, GatewayIntentBits, Partials, Collection, REST, Routes, EmbedBuilder } from 'discord.js';
import { fetchAndPostRSS } from './rss.js';
import { supabase } from './utils/supabase.js';
import { setAircraftVisibility } from './utils/vamsys.js';
import { updateGSheet } from './utils/gsheet.js'; // Import de l'utilitaire de synchronisation Google Sheet

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
import { data as announceData, execute as announceExecute } from './commands/announce.js';
import { data as statusData } from './commands/status.js';
import { execute as statusExec } from './commands/status-exec.js';
import { data as handlingData, execute as handlingExec } from './commands/handling.js';
import { data as maintResetData } from './commands/maint-reset.js';
import { execute as maintResetExec } from './commands/maint-reset-exec.js';
import { data as fleetStatusData } from './commands/fleet-status.js';
import { execute as fleetStatusExec } from './commands/fleet-status-exec.js';
import { data as metarData, execute as metarExec } from './commands/metar.js';

client.commands = new Collection();
client.commands.set(announceData.name, { data: announceData, execute: announceExecute });
client.commands.set(statusData.name, { data: statusData, execute: statusExec });
client.commands.set(handlingData.name, { data: handlingData, execute: handlingExec });
client.commands.set(maintResetData.name, { data: maintResetData, execute: maintResetExec });
client.commands.set(fleetStatusData.name, { data: fleetStatusData, execute: fleetStatusExec });
client.commands.set(metarData.name, { data: metarData, execute: metarExec });

// === Enregistrement des commandes sur Discord ===
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🚀 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { 
        body: [
          announceData.toJSON(), 
          statusData.toJSON(), 
          handlingData.toJSON(),
          maintResetData.toJSON(),
          fleetStatusData.toJSON(),
          metarData.toJSON()
        ] 
      }
    );
    console.log('✅ Slash commands registered.');
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
})();

// === Automatic Function: Maintenance Checker ===
function startMaintenanceChecker(client) {
    setInterval(async () => {
        const { data: aircrafts, error } = await supabase
            .from('aircraft_status')
            .select('*')
            .not('maint_end_at', 'is', null)
            .lte('maint_end_at', new Date().toISOString());

        if (error || !aircrafts || aircrafts.length === 0) return;

        for (const ac of aircrafts) {
            // 1. Restore visibility in vAMSYS Phoenix
            if (ac.fleet_id && ac.vamsys_internal_id) {
                await setAircraftVisibility(ac.fleet_id, ac.vamsys_internal_id, false);
            }

            // 2. Synchronisation avec Google Sheet (Sortie de maintenance)
            // Envoie "Active" pour vider les colonnes ACTIVE CHECK et RTS, et remettre le STATUS sur Active
            await updateGSheet(ac.registration, "Active", "");

            // 3. Send notification to Discord
            const channel = client.channels.cache.get(process.env.MAINTENANCE_CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle(`✅ Maintenance Completed - ${ac.registration}`)
                    .setDescription(`Aircraft **${ac.registration}** has completed its scheduled maintenance and is now back in service!`)
                    .setColor('#2ecc71')
                    .setTimestamp();
                
                await channel.send({ content: `🔔 Attention <@${process.env.OWNER_ID}>`, embeds: [embed] });
            }

            // 4. Update Database to release aircraft
            await supabase
                .from('aircraft_status')
                .update({ maint_end_at: null, is_aog: false })
                .eq('registration', ac.registration);
            
            console.log(`🔧 [Maintenance] ${ac.registration} released, restored to Phoenix and synchronized with Google Sheet.`);
        }
    }, 60000); // Check every minute
}

// === Event "ready" ===
client.once('ready', async () => {
  console.log(`🤖 Connected as ${client.user.tag}`);
  
  startMaintenanceChecker(client);

  try {
    await fetchAndPostRSS(client);
  } catch (error) {
    console.error(`❌ RSS Error:`, error);
  }

  setInterval(async () => {
    try {
      await fetchAndPostRSS(client);
    } catch (error) {
      console.error(`❌ RSS Interval Error:`, error);
    }
  }, CHECK_INTERVAL_MINUTES * 60 * 1000);
});

// === Slash Command Handler ===
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌ Error /${interaction.commandName} :`, error);
    const errorMsg = { content: '⚠️ An error occurred while executing this command.', flags: 64 };
    interaction.replied || interaction.deferred ? await interaction.followUp(errorMsg) : await interaction.reply(errorMsg);
  }
});

client.login(process.env.DISCORD_TOKEN);

// === Express Server & Webhooks ===
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🤖 Bot vURO OPS active.'));

app.listen(PORT, () => console.log(`🌐 Listening on port: ${PORT}`));

import webhookRouter, { attachWebhookClient } from "./webhooks.js";
attachWebhookClient(client);
app.use("/", webhookRouter);
