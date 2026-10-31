export const SOURCE_URL = 'https://clientconfig.rpg.riotgames.com/api/v1/config/public?namespace=keystone.products.valorant.patchlines';
export const REGIONS = ['na', 'eu', 'ap', 'kr', 'br', 'latam'];
export const REGION_NAMES = { na: 'North America', eu: 'Europe', ap: 'Asia Pacific', kr: 'Korea', br: 'Brazil', latam: 'Latin America' };

export function parseRegions(value = REGIONS.join(',')) {
  const selected = [...new Set(String(value).toLowerCase().split(',').map(x => x.trim()).filter(Boolean))];
  if (!selected.length || selected.some(x => !REGIONS.includes(x))) {
    throw new Error('REGIONS must contain one or more of: na, eu, ap, kr, br, latam.');
  }
  return REGIONS.filter(x => selected.includes(x));
}

function manifestReference(value) {
  if (typeof value !== 'string') throw new Error('Riot returned an invalid manifest URL.');
  const url = new URL(value);
  const match = url.pathname.match(/^\/channels\/public\/releases\/([0-9a-f]{16})\.manifest$/i);
  if (url.protocol !== 'https:' || !['valorant.secure.dyn.riotcdn.net', 'valorant.dyn.riotcdn.net'].includes(url.hostname) || !match) {
    throw new Error('Riot returned an unrecognized public PC manifest URL.');
  }
  // Manifest IDs identify content. CDN host changes and signed query strings do not.
  const id = match[1].toUpperCase();
  return { id, url: `https://valorant.secure.dyn.riotcdn.net/channels/public/releases/${id}.manifest` };
}

export function parseReleaseConfig(data, regions = REGIONS) {
  const configurations = data?.['keystone.products.valorant.patchlines.live']?.platforms?.win?.configurations;
  if (!Array.isArray(configurations) || !configurations.length) {
    throw new Error('Riot response is missing the live Windows release configurations.');
  }
  const releases = {};
  for (const region of regions) {
    const matching = configurations.filter(config => Array.isArray(config?.valid_shards?.live) && config.valid_shards.live.includes(region));
    if (!matching.length) throw new Error(`Riot response is missing the live ${region.toUpperCase()} region.`);
    const references = new Map();
    for (const config of matching) {
      const values = [];
      if (config.patch_url) values.push(config.patch_url);
      if (config.patch_artifacts != null && !Array.isArray(config.patch_artifacts)) throw new Error('Riot patch_artifacts has an unexpected format.');
      for (const artifact of config.patch_artifacts ?? []) {
        if (artifact?.type === 'patch_url') {
          if (!artifact.patch_url) throw new Error('Riot returned a patch artifact without a manifest URL.');
          values.push(artifact.patch_url);
        }
      }
      if (!values.length) throw new Error(`Riot returned no PC manifests for ${region.toUpperCase()}.`);
      for (const value of values) {
        const ref = manifestReference(value);
        references.set(ref.id, ref);
      }
    }
    const manifests = [...references.values()].sort((a, b) => a.id.localeCompare(b.id));
    releases[region] = { fingerprint: manifests.map(x => x.id).join(':'), manifests };
  }
  return releases;
}

export async function fetchReleases(regions, fetchFn = fetch) {
  let response;
  try {
    response = await fetchFn(SOURCE_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'ValorantReleaseWatch/1.0', 'Cache-Control': 'no-cache' },
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new Error('Riot release request failed or timed out.');
  }
  if (!response.ok) throw new Error(`Riot release source returned HTTP ${response.status}.`);
  const age = Number(response.headers.get('Age') ?? 0);
  if (Number.isFinite(age) && age > 600) throw new Error('Riot release response is more than ten minutes old.');
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Riot release response is unexpectedly large.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Riot release source returned invalid JSON.'); }
  return {
    releases: parseReleaseConfig(data, regions),
    sourceDate: response.headers.get('Date'),
    sourceAgeSeconds: age
  };
}
