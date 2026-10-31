import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1StateStore } from '../src/store.mjs';
import { SOURCE_URL } from '../src/source.mjs';

export const fixture = JSON.parse(readFileSync(new URL('./fixtures/riot-config.json', import.meta.url), 'utf8'));
export const envBase = {
  ENABLED: 'true', REGIONS: 'na,eu,ap,kr,br,latam', PING_USER_ID: '', FAILURE_ALERT_AFTER: '3',
  ADMIN_TOKEN: 'unit-test-admin-token-that-is-not-a-real-secret',
  DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456789012345678/this_is_a_fake_webhook_token_for_tests_only'
};

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return stmt.get(...args) ?? null; },
      async run() { return { meta: { changes: Number(stmt.run(...args).changes) } }; }
    };
  } };
  return { db, store: new D1StateStore(db), close: () => sqlite.close() };
}

export function changedFixture(regions = ['na'], id = '1111111111111111') {
  const value = structuredClone(fixture);
  for (const config of value['keystone.products.valorant.patchlines.live'].platforms.win.configurations) {
    if (config.valid_shards.live.some(x => regions.includes(x))) {
      config.patch_url = `https://valorant.secure.dyn.riotcdn.net/channels/public/releases/${id}.manifest`;
      config.patch_artifacts[0].patch_url = config.patch_url;
    }
  }
  return value;
}

export function network() {
  return {
    config: structuredClone(fixture), sourceStatus: 200, sourceThrows: false,
    discordStatus: 200, retryAfter: null, posts: [], sourceCalls: 0,
    async fetch(url, options) {
      if (String(url) === SOURCE_URL) {
        this.sourceCalls++;
        if (this.sourceThrows) throw new Error('untrusted underlying network details');
        return new Response(JSON.stringify(this.config), {
          status: this.sourceStatus, headers: { 'Content-Type': 'application/json', Date: new Date().toUTCString() }
        });
      }
      if (new URL(url).hostname === 'discord.com') {
        this.posts.push({ url: String(url), payload: JSON.parse(options.body) });
        return new Response(JSON.stringify(this.discordStatus === 429 ? { retry_after: this.retryAfter ?? 120 } : { id: '987654321098765432' }), {
          status: this.discordStatus, headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error('Unexpected outgoing request in test.');
    }
  };
}
