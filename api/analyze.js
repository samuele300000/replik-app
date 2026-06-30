// Diese Funktion läuft auf dem Server, nicht im Browser. Der Browser sieht
// niemals den eigentlichen API-Key - er ruft nur diese Adresse auf (/api/analyze),
// und diese Funktion fügt den geheimen Key hinzu, bevor sie an Anthropic weiterleitet.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST-Anfragen erlaubt.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server ist nicht korrekt konfiguriert (kein API-Key hinterlegt).' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Weiterleiten an Anthropic: ' + (err.message || String(err)) });
  }
}
