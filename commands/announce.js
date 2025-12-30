// commands/announce.js (ES Module)
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('annonce')
  .setDescription('Créer une annonce personnalisée')
  // 🔒 Réservé aux administrateurs uniquement
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option =>
    option.setName('title')
      .setDescription('Titre de ton annonce')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('message')
      .setDescription('Contenu de ton annonce')
      .setRequired(true)
  )
  .addChannelOption(option =>
    option.setName('salon')
      .setDescription('Salon où publier l’annonce')
      .setRequired(true)
      // ✅ Affiche une large gamme de types de salons (text, news, forum, threads, etc.)
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement, // news/announcements
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
        ChannelType.GuildStageVoice,
        ChannelType.GuildVoice
        // Note: catégories (ChannelType.GuildCategory) ne peuvent pas être ciblées pour envoi
      )
  );

export async function execute(interaction) {
  const title = interaction.options.getString('title');
  const announcement = interaction.options.getString('message');
  const targetChannel = interaction.options.getChannel('salon');

  // Vérification : le salon sélectionné accepte-t-il l'envoi de messages ?
  // isTextBased() retourne true pour les channels où .send() fonctionne (text, news, forum, threads)
  if (!targetChannel || typeof targetChannel.isTextBased !== 'function' || !targetChannel.isTextBased()) {
    return interaction.reply({
      content: `❌ Le salon sélectionné (${targetChannel ?? 'inconnu'}) n'accepte pas l'envoi de messages. Choisis un salon textuel, annonces, forum ou thread.`,
      flags: 64
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(announcement)
    .setColor('#c90021')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('confirm')
      .setLabel('✅ Publier')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cancel')
      .setLabel('❌ Annuler')
      .setStyle(ButtonStyle.Danger)
  );

  // ✅ Réponse éphemère : visible uniquement par toi
  await interaction.reply({
    content: `🧐 Voici un aperçu de ton annonce qui sera publiée dans **${targetChannel}** :`,
    embeds: [embed],
    components: [row],
    flags: 64 // EPHEMERAL
  });

  const collector = interaction.channel.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 60000
  });

  collector.on('collect', async (i) => {
    if (i.customId === 'confirm') {
      try {
        await targetChannel.send({ embeds: [embed] });
        await i.update({ content: `✅ Annonce publiée avec succès dans ${targetChannel}.`, components: [] });
      } catch (error) {
        await i.update({ content: `❌ Impossible de publier dans ${targetChannel}.`, components: [] });
        console.error('Erreur publication annonce :', error);
      }
    } else if (i.customId === 'cancel') {
      await i.update({ content: '❌ Annonce annulée.', components: [] });
    }
    collector.stop();
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      await interaction.editReply({ content: '⏰ Temps écoulé, commande annulée.', components: [] });
    }
  });
}
