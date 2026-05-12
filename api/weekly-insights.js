/**
 * Openshore Weekly AI Insights
 * ─────────────────────────────
 * Runs every Monday 09:00 Paris time (Vercel Cron).
 *
 * Pipeline:
 *   1. Pull PostHog events for last 7 days (Query API / HogQL)
 *   2. Compute funnels, drop-offs, top sources, conversion rates
 *   3. Send structured summary to Claude Sonnet 4.6
 *   4. Claude returns 3 prioritized recos + 1 alert + 1 hypothesis to test
 *   5. Email digest via Resend to recipient
 *
 * Env vars required (see ANALYTICS-SETUP.md for details):
 *   POSTHOG_PERSONAL_API_KEY  — personal API key from PostHog (read-only project scope)
 *   POSTHOG_PROJECT_ID        — numeric project ID
 *   POSTHOG_HOST              — default https://eu.i.posthog.com
 *   ANTHROPIC_API_KEY         — Anthropic API key
 *   RESEND_API_KEY            — Resend API key (already used by lead-magnet)
 *   CRON_SECRET               — random string for auth (must match ?secret= query)
 *   INSIGHTS_RECIPIENT        — default fallback if not set
 */

const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';
const ANTHROPIC_HOST = 'https://api.anthropic.com';
const MODEL = 'claude-sonnet-4-6';
const RECIPIENT_DEFAULT = 'pounganohlan@gmail.com';

export default async function handler(req, res) {
  // ─── Auth: only allow Vercel Cron or matching secret ───
  const secret = process.env.CRON_SECRET;
  const provided = req.query.secret || req.headers['x-cron-secret'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (!isVercelCron && (!secret || provided !== secret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const startedAt = Date.now();
  console.log('[weekly-insights] starting…');

  try {
    const data = await pullPostHogData();
    console.log('[weekly-insights] data pulled', Object.keys(data));

    const aiResponse = await askClaude(data);
    console.log('[weekly-insights] AI responded');

    const recipient = process.env.INSIGHTS_RECIPIENT || RECIPIENT_DEFAULT;
    await sendEmail(recipient, aiResponse, data);
    console.log('[weekly-insights] email sent to', recipient);

    return res.status(200).json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      recipient,
      summary: aiResponse.summary,
    });
  } catch (err) {
    console.error('[weekly-insights] FAILED:', err.message, err.stack);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── PostHog data pulling ───────────────────────────
async function pullPostHogData() {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!projectId || !apiKey) {
    throw new Error('POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY required');
  }

  const q = async (hogql) => {
    const r = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`PostHog query failed (${r.status}): ${text.slice(0, 200)}`);
    }
    const json = await r.json();
    return json.results || [];
  };

  const pageViews = await q(`
    SELECT properties.$page AS page, count() AS views
    FROM events
    WHERE event = 'page_view' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY page
    ORDER BY views DESC
    LIMIT 20
  `);

  const referrers = await q(`
    SELECT properties.$referrer AS referrer, count() AS visits
    FROM events
    WHERE event = 'page_view' AND timestamp > now() - INTERVAL 7 DAY AND referrer IS NOT NULL AND referrer != ''
    GROUP BY referrer
    ORDER BY visits DESC
    LIMIT 10
  `);

  const ctaClicks = await q(`
    SELECT event, count() AS clicks
    FROM events
    WHERE event LIKE 'cta_%' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY event
    ORDER BY clicks DESC
  `);

  const scrollDepth = await q(`
    SELECT properties.depth_pct AS depth, count() AS hits
    FROM events
    WHERE event = 'scroll_depth' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY depth
    ORDER BY depth ASC
  `);

  const sectionViews = await q(`
    SELECT event, count() AS views
    FROM events
    WHERE event LIKE 'section_%_viewed' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY event
    ORDER BY views DESC
  `);

  const conversions = await q(`
    SELECT event, count() AS count
    FROM events
    WHERE event IN ('lead_magnet_submitted', 'checkout_initiated', 'checkout_completed', 'form_submitted')
      AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY event
  `);

  const friction = await q(`
    SELECT event, count() AS count
    FROM events
    WHERE event IN ('rage_click', 'dead_click', 'js_error')
      AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY event
  `);

  const rageTargets = await q(`
    SELECT properties.text AS text, properties.id AS id, count() AS rages
    FROM events
    WHERE event = 'rage_click' AND timestamp > now() - INTERVAL 7 DAY
    GROUP BY text, id
    ORDER BY rages DESC
    LIMIT 5
  `);

  const uniques = await q(`
    SELECT count(DISTINCT distinct_id) AS unique_visitors
    FROM events
    WHERE event = 'page_view' AND timestamp > now() - INTERVAL 7 DAY
  `);

  const prevWeek = await q(`
    SELECT count(DISTINCT distinct_id) AS unique_visitors_prev
    FROM events
    WHERE event = 'page_view'
      AND timestamp > now() - INTERVAL 14 DAY
      AND timestamp <= now() - INTERVAL 7 DAY
  `);

  return {
    pageViews,
    referrers,
    ctaClicks,
    scrollDepth,
    sectionViews,
    conversions,
    friction,
    rageTargets,
    uniques: uniques[0] || { unique_visitors: 0 },
    prevWeek: prevWeek[0] || { unique_visitors_prev: 0 },
    period: { from: daysAgo(7), to: new Date().toISOString().slice(0, 10) },
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Claude API ─────────────────────────────────────
async function askClaude(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');

  const prompt = buildPrompt(data);

  const r = await fetch(`${ANTHROPIC_HOST}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: 'Tu es un consultant CRO senior pour Openshore (agence création site web qui convertit, 60+ projets, pricing 470/770/1970€). Tu analyses la data analytics hebdo et donnes des recommandations actionnables. Sois brutal, factuel, jamais creux. Refuse de spéculer sans data. Réponds STRICTEMENT au format JSON demandé.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Claude API failed (${r.status}): ${text.slice(0, 300)}`);
  }

  const json = await r.json();
  const text = json.content?.[0]?.text || '';

  const m = text.match(/```json\s*([\s\S]+?)\s*```/) || text.match(/\{[\s\S]+\}/);
  if (!m) throw new Error('Claude response not JSON: ' + text.slice(0, 200));

  try {
    return JSON.parse(m[1] || m[0]);
  } catch (e) {
    throw new Error('Claude JSON parse failed: ' + e.message);
  }
}

function buildPrompt(data) {
  const { uniques, prevWeek, pageViews, referrers, ctaClicks, scrollDepth, sectionViews, conversions, friction, rageTargets, period } = data;

  const unique = uniques.unique_visitors || 0;
  const prev = prevWeek.unique_visitors_prev || 0;
  const wow = prev > 0 ? Math.round(((unique - prev) / prev) * 100) : null;

  return `Analyse les données analytics openshore.eu pour la semaine du ${period.from} au ${period.to}.

## Trafic
- Visiteurs uniques cette semaine : ${unique}
- Visiteurs uniques semaine précédente : ${prev}
- Variation : ${wow === null ? 'N/A (pas de baseline)' : wow + '%'}

## Pages vues
${formatRows(pageViews, ['page', 'views'])}

## Sources de trafic (referrers)
${formatRows(referrers, ['referrer', 'visits'])}

## Clics sur CTAs
${formatRows(ctaClicks, ['event', 'clicks'])}

## Profondeur de scroll (% atteint)
${formatRows(scrollDepth, ['depth', 'hits'])}

## Sections vues (visibilité 50%+)
${formatRows(sectionViews, ['event', 'views'])}

## Conversions
${formatRows(conversions, ['event', 'count'])}

## Signaux de friction
${formatRows(friction, ['event', 'count'])}

## Top cibles de rage clicks (clics frustrés)
${formatRows(rageTargets, ['text', 'id', 'rages'])}

---

Réponds STRICTEMENT en JSON dans ce format exact :

\`\`\`json
{
  "summary": "1 phrase de synthèse de la semaine, max 200 caractères",
  "wow_trend": "growing|stable|declining",
  "recommendations": [
    {
      "priority": 1,
      "title": "Titre court de la reco",
      "rationale": "Pourquoi cette reco basée sur la data (cite les chiffres)",
      "action": "Action concrète à faire cette semaine (max 200 char)",
      "expected_impact": "Quel KPI tu attends que ça bouge et de combien"
    }
  ],
  "alert": {
    "severity": "high|medium|low|none",
    "issue": "Anomalie ou problème détecté dans la data (ou 'aucune' si rien)",
    "evidence": "Les chiffres précis qui le montrent"
  },
  "hypothesis_to_test": {
    "claim": "Une hypothèse business à tester la semaine prochaine",
    "test": "Comment la tester concrètement (A/B, changement de copy, etc.)",
    "min_sample_required": "Combien de visiteurs/conversions nécessaires pour conclure"
  }
}
\`\`\`

Règles :
- Si trafic < 50 visiteurs/semaine, ne propose JAMAIS d'A/B test (volume insuffisant)
- Si data trop pauvre pour une reco, dis-le explicitement plutôt que d'inventer
- Toutes les recos doivent citer des chiffres précis de la data
- Ordre des recos par impact attendu, pas par effort
- Maximum 3 recos
- Pas de bullshit ("optimiser l'engagement"), être chirurgical`;
}

function formatRows(rows, cols) {
  if (!rows || rows.length === 0) return '(aucune donnée)';
  return rows.map((row) => {
    return '- ' + cols.map((c, i) => row[c] !== undefined ? row[c] : row[i]).join(' : ');
  }).join('\n');
}

// ─── Email digest ───────────────────────────────────
async function sendEmail(to, aiResponse, data) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY required');

  const from = process.env.EMAIL_FROM || 'Openshore Insights <onboarding@resend.dev>';
  const subject = `📊 Openshore Insights — ${aiResponse.summary?.slice(0, 60) || 'Semaine analysée'}`;
  const html = buildEmailHtml(aiResponse, data);

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html, reply_to: 'support@openshore.eu' }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Resend failed (${r.status}): ${text.slice(0, 200)}`);
  }
  return r.json();
}

function buildEmailHtml(ai, data) {
  const recs = (ai.recommendations || []).map((r) => `
    <div style="margin-bottom:24px;padding:18px;background:#f5f2ee;border-left:3px solid #F47B3B;border-radius:4px">
      <div style="font-size:11px;color:#F47B3B;font-weight:700;letter-spacing:.1em;margin-bottom:6px">PRIORITÉ ${escapeHtml(String(r.priority || 1))}</div>
      <div style="font-size:18px;font-weight:600;color:#0f0b09;margin-bottom:8px">${escapeHtml(r.title || '')}</div>
      <div style="font-size:14px;color:#444;margin-bottom:10px;line-height:1.6">${escapeHtml(r.rationale || '')}</div>
      <div style="font-size:13px;color:#0f0b09;background:#fff;padding:10px 12px;border-radius:6px;margin-bottom:8px"><b>→ À faire :</b> ${escapeHtml(r.action || '')}</div>
      <div style="font-size:12px;color:#777"><b>Impact attendu :</b> ${escapeHtml(r.expected_impact || '')}</div>
    </div>
  `).join('');

  const alert = ai.alert && ai.alert.severity !== 'none' ? `
    <div style="margin:24px 0;padding:16px;background:${alertBg(ai.alert.severity)};border-radius:8px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${alertColor(ai.alert.severity)};margin-bottom:6px">⚠ Alerte ${escapeHtml(ai.alert.severity || '')}</div>
      <div style="font-size:14px;color:#0f0b09;margin-bottom:6px"><b>${escapeHtml(ai.alert.issue || '')}</b></div>
      <div style="font-size:13px;color:#444">${escapeHtml(ai.alert.evidence || '')}</div>
    </div>
  ` : '';

  const hyp = ai.hypothesis_to_test ? `
    <div style="margin-top:32px;padding:18px;background:#0f0b09;color:#f5f2ee;border-radius:8px">
      <div style="font-size:11px;color:#F47B3B;font-weight:700;letter-spacing:.1em;margin-bottom:8px">HYPOTHÈSE À TESTER</div>
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">${escapeHtml(ai.hypothesis_to_test.claim || '')}</div>
      <div style="font-size:13px;color:#bbb;margin-bottom:6px"><b>Comment tester :</b> ${escapeHtml(ai.hypothesis_to_test.test || '')}</div>
      <div style="font-size:12px;color:#888"><b>Volume requis :</b> ${escapeHtml(ai.hypothesis_to_test.min_sample_required || '')}</div>
    </div>
  ` : '';

  const unique = data.uniques?.unique_visitors || 0;
  const prev = data.prevWeek?.unique_visitors_prev || 0;
  const wow = prev > 0 ? Math.round(((unique - prev) / prev) * 100) : null;
  const trendIcon = ai.wow_trend === 'growing' ? '↗' : ai.wow_trend === 'declining' ? '↘' : '→';

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ebe5dc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:0 auto;background:#fff">
  <div style="background:#0f0b09;color:#fff;padding:32px 32px 28px">
    <div style="font-size:11px;color:#F47B3B;letter-spacing:.2em;font-weight:700;margin-bottom:8px">✦ OPENSHORE INSIGHTS</div>
    <div style="font-family:Georgia,serif;font-size:28px;line-height:1.2;font-weight:400;letter-spacing:-.01em">${escapeHtml(ai.summary || 'Rapport hebdo')}</div>
  </div>
  <div style="padding:28px 32px;border-bottom:1px solid #eee">
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      <div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em">Visiteurs</div><div style="font-size:22px;font-weight:700;color:#0f0b09;margin-top:2px">${unique}</div></div>
      <div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em">vs semaine -1</div><div style="font-size:22px;font-weight:700;color:#0f0b09;margin-top:2px">${trendIcon} ${wow === null ? 'N/A' : wow + '%'}</div></div>
      <div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em">Tendance</div><div style="font-size:14px;font-weight:600;color:#0f0b09;margin-top:6px;text-transform:uppercase">${escapeHtml(ai.wow_trend || 'stable')}</div></div>
    </div>
  </div>
  <div style="padding:32px">
    <div style="font-size:11px;color:#F47B3B;font-weight:700;letter-spacing:.15em;margin-bottom:16px">RECOMMANDATIONS</div>
    ${recs || '<div style="color:#888">Aucune recommandation cette semaine.</div>'}
    ${alert}
    ${hyp}
  </div>
  <div style="padding:20px 32px;background:#f5f2ee;font-size:11px;color:#888;text-align:center;border-top:1px solid #e8e3dc">
    Généré par Claude Sonnet 4.6 · Période : ${escapeHtml(data.period?.from || '')} → ${escapeHtml(data.period?.to || '')}<br>
    <a href="https://eu.posthog.com" style="color:#888">Voir le dashboard PostHog</a>
  </div>
</div></body></html>`;
}

function alertBg(s) {
  return s === 'high' ? '#fef2f2' : s === 'medium' ? '#fffbeb' : '#f0f9ff';
}
function alertColor(s) {
  return s === 'high' ? '#b91c1c' : s === 'medium' ? '#a16207' : '#075985';
}
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
