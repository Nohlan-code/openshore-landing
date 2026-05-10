/**
 * Lead Magnet Opt-in Handler
 * - Reçoit email + prénom depuis /guide.html
 * - Push vers Google Sheet via Apps Script Web App
 * - Envoie email avec lien guide via Resend
 *
 * Env vars requises (Vercel) :
 * - GOOGLE_APPS_SCRIPT_URL  : URL du Apps Script déployé en Web App
 * - RESEND_API_KEY          : clé API Resend (re_xxx)
 * - EMAIL_FROM              : optionnel, défaut "Openshore <support@openshore.eu>"
 */

export default async function handler(req, res) {
  // CORS basique (même origin OK, mais juste au cas où)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const { email, prenom = '', source = 'direct', honeypot = '' } = req.body || {};

  // Honeypot anti-bot
  if (honeypot) return res.status(200).json({ ok: true });

  // Validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, message: 'Email invalide' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPrenom = (prenom || '').trim().slice(0, 60);
  const cleanSource = (source || 'direct').trim().slice(0, 40);
  const dateISO = new Date().toISOString();

  const GOOGLE_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'Openshore <onboarding@resend.dev>';

  // ─── 1. Push vers Google Sheet (en parallèle de l'email) ───
  const sheetPromise = GOOGLE_URL
    ? fetch(GOOGLE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          prenom: cleanPrenom,
          source: cleanSource,
          date: dateISO,
        }),
      }).catch((err) => {
        console.error('Google Sheet push failed:', err.message);
        return null;
      })
    : Promise.resolve(null);

  // ─── 2. Envoi email via Resend ───
  const greeting = cleanPrenom ? `${cleanPrenom},` : '';
  const guideUrl = 'https://openshore.eu/guide-contenu.html';
  const pdfUrl = 'https://openshore.eu/le-site-qui-vend.pdf';

  const emailHtml = buildEmailHtml({ greeting, guideUrl, pdfUrl });

  const resendPromise = RESEND_KEY
    ? fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [cleanEmail],
          subject: 'Ton guide "Le Site Qui Vend" est prêt ✦',
          html: emailHtml,
          reply_to: 'support@openshore.eu',
        }),
      }).catch((err) => {
        console.error('Resend send failed:', err.message);
        return null;
      })
    : Promise.resolve(null);

  // ─── 3. Attendre les deux (mais on succède si au moins l'email a marché) ───
  const [sheetRes, resendRes] = await Promise.all([sheetPromise, resendPromise]);

  const sheetOk = sheetRes && sheetRes.ok;
  const emailOk = resendRes && resendRes.ok;

  // Log pour debug
  console.log(`Lead: ${cleanEmail} · Sheet: ${sheetOk ? 'ok' : 'fail'} · Email: ${emailOk ? 'ok' : 'fail'}`);

  // Si email échoué mais sheet OK → on accepte quand même (le lead est capturé, on peut renvoyer à la main)
  // Si tout a échoué → on retourne une erreur pour que le form affiche un message
  if (!sheetOk && !emailOk) {
    return res.status(500).json({
      ok: false,
      message: 'Erreur d\'envoi. Réessaie ou écris à support@openshore.eu',
    });
  }

  return res.status(200).json({
    ok: true,
    sheet: sheetOk,
    email: emailOk,
    guideUrl,
    pdfUrl,
  });
}

// ─── Template email HTML ───
function buildEmailHtml({ greeting, guideUrl, pdfUrl }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Ton guide Openshore</title>
</head>
<body style="margin:0; padding:0; background:#f5f2ee; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#0f0b09;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f2ee; padding:40px 16px;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(15,11,9,.08);">
        <!-- Header noir -->
        <tr>
          <td style="background:#0f0b09; padding:28px 32px; text-align:center;">
            <div style="font-size:18px; font-weight:800; color:#f5f2ee; letter-spacing:-.01em;">
              Open<span style="color:#F47B3B;">shore</span>
            </div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:48px 40px 16px;">
            <div style="font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:#F47B3B; font-weight:700; margin-bottom:20px;">
              ✦ Ton Guide est Prêt
            </div>
            <h1 style="font-family:Georgia,serif; font-size:42px; line-height:1.05; font-weight:400; color:#0f0b09; margin:0 0 20px; letter-spacing:-.02em;">
              Salut${greeting ? ' ' + greeting : ''}<br>voici <em style="color:#F47B3B;">Le Site Qui Vend.</em>
            </h1>
            <p style="font-size:16px; color:#444; line-height:1.65; margin:0 0 28px;">
              Comme promis : 7 fondamentaux d'un site qui convertit, le framework qu'on applique sur tous les projets Openshore.
            </p>
            <p style="font-size:16px; color:#444; line-height:1.65; margin:0 0 32px;">
              <strong style="color:#0f0b09;">Lecture : 10 minutes.</strong> Application : dès cette semaine.
            </p>

            <!-- CTA principal -->
            <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 16px;">
              <tr>
                <td style="background:#F47B3B; border-radius:12px;">
                  <a href="${guideUrl}" style="display:inline-block; padding:16px 32px; color:#fff; font-weight:700; font-size:15px; text-decoration:none; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                    Lire le guide en ligne →
                  </a>
                </td>
              </tr>
            </table>

            <!-- CTA PDF secondaire -->
            <p style="text-align:center; margin:0 0 32px;">
              <a href="${pdfUrl}" style="font-size:13px; color:#666; text-decoration:underline;">ou télécharger la version PDF</a>
            </p>
          </td>
        </tr>

        <!-- Sommaire -->
        <tr>
          <td style="padding:0 40px 32px;">
            <div style="background:#f5f2ee; border-radius:12px; padding:24px;">
              <div style="font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:#F47B3B; font-weight:700; margin-bottom:14px;">
                Au sommaire
              </div>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">01</strong>La promesse en 3 secondes</td></tr>
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">02</strong>Le bouton qui vend</td></tr>
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">03</strong>La preuve qui rassure</td></tr>
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">04</strong>La friction qui tue</td></tr>
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">05</strong>Le pricing qui ferme</td></tr>
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">06</strong>La structure qui guide</td></tr>
                <tr><td style="padding:6px 0; font-size:14px; color:#0f0b09;"><strong style="color:#F47B3B; margin-right:10px;">07</strong>Le mobile qui convertit</td></tr>
                <tr><td style="padding:10px 0 6px; font-size:13px; color:#666;"><em>+ Bonus : checklist 25 critères imprimable</em></td></tr>
              </table>
            </div>
          </td>
        </tr>

        <!-- Signature -->
        <tr>
          <td style="padding:0 40px 40px;">
            <p style="font-size:14px; color:#444; line-height:1.65; margin:0 0 12px;">
              Si une décision te bloque ou tu veux qu'on l'applique direct sur ton site, réponds à ce mail. Je lis tout perso.
            </p>
            <p style="font-size:14px; color:#0f0b09; margin:0; font-weight:600;">
              Nohlan · Openshore<br>
              <span style="font-weight:400; color:#666; font-size:13px;">openshore.eu</span>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f5f2ee; padding:20px 40px; text-align:center; font-size:11px; color:#888; border-top:1px solid #e8e5e0;">
            <span style="color:#F47B3B;">✦</span> Openshore — SIREN 928613520<br>
            <a href="https://openshore.eu" style="color:#888; text-decoration:underline;">openshore.eu</a>
            ·
            <a href="mailto:support@openshore.eu" style="color:#888; text-decoration:underline;">support@openshore.eu</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
