# VALORANT Release Watch

A small cloud-hosted checker that alerts your Discord channel when Riot publishes a different **live Windows PC patch manifest**. It checks every minute, including changes without patch notes. Your computer can be off after setup.

**The project is ready to set up. It is not monitoring anything until you deploy it into your Cloudflare account and configure your Discord webhook.**

## Start here — Windows

1. **Extract the ZIP** into a normal folder. Do not run the launcher from inside the ZIP.
2. Install **Node.js LTS** from <https://nodejs.org/> if you do not already have it. Version 22 or newer is required; the current LTS is the easiest choice. Reopen any terminals after installing it.
3. Create a **free Cloudflare account** at <https://dash.cloudflare.com/sign-up>. Use the Workers Free plan. You do not need a domain or a paid subscription.
4. Create a channel in your own Discord server, such as a private `#valorant-updates`. Open **Edit Channel → Integrations → Webhooks → New Webhook**, choose that channel, and **Copy Webhook URL**. Keep this URL private; it permits posting to that channel.
5. Optional, for a direct notification: enable **Discord User Settings → Advanced → Developer Mode**, then right-click your own profile and choose **Copy User ID**. Give the wizard this numeric ID. Otherwise set the channel's notifications to **All Messages**.
6. Double-click **START-HERE.cmd**. The wizard installs the pinned setup tool, asks which regions to monitor, opens Cloudflare's browser login, creates the database and Worker, and prompts for the webhook URL. Paste the URL into **Wrangler's secret prompt**, not into a chat or public file. If Windows hides filename extensions, the file may appear as `START-HERE` with type Windows Command Script.
7. Wait for **Setup complete** and the **VALORANT Release Watch is online** message in Discord. Only after both appear should you consider the setup verified. Newly added schedules can take up to 15 minutes to propagate. You may then close the window and turn your PC off.

All six regions are selected by default: **NA, EU, AP, KR, BR, LATAM**. The source returns them together, so monitoring all six still uses one release-data request per check. You can select just `na` if that is all you need.

The first successful check saves the current manifests as the baseline. It sends an online message, not a fake update notification. Future manifest changes produce update alerts, including a regional rollback to a previous manifest.

## Start from a terminal — Windows, macOS or Linux

In the extracted project folder:

```sh
npm ci
npm run setup
```

The wizard signs in through Cloudflare's browser login; it never asks you to paste a Cloudflare password into this project. It deploys with checks disabled while configuring the credentials, then enables the schedule and runs a live cloud check. If setup fails, read the error and rerun it from the same folder. Keep the generated local setup files so it can resume the same deployment.

On first setup the wizard suggests a service name with a random suffix. Keep it to avoid colliding with an existing Worker. Rerunning setup with the same generated files updates that same service and preserves its stored baseline.

## Check it later

Open a terminal in the project folder:

| Command | Purpose |
| --- | --- |
| `npm run status` | See last successful check, current manifests, and any source or delivery error. |
| `npm run check` | Run an immediate cloud check. Sends an alert only if appropriate. |
| `npm run test-alert` | Send an explicitly labelled test message to your Discord channel. |
| `npm run probe` | Read Riot's current release information from the machine running the command; no Discord messages. |
| `npm test` | Run the local automated tests. |

The first three commands use `.watch-admin.json`, created by setup. Keep it private and do not share or commit it. The webhook itself is stored as a Cloudflare secret, not in the project files. You can also inspect the Worker and its logs in your Cloudflare dashboard.

The public `/healthz` endpoint reports whether checking and delivery are healthy. `/status`, `/check`, and `/test-alert` require the generated admin token. An external uptime service can watch `/healthz` if you want to detect a total hosting or scheduler outage; the checker cannot send an alert while its hosting provider is entirely down.

## What it detects

- A different manifest ID on the live Windows update channel for any selected region.
- Silent downloadable patches that use a new manifest, even when the public patch number and patch notes stay unchanged.
- Changes to the primary patch manifest or additional manifest artifacts in the published configuration.
- A regional rollout changing at a different time from other regions.

It ignores launcher artwork, localized metadata, configuration ordering, and rotating query strings on the same manifest URL. It watches published release information, without inspecting your installed files or your customers' PCs.

The alert means **Riot's public live PC release configuration now points to a different downloadable package**. It does not establish whether particular memory offsets changed or whether the package has reached every player. Updates that do not change an exposed client manifest, server-only changes, and intermediate releases that appear and disappear between checks cannot be guaranteed detectable. Riot and CDN caching can also add delay beyond the nominal one-minute interval.

## Errors and recovery

- The checker retains the last good baseline when Riot returns an HTTP error, invalid JSON, missing regions, or an unexpected schema. It does not interpret an error page as an update.
- After three consecutive source failures it queues an outage notification. It sends a recovery message after a valid response returns and compares the recovered release with the last good baseline.
- Detected changes are persisted before Discord delivery. If Discord fails or rate limits requests, the alert stays queued and retries with backoff while release polling continues.
- A short database lease prevents normal overlapping scheduled and manual checks from sending the same queued alert concurrently.
- Delivery is **at least once**, not mathematically exactly once: if Discord accepts a message but its acknowledgement is lost, a retry can produce a duplicate. Event IDs in alert footers make those recognizable.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `node` or `npm` is not recognized | Install Node.js LTS, close the old terminal, and reopen the launcher. |
| Cloudflare login fails | Finish account/email verification, then rerun `npm run setup`. Allow Wrangler's browser login to finish. |
| Source returns HTTP 403 from the cloud | Run `npm run status` to confirm. Do not assume the watcher is healthy. This unofficial public endpoint can reject particular networks or change format; a different working source or host would need validation. Paying for Workers does not guarantee this endpoint will become accessible. |
| Discord returns 401 or 404 | Check that the webhook still exists and targets your channel. Rerun setup and paste a fresh webhook URL into the secret prompt. |
| Messages arrive, but no phone notification | Supply your user ID in setup; verify Discord and phone notification settings, including Do Not Disturb. |
| An alert appears twice after a network failure | Compare the footer event IDs. The sender retries when acknowledgement is uncertain. |
| No initial online message | Setup is not verified. Inspect its final error and run `npm run status`. Do not wait for a game patch to test delivery. |
| I want different regions or a different ping user | Rerun `npm run setup` in the same folder and change the corresponding answer. |
| I want to stop it | Cloudflare dashboard → Workers & Pages → this Worker → Settings → Triggers/Cron Triggers: remove the schedule. You can delete the Worker and its D1 database when you no longer need them. |

Setup does not select a paid plan. If your account is already on a paid Workers plan, normal account-level pricing applies. Your webhook can be rotated in Discord and replaced by rerunning setup. Regenerate the admin token by removing only `.watch-admin.json` and rerunning setup; this leaves the cloud baseline intact.

## Expected running cost

Target **$0/month on Workers Free** for a lightweight checker. One check per minute is 1,440 scheduled runs a day. The code keeps only a small state record and any pending alerts in D1; it does not download game binaries. The public release endpoint currently requires no API key. Discord webhook posting needs no paid bot subscription.

Cloudflare's published free allowances include 100,000 Worker requests/day, limited CPU per invocation, and a D1 allowance of 5 million rows read/day and 100,000 rows written/day. This workload is small, but production CPU usage and source accessibility must still be checked after deployment. The free tier has service limits; a paid upgrade is not a repair for a blocked Riot endpoint.

Official references checked October 29, 2026:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Discord webhooks](https://docs.discord.com/developers/resources/webhook)

## Implementation and validation

Runtime: Cloudflare Workers JavaScript module, one-minute Cron Trigger, D1 state storage, Discord incoming webhook. Wrangler is pinned in `package-lock.json`. There is no runtime npm dependency and no third-party VALORANT API key.

The live source used is:

```text
https://clientconfig.rpg.riotgames.com/api/v1/config/public?namespace=keystone.products.valorant.patchlines
```

The parser reads `keystone.products.valorant.patchlines.live.platforms.win.configurations`, selects `valid_shards.live`, and compares unique manifest IDs from `patch_url` and `patch_artifacts`. This public, unofficial interface can change; schema changes are treated as failures needing attention.

The fixture in `test/fixtures/riot-config.json` was reduced from an actual successful live response during development. Automated tests cover silent manifest changes, regions, startup baselines, restarts, SQL state persistence, failed Discord delivery, rate limits, source outages, recovery, rollback, overlapping checks, authenticated admin endpoints, and webhook validation. The build command bundles the Worker without publishing it:

```sh
npm test
npm run build
npm run test:runtime
```

The runtime smoke test runs the bundled Worker in Cloudflare's local Workers emulator with a real D1 binding. It checks baseline creation, a simulated new manifest, intercepted Discord delivery, the Cron handler, and health reporting. It never calls a real Discord webhook.

Live Riot reads succeeded during development. Your own Cloudflare deployment, browser authorization, real Discord webhook delivery, and notification settings require the setup wizard on your account; those cannot be certified before you connect them. No real Discord message was sent during development.

To make code changes after setup, edit the source, run the tests, and deploy using the generated configuration:

```sh
npx wrangler deploy --config wrangler.json
```

Do not use the example configuration to deploy a live service: it intentionally has checks disabled and a placeholder database ID.
