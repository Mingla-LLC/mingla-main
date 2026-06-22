# IMPLEMENT — ORCH-1205 [edge-function CORS missing `x-client-info` → team/scanner invites broken on web]

**Status:** implemented and verified (source + Deno test + `deno check`; not deployed — orchestrator/operator deploys from merged main).
**Worktree:** `~/Desktop/mingla-orchs/1205-[edge-cors-x-client-info]/` on branch `1205-edge-cors-x-client-info`.
**Base:** rebased onto `origin/main` (up to date at start).

---

## 1. Summary

`supabase-js` attaches an `x-client-info` request header on EVERY call. Eight edge functions
hardcoded an incomplete CORS allow-list (`"authorization, apikey, content-type"`, and one with
`"authorization, content-type"`) that omitted `x-client-info`. As a result the browser CORS
**preflight (OPTIONS)** from `business.usemingla.com` was rejected
(`Request header field x-client-info is not allowed by Access-Control-Allow-Headers`) and every
fetch to those functions failed with `net::ERR_FAILED` — breaking team/scanner invite listing,
sending, accepting, and declining on web (proven live on Seth's Samsung).

Fix: each function now serves the shared `_shared/cors.ts` allow-list, which already includes
`x-client-info` (and `accept-language`). The shared object uses
`Access-Control-Allow-Methods: "POST, OPTIONS"` — **identical** to every changed function's prior
methods — so the only behavioral change is the widened allow-headers. No auth, no methods, no
response shape, no business logic touched. config.toml (and every `verify_jwt` value) untouched.

---

## 2. SPEC success-criteria coverage

| ID | Criterion | Result | Commit |
|----|-----------|--------|--------|
| SC-1 | All 7 browser-called functions include `x-client-info` in their CORS allow-headers | ✓ verified (detector empty; 9/9 test) | `<commit>` |
| SC-2 | Cron-only `process-booking-deadlines` aligned for consistency | ✓ verified | `<commit>` |
| SC-3 | Methods, `verify_jwt`, response shape, business logic unchanged | ✓ verified (diff = allow-headers only; config.toml untouched; methods stay `POST, OPTIONS`) | `<commit>` |
| SC-4 | Regression test asserts each fixed function serves `x-client-info`; fails-on-revert | ✓ 9/9 pass; RED on true-deletion revert | `<commit>` |

`<commit>` = closing commit hash (recorded in §6 after commit).

---

## 3. Files changed

| File | Δ | Change |
|------|---|--------|
| `supabase/functions/accept-scanner-invitation/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/invite-brand-member/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/list-my-pending-invites/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/beta-access-lead-submit/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/invite-scanner/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/decline-brand-invitation/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/accept-brand-invitation/index.ts` | ±~11 | import shared `corsHeaders`, delete local object |
| `supabase/functions/process-booking-deadlines/index.ts` | ±~13 | import shared `corsHeaders`, replace inline OPTIONS object |
| `supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfo.test.ts` | +new | regression test (9 cases) |

8 functions changed, 41 insertions / 49 deletions; +1 test file.

**No local object kept anywhere** — all 8 now use the shared `_shared/cors.ts`. The shared object's
methods (`POST, OPTIONS`) matched every function's pre-existing methods, so no method regression
risk and no need to retain a local object. (The cron function's prior allow-list lacked `apikey`;
the shared one adds it — purely additive on an OPTIONS preflight, and that function is
service-role-only / never browser-called, so no behavior change.)

---

## 4. Data-model changes applied

None. No migration, no schema, no RLS change.

---

## 5. Edge functions touched (for orchestrator/operator deploy from MERGED main)

Deploy list — each `verify_jwt` value to PRESERVE (unchanged by this work):

| Function | verify_jwt | Browser-called? |
|----------|-----------|-----------------|
| `list-my-pending-invites` | true | yes (THE bug) |
| `invite-brand-member` | true | yes |
| `invite-scanner` | true | yes |
| `accept-brand-invitation` | true | yes |
| `decline-brand-invitation` | true | yes |
| `accept-scanner-invitation` | true | yes |
| `beta-access-lead-submit` | false | yes (public marketing form) |
| `process-booking-deadlines` | (default true; service-role-checked internally) | no (cron) |

config.toml was NOT modified; the table reflects existing values.

---

## 6. Regression tests added

- Path: `supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfo.test.ts` (9 test cases).
- Run: `deno test --allow-read <path>` → **9 passed | 0 failed**.
- **fails-on-revert proof (true line deletion, not comment-out):** reverted
  `list-my-pending-invites/index.ts` to its ORIGINAL buggy inline object
  (`"authorization, apikey, content-type"`, no `x-client-info`, shared import removed) and re-ran:
  test **FAILED 8 passed | 1 failed** with
  `AssertionError: list-my-pending-invites must allow x-client-info … via-shared=false, inline-ok=false.`
  Restored the fix → **9 passed | 0 failed**.
  `fails-on-revert verified at <commit>` (closing commit hash, §below).

Test design: case (1) pins `_shared/cors.ts` (single source of truth) to include `x-client-info` +
`accept-language`; cases (2..9) assert each fixed function's source either imports the shared cors
OR has an inline allow-headers literal that itself contains `x-client-info` — and explicitly REJECTS
a hardcoded inline allow-list that omits it (the exact bug shape).

---

## 7. Old → New receipts

### All 7 invite/scanner/lead functions (identical change)
- **Before:** local `const corsHeaders = { "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", ... }` — preflight rejected `x-client-info`.
- **Now:** `import { corsHeaders } from "../_shared/cors.ts";` (allow-headers `"authorization, x-client-info, apikey, content-type, accept-language"`, same `POST, OPTIONS`).
- **Why:** ORCH-1205 — supabase-js sends `x-client-info` on every browser request; the bare allow-list blocked the preflight.
- **Lines:** ~11 each (import + comment in, local object out).

### process-booking-deadlines/index.ts
- **Before:** inline OPTIONS object `"Access-Control-Allow-Headers": "authorization, content-type"` (no `x-client-info`, no `apikey`).
- **Now:** `return new Response("ok", { headers: corsHeaders })` using shared `_shared/cors.ts`.
- **Why:** consistency alignment (cron-only, service-role; not the live bug but kept off the bad pattern).
- **Lines:** ~13.

---

## 8. Cross-surface impact table

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Buyer/anonymous Web (business web) | YES | invite/scanner list/send/accept/decline + beta-access form now pass CORS preflight; parity automatic (single edge-function backend) |
| Business iOS | NO | native fetch is not subject to browser CORS preflight; the wider allow-list is harmless |
| Business Android | NO | same as iOS |
| Consumer iOS | NO | functions are business-side |
| Consumer Android | NO | same |
| Admin Web (adjacent) | NO | does not call these functions |
| Business Web preview (adjacent) | YES | same fix as production web |

Parity is automatic across all surfaces — one shared edge-function backend; no per-surface code path.

---

## 9. Smoke result

- `deno test --allow-read supabase/functions/_shared/__tests__/orch1205InviteCorsXClientInfo.test.ts` → 9 passed, 0 failed.
- `deno check` on all 8 changed functions → all `Check … index.ts` clean, zero errors.
- Detector `for f in $(grep -rln "Access-Control-Allow-Headers" supabase/functions); do … x-client-info … || echo "$f"; done` → EMPTY (no function omits `x-client-info`).
- Live browser preflight not re-run from this session (orchestrator already proved the failure live on Samsung; the source-level fix is verified). Real-user confirmation comes after the orchestrator/operator deploys from merged main.

---

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` markers. No deferred items.

---

## 11. Operator action required

- **No migration.** No `db push`.
- **Deploy (orchestrator/operator, from MERGED main — NOT this worktree):** redeploy the 8 functions
  listed in §5, preserving each `verify_jwt`. No `eas update` (COMMS-0052/0051 business + consumer
  OTA freezes are irrelevant here — this is backend-only).
- **Do NOT** narrow `_shared/cors.ts` — it is now the single source of truth for these functions.

---

## 12. Discoveries for Orchestrator

- A broader sweep (out of scope, not changed): other edge functions may still hardcode their own
  CORS objects rather than importing `_shared/cors.ts`. The detector above flagged ONLY these 8 as
  missing `x-client-info`; any future function that hardcodes the bare list will reintroduce this
  class of bug. Consider a strict-grep CI gate that fails any `supabase/functions/**/index.ts` whose
  `Access-Control-Allow-Headers` omits `x-client-info`. Filed as a discovery, not implemented (scope).
- COMMS handled this turn: acknowledged COMMS-0052 (BLOCK, ALL — business OTA freeze): N/A by
  compliance, this ORCH is backend-only and performs no `eas update`/deploy.
