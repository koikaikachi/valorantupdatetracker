import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, settings } from '../src/monitor.mjs';
import { database, network, changedFixture, envBase } from './helpers.mjs';

const start = 1_800_000_000_000;
function harness(t) {
  const local = database();
  t.after(local.close);
  const net = network();
  const env = { ...envBase, DB: local.db };
  return { ...local, net, env, check: now => runCheck(env, { now, fetchFn: net.fetch.bind(net) }) };
}

test('first run establishes a baseline, persists it in SQL, and restart produces no duplicate alert', async t => {
  const h = harness(t);
  const first = await h.check(start);
  assert.equal(first.ok, true);
  assert.equal(first.changedRegions, 0);
  assert.equal(h.net.posts.length, 1);
  assert.match(h.net.posts[0].payload.embeds[0].title, /online/);
  assert.equal(Object.keys((await h.store.read()).regions).length, 6);
  const second = await h.check(start + 60_000);
  assert.equal(second.alertsSent, 0);
  assert.equal(h.net.posts.length, 1);
});

test('silent hotfix creates exactly one alert across repeated successful polls', async t => {
  const h = harness(t);
  await h.check(start);
  h.net.config = changedFixture(['na', 'eu']);
  const result = await h.check(start + 60_000);
  assert.equal(result.changedRegions, 2);
  assert.equal(result.alertsSent, 1);
  const payload = h.net.posts[1].payload;
  assert.match(payload.embeds[0].description, /\*\*NA\*\*/);
  assert.match(payload.embeds[0].description, /\*\*EU\*\*/);
  await h.check(start + 120_000);
  assert.equal(h.net.posts.length, 2);
});

test('Discord outage retains the change durably, then retries without manufacturing another release event', async t => {
  const h = harness(t);
  await h.check(start);
  h.net.config = changedFixture();
  h.net.discordStatus = 500;
  const result = await h.check(start + 60_000);
  assert.equal(result.ok, false);
  let state = await h.store.read();
  assert.equal(state.pending.length, 1);
  assert.equal(state.regions.na.fingerprint, '1111111111111111');
  const eventId = state.pending[0].id;
  h.net.discordStatus = 200;
  const retry = await h.check(start + 120_000);
  assert.equal(retry.changedRegions, 0);
  assert.equal(retry.alertsSent, 1);
  state = await h.store.read();
  assert.equal(state.pending.length, 0);
  assert.match(h.net.posts[2].payload.embeds[0].footer.text, new RegExp(eventId.slice(0, 8)));
});

test('Discord rate limits are respected while Riot polling continues', async t => {
  const h = harness(t);
  await h.check(start);
  h.net.discordStatus = 429;
  h.net.retryAfter = 180;
  h.net.config = changedFixture();
  await h.check(start + 60_000);
  h.net.discordStatus = 200;
  await h.check(start + 120_000);
  assert.equal(h.net.posts.length, 2, 'no early retry');
  assert.equal(h.net.sourceCalls, 3);
  await h.check(start + 240_000);
  assert.equal(h.net.posts.length, 3);
});

test('three source failures alert once, preserve the baseline, and recovery still detects a changed release', async t => {
  const h = harness(t);
  await h.check(start);
  const baseline = (await h.store.read()).regions.na.fingerprint;
  h.net.sourceStatus = 403;
  for (let i = 1; i <= 4; i++) await h.check(start + i * 60_000);
  assert.equal(h.net.posts.length, 2, 'startup + one outage');
  assert.match(h.net.posts[1].payload.embeds[0].title, /failing/);
  assert.equal((await h.store.read()).regions.na.fingerprint, baseline);
  h.net.sourceStatus = 200;
  h.net.config = changedFixture();
  const recovery = await h.check(start + 300_000);
  assert.equal(recovery.changedRegions, 1);
  assert.equal(recovery.alertsSent, 2);
  assert.match(h.net.posts[2].payload.embeds[0].title, /update detected/);
  assert.match(h.net.posts[3].payload.embeds[0].title, /recovered/);
});

test('incomplete HTTP-200 responses never reset good state or masquerade as a release', async t => {
  const h = harness(t);
  await h.check(start);
  h.net.config = {};
  const result = await h.check(start + 60_000);
  assert.equal(result.ok, false);
  assert.equal(result.changedRegions, 0);
  assert.equal(Object.keys((await h.store.read()).regions).length, 6);
});

test('regional rollback is a real manifest change and is reported', async t => {
  const h = harness(t);
  await h.check(start);
  const original = structuredClone(h.net.config);
  h.net.config = changedFixture();
  await h.check(start + 60_000);
  h.net.config = original;
  await h.check(start + 120_000);
  assert.equal(h.net.posts.length, 3);
});

test('a lease blocks overlapping checks and prevents an expired owner from overwriting new state', async t => {
  const h = harness(t);
  const first = await h.store.acquire(start);
  const blocked = await h.check(start + 1);
  assert.equal(blocked.skipped, 'another_check_is_running');
  const second = await h.store.acquire(start + 60_000);
  assert.ok(second);
  await assert.rejects(h.store.save(first.owner, { wrong: true }), /lease was lost/);
  await h.store.release(first.owner);
  assert.equal(await h.store.acquire(start + 60_001), null);
  await h.store.release(second.owner);
});

test('disabled checks make no outgoing requests and do not require secrets', async () => {
  const result = await runCheck({ ENABLED: 'false' });
  assert.equal(result.skipped, 'disabled');
});

test('invalid settings fail visibly instead of silently reducing coverage', () => {
  assert.throws(() => settings({ ENABLED: 'yes' }), /ENABLED/);
  assert.throws(() => settings({ REGIONS: 'unknown' }), /REGIONS/);
  assert.throws(() => settings({ FAILURE_ALERT_AFTER: '0' }), /FAILURE_ALERT_AFTER/);
  assert.throws(() => settings({ PING_USER_ID: '@everyone' }), /PING_USER_ID/);
});
