import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('fleet_status')
    // 🔒 Réservé aux administrateurs uniquement
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDescription('Affiche l\'état de maintenance de toute la flotte');
