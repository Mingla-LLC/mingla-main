# G3–G5 operator close-out pack (#426)

Engineering scaffolding is on `main` (contracts green via `scripts/audit/run-all.mjs`).  
**These gates close only when the operator steps below produce evidence files.**

## G3 — Sentry live

Follow [`docs/evidence/g3-sentry/README.md`](./g3-sentry/README.md):

1. `eas env:create` for `EXPO_PUBLIC_SENTRY_DSN` (preview + production) + `SENTRY_AUTH_TOKEN` (production).
2. `./scripts/ops/deploy-g3-sentry.sh <project-ref>` with edge `SENTRY_DSN`.
3. Proof screenshots → paste on #426 + tick G3 close checklist.

## G4 — DR restore

Follow [`docs/runbooks/DR_RESTORE.md`](../runbooks/DR_RESTORE.md) — **restore-to-new-project clone only** (never in-place on the authority production project).

```bash
./scripts/ops/g4-dr-restore-drill.sh start
# …dashboard restore…
./scripts/ops/g4-dr-restore-drill.sh mark restore-complete
./scripts/ops/g4-dr-restore-drill.sh verify
./scripts/ops/g4-dr-restore-drill.sh finish
```

Commit the JSON under `docs/evidence/g4-dr-restore/reports/`.

## G5 — Synthetic incident

Prerequisite: G3 alert rule → Slack/email.

```bash
./scripts/ops/g5-synthetic-incident-drill.sh start
node scripts/ops/inject-g5-synthetic-alert.mjs
./scripts/ops/g5-synthetic-incident-drill.sh mark alert-received
./scripts/ops/g5-synthetic-incident-drill.sh mark acknowledged
./scripts/ops/g5-synthetic-incident-drill.sh finish
```

## Blockers from the engineering session (2026-09-10)

- No EAS / Supabase Management / Sentry org credentials in this agent environment.
- Outbound HTTPS to `host.usemingla.com` returned 403 from the runner network (CDN live verify deferred to operator laptop).
