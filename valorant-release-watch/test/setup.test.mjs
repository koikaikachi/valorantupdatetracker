import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutputJson, chooseRegions, findWorkerUrl } from '../scripts/setup.mjs';

test('setup parses clean or prefixed Wrangler JSON without printing credentials', () => {
  assert.deepEqual(parseOutputJson('[{"name":"test","uuid":"abc"}]'), [{ name: 'test', uuid: 'abc' }]);
  assert.deepEqual(parseOutputJson('informational preface\n{"accounts":[]}'), { accounts: [] });
  assert.throws(() => parseOutputJson('not JSON'), /Could not read/);
});

test('setup supports all regions or a chosen subset', () => {
  assert.equal(chooseRegions('all'), 'na,eu,ap,kr,br,latam');
  assert.equal(chooseRegions('na,eu'), 'na,eu');
  assert.equal(chooseRegions('', 'na'), 'na');
  assert.equal(chooseRegions('all', 'na'), 'na,eu,ap,kr,br,latam');
  assert.throws(() => chooseRegions('pbe'), /REGIONS/);
});

test('setup chooses the deployed service URL instead of a preview URL', () => {
  const output = 'preview: https://abc-watch.user.workers.dev\nhttps://watch.user.workers.dev\nschedule: * * * * *';
  assert.equal(findWorkerUrl(output, 'watch'), 'https://watch.user.workers.dev');
  assert.throws(() => findWorkerUrl('deployment failed', 'watch'), /Could not find/);
});
