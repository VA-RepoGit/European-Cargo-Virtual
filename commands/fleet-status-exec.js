import { EmbedBuilder } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function execute(interaction) {
  try {
    await interaction.deferReply();

    const { data: fleet, error } = await supabase
      .from('aircraft_status')
      .select('*')
      .order('registration', { ascending: true });

    if (error) throw error;

    if (!fleet || fleet.length === 0) {
      return interaction.editReply("📭 Aucun avion n'est encore enregistré dans le système de maintenance.");
    }

    const embed = new EmbedBuilder()
      .setTitle("✈️ État de la Flotte - European Cargo")
      .setColor("#c90021")
      .setTimestamp()
      .setFooter({ text: "Système de suivi technique • Lufthansa Technik" });

    let fleetList = "";

    fleet.forEach(ac => {
      const hoursToC = (4000 - (ac.total_flight_hours % 4000)).toFixed(0);
      const statusEmoji = ac.is_aog ? "🔴 **AOG**" : (hoursToC < 100 ? "🟠 **CHECK DUE**" : "🟢 **OK**");
      
      fleetList += `**${ac.registration}** : ${ac.total_flight_hours.toFixed(1)}h\n`;
      fleetList += `└ Statut: ${statusEmoji} | Next Check C: \`${hoursToC}h\`\n\n`;
    });

    embed.setDescription(fleetList);

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    console.error('Erreur /fleet_status :', err);
    await interaction.editReply("❌ Erreur lors de la récupération de l'état de la flotte.");
  }
}
