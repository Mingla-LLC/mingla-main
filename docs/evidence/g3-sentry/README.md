# G3 — Sentry live (#426 Tier 2)

**Gate:** G3 — Sentry live  
**Owner:** Platform  
**Status:** In progress (code + runbooks landed; operator secrets + proof pending)

## Evidence required (LAUNCH_GATES.md)

| Check | How to prove |
|-------|----------------|
| Org/project configured | Sentry project `mingla-business` in org `mingla-llc` |
| `EXPO_PUBLIC_SENTRY_DSN` in EAS | `eas env:list` shows DSN for preview + production |
| Edge fn errors visible | Trigger `logError` path → event in Sentry Issues |

## Operator setup

### 1. mingla-business native (EAS)

```bash
cd mingla-business

# DSN from Sentry → Settings → mingla-business → Client Keys
eas env:create --scope project --name EXPO_PUBLIC_SENTRY_DSN \
  --value "https://<key>@o4511136062701568.ingest.us.sentry.io/4511334517243904" \
  --environment preview

eas env:create --scope project --name EXPO_PUBLIC_SENTRY_DSN \
  --value "https://<key>@o4511136062701568.ingest.us.sentry.io/4511334517243904" \
  --environment production

# Source map upload (production builds only — eas.json already sets SENTRY_DISABLE_AUTO_UPLOAD=false)
eas env:create --scope project --name SENTRY_AUTH_TOKEN \
  --value "<sentry-auth-token>" --environment production --visibility secret
```

Local dev: copy DSN into `mingla-business/.env` from `.env.example`.

### 2. Supabase edge functions

```bash
export SUPABASE_ACCESS_TOKEN=...
export SENTRY_DSN="https://<key>@o4511136062701568.ingest.us.sentry.io/<edge-or-shared-project>"
./scripts/ops/deploy-g3-sentry.sh gqnoajqerqhnvulmnyvv
```

Edge functions using `logError` or `wrapEdgeHandler` automatically forward `Error` instances to Sentry when `SENTRY_DSN` is set.

### 3. Validation

**Native app**

1. Build with DSN configured (preview or production profile).
2. Temporarily add a dev-only throw or use ErrorBoundary test screen.
3. Confirm event in [Sentry mingla-business project](https://sentry.io).

**Edge**

1. Invoke a wrapped function with invalid input that hits `logError` (e.g. `ticket-checkout-status` with bad token).
2. Confirm issue tagged `runtime:supabase-edge` and `fn:<function-name>`.

## CI contract

```bash
node scripts/audit/g3-sentry-contract.mjs
```

## G1 deferral note

G1 (100k load test) deferred — discover scale blocked by Supabase edge saturation. Harness + partial evidence in `docs/evidence/g1-load/`.

## Close checklist for #426

- [ ] Sentry project URL pasted in #426 comment
- [ ] Screenshot: native test exception captured
- [ ] Screenshot: edge test exception captured
- [ ] `eas env:list` redacted screenshot or CLI output
- [ ] Mark G3 complete in LAUNCH_GATES.md (separate PR)
