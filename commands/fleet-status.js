import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js'; // Ajout de l'import ici

export const data = new SlashCommandBuilder()
  .setName('fleet_status')
  .setDescription('Affiche l\'état de maintenance de toute la flotte')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // Réservé aux admins
