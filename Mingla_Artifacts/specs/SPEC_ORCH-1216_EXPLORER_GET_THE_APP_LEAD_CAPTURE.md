# SPEC — ORCH-1216 [Explorer "Get the app" → lead-capture form gated to TestFlight]

**Type:** GREENFIELD feature (no bug). Near-exact MIRROR of the shipped ORCH-1045 organiser lead-capture, re-pointed to the consumer/EXPLORER surface, with a TestFlight hard-gate added.
**Surface class:** UI ORCH (Marketing Web **explorer** + Backend). NO admin tab in this ORCH (see NG-6).
**Worktree:** `~/Desktop/mingla-orchs/1216-explorer-app-lead-capture/` on branch `1216-explorer-app-lead-capture` (off clean origin/main).
**Author:** mingla-forensics (SPEC mode), 2026-06-22.
**Pairs with (the binding templates this clones):** `SPEC_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md` + `DESIGN_ORCH-1045_GET_BETA_ACCESS.md` + the shipped `beta-access-modal.tsx` / `beta-access-submit.ts` / `beta-access-lead-submit/index.ts` / `20260817000000_orch_1045_beta_access_leads.sql`.
**Next phase:** `mingla-designer` (the ONE new state — the platform-branched success panel — plus the explorer CTA visual) → IMPLEMENT → tester (web + edge).

---

## 0. What this is (layman summary)

On the **explorer (consumer)** half of the marketing site (`usemingla.com/`), the nav **"Get the app"** button does nothing today (intentionally dead — ORCH-1045 NG-1). We're wiring it to open a lead-capture popup that is a near-clone of the organiser "Get Beta Access" modal. A consumer picks what they're most excited for, types name + email + city, ticks an email-consent box, and submits. On a **successful** submit we save the lead, email seth@usemingla.com, and **only then** reveal the iOS TestFlight link — but only to iPhone/iPad users. Android (and any non-iOS) users get a "Mingla is iOS-only for beta right now, we'll tell you when Android drops" message and NO TestFlight link. We still record the Android lead so demand is measurable. The organiser side keeps its existing `BetaAccessModal` untouched.

---

## 1. The three Seth-locked decisions (verbatim, do not deviate)

1. **Hard-gate.** TestFlight URL `https://testflight.apple.com/join/1gvHNqkQ` (verified live HTTP 200 on 2026-06-22) is revealed ONLY after a SUCCESSFUL submit. If submit fails (validation / network / server / rate-limit), NO link is shown — surface the error + allow retry (mirror 1045's error states). NO fail-open.
2. **Fields:** Name, Email (the lead key / idempotency), City, an Interest single-select chip ("What are you most excited for?"), and a required email-consent checkbox. 2-step shape (see §4.2 for the step-count justification).
3. **Platform branch on SUCCESS:**
   - **iOS** (iPhone/iPad UA) → success panel shows the "Open in TestFlight" button → the URL above.
   - **Android / any non-iOS** → success panel shows NO TestFlight link; instead Seth's words: *"We detect you're on Android — Mingla is only available for beta testing on iOS right now. We'll let you know the moment Android drops."* Still capture the lead (record platform).
   - Detect platform client-side (`navigator.userAgent` / `navigator.platform`), robust to iPad-on-desktop-UA. Persist the detected platform on the lead.

---

## 2. Affected Surfaces / NOT-in-scope

**Affected Surfaces:** Marketing Web (`mingla-marketing/`) **explorer surface only** (nav CTA branch + new modal + transport) + Backend (`supabase/` — new table + RLS + admin RPC + new public edge fn + Resend notify + config.toml + strict-grep allowlist).

**Surfaces NOT in scope:** consumer app (`app-mobile/` iOS+Android), business app (`mingla-business/` iOS+Android), buyer/anon business web, marketing **organiser** surface (keeps `BetaAccessModal` verbatim), and `mingla-admin` (NO admin tab this ORCH — NG-6). No `eas update` / native build anywhere (COMMS-0052 business OTA block; not a native change regardless).

---

## 3. Layer-by-layer change contract

> Tags: **🔒 LOCKED** = hit exactly. **🎨 OPEN** = implementor/designer craft.

### 3.1 Marketing Web — explorer nav CTA wiring (component layer)

**File:** `mingla-marketing/components/marketing/glass-nav.tsx`

**Current (verified 2026-06-22):** `surface` is computed at L13 (`pathname.startsWith('/organisers') ? 'organiser' : 'explorer'`). The **organiser** branch (L92–108) already opens `BetaAccessModal`. The **explorer** branch (L113–124) renders `<Button variant="glass" size="sm">Get the app</Button>` whose only `onClick` fires the `captureMarketing('marketing_cta_clicked', { cta_id: 'get_the_app', location: 'nav' })` analytics tap and otherwise does nothing (NG-1). The modal mount block (L130–136) mounts `BetaAccessModal` for the **organiser** branch only. The explorer hero (`components/sections/explorer-home/hero.tsx`) carries NO app-download CTA of its own — the nav "Get the app" button is the ONLY explorer entry point, so this is the sole wiring site. **VERIFIED.**

**Change (🔒 LOCKED):**
- Add explorer-local state: `const [appOpen, setAppOpen] = useState(false)` (alongside the existing `betaOpen`).
- In the **explorer** CTA branch, keep the button shape verbatim (`variant="glass" size="sm"`, label **"Get the app"** — UNCHANGED copy), but:
  - keep the existing `captureMarketing(... cta_id:'get_the_app', location:'nav')` tap (it already fires — preserve it),
  - add `setAppOpen(true)` after the capture,
  - add `aria-haspopup="dialog"` + `aria-expanded={appOpen}`.
- Mount the new modal for the **explorer** branch only (mirror the organiser mount block at L130–136):
  ```tsx
  {surface === 'explorer' ? (
    <GetTheAppModal
      open={appOpen}
      onClose={() => setAppOpen(false)}
      source="explorer_marketing_nav"
    />
  ) : null}
  ```
- The **organiser** branch + its `BetaAccessModal` mount are UNTOUCHED (I-PROPOSED-1216-EXPLORER-ONLY-CTA: organiser keeps `BetaAccessModal`; explorer mounts `GetTheAppModal`; neither mounts the other's modal).
- Do NOT alter the frosted band, logo, SurfaceToggle, or header markup (ORCH-1010 lane — HG-3).

**🎨 OPEN:** none beyond the above; this is a one-slot wire-up.

### 3.2 New form component — `GetTheAppModal` (clone of `BetaAccessModal`)

**File (new):** `mingla-marketing/components/marketing/get-the-app-modal.tsx`

This is a near-exact clone of the shipped `mingla-marketing/components/marketing/beta-access-modal.tsx`. The implementor SHOULD copy that file and adapt — do NOT re-derive the accessibility scaffolding from scratch. **Every** behavior below is LOCKED by carry-over from `beta-access-modal.tsx`:

**Carry-over (🔒 — identical mechanics, mirror the 1045 file line-for-line):**
- `'use client'`; Framer `AnimatePresence` backdrop + spring panel; `role="dialog" aria-modal="true" aria-labelledby={headingId}`.
- ESC closes; backdrop click closes (ignored while `status==='submitting'`); body scroll-lock while open; close "X" `aria-label="Close"`.
- Focus management: move focus to the first focusable of the current step (or `[data-success-heading]` on success); focus trap (Tab/Shift+Tab cycle); the `FOCUSABLE` selector + the trap effect are copied verbatim.
- **Reset-on-open** (false→true resets `step`, all field values, `status='idle'`, `touched`, success/error kinds).
- `useMinglaReducedMotion()` → instant show/hide + no spring/slide/auto-advance.
- Abort any in-flight submit on close/unmount via `AbortController`.
- Panel surface, radii, tokens, `data-theme="light"`, `bg-parchment`, `--elev-3`, progress segments, chip/field/error visual language — all reused verbatim from `beta-access-modal.tsx` + `DESIGN_ORCH-1045_GET_BETA_ACCESS.md`. The light/warm marketing theme is the SAME theme.

**Props interface (🔒 LOCKED):**
```ts
export interface GetTheAppModalProps {
  open: boolean;
  onClose: () => void;
  /** Attribution written to explorer_app_leads.source. */
  source: 'explorer_marketing_nav';
}
```
(Single source value — the explorer hero has no CTA, so `'explorer_marketing_nav'` is the only call site. Keep it a union of one for forward-compat + parity with the 1045 prop shape.)

**Status state machine (🔒 LOCKED):**
```ts
type Status = 'idle' | 'submitting' | 'success' | 'error';
type ErrorKind = 'validation' | 'rate_limited' | 'server' | 'network';
```
(NOTE: unlike 1045 there is NO `already_on_list` *heading* fork in the success copy — see §3.2.4. The transport still returns `created | already_on_list`; both map to the SAME success panel. The success panel branches on **platform** (iOS vs non-iOS), NOT on created/already.)

#### 3.2.1 Platform detection (🔒 LOCKED — the one genuinely-new logic)

A pure, unit-testable helper, defined in the modal file (or a tiny `lib/detect-ios.ts` — 🎨 implementor's call; if extracted, the regression test imports it):

```ts
/** True for iPhone / iPad (incl. iPadOS reporting a desktop "MacIntel" UA). */
export function isIosDevice(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  // Classic iOS UA.
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ Safari masquerades as desktop Mac: platform "MacIntel" +
  // a touch screen (maxTouchPoints > 1) ⇒ it is an iPad, not a Mac.
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true;
  return false;
}
```
- Called once, client-side, at SUBMIT time (not at module load — SSR-safe; `navigator` is read inside the submit handler / a `useEffect`, never at import). Compute `const platform: 'ios' | 'other' = isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) ? 'ios' : 'other'`.
- The DETECTED platform value (`'ios' | 'other'`) is sent to the edge fn in the payload (`platform`) AND drives the success panel branch.
- **Robustness (🔒):** the MacIntel+touch check above handles "iPad-on-desktop-UA". A real desktop Mac (MacIntel, `maxTouchPoints <= 1`) resolves to `'other'` → no TestFlight link (correct: TestFlight install is an iOS-device action). Guard against `navigator` being undefined (default to `'other'`).

#### 3.2.2 Step structure (🔒 LOCKED — 2 steps; justified)

**Justification for 2 steps (vs 1045's 3):** 1045's Step-1 was a *required* brand-type radio gate that fed a CHECK constraint; here the Interest chip is the analogous single-select, but the remaining consumer fields (name, email, city, consent) are few enough to sit comfortably on one screen. Collapsing to 2 steps reduces friction on a consumer (vs organiser) audience while preserving the 1045 progress/Back-Next shape. The Seth prompt explicitly permits 2 steps "if cleaner — your call, justify it." This is the cleaner shape.

- **Step 1 — Interest** (single-select chip group, required). Heading **"What are you most excited for?"**. Auto-advance on pointer-tap (220ms beat, mirror 1045 `selectChip`); keyboard select (Space/Enter) does NOT auto-advance — a visible **Next** stays enabled once a chip is picked. `role="radiogroup"` + `role="radio"`/`aria-checked` per chip. **Next** disabled until a chip is selected.
- **Step 2 — You** (name + email + city + consent). Heading **"Where do we send it?"**. **Submit** ("Get the app") disabled until name non-empty AND email valid AND consent checked AND `status!=='submitting'`.

Progress indicator: 2 segments + "Step N of 2" eyebrow (`aria-live="polite"`), `role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step}` — same component as 1045, count changed 3→2.

#### 3.2.3 Field contracts (🔒 LOCKED)

**Interest chip group (Step 1):** exactly these 5 options, in this order, with these stored enum values (🔒):

| Display label | Stored `interest` value |
|---|---|
| Places | `places` |
| Events | `events` |
| Trips | `trips` |
| Experiences | `experiences` |
| All of it | `all` |

- `role="radiogroup" aria-label="What are you most excited for?"`. Exactly one selected. (Reuse the 1045 chip visual: default / hover / selected-warm-fill / focus-ring.)

**Step 2 fields (all required, trim before submit):**
- `name` — label **"Your name"** — text, `autoCapitalize="words"`, required, 1–80 chars. Error: **"Add your name."**
- `email` — label **"Email"** — `type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}`, required, regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤254 chars, trim + lowercase before submit. Error: **"That email doesn't look right."** This is the lead key (idempotency).
- `city` — label **"City"** — text, `autoCapitalize="words"`, required, 1–80 chars. Error: **"Add your city."**
- `consent` — required checkbox. Copy (🔒): **"I'm OK with Mingla emailing me about the app and when my city goes live."** A native `<input type="checkbox">` styled per the 1045 consent control. Submit disabled until checked.

(The 5-chip enum + the 4 fields are the consumer analog of the 1045 organiser form. NO `brand_type`, NO `brand_name`, NO `contact_name` here.)

#### 3.2.4 Success panel — platform branch (🔒 LOCKED — the new state)

On `status==='success'`, the form body swaps to a success panel (reuse the 1045 `SuccessPanel` swap motion: form fades out, success fades+rises, a `Check` disc bloom). The panel branches on the detected `platform`:

- **iOS branch** (`platform==='ios'`):
  - Heading (🔒): **"You're in. Grab the app."**
  - Body (🔒): **"Mingla is in TestFlight while we polish it. Tap below to install it and start finding things to do."**
  - Primary action (🔒): a button **"Open in TestFlight"** that is an `<a href="https://testflight.apple.com/join/1gvHNqkQ" target="_blank" rel="noopener noreferrer">` styled as the primary `<Button>` (use `asChild`/`as` if the Button supports it; otherwise a styled anchor). **The hard-coded URL `https://testflight.apple.com/join/1gvHNqkQ` appears in this branch ONLY (I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT).**
  - Secondary: a **"Done"** button → `onClose()`.
- **Android / non-iOS branch** (`platform==='other'`):
  - Heading (🔒): **"You're on the list."**
  - Body (🔒, Seth's exact words): **"We detect you're on Android — Mingla is only available for beta testing on iOS right now. We'll let you know the moment Android drops."**
  - NO TestFlight link, NO "Open in TestFlight" button anywhere in this branch.
  - Single action: **"Done"** → `onClose()`.
- Both branches: focus moves to the success heading (`tabIndex={-1}`, `aria-live="polite"`); progress eyebrow + segments are hidden.
- **Idempotent (`already_on_list`) does NOT change the success copy** — a returning email still sees the platform-appropriate panel (iOS still gets the link; that is correct — they may be re-installing). The edge fn just sends no second notification email.

#### 3.2.5 Error states (🔒 LOCKED — mirror 1045 §6.8/§6.9)

Form stays mounted with entered data preserved (no false success, no data loss). A non-blocking error banner (reuse the 1045 `AlertCircle` strip + tokens) above the footer, copy by `ErrorKind`:
- `network` (offline / fetch threw / abort): **"That didn't go through — check your connection and try again."**
- `server` (5xx / 405 / unexpected shape): **"Something broke on our end. Give it another go in a moment."**
- `rate_limited` (429): **"Whoa — slow down a sec. Try again in a few minutes."**
- `validation` (400, should not happen client-side): **"Hmm, something in the form needs a fix."** + re-run client validation.
- Submit returns to idle (label **"Get the app"**, enabled if still valid) so they can retry.
- Offline pre-check: if `navigator.onLine === false` at submit, short-circuit to the `network` banner without firing a request (mirror 1045 handleSubmit).

#### 3.2.6 Submit button label states (🔒):
- idle/ready: **"Get the app"**
- submitting: Button `loading` → spinner + **"Getting it…"**

### 3.3 Client submit transport (service layer, new)

**File (new):** `mingla-marketing/lib/explorer-app-submit.ts` (clone of `lib/beta-access-submit.ts`).

**Contract (🔒 LOCKED):**
```ts
export interface ExplorerAppLeadInput {
  name: string;        // trimmed
  email: string;       // trimmed + lowercased (lead key)
  city: string;        // trimmed
  interest: string;    // one of the 5 stored values
  consent: true;       // must be true; UI guarantees it
  platform: 'ios' | 'other';   // client-detected (§3.2.1)
  source: 'explorer_marketing_nav';
}
export type ExplorerAppSubmitResult =
  | { ok: true; status: 'created' | 'already_on_list' }
  | { ok: false; error: 'validation' | 'rate_limited' | 'server' | 'network' };

export async function submitExplorerAppLead(
  input: ExplorerAppLeadInput,
  signal?: AbortSignal,
): Promise<ExplorerAppSubmitResult>;
```
- POSTs JSON to `${NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL}/explorer-app-lead-submit` with headers `Content-Type: application/json`, `Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}`, `apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}` (mirror `beta-access-submit.ts` verbatim — same raw `fetch`, same anon-key-only client posture, same missing-env guard returning `network`).
  - **Supabase Edge Functions invoke contract (COMMS-0003, docs cited):** `POST https://<project-ref>.functions.supabase.co/<fn>` with `Authorization: Bearer <token>` + `apikey`; `verify_jwt=false` accepts the request without a user JWT. Docs: https://supabase.com/docs/guides/functions/auth and https://supabase.com/docs/reference/javascript/functions-invoke .
- HTTP→result mapping (🔒): 200 valid-shape → `{ok:true,status}`; 200 bad-shape → `server`; 400 → `validation`; 429 → `rate_limited`; 405/5xx/other → `server`; thrown/abort/offline → `network`.
- **Env vars (🔒):** REUSE the EXISTING `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already present in `mingla-marketing/.env.example`, lines 12+15, from ORCH-1045). **No new env vars.** (The anon key is public by design; RLS denies anon SELECT + the edge fn re-validates + writes via service role — I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT.)
- **Analytics (🔒):** on a successful POST, fire `captureMarketing('get_the_app_submitted', { surface_role: 'explorer', source: input.source, status: body.status, platform: input.platform })` (consent-gated no-op via the existing provider; never throws — mirror the `beta_access_submitted` call in `beta-access-submit.ts`). The nav tap already fires `marketing_cta_clicked { cta_id:'get_the_app', location:'nav' }` (preserve it, §3.1).

### 3.4 Edge function — `explorer-app-lead-submit` (new)

**File (new):** `supabase/functions/explorer-app-lead-submit/index.ts` (clone of `beta-access-lead-submit/index.ts`).
**Tests (new):** `supabase/functions/explorer-app-lead-submit/__tests__/submit_happy.test.ts` + `.../submit_adversarial.test.ts`.
**config.toml (🔒):** add `[functions.explorer-app-lead-submit]` / `verify_jwt = false` (mirror the existing `beta-access-lead-submit` block at config.toml:104–105).

**HTTP contract (🔒 LOCKED):**
```
POST /explorer-app-lead-submit
Request JSON:
  {
    name: string,      // required, 1..80 after trim
    email: string,     // required, email regex, 3..254 after trim+lowercase
    city: string,      // required, 1..80 after trim
    interest: string,  // required, ∈ {places,events,trips,experiences,all}
    consent: boolean,  // required, MUST be true
    platform: string,  // required, ∈ {ios,other}
    source: string     // required, MUST be 'explorer_marketing_nav'
  }
→ 200 { ok:true, status:'created' | 'already_on_list' }
→ 400 { ok:false, error:'validation', fields?:string[] }
→ 405 { ok:false, error:'method_not_allowed' }
→ 429 { ok:false, error:'rate_limited' }
→ 500 { ok:false, error:'server' }
OPTIONS → 200 "ok" + CORS
```
- **CORS (🔒):** import the SHARED `../_shared/cors.ts` `corsHeaders` (mirror `beta-access-lead-submit/index.ts:36` — it already includes `x-client-info` per ORCH-1205; honors the strict-grep ORCH-1205 gate).
- **Validation (🔒):** a pure exported `validateLead(raw)` re-validating EVERY field server-side (clone the 1045 validator shape). Allow-sets: `INTERESTS = {places,events,trips,experiences,all}`; `PLATFORMS = {ios,other}`; `SOURCES = {explorer_marketing_nav}`. `consent === true` else 400. Email regex + length 3..254, lowercased. Trim + length-bound name (1..80) + city (1..80). Malformed JSON → 400 `validation`.
- **Supabase client (🔒):** service-role client (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false, autoRefreshToken:false}})`) — the ONLY writer (anon RLS denies INSERT; service role bypasses RLS). Service key NEVER leaves the edge runtime.
- **Throttle (🔒, mirror 1045 §3.3.5):** salted-IP-hash soft throttle — `BETA_LEAD_IP_SALT` env (REUSE the existing 1045 salt secret; do not add a new one), hash the first `x-forwarded-for` hop (raw IP NEVER stored), count rows in the last 10 min with the same `ip_hash`; `>=5` → 429. Fail-open on a throttle read error.
- **Insert (🔒):** INSERT into `public.explorer_app_leads` (columns §3.5), persisting `name, email, city, interest, consent, platform, source, user_agent` (≤512 trunc), `referer` (≤512 trunc), `ip_hash`. On unique-violation of the `lower(email)` index → return 200 `{ok:true,status:'already_on_list'}` (NO 500, NO second notify email). Else `created`.
- **Email notify (🔒):** on `created` only, best-effort POST to Resend (`POST https://api.resend.com/emails`, docs: https://resend.com/docs/api-reference/emails/send-email ) to `["seth@usemingla.com"]`, `from` a `usemingla.com` local-part (REUSE `RESEND_BETA_FROM ?? RESEND_MARKETING_FROM ?? "Mingla <hello@usemingla.com>"` — 🎨 on the exact local-part, 🔒 on the `usemingla.com` domain). Subject e.g. `New app lead — {name} ({interest}, {platform})`. HTML/text render ONLY captured fields (Constitution #9). **Email-send failure is logged + NON-FATAL** — the lead is already persisted; still return 200 `created`. (NO welcome/lead-facing email in this ORCH — the 1045 `buildWelcomeEmail` was a separate ORCH-1056 add for organisers; do NOT clone it here. The consumer "welcome" is the in-modal success panel + the TestFlight link. NG-7.)
- **Captured fields (🔒):** persist `user_agent` + `referer` (truncated ≤512) + `ip_hash` (salted) — same as 1045 — PLUS the new `platform` column (so Android demand is measurable, per Seth decision 3).

### 3.5 Database — migration + RLS + admin RPC

**Migration file (🔒):** `supabase/migrations/20261124000000_orch_1216_explorer_app_leads.sql`
- **Version rationale (collision-checked 2026-06-22):** the highest applied prefix on origin/main is `20261123000000`. Across ALL active worktrees in `~/Desktop/mingla-orchs/*/supabase/migrations/`, the highest claimed prefix is also `20261123000000` (no worktree claims higher). `20261124000000` is strictly greater than every claimed prefix → no collision. **If the implementor picks this up later, RE-SCAN `git ls-tree origin/main supabase/migrations/` + all sibling worktrees and bump to the next free prefix if `20261124000000` was taken in the interim (HG-2).**

**Table DDL (🔒 LOCKED):**
```sql
create table if not exists public.explorer_app_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null check (char_length(name) between 1 and 80),
  email         text not null check (char_length(email) between 3 and 254),
  city          text not null check (char_length(city) between 1 and 80),
  interest      text not null
                  check (interest in ('places','events','trips','experiences','all')),
  platform      text not null default 'other'
                  check (platform in ('ios','other')),
  consent       boolean not null default false,
  source        text not null default 'explorer_marketing'
                  check (source in ('explorer_marketing','explorer_marketing_nav')),
  user_agent    text,                              -- truncated <=512 at write
  referer       text,                              -- truncated <=512 at write
  ip_hash       text                               -- salted hash, never raw IP
);

comment on table public.explorer_app_leads is
  'ORCH-1216: explorer marketing "Get the app" leads. Written only by the '
  'service-role explorer-app-lead-submit edge fn. anon SELECT is DENIED by RLS '
  '(no policy = deny). Admin reads via admin_explorer_app_leads_list() RPC. '
  'platform records the client-detected device (ios|other) so Android demand is '
  'measurable. Do NOT add an anon SELECT policy (I-PROPOSED-1216-... anon-no-select).';

-- Case-insensitive idempotency on email (one lead per email) — structural
-- guarantee of email-once even if the edge-fn check is bypassed.
create unique index if not exists explorer_app_leads_email_lower_uidx
  on public.explorer_app_leads (lower(email));

create index if not exists explorer_app_leads_created_at_idx
  on public.explorer_app_leads (created_at desc);
create index if not exists explorer_app_leads_ip_hash_recent_idx
  on public.explorer_app_leads (ip_hash, created_at desc);
```
> `source` CHECK includes the column default `'explorer_marketing'` AND the specific `'explorer_marketing_nav'` (the edge fn always writes the specific value).

**RLS (🔒 LOCKED):** enable RLS, create NO anon/authenticated INSERT/SELECT/UPDATE/DELETE policies (deny-by-default; service role bypasses RLS for the edge-fn insert). Docs: https://supabase.com/docs/guides/database/postgres/row-level-security (no policy = deny) + https://supabase.com/docs/guides/api/api-keys (service_role bypasses RLS). Both cited (COMMS-0003).

**Admin list RPC (🔒 — mirror `admin_beta_leads_list()` from the 1045 migration):**
```sql
create or replace function public.admin_explorer_app_leads_list()
  returns table(
    id uuid, created_at timestamptz, name text, email text, city text,
    interest text, platform text, source text, user_agent text, referer text
  )
  language sql stable security definer set search_path to 'public'
as $$
  select bal.id, bal.created_at, bal.name, bal.email, bal.city, bal.interest,
         bal.platform, bal.source, bal.user_agent, bal.referer
  from public.explorer_app_leads bal
  order by bal.created_at desc;
$$;
revoke all on function public.admin_explorer_app_leads_list() from public;
revoke all on function public.admin_explorer_app_leads_list() from anon;
grant execute on function public.admin_explorer_app_leads_list() to authenticated;
```
(The RPC exists so a future admin tab — out of scope this ORCH, NG-6 — has the canonical read path. No admin UI is built here.)

**Apply protocol (🔒 HG-6):** do NOT blind `supabase db push` (migration-history drift). Operator applies via the surgical Management-API path + INSERTs the version into `schema_migrations`. The SPEC flags it; operator owns the apply.

### 3.6 Strict-grep allowlist (CI gate, COMMS-0002 / C7 no-new-backend-files)

**File:** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

**Change (🔒 — same commit as the backend files):** add a new allowlist const + spread it into `ALLOWLIST` (mirror the existing `ORCH_*_BACKEND_ALLOWLIST` blocks):
```js
const ORCH_1216_BACKEND_ALLOWLIST = [
  "supabase/migrations/20261124000000_orch_1216_explorer_app_leads.sql",
  "supabase/functions/explorer-app-lead-submit/index.ts",
  "supabase/functions/explorer-app-lead-submit/__tests__/submit_happy.test.ts",
  "supabase/functions/explorer-app-lead-submit/__tests__/submit_adversarial.test.ts",
];
```
Spread `...ORCH_1216_BACKEND_ALLOWLIST,` into the `ALLOWLIST` array. The `mingla-marketing/**` files are NOT under `supabase/` so they do NOT trip C7 (no allowlisting needed for them). Run `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs --self-test` before push.

---

## 4. Implementation order (🔒)

1. **Migration** `20261124000000_orch_1216_explorer_app_leads.sql` (table + indexes + RLS + admin RPC). Operator applies surgically (HG-6).
2. **Strict-grep allowlist** edit (§3.6) — SAME commit as migration + edge fn.
3. **Edge function** `explorer-app-lead-submit` + `config.toml` entry + Deno tests (happy + adversarial).
4. **Client transport** `lib/explorer-app-submit.ts`.
5. **Modal** `components/marketing/get-the-app-modal.tsx` (clone `beta-access-modal.tsx`; 2 steps; platform-branched success).
6. **Nav wire-up** `glass-nav.tsx` explorer branch (§3.1).
7. Designer's platform-branched success-panel + explorer CTA visual (§5) — produced BEFORE step 5/6 final polish.

---

## 5. Designer handoff (the deltas vs DESIGN_ORCH-1045)

`DESIGN_ORCH-1045_GET_BETA_ACCESS.md` already locks the modal surface, chips, fields, inputs, progress, consent, motion, and all error/idle/submitting states — REUSE them verbatim (same warm light theme). The designer only needs to pin the NEW pieces:
- The **platform-branched success panel** (iOS: heading + body + "Open in TestFlight" primary anchor-button + "Done"; Android/non-iOS: heading + Seth's exact message + "Done", NO link) — both states, Mingla voice, the success check-bloom reused, the TestFlight button styled as the primary `<Button>`.
- The **2-segment** progress treatment (vs 1045's 3) — trivial count change.
- Confirm the explorer nav "Get the app" pill is visually unchanged (same `variant="glass" size="sm"` — only the handler + a11y attrs change).
**Designer output:** append a short `DESIGN_ORCH-1216_GET_THE_APP.md` (or a delta section) referenced by IMPLEMENT. No re-derivation of the shared modal visuals.

---

## 6. Cross-Surface Impact

| # | Surface | Covered? | Notes |
|---|---|---|---|
| 1 | Consumer iOS/Android (`app-mobile/`) | NO | The TestFlight install IS the consumer app — but this feature is a marketing-web lead form, not an in-app change. |
| 2 | Business iOS/Android (`mingla-business/`) | NO | Unrelated. NO `eas update` (COMMS-0052). |
| 3 | Buyer/anon business web | NO | Not exposed. |
| 4 | Admin Web (`mingla-admin/`) | NO | No admin tab this ORCH (NG-6); the `admin_explorer_app_leads_list()` RPC is seeded for a future tab. |
| 5 | Marketing Web **organiser** | NO | UNCHANGED — keeps `BetaAccessModal` (I-PROPOSED-1216-EXPLORER-ONLY-CTA). |
| 6 | Marketing Web **explorer** | **YES** | nav CTA branch + `GetTheAppModal` + transport. SC-1..SC-6. |
| — | Backend (`supabase/`) | **YES** | new table + RLS + admin RPC + edge fn + Resend notify + config.toml + allowlist. SC-7..SC-9. |

---

## 7. Success Criteria

- **SC-1 (explorer nav):** On `/` (explorer) the nav CTA reads **"Get the app"** and clicking it opens the 2-step `GetTheAppModal`. On `/organisers*` the nav still opens the organiser `BetaAccessModal` (UNCHANGED). [component]
- **SC-2 (form flow):** Step 1 (pick an Interest chip) → Step 2 (name + email + city + consent) with Back/Next, "Step N of 2", inline validation blocking Next/Submit until valid. [component]
- **SC-3 (iOS happy submit):** On an iPhone/iPad UA, a valid submit shows `submitting` then the **iOS** success panel WITH the "Open in TestFlight" button pointing at `https://testflight.apple.com/join/1gvHNqkQ`; a row exists in `explorer_app_leads` (email lowercased, `platform='ios'`, `source='explorer_marketing_nav'`); seth@usemingla.com gets ONE notify email. [full stack]
- **SC-4 (Android/non-iOS submit):** On an Android (or desktop non-touch) UA, a valid submit shows the **Android** success panel with Seth's exact message and NO TestFlight link anywhere; a row exists with `platform='other'`. [full stack]
- **SC-5 (hard-gate / no fail-open):** A network/server/429/validation failure on submit shows the matching error banner, NO success panel, NO TestFlight link, modal stays open with data preserved + retry. [component + transport]
- **SC-6 (consent + email gating):** Submit disabled until name non-empty AND email valid AND consent checked. [component]
- **SC-7 (DB/RLS — anon SELECT denied):** anon-key `select * from explorer_app_leads` → 0 rows / permission denied; the service-role edge fn inserts. [DB+RLS]
- **SC-8 (idempotency):** same email twice → exactly ONE row, exactly ONE notify email; 2nd returns `already_on_list` and the user STILL sees a (platform-appropriate) success panel. [edge+DB]
- **SC-9 (CI gate green):** ORCH-0863 C7 passes with the 4 allowlisted backend files; `--self-test` passes. [CI]

---

## 8. Invariants (DRAFT — mirror the 1045 I-* family; ACTIVE on CLOSE)

> Each is a strict-grep `.mjs` gate under `.github/scripts/strict-grep/`, self-tested (fail-on-revert), wired as one job block in `strict-grep-mingla-business.yml` (the workflow already watches `mingla-marketing/**` + `supabase/functions/**` — verified). Names below are the DRAFT (`I-PROPOSED-1216-*`); rename to `I-1216-*` on CLOSE.

- **I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT** — gate file `.github/scripts/strict-grep/i-proposed-1216-testflight-behind-submit.mjs`. Asserts the literal `testflight.apple.com/join/1gvHNqkQ` appears in `get-the-app-modal.tsx` ONLY inside the success/iOS branch (the success-panel render path), and NOWHERE in the idle/step/error render paths, the transport, or the nav. Implementation: locate the URL occurrence(s); require each to sit within the `SuccessPanel`/success-render region AND within an `isIos`/`platform==='ios'` guard; FAIL if the URL appears outside the success-iOS region or appears in `glass-nav.tsx` / `explorer-app-submit.ts`. Self-test: a fixture with the URL in the step-1 body → fires; URL only in the iOS success branch → passes.
- **I-PROPOSED-1216-ANDROID-NO-TESTFLIGHT-LINK** — gate file `.github/scripts/strict-grep/i-proposed-1216-android-no-testflight-link.mjs`. Asserts the non-iOS (`platform==='other'`) success branch contains NO `testflight.apple.com` token and NO `Open in TestFlight` label. Self-test: a fixture leaking the URL into the `other` branch → fires; the compliant Seth-message-only branch → passes. (May be folded into the same `.mjs` as the previous gate with two assertions; keep two distinct named invariants in the doc + two self-test cases.)
- **I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT** — gate file `.github/scripts/strict-grep/i-proposed-1216-no-service-key-client.mjs`. Asserts no `SUPABASE_SERVICE_ROLE_KEY` / `service_role` / `sb_secret` / `rk_*` token anywhere under `mingla-marketing/` (the explorer transport uses the anon key only). Self-test: a fixture with a service-role read in a marketing file → fires; anon-only → passes. (Mirror I-1045-NO-SERVICE-KEY-CLIENT.)
- **I-PROPOSED-1216-EXPLORER-ONLY-CTA** — gate file `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs`. Asserts `glass-nav.tsx` mounts `GetTheAppModal` ONLY in the `surface==='explorer'` branch and `BetaAccessModal` ONLY in the `surface==='organiser'` branch (neither modal crosses surfaces); and that `get-the-app-modal.tsx` does NOT import/mount `BetaAccessModal` and vice-versa. Self-test: a fixture mounting `GetTheAppModal` in the organiser branch → fires; the compliant split → passes.

(Existing invariants preserved: ORCH-1010 hero/nav lane — untouched markup, HG-3; ORCH-1205 CORS x-client-info — the edge fn imports `_shared/cors.ts`; I-1045-* organiser invariants — `BetaAccessModal`/`beta_access_leads` untouched; Constitution #3 no-silent-failure — email-notify non-fatal+logged, submit failure surfaces visibly; Constitution #9 no-fabricated-data — notify renders only captured fields.)

---

## 9. Hard Guards

- **HG-1 (anon security / hard-gate):** marketing site is unauthenticated; edge fn re-validates ALL fields, service key stays server-side, RLS denies anon SELECT, salted-IP-hash throttle + email idempotency guard abuse, and the TestFlight link is revealed ONLY in the success-iOS path (no fail-open: any error path shows no link — SC-5).
- **HG-2 (migration collision):** `20261124000000` is strictly greater than the highest claimed prefix (`20261123000000`) across origin/main + all worktrees as of 2026-06-22. Re-scan + bump if taken later.
- **HG-3 (ORCH-1010 no-regress):** touch ONLY the explorer nav `<Button>` handler/a11y + the explorer modal mount. No layout/grid/copy changes elsewhere in `glass-nav.tsx`.
- **HG-4 (strict-grep C7, COMMS-0002):** migration + edge fn + its 2 tests MUST be allowlisted in `orch-0863-marketing-hub-phase-b.mjs` in the SAME commit, or the C7 check fails the PR.
- **HG-5 (external-API docs, COMMS-0003):** Resend `POST /emails` (https://resend.com/docs/api-reference/emails/send-email), Supabase edge-fn invoke (https://supabase.com/docs/guides/functions/auth) + RLS deny-by-default + service-role-bypass cited inline (§3.3/§3.4/§3.5).
- **HG-6 (migration apply):** no blind `db push`; surgical Management-API apply + `schema_migrations` insert; operator owns it.
- **HG-7 (NO eas / native):** marketing-web + backend only. NO `eas update`, NO native build (COMMS-0052 + not a native change). Ship path = Vercel `[deploy]` for web + edge-fn deploy from merged main + migration apply.

---

## 10. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01 (iOS happy)** | full submit, iPhone UA | Step1 `events`; Step2 name/email/city + consent; UA=iPhone | 200 `created`; row (`platform='ios'`, email lower, `source='explorer_marketing_nav'`); 1 notify email; **iOS** success panel WITH TestFlight link | full stack |
| **T-02 (Android happy)** | full submit, Android UA | same fields; UA=Android | 200 `created`; row `platform='other'`; **Android** panel with Seth's message + NO link | full stack |
| **T-03 (iPad-on-desktop-UA)** | platform detect | UA=Macintosh, platform=MacIntel, maxTouchPoints=5 | `isIosDevice(...)===true` → iOS panel + link | unit + component |
| **T-04 (real desktop Mac)** | platform detect | MacIntel, maxTouchPoints=0 | `isIosDevice(...)===false` → no link | unit |
| **T-05 (no consent)** | adversarial | direct POST `consent:false` | 400 `validation`; no row; no email | edge |
| **T-06 (bad interest)** | adversarial | direct POST `interest:"hacker"` | 400 `validation`; no row | edge |
| **T-07 (bad platform)** | adversarial | direct POST `platform:"windows"` | 400 `validation`; no row | edge |
| **T-08 (invalid email)** | validation | `email:"nope"` | inline error in UI; direct POST → 400; no row | component + edge |
| **T-09 (anon SELECT denied)** | security | anon-key `select * from explorer_app_leads` | 0 rows / permission denied | DB+RLS |
| **T-10 (idempotent resubmit)** | edge case | same email twice | exactly 1 row; 2nd → 200 `already_on_list`; exactly 1 notify email; success panel both times | edge+DB |
| **T-11 (notify failure non-fatal)** | error path | force Resend 500 (mock) | row STILL inserted; 200 `created`; failure logged; no user error | edge |
| **T-12 (network failure on submit)** | error path | kill network mid-submit | error banner + retry; NO success; NO TestFlight link; data preserved | component + transport |
| **T-13 (organiser unchanged)** | regression | load `/organisers` | nav opens `BetaAccessModal`; `GetTheAppModal` never mounts | component |
| **T-14 (throttle)** | abuse | 6 POSTs same IP <10min | 6th → 429; no row/email for it | edge |
| **T-15 (CI gate)** | CI | run all 4 ORCH-1216 gates `--self-test` + the C7 check | all PASS with the 4 allowlisted files | CI |

---

## 11. Step-0.5 regression-test PAIR (CLOSE-HARD mandate)

Per the Seth-mandated CLOSE-HARD regression-protection rule, every shipped behavior must be guarded by something that ACTUALLY RUNS IN CI (a non-running jest test ≠ protection). The strict-grep `.mjs` gates in §8 are the CI-enforced guards (the marketing jest suite is not a blocking CI job). The implementor+tester produce this PAIR:

1. **Happy-path guard (CI-running):** `i-proposed-1216-testflight-behind-submit.mjs` self-test (the `--self-test` step) PASSES on the shipped `get-the-app-modal.tsx` (the URL sits only in the iOS success branch). Lives in `.github/scripts/strict-grep/`. Wired as a job step in `strict-grep-mingla-business.yml`. PROVES PASS-on-fix.
2. **Adversarial guard (fails-on-revert):** the SAME gate's self-test includes a fixture that LEAKS the TestFlight URL into a step body / error path / the Android branch and asserts the gate FIRES; AND a live-mode run against a hand-reverted `get-the-app-modal.tsx` (URL moved out of the success-iOS guard) FAILS the gate. PROVES FAIL-on-revert. The tester must demonstrate both directions (gate red on the revert, green on the fix) and capture the output.

Additionally, the Deno edge tests (`submit_happy.test.ts` + `submit_adversarial.test.ts`) exercise the exported `validateLead` + handler branches (consent/interest/platform allow-sets, idempotency, throttle) — these run via the Deno test runner and mirror the 1045 edge-test pair.

CI wiring (🔒): add ONE job block per gate in `strict-grep-mingla-business.yml` (model the ORCH-1211 / ORCH-1212 blocks — a `--self-test` step then a live-run step), e.g.:
```yaml
  orch-1216-testflight-behind-submit:
    name: "ORCH-1216: TestFlight link only behind submit success (iOS-only)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: node .github/scripts/strict-grep/i-proposed-1216-testflight-behind-submit.mjs --self-test
      - run: node .github/scripts/strict-grep/i-proposed-1216-testflight-behind-submit.mjs
```
(plus analogous blocks for `i-proposed-1216-android-no-testflight-link`, `i-proposed-1216-no-service-key-client`, `i-proposed-1216-explorer-only-cta` — or fold the two TestFlight assertions into one gate with two job names. Each `.mjs` self-tests fail-on-revert.)

---

## 12. What the implementor does next (handoff)

1. Re-scan migration prefixes (`git ls-tree origin/main supabase/migrations/` + sibling worktrees); confirm `20261124000000` is still free, else bump.
2. Write the migration (§3.5) → operator applies surgically (HG-6).
3. Edit the 0863 allowlist (§3.6) in the SAME commit as the migration + edge fn.
4. Clone `beta-access-lead-submit/` → `explorer-app-lead-submit/` (validator allow-sets → interest/platform/source; add `platform` column write; drop the welcome email; subject line); add the `config.toml` block; write the 2 Deno tests.
5. Clone `lib/beta-access-submit.ts` → `lib/explorer-app-submit.ts` (new payload shape + endpoint + `get_the_app_submitted` analytics).
6. Clone `beta-access-modal.tsx` → `get-the-app-modal.tsx` (5-chip Interest step, 2 steps, name/email/city/consent, `isIosDevice` detect, platform-branched success panel with the hard-coded TestFlight URL in the iOS branch ONLY).
7. Wire the explorer branch of `glass-nav.tsx` (§3.1).
8. Author the 4 strict-grep gates (§8) + their workflow job blocks (§11); prove self-test PASS + fail-on-revert.
9. Get the designer delta (§5) before final UI polish.
10. Hand to tester for SC-1..SC-9 / T-01..T-15 (incl. a real iOS-device + Android-device fire of the platform branch — source-only is capped at "suspected").

---

## 13. Completion check (this SPEC)

- [x] All 3 locked decisions specified: hard-gate (§3.2.4/SC-5/HG-1), fields + interest enum (§3.2.3), platform branch + detection (§3.2.1/§3.2.4).
- [x] Full DB schema + RLS + admin RPC (§3.5); migration prefix chosen + collision-checked (`20261124000000`, HG-2).
- [x] Edge-fn HTTP contract + status codes (§3.4), mirroring 1045.
- [x] Field set + validation + interest enum values (`places/events/trips/experiences/all`) + platform enum (`ios/other`) (§3.2.3/§3.4).
- [x] Modal step structure (2 steps, justified §3.2.2) + every state (idle/submitting/success-iOS/success-Android/error-kinds) (§3.2.4/§3.2.5/§3.2.6).
- [x] Platform-detection rule (iPad-on-desktop-UA robust) (§3.2.1).
- [x] All copy strings (success iOS, success Android in Seth's exact words, errors, consent, headings, chips) (§3.2.3–§3.2.6).
- [x] Analytics events (`marketing_cta_clicked` tap preserved + `get_the_app_submitted` conversion) (§3.1/§3.3).
- [x] DRAFT invariants + gate file paths (§8); regression-test PAIR + CI wiring (§11).
- [x] Affected Surfaces + Surfaces-NOT-in-scope (§2); Cross-Surface Impact (§6); ≥2 acceptance cases incl. adversarial (§10).
- [x] 🔒 LOCKED / 🎨 OPEN tags throughout; designer delta handoff (§5).
