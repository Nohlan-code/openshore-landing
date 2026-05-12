/**
 * Openshore Dashboard Data Endpoint
 * ───────────────────────────────────
 * Returns aggregated PostHog metrics for /insights dashboard.
 *
 * Auth: ?secret=CRON_SECRET (same as weekly-insights endpoint).
 *
 * Period: configurable via ?days=7 (default 7, max 90).
 */

const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';

export default async function handler(req, res) {
  // Auth
  const secret = process.env.CRON_SECRET;
  const provided = req.query.secret || req.headers['x-cron-secret'];
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // CORS for same-origin AJAX from /insights.html
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const days = Math.min(parseInt(req.query.days || '7', 10) || 7, 90);
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;

  if (!projectId || !apiKey) {
    return res.status(500).json({ error: 'PostHog env vars missing' });
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

  try {
    const [
      uniques,
      uniquesPrev,
      pageViews,
      referrers,
      ctaClicks,
      scrollDepth,
      sectionViews,
      conversions,
      friction,
      rageTargets,
      dailyVisitors,
      topSessions,
      formStartedCount,
      formStartedByForm,
      vslPlays,
      guidePageViews,
      homePageViews,
      packViewsRaw,
      packClicksRaw,
    ] = await Promise.all([
      q(`SELECT count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'page_view' AND timestamp > now() - INTERVAL ${days} DAY`),
      q(`SELECT count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'page_view' AND timestamp > now() - INTERVAL ${days * 2} DAY AND timestamp <= now() - INTERVAL ${days} DAY`),
      q(`SELECT properties.$page AS page, count() AS views, count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'page_view' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY page ORDER BY views DESC LIMIT 15`),
      q(`SELECT properties.$referrer AS referrer, count() AS visits FROM events WHERE event = 'page_view' AND timestamp > now() - INTERVAL ${days} DAY AND referrer IS NOT NULL AND referrer != '' AND referrer != '$direct' GROUP BY referrer ORDER BY visits DESC LIMIT 10`),
      q(`SELECT event, count() AS clicks FROM events WHERE event LIKE 'cta_%' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY event ORDER BY clicks DESC`),
      q(`SELECT properties.depth_pct AS depth, count() AS hits FROM events WHERE event = 'scroll_depth' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY depth ORDER BY depth ASC`),
      q(`SELECT event, count() AS views FROM events WHERE event LIKE 'section_%_viewed' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY event ORDER BY views DESC`),
      q(`SELECT event, count() AS count FROM events WHERE event IN ('lead_magnet_submitted', 'checkout_initiated', 'checkout_completed', 'form_submitted') AND timestamp > now() - INTERVAL ${days} DAY GROUP BY event`),
      q(`SELECT event, count() AS count FROM events WHERE event IN ('rage_click', 'dead_click', 'js_error') AND timestamp > now() - INTERVAL ${days} DAY GROUP BY event`),
      q(`SELECT properties.text AS text, count() AS rages FROM events WHERE event = 'rage_click' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY text ORDER BY rages DESC LIMIT 5`),
      q(`SELECT toDate(timestamp) AS day, count(DISTINCT distinct_id) AS visitors FROM events WHERE event = 'page_view' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY day ORDER BY day ASC`),
      q(`SELECT $session_id AS session_id, count() AS events, min(timestamp) AS started, max(timestamp) AS ended, any(distinct_id) AS distinct_id FROM events WHERE timestamp > now() - INTERVAL ${days} DAY AND $session_id IS NOT NULL GROUP BY session_id ORDER BY events DESC LIMIT 10`),
      q(`SELECT count() AS total FROM events WHERE event = 'form_started' AND timestamp > now() - INTERVAL ${days} DAY`),
      q(`SELECT properties.form_id AS form_id, count() AS started FROM events WHERE event = 'form_started' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY form_id ORDER BY started DESC`),
      q(`SELECT count() AS total, count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'vsl_play_click' AND timestamp > now() - INTERVAL ${days} DAY`),
      q(`SELECT count() AS views, count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'page_view' AND properties.$page = 'guide-optin' AND timestamp > now() - INTERVAL ${days} DAY`),
      q(`SELECT count() AS views, count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'page_view' AND properties.$page = 'home' AND timestamp > now() - INTERVAL ${days} DAY`),
      q(`SELECT properties.pack AS pack, count() AS views, count(DISTINCT distinct_id) AS uniques FROM events WHERE event = 'pricing_pack_viewed' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY pack ORDER BY views DESC`),
      q(`SELECT properties.pack AS pack, count() AS clicks FROM events WHERE event = 'pricing_pack_cta_clicked' AND timestamp > now() - INTERVAL ${days} DAY GROUP BY pack ORDER BY clicks DESC`),
    ]);

    const unique = uniques[0]?.uniques || 0;
    const prev = uniquesPrev[0]?.uniques || 0;
    const wow = prev > 0 ? Math.round(((unique - prev) / prev) * 100) : null;

    // Convert conversions array to map for easy frontend access
    const conversionsMap = {};
    conversions.forEach((row) => {
      const event = Array.isArray(row) ? row[0] : row.event;
      const count = Array.isArray(row) ? row[1] : row.count;
      conversionsMap[event] = count;
    });

    const frictionMap = {};
    friction.forEach((row) => {
      const event = Array.isArray(row) ? row[0] : row.event;
      const count = Array.isArray(row) ? row[1] : row.count;
      frictionMap[event] = count;
    });

    const formStartedTotal = formStartedCount[0]?.total || (Array.isArray(formStartedCount[0]) ? formStartedCount[0][0] : 0) || 0;
    const formSubmittedTotal = conversionsMap.form_submitted || 0;
    const vslPlaysTotal = vslPlays[0]?.total || (Array.isArray(vslPlays[0]) ? vslPlays[0][0] : 0) || 0;
    const vslPlaysUniques = vslPlays[0]?.uniques || (Array.isArray(vslPlays[0]) ? vslPlays[0][1] : 0) || 0;
    const homeViews = homePageViews[0]?.views || (Array.isArray(homePageViews[0]) ? homePageViews[0][0] : 0) || 0;
    const homeUniques = homePageViews[0]?.uniques || (Array.isArray(homePageViews[0]) ? homePageViews[0][1] : 0) || 0;
    const guideUniques = guidePageViews[0]?.uniques || (Array.isArray(guidePageViews[0]) ? guidePageViews[0][1] : 0) || 0;

    return res.status(200).json({
      ok: true,
      period: { days, from: daysAgo(days), to: today() },
      kpis: {
        unique_visitors: unique,
        unique_visitors_prev: prev,
        wow_pct: wow,
        lead_magnet_signups: conversionsMap.lead_magnet_submitted || 0,
        checkouts_initiated: conversionsMap.checkout_initiated || 0,
        form_submissions: formSubmittedTotal,
        rage_clicks: frictionMap.rage_click || 0,
        dead_clicks: frictionMap.dead_click || 0,
        js_errors: frictionMap.js_error || 0,
      },
      form_funnel: {
        guide_page_uniques: guideUniques,
        form_started: formStartedTotal,
        form_submitted: formSubmittedTotal,
        lead_magnet_completed: conversionsMap.lead_magnet_submitted || 0,
        abandonment_rate: formStartedTotal > 0 ? Math.round(((formStartedTotal - formSubmittedTotal) / formStartedTotal) * 100) : null,
        completion_rate: formStartedTotal > 0 ? Math.round((formSubmittedTotal / formStartedTotal) * 100) : null,
      },
      form_breakdown: formStartedByForm.map(rowToObj(['form_id', 'started'])),
      vsl_engagement: {
        plays_total: vslPlaysTotal,
        plays_uniques: vslPlaysUniques,
        home_page_views: homeViews,
        home_page_uniques: homeUniques,
        play_rate_pct: homeUniques > 0 ? Math.round((vslPlaysUniques / homeUniques) * 100) : null,
      },
      pack_interest: {
        views: packViewsRaw.map(rowToObj(['pack', 'views', 'uniques'])),
        clicks: packClicksRaw.map(rowToObj(['pack', 'clicks'])),
      },
      pages: pageViews.map(rowToObj(['page', 'views', 'uniques'])),
      referrers: referrers.map(rowToObj(['referrer', 'visits'])),
      cta_clicks: ctaClicks.map(rowToObj(['event', 'clicks'])),
      scroll_depth: scrollDepth.map(rowToObj(['depth', 'hits'])),
      section_views: sectionViews.map(rowToObj(['event', 'views'])),
      conversions,
      friction,
      rage_targets: rageTargets.map(rowToObj(['text', 'rages'])),
      daily_visitors: dailyVisitors.map(rowToObj(['day', 'visitors'])),
      top_sessions: topSessions.map(rowToObj(['session_id', 'events', 'started', 'ended', 'distinct_id'])),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[dashboard-data] failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function rowToObj(cols) {
  return (row) => {
    if (!Array.isArray(row)) return row;
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
