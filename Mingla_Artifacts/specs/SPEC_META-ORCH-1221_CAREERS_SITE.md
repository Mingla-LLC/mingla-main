# SPEC — META-ORCH-1221 Careers Site (`career.usemingla.com`)

> **Mode:** SPEC (engineering build contract). Produced by mingla-forensics 2026-06-22.
> **Worktree:** `~/Desktop/mingla-orchs/1221-[careers-site]/` on branch `1221-careers-site` (rebased on origin/main, up to date).
> **Design contract (binding, do NOT rewrite):** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1221_CAREERS_SITE.md` — referenced by section for every Leg 3 component/state/motion detail.
> **JD source (seed):** `Mingla_Artifacts/ORCH_1221_CAREERS_JOB_DESCRIPTIONS.md` (YAML block at §"Structured data").
> **This is a build CONTRACT, not code.** Snippets ≤2–3 lines are illustrative only.

---

## ⚠️ ORCH-ID COLLISION — read first (orchestrator resolves at CLOSE)

**Two unmerged worktrees both claim ORCH-1221 off the stale anchor:**
- `~/Desktop/mingla-orchs/1221-[careers-site]/` (branch `1221-careers-site`) — **this** META-ORCH-1221 [Careers site]. Per the dispatch + WORLD_MAP this is the canonical META-ORCH-1221.
- `~/Desktop/mingla-orchs/1220-form-pill-multiselect-allpill/` — carries a migration `20261126000000_orch_1221_beta_access_brand_type_multi.sql` (a DIFFERENT feature: "Organiser beta form: brand-type multi-select"). NOT on origin/main, not on WORLD_MAP.

**Neither is shipped.** WORLD_MAP max on origin/main = ORCH-1219. Per shipped-first-keeps-the-number (COMMS-0011/0033/0037/0053/0055/0057), the late merger renumbers.

**RESOLUTION (orchestrator, at CLOSE):** if the beta-form-brand-type work merges first, the careers site renumbers to the next free ID (`git fetch` + scan main + WORLD_MAP + branches; frontier ≈ ORCH-1222+) and renames branch/worktree/artifacts/migrations/gates/invariants. If careers merges first, it keeps 1221 and the beta-form work renumbers. **No file collision on disk:** careers touches `mingla-marketing/app/(careers)/**`, `mingla-admin/src/pages/CareersPage.jsx`, `supabase/functions/careers-apply/**`, new `job_postings`/`job_applications` tables; the beta-form work touches `beta_access_leads` + `admin_beta_leads_list` only. **Only shared append target:** `.github/workflows/strict-grep-mingla-business.yml` (both append gate jobs) → merge-resolve keeping both sides.

A `COMMS-NNNN` WARN entry is filed for this (see §10 Open Questions → routed to orchestrator).

---

## 1. Executive summary

Build a standalone, data-driven careers site served from `career.usemingla.com` off the **same `mingla-marketing` Vercel project** via a host-based Next.js middleware rewrite into a new `(careers)` route group — with zero impact on `usemingla.com`. The site renders open roles from a new `job_postings` table (one open row = one card), shows salary publicly, and per-role pre-binds an application form with **six required fields** (full name, email, WhatsApp phone, preferred salary, CV upload, portfolio URL). Submissions flow through a new public `careers-apply` edge function (service-role; anon cannot read or insert directly) that uploads the CV to a private `career-cvs` bucket, inserts a `job_applications` row, and sends a branded confirmation email to the applicant + a branded notification to `seth@usemingla.com` — reusing the exact `renderShell` branded email shell + Resend senders the explorer-lead function uses. All applications are visible/manageable in `mingla-admin` via a new Careers/Applications list+detail view (filter by role + status, signed CV download, status update). The two roles seed from the JD YAML.

Three legs: **Leg 2 = backend** (DDL, RLS, bucket, `careers-apply` edge fn, seed). **Leg 3 = public site** (subdomain rewrite + 3 routes, design-driven). **Leg 4 = admin** (list+detail). Design is fully owned by the DESIGN contract; this SPEC owns the engineering.

---

## 2. Scope & non-goals

**In scope:**
- Subdomain `career.usemingla.com` served from the `mingla-marketing` Vercel project via host-based `middleware.ts` rewrite → `(careers)` route group. Vercel domain-add + DNS record specified for Seth.
- `job_postings` + `job_applications` tables, RLS, private `career-cvs` bucket, the `careers-apply` edge fn, an admin-read SECURITY DEFINER RPC, an admin signed-CV-download path (reuse storage signed-URL pattern), and a seed migration for the two roles.
- Three public routes: `/` (index), `/roles/[slug]` (JD), `/roles/[slug]/apply` (form) as data-driven server components reading Supabase via the marketing app's existing anon-key + raw-fetch transport (the marketing app carries no `@supabase/supabase-js` client).
- New admin `CareersPage` (list filtered by role + status; detail with every field, signed CV link, portfolio link, status update).
- Strict-grep regression gates + DRAFT invariants per the CLOSE-HARD-MUST rule.

**Non-goals (explicitly out, with reasons):**
- **No mobile / React Native surface.** Careers is web-only (DESIGN §0, §6). No `app-mobile` / `mingla-business` change. (This also means **no business OTA** — COMMS-0052 OTA freeze is irrelevant to this ORCH.)
- **No applicant accounts / auth.** Public anonymous apply only (mirrors explorer-lead). No login, no resume parsing, no ATS pipeline beyond status field.
- **No multi-country generalization beyond the two seeded NGN roles.** `salary_display` is verbatim text — currency/period handling is per-row data, not a localization engine.
- **No email-to-applicant beyond the single confirmation** (no nurture sequence). No SMS/WhatsApp send (phone is captured for the recruiter to use manually).
- **No public listing of `status != 'open'` postings**, no public read of `job_applications` (RLS-denied; the whole point of Leg 2 RLS).
- **No edit/create of `job_postings` from the admin UI in v1** — postings are managed by migration/seed + direct SQL. (Admin v1 manages *applications*, not postings. A posting CRUD admin screen is a follow-on ORCH if Seth wants it — flagged §10.)
- **No dark mode** (DESIGN §0 — light-only, matches the live marketing site).

**Assumptions:**
- The live prod Supabase project is `gqnoajqerqhnvulmnyvv` (per memory: the CLI links the WRONG project; all `apply_migration`/`deploy_edge_function` MUST target `--project-ref gqnoajqerqhnvulmnyvv`).
- `mingla-marketing` deploys on Vercel; `career.usemingla.com` will be added to the SAME project.
- Resend sender domain `usemingla.com` is verified (explorer-lead already sends from `notifications@usemingla.com` in prod).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | **NO** | — | none | N/A — careers is web-only (DESIGN §0). |
| 2 | Consumer Android (`app-mobile`) | **NO** | — | none | N/A — web-only. |
| 3 | Buyer/anon Web (`mingla-business`) | **NO** | — | none | N/A — careers lives in `mingla-marketing`, not `mingla-business`. |
| 4 | Business iOS | **NO** | — | none | N/A — web-only. |
| 5 | Business Android | **NO** | — | none | N/A — web-only. |
| 6 | Admin Web (`mingla-admin`) | **YES** | New "Applications" nav item → list (filter by role + status) + detail (all fields, signed CV download, portfolio link, status update). | `mingla-admin/src/pages/CareersPage.jsx`, `mingla-admin/src/services/careersService.js`, `mingla-admin/src/App.jsx`, `mingla-admin/src/lib/constants.js` (+ Sidebar icon map). | Manual (separate path; no shared code). |
| 7 | Marketing Web preview / `mingla-marketing` | **YES (the primary surface)** | `career.usemingla.com` renders the careers index + JD + apply form; `usemingla.com` is **unchanged**. | `mingla-marketing/middleware.ts` (NEW), `mingla-marketing/app/(careers)/**` (NEW), `mingla-marketing/lib/careers-*.ts` (NEW), `mingla-marketing/app/globals.css` (add ≤4 tokens). | Manual (host-based rewrite). |

Backend (`supabase/`) is shared infrastructure consumed by surfaces 6 + 7. No primary mobile surface is in scope; the careers feature has no native blast radius.

---

## 4. Layered specification

### 4.A — Database (Leg 2)

**Migration A — schema + RLS + bucket.** Filename:
`supabase/migrations/20261126000001_orch_1221_careers_postings_applications.sql`
(version `20261126000001` strictly > the highest seen anywhere: main max `20261125000000`, in-flight max `20261126000000` in worktree `1220`. Confirmed monotonic + collision-free across main + all worktrees.)

**Migration B — seed the two roles.** Filename:
`supabase/migrations/20261126000002_orch_1221_careers_seed_roles.sql`
(strictly > Migration A.)

> **Apply protocol (per memory + SAFE_MIGRATION):** do NOT `supabase db push` (CLI links the wrong project). Apply both via MCP `apply_migration` with `--project-ref gqnoajqerqhnvulmnyvv`, or hand to Seth. Migrations are additive/idempotent (`if not exists`, `on conflict do nothing`). The orchestrator/implementor does NOT apply during IMPLEMENT — apply happens at deploy.

#### 4.A.1 `job_postings` DDL (Migration A)

```sql
create table if not exists public.job_postings (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  title           text not null check (char_length(title) between 1 and 120),
  department      text not null check (char_length(department) between 1 and 80),
  location        text not null check (char_length(location) between 1 and 120),
  employment_type text not null default 'full_time'
                    check (employment_type in ('full_time','part_time','contract','internship')),
  salary_min      integer check (salary_min is null or salary_min >= 0),
  salary_max      integer check (salary_max is null or salary_max >= 0),
  salary_currency text not null default 'NGN' check (char_length(salary_currency) between 3 and 3),
  salary_period   text not null default 'month' check (salary_period in ('hour','day','week','month','year')),
  salary_display  text not null check (char_length(salary_display) between 1 and 120),
  summary         text not null check (char_length(summary) between 1 and 400),
  body            text not null,                       -- markdown JD body
  status          text not null default 'draft' check (status in ('draft','open','closed')),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists job_postings_status_sort_idx
  on public.job_postings (status, sort_order asc, created_at desc);
```

#### 4.A.2 `job_applications` DDL (Migration A)

```sql
create table if not exists public.job_applications (
  id               uuid primary key default gen_random_uuid(),
  job_posting_id   uuid not null references public.job_postings (id) on delete restrict,
  full_name        text not null check (char_length(full_name) between 1 and 80),
  email            text not null check (char_length(email) between 3 and 254),
  whatsapp_phone   text not null check (char_length(whatsapp_phone) between 7 and 24),
  preferred_salary text not null check (char_length(preferred_salary) between 1 and 60),
  cv_path          text not null,                       -- storage object path in career-cvs (private)
  portfolio_url    text not null check (char_length(portfolio_url) between 4 and 2048),
  status           text not null default 'new'
                     check (status in ('new','reviewing','shortlisted','rejected','hired')),
  user_agent       text,                                -- truncated <=512 at write
  referer          text,                                -- truncated <=512 at write
  ip_hash          text,                                -- salted SHA-256; never raw IP
  created_at       timestamptz not null default now()
);
create index if not exists job_applications_posting_created_idx
  on public.job_applications (job_posting_id, created_at desc);
create index if not exists job_applications_status_idx
  on public.job_applications (status, created_at desc);
create index if not exists job_applications_ip_hash_recent_idx
  on public.job_applications (ip_hash, created_at desc);   -- soft-throttle window
```

#### 4.A.3 RLS (Migration A) — the security spine

```sql
alter table public.job_postings    enable row level security;
alter table public.job_applications enable row level security;

-- job_postings: anon (and authenticated) may SELECT ONLY status='open'. No write policy.
create policy "job_postings_public_read_open"
  on public.job_postings for select
  to anon, authenticated
  using (status = 'open');

-- job_applications: NO permissive policy at all → deny-by-default for anon AND authenticated.
--   * anon cannot SELECT (privacy) and cannot INSERT (inserts go ONLY through the
--     careers-apply edge fn via the service role, which bypasses RLS).
--   * admin reads via the SECURITY DEFINER RPC below (is_admin gated), NOT via a table policy.
```

> **Why no public read on `job_applications`:** mirrors the `explorer_app_leads` deny-by-default pattern (migration `20261124000000_orch_1216_explorer_app_leads.sql`) and the I-1045-ANON-NO-SELECT discipline. The marketing site is unauthenticated; application rows (PII: name, email, phone, CV path) must never be readable by the public anon key.

#### 4.A.4 Admin-read RPC (Migration A) — mirrors `admin_explorer_app_leads_list`

```sql
create or replace function public.admin_job_applications_list(p_status text default null, p_job_posting_id uuid default null)
  returns table( ... all job_applications columns + job_posting slug/title ... )
  language sql stable security definer set search_path to 'public'
as $$
  select ja.*, jp.slug as job_slug, jp.title as job_title
  from public.job_applications ja
  join public.job_postings jp on jp.id = ja.job_posting_id
  where (p_status is null or ja.status = p_status)
    and (p_job_posting_id is null or ja.job_posting_id = p_job_posting_id)
    and public.is_admin_user()          -- SAME admin gate the existing admin RPCs use
  order by ja.created_at desc;
$$;
revoke all on function public.admin_job_applications_list(text, uuid) from public, anon;
grant execute on function public.admin_job_applications_list(text, uuid) to authenticated;
```

> **Admin gate:** use the SAME `is_admin_user()` SECURITY DEFINER check the existing admin RPCs use (`admin_explorer_app_leads_list`, `admin_get_claim_review_bundle` per the admin recon). The function must internally require `is_admin_user()` — either as a `where` predicate (as above) or a guard that raises. Confirm the exact admin-gate function name in `supabase/migrations/` before writing (recon cites both `is_admin_user()` and `is_admin_email()`; use whichever the live admin RPCs use — verify, do not guess).

#### 4.A.5 Admin status-update RPC (Migration A)

```sql
create or replace function public.admin_set_job_application_status(p_application_id uuid, p_status text)
  returns public.job_applications
  language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_admin_user() then raise exception 'forbidden'; end if;
  if p_status not in ('new','reviewing','shortlisted','rejected','hired')
    then raise exception 'invalid_status'; end if;
  update public.job_applications set status = p_status where id = p_application_id
    returning * into strict <result>;  -- bind + return updated row
  ...
end;
$$;
revoke all on function public.admin_set_job_application_status(uuid, text) from public, anon;
grant execute on function public.admin_set_job_application_status(uuid, text) to authenticated;
```

#### 4.A.6 Private `career-cvs` storage bucket (Migration A) — mirrors `ticket-pdfs`

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'career-cvs', 'career-cvs', false,
  5242880,                                                 -- 5 MB (matches DESIGN §4.4 + form client validation)
  array['application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']  -- PDF, DOC, DOCX
)
on conflict (id) do nothing;
-- NO storage.objects client-role policies (mirror ticket-pdfs ORCH-0842):
--   writes happen via service-role (careers-apply edge fn); reads happen via
--   service-role-issued signed download URLs (admin path). Service role bypasses
--   RLS → no anon/authenticated policy needed. Anon/authenticated have zero access.
```

> **Path convention:** `cv_path` = `{job_posting_id}/{application_uuid}-{sanitized_filename}` (e.g. `…/9f2c…-jane-doe-cv.pdf`). Sanitize filename to `[a-zA-Z0-9._-]`, cap length, keep extension. The `{job_posting_id}` first folder segment matches the trip-intake `storage.foldername` convention for future per-role policy scoping if ever needed.

#### 4.A.7 Seed migration (Migration B) — the two roles from the JD YAML

`20261126000002_orch_1221_careers_seed_roles.sql`. Idempotent `insert … on conflict (slug) do update`. Seed BOTH rows with `status='open'`, `sort_order` 0 then 1, and the **full markdown JD `body`** copied from `ORCH_1221_CAREERS_JOB_DESCRIPTIONS.md` §"Role 1" / §"Role 2" (the sections About Mingla → About the role → What you'll do → What we're looking for → Nice to have → Compensation & logistics, rendered as markdown; OMIT the "How to apply" section — the apply CTA is the page itself). Verbatim values from the YAML block:

| slug | title | department | location | employment_type | salary_min | salary_max | salary_currency | salary_period | salary_display | summary | status | sort_order |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `multimedia-designer` | Multimedia Designer | Brand & Creative | Remote (Nigeria) | full_time | 150000 | 250000 | NGN | month | `₦150,000–₦250,000/month` | (YAML summary, role 1) | open | 0 |
| `community-brand-manager` | Community & Brand Manager | Growth & Community | Remote (Nigeria) | full_time | 150000 | 250000 | NGN | month | `₦150,000–₦250,000/month` | (YAML summary, role 2) | open | 1 |

The implementor copies the `summary` strings and full markdown `body` verbatim from the JD file. No paraphrasing.

---

### 4.B — Edge function `careers-apply` (Leg 2)

**Clone of `supabase/functions/explorer-app-lead-submit/index.ts`** (read it verbatim — same structure: CORS, soft-throttle, validate, service-role insert, two branded emails). New file: `supabase/functions/careers-apply/index.ts`.

- **Route / method:** `POST https://gqnoajqerqhnvulmnyvv.functions.supabase.co/careers-apply`. OPTIONS → 200 + `corsHeaders`. Non-POST → 405 `{ ok:false, error:'method_not_allowed' }`.
- **`verify_jwt`:** `false`. Add to `supabase/config.toml`:
  ```toml
  [functions.careers-apply]
  verify_jwt = false
  ```
- **CORS:** import `corsHeaders` from `../_shared/cors.ts` (already includes `x-client-info` — satisfies the I-PROPOSED-1205 gate; do NOT inline a hand-rolled allow-list).

**Request shape** (JSON — the CV is uploaded in the SAME request as base64, OR via a two-step signed-upload; see CV handling below):
```ts
interface CareersApplyInput {
  job_slug: string;          // role pre-binding (the form passes the slug, NOT the id)
  full_name: string;         // trimmed
  email: string;             // trimmed, lowercased
  whatsapp_phone: string;    // trimmed
  preferred_salary: string;  // trimmed, text
  portfolio_url: string;     // trimmed
  cv_base64: string;         // base64-encoded file bytes
  cv_filename: string;       // original filename (for extension + sanitize)
  cv_mime: string;           // declared mime (re-validated server-side)
}
```

**Server-side validation (ALL SIX required — mirror DESIGN §4.3 error copy; these are the canonical server messages mapped to `fields[]`):**

| field | rule | failure → in `fields[]` |
|---|---|---|
| `job_slug` | resolves to a `job_postings` row with `status='open'` (service-role SELECT) | `job_slug` (→ 400 `role_not_open`) |
| `full_name` | non-empty, 1–80 chars after trim | `full_name` |
| `email` | `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤254 | `email` |
| `whatsapp_phone` | strip spaces; optional leading `+`; 7–20 digits | `whatsapp_phone` |
| `preferred_salary` | non-empty, ≤60 chars | `preferred_salary` |
| `portfolio_url` | parses as `http(s)` URL, ≤2048 | `portfolio_url` |
| CV (`cv_base64`+`cv_mime`+`cv_filename`) | mime ∈ `{application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document}`; decoded byte length ≤ 5 MB (5242880); filename present | `cv` |

Any failure → `400 { ok:false, error:'validation', fields:[…] }`. **All six are validated server-side** (do not trust the client) — this is a hard invariant + gate (§6, §9).

**CV upload handling:** decode `cv_base64`; re-check mime + size server-side; sanitize `cv_filename`; build `cv_path = {job_posting_id}/{application_uuid}-{sanitized}`; `supabase.storage.from('career-cvs').upload(cv_path, bytes, { contentType: cv_mime, upsert: false })` with the SERVICE-ROLE client. On upload error → `500 { ok:false, error:'server' }` (do NOT insert an orphan row). Order: validate → resolve role → upload CV → insert row → send emails.

**Insert:** service-role insert into `job_applications` (bypasses RLS) with `job_posting_id` (resolved from slug), the six fields, `cv_path`, plus `user_agent`/`referer` truncated ≤512 and `ip_hash` = salted SHA-256 (reuse the `BETA_LEAD_IP_SALT` env + `hashIp()` helper from explorer-lead; no new env).

**Soft throttle:** reuse the explorer-lead window — 10-minute window, max 5 per salted IP hash → 6th in window returns `429 { ok:false, error:'rate_limited' }`. (Count via the `ip_hash + created_at` index.)

**Emails (reuse the EXACT branded shell + senders — non-negotiable):**
- Import `renderShell` from `../_shared/email/shell.ts`, `escapeHtml` from `../_shared/email/escape.ts`, `EMAIL_SENDERS` + `assertNotResendSandbox` from `../_shared/email/senders.ts`. `RESEND_API_KEY` env.
- **Applicant confirmation** → `to:[email]`, `from: EMAIL_SENDERS.system` (`notifications@usemingla.com`), `renderShell({ preheader, bodyHtml, supportEmail, logoUrl, footerAddress })`. Body = DESIGN §4.6 voice: "Application received. Thanks, {firstName} — we've got your application for {roleTitle}. We review every one and reach out by email if there's a fit." All dynamic strings `escapeHtml`'d. Sent ONLY on successful insert. Non-fatal on Resend failure (row already saved; log + continue).
- **Notification to Seth** → `to:['seth@usemingla.com']`, same `from`, a plain branded table listing role, name, email, WhatsApp, preferred salary, portfolio URL, received-at, and a note that the CV is in admin. Non-fatal on failure.

**Responses:**
- `200 { ok:true }` — application created (always a fresh row; unlike explorer-lead there is NO idempotency-on-email dedupe — a person may apply to multiple roles, and re-applying to the same role is allowed).
- `400 { ok:false, error:'validation', fields:string[] }` — any field invalid / role not open.
- `405 { ok:false, error:'method_not_allowed' }`.
- `429 { ok:false, error:'rate_limited' }`.
- `500 { ok:false, error:'server' }` — upload/insert/unexpected failure (form keeps inputs, shows retry per DESIGN §4.7).

> **Edge-fn DO-NOT:** do NOT add an inline `Access-Control-Allow-Headers` literal (use shared cors.ts). Do NOT use the anon key — service-role only for writes/storage. Do NOT return any `job_applications` row data to the public response (only `{ok}`). Do NOT send from a `@resend.dev` sender (`assertNotResendSandbox` guards this).

---

### 4.C — Public site (Leg 3)

#### 4.C.1 Subdomain rewrite mechanism (the exact files)

The marketing app is Next.js 15.1.6 app-router, **no middleware today**, no rewrites in `next.config.ts`. Mechanism = **host-based middleware rewrite into a `(careers)` route group**, which is confirmed-compatible with this app-router setup.

**NEW file: `mingla-marketing/middleware.ts`** (project root, sibling of `next.config.ts`):
- Read `req.headers.get('host')`. If host starts with `career.` (covers `career.usemingla.com` + Vercel preview aliases) AND the pathname is NOT already under `/_careers`, rewrite to `/_careers${pathname}` (an internal-only prefix that maps to the `(careers)` group — see below). Use `NextResponse.rewrite(new URL('/_careers' + pathname + search, req.url))`.
- For all other hosts (`usemingla.com`, `www.usemingla.com`) → `NextResponse.next()` unchanged. **`usemingla.com` is provably untouched** (the rewrite only fires on the `career.` host).
- **`matcher`** config: exclude `/_next`, `/api`, static assets, `.well-known` (so `apple-app-site-association` / `assetlinks.json` still serve on the apex). Pattern:
  ```ts
  export const config = { matcher: ['/((?!_next/|.well-known/|.*\\..*).*)'] };
  ```

**Route group structure (NEW):** because middleware rewrites to a path prefix, use a **catch-all-free explicit prefix folder** rather than a bare `(careers)` group, since a route group `(careers)` does NOT add a URL segment and the careers `/` would collide with the existing `(explorer)/page.tsx` at `/`. Two valid options — **choose Option A**:

- **Option A (RECOMMENDED — rewrite to a real `_careers` segment):** create `mingla-marketing/app/_careers/` with:
  - `app/_careers/layout.tsx` — the careers chrome (DESIGN §1 header + footer); reuses the root layout's fonts (already loaded). Wraps children; light-only.
  - `app/_careers/page.tsx` — index `/` (DESIGN §2).
  - `app/_careers/roles/[slug]/page.tsx` — JD (DESIGN §3).
  - `app/_careers/roles/[slug]/apply/page.tsx` — form (DESIGN §4).
  The middleware maps `career.usemingla.com/` → `/_careers`, `…/roles/x` → `/_careers/roles/x`, etc. `_`-prefixed folders are NOT route groups but ARE normal segments; the segment is never reachable from the apex because middleware only rewrites the `career.` host and `usemingla.com/_careers` is not linked (optionally 404 it in middleware: if host is NOT `career.` and pathname starts with `/_careers` → `NextResponse.rewrite` to a 404 / `notFound`). **Add that apex-guard** so `usemingla.com/_careers/...` is not crawlable.

> The dispatch's hypothesis ("`(careers)` route group") is sound in intent, but a bare parenthesized group serving `/` collides with the existing root `(explorer)/page.tsx`. The host-rewrite-to-`_careers`-segment is the precise, collision-free realization. State this clearly to the implementor.

**`next.config.ts`:** **no change required** (middleware handles routing). **`vercel.json`:** no change required (well-known headers stay on the apex; the matcher excludes `.well-known`).

**Vercel domain-add + DNS (Seth's action — see §B):** add `career.usemingla.com` as a domain on the `mingla-marketing` Vercel project; create the DNS record Vercel prescribes (CNAME `career` → `cname.vercel-dns.com`, or the apex/ALIAS variant Vercel shows). No new Vercel project.

#### 4.C.2 Data-fetch contracts (server components)

The marketing app has **no `@supabase/supabase-js` client** — it uses raw `fetch` with the public anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) + `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL`, per `lib/explorer-app-submit.ts`. For careers READS we need PostgREST table reads (not an edge fn), so add a sibling env `NEXT_PUBLIC_SUPABASE_URL` (the REST base `https://gqnoajqerqhnvulmnyvv.supabase.co`) — **confirm it is present in the marketing Vercel env; if absent, Seth adds it** (§10 open question). New helper lib:

**NEW `mingla-marketing/lib/careers-data.ts`** (server-only data layer; raw fetch to PostgREST with anon key):
- `listOpenRoles(): Promise<JobPosting[]>` → `GET {REST}/rest/v1/job_postings?status=eq.open&select=slug,title,department,location,employment_type,salary_display,summary,sort_order,created_at&order=sort_order.asc,created_at.desc` with `apikey` + `Authorization: Bearer <anon>`. RLS guarantees only `status='open'` returns (the `status=eq.open` filter is belt-and-suspenders; RLS is the real fence). **Never selects `body` for the index** (lighter payload).
- `getOpenRoleBySlug(slug): Promise<JobPosting | null>` → `…&slug=eq.{slug}&status=eq.open&select=*&limit=1`. Returns null → DESIGN §3.3 "not found / closed" panel. RLS ensures a `draft`/`closed` slug returns nothing → JD never renders publicly (this is a gate, §9).
- Used by the three server components for instant SSR + SEO (DESIGN §6).

The three routes are **server components** calling these; framer-motion entrance/hover/sticky hydrate as client sub-components (DESIGN §6).

#### 4.C.3 Route → DESIGN section map (every component/state/motion detail lives in DESIGN; do NOT duplicate here)

| Route | Server fetch | Renders | DESIGN section (binding) |
|---|---|---|---|
| `/` (`app/_careers/page.tsx`) | `listOpenRoles()` | Hero + `RoleCard` grid; loading/empty/error states; mount stagger + hover motion | DESIGN §2 (all of 2.1–2.5) |
| `/roles/[slug]` (`…/roles/[slug]/page.tsx`) | `getOpenRoleBySlug(slug)` → `notFound()`-style panel if null | Back link, header, salary, Apply CTA(s), markdown JD body, mobile sticky bar | DESIGN §3 (all of 3.1–3.4) |
| `/roles/[slug]/apply` (`…/apply/page.tsx`) | `getOpenRoleBySlug(slug)` for the role banner; client form | Context header, 6-field form, `CvDropzone`, submit/submitting/success/error states | DESIGN §4 (all of 4.1–4.8) |

**Markdown rendering (JD `body`):** render the stored markdown to HTML on the server (a lightweight md→html; sanitize). Map to DESIGN §3.2.4 typography. No new heavy dep if avoidable — a minimal server-side markdown render is fine.

#### 4.C.4 Client form submit → `careers-apply` flow

**NEW `mingla-marketing/lib/careers-apply-submit.ts`** — clone of `lib/explorer-app-submit.ts` transport (raw `fetch` to the edge fn with anon key in `Authorization` + `apikey`; the anon key is public by design — RLS denies anon SELECT, edge fn writes via service role). Contract:
```ts
interface CareersApplyClientInput { job_slug; full_name; email; whatsapp_phone; preferred_salary; portfolio_url; cv_base64; cv_filename; cv_mime; }
type CareersApplyResult =
  | { ok: true }
  | { ok: false; error: 'validation'; fields?: string[] }
  | { ok: false; error: 'rate_limited' | 'server' | 'network' };
```
- The apply form (client component) does the client-side per-field validation (DESIGN §4.3) + client CV validation (DESIGN §4.4: mime allowlist + 5 MB), reads the CV file → base64, then calls `submitCareersApplication(input)`.
- Maps results to DESIGN §4.6 (success — replace form) / §4.7 (400 → map `fields[]` to inputs + banner; 429 → banner keep-filled; server/network → retry banner, never clear, never false success).
- Client validation is UX-only; the server re-validates all six (§4.B) — the server is the authority.

#### 4.C.5 Tokens

DESIGN §7: confirm against `mingla-marketing/app/globals.css` `@theme` block and add ONLY the missing few: `--coral-600 #E85D1F`, `--coral-050 #FFF6F1`, `--success-500 #1FA971`, `--danger-500 #D64545`. `--coral-500` exists as `--color-warm`/coral palette; map per DESIGN §0 (the design uses `--coral-500 = #FF6B2C`, which matches the email-shell `BRAND_ORANGE` and is close to but distinct from the marketing `--color-warm #eb7825` — **use the DESIGN's `#FF6B2C` careers tokens**, scoped to the `_careers` subtree, to match the branded email palette the confirmation email uses). Add the careers tokens scoped under the careers layout or as new `@theme` tokens; do NOT change existing `--color-warm`.

---

### 4.D — Admin (Leg 4)

Mirror **`mingla-admin/src/pages/ClaimsPage.jsx`** (the canonical list+detail with status tabs + modal detail + status mutations) and its service `adminClaimsService.js`. Admin is hash-routed (no react-router), Vite + React 19, `supabase` client from `src/lib/supabase` (authenticated session; reads gated by SECURITY DEFINER RPCs requiring `is_admin_user()`).

**NEW files:**
- `mingla-admin/src/pages/CareersPage.jsx` — list+detail. **List:** status tabs (`new` / `reviewing` / `shortlisted` / `rejected` / `hired`) + a role filter (dropdown of postings, "All roles" default). Rows show name, role title, email, status badge, created-at. **Detail (modal):** every field — full name, email, WhatsApp phone (click-to-copy), preferred salary, portfolio URL (link, `target=_blank rel=noopener`), role title/slug, created-at, status badge — plus a **"Download CV"** button (signed URL, see below) and status-update buttons (mirror ClaimsPage modal footer: a status dropdown or button row → `admin_set_job_application_status`). Use the existing `Modal`, `Badge`, `Button`, `ToastContext` primitives.
- `mingla-admin/src/services/careersService.js` — `listApplications({status, jobPostingId})` → `supabase.rpc('admin_job_applications_list', {p_status, p_job_posting_id})`; `listPostings()` → `supabase.from('job_postings').select('id,slug,title').order('sort_order')` (admin session can read all via RLS open-only? NO — admin needs ALL postings incl. draft/closed for the filter → add an `admin_job_postings_list()` SECURITY DEFINER RPC in Migration A, OR have the filter list only the postings that appear in applications. **Decision: add `admin_job_postings_list()` SD RPC** so the filter shows every role.); `setApplicationStatus(id, status)` → `supabase.rpc('admin_set_job_application_status', …)`; `getCvSignedUrl(cvPath)` → see below.

**Signed CV download (admin):** the bucket is private with NO client policies → the admin browser cannot `createSignedUrl` directly (no storage policy grants it, and admin uses anon-key+session, not service-role). **Add a tiny service-role edge fn `careers-cv-signed-url`** (or extend an existing admin signed-url fn): `verify_jwt = true`, validates the caller is an admin (decode JWT → `is_admin_user()` via an authed Supabase call), then service-role `storage.from('career-cvs').createSignedUrl(cv_path, 60)` (60s TTL, mirrors `ticket-pdf-fetch`). Returns `{ url }`. The admin "Download CV" button calls this fn then opens the URL. **This is the ONLY way the private CV is reachable** — anon and non-admin authed callers get 403.

> Admin DO-NOT: do NOT grant anon/authenticated SELECT on `career-cvs` storage.objects (keep the private bucket sealed). Do NOT read `job_applications` via a direct `supabase.from(...)` (RLS denies it — must go through the admin RPC). Do NOT add posting CRUD UI in v1.

---

## 5. Success criteria (numbered, observable, testable)

- **SC-1 (DB/RLS):** Anon `GET /rest/v1/job_postings?status=eq.open` returns only open rows; `?status=eq.draft` (or any non-open) returns `[]`. Anon `GET /rest/v1/job_applications` returns `[]`/403 (RLS deny). Anon `POST /rest/v1/job_applications` is rejected (no insert policy).
- **SC-2 (edge validation):** `POST careers-apply` with any one of the six fields missing/invalid → `400 {ok:false,error:'validation',fields:[…]}` naming that field; all six omitted → `fields` contains all six. A valid payload → `200 {ok:true}` + a row in `job_applications` + a file in `career-cvs` + two emails (applicant + seth@).
- **SC-3 (edge role-binding):** `careers-apply` with a `job_slug` whose posting is `draft`/`closed`/nonexistent → `400` with `job_slug` in `fields` (role_not_open). No row, no CV, no email.
- **SC-4 (edge CV):** CV mime outside the PDF/DOC/DOCX allowlist → 400 `cv`; CV > 5 MB decoded → 400 `cv`. Valid CV stored at `{job_posting_id}/{uuid}-{sanitized}`.
- **SC-5 (rate limit):** 6th `careers-apply` from one IP within 10 min → `429 {error:'rate_limited'}`.
- **SC-6 (subdomain rewrite — Web):** `career.usemingla.com/` renders the careers index; `career.usemingla.com/roles/multimedia-designer` renders the JD; `career.usemingla.com/roles/multimedia-designer/apply` renders the form. `usemingla.com/` is byte-identical to before (the explorer homepage); `usemingla.com/_careers/...` does NOT render careers (apex-guard → notFound).
- **SC-7 (index data-driven — Web):** the index shows exactly the open postings as cards (2 seeded → 2 cards), ordered `sort_order asc`; a posting flipped to `closed` (direct SQL) disappears from the index with no code change; `closed` JD URL → DESIGN §3.3 "not open" panel, JD body NOT in the HTML.
- **SC-8 (form happy path — Web):** filling all six valid fields + a valid CV → submit → DESIGN §4.6 success panel; the applicant receives the branded confirmation email; seth@ receives the notification; admin sees the new application.
- **SC-9 (form errors — Web):** invalid field → DESIGN §4.7 inline error + banner, inputs never cleared; 429 → keep-filled banner; server/upload failure → retry banner, no false success.
- **SC-10 (admin list+detail):** the Applications nav item lists applications filterable by role + status; detail shows every field + a working "Download CV" (opens the signed URL) + portfolio link; changing status via the buttons updates the row and persists (re-fetch shows the new status).
- **SC-11 (admin security):** a non-admin authed session calling `admin_job_applications_list` / `careers-cv-signed-url` is denied (RPC `is_admin_user()` false → empty/raise; signed-url fn → 403).
- **SC-12 (seed):** after Migration B, `job_postings` has the two roles with the exact `slug`/`title`/`salary_display`/`status='open'` from the YAML, and the JD `body` markdown renders on the role pages.

---

## 6. Invariants

**Preserved (existing):**
- **I-PROPOSED-1205-EDGE-CORS-X-CLIENT-INFO** — `careers-apply` imports `_shared/cors.ts` (which includes `x-client-info`); no inline allow-list. Verified by the existing `orch-1205-edge-cors-x-client-info.mjs` gate (already CI-wired).
- **I-1045-ANON-NO-SELECT (explorer/beta lead family)** — `job_applications` has deny-by-default RLS; no anon SELECT policy. New gate asserts this (below).
- **I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT** — the marketing client uses ONLY the anon key (raw fetch); no service-role key in any `mingla-marketing/**` or client bundle. New gate extends this to careers libs.

**NEW (propose as DRAFT — orchestrator flips ACTIVE on CLOSE):**
- **I-PROPOSED-1221-APPLICATIONS-DENY-ANON** *(DRAFT)* — `job_applications` MUST have RLS enabled and NO permissive `to anon`/`to public` policy; reads go only through `is_admin_user()`-gated SD RPCs; inserts only via the service-role edge fn. Gate: `i-proposed-1221-applications-deny-anon.mjs`.
- **I-PROPOSED-1221-POSTINGS-PUBLIC-OPEN-ONLY** *(DRAFT)* — the only anon-SELECT policy on `job_postings` MUST be `using (status = 'open')`; the public read libs filter `status=eq.open`. Gate: `i-proposed-1221-postings-open-only.mjs`.
- **I-PROPOSED-1221-APPLY-VALIDATES-ALL-SIX** *(DRAFT)* — `careers-apply/index.ts` MUST server-validate all six required fields (full_name, email, whatsapp_phone, preferred_salary, CV, portfolio_url) — a structural check that each field name + its reject path is present. Gate: `i-proposed-1221-apply-six-fields.mjs`.
- **I-PROPOSED-1221-CV-BUCKET-PRIVATE** *(DRAFT)* — the `career-cvs` bucket migration MUST set `public, false` with the 5 MB limit + the PDF/DOC/DOCX mime allowlist, and define NO anon/authenticated `storage.objects` policy for it. Gate: `i-proposed-1221-cv-bucket-private.mjs`.
- **I-PROPOSED-1221-CAREERS-SUBDOMAIN-ISOLATED** *(DRAFT)* — `mingla-marketing/middleware.ts` MUST only rewrite the `career.` host into `_careers` and MUST guard the apex against `/_careers` (so `usemingla.com` is untouched). Gate: `i-proposed-1221-careers-host-isolated.mjs`.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T1 | RLS open-only read | anon GET job_postings status=eq.open | only open rows | DB/RLS |
| T2 | RLS draft hidden | anon GET status=eq.draft | `[]` | DB/RLS |
| T3 | RLS applications denied | anon GET/POST job_applications | denied/empty | DB/RLS |
| T4 | Admin read gated | non-admin rpc admin_job_applications_list | empty/raise | DB/RLS |
| T5 | Apply happy | all 6 valid + valid CV | 200 ok, row, CV stored, 2 emails | edge |
| T6 | Apply missing each field | each of 6 omitted | 400 fields:[that] | edge |
| T7 | Apply all missing | none provided | 400 fields = all 6 | edge |
| T8 | Apply closed role | slug of closed posting | 400 fields:[job_slug] | edge |
| T9 | CV bad mime | .exe / image | 400 fields:[cv] | edge |
| T10 | CV too big | 6 MB pdf | 400 fields:[cv] | edge |
| T11 | Rate limit | 6 posts/10min/IP | 429 | edge |
| T12 | Subdomain index | career. host `/` | careers index renders | web |
| T13 | Apex untouched | usemingla.com `/` | explorer homepage unchanged | web |
| T14 | Apex _careers guard | usemingla.com `/_careers` | notFound | web |
| T15 | Closed JD hidden | career. `/roles/{closed}` | "not open" panel, no JD in HTML | web |
| T16 | Form success | submit valid form | success panel + email | web |
| T17 | Form server error | edge returns 500 | retry banner, inputs kept | web |
| T18 | Admin detail + CV | open application, click Download CV | signed URL opens the CV | admin |
| T19 | Admin status update | set status → shortlisted | persists, badge updates | admin |
| T20 | Admin CV non-admin | non-admin calls careers-cv-signed-url | 403 | admin/edge |
| T21 | Seed | after Migration B | 2 open roles, exact YAML values | DB |

---

## 8. Implementation order

1. **Migration A** (`20261126000001_…`): `job_postings` + `job_applications` + RLS + `career-cvs` bucket + admin RPCs (`admin_job_applications_list`, `admin_set_job_application_status`, `admin_job_postings_list`). Verify the exact admin-gate fn name (`is_admin_user()` vs `is_admin_email()`) against live admin RPCs first.
2. **Migration B** (`20261126000002_…`): seed the two roles (verbatim YAML + markdown bodies).
3. **Edge fn `careers-apply`** (`supabase/functions/careers-apply/index.ts`) + `config.toml` `verify_jwt=false`. Clone explorer-lead; reuse cors/shell/senders/escape/hashIp.
4. **Edge fn `careers-cv-signed-url`** (admin signed CV, `verify_jwt=true`, admin-gated, 60s TTL).
5. **Marketing tokens** — add the ≤4 careers tokens to `globals.css`.
6. **Marketing data lib** `lib/careers-data.ts` (server reads) + `lib/careers-apply-submit.ts` (client transport).
7. **Marketing routes** `app/_careers/{layout,page}.tsx` + `roles/[slug]/page.tsx` + `roles/[slug]/apply/page.tsx`, building each per DESIGN §1–§4.
8. **Marketing middleware** `middleware.ts` (host rewrite + apex guard + matcher).
9. **Admin** `careersService.js` + `CareersPage.jsx` + register in `App.jsx` PAGES + `constants.js` NAV_GROUPS + Sidebar icon map.
10. **CI gates** — 5 new `.mjs` gate scripts in `.github/scripts/strict-grep/` + 5 jobs appended to `strict-grep-mingla-business.yml` (its path triggers already cover `mingla-marketing/**`, `mingla-admin/**`, `supabase/migrations/**`, `supabase/functions/**`). Each gate ships a `--self-test` proving FAIL-on-revert + PASS-on-fix.

---

## 9. Regression prevention (fails-on-revert contract)

The strict-grep workflow `strict-grep-mingla-business.yml` **already triggers on `mingla-marketing/**`, `mingla-admin/**`, `supabase/migrations/**`, `supabase/functions/**`** — it is the correct, actually-running CI job. Each careers feature gets a gate wired as a parallel job (242 jobs already; pattern = one `.mjs` script + one job). Every gate has a `--self-test` and MUST prove PASS-on-fix + FAIL-on-revert:

| Gate script | Asserts (structural fence) | FAIL-on-revert proof |
|---|---|---|
| `i-proposed-1221-applications-deny-anon.mjs` | Migration A enables RLS on `job_applications` and defines NO `to anon`/`to public` policy on it | re-add an anon SELECT policy → gate FAILS |
| `i-proposed-1221-postings-open-only.mjs` | the `job_postings` anon policy is `using (status = 'open')` AND `careers-data.ts` filters `status=eq.open` | broaden the policy / drop the filter → FAILS |
| `i-proposed-1221-apply-six-fields.mjs` | `careers-apply/index.ts` references all six field names + their reject paths | delete any field's server validation → FAILS |
| `i-proposed-1221-cv-bucket-private.mjs` | Migration A inserts `career-cvs` with `false` (private) + `5242880` + the 3-mime allowlist, no anon storage policy | flip to public / widen mime / add anon policy → FAILS |
| `i-proposed-1221-careers-host-isolated.mjs` | `middleware.ts` rewrites only the `career.` host and guards the apex against `/_careers` | remove the host check / apex guard → FAILS |

Reuse the existing `orch-1205-edge-cors-x-client-info.mjs` (already CI-wired) as the CORS regression guard for `careers-apply` (no new gate needed — importing `_shared/cors.ts` keeps it green).

---

## 10. Open questions (for Seth / orchestrator)

1. **ORCH-ID collision (orchestrator):** two ORCH-1221s exist (careers + beta-form-brand-type). Resolve numbering at CLOSE per shipped-first-keeps-the-number (see top banner). A COMMS WARN is filed.
2. **DNS/Vercel (Seth):** confirm the `mingla-marketing` Vercel project will host `career.usemingla.com` (vs a new project). The SPEC assumes the same project. See §B.
3. **`NEXT_PUBLIC_SUPABASE_URL` env (Seth):** the marketing app currently has only `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The careers READS need the PostgREST base `https://gqnoajqerqhnvulmnyvv.supabase.co`. Confirm/add `NEXT_PUBLIC_SUPABASE_URL` to the marketing Vercel env (production + preview).
4. **CTA contrast (design open Q1):** darken the careers button base to `--coral-600` everywhere for a stricter AA pass? (DESIGN §5, §183.)
5. **Card grid density (design open Q2):** 2-up vs 3-up (DESIGN §185).
6. **Posting management (follow-on):** v1 manages applications only; postings are seeded/edited via SQL. Want an admin posting CRUD screen (create/edit/open/close roles without a migration)? If yes → a follow-on ORCH.
7. **Resend sender domain:** confirm `notifications@usemingla.com` is the desired careers sender (explorer-lead already uses it in prod) — or a dedicated `careers@usemingla.com` (would need Resend verification).

---

## 11. Downstream routing

**Next = mingla-implementor+claude (IMPLEMENT)**, in this worktree, building Legs 2→3→4 in the order of §8 against the allowlist below; then mingla-tester (TEST — RLS deny, six-field server validation, subdomain isolation, admin signed-CV, on-page form states); then mingla-orchestrator CLOSE (resolve the 1221 collision, flip the 5 DRAFT invariants ACTIVE, apply migrations via `--project-ref gqnoajqerqhnvulmnyvv`, deploy edge fns, Vercel `[deploy]` for marketing, admin build; NO `eas update` — no native surface).

### Scoped allowlist (implementor may CREATE/MODIFY ONLY these)

**Create:**
- `supabase/migrations/20261126000001_orch_1221_careers_postings_applications.sql`
- `supabase/migrations/20261126000002_orch_1221_careers_seed_roles.sql`
- `supabase/functions/careers-apply/index.ts`
- `supabase/functions/careers-cv-signed-url/index.ts`
- `mingla-marketing/middleware.ts`
- `mingla-marketing/app/_careers/layout.tsx`, `.../page.tsx`, `.../roles/[slug]/page.tsx`, `.../roles/[slug]/apply/page.tsx` (+ client sub-components under `app/_careers/` or `components/careers/`)
- `mingla-marketing/lib/careers-data.ts`, `mingla-marketing/lib/careers-apply-submit.ts`
- `mingla-admin/src/pages/CareersPage.jsx`, `mingla-admin/src/services/careersService.js`
- `.github/scripts/strict-grep/i-proposed-1221-*.mjs` (5 gates)

**Modify (surgical, additive):**
- `supabase/config.toml` (add the two `[functions.*]` `verify_jwt` blocks)
- `mingla-marketing/app/globals.css` (add ≤4 careers tokens — do NOT change `--color-warm`)
- `mingla-admin/src/App.jsx` (add `careers: CareersPage` to PAGES) + `mingla-admin/src/lib/constants.js` (NAV_GROUPS item) + Sidebar icon map
- `.github/workflows/strict-grep-mingla-business.yml` (append 5 gate jobs)

### DO-NOT-TOUCH

- `mingla-marketing/app/(explorer)/**`, `app/organisers/**`, any existing marketing route, `next.config.ts`, `vercel.json`, the existing fonts/root `layout.tsx` (reuse, do not edit).
- `supabase/functions/explorer-app-lead-submit/**`, `_shared/email/**`, `_shared/cors.ts` (reuse by import; do NOT edit).
- `beta_access_leads` / `admin_beta_leads_list` / the `1220` worktree's migration (the OTHER 1221).
- Any `app-mobile/**`, `mingla-business/**`, `packages/**` (no mobile surface).
- Any existing admin page/service/RPC; existing `is_admin_user()` definition (reuse, do not redefine).

The implementor must stop-and-amend (request a SPEC amendment) before touching anything outside the allowlist.

---

## ADDENDUM — Seth decisions (2026-06-22, orchestrator-authorized)

These three decisions OVERRIDE the body where they conflict. They are binding.

### D-1 — Admin role management: FULL CRUD in v1 (REVERSES §3 line 48 "no edit/create of job_postings from admin")

Admin v1 now manages BOTH applications AND postings. Add to **Leg 4 (admin)** and **Leg 2 (backend)**:

- **Backend writes (Migration A or a sibling migration):** add admin write access to `job_postings`. Implement as **SECURITY DEFINER RPCs gated by the SAME `is_admin_user()` check** used elsewhere (do NOT open a broad RLS write policy to authenticated users — keep the table write-locked and route admin writes through gated RPCs, mirroring the read RPC pattern already in the spec §4.A):
  - `admin_careers_upsert_posting(...)` — insert OR update a posting by `id` (null id = insert). Accepts every editable column: `title, slug, department, location, employment_type, salary_min, salary_max, currency, salary_period, salary_display, summary, body, status, sort_order`. Raises `forbidden` if not `is_admin_user()`. Enforces `slug` uniqueness (surface a clean error on conflict). On insert, default `status='draft'` unless provided.
  - `admin_careers_list_postings()` — returns ALL postings (every status, not just `open`) for the admin list, `is_admin_user()`-gated. (The public path still only reads `status='open'` via the existing public RLS select — unchanged.)
  - Optionally `admin_careers_set_posting_status(id, status)` if simpler than a full upsert for the close/open/draft toggle — implementor's call; either satisfies the requirement.
- **Admin UI (`mingla-admin`):** the new Careers area has TWO tabs/sections (mirror the existing admin list+detail conventions the spec already cites):
  1. **Applications** — exactly as specified in the spec body (list filter by role + status, detail with signed CV download + portfolio + status update).
  2. **Roles** — list ALL postings with status badges + a "New role" button. Create/edit form with every editable field above, including a plain **markdown textarea** for `body` (no rich editor needed in v1; the public JD page already renders markdown per the spec). Status control = draft | open | closed. `sort_order` numeric input. Slug field with a "generate from title" helper; validate uniqueness on save (surface the RPC conflict error). Closing a role sets `status='closed'` (public page then 404s it per the design's not-found state) — postings are never hard-deleted in v1.
- **Seed still happens** (Migration B seeds the two roles from the JD YAML) so the site is populated on day one; admin CRUD is for ongoing management + new roles.
- **Regression guard delta:** keep the 5 planned gates AND add/extend one so the admin posting-write RPCs stay `is_admin_user()`-gated (assert no un-gated `job_postings` write path / no broad authenticated RLS write policy). Same fails-on-revert proof requirement.

### D-2 — CTA color: use `--coral-600` (#E85D1F) as the solid-button base everywhere (was `--coral-500`)

All solid coral CTA buttons (Apply, Submit application, ghost-button borders may stay coral-500) use `--coral-600` as the resting base for a clean WCAG-AA pass; hover goes one step deeper (define `--coral-700 ≈ #D2520F` or reuse a darken). Update the DESIGN contract references accordingly — buttons resting = coral-600, not coral-500. Non-button coral accents (chips, links, dot, arrow) are unchanged.

### D-3 — Card grid: 2-per-row on desktop (confirms the design default)

The role-card grid stays `repeat(2, 1fr)` on desktop/tablet, `1fr` mobile, exactly as the DESIGN contract §2.2 specifies. No change — decision confirmed, not altered.

### Deploy-time items Seth owns (NOT build blockers — surfaced for CLOSE/deploy)
- Add `career.usemingla.com` to the existing `mingla-marketing` Vercel project; create the prescribed DNS record (CNAME `career` → `cname.vercel-dns.com`).
- Add `NEXT_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co` to the marketing Vercel env (production + preview) so the careers pages can read `job_postings`.
