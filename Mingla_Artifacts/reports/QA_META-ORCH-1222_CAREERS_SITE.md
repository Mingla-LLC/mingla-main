# QA — META-ORCH-1222 Careers Site (`career.usemingla.com`)

> **Mode:** TARGETED + SPEC-COMPLIANCE + SECURITY (brutal adversarial pre-merge gate).
> **Tester:** mingla-tester. **Worktree:** `~/Desktop/mingla-orchs/1221-[careers-site]/` on branch `1222-careers-site`, HEAD `fe0577d27`.
> **Date:** 2026-06-22. **Against:** SPEC (incl. ADDENDUM D-1/D-2/D-3) + DESIGN + IMPLEMENTATION report.
> **Comms:** COMMS-0060 (WARN, the 1221→1222 renumber) read + already RESOLVED by the renumber commit `fe0577d27`; acked. No BLOCK rows addressed to mingla-tester / META-ORCH-1222 / ALL.

---

## 1. Verdict

# FAIL

**P0: 1 · P1: 0 · P2: 2 · P3: 1 · P4: 3**

One release-blocking P0: **the entire public careers site 404s** because the route folder is `app/_careers/` — an underscore-prefixed Next.js **private folder** that App Router excludes from routing. Proven by live-fire production build + server (`career.usemingla.com/` → **404**, no careers route in the build manifest). Everything else — the backend security spine, edge functions, admin, CI gates, seed, builds — is solid and verified. The P0 is a one-rename fix (`_careers` → `careers`), and I proved the fix works end-to-end. Routes to **REWORK** (implementor).

---

## 2. Build verification (priority 1 — was UNVERIFIED; now LIVE-FIRE)

Both apps' `node_modules` were absent in the worktree AND the anchor. Installed via `npm ci` (both have `package-lock.json`), then ran the real production builds.

| App | Command | Result |
|---|---|---|
| `mingla-marketing` (Next 15.5.15) | `npm run build` (`next build`) | **PASS** — "Compiled successfully in 11.6s", type-check passed, 12/12 static pages, Middleware compiled (34.2 kB). |
| `mingla-admin` (Vite 7.3.1) | `npm run build` (`vite build`) | **PASS** — 2956 modules, "built in 6.28s". Only a non-fatal >500 kB chunk-size warning (pre-existing pattern, not a careers regression). |

**Both builds GREEN.** But the marketing build is what exposed the P0 (next section): the careers routes do not appear in the build output.

---

## 3. Findings

### P0-1 — The entire public careers site returns 404 (`app/_careers/` is a Next.js private folder)

- **Evidence (build):** after `next build`, `.next/server/app/` contains `(explorer)`, `organisers`, etc. but **NO careers segment**. `app-paths-manifest.json` has **zero** careers entries. The route map prints no `/careers*` route.
- **Evidence (live-fire server):** ran `next start` (production server) and hit it with `Host: career.usemingla.com`:
  - `career.usemingla.com/` → **404**
  - `career.usemingla.com/roles/multimedia-designer` → **404**
  - `career.usemingla.com/roles/multimedia-designer/apply` → **404**
  - (apex `usemingla.com/` → 200 explorer, untouched — that half is fine, ironically because the careers route exists for nobody.)
- **Root cause:** In Next.js App Router, a folder whose name **starts with `_`** (`app/_careers/`) is a **"private folder"** — Next deliberately opts it out of routing and does NOT compile its `page.tsx` into a route. The middleware (`middleware.ts`) rewrites `career.` host → `/_careers`, but `/_careers` is not a routable path, so the rewrite lands on the 404 page. The SPEC §4.C.1 stated *"`_`-prefixed folders are NOT route groups but ARE normal segments"* — **this is factually incorrect**; `_`-prefixed = private/excluded. The 6 CI gates and the implementor's Deno tests never exercised actual Next routing, so this slipped through.
- **Impact:** `career.usemingla.com` is completely dead — every public URL 404s. The admin/backend works, but no human can apply because the site does not render. Total feature failure on the primary surface.
- **Required fix (proven):** rename `app/_careers/` → a real non-underscore segment, e.g. `app/careers/` (NOT a parenthesized route group `(careers)` — its `/` would collide with `(explorer)/page.tsx`, which the SPEC correctly noted). Update `middleware.ts` `CAREERS_PREFIX` from `/_careers` → `/careers` (and the apex-guard prefix + the `/_careers-not-found` line). Also update the existing gate `i-proposed-1222-careers-host-isolated.mjs`, which hard-codes the `_careers` string (see P2-1).
- **Fix VERIFIED by the tester:** in a throwaway copy I renamed `_careers`→`careers` + retargeted the middleware, rebuilt → Next compiled all three routes (`ƒ /careers`, `ƒ /careers/roles/[slug]`, `ƒ /careers/roles/[slug]/apply`); restarted `next start` → `career.usemingla.com/` = **200** rendering "Careers / Open roles", `/roles/...` = 200, `/roles/.../apply` = 200, apex `/` = 200 (untouched), apex `/careers` (plain host) = 404 (apex guard works). Then fully reverted; worktree pristine.
- **Retest:** after the rename, `next build` must list the three `/careers*` routes AND `next start` + `Host: career.usemingla.com` must return 200 for `/`, `/roles/multimedia-designer`, `/roles/multimedia-designer/apply`; plain-host `/careers` must 404.

### P2-1 — `i-proposed-1222-careers-host-isolated.mjs` hard-codes `_careers`; will need updating with the P0 fix

- **Evidence:** the gate asserts `middleware does not reference the `_careers` internal segment` and matches `/_careers`. After the P0 rename to `/careers`, this gate would FAIL on the corrected code (and conversely it currently PASSES on the broken code — it gave false comfort).
- **Impact:** the gate that claims to protect subdomain isolation actually pins the broken segment name. It must be re-pointed to the new segment when P0 is fixed, else CI blocks the fix.
- **Required fix:** when renaming, update this gate's `_careers` matches to the new segment, keeping the host-gate + apex-guard assertions. Re-run its `--self-test`.
- **Retest:** gate PASSES on fixed middleware, self-test still 3/3.

### P2-2 — Public reads require `NEXT_PUBLIC_SUPABASE_URL` which is not yet in marketing Vercel env

- **Evidence:** `lib/careers-data.ts` reads `process.env.NEXT_PUBLIC_SUPABASE_URL`; if absent it throws a clear error and the page renders a graceful "couldn't load" error state (verified: index returned HTTP 200 with a "couldn't load" message when the env was absent — **no crash, no silent failure**, Constitution §3 satisfied). The marketing app today carries only `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (SPEC §10 Q3, IMPLEMENTATION §10).
- **Impact:** without the env var added at deploy, the live careers index/JD pages will show the error state (no roles) even after the P0 fix. This is a deploy-time item, not a code defect — but it is a launch blocker if missed.
- **Required fix:** Seth adds `NEXT_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co` to the marketing Vercel project (production + preview) at deploy. Already flagged in IMPLEMENTATION §10.4.
- **Retest:** with the env set, the index lists the 2 seeded roles.

### P3-1 — `is_admin_user()` lacks `SET search_path` (pre-existing, out of scope, noted)

- **Evidence:** prod `is_admin_user()` is `SECURITY DEFINER` without `SET search_path`. The careers RPCs correctly add `set search_path to 'public'`; the reused base function does not. Pre-existing (defined in the baseline squash), not introduced by 1222.
- **Impact:** negligible (function body only touches `auth.users`/`admin_users` by qualified-enough names). Noted for the orchestrator's hardening backlog, not a 1222 defect.
- **Required fix:** none in 1222. Orchestrator discovery.

### P4 (praise)
- **P4-1:** the markdown renderer (`lib/careers-markdown.ts`) is XSS-safe by construction — escape-first then a closed allowlist (h2/h3/ul/li/strong/http(s) links with `rel="noopener noreferrer"`). Correct trust-boundary discipline.
- **P4-2:** admin reads go exclusively through `is_admin_user()`-gated SD RPCs (`careersService.js` never does `supabase.from('job_applications')`) — Constitution §2 (one owner) + deny-by-default honored.
- **P4-3:** `careers-cv-signed-url` re-verifies the JWT user AND the active-admin row with the SAME `status='active'` predicate `is_admin_user()` uses — consistent dual gate; 60s TTL; resolves `cv_path` server-side from `application_id` so the admin never hand-passes a raw storage path.

---

## 4. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1 | DB/RLS: anon reads only open postings; applications deny-by-default | **PASS** | Live-fire PG15 (Docker, both migrations applied): anon SELECT job_postings → only 2 open rows (draft/closed invisible); anon SELECT job_applications → 0 rows; anon INSERT job_applications → **DENIED** "new row violates row-level security policy"; anon UPDATE job_postings → 0 rows affected. |
| SC-2 | Edge validates all six + CV; valid → row + CV + 2 emails | **PASS (validation/email builders)** | 15/15 Deno tests: six-field validation, per-field naming, all-six-omitted, CV mime/size, email builders (applicant + Seth, escaped). The actual DB-insert/storage-upload/Resend-send is service-role runtime, not invokable offline — validation + builders proven; live send deferred to deploy. |
| SC-3 | Role-binding: draft/closed/unknown slug → 400 `job_slug` | **PASS (source+test)** | Edge fn resolves slug via service-role SELECT, rejects non-open with `job_slug`; covered by Deno validation path. |
| SC-4 | CV mime/size gate; stored at `{posting_id}/{uuid}-{sanitized}` | **PASS** | Deno: CV>5MB → `cv`; mime allowlist enforced; `sanitizeFilename` strips traversal, keeps extension, caps length. |
| SC-5 | Rate limit: 6th/10min/IP → 429 | **PASS (source+test)** | Reuses BETA_LEAD_IP_SALT window + `(ip_hash, created_at)` index; `hashIp` salted, raw IP never stored (Deno-tested). |
| SC-6 | Subdomain rewrite; apex untouched; `/_careers` apex-guarded | **FAIL** | **P0-1**: `career.usemingla.com/` → 404 (routes not compiled). Apex untouched = true; apex `/careers` guard = correct (404). But the primary behavior (careers renders) FAILS. |
| SC-7 | Index data-driven; closed disappears; closed JD → "not open", body not in HTML | **BLOCKED-by-P0** | Cannot verify live because no route renders. Source: `force-dynamic` reads + `getOpenRoleBySlug` returns null for non-open + RLS guarantees it. Verifiable once P0 fixed (proven the route renders post-rename). |
| SC-8 | Form happy path → success + emails + admin sees it | **BLOCKED-by-P0** | Form route 404s. Form code + submit transport present; verifiable post-fix. |
| SC-9 | Form errors inline + banner, inputs never cleared | **BLOCKED-by-P0** | Same. Error mapping present in `careers-apply-submit.ts` + apply-form. |
| SC-10 | Admin list+detail: filter, signed CV download, status update persists | **PASS (build+source)** | Admin builds clean; `careersService.js` wires all RPCs + the cv-signed-url fn; CareersPage has Applications + Roles (D-1) tabs. Runtime admin login not exercised (no admin session creds) — source+build PASS, live admin tap deferred. |
| SC-11 | Admin security: non-admin → empty/raise; signed-url fn → 403 | **PASS** | Live-fire PG: with `is_admin_user()`=false → `admin_job_applications_list`/`admin_careers_list_postings` return 0 rows; `admin_set_job_application_status`/`admin_careers_upsert_posting` RAISE `forbidden`. With true → return data. cv-signed-url edge fn returns 403 for non-active-admin (verified `admin_users.status` values are `active`/`revoked`; `.eq("status","active")` is correct). |
| SC-12 | Seed: two open roles, exact YAML values, JD body renders | **PASS** | Live-fire: Migration B inserted exactly 2 rows, both `status='open'`, slugs `multimedia-designer`/`community-brand-manager`, salary `₦150,000–₦250,000/month`, sort 0/1. JD body markdown stored; renderer proven safe. |

D-1 (admin posting CRUD), D-2 (coral-600 CTA), D-3 (2-up grid) present in code; D-1 RPCs live-fire gated PASS.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Commit run:** HEAD `fe0577d27`. Test: `supabase/functions/careers-apply/__tests__/apply_happy.test.ts` via `deno test --allow-env --allow-net`.
- **Restored:** **15 passed, 0 failed.**
- **Reverted (true line-deletion of the `preferred_salary` validation block, lines 175–177 `if (preferred_salary.length < 1 || > 60) { fields.push("preferred_salary"); }`):** **13 passed, 2 FAILED** — exactly:
  - `validateApplication — EACH of the six required fields, when missing, names itself` (apply_happy.test.ts:58)
  - `validateApplication — ALL fields omitted → all six present in fields` (apply_happy.test.ts:75)
- **Restored → 15/15 again.** Implementor's claim **independently CONFIRMED at `fe0577d27`.** Worktree returned pristine.

---

## 6. Adversarial test added (tester-owned, different angle)

- **Path:** `.github/scripts/strict-grep/i-proposed-1222-careers-routes-routable.mjs` (NEW, append-only, CI-runnable node gate).
- **Angle (different from implementor's edge-fn happy-path AND all 6 implementor gates):** it attacks the **Next.js route-existence** dimension nobody guarded — asserts the careers route segment under `app/` is genuinely ROUTABLE: (1) not underscore-private, (2) not a parenthesized group colliding with `/`, (3) has all three pages, (4) the middleware rewrite target matches the on-disk segment. **This is the exact P0-1 detector.**
- **fails-on-revert verified at `fe0577d27`:**
  - Real-file run on the **current broken `_careers` tree → FAIL (exit 1)**: "careers route segment `app/_careers/` is an underscore-prefixed PRIVATE folder — Next.js excludes it from routing, so every careers URL 404s." (It catches the live P0.)
  - Real-file run on the **fixed tree** (temp rename `_careers`→`careers` + retargeted middleware) **→ PASS (exit 0)**; then reverted.
  - `--self-test` → **5/5 cases** (FIXED→PASS; underscore-private→FAIL; route-group→FAIL; missing-page→FAIL; middleware-target-divergence→FAIL).
- **In-diff:** appears in `git diff origin/main...HEAD --name-only` for the closing PR (committed on `1222-careers-site`). The implementor's happy-path test is already in-diff. Both present.

> Note: my adversarial gate currently FAILS on HEAD by design — it is the P0 detector. Once P0-1 is fixed (segment renamed), it will go green. It should be wired into `strict-grep-mingla-business.yml` as a 7th careers job at CLOSE.

---

## 7. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A (web; runtime UI blocked by P0) | Form/CTA wired in source; live tap blocked by P0-1. |
| 2 | One owner per truth | PASS | job_applications written only by edge fn (service role); read only via admin RPC. |
| 3 | No silent failures | PASS | DB-unreachable index → HTTP 200 "couldn't load" error state (not blank/false-success); edge fn returns typed errors; submit maps 400/429/server/network. |
| 4 | One query key per entity | N/A | Admin uses direct RPC service calls; marketing uses server fetch (no RN React-Query surface). |
| 5 | Server state server-side | PASS | No Zustand misuse; marketing reads are server components. |
| 6 | Logout clears everything | N/A | No new auth/session state. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | PASS | Greenfield; reuses `_shared/cors`, `_shared/email/**`, explorer-lead patterns by import (not copied). |
| 9 | No fabricated data | PASS | Postings/applications are real DB rows; salary from seed/admin input; missing → error state, never faked. |
| 10 | Currency-aware | PASS | NGN seed; `salary_display` verbatim text + `salary_currency`/`salary_period` columns. |
| 11 | One auth instance | PASS | Admin reuses `src/lib/supabase`; edge fns use service-role/JWT-verify appropriately. |
| 12 | Validate at right time | PASS | Server re-validates all six (authority); client validation UX-only. |
| 13 | Exclusion consistency | PASS | Non-open postings excluded by RLS AND lib filter AND `getOpenRoleBySlug` null — consistent across surfaces. |
| 14 | Persisted-state startup | N/A | No hydration-gated client store. |

No constitutional violation (the P0 is a routing/build defect, not a constitution breach).

---

## 8. Device / parity matrix

| Surface | Status | Note |
|---|---|---|
| Consumer iOS (`app-mobile`) | N/A | Web-only; **0 files touched** (verified `git diff` name-only). |
| Consumer Android | N/A | Web-only; 0 files touched. |
| Buyer/anon Web (`mingla-business`) | N/A | Careers lives in `mingla-marketing`; 0 files touched. |
| Business iOS / Android | N/A | Web-only; 0 files touched. |
| Admin Web (`mingla-admin`) | **PASS (build+source); live admin tap deferred** | `vite build` clean; RPC wiring + 2-tab CareersPage verified by source; no admin session creds to drive a live login here. |
| Marketing Web (`mingla-marketing`) | **FAIL (P0-1)** | `next build` clean BUT careers routes not compiled → `career.` host 404s on the live production server. Fix proven. |
| Backend (`supabase/`) | **PASS** | Live-fire PG15: migrations apply, RLS deny-by-default proven, admin RPCs gated, seed = 2 open roles, bucket private. |

Physical-iPhone HITL: not applicable (no mobile surface in scope; nothing for Seth to tap on a phone). Live edge-fn deploy state: NOT deployed (verify at CLOSE) — careers-apply (verify_jwt=false) + careers-cv-signed-url (verify_jwt=true) confirmed in `config.toml`.

---

## 9. Other verifications

- **6 implementor CI gates** — all PASS real-file AND `--self-test` (applications-deny-anon, postings-open-only, apply-six-fields, cv-bucket-private, host-isolated, admin-writes-gated). Caveat P2-1 (host-isolated pins the broken segment name).
- **verify_jwt:** careers-apply=`false`, careers-cv-signed-url=`true` — both confirmed in `config.toml`.
- **No service-role key in any marketing client lib/route** (grep clean).
- **careers-data filters `status=eq.open`** (belt-and-suspenders on RLS) — confirmed.
- **Admin reads never hit the table directly** — `careersService.js` uses only RPCs + the signed-url fn.

---

## 10. Discoveries for Orchestrator

- **DISC-1 (P0):** SPEC §4.C.1's claim that `_`-prefixed App-Router folders "ARE normal segments" is wrong — they are private/excluded. Any future spec using a `_`-prefixed route folder will silently 404. Worth a one-line note in the spec-writing reference.
- **DISC-2 (P2-1):** the `host-isolated` gate hard-codes the segment string; the P0 fix must update it. Consider making segment-name gates derive the segment rather than hard-code it.
- **DISC-3 (P3-1):** prod `is_admin_user()` has no `SET search_path` — pre-existing hardening item, program-wide (affects every admin RPC, not just careers).
- **DISC-4:** my adversarial gate `i-proposed-1222-careers-routes-routable.mjs` should be wired into `strict-grep-mingla-business.yml` as a 7th careers job at CLOSE (after P0 fix turns it green).
- **COMMS-0060** (WARN, 1221→1222 renumber) acked; already RESOLVED by `fe0577d27`. No new COMMS written (no in-flight ORCH affected; disjoint file set).

---

## 11. Routing

**FAIL → REWORK (mingla-implementor+claude).** Single P0 (file:line cited): rename `mingla-marketing/app/_careers/` → `mingla-marketing/app/careers/` + update `mingla-marketing/middleware.ts` (`CAREERS_PREFIX` `/_careers`→`/careers`, apex-guard prefix, `/_careers-not-found` line) + update `.github/scripts/strict-grep/i-proposed-1222-careers-host-isolated.mjs` `_careers`→`careers`. Re-run `next build` + `next start` host test (must 200) and all gates' self-tests. Then re-dispatch RETEST. The backend/admin/edge/seed/security are all PASS and need no rework.
