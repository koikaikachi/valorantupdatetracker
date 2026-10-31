import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseRegions } from '../src/source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');

async function ask(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(message)).trim(); } finally { rl.close(); }
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(resolve(root, path), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function saveJson(path, value) {
  await writeFile(resolve(root, path), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export function parseOutputJson(output) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '[' || clean[i] === '{') {
      try { return JSON.parse(clean.slice(i)); } catch {}
    }
  }
  throw new Error('Could not read JSON output from Wrangler.');
}

export function chooseRegions(input, fallback = 'na,eu,ap,kr,br,latam') {
  return parseRegions(input.toLowerCase() === 'all' ? 'na,eu,ap,kr,br,latam' : (input || fallback)).join(',');
}

export function findWorkerUrl(output, name) {
  const urls = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/g) ?? [];
  const result = urls.find(value => new URL(value).hostname.startsWith(`${name}.`));
  if (!result) throw new Error('Could not find the deployed workers.dev address in Wrangler output.');
  return result;
}

function wrangler(args, { capture = false, input, accountId } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
      stdio: [input !== undefined ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', 'inherit']
    });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept(output) : reject(new Error(`Wrangler ${args[0]} failed. Resolve the error above and run setup again.`)));
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

export async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js LTS (version 22 or newer) from https://nodejs.org/.');
  try { await access(cli); } catch { throw new Error('Run npm ci in this folder first, then npm run setup.'); }
  console.log('\nVALORANT Release Watch setup\n');
  console.log('This creates a scheduled Worker and a tiny D1 database in your Cloudflare account.');
  console.log('Use the Workers Free plan. No domain, paid plan, or always-on PC is required.\n');

  const saved = await readJson('.setup.json', {});
  const defaultName = saved.name ?? `valorant-release-watch-${randomBytes(3).toString('hex')}`;
  const name = (await ask(`Service name [${defaultName}]: `)) || defaultName;
  if (!/^[a-z][a-z0-9-]{2,50}$/.test(name)) throw new Error('Use a service name containing 3–51 lowercase letters, numbers, or hyphens.');
  const regions = chooseRegions(await ask(`Regions: all, or comma-separated na,eu,ap,kr,br,latam [${saved.regions ?? 'all'}]: `), saved.regions);
  const defaultPing = saved.pingUserId ?? '';
  console.log('Optional phone/desktop ping: Discord Settings > Advanced > Developer Mode, then right-click your profile > Copy User ID.');
  const pingInput = await ask(`Your Discord user ID [${defaultPing || 'none; press Enter'}] (type none to clear): `);
  const pingUserId = pingInput.toLowerCase() === 'none' ? '' : (pingInput || defaultPing).replace(/^<@!?(\d+)>$/, '$1');
  if (pingUserId && !/^\d{15,25}$/.test(pingUserId)) throw new Error('Enter the numeric Discord user ID, or leave it blank.');

  console.log('\nCloudflare will open your browser. Sign in to your own free account and approve Wrangler access.');
  await wrangler(['login']);
  const identity = parseOutputJson(await wrangler(['whoami', '--json'], { capture: true }));
  const accounts = identity.accounts;
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('No Cloudflare accounts were returned. Finish account creation, then run setup again.');
  let account = accounts.find(x => x.id === saved.accountId) ?? accounts[0];
  if (accounts.length > 1) {
    console.log('\nChoose the account for this monitor:');
    accounts.forEach((value, index) => console.log(`${index + 1}. ${value.name}`));
    const selected = Number((await ask('Account number [1]: ')) || 1) - 1;
    account = accounts[selected];
    if (!account) throw new Error('That account number is not valid.');
  }
  if (!/^[0-9a-f]{32}$/i.test(account.id)) throw new Error('Cloudflare returned an invalid account ID.');
  const accountId = account.id;
  const databaseName = `${name}-state`;
  let databases = parseOutputJson(await wrangler(['d1', 'list', '--json'], { capture: true, accountId }));
  if (!Array.isArray(databases)) throw new Error('Cloudflare returned an unexpected database list.');
  let database = databases.find(x => x.name === databaseName);
  if (!database) {
    await wrangler(['d1', 'create', databaseName, '--update-config=false'], { accountId });
    databases = parseOutputJson(await wrangler(['d1', 'list', '--json'], { capture: true, accountId }));
    database = databases.find(x => x.name === databaseName);
  }
  const databaseId = database?.uuid ?? database?.id;
  if (!/^[0-9a-f-]{36}$/i.test(databaseId ?? '')) throw new Error('Could not find the new database ID. Run setup again.');
  const setup = { name, regions, pingUserId, accountId, databaseId };
  await saveJson('.setup.json', setup);
  const config = await readJson('wrangler.example.json');
  config.name = name;
  config.account_id = accountId;
  config.vars = { ...config.vars, ENABLED: 'false', REGIONS: regions, PING_USER_ID: pingUserId };
  config.d1_databases = [{ binding: 'DB', database_name: databaseName, database_id: databaseId }];
  await saveJson('wrangler.json', config);
  await wrangler(['d1', 'execute', 'DB', '--remote', '--file', 'schema.sql', '--yes', '--config', 'wrangler.json'], { accountId });

  console.log('\nDeploying initially with checks disabled while credentials are configured.');
  await wrangler(['deploy', '--config', 'wrangler.json'], { accountId });
  console.log('\nCreate a webhook in your own Discord server:');
  console.log('Channel Settings > Integrations > Webhooks > New Webhook > Copy Webhook URL.');
  console.log('Paste it into Wrangler\'s secret prompt below. It is not saved in the project files.');
  await wrangler(['secret', 'put', 'DISCORD_WEBHOOK_URL', '--config', 'wrangler.json'], { accountId });
  const oldAdmin = await readJson('.watch-admin.json', null);
  const token = oldAdmin?.serviceName === name && oldAdmin.token?.length >= 32 ? oldAdmin.token : randomBytes(32).toString('base64url');
  await wrangler(['secret', 'put', 'ADMIN_TOKEN', '--config', 'wrangler.json'], { input: token + '\n', accountId });
  config.vars.ENABLED = 'true';
  await saveJson('wrangler.json', config);
  const deployed = await wrangler(['deploy', '--config', 'wrangler.json'], { capture: true, accountId });
  console.log(deployed);
  const baseUrl = findWorkerUrl(deployed, name);
  await saveJson('.watch-admin.json', { serviceName: name, baseUrl, token });
  await saveJson('.setup.json', { ...setup, baseUrl });

  console.log('Testing Riot access and Discord delivery from the deployed cloud host...');
  const response = await fetch(`${baseUrl}/check`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45_000)
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok || !result.ok || result.skipped) {
    throw new Error('Cloud validation did not complete. The deployment exists; use npm run status to diagnose it. Do not assume alerts are working yet.');
  }
  console.log(`\nSetup complete. Your monitor is running at ${baseUrl}`);
  console.log('Check Discord for the online message. Your PC can now be turned off.');
  console.log('Use npm run status to check it later, or npm run test-alert to test a notification.');
  console.log('New Cron Triggers may take up to 15 minutes to propagate.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`\nSetup stopped: ${error.message}`); process.exitCode = 1; });
}
