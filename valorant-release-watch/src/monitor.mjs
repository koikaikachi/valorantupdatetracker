import { parseRegions, fetchReleases } from './source.mjs';
import { webhookUrl, sendDiscord } from './discord.mjs';
import { D1StateStore } from './store.mjs';

export function settings(env) {
  if (!['true', 'false'].includes(env.ENABLED ?? 'false')) throw new Error('ENABLED must be true or false.');
  const regions = parseRegions(env.REGIONS);
  const failureAlertAfter = Number(env.FAILURE_ALERT_AFTER ?? 3);
  if (!Number.isInteger(failureAlertAfter) || failureAlertAfter < 1 || failureAlertAfter > 60) throw new Error('FAILURE_ALERT_AFTER must be between 1 and 60.');
  if (env.PING_USER_ID && !/^\d{15,25}$/.test(env.PING_USER_ID)) throw new Error('PING_USER_ID must be a Discord user ID.');
  return { enabled: env.ENABLED === 'true', regions, failureAlertAfter };
}

function newState(value) {
  if (value.version != null && value.version !== 1) throw new Error('Unsupported stored state version.');
  return {
    version: 1, regions: {}, pending: [], consecutiveFailures: 0,
    firstFailureAt: null, outageQueued: false, lastAttemptAt: null,
    lastSuccessAt: null, lastSourceError: null, lastDeliveryError: null,
    lastDeliveryAt: null, sourceDate: null, sourceAgeSeconds: null,
    ...value
  };
}

function queue(state, type, at, fields = {}) {
  state.pending.push({ id: crypto.randomUUID(), type, at, attempts: 0, notBefore: 0, ...fields });
}

export async function runCheck(env, options = {}) {
  const config = settings(env);
  if (!config.enabled) return { ok: true, skipped: 'disabled' };
  webhookUrl(env.DISCORD_WEBHOOK_URL);
  const store = options.store ?? new D1StateStore(env.DB);
  const now = options.now ?? Date.now();
  const lease = await store.acquire(now);
  if (!lease) return { ok: true, skipped: 'another_check_is_running' };
  let state;
  let sourceOk = false;
  let changeCount = 0;
  let sentCount = 0;
  try {
    state = newState(lease.state);
    state.lastAttemptAt = now;
    try {
      const current = await fetchReleases(config.regions, options.fetchFn ?? fetch);
      const changes = [];
      const added = [];
      for (const region of config.regions) {
        const before = state.regions[region];
        const after = current.releases[region];
        if (!before) added.push(region);
        else if (before.fingerprint !== after.fingerprint) changes.push({ region, before, after });
      }
      if (added.length) queue(state, 'baseline', now, { regions: added });
      if (changes.length) queue(state, 'release', now, { changes });
      if (state.outageQueued) queue(state, 'recovery', now);
      changeCount = changes.length;
      state.regions = current.releases;
      state.lastSuccessAt = now;
      state.sourceDate = current.sourceDate;
      state.sourceAgeSeconds = current.sourceAgeSeconds;
      state.consecutiveFailures = 0;
      state.firstFailureAt = null;
      state.outageQueued = false;
      state.lastSourceError = null;
      sourceOk = true;
    } catch (error) {
      state.consecutiveFailures++;
      state.firstFailureAt ??= now;
      // Only source functions supply these messages; fetch errors are sanitized there.
      state.lastSourceError = error.message.slice(0, 240);
      if (state.consecutiveFailures >= config.failureAlertAfter && !state.outageQueued) {
        queue(state, 'outage', now, { failures: state.consecutiveFailures, reason: state.lastSourceError });
        state.outageQueued = true;
      }
    }

    // Persist the new baseline AND its pending alert before attempting Discord.
    // Restarts or failed webhook deliveries cannot silently discard a detected change.
    await store.save(lease.owner, state);

    // Keep total wall time comfortably below the lease duration. Polling continues
    // even if Discord is unavailable; pending alerts are retried on later checks.
    for (let i = 0; i < 2 && state.pending.length; i++) {
      const event = state.pending[0];
      if (event.notBefore > now) break;
      try {
        await sendDiscord(env, event, options.fetchFn ?? fetch);
        state.pending.shift();
        state.lastDeliveryAt = now;
        state.lastDeliveryError = null;
        sentCount++;
      } catch (error) {
        event.attempts++;
        const backoff = Math.min(900_000, 60_000 * 2 ** Math.min(event.attempts - 1, 4));
        event.notBefore = now + Math.max(backoff, error.retryAfterMs ?? 0);
        state.lastDeliveryError = error.message.slice(0, 240);
        await store.save(lease.owner, state);
        break;
      }
      await store.save(lease.owner, state);
    }
    return {
      ok: sourceOk && state.pending.length === 0,
      changedRegions: changeCount, alertsSent: sentCount, pendingAlerts: state.pending.length,
      lastSuccessAt: state.lastSuccessAt, sourceError: state.lastSourceError,
      deliveryError: state.lastDeliveryError
    };
  } finally {
    await store.release(lease.owner);
  }
}

export function publicHealth(state, enabled, now = Date.now()) {
  const fresh = Boolean(state.lastSuccessAt && now - state.lastSuccessAt < 300_000);
  return {
    service: 'valorant-release-watch', version: '1.0.0',
    ok: enabled && fresh && !state.lastDeliveryError && !(state.consecutiveFailures > 0),
    enabled, lastSuccessfulCheck: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null
  };
}

export function privateStatus(state, config, now = Date.now()) {
  return {
    ...publicHealth(state, config.enabled, now),
    monitoredRegions: config.regions,
    lastAttempt: state.lastAttemptAt ? new Date(state.lastAttemptAt).toISOString() : null,
    sourceDate: state.sourceDate ?? null,
    sourceAgeSeconds: state.sourceAgeSeconds ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    sourceError: state.lastSourceError ?? null,
    deliveryError: state.lastDeliveryError ?? null,
    pendingAlerts: state.pending?.length ?? 0,
    lastDiscordDelivery: state.lastDeliveryAt ? new Date(state.lastDeliveryAt).toISOString() : null,
    releases: state.regions ?? {}
  };
}
