# INVESTIGATE — Prod Supabase CONFIG Env Vars (23) + Key-Deletion Scope

**Date:** 2026-06-10
**Mode:** mingla-forensics INVESTIGATE (read-only, no code changes)
**Goal:** For each of ~23 CONFIG env vars, trace actual code to determine purpose, read-sites, in-code default, format, and recommended prod value. Plus confirm deletion scope for OPENAI / ANTHROPIC (keep) vs LOVABLE / GOOGLE_GEOLOCATION (delete).
**Method:** Exhaustive `grep` of `Deno.env.get("VAR")` / `process.env.VAR` across `supabase/functions`, `app-mobile`, `mingla-business`, `mingla-admin`, `scripts` (node_modules + .git excluded), then verbatim read of every read-site file.
**Prod project:** `gupxgpmukdwhozqfmzgd` ("Mingla-prod"). Domains in code defaults: `mingla.app`, `business.usemingla.com`, `usemingla.com`.

> **HEADLINE SURPRISE:** All 9 `PLACES_*` vars and `MINGLA_LOGO_URL_2X` have **ZERO read-sites in code** — they are NOT consumed anywhere. The standup runbook lists `PLACES_*` as "derivable config" but no code reads them. They are safe to **skip entirely** on prod (set nothing). Details in Section C.

---

## A. The 23-Var Master Table

Legend for "Recommended prod value": a value in `code` font is the exact in-code default (set it verbatim or leave unset to inherit it); **operator must supply** means no code default exists and the var is required or behavior-affecting.

| # | Var | Purpose (what it powers) | Reads at file:line | Code default / fallback | Recommended prod value |
|---|-----|--------------------------|--------------------|-------------------------|------------------------|
| 1 | `MINGLA_PUBLIC_APP_ORIGIN` | Base origin for **consumer-app links inside marketing emails** (unsubscribe/app deep-links built by marketing-send). | `supabase/functions/marketing-send/index.ts:772` | `?? "https://mingla.app"` | `https://mingla.app` (code default; leave unset OR set explicitly to the production consumer-app origin if different) |
| 2 | `MINGLA_PUBLIC_WEB_BASE_URL` | **Buyer-web Stripe Checkout success/cancel URLs** (`/checkout/{id}/confirm`, `/payment`). **Required for web checkout** — 500 `web_base_url_missing` if unset/invalid. | `supabase/functions/ticket-checkout-create/index.ts:975` (also client mirror `EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL` in `mingla-business/src/hooks/useBrandStripeTaxAccountSession.ts:10`) | **none — hard 500 if unset; must match `^https://...$`** | **operator must supply: the production buyer-web origin** (the Vercel domain that serves `mingla-business` web `/checkout/...`, e.g. `https://business.usemingla.com`). Must be `https://`. |
| 3 | `MINGLA_BUSINESS_WEB_URL` | Base origin for **business-web links in emails** (brand-member invite accept, scanner invite accept, ticket-confirmation organiser links, claim-approved). Edge-side. | `supabase/functions/invite-brand-member/index.ts:520`; `invite-scanner/index.ts:382`; `ticket-confirmation-dispatch/index.ts:231`; `_shared/email/claimApprovedEmail.ts:24` | `?? "https://business.usemingla.com"` (all four sites) | `https://business.usemingla.com` (code default; leave unset OR set verbatim) |
| 4 | `BUSINESS_WEB_ORIGIN` | **Stripe Connect embedded onboarding/account-session return + refresh URLs** for brand & partner payout onboarding. **Fail-closed**: edge fns throw at module load if unset. | `partner-stripe-onboard/index.ts:55`; `brand-stripe-account-session/index.ts:29`; `brand-stripe-onboard/index.ts:47` | **none — throws `BUSINESS_WEB_ORIGIN env var is not set` at import** | **operator must supply: the production business-web origin** (same Vercel domain, e.g. `https://business.usemingla.com`). Hard-required for any brand payout onboarding. |
| 5 | `RESEND_ADMIN_FROM` | Sender identity for **admin/hello transactional email** ("Mingla <hello@…>"). | `supabase/functions/_shared/email/senders.ts:26` | `?? {name:"Mingla", address:"hello@usemingla.com"}` | `Mingla <hello@usemingla.com>` (code default; leave unset OR set verbatim — requires Resend DKIM on `hello@usemingla.com`) |
| 6 | `RESEND_SYSTEM_FROM` | Sender identity for **system/notification email** ("Mingla <notifications@…>"). | `supabase/functions/_shared/email/senders.ts:27` | `?? {name:"Mingla", address:"notifications@usemingla.com"}` | `Mingla <notifications@usemingla.com>` (code default — requires Resend DKIM on `notifications@usemingla.com`) |
| 7 | `RESEND_TICKET_FROM` | Sender identity for **buyer ticket-confirmation email** ("Mingla <tickets@…>"). | `supabase/functions/_shared/email/senders.ts:25` | `?? {name:"Mingla", address:"tickets@usemingla.com"}` | `Mingla <tickets@usemingla.com>` (code default — requires Resend DKIM on `tickets@usemingla.com`) |
| 8 | `STRIPE_DISPUTE_ALERT_EMAILS` | **Comma-separated** recipient list for **Stripe dispute alert emails**. If empty, dispute is persisted but no operator notification (warns to log). | `supabase/functions/_shared/stripeDisputeHandlers.ts:97` | `?? ""` (parsed `split(",").map(trim).filter(Boolean)`) | **operator must supply: the ops alert recipient(s)**, comma-separated (e.g. `seth@usemingla.com` or `ops@usemingla.com,seth@usemingla.com`). |
| 9 | `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` | **Comma-separated** recipients for **Stripe webhook signature-failure alerts** (security/ops). Empty ⇒ no alert sent. | `supabase/functions/stripe-webhook/index.ts:38` | `?? ""` (same CSV parse) | **operator must supply: the ops alert recipient(s)**, comma-separated (same address(es) as #8 is fine). |
| 10 | `MINGLA_FOOTER_ADDRESS` | **Footer "from" address line in all transactional + marketing emails.** **Required in production** — email render throws `email_env_missing:MINGLA_FOOTER_ADDRESS` if unset (test-only default exists). | `_shared/email/index.ts:61` (required); `invite-brand-member/index.ts:582`; `_shared/marketingEmailRender.ts:189` (defaulted); `_shared/email/tripConfirmationEmail.ts:142` | required in `_shared/email/index.ts` (no default unless `DENO_TESTING=1` → `"Mingla, hello@usemingla.com"`); marketing render defaults `?? "Mingla, hello@usemingla.com"` | `Mingla, hello@usemingla.com` (the canonical test-default; set verbatim, or operator's real mailing address if a physical address is desired for CAN-SPAM). **Must be set in prod or transactional email render throws.** |
| 11 | `MINGLA_LOGO_URL` | **Logo image URL in the email brand shell + ticket PDF.** **Required in production** — render throws `email_env_missing:MINGLA_LOGO_URL` if unset (test-only default). | `_shared/email/index.ts:55` (required); `invite-brand-member/index.ts`; `ticket-confirmation-dispatch`; `_shared/marketingEmailRender.ts:187`; `_shared/email/tripConfirmationEmail.ts:136`; `ticket-pdf-fetch/index.ts:24` | required in `_shared/email/index.ts` (no default unless `DENO_TESTING=1` → `"https://usemingla.com/email-assets/mingla-logo.png"`); marketing render + pdf default to that same URL | `https://usemingla.com/email-assets/mingla-logo.png` (canonical default; set verbatim). **Operator must publish the logo at that URL** (or set this var to wherever the prod logo actually lives). Required or email render throws. |
| 12 | `MINGLA_LOGO_URL_2X` | **UNUSED.** Retina `@2x` logo variant — was reserved in ORCH-0785 but **never wired into any renderer**. Zero functional read-sites. | (none — only docs/specs in `Mingla_Artifacts/`) | n/a | **Skip — do not set.** No code reads it. (Optional: set `https://usemingla.com/email-assets/mingla-logo@2x.png` for forward-compat, but it has no effect today.) |
| 13 | `EVENT_COVER_VIDEO_PROVIDER` | Selects the **event-cover-video provider**. The ONLY value that enables the feature is `"cloudinary"`; any other value disables provider (`providerConfigured()` returns false). | `supabase/functions/_shared/eventCoverVideo.ts:249` | `?? "cloudinary"` | `cloudinary` (code default; leave unset OR set verbatim). Note: provider also needs `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` set or the feature is off regardless. |
| 14 | `NATIVE_PAID_ALLOWED_REGIONS` | **DECOMMISSIONED (ORCH-0955).** Region allowlist gate was deleted; native paid is now universal. No active code reads it; tests assert it is **absent** from `ticket-checkout-create`. | (none in active `index.ts`; only `__tests__/` assertions that it must NOT appear) | n/a | **Skip — do NOT set.** Setting it has no effect; re-introducing the gate would violate the ORCH-0955 invariant. |
| 15 | `PLACES_BUDGET_USD` | **UNUSED in code.** Intended places-seeding budget cap. Zero read-sites anywhere. | (none) | n/a — `admin-seed-places` uses hardcoded constants, not this env var | **Skip — do not set.** No code consumes it. (See Section C.) |
| 16 | `PLACES_DEFAULT_RADIUS_M` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 17 | `PLACES_MAX_CALLS_PER_BATCH` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 18 | `PLACES_MAX_RADIUS_M` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 19 | `PLACES_PAGES_MAX` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 20 | `PLACES_PRICE_DETAILS_PER_1K` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 21 | `PLACES_PRICE_NEARBY_PER_1K` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 22 | `PLACES_PRICE_PHOTOS_PER_1K` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |
| 23 | `PLACES_PRICE_TEXT_PER_1K` | **UNUSED in code.** Zero read-sites. | (none) | n/a | **Skip — do not set.** |

### Quick "must-supply" shortlist (the only ones with no usable code default)

| Var | Why it needs a real value |
|-----|---------------------------|
| `MINGLA_PUBLIC_WEB_BASE_URL` | Hard 500 on buyer-web checkout if unset/non-https. |
| `BUSINESS_WEB_ORIGIN` | Edge fns throw at load; brand payout onboarding dead without it. |
| `STRIPE_DISPUTE_ALERT_EMAILS` | Empty ⇒ no dispute alert ever fires (silent). |
| `STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS` | Empty ⇒ no webhook-tamper alert ever fires (silent). |
| `MINGLA_FOOTER_ADDRESS` | Transactional email render THROWS in prod if unset. |
| `MINGLA_LOGO_URL` | Transactional email render THROWS in prod if unset; logo asset must exist at the URL. |

Everything else either has a correct code default (`MINGLA_PUBLIC_APP_ORIGIN`, `MINGLA_BUSINESS_WEB_URL`, `RESEND_*_FROM`, `EVENT_COVER_VIDEO_PROVIDER`) or is dead/unused (skip).

---

## B. Deletion Verdict

### KEEP + SET (actively used)

#### `OPENAI_API_KEY` — KEEP, ACTIVELY USED (5 consuming functions)

| Consuming function | Read at | Fail-mode without key |
|--------------------|---------|------------------------|
| `moderate-content` | `index.ts:44` | **Fails OPEN** — `OPENAI_API_KEY missing — failing open`, returns `{flagged:false}` (does not block users). |
| `generate-ai-summary` | `index.ts:189` | **Degrades** — returns hardcoded fallback summary, HTTP 200. |
| `generate-curated-experiences` | `index.ts:40` (+ reads at 1436/1457/1496/1514/1530/1548/1564/1581/1819/1824) | **Degrades** — `?? ''`; returns static shopping list / skips AI enrichment, no hard error. |
| `generate-holiday-categories` | `index.ts:72` | **Degrades** — `No OPENAI_API_KEY — returning fallback`, returns `FALLBACK_CATEGORIES`, HTTP 200. |
| `ai-reason` | `index.ts:17` | **HARD-ERRORS** — returns HTTP **500** `{error:'OpenAI API key not configured'}`. |
| (script) `scripts/verify-places-pipeline.mjs` | `:34`, asserted required `:41`, used `:1042` | Verification script aborts if missing — not a runtime function. |

**Verdict:** KEEP and SET on prod. Without it, four functions silently degrade and **`ai-reason` hard-500s** (weather-aware experience recommendations break).

#### `ANTHROPIC_API_KEY` — KEEP, ACTIVELY USED (1 active consuming function)

| Consuming function | Read at | Fail-mode without key |
|--------------------|---------|------------------------|
| `score-place-photo-aesthetics` | `index.ts:82` | **HARD-ERRORS** — returns HTTP **500** `{error:"ANTHROPIC_API_KEY not configured"}`. |
| `run-place-intelligence-trial` | `index.ts:652` | **NOT a real read — COMMENT ONLY.** `// ANTHROPIC_API_KEY env var no longer required` (dropped per DEC-101 / ORCH-0733; Gemini is sole provider). |

**Verdict:** KEEP and SET on prod. Exactly **one** active consumer (`score-place-photo-aesthetics`), and it **hard-500s** without the key. The runbook's premise is correct.

### DELETE-SAFE (zero functional code references)

#### `LOVABLE_API_KEY` — SAFE TO DELETE

- **Functional refs across `supabase` / `app-mobile` / `mingla-business` / `mingla-admin` / `scripts`: ZERO.**
- **Not in `supabase/config.toml`.**
- **Only reference in the entire repo:** `Mingla_Artifacts/reports/PROD_SUPABASE_STANDUP_RUNBOOK_2026-06-10.md:32` (lists it in the "GAP — need values" bucket). That is a planning doc, not code.
- **Verdict:** No code reads it. Do NOT set it on prod; remove from any dev secrets cleanup. The runbook line at :32 should drop it from the "need values" list.

#### `GOOGLE_GEOLOCATION_API_KEY` — SAFE TO DELETE

- **Functional refs across all code dirs: ZERO.**
- **Not in `supabase/config.toml`.**
- **Only reference in the entire repo:** `Mingla_Artifacts/reports/PROD_SUPABASE_STANDUP_RUNBOOK_2026-06-10.md:32` (same "GAP — need values" bucket). Planning doc only.
- **Note:** Distinct from `GOOGLE_MAPS_API_KEY`, which IS used (`admin-seed-places/index.ts:32`, seeding + companion/picnic stops per memory). Do not confuse the two.
- **Verdict:** No code reads it. Do NOT set it on prod. Drop from the runbook :32 list.

---

## C. Surprises (where "reputation" ≠ code reality)

1. **All 9 `PLACES_*` vars are NOT read by any code.** The standup runbook (`PROD_SUPABASE_STANDUP_RUNBOOK_2026-06-10.md:30`) lists `PLACES_*` budgets under "Derivable config" implying code reads them — it does not. `admin-seed-places/index.ts` uses **hardcoded constants** (`EXPECTED_UNIQUE_PLACES_PER_TILE = 10`, `PHOTOS_PER_PLACE`, `COST_PER_PHOTO`, etc. at lines 125/549/671), not env vars. `scripts/verify-places-pipeline.mjs` reads only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `SERPER_API_KEY`. **There is no in-code default to "derive" for these because there is no read-site.** → **Skip all 9.** (If they exist on the dev project, they are orphaned secrets set but never consumed.)

2. **`MINGLA_LOGO_URL_2X` is read by NOTHING.** ORCH-0785 reserved it but never wired it into the `<img srcset>` (documented as a low-pri follow-up in the QA + implementation reports). Zero functional read-sites. → Skip.

3. **`NATIVE_PAID_ALLOWED_REGIONS` is decommissioned, not just unused.** ORCH-0955 deleted the region gate entirely; tests now assert the string must NOT appear in `ticket-checkout-create`. Setting it does nothing; re-introducing the gate would break the ORCH-0955 invariant. → Skip (and the runbook should drop it from `EVENT_COVER_VIDEO_PROVIDER`'s neighbor list of "derivable config").

4. **`run-place-intelligence-trial` does NOT consume `ANTHROPIC_API_KEY`** despite the grep hit — that line is a historical comment (DEC-101 moved the trial to Gemini). So ANTHROPIC has exactly **one** live consumer, not two. The key is still required (for `score-place-photo-aesthetics`), so the KEEP verdict stands, but the consumer count is 1.

5. **Six vars are "required/fail-closed", not merely defaulted** — and three of those (`MINGLA_PUBLIC_WEB_BASE_URL`, `BUSINESS_WEB_ORIGIN`, plus `MINGLA_LOGO_URL`/`MINGLA_FOOTER_ADDRESS` in prod) will **break a user-facing flow at runtime** (web checkout 500 / payout onboarding throw / email render throw) if left unset on the fresh prod project. These are the real launch-blockers in the 23, not the PLACES budgets.

6. **`EVENT_COVER_VIDEO_PROVIDER` accepts only `"cloudinary"`.** There is no `"pexels"`/`"mux"` branch — any non-`"cloudinary"` value silently disables the provider. The default `"cloudinary"` is correct; the var only matters as a kill-switch.

---

## Evidence appendix (read-sites, verbatim anchors)

- `marketing-send/index.ts:772` — `return Deno.env.get("MINGLA_PUBLIC_APP_ORIGIN") ?? "https://mingla.app";`
- `ticket-checkout-create/index.ts:975` — `const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");` → `:976` `if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl))` → 500 `web_base_url_missing`.
- `invite-brand-member/index.ts:520`, `invite-scanner/index.ts:382`, `ticket-confirmation-dispatch/index.ts:231`, `_shared/email/claimApprovedEmail.ts:24` — all `?? "https://business.usemingla.com"`.
- `partner-stripe-onboard/index.ts:55-58`, `brand-stripe-account-session/index.ts:29-32`, `brand-stripe-onboard/index.ts:47-50` — `if (!BUSINESS_WEB_ORIGIN) throw … "BUSINESS_WEB_ORIGIN env var is not set."` (fail-closed at module load; adversarial test `brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts` enforces).
- `_shared/email/senders.ts:25-27` — `resolveSender("RESEND_TICKET_FROM","Mingla","tickets@usemingla.com")` etc.
- `_shared/stripeDisputeHandlers.ts:97` — `Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS") ?? ""` then `.split(",").map(trim).filter(Boolean)`.
- `stripe-webhook/index.ts:38` — `Deno.env.get("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS") ?? ""` (same CSV parse; empty ⇒ `return 0`, no alert).
- `_shared/email/index.ts:54-65` — `requireEnv("MINGLA_LOGO_URL", DENO_TESTING===1 ? "…/mingla-logo.png" : undefined)` and `requireEnv("MINGLA_FOOTER_ADDRESS", DENO_TESTING===1 ? "Mingla, hello@usemingla.com" : undefined)`; `requireEnv` throws `email_env_missing:${key}` when unset and no fallback.
- `_shared/marketingEmailRender.ts:187/189` — `?? "https://usemingla.com/email-assets/mingla-logo.png"` / `?? "Mingla, hello@usemingla.com"`.
- `_shared/eventCoverVideo.ts:249` — `(Deno.env.get("EVENT_COVER_VIDEO_PROVIDER") ?? "cloudinary") === "cloudinary"`.
- OPENAI: `moderate-content:44`, `generate-ai-summary:189`, `generate-curated-experiences:40`, `generate-holiday-categories:72`, `ai-reason:17`.
- ANTHROPIC: `score-place-photo-aesthetics:82` (active, 500 on miss); `run-place-intelligence-trial:652` (comment only).
- LOVABLE / GOOGLE_GEOLOCATION: zero refs in `supabase|app-mobile|mingla-business|mingla-admin|scripts`; sole hit `PROD_SUPABASE_STANDUP_RUNBOOK_2026-06-10.md:32`.

**Confidence:** proven (static-config trace; every read-site read verbatim). No simulator repro applicable — this is a backend config-audit, exempt from the live-fire directive.
