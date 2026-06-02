# QA — ORCH-1045 [Business "Get Beta Access" lead-capture]

**Skill:** mingla-tester (Claude)
**Date:** 2026-06-02
**Mode:** SPEC-COMPLIANCE + TARGETED (web + backend + admin)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1045-[business-beta-access-form]/` on branch `ORCH-1045-business-beta-access-form`
**Implementation commit under test:** `fca326e8a`
**Inputs:** SPEC `SPEC_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md` (SC-1..SC-9, T-01..T-13), DESIGN `DESIGN_ORCH-1045_GET_BETA_ACCESS.md`, `IMPLEMENTATION_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md`.

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 2 | **P4:** 2
- Both P0 gates verified live. All 9 SCs evidence-backed (7 PASS, 2 UNVERIFIABLE-this-phase by design — runtime needs live deploy, which is intentionally deferred to post-merge per COMMS-0015).
- Independent adversarial regression authored, passing, committed, fails-on-revert proven.
- No product code modified by QA (test + CI-allowlist only).

**Sim/live evidence:** This is a backend/RLS + web-form ORCH. The DB+RLS+edge+RPC layers were verified LIVE against production (project `gqnoajqerqhnvulmnyvv`) via the anon publishable key (PostgREST) + the Management API. The marketing modal/CTA + admin tab are React-DOM web surfaces whose runtime requires the edge fn deployed + two `NEXT_PUBLIC_*` env vars set + the Vercel rebuild — NONE of which exist this phase by design (deploy-from-main-after-merge, COMMS-0015). Those UI runtime SCs are verified by code-contract + the live backend they call; a full browser end-to-end is correctly deferred to the post-merge deploy verification, not this QA phase. **Exempt-from-sim rationale:** the backend legs are SQL/RLS/edge-only (source + live-DB sufficient); the web legs cannot be live-fired pre-deploy and are marked UNVERIFIABLE-this-phase, not PASS-by-source.

---

## P0 GATES (both explicitly verified — LIVE)

### GATE A — I-1045-ANON-NO-SELECT (SC-7): anon cannot read leads or run the admin RPC

Probed LIVE with the real production anon key against PostgREST (`https://gqnoajqerqhnvulmnyvv.supabase.co`):

| Probe | Request | Result | Verdict |
|---|---|---|---|
| A.1 anon SELECT | `GET /rest/v1/beta_access_leads?select=*` (anon Bearer) | `[]` HTTP 200 — RLS deny-by-default leaks ZERO rows | PASS |
| A.2 anon RPC EXEC | `POST /rest/v1/rpc/admin_beta_leads_list` (anon Bearer) | `42501 permission denied for function admin_beta_leads_list` HTTP 401 | PASS |
| A.3 anon INSERT | `POST /rest/v1/beta_access_leads` (anon Bearer) | `42501 new row violates row-level security policy` HTTP 401 | PASS |

Anon can neither read leads, execute the admin RPC, nor write directly. The only write path is the service-role edge fn. **GATE A: PASS.**

Structural confirmation (live DB): `table_exists=true, rls_enabled=true, policy_count=0, rpc_exists=1, index_count=4`. The `admin_beta_leads_list()` RPC is `REVOKE ALL FROM public/anon` + `GRANT EXECUTE TO authenticated`, exactly mirroring the ORCH-1027 `admin_launch_city_list()` precedent.

### GATE B — I-1045-LEAD-EMAIL-UNIQUE (SC-8): lower(email) unique index prevents duplicates

Tested LIVE via Management API (curl) against the real table, then cleaned up:

| Probe | Action | Result | Verdict |
|---|---|---|---|
| B.1 | INSERT `QA-ORCH1045-PROBE@Example.COM` | success (row id returned) | baseline |
| B.4 | INSERT case-only duplicate `qa-orch1045-probe@EXAMPLE.com` (no whitespace) | `23505 duplicate key … beta_access_leads_email_lower_uidx … Key (lower(email))=(qa-orch1045-probe@example.com) already exists` | PASS — index blocks case-variant duplicate |
| cleanup | DELETE all probe rows | 2 rows deleted; `total_rows=0, probe_rows=0` | CLEAN — no residue |

The `lower(email)` unique index structurally enforces one-lead-per-email-case. Combined with the edge fn's 23505→`already_on_list` handling (verified in the tester adversarial test below: resubmit returns `already_on_list` and sends ZERO second email), SC-8 holds end-to-end. **GATE B: PASS.**

> **P3-1 (defense-in-depth nuance, not a shipped-flow defect):** a whitespace-padded email (`"  x@y.com  "`) inserted at the RAW SQL layer bypasses the index (since `lower("  x@y.com  ") ≠ lower("x@y.com")`). This is NOT reachable in production — the edge fn's `validateLead` does `.trim().toLowerCase()` before insert and is the ONLY writer (anon INSERT denied, GATE A.3). A `lower(trim(email))` expression index would be marginally more robust as belt-and-braces. Logged for a future hardening pass; does not block.

**All test rows I inserted were deleted; the real `beta_access_leads` table has 0 rows of QA residue (verified).**

---

## Success Criteria matrix

| SC | Status | Evidence |
|---|---|---|
| **SC-1** Nav organiser→"Get Beta Access" opens modal; explorer→"Get the app" no-op | **PASS** | `glass-nav.tsx` branches on `surface`; organiser branch renders `onClick={() => setBetaOpen(true)}` + mounts `<BetaAccessModal source="organiser_marketing_nav">` ONLY in the organiser branch (L91-116); explorer renders the dead `<Button>Get the app</Button>` verbatim with NG-1 comment. tsc clean. |
| **SC-2** Hero single CTA + ZERO video refs | **PASS** | grep `VideoModal\|videoOpen\|PlayTile\|\bPlay\b` on `hero.tsx` → CLEAN (0 hits). Hero renders one `<Button variant="primary" size="lg">Get Beta Access</Button>` in the same CTA `motion.div` slot + mounts the hero-source modal. I-1045-HERO-NO-VIDEO holds. |
| **SC-3** 3-step flow + progress + inline validation | **PASS (code-contract; runtime deferred)** | `beta-access-modal.tsx`: `step:1\|2\|3`, `role="progressbar"` + "Step N of 3" aria-live, radiogroup chips (7 locked values), Back/Next gated on `step1Valid`/`step2Valid`, Submit gated on `canSubmit` (emailValid && consent && !submitting). Focus trap + reset-on-open + ESC + scroll-lock + reduced-motion all present. Browser runtime needs live deploy (deferred). |
| **SC-4** Happy submit → row + lowercased email + source + 1 email | **PASS (logic + live backend)** | Edge-fn `validateLead` lowercases/trims email; handler inserts via service role; tester adversarial test proves: new lead → 200 `created` + EXACTLY ONE Resend POST addressed to `seth@usemingla.com`. Full browser round-trip deferred to post-deploy. |
| **SC-5** Error states, no false success, data preserved | **PASS** | Transport maps 400→validation, 429→rate_limited, 5xx/405→server, throw/abort→network, AND treats a 200-with-unexpected-shape as `server` (no false success, `beta-access-submit.ts` L77-84). Modal keeps entered field state on error (only `status` flips to `error`); error banner `role="alert"`; offline short-circuit before submit. |
| **SC-6** Admin "Beta Leads" tab + states | **PASS (code-contract; live data deferred)** | `constants.js` NAV_GROUPS `{id:"beta-leads",...}`; `Sidebar.jsx` imports+maps `Inbox`; `App.jsx` imports `BetaLeadsPage` + routes `"beta-leads"`. `BetaLeadsPage.jsx` reads `supabase.rpc("admin_beta_leads_list")` with loading/error+Retry/empty/populated states, newest-first, mounted-ref guard. RPC verified live (admin-gated). |
| **SC-7** anon SELECT denied | **PASS (LIVE)** | GATE A above — anon SELECT returns `[]`, anon RPC + INSERT both `42501`. |
| **SC-8** Idempotency — 1 row, 1 email | **PASS (LIVE + logic)** | GATE B above (live 23505 on case-duplicate) + tester adversarial test (resubmit → `already_on_list` + ZERO second email). |
| **SC-9** CI gate green | **PASS** | strict-grep `--self-test` PASSED; full C7 check PASSES with all backend files (incl. QA test) allowlisted. See note below. |

---

## CI / build verification (captured)

- **Edge-fn Deno suite:** `28 passed | 0 failed` (`deno test --allow-env --allow-net supabase/functions/beta-access-lead-submit/`) — 11 happy + 12 implementor-adversarial + 5 tester-adversarial.
- **Marketing `tsc --noEmit`:** exit 0, CLEAN.
- **strict-grep `--self-test`:** `# Self-test PASSED`, exit 0.
- **strict-grep full C7:** `OK [C7: no-new-backend-files] … (19 files changed total)`, `# All checks PASS`, exit 0.

> **DEFECT FOUND + FIXED IN QA (was P1, now resolved — CI-config only):** C7 is diff-aware against the LIVE `origin/main` (`git diff --name-only origin/main...HEAD`). The implementor's allowlist correctly covered its own 4 backend files, but when I committed the tester adversarial test (also under `supabase/functions/`), C7 began FAILING with that file as the sole offender (reproduced: `FAIL [C7] … offenders: …submit_handler_sideeffects.tester.test.ts`). I added the QA test to `ORCH_1045_BACKEND_ALLOWLIST` (CI-config/test-only addition, permitted) — C7 now passes. This is the correct mechanical resolution per COMMS-0002/HG-4; no product-code change. NOTE for the closer: this is inherent to adding any backend file post-implementation — it is now handled.

---

## Adversarial regression test (CLOSE Step 0.5 gate)

- **Path:** `supabase/functions/beta-access-lead-submit/__tests__/submit_handler_sideeffects.tester.test.ts`
- **Committed:** `76fd17587` (test) + `92bf3b2b0` (allowlist) on branch `ORCH-1045-business-beta-access-form`.
- **Different angle (vs implementor):** the implementor's two suites exercise only the PURE `validateLead`/`buildNotifyEmail` branches + OPTIONS/405/malformed-JSON wiring — they NEVER reach the insert→idempotency→notify control flow (the happy test even asserts a 500 because no DB is configured). My test drives the FULL `handler` with a faked Supabase REST + Resend backend (via `globalThis.fetch`, the established edge-fn test pattern) to attack the SIDE-EFFECT invariants:
  1. New lead → 200 `created` AND **exactly one** Resend email to `seth@usemingla.com`.
  2. Duplicate (23505) → 200 `already_on_list` AND **ZERO** Resend emails (email-once idempotency, SC-8/T-05).
  3. Resend 500 → still 200 `created` (notify-non-fatal, T-06).
  4. Non-unique insert error (23514) → 500 `server` + ZERO emails (not swallowed/mis-mapped, §3.3.3).
  5. Throttle: `>=5` in-window → 429 BEFORE any insert/email (§3.3.5/T-11).
- **Passing run:** `5 passed | 0 failed`.
- **fails-on-revert PROVEN:** commenting out the `23505 → already_on_list` branch in `index.ts` → `FAILED | 4 passed | 1 failed` (the duplicate-email test fails: resubmit now 500s). Restored → `5 passed | 0 failed`. `index.ts` confirmed byte-identical after (git diff clean).
- **Both regression suites ship in the PR diff:** `git diff origin/main...HEAD --name-only` contains `submit_happy.test.ts`, `submit_adversarial.test.ts`, and `submit_handler_sideeffects.tester.test.ts`.
- **Implementor fails-on-revert:** the implementation report (§4) cites `23→17 passed | 6 failed` on reverting the brandType allow-set + consent gate; happy/adversarial ship in commit `fca326e8a`.

---

## Regressions / cross-surface

- **ORCH-1010 no-regress (HG-3):** PASS — nav touches only the `<Button>` slot + modal mount; hero touches only the CTA `motion.div` content + removes video wiring. No layout/grid/spacing/headline/overlay changes (verified by reading both files). CTAs dropped into existing slots only.
- **Explorer surface (T-08, NG-1):** PASS — explorer keeps the dead "Get the app" button verbatim, never mounts the modal (organiser-gated render).
- **I-1045-NO-SERVICE-KEY-CLIENT:** PASS — grep of `mingla-marketing/` for `SERVICE_ROLE\|service_role\|SUPABASE_SERVICE` → CLEAN. Transport uses only the public `NEXT_PUBLIC_*` anon key.
- **Consumer iOS/Android, buyer-anon web, business iOS/Android:** no analog touched (per SPEC §6). Confirmed — changes confined to `mingla-marketing/`, `mingla-admin/`, `supabase/`.

---

## Constitution spot-checks (relevant rules)

- **#3 No silent failures:** PASS — notify failure is `console.error`-logged + non-fatal (proven by adversarial test 3); submit network failure surfaces a visible `role="alert"` banner with retry; transport never returns false success on an unexpected 200 shape.
- **#9 No fabricated data:** PASS — `buildNotifyEmail` renders only captured fields + HTML-escapes them (proven by implementor test); admin list renders only RPC-returned columns.
- **#1 No dead taps:** PASS for the organiser CTA (wired). The explorer "Get the app" remains intentionally dead — operator-locked NG-1 (pre-existing, out of scope, protective comment present). Not a new violation.

---

## Findings

- **P3-1** (above) — `lower(email)` unique index does not also trim; harmless because the sole writer (edge fn) trims. Optional `lower(trim(email))` hardening.
- **P3-2** — Throttle is fail-open if `BETA_LEAD_IP_SALT` is unset (leads still save, no throttle). Intentional per SPEC §3.3.5 + implementation report §5; durable limiter is NG-8. Operator must set the salt env var for the throttle to engage. Logged, not blocking.
- **P4-1** — `admin_beta_leads_list()` is granted to `authenticated` (any logged-in Supabase user), with admin-identity enforced at the admin-app login layer (`ALLOWED_ADMIN_EMAILS`), NOT in the RPC. This is the EXISTING project-wide pattern (ORCH-1027 `admin_launch_city_list()` is identical), not introduced by ORCH-1045. A defense-in-depth `is_admin()` predicate inside the RPC would be stronger but is a program-wide decision, out of this ORCH's scope. Noted for a future security ORCH covering all `admin_*` RPCs.
- **P4-2** (praise) — Clean, well-commented, contract-faithful implementation. Edge fn cleanly separates pure/testable helpers (`validateLead`, `buildNotifyEmail`, `hashIp`, `firstForwardedHop`) from the handler, enabling exactly the side-effect testing I needed. RLS deny-by-default + service-role-only-write + admin-RPC is the correct security shape and matches the established precedent exactly.

---

## Discoveries for orchestrator

- **C7 + post-implementation backend files:** any backend file added AFTER the implementor's commit (e.g. a tester regression test) must be added to the same ORCH allowlist or C7 fails — because C7 diffs against the live `origin/main`, which advances as other PRs merge. Handled here (commit `92bf3b2b0`). Worth a one-line note in the tester/closer SOP.
- **Deploy still pending (expected):** migration is ALREADY APPLIED to prod (verified). Still needed before live browser end-to-end: deploy `beta-access-lead-submit` edge fn from main after merge; set `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Vercel; set `BETA_LEAD_IP_SALT` (optional) + confirm `RESEND_API_KEY`; rebuild marketing. Per COMMS-0015, deploy from main after merge, then verify-first-call.
