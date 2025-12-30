import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Change le statut du bot')
  .addStringOption(option =>
    option.setName('etat')
      .setDescription('Choisis le statut du bot')
      .setRequired(true)
      .addChoices(
        { name: 'En ligne', value: 'online' },
        { name: 'Absent', value: 'idle' },
        { name: 'Occupé', value: 'dnd' },
        { name: 'Hors ligne', value: 'invisible' }
      ))
  .addStringOption(option =>
    option.setName('message')
      .setDescription('Message affiché comme activité')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('type')
      .setDescription('Type d’activité')
      .setRequired(false)
      .addChoices(
        { name: 'Joue à', value: '0' },
        { name: 'Écoute', value: '2' },
        { name: 'Regarde', value: '3' },
        { name: 'Participe à', value: '5' }
      ))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // réservé aux admins
