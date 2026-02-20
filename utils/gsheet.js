import fetch from 'node-fetch';

/**
 * Envoie les données de maintenance au Google Sheet vURO
 * @param {string} reg - Immatriculation (ex: G-ECLB)
 * @param {string} check - Type de check (A, B, C, D) ou "Active" pour la sortie
 * @param {string} rts - Date de retour formatée (ou vide pour la sortie)
 */
export async function updateGSheet(reg, check, rts = "") {
  const url = process.env.VURO_SHEET;
  
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reg, check, rts })
    });
    console.log(`✅ Google Sheet mis à jour pour ${reg} (${check})`);
  } catch (error) {
    console.error(`❌ Erreur synchro Google Sheet pour ${reg}:`, error);
  }
}
