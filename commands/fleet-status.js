import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('fleet_status')
  .setDescription('Affiche l\'état de maintenance de toute la flotte')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // réservé aux admins
