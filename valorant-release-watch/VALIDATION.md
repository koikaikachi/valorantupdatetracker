# Validation record — October 29, 2026

- 25 automated tests passed using Node.js 24.
- Wrangler 4.156.0 bundled the Worker successfully without deployment.
- The bundled Worker passed a Cloudflare Workers runtime smoke test with a real local D1 binding: startup baseline, simulated regional hotfix, intercepted Discord acknowledgement, scheduled handler, and healthy status.
- A live read of Riot's public configuration succeeded for NA, EU, AP, KR, BR, and LATAM. The actual reduced response is included as a test fixture.
- No real Discord webhook was called. No hosting account was connected or deployed during development.
- Cloud deployment, account login, real webhook delivery, and actual notification settings remain to be verified during the included setup wizard.

Reproduce with `npm ci`, `npm test`, `npm run test:runtime`, and `npm run probe`.
