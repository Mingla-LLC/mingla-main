# IMPLEMENTATION — ORCH-1045 [Business "Get Beta Access" lead-capture]

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1045-[business-beta-access-form]/` on branch `ORCH-1045-business-beta-access-form`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md`
**Design:** `Mingla_Artifacts/specs/DESIGN_ORCH-1045_GET_BETA_ACCESS.md`
**Status:** implemented and verified (typecheck + Deno tests + strict-grep self-test green; fails-on-revert proven). Migration + edge-fn deploy PENDING orchestrator/operator.

---

## 0. Comms Ledger

Read on entry. No BLOCK entry targets ORCH-1045 or mingla-implementor. Two WARN entries apply and were already factored by the SPEC:
- **COMMS-0002** (WARN, ALL) — ORCH-0863 strict-grep `C7: no-new-backend-files`. Handled: §3.6 allowlist edit lands in the SAME commit as the migration + edge fn (see "Strict-grep" below).
- **COMMS-0003** (WARN, ALL) — external-API docs cited inline. Handled: Resend `POST /emails` + Supabase invoke/RLS docs cited in code comments and below.

No new cross-ORCH discovery → no new COMMS entry written.

---

## 1. Build summary (all 8 items)

| # | Item | File(s) | Done |
|---|---|---|---|
| 1 | Nav CTA branch (organiser → "Get Beta Access"; explorer untouched) | `mingla-marketing/components/marketing/glass-nav.tsx` | ✅ |
| 2 | Hero CTA swap + full video removal | `mingla-marketing/components/sections/organiser-home/hero.tsx` | ✅ |
| 3 | `BetaAccessModal` 3-step form, all states, locked copy, focus trap, reset-on-open | `mingla-marketing/components/marketing/beta-access-modal.tsx` (new) | ✅ |
| 4 | Client transport + public edge fn | `mingla-marketing/lib/beta-access-submit.ts` (new), `mingla-marketing/.env.example` (new), `supabase/functions/beta-access-lead-submit/index.ts` (new), `supabase/config.toml` | ✅ |
| 5 | DB migration + RLS (anon INSERT via edge fn only; anon SELECT denied; lower(email) idempotency) | `supabase/migrations/20260817000000_orch_1045_beta_access_leads.sql` (new) | ✅ |
| 6 | Resend email notify (non-fatal) | inside `beta-access-lead-submit/index.ts` | ✅ |
| 7 | Admin "Beta Leads" tab (Launch Cities pattern) | `mingla-admin/src/lib/constants.js`, `…/components/layout/Sidebar.jsx`, `…/App.jsx`, `…/pages/BetaLeadsPage.jsx` (new) | ✅ |
| 8 | Strict-grep allowlist (same commit as backend) | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | ✅ |

---

## 2. Old → New receipts

### glass-nav.tsx
- **Before:** single dead `<Button variant="glass" size="sm">Get the app</Button>` rendered for BOTH surfaces, no handler.
- **Now:** branches by `surface`. explorer → unchanged dead "Get the app" (NG-1 comment added). organiser → "Get Beta Access" with `onClick`, `aria-haspopup="dialog"`, `aria-expanded`; mounts `<BetaAccessModal source="organiser_marketing_nav">` (organiser only). Added `betaOpen` state + modal import.
- **Why:** SC-1, I-1045-ORGANISER-ONLY-CTA.
- **Lines:** ~30.

### hero.tsx
- **Before:** imported `Play` + `VideoModal`; held `videoOpen` state; rendered a `PlayTile` video-launch tile in the CTA `motion.div` + a `<VideoModal>`.
- **Now:** removed `PlayTile`, `Play`, `VideoModal`, `videoOpen`, `<VideoModal>`. CTA slot renders a single `<Button variant="primary" size="lg">Get Beta Access</Button>` (+ `ArrowRight`) and a `Free during beta. Two minutes to join.` reassurance line. Mounts `<BetaAccessModal source="organiser_marketing_hero">` where the video modal was. Zero video references remain (verified by grep).
- **Why:** SC-2, I-1045-HERO-NO-VIDEO. Same CTA `motion.div` slot (no layout restructure — HG-3).
- **Lines:** −40 / +18.

### beta-access-modal.tsx (NEW)
- 3-step accessible modal. Modal shell mirrors `video-modal.tsx` (AnimatePresence + ESC + body-scroll-lock + role=dialog) and ADDS a focus trap + reset-on-open. Step 1 chip radiogroup (7 locked options, pointer auto-advance, keyboard Next). Step 2 three text fields. Step 3 email + consent. Submit → transport → success/already-on-list/error states. Backdrop-click ignored while submitting; in-flight submit aborted on close. Reduced-motion honored. All copy LOCKED to DESIGN §11.
- **Why:** SC-3, SC-4, SC-5, all 9 states (DESIGN §6).
- **Lines:** ~620.

### lib/beta-access-submit.ts (NEW)
- Raw `fetch` POST to `${NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL}/beta-access-lead-submit` with `Authorization: Bearer <anon>` + `apikey` + `Content-Type`. Maps 200→`created`/`already_on_list`, 400→`validation`, 429→`rate_limited`, 5xx/405→`server`, throw/abort→`network`. Guards missing env. No service-role key (I-1045-NO-SERVICE-KEY-CLIENT).
- **Why:** SC-4/SC-5 transport contract (SPEC §3.3.2).

### .env.example (NEW)
- Documents `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the app had none — A-2). Both public by design.

### supabase/functions/beta-access-lead-submit/index.ts (NEW)
- Public edge fn (`verify_jwt=false`). Server re-validates EVERY field (7-value brand_type allow-set, 2-value source set, `consent===true`, email regex+length, text trim+length). Salted-IP-hash soft throttle (≥5 in 10 min → 429; fail-open on throttle read error). Service-role insert (bypasses RLS). Idempotent on `lower(email)` unique index → 23505 → `already_on_list` (no second email). Best-effort Resend notify on NEW lead only; failure logged + non-fatal (Constitution #3). Persists truncated `user_agent`/`referer`; never stores raw IP.
- **Why:** SC-4, SC-7, SC-8, T-02/03/06/10/11.

### supabase/config.toml
- Added `[functions.beta-access-lead-submit]` / `verify_jwt = false` (mirror check-launch-city). ~6 lines.

### migration 20260817000000_orch_1045_beta_access_leads.sql (NEW)
- Table `beta_access_leads` with all columns + CHECK constraints per SPEC §3.4. Unique index `lower(email)` (structural I-1045-LEAD-EMAIL-UNIQUE). `created_at desc` + `(ip_hash, created_at desc)` indexes. RLS enabled with NO anon/authenticated policies (deny-by-default → anon SELECT denied, SC-7). Admin read via `admin_beta_leads_list()` SECURITY DEFINER RPC, EXECUTE granted to `authenticated` only (anon/PUBLIC revoked) — mirrors ORCH-1027 `admin_launch_city_list()`. Protective header comment warns against adding an anon SELECT policy.
- **Why:** SC-7, SC-8, admin read path.

### mingla-admin (constants.js, Sidebar.jsx, App.jsx — edits)
- `constants.js`: NAV_GROUPS gains `{ id:"beta-leads", label:"Beta Leads", icon:"Inbox" }` next to Email.
- `Sidebar.jsx`: imported `Inbox` from lucide-react + added to `ICON_MAP`.
- `App.jsx`: imported `BetaLeadsPage` + added `"beta-leads": BetaLeadsPage` to PAGES.

### mingla-admin/src/pages/BetaLeadsPage.jsx (NEW)
- Read-only list mirroring LaunchCitiesPage. Reads `supabase.rpc("admin_beta_leads_list")`. States: loading (skeletons), load-error (`AlertCard` + Retry + error toast), empty ("No beta leads yet."), populated (DataTable newest-first). Columns: Business (name + brand_type badge), Contact, City, Email (mono, copy-on-click → "Email copied" toast), Source badge, Received (relative + UTC `title` tooltip, sortable). Summary chips: Total leads + This week. Mounted-ref guard. No edit/delete (NG-6).
- **Why:** SC-6, T-13.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
- Added `ORCH_1045_BACKEND_ALLOWLIST` (migration + edge fn + 2 Deno tests) and spread it first into `ALLOWLIST`. Same commit as backend files (HG-4, COMMS-0002).

---

## 3. Spec traceability (success criteria)

| SC | Implemented by | Verification | Status |
|---|---|---|---|
| SC-1 nav organiser/explorer branch | glass-nav.tsx | code + tsc clean; explorer branch unchanged | PASS |
| SC-2 hero single CTA + no video | hero.tsx | grep `VideoModal|videoOpen|PlayTile|\bPlay\b` → CLEAN; tsc clean | PASS |
| SC-3 3-step flow + progress + validation | beta-access-modal.tsx | code review; tsc clean | PASS (UI runtime unverified — see §6) |
| SC-4 happy submit (row + lowercased email + source + 1 email) | modal + transport + edge fn + migration | Deno tests (validateLead normalises email; buildNotifyEmail to seth@usemingla.com); full-stack runtime pending deploy | PASS (logic) / runtime PENDING deploy |
| SC-5 error states, no false success, data preserved | modal + transport | transport maps to error union; modal keeps state on error; Deno handler tests | PASS (logic) |
| SC-6 admin tab + states | BetaLeadsPage + nav wiring | code review; lints clean | PASS (runtime pending live data) |
| SC-7 anon SELECT denied | migration RLS (no policy) | RLS deny-by-default (docs cited); SECURITY DEFINER RPC for admin | PASS (structural) — DB apply PENDING |
| SC-8 idempotency (1 row, 1 email) | unique lower(email) index + 23505 handling | structural index + edge fn branch; Deno test of validator | PASS (structural) — DB apply PENDING |
| SC-9 CI gate green | strict-grep allowlist | `--self-test` PASSED; allowlist includes 4 backend files | PASS |

---

## 4. Regression test (CLOSE Step 0.5 gate)

- **Paths:**
  - `supabase/functions/beta-access-lead-submit/__tests__/submit_happy.test.ts` (11 tests)
  - `supabase/functions/beta-access-lead-submit/__tests__/submit_adversarial.test.ts` (12 tests)
- **Passing run (fixed code):** `23 passed | 0 failed` via
  `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/beta-access-lead-submit/`
- **Fails-on-revert verified:** commenting out the `brandType` allow-set check AND the `consent===true` gate in `index.ts` → `17 passed | 6 failed` (T-02 ×3, T-10, non-string-types, handler-invalid-payload all FAIL). Restored → `23 passed`. The revert was done on the working tree at the pre-commit HEAD of the branch; the captured failing run is in the implementation chat transcript. (fails-on-revert verified against the committed edge-fn fix.)
- These tests exercise the lead validation/insert contract (the SPEC's mandated happy-path lead-insert/validation) at the pure-logic + handler layer; they ship in the SAME commit as the fix.

---

## 5. Deploy / apply status (for orchestrator + operator)

### Migration — NOT applied (per HG-6 + memory `project_migration_history_drift_db_push_unsafe.md`)
The migration is authored only. I did NOT run `db push` and did NOT apply via MCP (parity rule #11). Migration history is drifted; apply surgically.

- File: `supabase/migrations/20260817000000_orch_1045_beta_access_leads.sql`
- Version collision re-scanned 2026-06-02: highest claimed prefix across all sibling worktrees + origin/main is `20260816000000` (ORCH-1034 + ORCH-1043). `20260817000000` is free and strictly greater → no collision (HG-2).
- **Apply options for operator:**
  - Surgical Management-API path (project ref `gqnoajqerqhnvulmnyvv`; Bearer token in `~/.claude.json`) + INSERT the version into `schema_migrations`, OR
  - From the worktree after merge: `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1045-[business-beta-access-form]" && /Users/sethogieva/bin/supabase db push --linked` — only if `migration list --linked` shows no remote-only rows; otherwise use the surgical path.

### Edge function — NOT deployed (pending orchestrator deploy after merge)
- Deploy: `supabase functions deploy beta-access-lead-submit --project-ref gqnoajqerqhnvulmnyvv`
- Verify-first-call after deploy: a curl to the fn URL must return non-404 (e.g. an OPTIONS or a 400 on empty body).
- Deno gate run in this session: `deno check` clean; `deno test` 23/23 green.

### Env vars needed (operator)
- **Marketing app (Vercel):** `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` (e.g. `https://gqnoajqerqhnvulmnyvv.functions.supabase.co`) + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both public.
- **Edge fn secrets (Supabase):** `RESEND_API_KEY` (already configured, A-4); `BETA_LEAD_IP_SALT` (NEW — add any random string for the throttle hash; if absent the throttle is skipped, fail-open, leads still save); optional `RESEND_BETA_FROM` (defaults to `Mingla Beta <beta@usemingla.com>`; falls back to `RESEND_MARKETING_FROM`). `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

---

## 6. Verification matrix

- `tsc --noEmit` (mingla-marketing): CLEAN.
- Deno `check` + `test` (edge fn): CLEAN / 23 passed.
- strict-grep `--self-test`: PASSED.
- ESLint (mingla-admin): `BetaLeadsPage.jsx` clean; the 2 reported errors (App.jsx `motion` unused L2, Sidebar.jsx `useCallback` inline-fn L58) are PRE-EXISTING on origin/main (confirmed via `git show origin/main:…`) — not introduced by ORCH-1045; my edits to those files only added an import + a route/icon entry.
- **UNVERIFIED (runtime, needs live deploy + manual browser test):** SC-3 modal interaction flow, SC-4 full-stack happy submit + email receipt, SC-6 admin list with live rows. These require the migration applied + edge fn deployed + the two `NEXT_PUBLIC_*` env vars set. Marketing lint via `next lint` is not configured (interactive prompt); `tsc` covers type-correctness.

---

## 7. Cross-surface impact (Phase 2.5)

Per SPEC §6: only Marketing Web (organiser) + Admin Web + Backend are touched. Consumer iOS/Android, buyer-anon web, business iOS/Android: NOT affected (no analog). The two UI surfaces are separate codebases (no shared-code auto-parity); each has its own SC. Explorer marketing surface: unchanged (NG-1).

---

## 8. Invariants

- I-1045-ORGANISER-ONLY-CTA — ✅ (glass-nav branches on `surface`; modal mounts organiser-only).
- I-1045-HERO-NO-VIDEO — ✅ (grep CLEAN).
- I-1045-ANON-NO-SELECT — ✅ (RLS enabled, no anon policy; admin via SECURITY DEFINER RPC).
- I-1045-LEAD-EMAIL-UNIQUE — ✅ (structural unique index on lower(email)).
- I-1045-NO-SERVICE-KEY-CLIENT — ✅ (transport uses only anon key; no service key in `mingla-marketing/**`).
- Existing: ORCH-1010 hero/nav layout preserved (CTAs in existing slots only, HG-3); Constitution #3 (non-fatal notify, visible submit errors); Constitution #9 (admin + email render only captured fields); COMMS-0002 strict-grep preserved.

---

## 9. Deviations

- **Admin read path:** SPEC §3.4 allowed either direct table SELECT under an admin predicate OR a mirrored RPC. There is no `is_admin()` predicate in the project; the established admin-only-read pattern is a SECURITY DEFINER RPC gated by `GRANT EXECUTE … TO authenticated` (ORCH-1027 `admin_launch_city_list()`). I mirrored THAT exactly (`admin_beta_leads_list()`), and the admin page calls `supabase.rpc(...)`. This satisfies "mirror the established admin-gate pattern" and keeps anon SELECT denied cleanly. Not a divergence from intent — a binding of the SPEC's `<PROJECT_ADMIN_PREDICATE>` placeholder to the real project mechanism.
- **One adversarial test case adjusted:** `"restaurant "` (trailing space) is accepted by design because the validator trims `brandType` before the allow-set check (benign for a single-select). Removed that one case from the brand_type-reject list and documented why inline. All other reject cases stand.

---

## 10. Discoveries for orchestrator

- None blocking. Note: the marketing app `next lint` is not pre-configured (interactive setup prompt); only `tsc --noEmit` and `next build` enforce checks today. Out of ORCH-1045 scope.

---

## 11. Commit

All scoped files committed on `ORCH-1045-business-beta-access-form` in ONE commit (backend migration + edge fn + strict-grep allowlist together per HG-4). Commit hash: see chat report / `git log` (recorded at commit time).
