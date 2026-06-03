# SPEC — ORCH-1045 [Business marketing "Get Beta Access" lead-capture form]

**Type:** GREENFIELD feature (no bug; current state mapped + verified)
**Surface class:** UI ORCH (Marketing Web organiser + Admin Web + Backend)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1045-[business-beta-access-form]/` on branch `ORCH-1045-business-beta-access-form`
**Author:** mingla-forensics (SPEC mode), 2026-06-02
**Next phase:** `mingla-designer` (3-step popup + nav/hero CTA visual contract) → IMPLEMENT → tester (web)

---

## 0. Comms Ledger acks (handled this turn)

- **COMMS-0002** (WARN, ALL) — ORCH-0863 strict-grep `no-new-backend-files` (C7) blocks any PR adding files under `supabase/functions/` or `supabase/migrations/`. ORCH-1045 adds BOTH a new edge function and a new migration → this SPEC mandates the allowlist edit in §4.4 (must land in the SAME commit). Factored.
- **COMMS-0003** (WARN, ALL) — every external-API param/endpoint/payload introduced must cite the provider's canonical docs URL inline at SPEC time. ORCH-1045 introduces a Resend send call → docs cited inline in §3.3. Factored.

(Neither is BLOCK; both are WARN and apply. No new COMMS entry needed — ORCH-1045 introduces no cross-ORCH discovery beyond the migration-collision finding, which is handled in §4.3 by version selection, not a shared-resource conflict.)

---

## 1. Layman summary

Today the Mingla Business marketing site (`/organisers`) has two call-to-action buttons that don't capture anyone: the nav "Get the app" button (a dead button with no handler) and a hero "See how Mingla works" video tile. We're turning both into a single **"Get Beta Access"** button that opens a clean 3-step popup. A venue/organiser picks their business type, tells us their name + business + city, then drops their email and ticks a consent box. On submit, the lead is saved to a new database table, we email seth@usemingla.com a notification, and the person sees a "you're on the beta list" confirmation. Seth gets a new **"Beta Leads"** tab in the admin dashboard to see every lead. The consumer side of the marketing site is untouched — it keeps its "Get the app" button exactly as-is.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (what this SPEC covers)

1. **Nav CTA branch** (`mingla-marketing/components/marketing/glass-nav.tsx`): on the **organiser** surface only, replace the dead "Get the app" button (L84) with a "Get Beta Access" button that opens the form. Explorer surface keeps "Get the app" verbatim.
2. **Hero CTA swap** (`mingla-marketing/components/sections/organiser-home/hero.tsx`): replace the `PlayTile` video-launch tile with a "Get Beta Access" primary CTA; fully remove the now-dead `VideoModal` import + `videoOpen` state + `<VideoModal>` usage from this file.
3. **New form component**: a 3-step accessible popup (`BetaAccessModal`) + a small shared modal shell, hosted in `mingla-marketing/`, built with React DOM + Tailwind v4 + Framer Motion (NOT React Native; the `JoinWaitlistSheet` RN component is a *pattern reference only*).
4. **Lead transport**: a thin client submit function in `mingla-marketing/lib/` that POSTs to a new public edge function (anon-safe; no service-role key client-side).
5. **New edge function** `beta-access-lead-submit` (anon-callable, `verify_jwt = false`): validates input, inserts into `beta_access_leads`, fires the Resend notification, returns a typed success/error contract.
6. **New DB migration**: table `beta_access_leads` + RLS (anon INSERT-only via the edge fn's service role; anon SELECT denied) + indexes.
7. **New admin tab "Beta Leads"** (`mingla-admin/`): NAV_GROUPS entry + Sidebar icon + App.jsx route + new `BetaLeadsPage.jsx` listing leads (read via authenticated admin SELECT).
8. **Email notification** to seth@usemingla.com on each new lead (via Resend, from the edge fn).
9. **Strict-grep allowlist** edit (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`) in the same commit as the backend files.

### 2.2 Non-Goals (explicitly NOT in this SPEC)

- **NG-1** Wiring the explorer "Get the app" button to anything. It stays a dead button (operator: out of scope). Do not touch its behavior.
- **NG-2** Restructuring the organiser hero or nav layout. ORCH-1010 [marketing-business-rebrand] is an active parallel worktree owning the surrounding hero/nav copy + design. The "Get Beta Access" CTA drops into the EXISTING layout slots only (the `<Button>` slot in nav, the `motion.div` CTA slot in hero). No layout, grid, spacing-system, or copy changes outside those two slots. See §9 hard guard HG-3.
- **NG-3** A real product video. The video entry point is removed from the hero; `video-modal.tsx` itself is left in the repo untouched (it may be reused elsewhere later). Only the hero's *usage* of it is removed.
- **NG-4** Double opt-in / email verification of the lead's address. The consent checkbox is a marketing-contact consent, not an email-confirmation loop.
- **NG-5** Phone collection in the UI. The DB column `phone` exists (nullable) for future use but the 3-step form does NOT collect phone. (Operator chose the leaner 3-step form; phone is a schema-only forward-compat field.)
- **NG-6** Admin lead editing / status workflow / CSV export. v1 admin tab is read-only list + basic detail. (Register a follow-up ORCH if a pipeline/CRM is wanted.)
- **NG-7** Consumer marketing surface (`/`), consumer app, business mobile app, buyer-anon web. None render this form. See §6 Cross-Surface Impact.
- **NG-8** Rate-limiting infrastructure beyond the lightweight per-request guards in §3.3.5. A durable IP/email throttle table is a follow-up if abuse is observed.

### 2.3 Assumptions (stated, not all independently proven)

- **A-1** The Mingla Business marketing site is the Next.js app at `mingla-marketing/`, served at the apex domain; organiser content lives under the `/organisers/*` path (verified: `lib/subdomain.ts`, `app/organisers/layout.tsx`). **VERIFIED.**
- **A-2** The marketing app currently has **no** Supabase client and **no** `process.env`/`NEXT_PUBLIC_*` usage (verified: grep of `mingla-marketing` found zero `process.env` refs and no `@supabase/supabase-js` dependency). The lead submit therefore uses a **plain `fetch`** to the edge-function URL with two new `NEXT_PUBLIC_*` env vars — NOT a Supabase client. **VERIFIED.**
- **A-3** `usemingla.com` is a verified sending domain at Resend (any local-part works without per-address verification) — confirmed by the comment at `supabase/functions/marketing-send/index.ts:418-419`. The notification `from` therefore uses a `usemingla.com` address. **VERIFIED (in-repo comment; implementor must confirm the env var exists — see §3.3.3).**
- **A-4** `RESEND_API_KEY` is already a configured Supabase edge-function secret (used live by `marketing-send`). **VERIFIED (referenced at `marketing-send/index.ts:94`).**
- **A-5** The admin app reaches Supabase via `mingla-admin/src/lib/supabase.js` (anon key + authenticated admin session; RLS-gated). **VERIFIED.**

---

## 3. Layer-by-layer change contract

> Tags: **🔒 LOCKED** = non-negotiable (hit exactly). **🎨 OPEN** = handed to implementor/designer craft.

### 3.1 Marketing Web — Nav CTA (component layer)

**File:** `mingla-marketing/components/marketing/glass-nav.tsx`

**Current (verified):** L11 computes `const surface: 'explorer' | 'organiser' = pathname.startsWith('/organisers') ? 'organiser' : 'explorer'`. L84 renders, for BOTH surfaces, `<Button variant="glass" size="sm">Get the app</Button>` with no `onClick`.

**Change (🔒 LOCKED):**
- Branch the CTA by `surface`:
  - `surface === 'explorer'` → render the EXISTING dead `<Button variant="glass" size="sm">Get the app</Button>` **verbatim, unchanged** (NG-1).
  - `surface === 'organiser'` → render `<Button variant="glass" size="sm" onClick={() => setBetaOpen(true)}>Get Beta Access</Button>`.
- The component gains local state `const [betaOpen, setBetaOpen] = useState(false)` and renders `<BetaAccessModal open={betaOpen} onClose={() => setBetaOpen(false)} source="organiser_marketing_nav" />` (rendered for the organiser surface only; explorer never mounts it).
- `'use client'` is already present (L1) — no change to client/server boundary.
- Do NOT alter the frosted band, logo, SurfaceToggle, header positioning, or any class on the existing markup (HG-3 / ORCH-1010 lane). Only the `<Button>` content/handler is touched + the modal mount is added.

**🎨 OPEN:** internal structure of how `betaOpen` is lifted (local state vs a tiny context) — implementor's call, as long as nav + hero can both open the SAME modal experience (they may each own their own instance; see §3.3 — the modal is self-contained, so two instances is acceptable and simplest).

### 3.2 Marketing Web — Hero CTA swap (component layer)

**File:** `mingla-marketing/components/sections/organiser-home/hero.tsx`

**Current (verified):** imports `VideoModal` (L5) + `Play` icon (L4); `PlayTile` component (L20-43) is a video-launch button; `OrganiserHero` holds `const [videoOpen, setVideoOpen] = useState(false)` (L47), renders `<PlayTile onPlay={() => setVideoOpen(true)} />` inside the CTA `motion.div` (L102-109), and renders `<VideoModal open={videoOpen} ... />` (L114-118).

**Change (🔒 LOCKED):**
- **Remove** the `PlayTile` component (L16-43) entirely.
- **Remove** the `VideoModal` import (L5), the `Play` import (L4) if unused elsewhere in the file (verify — it is only used by `PlayTile`), the `videoOpen` state (L47), and the `<VideoModal>` JSX (L114-118). The hero file must contain **zero** references to video after this change (regression guard, §8 I-1045-HERO-NO-VIDEO).
- Add local state `const [betaOpen, setBetaOpen] = useState(false)`.
- Inside the existing CTA `motion.div` (L102-109) — **same slot, same wrapping `motion.div`, same entrance animation** — render a single primary "Get Beta Access" CTA button that calls `setBetaOpen(true)`. Use the marketing `@/components/ui/button` `<Button>` (variant chosen by designer; recommend `variant="primary"` size `lg` — warm fill, white label, per `button.tsx` L16-18 + memory `primary-ink`→white). The button text is **"Get Beta Access"** (🔒).
- Render `<BetaAccessModal open={betaOpen} onClose={() => setBetaOpen(false)} source="organiser_marketing_hero" />` after the `</section>` (replacing where `<VideoModal>` was).
- Do NOT change the section markup, background `HeroBookingWall`, overlays, headline, or subhead (HG-3 / ORCH-1010 lane).

**🎨 OPEN:** the exact CTA button visual (size, optional sublabel/arrow micro-affordance, hover lift within the band) — designer owns this per §5. The functional contract (single button, opens the beta modal, lives in the existing CTA slot) is LOCKED.

### 3.3 New form component — `BetaAccessModal`

**Files (new):**
- `mingla-marketing/components/marketing/beta-access-modal.tsx` — the 3-step form + modal shell.
- (Optional, 🎨 OPEN) `mingla-marketing/components/ui/modal.tsx` — a reusable accessible modal primitive extracted from the `video-modal.tsx` pattern (backdrop + Framer `AnimatePresence` + ESC-to-close + body-scroll-lock + `role="dialog"`/`aria-modal`). The implementor MAY either (a) extract a shared `<Modal>` and build `BetaAccessModal` on top, or (b) inline the shell into `beta-access-modal.tsx` mirroring `video-modal.tsx`. Either is acceptable; the **accessibility contract below is LOCKED regardless**.

**Props interface (🔒 LOCKED):**
```ts
interface BetaAccessModalProps {
  open: boolean;
  onClose: () => void;
  /** Attribution written to beta_access_leads.source. */
  source: 'organiser_marketing_nav' | 'organiser_marketing_hero';
}
```

**Modal shell behavior (🔒 LOCKED — mirror `video-modal.tsx`):**
- Wrapped in Framer `<AnimatePresence>`; backdrop `motion.div` (fade 0→1, 0.25s) with `role="dialog"` `aria-modal="true"` `aria-labelledby` pointing at the step heading; inner panel spring-in (mirror `video-modal.tsx` L52-59).
- ESC closes (mirror L18-25). Click on backdrop closes; click inside panel `stopPropagation` (mirror L46/58).
- Body scroll lock while open (mirror L28-35).
- Close "X" button top-right with `aria-label="Close"` (mirror L87-94).
- Focus management: on open, move focus to the first focusable control of the current step; trap focus within the panel; on close, return focus to the trigger button. (LOCKED — `video-modal.tsx` does NOT trap focus; this form MUST, because it has inputs. Implementor adds a focus trap.)
- `prefers-reduced-motion`: respect `useMinglaReducedMotion()` (`@/lib/reduced-motion`) — disable spring/slide, keep instant show/hide.

**Form architecture (🔒 LOCKED):**
- Single component holds all state: `step: 1 | 2 | 3`, plus the field values below, plus `status: 'idle' | 'submitting' | 'success' | 'error'`, plus per-field touched/error maps.
- On `open` transitioning false→true, RESET all state to initial (step 1, empty fields, `idle`) — mirror `JoinWaitlistSheet.tsx` L78-86 reset-on-visible pattern.
- Progress indication: a 3-dot / 3-segment progress indicator showing current step (visual treatment is 🎨 OPEN / designer; presence + "Step N of 3" accessible text is 🔒 LOCKED).
- Back/Next navigation: Step 1 has Next only; Step 2 has Back + Next; Step 3 has Back + Submit. Next is disabled until the current step's required fields are valid (inline validation). (🔒 LOCKED)

#### 3.3.1 Per-step field contracts (🔒 LOCKED)

**Step 1 — Brand type** (single-select, required):
- A single-select chip group. Exactly these 7 options, in this order, with these stored values:

  | Display label | Stored `brand_type` value |
  |---|---|
  | Restaurant | `restaurant` |
  | Café / Bar | `cafe_bar` |
  | Club / Nightlife | `club_nightlife` |
  | Event organiser | `event_organiser` |
  | Experience / Tour | `experience_tour` |
  | Venue / Space | `venue_space` |
  | Other | `other` |

- Validation: exactly one selected. Next disabled until a chip is chosen. Selecting a chip may auto-advance OR require Next — 🎨 OPEN (designer); if auto-advance, still expose a visible Next for keyboard users.
- Accessibility: chip group is `role="radiogroup"` with `aria-label="What kind of business are you?"`; each chip `role="radio"` `aria-checked`.

**Step 2 — About you** (all required):
- `brand_name` — "Business name" — text, required, trim, 1–120 chars.
- `contact_name` — "Your name" — text, required, trim, 1–80 chars.
- `city` — "City" — text, required, trim, 1–80 chars. (Free text; no geocode. NG: not validated against launch cities.)
- Validation: Next disabled until all three are non-empty after trim. Inline per-field error ("Add your business name.", "Add your name.", "Add your city.") shown on blur or on Next attempt.

**Step 3 — Contact** (required):
- `email` — "Email" — `type="email"`, `inputMode="email"`, `autoCapitalize="none"`, `autoCorrect="off"`, required, validated against the email regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` (mirror `JoinWaitlistSheet.tsx:38`). Trim + lowercase before submit (mirror L67).
- `consent` — a checkbox, required to submit. Label copy (🔒 — Mingla voice, adapt L228-231 of JoinWaitlistSheet): **"I agree to let Mingla email me about the business beta and how to get set up."** Checkbox is `role="checkbox"` `aria-checked` with an accessible label.
- Submit disabled until `email` valid AND `consent` checked AND `status !== 'submitting'` (mirror `canSubmit` at L71-76).

#### 3.3.2 Client submit transport (service layer, new)

**File (new):** `mingla-marketing/lib/beta-access-submit.ts`

**Contract (🔒 LOCKED):**
```ts
export interface BetaAccessLeadInput {
  brandType: string;       // one of the 7 stored values
  brandName: string;       // trimmed
  contactName: string;     // trimmed
  city: string;            // trimmed
  email: string;           // trimmed + lowercased
  consent: true;           // must be true; UI guarantees it
  source: 'organiser_marketing_nav' | 'organiser_marketing_hero';
}
export type BetaAccessSubmitResult =
  | { ok: true; status: 'created' | 'already_on_list' }
  | { ok: false; error: 'validation' | 'rate_limited' | 'server' | 'network' };

export async function submitBetaAccessLead(
  input: BetaAccessLeadInput,
  signal?: AbortSignal,
): Promise<BetaAccessSubmitResult>;
```
- POSTs JSON to `${NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL}/beta-access-lead-submit` with header `Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}` and `Content-Type: application/json` and `apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}`.
  - **External-API note (Supabase Edge Functions invoke contract):** edge functions are invoked over HTTPS at `https://<project-ref>.functions.supabase.co/<fn>` (or `<SUPABASE_URL>/functions/v1/<fn>`); the platform expects the `Authorization: Bearer <token>` + `apikey` headers. With `verify_jwt = false` the function still receives the request but does not reject on a missing/invalid user JWT. Docs: https://supabase.com/docs/guides/functions/auth and https://supabase.com/docs/reference/javascript/functions-invoke — cited per COMMS-0003. We use raw `fetch` (not the JS client) because the marketing app has no Supabase client (A-2).
- Maps edge-fn responses to the result union: HTTP 200 → `{ ok:true, status }`; HTTP 400 → `validation`; HTTP 429 → `rate_limited`; HTTP 5xx → `server`; thrown/abort/offline → `network`.
- Two new env vars (🔒): `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Implementor MUST create `mingla-marketing/.env.example` documenting both (the app has none today — A-2). The anon key is public by design (RLS + edge-fn validation protect the data; §3.4 RLS denies anon SELECT).

#### 3.3.3 Edge function — `beta-access-lead-submit` (new)

**File (new):** `supabase/functions/beta-access-lead-submit/index.ts`
**Tests (new):** `supabase/functions/beta-access-lead-submit/__tests__/submit_happy.test.ts`, `.../submit_adversarial.test.ts`
**config.toml:** add `[functions.beta-access-lead-submit]` / `verify_jwt = false` (anon-callable; mirror `check-launch-city` config at `config.toml:95-96`).

**HTTP contract (🔒 LOCKED):**
```
POST /beta-access-lead-submit
Request JSON:
  {
    brandType: string,    // required, must be in the 7-value allow-set
    brandName: string,    // required, 1..120 after trim
    contactName: string,  // required, 1..80 after trim
    city: string,         // required, 1..80 after trim
    email: string,        // required, matches email regex, <=254 chars
    consent: boolean,     // required, MUST be true
    source: string        // required, must be 'organiser_marketing_nav' | 'organiser_marketing_hero'
  }
→ 200 { ok: true, status: 'created' | 'already_on_list' }
→ 400 { ok: false, error: 'validation', fields?: string[] }   // any rule above fails
→ 405 { ok: false, error: 'method_not_allowed' }              // non-POST
→ 429 { ok: false, error: 'rate_limited' }                    // see §3.3.5
→ 500 { ok: false, error: 'server' }                          // DB/unexpected
OPTIONS → 200 "ok" with CORS headers
```
- **CORS (🔒):** mirror `check-launch-city` `corsHeaders` (`Access-Control-Allow-Origin: *`, allow `authorization, apikey, content-type`, methods `POST, OPTIONS`). `*` is acceptable — the endpoint is intentionally public and writes only validated, low-sensitivity lead data behind RLS.
- **Validation (🔒):** server-side re-validate EVERY field (never trust the client). `brandType ∈` the 7-value set; `source ∈` the 2-value set; `consent === true` (reject `false`/missing with 400); email regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` and length ≤254; trim + length-bound the three text fields; lowercase the email. Malformed JSON → 400 `validation`.
- **Supabase client (🔒):** create a service-role client (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false }})`) — mirror `check-launch-city` L166-170. The service role is what performs the INSERT (anon RLS denies direct INSERT except via the policy in §3.4; the edge fn is the only writer). The service-role key NEVER leaves the edge runtime.
- **Insert (🔒):** INSERT into `public.beta_access_leads` (columns per §3.4). On unique-violation of the `email` partial-unique constraint → treat as idempotent and return `status:'already_on_list'` (do NOT 500, do NOT send a second notification email). Otherwise `status:'created'`.
- **Email notify (🔒, §3.3.4):** on a NEW (`created`) insert only, POST the notification to Resend. Email send failure MUST NOT fail the request — the lead is already persisted; log the failure and still return 200 `created`. (Constitution #3: the failure is logged server-side, not silently swallowed; the user's success does not depend on the notify email.)
- **Captured marketing fields (🔒):** the edge fn also persists `user_agent` (from request header, truncated ≤512) and `referer` (from `Referer` header, truncated ≤512) into the row for lightweight attribution. It does NOT persist raw IP (privacy); see §3.3.5 for the hashed-IP throttle field.

#### 3.3.4 Email notification contract (Resend) — external API, docs cited (COMMS-0003)

**Endpoint (🔒):** `POST https://api.resend.com/emails`
**Docs:** https://resend.com/docs/api-reference/emails/send-email (canonical "Send Email" reference). Mirrors the live call already shipped at `supabase/functions/marketing-send/index.ts:794-808`.
**Auth (🔒):** header `Authorization: Bearer ${RESEND_API_KEY}` (env secret, A-4) + `Content-Type: application/json`.
**Payload (🔒 — exact field names per Resend docs):**
```json
{
  "from": "Mingla Beta <beta@usemingla.com>",
  "to": ["seth@usemingla.com"],
  "subject": "New beta lead — {brandName} ({brandType})",
  "html": "<lead summary: brand name, contact name, city, brand type, email, source, received-at UTC>",
  "text": "<plaintext equivalent>"
}
```
- `from` MUST use a `usemingla.com` local-part (A-3 — domain verified at Resend; any local-part works). Recommend a dedicated `RESEND_BETA_FROM` env var defaulting to `Mingla Beta <beta@usemingla.com>` to match the `marketing-send` `RESEND_MARKETING_FROM` convention (`marketing-send/index.ts:418`); if the implementor prefers, reuse `RESEND_MARKETING_FROM` — either is acceptable, but the `from` domain MUST be `usemingla.com`. (🔒 on domain; 🎨 on which env var.)
- `to` is `["seth@usemingla.com"]` (single recipient, array form per Resend docs). (🔒)
- The HTML body must NOT fabricate any data — only render the fields actually captured (Constitution #9).
- Resend success response shape: `{ "id": "<uuid>" }` (per docs); error shape: `{ "name": "<error>", "message": "<msg>", "statusCode": <n> }`. The edge fn checks `response.ok`; on non-2xx it logs `resend_${status}` and continues (see §3.3.3 email-failure-non-fatal rule). Mirror the `postToResend` ok/err discrimination at `marketing-send/index.ts:821-828`.
- No retry/backoff is required for the notify email (best-effort; unlike `marketing-send`'s buyer-facing path). A single attempt is acceptable. (🎨 — implementor MAY add one retry; not required.)

#### 3.3.5 Abuse guard (🔒 minimal; durable throttle is NG-8)

- The edge fn computes a salted hash of the client IP (`X-Forwarded-For` first hop) using a server-side `BETA_LEAD_IP_SALT` env var (or reuse an existing salt secret if one exists — implementor checks; if none, add `BETA_LEAD_IP_SALT`) and stores it in `beta_access_leads.ip_hash` (nullable). Raw IP is NEVER stored.
- Lightweight throttle: before insert, count rows in the last 10 minutes where `ip_hash = <hash>`; if `>= 5`, return 429 `rate_limited` (do not insert, do not email). This is a soft guard against trivial scripted abuse; a hardened limiter is NG-8.
- The email-unique idempotency (§3.3.3) covers the common "double-submit" case without a throttle.

### 3.4 Database — migration + RLS

**Migration file (🔒):** `supabase/migrations/20260817000000_orch_1045_beta_access_leads.sql`
- **Version rationale (collision-checked):** the latest applied prefix on main is `20260810000000` (ORCH-1027). Across ALL in-flight worktrees the highest *claimed* prefix is `20260816000000` (ORCH-1034 / ORCH-1043 in sibling worktrees). `20260817000000` is strictly greater than every claimed prefix → no collision. (Verified 2026-06-02 by scanning `~/Desktop/mingla-orchs/*/supabase/migrations/` + main.) See §9 HG-2.

**Table DDL (🔒 LOCKED):**
```sql
create table if not exists public.beta_access_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  brand_type    text not null
                  check (brand_type in (
                    'restaurant','cafe_bar','club_nightlife','event_organiser',
                    'experience_tour','venue_space','other')),
  brand_name    text not null check (char_length(brand_name) between 1 and 120),
  contact_name  text not null check (char_length(contact_name) between 1 and 80),
  city          text not null check (char_length(city) between 1 and 80),
  email         text not null check (char_length(email) between 3 and 254),
  phone         text,                              -- nullable, forward-compat (NG-5)
  consent       boolean not null default false,
  source        text not null default 'organiser_marketing'
                  check (source in ('organiser_marketing','organiser_marketing_nav',
                                    'organiser_marketing_hero')),
  user_agent    text,                              -- truncated <=512 at write
  referer       text,                              -- truncated <=512 at write
  ip_hash       text                               -- salted hash, never raw IP (§3.3.5)
);

-- Case-insensitive idempotency on email (one lead per email).
create unique index if not exists beta_access_leads_email_lower_uidx
  on public.beta_access_leads (lower(email));

-- Admin list ordering + throttle lookups.
create index if not exists beta_access_leads_created_at_idx
  on public.beta_access_leads (created_at desc);
create index if not exists beta_access_leads_ip_hash_recent_idx
  on public.beta_access_leads (ip_hash, created_at desc);
```
> Note: `source` CHECK includes the legacy default `'organiser_marketing'` AND the two specific sub-sources so the column default and the edge-fn-supplied values both satisfy the constraint. The edge fn always writes one of the two specific sub-sources.

**RLS (🔒 LOCKED):**
```sql
alter table public.beta_access_leads enable row level security;
-- No anon/authenticated INSERT, SELECT, UPDATE, or DELETE policies are created.
-- => anon SELECT is DENIED (no policy = deny under RLS). (T-04)
-- => The edge function writes via the SERVICE ROLE, which BYPASSES RLS, so no
--    anon INSERT policy is needed and none is granted (defense in depth: the
--    only write path is the validated edge fn).
-- Admin reads: the admin app authenticates as an allowed admin user. Grant a
-- SELECT policy scoped to admins. Mirror however existing admin-only tables gate
-- SELECT (the implementor MUST reuse the project's established admin-gate pattern
-- — e.g. an is_admin()/admin-claim predicate or the same policy shape used by
-- another admin-only table such as admin_audit_log). If no reusable admin
-- predicate exists, create one consistent with the project's convention.
create policy beta_access_leads_admin_select
  on public.beta_access_leads
  for select
  to authenticated
  using ( <PROJECT_ADMIN_PREDICATE> );   -- implementor binds to the existing admin gate
```
- **Supabase RLS docs (COMMS-0003):** "If no policy exists for an operation, the operation is denied by default" — https://supabase.com/docs/guides/database/postgres/row-level-security . Service-role connections bypass RLS — https://supabase.com/docs/guides/api/api-keys (service_role "bypasses Row Level Security"). Both cited inline per COMMS-0003.
- **🔒 The implementor MUST verify** `<PROJECT_ADMIN_PREDICATE>` resolves to the SAME mechanism the admin app already relies on for other admin-only tables, so the new "Beta Leads" page can read rows under the admin's authenticated session. If the admin app reads other operator-only tables via an edge function / RPC rather than direct table SELECT, mirror THAT instead (and the admin page calls that path). Do not invent a new auth mechanism.

### 3.5 Admin Web — "Beta Leads" tab

**Files:**
- `mingla-admin/src/lib/constants.js` — add a NAV_GROUPS item.
- `mingla-admin/src/components/layout/Sidebar.jsx` — add the icon to `ICON_MAP`.
- `mingla-admin/src/App.jsx` — add the route mapping + import.
- `mingla-admin/src/pages/BetaLeadsPage.jsx` — new page (read-only list).

**Precedent (🔒 — mirror the ORCH-1027 "Launch Cities" tab exactly):**
- `constants.js` NAV_GROUPS (after `launch-cities` precedent at L133): add `{ id: "beta-leads", label: "Beta Leads", icon: "Inbox" }`. Place it logically near "Email"/"Launch Cities" (operator-facing growth tooling). (Icon `Inbox` or `UserPlus` or `Sparkles` — 🎨 designer; the icon string MUST also be added to `Sidebar.jsx` `ICON_MAP` and imported from `lucide-react`.)
- `Sidebar.jsx`: import the chosen icon (mirror the `Rocket`/`Percent` imports L17/L28) and add it to `ICON_MAP` (L33-37). The Sidebar already renders any NAV_GROUPS item generically (`renderNavItem`) — no other Sidebar change needed.
- `App.jsx`: import `{ BetaLeadsPage }` (mirror L22 `LaunchCitiesPage` import) and add `"beta-leads": BetaLeadsPage,` to the page-component map (mirror L37).

**`BetaLeadsPage.jsx` contract (🔒 functional; 🎨 visual via §5):**
- Reads leads via the admin-gated path from §3.4 (direct `supabase.from('beta_access_leads').select(...).order('created_at',{ascending:false})` if direct SELECT is the project pattern; otherwise the mirrored RPC/edge path). Read-only.
- States (all 🔒, mirror LaunchCitiesPage):
  - **loading** — skeleton rows.
  - **load error** — `AlertCard variant="error"` + Retry (mirror LaunchCitiesPage L429-437).
  - **empty** — `DataTable emptyIcon` + "No beta leads yet." (mirror L496-502).
  - **populated** — `DataTable` (mirror L491-505) with columns: Business (brand_name + brand_type badge), Contact (contact_name), City, Email (mono, copyable), Source (badge), Received (relative + absolute UTC on hover). Use the existing admin `DataTable`, `Badge`, `SectionCard` primitives.
  - A summary chip strip (mirror `SummaryChip` L37-51): "Total leads", optionally "This week".
- No edit/delete actions in v1 (NG-6). Row click MAY open a read-only detail (🎨 OPEN); not required.
- Uses `useToast` for any load-error surfacing; mounted-ref guard pattern (mirror L245-249) to avoid setState-after-unmount.

### 3.6 Strict-grep allowlist (CI gate, COMMS-0002)

**File:** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

**Change (🔒 LOCKED — must land in the SAME commit as the backend files):**
- Add a new allowlist const (mirror the existing per-ORCH blocks, e.g. ORCH_1027 at L1207-1213):
```js
const ORCH_1045_BACKEND_ALLOWLIST = [
  "supabase/migrations/20260817000000_orch_1045_beta_access_leads.sql",
  "supabase/functions/beta-access-lead-submit/index.ts",
  "supabase/functions/beta-access-lead-submit/__tests__/submit_happy.test.ts",
  "supabase/functions/beta-access-lead-submit/__tests__/submit_adversarial.test.ts",
];
```
- Add `...ORCH_1045_BACKEND_ALLOWLIST,` to the `const ALLOWLIST = [ ... ]` spread array (at L1215-1216, ideally as the first entry mirroring the newest-first convention).
- Run `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs --self-test` locally before push to confirm the gate stays green (the script supports `--self-test`, see file header).
- **Note:** the marketing + admin files (`mingla-marketing/**`, `mingla-admin/**`, `.env.example`) are NOT under `supabase/` so they do NOT trip C7 and do NOT need allowlisting. Only the migration + edge-fn (+ its tests) do.

---

## 4. Implementation order (🔒)

1. **Migration** — `20260817000000_orch_1045_beta_access_leads.sql` (table + indexes + RLS + admin SELECT policy bound to the project admin gate). Operator applies via the surgical Management-API path per memory `project_migration_history_drift_db_push_unsafe.md` (do NOT blind `db push`).
2. **Strict-grep allowlist** edit (§3.6) — same commit as the migration + edge fn.
3. **Edge function** `beta-access-lead-submit` + `config.toml` entry + Deno tests (happy + adversarial).
4. **Marketing transport** `lib/beta-access-submit.ts` + `.env.example` with the two `NEXT_PUBLIC_*` vars.
5. **Marketing form** `components/marketing/beta-access-modal.tsx` (+ optional `components/ui/modal.tsx`).
6. **Marketing nav** branch (`glass-nav.tsx`).
7. **Marketing hero** swap + video removal (`hero.tsx`).
8. **Admin tab** — constants.js → Sidebar.jsx → App.jsx → BetaLeadsPage.jsx.
9. Designer's visual contract (§5) is produced BEFORE steps 5-8's final polish (it's a UI ORCH).

---

## 5. Designer handoff (REQUIRED — this is a UI ORCH)

This SPEC owns the **functional contract + UX acceptance bar**. The **granular visual contract** for the 3-step popup, the two CTA states, the progress indicator, the chip group, and the admin tab visuals is produced by `mingla-designer` and referenced here before IMPLEMENT finalizes the UI. The designer MUST pin (per `spec-granularity-protocol.md`):
- Exact Tailwind/CSS tokens for the modal surface/backdrop/panel, chips (default/hover/selected/focus), inputs (default/focus/error/disabled), buttons (the marketing `<Button>` variants are predefined in `button.tsx` — designer chooses which + any overrides), progress indicator, and consent checkbox — light theme (the marketing site is light/warm; verify dark behavior is N/A or handled).
- Typography per role (`font-display` headings per the site convention).
- Spacing/placement on a 4px grid; safe-area + edge padding; max panel width + responsive at 375/390/430 + desktop.
- Motion: entrance/exit, step-transition (slide/fade), reduced-motion fallback; press feedback.
- All 9 states with Mingla-voice copy (idle / per-step validating / submitting / success / error / offline / first-time / returning / degraded).
- The hero "Get Beta Access" CTA visual + the nav button visual (both reuse `@/components/ui/button`).
- A "References examined" line (premium SaaS multi-step lead/waitlist modals studied).
- No-AI-slop: no generic gradients, stock/AI imagery, emoji icons, or decorative effects (per `mingla-designer/references/premium-craft.md`).

**Designer output:** `Mingla_Artifacts/specs/DESIGN_ORCH-1045_GET_BETA_ACCESS.md` (all 9 states for the modal + both CTAs + admin tab), referenced by IMPLEMENT.

---

## 6. Cross-Surface Impact (MANDATORY — Phase 2.5)

| # | Surface | Covered? | Behavior / files / parity |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | No analog; consumer app does not render the marketing beta form. |
| 2 | Consumer Android (`app-mobile/` Android) | **NO** | Same as #1. |
| 3 | Buyer/anon Web (`mingla-business` public routes) | **NO** | Beta form is organiser-marketing only; buyer-anon routes don't expose it. |
| 4 | Business iOS (`mingla-business` iOS) | **NO** | The beta lead form is a marketing-site (web) feature; the business app is for already-onboarded brands. `JoinWaitlistSheet.tsx` here is a *pattern reference only* — NOT modified. |
| 5 | Business Android (`mingla-business` Android) | **NO** | Same as #4. |
| 6 | Admin Web (`mingla-admin/`) | **YES** | New read-only "Beta Leads" tab. Files: `constants.js`, `Sidebar.jsx`, `App.jsx`, `BetaLeadsPage.jsx`. SC-6 below. |
| 7 | Marketing Web (`mingla-marketing/`) | **YES** | Organiser surface: nav CTA branch + hero CTA swap + 3-step modal + transport. Explorer surface: UNCHANGED. SC-1..SC-5 below. |
| — | Backend (`supabase/`) | **YES** | New table + RLS + edge fn + Resend notify + config.toml + strict-grep allowlist. SC-7..SC-9 below. |

**Parity note:** the only two covered UI surfaces (Marketing Web organiser, Admin Web) are separate codebases with separate code paths → each has its own success criteria (no shared-code auto-parity). The marketing surface itself has TWO entry points (nav + hero) opening the SAME modal experience — SC-1/SC-2 cover each separately because they're distinct call sites.

---

## 7. Success Criteria (observable, testable, unambiguous)

- **SC-1 (Marketing nav, organiser):** On any `/organisers*` page, the nav CTA reads **"Get Beta Access"** and clicking it opens the 3-step modal. On `/` (explorer) the nav CTA still reads **"Get the app"** and remains a no-op (NG-1). [component]
- **SC-2 (Marketing hero, organiser):** The organiser hero shows a single **"Get Beta Access"** primary CTA in the existing CTA slot; clicking it opens the SAME 3-step modal. The hero file contains ZERO references to `VideoModal`/`videoOpen`/`PlayTile`/`Play` (I-1045-HERO-NO-VIDEO). [component + regression]
- **SC-3 (Form flow):** A user can complete Step 1 (pick a brand type) → Step 2 (business name + name + city) → Step 3 (email + consent) with Back/Next working, progress shown as "Step N of 3", inline validation blocking Next/Submit until each step is valid. [component]
- **SC-4 (Happy submit):** Submitting valid input shows a `submitting` state, then a success state confirming "you're on the beta list" (Mingla voice, designer copy), and a new row exists in `beta_access_leads` with the exact field values (email lowercased, source = the originating CTA), and seth@usemingla.com receives ONE notification email. [full stack]
- **SC-5 (Error states):** Invalid email → inline error, Submit disabled. Unchecked consent → Submit disabled. Network failure on submit → visible error state with a retry affordance, NO false success, modal stays open with entered data preserved. [component + transport]
- **SC-6 (Admin tab):** A "Beta Leads" item appears in the admin sidebar; selecting it renders the leads list newest-first with loading/empty/error/populated states; a freshly submitted lead from SC-4 appears after refresh. [admin]
- **SC-7 (DB/RLS — anon SELECT denied):** An anonymous (anon-key) `select * from beta_access_leads` returns ZERO rows / permission denied; the edge fn (service role) can insert. [DB + RLS]
- **SC-8 (Idempotency):** Submitting the same email twice yields exactly ONE row and exactly ONE notification email; the second submit returns `already_on_list` and the user still sees a confirmation (not an error). [edge + DB]
- **SC-9 (CI gate green):** The ORCH-0863 strict-grep `C7: no-new-backend-files` check passes with the migration + edge-fn files allowlisted; `--self-test` passes. [CI]

---

## 8. Invariants

**New invariants established:**
- **I-1045-ORGANISER-ONLY-CTA** — The "Get Beta Access" CTA + modal mount ONLY on the organiser surface; the explorer nav CTA stays "Get the app" with no handler. Verified by SC-1 + a grep that `glass-nav.tsx` branches on `surface` and only the organiser branch references `BetaAccessModal`.
- **I-1045-HERO-NO-VIDEO** — `hero.tsx` contains no `VideoModal`/`videoOpen`/`PlayTile`/`Play` references after this change. Verified by SC-2 + grep.
- **I-1045-ANON-NO-SELECT** — `beta_access_leads` has NO anon SELECT policy; anon reads return nothing. Verified by SC-7.
- **I-1045-LEAD-EMAIL-UNIQUE** — at most one lead row per lower(email); resubmits are idempotent + email-once. Verified by SC-8.
- **I-1045-NO-SERVICE-KEY-CLIENT** — no service-role key appears in `mingla-marketing/**`; the client uses only `NEXT_PUBLIC_*` anon key + the edge fn. Verified by grep.

**Existing invariants preserved:**
- ORCH-1010 hero/nav layout invariants — preserved by NG-2/HG-3 (CTA drops into existing slots only).
- Constitution #3 (no silent failures) — email-notify failure is logged + non-fatal; submit network failure surfaces a visible error (SC-5).
- Constitution #9 (no fabricated data) — admin list + notify email render only captured fields.
- COMMS-0002 strict-grep gate — preserved via §3.6 allowlist.

---

## 9. Hard Guards

- **HG-1 (anon security):** The marketing site is unauthenticated. The lead path is anon-safe: edge fn re-validates ALL input, service-role key stays server-side, RLS denies anon SELECT, soft IP-hash throttle + email idempotency guard abuse. No service-role key in client code (I-1045-NO-SERVICE-KEY-CLIENT).
- **HG-2 (migration collision):** Use `20260817000000` — strictly greater than the highest claimed prefix (`20260816000000`) across all worktrees + main as of 2026-06-02. If the implementor picks up this work later, RE-SCAN `~/Desktop/mingla-orchs/*/supabase/migrations/` + main and bump to the next free prefix if `20260817000000` was taken in the interim.
- **HG-3 (ORCH-1010 no-regress):** ORCH-1010 [marketing-business-rebrand] is an active parallel worktree owning the hero/nav copy + design. ORCH-1045 touches ONLY the nav `<Button>` slot (L84) and the hero CTA `motion.div` slot (L102-109) + removes the hero video wiring. No layout/grid/spacing/copy changes elsewhere. Whichever of ORCH-1010 / ORCH-1045 merges first, the other rebases; the CTA edits are confined to non-overlapping single slots to keep the merge surface minimal.
- **HG-4 (strict-grep, COMMS-0002):** The migration + edge-fn + edge-fn tests MUST be added to the ORCH-0863 allowlist (§3.6) in the SAME commit, or the `C7: no-new-backend-files` GitHub check fails the PR.
- **HG-5 (external-API docs, COMMS-0003):** Resend `POST /emails` cited (https://resend.com/docs/api-reference/emails/send-email); Supabase edge-fn invoke + RLS deny-by-default + service-role-bypass cited (§3.3.2, §3.4). Dashboard labels are not API enums; the payload uses Resend's documented `from`/`to`/`subject`/`html`/`text` fields verbatim.
- **HG-6 (migration apply protocol):** Do NOT blind `supabase db push` (memory `project_migration_history_drift_db_push_unsafe.md`). Apply via the surgical Management-API path + INSERT the version into `schema_migrations`. Operator owns the apply; the SPEC flags it.

---

## 10. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-01 (happy)** | Full lead submit | Step1 `restaurant`; Step2 brand/name/city; Step3 valid email + consent | 200 `{ok:true,status:'created'}`; 1 row in `beta_access_leads` (email lowercased, source=`organiser_marketing_hero` or `_nav`); 1 email to seth@usemingla.com; success state shown | Full stack |
| **T-02 (missing consent)** | Adversarial | Valid fields, `consent:false` (and bypass UI → POST directly) | Submit disabled in UI; direct POST → 400 `{ok:false,error:'validation'}`; NO row inserted; NO email | Component + edge |
| **T-03 (invalid email)** | Validation | `email:"not-an-email"` | Inline error in UI; direct POST → 400 `validation`; no row | Component + edge |
| **T-04 (anon SELECT denied)** | Security | anon-key `select * from beta_access_leads` | 0 rows / permission denied | DB + RLS |
| **T-05 (idempotent resubmit)** | Edge case | Submit same email twice | Exactly 1 row; 2nd → 200 `already_on_list`; exactly 1 notify email; user sees confirmation both times | Edge + DB |
| **T-06 (email-notify failure non-fatal)** | Error path | Force Resend to 500 (mock) | Lead row STILL inserted; request returns 200 `created`; failure logged server-side; no user-visible error | Edge |
| **T-07 (network failure on submit)** | Error path | Kill network mid-submit | Visible error state + retry; no false success; modal keeps entered data | Component + transport |
| **T-08 (explorer unchanged)** | Regression | Load `/` | Nav CTA reads "Get the app", no modal mounts, no handler | Component |
| **T-09 (hero no-video)** | Regression | grep `hero.tsx` | Zero `VideoModal`/`videoOpen`/`PlayTile`/`Play` references | Static |
| **T-10 (brand_type allow-set)** | Adversarial | POST `brandType:"hacker"` | 400 `validation`; no row | Edge |
| **T-11 (throttle)** | Abuse | 6 POSTs from same IP in <10min | 6th → 429 `rate_limited`; no row/email for it | Edge |
| **T-12 (CI gate)** | CI | Run strict-grep `--self-test` + full check on the PR diff | C7 passes with the 4 allowlisted backend files | CI |
| **T-13 (admin list)** | Admin | Open Beta Leads tab as admin after T-01 | The T-01 lead appears newest-first; loading→populated states correct | Admin |

---

## 11. Regression Prevention

- **I-1045-HERO-NO-VIDEO** is grep-checkable (T-09); the tester greps `hero.tsx` for the four tokens.
- **I-1045-ANON-NO-SELECT** is asserted by the Deno adversarial test (T-04) querying with the anon key.
- **I-1045-LEAD-EMAIL-UNIQUE** is enforced structurally by the DB unique index `beta_access_leads_email_lower_uidx` (not just app logic) — a resubmit cannot create a duplicate even if the edge-fn check is bypassed.
- A protective comment in `glass-nav.tsx` at the CTA branch explains WHY explorer keeps the dead "Get the app" button (NG-1, operator-locked) so a future cleanup doesn't "fix" it.
- A protective comment in the migration header cites ORCH-1045 + the anon-no-SELECT + service-role-only-write design so a future RLS edit doesn't add an anon SELECT policy.

---

## 12. Completion check (this SPEC)

- [x] All 4 locked decisions specified across all layers: (1) organiser-only nav branch §3.1; (2) hero CTA swap + video removal §3.2; (3) 3-step form §3.3; (4) table+RLS §3.4 / admin tab §3.5 / email §3.3.4.
- [x] Exact `beta_access_leads` schema + RLS §3.4.
- [x] Per-step field contracts + validation §3.3.1.
- [x] All UI states (idle/loading/submitting/success/error per step) §3.3 + §5 (designer owns granular visuals).
- [x] Email-notify contract with Resend docs cited inline §3.3.4 (COMMS-0003).
- [x] Strict-grep allowlist instruction §3.6 (COMMS-0002).
- [x] Migration-collision guard §3.4 / HG-2; ORCH-1010 no-regress HG-3.
- [x] Cross-Surface Impact §6; invariants §8; ≥2 acceptance cases (T-01 happy, T-02/T-04 adversarial) §10.
- [x] 🔒 LOCKED / 🎨 OPEN tags throughout; designer handoff required §5.
