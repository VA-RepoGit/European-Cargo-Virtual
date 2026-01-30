import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { updateAircraftStatus, getAircraftStatus } from '../utils/supabase.js';

export const data = new SlashCommandBuilder()
    .setName('maint_start')
    .setDescription('Lance un chrono de maintenance pour un avion')
    .addStringOption(option => option.setName('registration').setDescription('Immatriculation').setRequired(true))
    .addIntegerOption(option => option.setName('duration').setDescription('Durée en heures').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    const reg = interaction.options.getString('registration').toUpperCase();
    const hours = interaction.options.getInteger('duration');
    
    const current = await getAircraftStatus(reg);
    const endAt = new Date(Date.now() + hours * 3600000);

    await updateAircraftStatus({
        ...current,
        registration: reg,
        is_aog: true, // L'avion est bloqué pendant la maintenance
        maint_end_at: endAt.toISOString()
    });

    const embed = new EmbedBuilder()
        .setTitle(`🔧 Maintenance lancée - ${reg}`)
        .setDescription(`L'avion est maintenant en maintenance pour **${hours} heures**.`)
        .addFields({ name: "Fin prévue", value: `<t:${Math.floor(endAt.getTime() / 1000)}:F>` })
        .setColor('#f1c40f');

    await interaction.reply({ embeds: [embed] });
}
