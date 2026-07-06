// Funnel-Tracking für den Soft-Launch-Test (Fake-Door).
// Nimmt Events vom Frontend entgegen und schreibt sie in die Supabase-Tabelle
// "funnel_events" — mit dem SERVICE ROLE KEY, der NUR hier auf dem Server
// existiert (Vercel Environment Variable), nie im Browser.
//
// Benötigte Vercel Environment Variables:
//   SUPABASE_URL                z.B. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   aus Supabase → Settings → API Keys → Secret keys

// Whitelist: nur bekannte Event-Namen werden gespeichert, damit niemand
// die Tabelle mit Müll fluten kann.
const ALLOWED_EVENTS = new Set([
  'tutorial_gestartet',
  'eigenes_skript_upload_versucht',
  'preis_angezeigt',
  'kaufen_geklickt',
  'email_erfasst',
  'absage_nachricht_angezeigt',
  'gutschein_angezeigt',
  'gutschein_eingeloest',
  'skript_freigeschaltet_genutzt',
  'launch_benachrichtigung_opt_in'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST-Anfragen erlaubt.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen).' });
  }

  const { event, session_id, utm_source, utm_medium, utm_campaign, segment, price_variant, extra } = req.body || {};

  if (!event || !ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: 'Unbekanntes Event.' });
  }
  if (!session_id || typeof session_id !== 'string' || session_id.length > 100) {
    return res.status(400).json({ error: 'Ungültige Session-ID.' });
  }

  const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/funnel_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        event_name: event,
        session_id: clip(session_id, 100),
        utm_source: clip(utm_source, 100),
        utm_medium: clip(utm_medium, 100),
        utm_campaign: clip(utm_campaign, 100),
        segment: clip(segment, 100),
        price_variant: clip(price_variant, 10),
        extra: extra && typeof extra === 'object' ? extra : null
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase insert fehlgeschlagen:', errText);
      return res.status(500).json({ error: 'Event konnte nicht gespeichert werden.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Fehler: ' + (err.message || String(err)) });
  }
}
