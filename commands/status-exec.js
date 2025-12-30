export async function execute(interaction) {
  const status = interaction.options.getString('etat');
  const message = interaction.options.getString('message');
  const type = parseInt(interaction.options.getString('type')) || 0;

  try {
    await interaction.client.user.setPresence({
      status: status,
      activities: [{ name: message, type }]
    });

    // ✅ Réponse éphemère sans warning
    await interaction.reply({
      content: `✅ Le statut du bot a été mis à jour : **${status}** — "${message}"`,
      flags: 64 // EPHEMERAL
    });
  } catch (err) {
    console.error('❌ Erreur lors du changement de statut :', err);
    await interaction.reply({
      content: '❌ Une erreur est survenue lors du changement de statut.',
      flags: 64 // EPHEMERAL
    });
  }
}
