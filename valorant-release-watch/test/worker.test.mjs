import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/worker.mjs';
import { discordPayload, webhookUrl, sendDiscord } from '../src/discord.mjs';
import { database, envBase, network } from './helpers.mjs';

test('public endpoint reveals no secrets and private routes require authorization', async t => {
  const local = database(); t.after(local.close);
  const env = { ...envBase, DB: local.db };
  for (const path of ['/status', '/check', '/test-alert']) {
    const response = await handleRequest(new Request(`https://monitor.example${path}`), env);
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes(env.ADMIN_TOKEN));
  }
  const health = await handleRequest(new Request('https://monitor.example/healthz'), env);
  assert.equal(health.status, 503, 'never-checked service is not healthy');
  const root = await handleRequest(new Request('https://monitor.example/'), env);
  assert.equal(root.status, 200);
});

test('manual check requires POST and returns source/delivery status', async t => {
  const local = database(); t.after(local.close);
  const net = network();
  t.mock.method(globalThis, 'fetch', net.fetch.bind(net));
  const env = { ...envBase, DB: local.db };
  const headers = { Authorization: `Bearer ${env.ADMIN_TOKEN}` };
  assert.equal((await handleRequest(new Request('https://monitor.example/check', { headers }), env)).status, 405);
  const check = await handleRequest(new Request('https://monitor.example/check', { method: 'POST', headers }), env);
  assert.equal(check.status, 200);
  assert.equal((await check.json()).alertsSent, 1);
  const status = await handleRequest(new Request('https://monitor.example/status', { headers }), env);
  const body = await status.text();
  assert.ok(body.includes('lastSuccessfulCheck'));
  assert.ok(!body.includes(env.DISCORD_WEBHOOK_URL));
  assert.ok(!body.includes(env.ADMIN_TOKEN));
});

test('only the explicitly configured user can be mentioned', () => {
  const payload = discordPayload({ type: 'test', at: Date.now(), id: crypto.randomUUID() }, '111111111111111111');
  assert.equal(payload.content, '<@111111111111111111>');
  assert.deepEqual(payload.allowed_mentions, { parse: [], users: ['111111111111111111'] });
  const baseline = discordPayload({ type: 'baseline', regions: ['na'], at: Date.now(), id: crypto.randomUUID() }, '111111111111111111');
  assert.equal(baseline.content, '');
});

test('webhook validation prevents sending the webhook token to another host', () => {
  assert.throws(() => webhookUrl('https://example.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'), /Discord/);
  assert.throws(() => webhookUrl(envBase.DISCORD_WEBHOOK_URL.replace('https:', 'http:')), /HTTPS/);
  assert.equal(webhookUrl(envBase.DISCORD_WEBHOOK_URL).searchParams.get('wait'), 'true');
});

test('a successful HTTP status without a Discord message acknowledgement is not treated as delivery', async () => {
  await assert.rejects(sendDiscord(envBase,
    { type: 'test', at: Date.now(), id: crypto.randomUUID() },
    async () => new Response('{}', { status: 200 })
  ), /delivery is unconfirmed/);
});
