// webhook-server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // version CJS (v2.x)
const { setTimeout: wait } = require('timers/promises');

const app = express();
app.use(express.json());

// 📂 Fichier de log
const logFile = path.resolve('./webhook.log');
function logToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, 'utf8');
}

// IPs autorisées
const allowedIps = ['85.236.153.138', '5.196.68.13', '172.27.0.1', '127.0.0.1', '202.61.204.128', '81.169.213.163'];

// Fichier JSON map public_key -> callback URL
const webhookMapPath = path.resolve('./webhook-map.json');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Lecture webhookMap
function loadWebhookMap() {
  try {
    const raw = fs.readFileSync(webhookMapPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const msg = `Erreur lecture webhook-map.json : ${err.message}`;
    console.error(msg);
    logToFile(`❌ ${msg}`);
    return {};
  }
}

// Appel POST avec retry + log détaillé
async function postWithRetry(url, data, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logToFile(`🔹 Tentative ${attempt} POST vers ${url} `);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const text = await response.text(); // Récupère la réponse brute
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = text; // si ce n'est pas JSON, on garde le texte
      }

      const logResp = `✅ Réponse de Symfony pour ${url} (HTTP ${response.status}): ${JSON.stringify(json)}`;
      console.log(logResp);
      logToFile(logResp);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return json;
    } catch (err) {
      const msg = `❌ Tentative ${attempt} échouée pour ${url} : ${err.message}`;
      console.warn(msg);
      logToFile(msg);

      if (attempt < retries) {
        const retryMsg = `⏳ Nouvelle tentative dans ${RETRY_DELAY_MS / 1000}s...`;
        console.log(retryMsg);
        logToFile(retryMsg);
        await wait(RETRY_DELAY_MS);
      } else {
        throw err;
      }
    }
  }
}

// Logs serveur
app.get('/logs', (req, res) => {
  try {
    const logs = fs.readFileSync(logFile, 'utf8');
    res.type('text/plain').send(logs);
  } catch (err) {
    res.status(500).send('Impossible de lire les logs');
  }
});



// Endpoint pour vider les logs
// Endpoint pour vider les logs
app.post('/logs/clear', (req, res) => {
  try {
	const logFile = path.resolve(__dirname, 'webhook.log');
    fs.writeFileSync(logFile, '', 'utf8'); // Vide le fichier
    const msg = '📂 Logs vidés avec succès';
    console.log(msg);
    logToFile(msg); // Optionnel : log de l’action
    res.json({ status: 'ok', message: 'Logs vidés' });
  } catch (err) {
    const errorMsg = `❌ Impossible de vider les logs : ${err.message}`;
    console.error(errorMsg);
    res.status(500).json({ error: errorMsg });
  }
});



// Endpoint IPN
app.post('/payment-ipn', async (req, res) => {
  const remoteIp = req.ip.replace('::ffff:', '');
  logToFile(`📩 Nouvelle requête IPN de ${remoteIp} : ${JSON.stringify(req.body)}`);

  // Vérification IP
  if (!allowedIps.includes(remoteIp)) {
    const msg = `IP non autorisée: ${remoteIp}`;
    console.warn(msg);
    logToFile(`❌ ${msg}`);
    return res.status(403).json({ error: 'IP non autorisée', ip: remoteIp });
  }

  const data = req.body;
  const publicKey = (data.public_key || "").trim();

  // Vérification public_key
  if (!publicKey) {
    logToFile(`⚠️ Requête sans public_key depuis ${remoteIp}`);
    return res.status(400).json({ error: 'public_key manquant' });
  }

  const webhookMap = loadWebhookMap();
  const callbackUrl = webhookMap[publicKey];

//  logToFile(`Payload public_key: ${publicKey}`);
//  logToFile(`Clés disponibles dans webhookMap: ${Object.keys(webhookMap).join(', ')}`);

  if (!callbackUrl) {
    const msg = `public_key inconnu: ${publicKey}`;
    console.warn(msg);
    logToFile(`❌ ${msg}`);
    return res.status(403).json({ error: 'public_key inconnu' });
  }

  try {
    const result = await postWithRetry(callbackUrl, data);
    const successMsg = `✅ Webhook traité avec succès sur ${callbackUrl}`;
    console.log(successMsg);
    logToFile(successMsg);

    res.json({
      status: 'ok',
      forwardedTo: callbackUrl,
      responseFromSymfony: result,
    });
  } catch (err) {
    const errorMsg = `❌ Impossible de contacter ${callbackUrl} : ${err.message}`;
    console.error(errorMsg);
    logToFile(errorMsg);
    res.status(500).json({ error: 'Impossible de contacter Symfony après 3 tentatives' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const startMsg = `🚀 Webhook listener Node.js démarré sur http://localhost:${PORT}`;
  console.log(startMsg);
  logToFile(startMsg);
});
