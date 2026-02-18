import axios from 'axios';

let accessToken = null;
let tokenExpiry = null;

async function getVamsysToken() {
    // Si le token est encore valide, on le réutilise
    if (accessToken && tokenExpiry > Date.now()) return accessToken;

    try {
        const response = await axios.post('https://vamsys.io/oauth/token', {
            grant_type: 'client_credentials',
            client_id: process.env.VAMSYS_CLIENT_ID,
            client_secret: process.env.VAMSYS_CLIENT_SECRET,
            scope: '*' 
        });

        accessToken = response.data.access_token;
        // On expire le token localement 1 min avant la vraie fin pour sécurité
        tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
        return accessToken;
    } catch (error) {
        console.error('[vAMSYS] Failed to fetch Access Token:', error.response?.data || error.message);
        return null;
    }
}

export async function setAircraftVisibility(fleetId, aircraftId, isHidden) {
    const token = await getVamsysToken();
    if (!token) return;

    try {
        await axios.put(
            `https://vamsys.io/api/v3/operations/fleet/${fleetId}/aircraft/${aircraftId}`,
            { hide_in_phoenix: isHidden },
            { 
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                } 
            }
        );
        console.log(`[vAMSYS] Aircraft ${aircraftId} visibility set to: ${isHidden}`);
    } catch (error) {
        console.error(`[vAMSYS] Update Error:`, error.response?.data || error.message);
    }
}
