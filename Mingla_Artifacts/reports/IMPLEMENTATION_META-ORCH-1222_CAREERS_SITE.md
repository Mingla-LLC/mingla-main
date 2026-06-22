# IMPLEMENTATION — META-ORCH-1222 Careers Site (`career.usemingla.com`)

> **Mode:** IMPLEMENT (mingla-implementor+claude). Built against the binding SPEC
> `Mingla_Artifacts/specs/SPEC_META-ORCH-1222_CAREERS_SITE.md` (commit 421d76c72,
> INCLUDING the ADDENDUM Seth decisions D-1/D-2/D-3) + the DESIGN contract.
> **Worktree:** `~/Desktop/mingla-orchs/1222-[careers-site]/` on branch
> `1222-careers-site` (rebased onto origin/main at start).
> **Status:** implemented; backend type-checks + Deno tests run; gates pass
> self-test + live. Marketing/admin TS+build are UNRUN here (no node_modules in
> the worktree) — flagged in §9 for the tester/CI.

---

## 1. Summary

Built a standalone, data-driven careers site served from `career.usemingla.com`
off the **same `mingla-marketing` Vercel project** via a host-based Next.js
middleware rewrite into a new `app/_careers/**` route group — with zero impact on
`usemingla.com`. Open roles render from a new `job_postings` table (one open row
= one card; salary public). Each role pre-binds a six-field application form
(full name, email, WhatsApp, preferred salary, CV upload, portfolio URL).
Submissions flow through a new public `careers-apply` edge fn (service-role) that
re-validates all six fields + the CV server-side, uploads the CV to a **private**
`career-cvs` bucket, inserts a `job_applications` row, and sends a branded
applicant confirmation + a `seth@usemingla.com` notification via the reused
`renderShell` + Resend senders. Admins manage everything in `mingla-admin` →
**Careers**, which has BOTH tabs per ADDENDUM D-1: **Applications** (filter by
role + status, detail with signed CV download + portfolio + status update) AND
**Roles** (full posting CRUD — markdown body editor, slug-generate, status
toggle). The two roles seed verbatim from the JD YAML. Six CI gates protect the
security spine + the D-1 admin-write gating.

The DESIGN ADDENDUM is honored: **D-1** admin role CRUD in v1; **D-2** solid CTA
buttons rest at `--coral-600` (#E85D1F), hover `--coral-700`; **D-3** 2-up role
grid on desktop/tablet.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Commit |
|----|-----------|--------|--------|
| SC-1 | DB/RLS: anon reads only open postings; applications deny-by-default | ✓ implemented | `87ca31063` |
| SC-2 | Edge validates all six + CV; valid → row + CV + 2 emails | ✓ implemented (validation + email builders Deno-tested) | `87ca31063` |
| SC-3 | Role-binding: draft/closed/unknown slug → 400 `job_slug` | ✓ implemented | `87ca31063` |
| SC-4 | CV mime/size gate; stored at `{posting_id}/{uuid}-{sanitized}` | ✓ implemented (Deno-tested mime + 5 MB + sanitize) | `87ca31063` |
| SC-5 | Rate limit: 6th/10min/IP → 429 | ✓ implemented (reuses BETA_LEAD_IP_SALT window) | `87ca31063` |
| SC-6 | Subdomain rewrite; apex untouched; `/_careers` apex-guarded | ✓ implemented (middleware host gate + apex guard) | `e20df7b87` |
| SC-7 | Index data-driven; closed disappears; closed JD → "not open", body not in HTML | ✓ implemented (force-dynamic reads; getOpenRoleBySlug returns null for non-open) | `e20df7b87` |
| SC-8 | Form happy path → success panel + emails + admin sees it | ✓ implemented | `e20df7b87` / `5df9c71d7` |
| SC-9 | Form errors (400/429/server) inline + banner, inputs never cleared | ✓ implemented | `e20df7b87` |
| SC-10 | Admin list+detail: filter, signed CV download, status update persists | ✓ implemented | `5df9c71d7` |
| SC-11 | Admin security: non-admin → empty/raise; signed-url fn → 403 | ✓ implemented (RPCs gate on is_admin_user(); edge fn admin_users check) | `87ca31063` |
| SC-12 | Seed: two open roles, exact YAML values, JD body renders | ✓ implemented (Migration B verbatim) | `87ca31063` |

Per-surface parity is manual (admin path vs marketing path are separate
codebases) — both built.

---

## 3. Files changed (37 total in the closing diff; 36 mine + the pre-existing forensics artifacts)

**Backend (Leg 2):**
- `supabase/migrations/20261126000001_orch_1222_careers_postings_applications.sql` (NEW, ~340 lines)
- `supabase/migrations/20261126000002_orch_1222_careers_seed_roles.sql` (NEW, ~110 lines)
- `supabase/functions/careers-apply/index.ts` (NEW, ~430 lines)
- `supabase/functions/careers-apply/__tests__/apply_happy.test.ts` (NEW, regression)
- `supabase/functions/careers-cv-signed-url/index.ts` (NEW, ~110 lines)
- `supabase/config.toml` (MODIFY +12 — two `[functions.*]` verify_jwt blocks)

**Public site (Leg 3):**
- `mingla-marketing/middleware.ts` (NEW)
- `mingla-marketing/app/_careers/layout.tsx`, `page.tsx`, `roles/[slug]/page.tsx`, `roles/[slug]/apply/page.tsx` (NEW)
- `mingla-marketing/app/_careers/_components/{careers-header,careers-button,role-grid,sticky-apply-bar,apply-form}.tsx` (NEW)
- `mingla-marketing/lib/{careers-data,careers-apply-submit,careers-markdown}.ts` (NEW)
- `mingla-marketing/app/globals.css` (MODIFY +81 — careers-scoped tokens + JD md typography; `--color-warm` untouched)

**Admin (Leg 4):**
- `mingla-admin/src/pages/CareersPage.jsx` (NEW, ~620 lines)
- `mingla-admin/src/services/careersService.js` (NEW)
- `mingla-admin/src/App.jsx` (MODIFY +4), `src/lib/constants.js` (MODIFY +4), `src/components/layout/Sidebar.jsx` (MODIFY +4)

**CI gates (Leg 5):**
- `.github/scripts/strict-grep/i-proposed-1222-careers-{applications-deny-anon,postings-open-only,apply-six-fields,cv-bucket-private,host-isolated,admin-writes-gated}.mjs` (6 NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (MODIFY +78 — 6 jobs)

---

## 4. Data-model changes applied (WRITTEN, not applied — orchestrator applies at CLOSE)

- **`public.job_postings`** — slug-unique (with slug-format CHECK), title/department/location/employment_type/salary_* (min/max/currency/period/display)/summary/body(markdown)/status(draft|open|closed)/sort_order/timestamps. Index `(status, sort_order asc, created_at desc)`.
- **`public.job_applications`** — FK→job_postings (on delete restrict), six applicant fields + cv_path + status(new|reviewing|shortlisted|rejected|hired) + user_agent/referer/ip_hash + created_at. Indexes on `(posting,created_at)`, `(status,created_at)`, `(ip_hash,created_at)`.
- **RLS** — job_postings: single anon/authenticated SELECT policy `using (status='open')`, NO write policy. job_applications: RLS enabled, NO permissive policy (deny-by-default).
- **RPCs (all SECURITY DEFINER, `is_admin_user()`-gated, EXECUTE→authenticated only):** `admin_job_applications_list(status, posting_id)`, `admin_set_job_application_status(id, status)`, `admin_careers_list_postings()`, `admin_careers_upsert_posting(...)` [D-1, slug-unique with `slug_taken` error], `admin_careers_set_posting_status(id, status)` [D-1].
- **Storage** — private `career-cvs` bucket (public=false, 5 MB, PDF/DOC/DOCX mimes), NO client storage.objects policy.

**Read-only prod probe (project `gqnoajqerqhnvulmnyvv`):** confirmed `is_admin_user()` exists (no-arg, derives email from `auth.uid()` → the correct session-gate; `is_admin_email(text)` also exists but takes an email arg and is the WRONG primitive for an RPC gate), `admin_users` exists, and none of job_postings/job_applications/career-cvs/the careers RPCs exist yet (no collision; migrations are pure-additive + idempotent so no `RAISE`/backfill abort risk).

---

## 5. Edge functions touched (deploy from MERGED main — orchestrator/operator-owned)

| Function | verify_jwt (preserve) | Notes |
|---|---|---|
| `careers-apply` | **false** | Public application endpoint; service-role writes/storage; reuses `_shared/cors.ts` + `_shared/email/**` by import. |
| `careers-cv-signed-url` | **true** | Admin CV download; re-verifies JWT + `admin_users` active; 60s signed URL. |

---

## 6. Regression tests added

- **Implementor happy-path:** `supabase/functions/careers-apply/__tests__/apply_happy.test.ts` — 15 Deno tests covering the six-field validation, per-field reject naming, all-six-omitted, CV mime/size gate, WhatsApp/URL validators, filename sanitize (no traversal), branded email builders (applicant + Seth, escaping), IP hash, OPTIONS/405, and the full happy payload clearing the 400 gate.
- **Run:** `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/careers-apply/__tests__/apply_happy.test.ts` → **15 passed, 0 failed.**
- **fails-on-revert verified at `87ca31063`:** deleting the `preferred_salary` server-validation lines (true LINE DELETION, not comment-out) → **2 tests FAIL**; restoring → **15/15 PASS**.
- Append-only clean: the closing diff `origin/main...HEAD` adds this one test file and modifies/deletes NO existing test.

The tester writes the adversarial half (RLS deny live-fire, role_not_open DB
path, signed-URL 403 for a non-admin, on-page form states).

---

## 7. Old → New receipts (all NEW surfaces)

This ORCH is greenfield — every product file is NEW (no prior careers code). The
only MODIFY receipts:

- **`supabase/config.toml`** — *before:* no careers functions. *now:* `careers-apply` (verify_jwt=false) + `careers-cv-signed-url` (verify_jwt=true). *why:* edge fns need their gateway JWT posture declared.
- **`mingla-marketing/app/globals.css`** — *before:* `--color-warm` brand + `--color-coral-*` utility palette. *now:* + a `.careers-root`-scoped token block (`--coral-500/600/700/050`, ink/border/surface/page-bg, success/danger) matching the email `#FF6B2C` palette, + JD markdown typography. *why:* careers uses the branded-email coral, scoped so `usemingla.com` is untouched (D-2 CTA = coral-600).
- **`mingla-admin/src/{App.jsx,lib/constants.js,components/layout/Sidebar.jsx}`** — *before:* no Careers nav. *now:* `careers: CareersPage` in PAGES, a `Careers` NAV item (icon `Briefcase`), `Briefcase` registered in Sidebar ICON_MAP. *why:* surface the new admin page (Briefcase MUST be in ICON_MAP or it silently falls back to LayoutDashboard).

---

## 8. Cross-surface impact

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS | NO | N/A — web-only |
| 2 | Consumer Android | NO | N/A — web-only |
| 3 | Buyer/anon Web (mingla-business) | NO | N/A — careers lives in mingla-marketing |
| 4 | Business iOS | NO | N/A — web-only |
| 5 | Business Android | NO | N/A — web-only |
| 6 | Admin Web (mingla-admin) | **YES** | Manual (new CareersPage + service + nav) |
| 7 | Marketing Web (mingla-marketing) | **YES (primary)** | Manual (host rewrite + `_careers` routes; `usemingla.com` untouched) |

No native blast radius → **no `eas update`** (COMMS-0052 OTA freeze irrelevant).

---

## 9. Smoke result / known issues / deferred

- **Ran:** `deno check` (both edge fns clean); `deno test` (15/15); all 6 gates `--self-test` + live (PASS); read-only prod probe (admin gate verified, no collision); YAML job-key uniqueness + path-trigger coverage.
- **UNVERIFIED (no node_modules in worktree → could not run marketing `next build` / `tsc`, nor admin `vite build` / eslint here).** The careers TS/TSX + the admin JSX are written to the established patterns and the careers files passed an early `tsc --noEmit | grep careers` (no careers errors) before node_modules was confirmed absent. **The tester / CI MUST run `mingla-marketing` build (Next 15 typecheck) and the `mingla-admin` build to confirm.**
- **`force-dynamic` + `next: { revalidate: 60 }`** coexist on the careers reads — `force-dynamic` wins (always-fresh, satisfying SC-7's "closed disappears with no code change"); the `revalidate` is a harmless fallback for any non-dynamic context.
- **Markdown render** is a minimal in-repo escaped-then-rendered renderer (`lib/careers-markdown.ts`) — no new dependency added (per SPEC §4.C.3). It escapes first, then re-introduces a closed allow-list (h2/h3/ul/li/strong/http(s)-links) → XSS-safe even though bodies are admin-authored.

---

## 10. Operator action required (orchestrator/operator at CLOSE — NOT done here)

1. **Apply migrations** (linked CLI points at the WRONG project — target prod explicitly), e.g. via MCP `apply_migration` with `--project-ref gqnoajqerqhnvulmnyvv`, OR:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1222-[careers-site]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (Both migrations are additive/idempotent — `if not exists`, `on conflict`. Apply A then B.)
2. **Deploy edge fns** from merged main, targeting prod:
   - `careers-apply` (verify_jwt=false), `careers-cv-signed-url` (verify_jwt=true) → `--project-ref gqnoajqerqhnvulmnyvv`.
3. **Vercel + DNS (Seth):** add `career.usemingla.com` to the existing `mingla-marketing` Vercel project; create CNAME `career` → `cname.vercel-dns.com`.
4. **Marketing Vercel env (Seth):** add `NEXT_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co` (production + preview) so the careers pages can read `job_postings`. (`NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` already exist.)
5. **Deploy marketing** (Vercel `[deploy]`) + **admin build**. No `eas update` (no native surface).
6. **Flip the 5 DRAFT invariants ACTIVE** (+ the D-1 delta invariant) in `INVARIANT_REGISTRY.md` at CLOSE.
7. **ID collision RESOLVED:** the beta-form/allpill work shipped first as ORCH-1221 (PR #647); this careers work renumbered to META-ORCH-1222 per shipped-first-keeps-the-number (COMMS-0060).

---

## 11. Discoveries for orchestrator

- **D-1 (verification):** prod has BOTH `is_admin_user()` (no-arg session gate — what I used) AND `is_admin_email(text)` (email-arg helper). The SPEC flagged "verify, don't guess"; verified `is_admin_user()` is the correct gate for SECURITY DEFINER RPCs called from the authed admin session. No action needed — recorded for the registry.
- **ORCH-ID collision RESOLVED (renumber 1221 → 1222):** the OTHER work (beta-form-brand-type / explorer all-pill) shipped FIRST as ORCH-1221 — migration `20261126000000_orch_1221_beta_access_brand_type_multi.sql` + strict-grep job `orch-1221-allpill-selects-all` + invariant `I-PROPOSED-1221-ALLPILL-SELECTS-ALL` ACTIVE (PR #647 on origin/main). This careers work renumbered to META-ORCH-1222. ALL careers gate jobs are namespaced `orch-1222-careers-*` and the careers migrations are `...000001`/`...000002` (strictly > the beta-form `...000000`), so there is **no file or YAML-job-key collision**. The only shared file is `strict-grep-mingla-business.yml`, which now carries BOTH the `orch-1221-allpill-selects-all` job AND the 6 `orch-1222-careers-*` jobs.
- **COMMS-0060 (WARN) acked + RESOLVED** — the renumber directive itself. No new COMMS entries written; no in-flight ORCH is affected by this work (disjoint file set from the shipped beta-form 1221; no shared product code). COMMS_LEDGER scanned on entry: no BLOCK row addressed to mingla-implementor / META-ORCH-1222 / ALL required action.

---

## 12. REWORK — P0-1 fix (careers routes 404 → routable)

**Dispatch:** QA verdict FAIL (`Mingla_Artifacts/reports/QA_META-ORCH-1222_CAREERS_SITE.md`), single P0. Everything else (backend / RLS / admin / edge fns / seed / builds) PASSED and was NOT touched. Web-only — no `eas update`.

### Root cause (from QA)
The careers routes lived in `mingla-marketing/app/_careers/`. A leading underscore makes Next.js App Router treat the folder as a **private folder** — excluded from routing, `page.tsx` never compiled into a route — so `next build` emitted ZERO careers routes and `career.usemingla.com/*` returned 404 across the board.

### Fix applied (exactly per the tester's prescription)
1. **`git mv mingla-marketing/app/_careers/ → mingla-marketing/app/careers/`** (real non-underscore segment; NOT a `(careers)` group — that would collide with `(explorer)/page.tsx` at `/`). History preserved (R100 renames). The nested colocated `_careers/_components/` correctly REMAINS underscore-prefixed (Next colocated, non-routable — intended).
2. **`mingla-marketing/middleware.ts`:** `CAREERS_PREFIX` `/_careers` → `/careers`; apex-guard rewrite line `/_careers-not-found` → `/careers-not-found`; comments updated. Behavior unchanged: `career.*` host → rewrite to `/careers*`; apex (usemingla.com / www) untouched; apex `/careers*` → 404 guard; matcher still excludes `_next` / `.well-known` / static.
3. **`mingla-marketing/app/careers/layout.tsx`:** doc comment `/_careers/*` → `/careers/*`.
4. **`.github/scripts/strict-grep/i-proposed-1222-careers-host-isolated.mjs`:** retargeted from the hard-coded `_careers` to `/careers` (matches the literal `'/careers'` / `CAREERS_PREFIX`); doc + self-test fixtures updated. Self-test still 3/3.
5. **`.github/workflows/strict-grep-mingla-business.yml`:** wired the tester's new gate `i-proposed-1222-careers-routes-routable.mjs` as a 7th careers job `orch-1222-careers-routes-routable` (both `--self-test` step + real-run step, matching the other 6 careers jobs).

### Files changed (rework)
- `mingla-marketing/app/_careers/**` → `mingla-marketing/app/careers/**` (9 files renamed; `layout.tsx` rename+modify)
- `mingla-marketing/middleware.ts` (~5 lines)
- `.github/scripts/strict-grep/i-proposed-1222-careers-host-isolated.mjs` (~8 lines)
- `.github/workflows/strict-grep-mingla-business.yml` (+14 lines: 7th job)

### Proof — build route list (`npm ci && npm run build`, Next 15.5.15, "Compiled successfully in 4.0s", 12/12 static, Middleware 34.2 kB)
```
ƒ /careers                             1.58 kB         147 kB
ƒ /careers/roles/[slug]                1.52 kB         107 kB
ƒ /careers/roles/[slug]/apply          5.67 kB         111 kB
```
All three required careers routes are now compiled.

### Proof — live-fire `next start` Host-header (production server, port 3199)
| Request | Host | Result |
|---|---|---|
| `/` | `career.usemingla.com` | **200** (renders "Careers") |
| `/roles/multimedia-designer` | `career.usemingla.com` | **200** |
| `/roles/multimedia-designer/apply` | `career.usemingla.com` | **200** |
| `/careers` | `usemingla.com` (apex) | **404** (apex guard holds) |
| `/` | `usemingla.com` (apex) | **200** (untouched) |

(Index returned 200 even without `NEXT_PUBLIC_SUPABASE_URL` set — the P2-2 graceful "couldn't load" error state, no crash. Constitution §3 satisfied. Seth still adds that env at deploy so roles list.)

### Proof — gates
- **7/7 careers gates `--self-test` PASS:** applications-deny-anon (3/3), postings-open-only (4/4), apply-six-fields (3/3), cv-bucket-private (3/3), host-isolated (3/3), admin-writes-gated (3/3), **routes-routable (5/5)**.
- **7/7 careers gates real-run PASS** on the fixed tree (routes-routable — the P0 detector — now GREEN).
- **fails-on-revert (routes-routable):** on-disk rename `careers`→`_careers` → real gate **FAIL (exit 1)** ("underscore-prefixed PRIVATE folder … every careers URL 404s"); restore → **PASS (exit 0)**. The host-isolated self-test fixtures also fail-on-revert (missing host check / missing apex guard).

### Scope hygiene
- Zero new careers-owned `1221` tokens introduced (grep clean).
- ALLPILL / beta-form 1221 files: zero-byte diff — untouched (not in `git diff` name-list; only careers + the two CI files changed).
- Backend / admin / edge / seed / migrations: NOT touched (all PASS).

**Rework status: implemented and VERIFIED (build route list + live-fire Host-header 200s/404 + 7-gate self-test + fails-on-revert).** Routes back to orchestrator for RETEST dispatch.

---

## CI REWORK — PR #650 two RED checks fixed at root (2026-06-22)

Two CI checks were RED on PR #650; both root-caused and fixed web-only (no migration apply, no deploy, no merge).

### FIX 1 — "Migrations apply cleanly from baseline" (was FAIL → now PASS)

**File:** `supabase/migrations/20261126000001_orch_1222_careers_postings_applications.sql` (§9, lines ~323-380).

**What it did before:** a raw `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) … on conflict (id) do nothing;`. The CI baseline `storage.buckets` is MINIMAL (older Supabase test image pre-dates the `public`/`file_size_limit`/`allowed_mime_types` columns) → `ERROR: column "public" of relation "buckets" does not exist`, aborting the whole migration.

**What it does now:** a column-existence-guarded `DO $$ … $$` block mirroring `20260531000000_orch_0807_brand_avatars_storage.sql` exactly — declares `has_public`/`has_file_size_limit`/`has_allowed_mime_types` from `information_schema.columns`; IF all three → full insert (`public=false`, 5 MB, PDF/DOC/DOCX allowlist) with `ON CONFLICT (id) DO UPDATE SET public/file_size_limit/allowed_mime_types = EXCLUDED.*`; ELSIF `has_public` → `(id,name,public=false)` ON CONFLICT DO UPDATE SET public; ELSE → `(id,name)` ON CONFLICT DO UPDATE SET name. The service-role-only comment (no storage.objects client policies) is preserved.

**Why:** the bucket is PRIVATE (`public=false`); guard makes the migration apply on the lean CI baseline AND on production, landing the private bucket + limits where the columns exist.

**Verification (ephemeral Docker Postgres 15):**
- Minimal baseline (`storage.buckets` = id,name only) + FULL migration → applies with **exit 0**, `career-cvs` row exists (ELSE branch fired, no `public` column error).
- Full baseline (`storage.buckets` with public/file_size_limit/allowed_mime_types) + FULL migration → **exit 0**; bucket lands `public=f`, `file_size_limit=5242880`, `allowed_mime_types={application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}`.
- Fails-on-revert: the OLD raw insert against the minimal baseline reproduces the exact CI error `ERROR: column "public" of relation "buckets" does not exist`.

### FIX 2 — "ORCH-0785-A: Resend POST must declare attachments or opt out" (was FAIL → now PASS)

**Gate located:** `.github/scripts/strict-grep/orch-0785-resend-attachment-aware.mjs`. It flags every `fetch("https://api.resend.com/emails"` POST in `supabase/functions/**` that lacks an `attachments:` field in the next 40 lines AND lacks a `// no-attachment: <reason>` comment in the 6 lines immediately above the fetch call.

**File:** `supabase/functions/careers-apply/index.ts` — ONE shared `sendEmail` helper (single fetch call, line ~341) serves BOTH Resend sends (applicant confirmation, line ~484, and the seth@usemingla.com notification, line ~495).

**What it did now:** added a `// no-attachment:` opt-out comment directly above the fetch call, mirroring explorer-app-lead-submit's wording and ending `(ORCH-0785-A opt-out)`. The careers emails carry NO attachment (the CV lives in admin, not attached) — no fabricated `attachments` field.

**Verification:** ran the gate locally → `ORCH-0785-A Resend attachment-aware gate passed.` (exit 0). (Gate has no `--self-test` flag; it is a direct repo walk.)

### After both fixes
- 7/7 careers gates `--self-test` PASS; 7/7 real-run PASS (unchanged — the cv-bucket-private gate still confirms private/5MB/PDF-DOC-DOCX/no-client-policy on the new DO-block form).
- Zero new `1221` tokens; ALLPILL / beta-form 1221 files untouched.
- Files changed: `supabase/migrations/20261126000001_orch_1222_careers_postings_applications.sql`, `supabase/functions/careers-apply/index.ts`.

**CI rework status: implemented and VERIFIED (ephemeral-PG dual-baseline apply + 0785-A gate pass + fails-on-revert).**
