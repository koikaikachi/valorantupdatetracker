import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SOURCE_URL } from '../src/source.mjs';
import { envBase, fixture, changedFixture } from '../test/helpers.mjs';

let current = structuredClone(fixture);
const deliveries = [];
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'release-watch-runtime-test',
  scriptPath: fileURLToPath(new URL('../dist/worker.js', import.meta.url)),
  modules: true, compatibilityDate: '2026-10-01', cf: false,
  bindings: envBase, d1Databases: { DB: 'test-state' },
  outboundService: async request => {
    if (request.url === SOURCE_URL) return new MiniflareResponse(JSON.stringify(current), { headers: { 'Content-Type': 'application/json' } });
    if (new URL(request.url).hostname === 'discord.com') {
      deliveries.push(await request.json());
      return new MiniflareResponse(JSON.stringify({ id: '987654321098765432' }), { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Runtime test tried an unexpected external request.');
  }
}));

try {
  const db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  for (const sql of schema.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(sql).run();
  const headers = { Authorization: `Bearer ${envBase.ADMIN_TOKEN}` };
  const check = () => mf.dispatchFetch('https://release-watch.example/check', { method: 'POST', headers });
  let response = await check();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(deliveries.length, 1);
  current = changedFixture(['na']);
  response = await check();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).changedRegions, 1);
  assert.equal(deliveries.length, 2);
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '* * * * *' });
  assert.equal(deliveries.length, 2, 'scheduled unchanged check must not duplicate an alert');
  response = await mf.dispatchFetch('https://release-watch.example/healthz');
  assert.equal(response.status, 200);
  const row = await db.prepare('SELECT payload FROM monitor_state WHERE id = 1').first();
  assert.equal(JSON.parse(row.payload).regions.na.fingerprint, '1111111111111111');
  console.log('Workers runtime smoke test passed: D1 baseline, manifest change, Discord payload, Cron handler, health endpoint.');
  console.log('All external requests were intercepted; no real Discord message was sent.');
} finally {
  await mf.dispose();
}
