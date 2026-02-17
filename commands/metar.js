const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('metar')
        .setDescription('Obtain the METAR for an airport')
        .addStringOption(option =>
            option.setName('icao')
                .setDescription('Airport ICAO')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(4)),

    async execute(interaction) {
        // 1. Récupération de l'ID du salon depuis les variables d'environnement (Render)
        const allowedChannelId = process.env.METAR_CHANNEL_ID;

        // 2. Vérification du salon
        if (interaction.channelId !== allowedChannelId) {
            return interaction.reply({
                content: `❌ This command is only permitted in <#${allowedChannelId}>.`,
                ephemeral: true
            });
        }

        const icao = interaction.options.getString('icao').toUpperCase();

        // Différer la réponse car l'appel API peut prendre plus de 3 secondes
        await interaction.deferReply();

        try {
            // 3. Appel à l'API CheckWX avec Axios
            const response = await axios.get(`https://api.checkwx.com/v2/metar/${icao}`, {
                headers: { 'X-API-Key': process.env.CHECKWX_API_KEY }
            });

            const data = response.data;

            if (data.results > 0) {
                const metarData = data.data[0];

                // 4. Création de l'Embed
                const metarEmbed = new EmbedBuilder()
                    .setTitle(`✈️  Air Weather : ${icao}`)
                    .setDescription(`\`\`\`\n${metarData}\n\`\`\``)
                    .setColor(#c90021) // Rouge
                    .setFooter({ text: 'European Cargo Virtual - Weather Service' })
                    .setTimestamp();

                await interaction.editReply({ embeds: [metarEmbed] });
            } else {
                await interaction.editReply(`⚠️ ICAO code \`${icao}\` not found or METAR unavailable.`);
            }

        } catch (error) {
            console.error('METAR API error:', error);
            await interaction.editReply('⚠️ An error occurred while retrieving weather data.');
        }
    },
};
