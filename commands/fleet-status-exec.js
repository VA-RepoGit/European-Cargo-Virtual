import { EmbedBuilder } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Maintenance thresholds
const THRESHOLDS = { A: 500, B: 1000, C: 4000, D: 20000 };

export async function execute(interaction) {
  try {
    await interaction.deferReply();

    const { data: fleet, error } = await supabase
      .from('aircraft_status')
      .select('*')
      .order('registration', { ascending: true });

    if (error) throw error;

    if (!fleet || fleet.length === 0) {
      return interaction.editReply("📭 No aircraft registered in the maintenance system.");
    }

    const embed = new EmbedBuilder()
      .setTitle("✈️ Fleet Status - European Cargo")
      .setColor("#c90021")
      .setTimestamp()
      .setFooter({ text: "Technical Monitoring System • Lufthansa Technik" });

    let fleetList = "";

    fleet.forEach(ac => {
      // Calculate remaining hours for each threshold
      const nextA = (THRESHOLDS.A - (ac.total_flight_hours % THRESHOLDS.A)).toFixed(1);
      const nextB = (THRESHOLDS.B - (ac.total_flight_hours % THRESHOLDS.B)).toFixed(1);
      const nextC = (THRESHOLDS.C - (ac.total_flight_hours % THRESHOLDS.C)).toFixed(1);
      const nextD = (THRESHOLDS.D - (ac.total_flight_hours % THRESHOLDS.D)).toFixed(1);

      // Determine status emoji and label
      let statusEmoji = "🟢 **OK**";
      let statusLabel = "";

      if (ac.is_aog) {
        statusEmoji = "🔴 **AOG**";
        
        // Détermination du label de maintenance
        // Si aucune check n'est théoriquement due (compteur loin du seuil), c'est une inspection conditionnelle
        const isCheckDue = nextA <= 0.1 || nextB <= 0.1 || nextC <= 0.1 || nextD <= 0.1;
        statusLabel = isCheckDue ? "MAINTENANCE" : "CONDITIONAL INSPECTION";
      } else if (nextA < 50 || nextB < 50 || nextC < 100 || nextD < 500) {
        statusEmoji = "🟠 **CHECK DUE**";
      }

      fleetList += `**${ac.registration}** : \`${ac.total_flight_hours.toFixed(1)}h\`\n`;
      
      if (ac.is_aog && ac.maint_end_at) {
        // Display relative timestamp for maintenance end and the specific status label
        const endTimestamp = Math.floor(new Date(ac.maint_end_at).getTime() / 1000);
        fleetList += `└ Status: ${statusEmoji} | **${statusLabel}** | ⏳ Release: <t:${endTimestamp}:R>\n\n`;
      } else {
        // Affichage des 4 paliers standards
        fleetList += `└ Status: ${statusEmoji} | Next: \`A:${nextA}h\` \`B:${nextB}h\` \`C:${nextC}h\` \`D:${nextD}h\`\n\n`;
      }
    });

    embed.setDescription(fleetList);

    await interaction.editReply({ embeds: [embed] });

  } catch (err) {
    console.error('Error /fleet_status :', err);
    await interaction.editReply("❌ Error while fetching fleet status.");
  }
}
