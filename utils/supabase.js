import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// On exporte l'instance pour qu'elle soit utilisable dans index.js (pour le checker)
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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

// --- FONCTIONS DE MAINTENANCE ---

/**
 * Récupère l'état de maintenance d'un avion par son immatriculation
 */
export async function getAircraftStatus(registration) {
  const { data, error } = await supabase
    .from('aircraft_status')
    .select('*')
    .eq('registration', registration)
    .single();
  
  if (error && error.code !== 'PGRST116') { 
    console.error(`❌ Erreur Supabase getAircraftStatus (${registration}):`, error.message);
  }

  // Retourne l'avion trouvé ou un profil neuf avec les colonnes nécessaires pour l'API v3
  return data || { 
    registration, 
    total_flight_hours: 0, 
    last_check_a: 0, 
    last_check_b: 0, 
    last_check_c: 0, 
    last_check_d: 0, 
    is_aog: false,
    last_pirep_id: null,    // Pour éviter les doublons d'heures
    maint_end_at: null,     // Pour le chrono de maintenance
    fleet_id: null,         // ID de la flotte vAMSYS (requis pour API v3)
    vamsys_internal_id: null // ID interne de l'avion vAMSYS (requis pour API v3)
  };
}

/**
 * Met à jour ou insère l'état complet d'un avion
 */
export async function updateAircraftStatus(statusData) {
  // On utilise upsert avec onConflict sur la colonne registration
  const { error } = await supabase
    .from('aircraft_status')
    .upsert(statusData, { onConflict: 'registration' });

  if (error) {
    console.error(`❌ Erreur Supabase updateAircraftStatus (${statusData.registration}):`, error.message);
  }
}
