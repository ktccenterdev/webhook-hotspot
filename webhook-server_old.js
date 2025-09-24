// webhook-server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // version CJS (v2.x) recommandée
const { setTimeout: wait } = require('timers/promises');

const app = express();
app.use(express.json());

// IPs autorisées (Paymooney)
const allowedIps = ['85.236.153.138', '5.196.68.13', '172.27.0.1', '127.0.0.1'];

// Chemin du fichier JSON contenant la map sign_token -> callback URL
const webhookMapPath = path.resolve('./webhook-map.json');

// Nombre de retry en cas d’échec
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 secondes entre chaque retry

// Fonction pour lire le fichier JSON
function loadWebhookMap() {
  try {
    const raw = fs.readFileSync(webhookMapPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erreur lecture webhook-map.json :', err);
    return {};
  }
}

// Fonction d’appel avec retry
async function postWithRetry(url, data, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.warn(`Tentative ${attempt} échouée pour ${url} : ${err.message}`);
      if (attempt < retries) {
        console.log(`Nouvelle tentative dans ${RETRY_DELAY_MS / 1000}s...`);
        await wait(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
}

app.post('/payment-ipn', async (req, res) => {
  const remoteIp = req.ip.replace('::ffff:', '');
  if (!allowedIps.includes(remoteIp)) {
    console.warn(`IP non autorisée: ${remoteIp}`);
    return res.status(403).json({ error: 'IP non autorisée', ip: remoteIp });
  }

  const data = req.body;
  const signToken = data.sign_token;
  if (!signToken) {
    return res.status(400).json({ error: 'sign_token manquant' });
  }

  const webhookMap = loadWebhookMap();
  const callbackUrl = webhookMap[signToken];

  if (!callbackUrl) {
    console.warn(`sign_token inconnu: ${signToken}`);
    return res.status(403).json({ error: 'sign_token inconnu' });
  }

  try {
    const result = await postWithRetry(callbackUrl, data);
    console.log(`✅ Webhook traité avec succès pour ${signToken} -> ${callbackUrl}`);
    res.json({
      status: 'ok',
      forwardedTo: callbackUrl,
      responseFromSymfony: result,
    });
  } catch (err) {
    console.error(`❌ Impossible de contacter ${callbackUrl} : ${err.message}`);
    res.status(500).json({ error: 'Impossible de contacter Symfony après retries' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener Node.js démarré sur http://localhost:${PORT}`);
});
