import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

// Connexion Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Lit la variable d'environnement. Peut contenir un seul ID ou plusieurs séparés par des virgules.
const rawAllowed = process.env.HANDLING_CHANNEL_ID || '';
const ALLOWED_CHANNELS = rawAllowed
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const data = new SlashCommandBuilder()
  .setName('handling')
  .setDescription('Show company parking stands for the specified airport.')
  .addStringOption(option =>
    option.setName('icao')
      .setDescription('ICAO Airport Code (e.g. EGHH)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const icao = interaction.options.getString('icao').toUpperCase();
  const user = interaction.user;

  // Si ALLOWED_CHANNELS n'est pas vide, vérifier que le salon est autorisé
  if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(interaction.channelId)) {
    return interaction.reply({
      content: '⚠️ This command can only be used in authorised chat rooms.'
    });
  }

  try {
    // Réponse différée PUBLIC
    await interaction.deferReply();

    // Récupération unique pour un aéroport
    const { data, error } = await supabase
      .from('parking_stands')
      .select('*')
      .eq('icao', icao)
      .single();

    if (error || !data) {
      return interaction.editReply({
        content: `❌ No entries found for **${icao}**.`
      });
    }

    // Construction de l'embed
    const embed = new EmbedBuilder()
      .setColor('#c90021')
      .setTitle(`🛫 Airport Handling - ${data.icao}`)
      .addFields(
        { name: 'Airport', value: data.airport_name || 'Non spécifié', inline: false },
        { name: 'Stands', value: data.parking_stands || 'Non spécifié', inline: false },
        { name: 'Notes', value: data.notes || 'Aucune note', inline: false }
      )
      .setFooter({ text: 'European Cargo Virtual • Handling Info' })
      .setTimestamp();

    await interaction.editReply({
      content: `✈️ ${user}, here is the information for **${icao}** :`,
      embeds: [embed]
    });

  } catch (err) {
    console.error('❌ /handling Error :', err);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '⚠️ An error occurred while retrieving the data.'
        });
      } else {
        await interaction.reply({
          content: '⚠️ An error occurred while retrieving the data.'
        });
      }
    } catch (e) {
      console.error('Sub-error during interaction response :', e);
    }
  }
}
