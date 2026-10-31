import { readFile } from 'node:fs/promises';

const commands = {
  status: { path: '/status', method: 'GET' },
  check: { path: '/check', method: 'POST' },
  'test-alert': { path: '/test-alert', method: 'POST' }
};

try {
  const command = commands[process.argv[2]];
  if (!command) throw new Error('Use status, check, or test-alert.');
  let admin;
  try { admin = JSON.parse(await readFile(new URL('../.watch-admin.json', import.meta.url), 'utf8')); }
  catch { throw new Error('Run npm run setup first. This command uses the local admin file made by setup.'); }
  const target = new URL(admin.baseUrl);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.workers.dev') || target.username || target.password || target.port || target.pathname !== '/') {
    throw new Error('The saved Worker address is invalid. Run setup again.');
  }
  if (typeof admin.token !== 'string' || admin.token.length < 32) throw new Error('The saved admin token is missing. Run setup again.');
  target.pathname = command.path;
  const response = await fetch(target, {
    method: command.method, headers: { Authorization: `Bearer ${admin.token}` }, signal: AbortSignal.timeout(45_000)
  });
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
  if (!response.ok || body.ok === false) process.exitCode = 1;
} catch (error) {
  console.error(`Command failed: ${error.message}`);
  process.exitCode = 1;
}
