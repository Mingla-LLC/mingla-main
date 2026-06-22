# IMPLEMENTATION — META-ORCH-1221 Careers Site (`career.usemingla.com`)

> **Mode:** IMPLEMENT (mingla-implementor+claude). Built against the binding SPEC
> `Mingla_Artifacts/specs/SPEC_META-ORCH-1221_CAREERS_SITE.md` (commit 421d76c72,
> INCLUDING the ADDENDUM Seth decisions D-1/D-2/D-3) + the DESIGN contract.
> **Worktree:** `~/Desktop/mingla-orchs/1221-[careers-site]/` on branch
> `1221-careers-site` (rebased onto origin/main at start).
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
- `supabase/migrations/20261126000001_orch_1221_careers_postings_applications.sql` (NEW, ~340 lines)
- `supabase/migrations/20261126000002_orch_1221_careers_seed_roles.sql` (NEW, ~110 lines)
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
- `.github/scripts/strict-grep/i-proposed-1221-careers-{applications-deny-anon,postings-open-only,apply-six-fields,cv-bucket-private,host-isolated,admin-writes-gated}.mjs` (6 NEW)
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
   cd "/Users/sethogieva/Desktop/mingla-orchs/1221-[careers-site]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (Both migrations are additive/idempotent — `if not exists`, `on conflict`. Apply A then B.)
2. **Deploy edge fns** from merged main, targeting prod:
   - `careers-apply` (verify_jwt=false), `careers-cv-signed-url` (verify_jwt=true) → `--project-ref gqnoajqerqhnvulmnyvv`.
3. **Vercel + DNS (Seth):** add `career.usemingla.com` to the existing `mingla-marketing` Vercel project; create CNAME `career` → `cname.vercel-dns.com`.
4. **Marketing Vercel env (Seth):** add `NEXT_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co` (production + preview) so the careers pages can read `job_postings`. (`NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` already exist.)
5. **Deploy marketing** (Vercel `[deploy]`) + **admin build**. No `eas update` (no native surface).
6. **Flip the 5 DRAFT invariants ACTIVE** (+ the D-1 delta invariant) in `INVARIANT_REGISTRY.md` at CLOSE.
7. **Resolve the ORCH-1221 collision** (this careers work vs the beta-form-brand-type work) per shipped-first-keeps-the-number.

---

## 11. Discoveries for orchestrator

- **D-1 (verification):** prod has BOTH `is_admin_user()` (no-arg session gate — what I used) AND `is_admin_email(text)` (email-arg helper). The SPEC flagged "verify, don't guess"; verified `is_admin_user()` is the correct gate for SECURITY DEFINER RPCs called from the authed admin session. No action needed — recorded for the registry.
- **ORCH-1221 ID collision is REAL and on disk:** the OTHER 1221 (beta-form-brand-type) ships migration `20261126000000` + a strict-grep job `orch-1221-allpill-selects-all`. I deliberately namespaced ALL careers gate jobs `orch-1221-careers-*` and named my migrations `...000001`/`...000002` so there is **no file or YAML-job-key collision** even if both merge. The only shared file is `strict-grep-mingla-business.yml` (both append jobs) — a future merge keeps both job blocks. Orchestrator resolves numbering at CLOSE.
- **No COMMS entries written** — no in-flight ORCH is affected by this work (disjoint file set from the beta-form 1221; no shared product code). COMMS_LEDGER scanned on entry: no BLOCK/WARN row addressed to mingla-implementor / META-ORCH-1221 / ALL required action.
