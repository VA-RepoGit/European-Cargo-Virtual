import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('fleet_status')
  .setDescription('Display detailed maintenance status (A, B, C) for the entire fleet')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
