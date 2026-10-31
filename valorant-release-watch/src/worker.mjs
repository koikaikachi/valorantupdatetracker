import { settings, runCheck, publicHealth, privateStatus } from './monitor.mjs';
import { D1StateStore } from './store.mjs';
import { sendDiscord } from './discord.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  } });
}

function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('Authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (supplied.length !== expected.length) return false;
  let different = 0;
  for (let i = 0; i < supplied.length; i++) different |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return different === 0;
}

export async function handleRequest(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/' && request.method === 'GET') return json({ service: 'VALORANT Release Watch', version: '1.0.0', health: '/healthz' });
  if (!['/healthz', '/status', '/check', '/test-alert'].includes(path)) return json({ error: 'Not found.' }, 404);
  if (path !== '/healthz' && !authorized(request, env.ADMIN_TOKEN)) return json({ error: 'Unauthorized.' }, 401);
  const expected = ['/check', '/test-alert'].includes(path) ? 'POST' : 'GET';
  if (request.method !== expected) return json({ error: `Use ${expected}.` }, 405);
  try {
    const config = settings(env);
    if (path === '/test-alert') {
      await sendDiscord(env, { type: 'test', id: crypto.randomUUID(), at: Date.now() });
      return json({ ok: true, message: 'Test alert sent to the configured Discord channel.' });
    }
    if (path === '/check') {
      const result = await runCheck(env);
      return json(result, result.ok ? 200 : 503);
    }
    const state = await new D1StateStore(env.DB).read();
    const status = path === '/healthz' ? publicHealth(state, config.enabled) : privateStatus(state, config);
    return json(status, path === '/healthz' && !status.ok ? 503 : 200);
  } catch {
    // Do not return credentials, raw network exceptions, or database internals.
    console.error('monitor_request_failed');
    return json({ error: 'Monitor request failed. Check configuration, secrets, and database initialization.' }, 500);
  }
}

export default {
  fetch: handleRequest,
  async scheduled(controller, env, context) {
    try {
      const result = await runCheck(env);
      if (!result.ok) console.warn('monitor_check_unhealthy');
    } catch {
      console.error('monitor_scheduled_check_failed');
      throw new Error('Scheduled check failed; inspect configuration and database initialization.');
    }
  }
};
