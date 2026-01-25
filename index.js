import dotenv from 'dotenv';
import express from 'express';
import { Client, GatewayIntentBits, Partials, Collection, REST, Routes } from 'discord.js';
import { fetchAndPostRSS } from './rss.js';

// === Import des commandes ===
import { data as announceData, execute as announceExecute } from './commands/announce.js';
import { data as statusData } from './commands/status.js';
import { execute as statusExec } from './commands/status-exec.js';
import { data as handlingData, execute as handlingExec } from './commands/handling.js';
// 🆕 Ajout des fichiers de maintenance
import { data as maintResetData } from './commands/maint-reset.js';
import { execute as maintResetExec } from './commands/maint-reset-exec.js';

dotenv.config();

// Intervalle de vérification du flux RSS (en minutes)
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
// 🆕 Enregistrement de la commande de maintenance dans la collection
client.commands.set(maintResetData.name, { data: maintResetData, execute: maintResetExec });

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
          maintResetData.toJSON() // 🆕 Ajout ici pour Discord
        ] 
      }
    );
    console.log('✅ Commandes slash enregistrées avec succès.');
  } catch (error) {
    console.error('❌ Erreur lors de l’enregistrement des commandes slash :', error);
  }
})();

// === Événement "ready" ===
client.once('ready', async () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
  console.log(`[${new Date().toISOString()}] 🚀 Démarrage initial du bot.`);

  // Premier check RSS immédiat
  try {
    await fetchAndPostRSS(client);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Erreur lors du premier check RSS :`, error);
  }

  // Vérification régulière
  setInterval(async () => {
    console.log(`[${new Date().toISOString()}] ⏰ Début vérification RSS...`);
    try {
      await fetchAndPostRSS(client);
      console.log(`[${new Date().toISOString()}] ✅ Vérification terminée.`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erreur dans fetchAndPostRSS :`, error);
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
    console.error(`❌ Erreur lors de l’exécution de /${interaction.commandName} :`, error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '⚠️ Une erreur est survenue lors de l’exécution de la commande.',
        flags: 64
      });
    } else {
      await interaction.followUp({
        content: '⚠️ Une erreur est survenue lors de l’exécution de la commande.',
        flags: 64
      });
    }
  }
});

// Connexion du bot
client.login(process.env.DISCORD_TOKEN);

// === Serveur Express ===
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Bot RSS Discord actif et en ligne.');
});

app.listen(PORT, () => {
  console.log(`🌐 Serveur HTTP actif sur le port ${PORT}`);
});

// === Import final ===
import webhookRouter, { attachWebhookClient } from "./webhooks.js";

attachWebhookClient(client);
app.use("/", webhookRouter);
