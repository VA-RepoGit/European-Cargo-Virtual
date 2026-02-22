import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('maintenance_reset')
  .setDescription('Réinitialise les compteurs de maintenance d\'un avion')
  .addStringOption(option =>
    option.setName('registration')
      .setDescription('Immatriculation de l\'avion (ex: F-GZCP)')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('type')
      .setDescription('Type de maintenance effectuée')
      .setRequired(true)
      .addChoices(
        { name: 'Check A (500h)', value: 'A' },
        { name: 'Check B (1000h)', value: 'B' },
        { name: 'Check C (4000h - RPLL)', value: 'C' },
        { name: 'Check D (20000h)', value: 'D' },
        { name: 'Conditional Inspection (Hard Landing)', value: 'AOG' }
      ))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
