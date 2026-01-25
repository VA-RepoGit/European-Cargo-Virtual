import { getAircraftStatus, updateAircraftStatus } from '../utils/supabase.js';

export async function execute(interaction) {
  const reg = interaction.options.getString('registration').toUpperCase();
  const type = interaction.options.getString('type');

  try {
    // 1. Récupérer l'état actuel
    const status = await getAircraftStatus(reg);
    let updatedStatus = { ...status };

    // 2. Appliquer le reset selon le type choisi
    // On synchronise la valeur du dernier check avec les heures totales actuelles
    if (type === 'AOG') {
        updatedStatus.is_aog = false;
    } else if (type === 'A') {
        updatedStatus.last_check_a = status.total_flight_hours;
    } else if (type === 'B') {
        updatedStatus.last_check_b = status.total_flight_hours;
    } else if (type === 'C') {
        updatedStatus.last_check_c = status.total_flight_hours;
    } else if (type === 'D') {
        updatedStatus.last_check_d = status.total_flight_hours;
    }

    // 3. Sauvegarder dans Supabase
    await updateAircraftStatus(updatedStatus);

    await interaction.reply({
      content: `✅ **Maintenance Enregistrée**\nAvion : \`${reg}\`\nType : \`${type}\`\nL'avion est de nouveau prêt pour le service.`,
      ephemeral: true
    });

  } catch (err) {
    console.error('Erreur lors du maintenance_reset:', err);
    await interaction.reply({ 
      content: "❌ Une erreur est survenue lors de la mise à jour de la base de données.", 
      ephemeral: true 
    });
  }
}
