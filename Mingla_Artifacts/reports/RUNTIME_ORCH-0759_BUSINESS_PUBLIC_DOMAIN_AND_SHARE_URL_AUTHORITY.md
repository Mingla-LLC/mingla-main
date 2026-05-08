# Runtime QA Report: Business Public Domain and Share URL Authority (ORCH-0759)

> Date: 2026-05-08  
> Mode: RUNTIME / DEPLOY GATE  
> Verdict: FAIL  
> Findings: P0:0 P1:2 P2:2 P3:0 P4:2

## 1. Layman Summary

The local ORCH-0759 fix is still clean, but the deployed `business.usemingla.com` site is not running that fixed build.

Runtime evidence shows the live Vercel deployment still serves an older bundle that contains the original wrong-domain behavior:

- Step 7 still has `mingla.com/e/...`.
- Event Detail share still has `https://business.mingla.com/e/...`.
- Public Brand page still has `https://business.mingla.com/b/...`.
- Cold `/e`, `/b`, and `/checkout` paths return Vercel `404 NOT_FOUND`.

This is a deployment/runtime gate failure, not proof that the local rework regressed. The immediate action is to deploy the current Mingla Business web build and re-run this runtime QA.

## 2. Inputs Reviewed

- Runtime prompt: `Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Retest report: `Mingla_Artifacts/reports/RETEST_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Local public event mapper and draft publish service for residual P2 classification.

## 3. Fixture / Preconditions

| Precondition | Result | Evidence |
|---|---|---|
| Current deployed build contains ORCH-0759 rework | FAIL | Deployed root references `entry-4ac6648f69eb06e336616cac8f847a9e.js`; current local export is `entry-4c91ffe6297b2ce01150c4367d530e7b.js`. SHA-256 differs: deployed `71c7ba4c...`, local `50a0f156...`. |
| Canonical env points at `https://business.usemingla.com` | PASS | Deployed bundle manifest includes `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL:"https://business.usemingla.com"`. |
| Safe public fixture available | BLOCKED | Read-only REST query to `business_public_events_view?select=id&limit=1` returned HTTP 200 with `[]`. |
| Public event/brand/checkout cold links can be tested with valid fixture | BLOCKED | No public fixture identifiers were available from the public view. |
| Read-only runtime testing only | PASS | Only `curl`, static bundle inspection, local static scans, and Supabase anon public-view reads were performed. No data mutation, payment, order creation, deploy, or DB push. |

## 4. Runtime URL Checks

### Root

```text
https://business.usemingla.com/
HTTP/2 200
server: Vercel
x-vercel-cache: HIT
last-modified: Fri, 08 May 2026 02:05:34 GMT
content-length: 37176
```

The root serves a web bundle, but it is stale relative to the current local ORCH-0759 export.

### Public Event Cold Path

```text
https://business.usemingla.com/e/__codex_probe__/__codex_probe__
HTTP/2 404
x-vercel-error: NOT_FOUND
body: The page could not be found
```

This was a probe path, not a valid event fixture. However, for ORCH-0759 route delivery, this still shows the current Vercel deployment is not rewriting cold dynamic `/e/.../...` paths into the Expo app shell.

### Public Brand Cold Path

```text
https://business.usemingla.com/b/__codex_probe__
HTTP/2 404
x-vercel-error: NOT_FOUND
body: The page could not be found
```

Probe path only, but it confirms cold `/b/...` route delivery is not active on the current deployment.

### Checkout Cold Path

```text
https://business.usemingla.com/checkout/__codex_probe__
HTTP/2 404
x-vercel-error: NOT_FOUND
body: The page could not be found
```

Probe path only, but it confirms cold `/checkout/...` route delivery is not active on the current deployment.

## 5. Deployed Bundle Inspection

The deployed root page loads:

```text
/_expo/static/js/web/entry-4ac6648f69eb06e336616cac8f847a9e.js
```

The current local export produced:

```text
mingla-business/dist/_expo/static/js/web/entry-4c91ffe6297b2ce01150c4367d530e7b.js
```

SHA evidence:

```text
deployed entry: 71c7ba4cd0b3d027a440bab77da34a3833183392229d8c2135017168f255409a
local entry:    50a0f156a159373f3527605c1d0d67097fef2fbac23f87955ed8701c0ab53afb
```

The deployed bundle still contains the original bad-domain runtime code:

| Runtime bundle evidence | Classification |
|---|---|
| `CreatorStep7Preview` string: `Tickets will go live at mingla.com/e/` | P1 stale deployed build; original user symptom still present in deployed bundle |
| Event Detail helper: `` `https://business.mingla.com/e/${e.brandSlug}/${e.eventSlug}` `` | P1 stale deployed build; original share bug still present in deployed bundle |
| Public Brand helper: `` `https://business.mingla.com/b/${e.slug}` `` | P1 stale deployed build; wrong public brand share/canonical URL still present in deployed bundle |

Important distinction: local `mingla-business/dist/_expo/...entry-4c91...js` contains the corrected `eventPublicUrl`/`brandPublicUrl` paths. The deployed stale bundle is the failing surface.

## 6. Deployed Share / Copy Behavior

**Result: FAIL / NOT SAFELY CLICKED**

I did not click through a real deployed event or brand share modal because no valid public fixture was available. But bundle inspection is enough to fail the runtime gate:

- Event Detail deployed share code still builds `https://business.mingla.com/e/...`.
- Public Brand deployed share/canonical code still builds `https://business.mingla.com/b/...`.
- Step 7 deployed ready copy still says `mingla.com/e/...`.

This means a user on the currently deployed site can still encounter the wrong-domain behavior if they reach those screens.

## 7. Local Regression Guard Recheck

Local source remains clean:

| Command | Result |
|---|---|
| `/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs --self-test` | PASS; intentional temp violation printed and caught; self-test exits 0. |
| `/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` | PASS; scanned 364 `.ts/.tsx` files, 0 violations, 0 read failures. |
| `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` | PASS; exit 1/no matches. |

Local/current export evidence:

- `mingla-business/dist/_expo/static/js/web/entry-4c91ffe6297b2ce01150c4367d530e7b.js` includes corrected `eventPublicUrl(...)` public URL authority.
- Local export route files were already proven in retest; this runtime pass did not rerun `expo export`.

## 8. Findings

### P1 High

**P1-001: Current deployed Mingla Business web build is stale and still contains the original wrong-domain runtime code**

- Evidence: deployed bundle `entry-4ac6648f69eb06e336616cac8f847a9e.js` contains `mingla.com/e/`, `https://business.mingla.com/e/...`, and `https://business.mingla.com/b/...`.
- Evidence: deployed bundle SHA differs from current local export bundle SHA.
- Impact: the user-facing symptom can still exist in production/runtime even though local source was fixed.
- Required action: deploy the current Mingla Business web build containing ORCH-0759 rework, then rerun this runtime QA.
- Rework classification: deploy/release issue first; do not send to implementor for code rework unless the freshly deployed current build still contains bad domains or cold routes still 404.

**P1-002: Current Vercel deployment does not serve cold dynamic public routes**

- Evidence: cold probes for `/e/__codex_probe__/__codex_probe__`, `/b/__codex_probe__`, and `/checkout/__codex_probe__` all return Vercel `HTTP/2 404` with `x-vercel-error: NOT_FOUND`.
- Impact: buyers clicking direct public event, brand, or checkout links may hit a platform 404 before the app can render the public route.
- Caveat: no valid public fixture exists in `business_public_events_view`, so I could not prove valid-fixture behavior. But the current deployment is already stale and route delivery is not ready enough to close.
- Required action: deploy current `vercel.json`/Expo export output and smoke valid fixture URLs.

### P2 Medium

**P2-001: Public schedule fidelity remains open**

- Evidence: `mingla-business/src/services/publicEventsService.ts:181-192` still maps `date`, `doorsOpen`, `endsAt`, and `multiDates` to `null`.
- Status: still open follow-on; not fixed by runtime.

**P2-002: Publish ticket sync atomicity remains open**

- Evidence: `mingla-business/src/services/eventDrafts.ts:42-56` soft-deletes old ticket rows before insert; `eventDrafts.ts:171-190` promotes after sync but does not make sync transactional.
- Status: still open follow-on; not fixed by runtime.

### P4 Notes

**P4-001:** Remote public view exists and is readable with anon credentials, but currently returns no public event fixture rows for read-only smoke.

**P4-002:** Local source regression guards still pass, so this report does not refute the prior local Conditional Pass.

## 9. Required Rework / Retest Path

Implementor code rework is **not the first next step** based on this evidence.

Required next sequence:

1. Deploy the current Mingla Business web build that contains ORCH-0759 rework.
2. Ensure Vercel serves cold dynamic routes for `/e`, `/b`, and `/checkout`.
3. Ensure at least one safe public event/brand/ticket fixture exists for read-only smoke.
4. Re-dispatch this same runtime tester prompt.

If the fresh deployment still contains bad-domain strings or still returns Vercel 404 for valid public fixtures, then ORCH-0759 needs implementor/deploy-config rework.

## 10. Close Decision

ORCH-0759 cannot move to close review.

Current status:

- Local/code retest: Conditional Pass.
- Runtime/deployed site: FAIL.
- Close blocker: stale deployed build plus cold dynamic route 404s.

Next lifecycle gate: deploy current business web build, then retest runtime.
