export function webhookUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DISCORD_WEBHOOK_URL must be a Discord incoming webhook URL.'); }
  if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname) ||
      !/^\/api(?:\/v\d+)?\/webhooks\/\d{15,25}\/[A-Za-z0-9._-]{20,}$/.test(url.pathname) || url.username || url.password || url.port) {
    throw new Error('DISCORD_WEBHOOK_URL must be an HTTPS Discord incoming webhook URL.');
  }
  for (const key of [...url.searchParams.keys()]) if (key !== 'thread_id') url.searchParams.delete(key);
  if (url.searchParams.has('thread_id') && !/^\d{15,25}$/.test(url.searchParams.get('thread_id'))) throw new Error('Webhook thread_id must be a Discord ID.');
  url.searchParams.set('wait', 'true');
  return url;
}

function formatIds(release) { return release.manifests.map(x => `\`${x.id}\``).join(', '); }

export function discordPayload(event, pingUserId = '') {
  let title, description, color;
  if (event.type === 'release') {
    title = 'VALORANT PC client update detected';
    description = 'A different patch manifest is now published on Riot\'s live PC update channel. Check program compatibility before using this build.\n\n' +
      event.changes.map(change => `**${change.region.toUpperCase()}**\nPrevious: ${formatIds(change.before)}\nCurrent: ${formatIds(change.after)}`).join('\n\n');
    color = 0xFF4655;
  } else if (event.type === 'baseline') {
    title = 'VALORANT Release Watch is online';
    description = `Monitoring the live PC update channel every minute for **${event.regions.map(x => x.toUpperCase()).join(', ')}**.\n\n` +
      'The current manifests have been saved as the starting point. This message is setup confirmation, not a newly detected update.';
    color = 0x2ECC71;
  } else if (event.type === 'outage') {
    title = 'VALORANT update checks are failing';
    description = `The release source has failed ${event.failures} consecutive checks. Updates may be missed until it recovers.\n\n${event.reason}`;
    color = 0xF1C40F;
  } else if (event.type === 'recovery') {
    title = 'VALORANT update checks recovered';
    description = 'The live release source is responding again. The latest manifests have been compared with the last successful check.\n\n' +
      'Any updates that appeared and disappeared entirely during the outage cannot be reconstructed.';
    color = 0x2ECC71;
  } else if (event.type === 'test') {
    title = 'VALORANT Release Watch — test alert';
    description = 'Discord delivery is working. This is a test, not an actual VALORANT update.';
    color = 0x3498DB;
  } else throw new Error('Unknown alert type.');
  const ping = pingUserId && ['release', 'outage', 'test'].includes(event.type);
  return {
    username: 'VALORANT Release Watch',
    content: ping ? `<@${pingUserId}>` : '',
    allowed_mentions: { parse: [], users: ping ? [pingUserId] : [] },
    embeds: [{
      title, description: description.slice(0, 4000), color,
      timestamp: new Date(event.at).toISOString(),
      footer: { text: `PC live release monitor · ${event.id.slice(0, 8)}` }
    }]
  };
}

export async function sendDiscord(env, event, fetchFn = fetch) {
  const url = webhookUrl(env.DISCORD_WEBHOOK_URL);
  let response;
  try {
    response = await fetchFn(url.toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload(event, env.PING_USER_ID ?? '')),
      redirect: 'manual', signal: AbortSignal.timeout(8_000)
    });
  } catch { throw new Error('Discord delivery failed or timed out.'); }
  if (!response.ok) {
    const error = new Error(`Discord returned HTTP ${response.status}.`);
    let seconds = Number(response.headers.get('Retry-After'));
    if (response.status === 429) {
      try { seconds = Number((await response.json()).retry_after) || seconds; } catch {}
    }
    error.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(3_600_000, Math.ceil(seconds * 1000)) : 60_000;
    throw error;
  }
  // Consume the acknowledgement. Never store or log the response's webhook URL/token.
  let body = null;
  try { body = await response.json(); } catch {}
  if (typeof body?.id !== 'string' || !/^\d{15,25}$/.test(body.id)) {
    throw new Error('Discord did not return a message acknowledgement; delivery is unconfirmed.');
  }
  return body.id;
}
