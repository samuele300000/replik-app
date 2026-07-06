// Gutschein-System für den Soft-Launch-Test (Fake-Door).
// Zwei Aktionen:
//   { action: 'create', email, notify_opt_in, session_id }
//       → legt (falls für diese E-Mail noch keiner existiert) einen neuen,
//         einmaligen Gutschein an und gibt den Code zurück.
//         Idempotent: Existiert schon ein OFFENER Gutschein für die E-Mail,
//         wird derselbe Code erneut zurückgegeben (kein Duplikat).
//   { action: 'redeem', code, email, session_id }
//       → prüft Code (Status, Ablaufdatum, E-Mail-Bindung) und markiert ihn
//         als eingelöst. Einmalig pro E-Mail-Adresse.
//
// Direkt verteilte Gutscheine (für Testpersonen): einfach Zeilen mit
// email = NULL in die Tabelle einfügen — die E-Mail wird beim Einlösen
// gebunden.
//
// TODO (offen): Gutschein zusätzlich per E-Mail zustellen. Dafür braucht es
// einen E-Mail-Dienst (z.B. Resend, kostenloser Tarif reicht) — sobald der
// eingerichtet ist, hier nach dem Anlegen des Gutscheins den Versand ergänzen.
//
// Benötigte Vercel Environment Variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   VOUCHER_EXPIRES_AT   (optional, ISO-Datum, z.B. "2026-08-31" = Ende Testphase)

const DEFAULT_EXPIRY = '2026-08-31';

function sbHeaders(serviceKey, extra) {
  return {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    ...(extra || {})
  };
}

function generateCode() {
  // Lesbarer Code ohne verwechselbare Zeichen (kein 0/O, 1/I)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `REPLIK-${block()}-${block()}`;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 200;
}

function formatDateCH(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST-Anfragen erlaubt.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen).' });
  }

  const expiresAt = process.env.VOUCHER_EXPIRES_AT || DEFAULT_EXPIRY;
  const { action } = req.body || {};

  try {
    if (action === 'create') {
      const email = String(req.body.email || '').trim().toLowerCase();
      const notifyOptIn = !!req.body.notify_opt_in;
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
      }

      // Existiert schon ein Gutschein für diese E-Mail?
      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/vouchers?email=eq.${encodeURIComponent(email)}&select=code,status`,
        { headers: sbHeaders(serviceKey) }
      );
      const existing = await existingRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        const open = existing.find(v => v.status === 'offen');
        if (open) {
          // Idempotent: denselben offenen Code zurückgeben
          return res.status(200).json({ code: open.code, expires_display: formatDateCH(expiresAt) });
        }
        return res.status(400).json({ error: 'Für diese E-Mail-Adresse wurde bereits ein Gutschein eingelöst (einmalig pro Adresse).' });
      }

      const code = generateCode();
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/vouchers`, {
        method: 'POST',
        headers: sbHeaders(serviceKey, { 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
          code,
          status: 'offen',
          email,
          notify_opt_in: notifyOptIn,
          expires_at: expiresAt
        })
      });
      if (!insertRes.ok) {
        console.error('Voucher-Insert fehlgeschlagen:', await insertRes.text());
        return res.status(500).json({ error: 'Gutschein konnte nicht angelegt werden.' });
      }

      // TODO: Sobald ein E-Mail-Dienst eingerichtet ist, den Code hier
      // zusätzlich an `email` verschicken.
      return res.status(200).json({ code, expires_display: formatDateCH(expiresAt) });
    }

    if (action === 'redeem') {
      const code = String(req.body.code || '').trim().toUpperCase();
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!code || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Bitte gültigen Code und E-Mail-Adresse angeben.' });
      }

      // Einmalig pro E-Mail: Hat diese Adresse schon irgendeinen Gutschein eingelöst?
      const redeemedRes = await fetch(
        `${supabaseUrl}/rest/v1/vouchers?redeemed_email=eq.${encodeURIComponent(email)}&status=eq.eingeloest&select=code`,
        { headers: sbHeaders(serviceKey) }
      );
      const alreadyRedeemed = await redeemedRes.json();
      if (Array.isArray(alreadyRedeemed) && alreadyRedeemed.length > 0) {
        return res.status(400).json({ error: 'Mit dieser E-Mail-Adresse wurde bereits ein Gutschein eingelöst.' });
      }

      // Gutschein laden
      const voucherRes = await fetch(
        `${supabaseUrl}/rest/v1/vouchers?code=eq.${encodeURIComponent(code)}&select=code,status,email,expires_at`,
        { headers: sbHeaders(serviceKey) }
      );
      const rows = await voucherRes.json();
      const voucher = Array.isArray(rows) ? rows[0] : null;

      if (!voucher) {
        return res.status(400).json({ error: 'Dieser Gutscheincode existiert nicht.' });
      }
      if (voucher.status !== 'offen') {
        return res.status(400).json({ error: 'Dieser Gutschein wurde bereits eingelöst.' });
      }
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Dieser Gutschein ist abgelaufen (Testphase beendet).' });
      }
      // Wurde der Gutschein für eine bestimmte E-Mail ausgestellt, muss sie übereinstimmen.
      if (voucher.email && voucher.email !== email) {
        return res.status(400).json({ error: 'Dieser Gutschein ist an eine andere E-Mail-Adresse gebunden.' });
      }

      // Als eingelöst markieren (nur wenn noch offen → verhindert Doppel-Einlösung bei gleichzeitigen Requests)
      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/vouchers?code=eq.${encodeURIComponent(code)}&status=eq.offen`,
        {
          method: 'PATCH',
          headers: sbHeaders(serviceKey, { 'Prefer': 'return=representation' }),
          body: JSON.stringify({
            status: 'eingeloest',
            redeemed_email: email,
            redeemed_at: new Date().toISOString()
          })
        }
      );
      const updated = await updateRes.json();
      if (!updateRes.ok || !Array.isArray(updated) || updated.length === 0) {
        return res.status(400).json({ error: 'Gutschein konnte nicht eingelöst werden (evtl. gerade schon verwendet).' });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion.' });
  } catch (err) {
    return res.status(500).json({ error: 'Fehler: ' + (err.message || String(err)) });
  }
}
