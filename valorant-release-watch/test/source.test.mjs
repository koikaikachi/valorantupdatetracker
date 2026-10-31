import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegions, parseReleaseConfig, fetchReleases, REGIONS } from '../src/source.mjs';
import { fixture, changedFixture } from './helpers.mjs';

test('parses the real Riot response captured during development for all six live PC regions', () => {
  const releases = parseReleaseConfig(fixture);
  assert.deepEqual(Object.keys(releases), REGIONS);
  for (const release of Object.values(releases)) {
    assert.match(release.fingerprint, /^[0-9A-F]{16}$/);
    assert.equal(release.manifests.length, 1, 'legacy and artifact references are deduplicated');
  }
});

test('a silent manifest-only hotfix changes the fingerprint for just the affected region', () => {
  const before = parseReleaseConfig(fixture);
  const after = parseReleaseConfig(changedFixture(['na']));
  assert.notEqual(before.na.fingerprint, after.na.fingerprint);
  assert.equal(before.eu.fingerprint, after.eu.fingerprint);
});

test('launcher metadata, list ordering, CDN host and query-string changes do not look like game updates', () => {
  const value = structuredClone(fixture);
  const live = value['keystone.products.valorant.patchlines.live'];
  live.metadata = { theme_manifest: 'https://example.com/new-launcher-art.json' };
  live.version = '9999';
  live.platforms.win.configurations.reverse();
  for (const config of live.platforms.win.configurations) {
    config.patch_url = config.patch_url.replace('valorant.secure.', 'valorant.') + '?token=rotating';
    config.patch_artifacts[0].patch_url += '?signature=another-token';
  }
  assert.deepEqual(parseReleaseConfig(value), parseReleaseConfig(fixture));
});

test('a second patch artifact changing is detected even when the primary manifest stays the same', () => {
  const value = structuredClone(fixture);
  const na = value['keystone.products.valorant.patchlines.live'].platforms.win.configurations.find(x => x.id === 'na');
  na.patch_artifacts.push({ type: 'patch_url', patch_url: 'https://valorant.secure.dyn.riotcdn.net/channels/public/releases/2222222222222222.manifest' });
  assert.equal(parseReleaseConfig(value).na.manifests.length, 2);
  assert.notEqual(parseReleaseConfig(value).na.fingerprint, parseReleaseConfig(fixture).na.fingerprint);
});

test('missing regions, PBE-only data, malformed artifacts and foreign URLs are rejected', () => {
  assert.throws(() => parseReleaseConfig({}), /live Windows/);
  const value = structuredClone(fixture);
  value['keystone.products.valorant.patchlines.pbe'] = value['keystone.products.valorant.patchlines.live'];
  delete value['keystone.products.valorant.patchlines.live'];
  assert.throws(() => parseReleaseConfig(value), /live Windows/);
  const missing = structuredClone(fixture);
  missing['keystone.products.valorant.patchlines.live'].platforms.win.configurations = [];
  assert.throws(() => parseReleaseConfig(missing), /live Windows/);
  const bad = changedFixture();
  bad['keystone.products.valorant.patchlines.live'].platforms.win.configurations[0].patch_url = 'https://example.com/file.manifest';
  assert.throws(() => parseReleaseConfig(bad), /unrecognized/);
});

test('region selection is validated, normalized and deduplicated', () => {
  assert.deepEqual(parseRegions('EU, NA,na'), ['na', 'eu']);
  assert.throws(() => parseRegions('pbe'), /REGIONS/);
  assert.throws(() => parseRegions(''), /REGIONS/);
});

test('HTTP errors, invalid JSON and stale cached responses fail closed', async () => {
  await assert.rejects(fetchReleases(REGIONS, async () => new Response('{}', { status: 403 })), /HTTP 403/);
  await assert.rejects(fetchReleases(REGIONS, async () => new Response('<html>error</html>')), /invalid JSON/);
  await assert.rejects(fetchReleases(REGIONS, async () => new Response(JSON.stringify(fixture), { headers: { Age: '601' } })), /ten minutes/);
});
