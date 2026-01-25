import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- FONCTIONS RSS EXISTANTES ---

export async function isArticlePosted(id) {
  const { data, error } = await supabase
    .from('posted_articles')
    .select('id')
    .eq('id', id)
    .single();

  return !!data;
}

export async function markArticleAsPosted({ id, title, link, published }) {
  const { error } = await supabase.from('posted_articles').insert([
    {
      id,
      title,
      link,
      published,
    }
  ]);

  if (error) {
    console.error('Erreur lors de l\'insertion de l\'article :', error.message);
  }
}

// --- NOUVELLES FONCTIONS DE MAINTENANCE ---

/**
 * Récupère l'état de maintenance d'un avion par son immatriculation
 */
export async function getAircraftStatus(registration) {
  const { data, error } = await supabase
    .from('aircraft_status')
    .select('*')
    .eq('registration', registration)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = ligne non trouvée (normal pour un nouvel avion)
    console.error(`❌ Erreur Supabase getAircraftStatus (${registration}):`, error.message);
  }

  // Si l'avion n'existe pas, on retourne un objet par défaut (Supabase utilisera les "Default Values" à l'insertion)
  return data || { 
    registration, 
    total_flight_hours: 0, 
    last_check_a: 0, 
    last_check_b: 0, 
    last_check_c: 0, 
    last_check_d: 0, 
    is_aog: false 
  };
}

/**
 * Met à jour ou insère l'état complet d'un avion
 */
export async function updateAircraftStatus(statusData) {
  const { error } = await supabase
    .from('aircraft_status')
    .upsert([statusData], { onConflict: 'registration' });

  if (error) {
    console.error(`❌ Erreur Supabase updateAircraftStatus (${statusData.registration}):`, error.message);
  }
}
