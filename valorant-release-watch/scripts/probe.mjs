import { fetchReleases, parseRegions, SOURCE_URL } from '../src/source.mjs';

try {
  const regions = process.argv[2] ? parseRegions(process.argv[2]) : parseRegions();
  const result = await fetchReleases(regions);
  console.log(JSON.stringify({
    ok: true, source: SOURCE_URL, checkedAt: new Date().toISOString(),
    sourceDate: result.sourceDate,
    releases: Object.fromEntries(Object.entries(result.releases).map(([region, value]) => [region, value.manifests.map(x => x.id)]))
  }, null, 2));
} catch (error) {
  console.error(`Source probe failed: ${error.message}`);
  console.error('A blocked local probe does not prove the cloud host is blocked. The setup wizard also tests the deployed Worker.');
  process.exitCode = 1;
}
