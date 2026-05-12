/**
 * PostHog server-side capture — no SDK dependency.
 * Fires events to PostHog REST API. Survives adblockers (client-side).
 *
 * Env vars:
 *   POSTHOG_API_KEY   — public project key (phc_...)
 *   POSTHOG_HOST      — default https://eu.i.posthog.com
 */
export async function captureServer({ distinctId, event, properties = {}, req }) {
  const key = process.env.POSTHOG_API_KEY;
  if (!key) return { ok: false, skipped: 'no key' };

  const host = process.env.POSTHOG_HOST || 'https://eu.i.posthog.com';
  const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.socket?.remoteAddress || null;
  const ua = req?.headers?.['user-agent'] || null;
  const referer = req?.headers?.referer || req?.headers?.referrer || null;

  const payload = {
    api_key: key,
    event,
    distinct_id: distinctId || `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    properties: {
      ...properties,
      $ip: ip,
      $current_url: referer,
      $user_agent: ua,
      $lib: 'openshore-server',
      $lib_version: '1.0.0',
      server_side: true,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('PostHog capture failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Extract distinct_id from client cookies/headers.
 * Client stores it in localStorage under 'os_distinct_id' — but we can also
 * receive it explicitly via request body.
 */
export function getDistinctIdFromReq(req) {
  if (req?.body?.distinct_id) return req.body.distinct_id;
  // Could also parse from cookie if client sets one
  return null;
}
