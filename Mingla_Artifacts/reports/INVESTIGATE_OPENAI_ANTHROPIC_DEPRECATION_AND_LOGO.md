# INVESTIGATE — OpenAI/Anthropic edge-function deprecation safety + real email-logo URL

**Mode:** INVESTIGATE (read-only, zero code changes). **Date:** 2026-06-10.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` @ `main` (clean).
**Method:** real repo greps (app-mobile + mingla-business + mingla-admin + supabase/functions + supabase/migrations), Supabase Storage SQL via MCP (project `gqnoajqerqhnvulmnyvv`), live `curl -sI`.

---

## ═══ HEADLINE ═══

**Investigation 1 — DO NOT delete the OpenAI/Anthropic keys or 3 of the 6 functions.** Earlier analysis assumed all 6 are dead because they only "read the key." That is **wrong**: 3 of the 6 are on **live, invoked, user-facing paths** AND still call OpenAI at runtime (graceful fallback, but the key is consumed when present). Only **3** are truly orphaned.

- **DELETE-SAFE (zero invokers): `generate-ai-summary`, `ai-reason`, `score-place-photo-aesthetics`.**
- **MUST KEEP (live callers + active OpenAI use): `moderate-content`, `generate-curated-experiences`, `generate-holiday-categories`.**
- **`OPENAI_API_KEY` is NOT safe to delete** — 3 live functions read+use it. `ANTHROPIC_API_KEY` **is** safe to delete (its only consumer, `score-place-photo-aesthetics`, is orphaned; the live intelligence-trial replacement uses Gemini, not Anthropic).

**Investigation 2 — the real email logo is in Supabase Storage, not usemingla.com.**
`MINGLA_LOGO_URL` on dev points at **`https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/App%20Stuff/mingla_official_logo.png`** — verified **HTTP 200, image/png, 29,762 bytes, last-modified 2026-05-11** (the day ORCH-0785 email branding shipped). The code's hardcoded fallback `https://usemingla.com/email-assets/mingla-logo.png` returns **404** (confirms operator: it was never published there).

---

## ═══ INVESTIGATION 1: OpenAI/Anthropic edge functions — LIVE vs DEAD ═══

### Per-function verdict table

| # | Function | Provider | Invoked by (file:line) | OpenAI/Anthropic use today | Verdict |
|---|----------|----------|------------------------|----------------------------|---------|
| 1 | `moderate-content` | OPENAI | `app-mobile/src/services/moderationService.ts:42` `supabase.functions.invoke('moderate-content')` → called from `useMessages.ts:286` (DM moderation), `authService.ts:286` (profile-bio moderation), `boardMessageService.ts:226` (board-message moderation) | **YES** — OpenAI Moderations endpoint at `index.ts:52` (`api.openai.com/v1/moderations`), **fail-open** if key missing (`index.ts:44-47`) | **KEEP — LIVE** |
| 2 | `generate-ai-summary` | OPENAI | **NONE.** Zero `invoke`/`functions/v1` callers in app-mobile, mingla-business, mingla-admin, or any edge fn. Only doc/report mentions in `Mingla_Artifacts/`. | OpenAI at `index.ts:189` (only reached if invoked — it isn't) | **DELETE-SAFE — DEAD/ORPHANED** |
| 3 | `ai-reason` | OPENAI | **NONE.** Zero code refs anywhere. (The migration hits for `ai_reason`/`ai_reasoning` are **DB columns** in `place_pool`/RPC return types — unrelated to this edge fn.) | OpenAI at `index.ts:17` (unreachable) | **DELETE-SAFE — DEAD/ORPHANED** |
| 4 | `generate-curated-experiences` | OPENAI | **MANY (live).** Consumer service `app-mobile/src/services/curatedExperiencesService.ts:53,70` (`trackedInvoke`); edge→edge `supabase/functions/discover-cards/index.ts:894` (`fetch …/functions/v1/generate-curated-experiences`, the curated/picnic deck path); `supabase/functions/_shared/personHeroCards.ts:657` (`fetch …/v1/generate-curated-experiences`); kept hot in `supabase/functions/keep-warm/index.ts:13` | **YES (partial)** — Gemini Q2 reasoning slice (META-ORCH-1009 Sub-B, `index.ts:807`) **plus** OpenAI for picnic shopping-list + descriptions at `index.ts:1453/1512/1546` (`api.openai.com/v1/chat/completions`); falls back to `PICNIC_STATIC_SHOPPING_LIST` / static when no key (`index.ts:1436/1496/1530`) | **KEEP — LIVE** |
| 5 | `generate-holiday-categories` | OPENAI | `app-mobile/src/services/holidayCategoryService.ts:24` (`fetch …/functions/v1/generate-holiday-categories`) → `useHolidayCategories.ts:64,108` → `PersonHolidayView.tsx:593,678` (holiday category sections in the app) | **YES** — OpenAI at `index.ts:102` (`api.openai.com/v1/chat/completions`); fallback categories if no key (`index.ts:72-74`) | **KEEP — LIVE** |
| 6 | `score-place-photo-aesthetics` | ANTHROPIC | **NONE.** Only **comment** mentions (`admin-seed-places/index.ts:1043,1491`; `_shared/photoAestheticEnums.ts:4`; `run-place-intelligence-trial/index.ts:229`). No `invoke`, no `functions/v1`, no cron, no pg_net. | n/a (unreachable) | **DELETE-SAFE — DEAD/ORPHANED** |

### What replaced the dead Anthropic photo-scorer

Photo-aesthetic scoring is now owned by **`run-place-intelligence-trial`** on **Gemini 2.5 Flash** (DEC-101 / ORCH-0733). Evidence in `supabase/functions/run-place-intelligence-trial/index.ts`:
- `GEMINI_MODEL_ID = "gemini-2.5-flash"` (line 69); `GEMINI_API_URL = …generativelanguage.googleapis.com…` (line 71-72).
- Lines 58-59, 95: *"vs Anthropic baseline … Gemini 2.5 Flash matched quality at −71% cost … Gemini-only locked"*, *"Gemini 2.5 Flash is now the sole provider per DEC-101."*
- This function (and `run-signal-scorer`) are the only AI-scoring edge fns invoked from migrations/cron: `grep` of `supabase/migrations/` for `functions/v1/*` yields `run-place-intelligence-trial` + `run-signal-scorer` (plus install/thumb/notify/marketing crons) — **none of the 6 audited functions appear in any migration/cron.**

### Cron / dispatcher / keep-warm cross-check
- **keep-warm** (`supabase/functions/keep-warm/index.ts`) lists `discover-cards`, `generate-curated-experiences`, `get-person-hero-cards` only. Its own header comment (line 10) says *"generate-curated-experiences are the surviving hot paths."* None of the 3 dead fns are warmed.
- **No `_shared` dispatcher** routes to any of the 6.
- **No pg_cron / pg_net** migration invokes any of the 6 (verified by `functions/v1/` extraction over `supabase/migrations/`).

### Verdict — safe to delete vs must keep

**SAFE TO DELETE (code + their effect on secrets):**
1. `supabase/functions/generate-ai-summary/` — zero invokers.
2. `supabase/functions/ai-reason/` — zero invokers.
3. `supabase/functions/score-place-photo-aesthetics/` — zero invokers; superseded by Gemini `run-place-intelligence-trial`.

**MUST KEEP (live, invoked, user-facing — deleting breaks features):**
4. `moderate-content` — UGC safety on DMs / profile bios / board messages (3 live call sites). Deleting silently disables moderation.
5. `generate-curated-experiences` — curated/picnic deck (consumer + discover-cards + person-hero + keep-warm).
6. `generate-holiday-categories` — holiday category sections in `PersonHolidayView`.

**Secrets verdict:**
- **`ANTHROPIC_API_KEY` — DELETE-SAFE.** Sole consumer `score-place-photo-aesthetics` is orphaned; the live replacement uses Gemini (`GOOGLE_AI`/Gemini key), not Anthropic.
- **`OPENAI_API_KEY` — DO NOT DELETE.** Three LIVE functions read+use it: `moderate-content` (OpenAI Moderations), `generate-curated-experiences` (picnic list + descriptions), `generate-holiday-categories` (category generation). All three degrade gracefully (fail-open / static fallback) if the key is removed, but removing it **silently disables real OpenAI behavior** on shipped paths — that is a functional regression, not dead-code cleanup. If the intent is to migrate these 3 off OpenAI onto the Gemini pipeline, that is a separate ORCH (code change), not a key-deletion.

> ⚠️ Caveat: the operator's premise ("OpenAI/Anthropic are deprecated, replaced by the intelligence trial") is **only true for the Anthropic photo-scorer**. The intelligence-trial/Gemini pipeline replaced **photo-aesthetic + signal scoring** — it did **not** replace UGC moderation, curated-experience descriptions/picnic lists, or holiday categories. Those still ride OpenAI.

---

## ═══ INVESTIGATION 2: real published URL of the email logo ═══

### Answer (ranked)

| Rank | Candidate URL | curl -sI result | Evidence it's the real one |
|------|---------------|-----------------|----------------------------|
| **1 ✅** | `https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/App%20Stuff/mingla_official_logo.png` | **HTTP 200**, `content-type: image/png`, `content-length: 29762`, `last-modified: Mon, 11 May 2026 18:16:44 GMT`, `etag "75a9f8a984dc58e2132796e424d8223f"` | Real PNG in the **public `App Stuff` bucket** (`storage.buckets.public = true`). Object `mingla_official_logo.png`, uploaded **2026-05-11** — the exact day ORCH-0785 email branding shipped + the logo-publish launch op was filed. Same filename ships in-repo as `app-mobile/assets/mingla_official_logo.png` + `mingla-business/assets/mingla_official_logo.png`. The render-image endpoint also serves it 200. This is the only logo asset in any public Storage bucket. |
| 2 ❌ | `https://usemingla.com/email-assets/mingla-logo.png` (code's hardcoded fallback) | **HTTP 404** (Vercel 404 page) | This is the *test/default* fallback baked into `_shared/email/index.ts:57`, `_shared/marketingEmailRender.ts:188`, `_shared/email/tripConfirmationEmail.ts:138`, `invite-brand-member/index.ts:196`. ORCH-0785 listed "publish logo at usemingla.com/email-assets/" as an **operator launch op that was never done** → 404. Confirms operator's claim. |
| 3 ❌ | Cloudinary `res.cloudinary.com/dhza7d54o/image/upload/{mingla-logo,mingla_official_logo,logo}.png` | **HTTP 404** (all variants) | No logo asset in the `dhza7d54o` Cloudinary cloud. Cloudinary here is used only for **event cover video** (`event-cover-video-upload-intent`), not the email logo. |

### How the live render resolves to #1
- `MINGLA_LOGO_URL` is read in: `_shared/email/index.ts:55` (required in prod, throws `email_env_missing:MINGLA_LOGO_URL` if unset), `_shared/marketingEmailRender.ts:187`, `ticket-confirmation-dispatch/index.ts:62/929`, `ticket-pdf-fetch/index.ts:24/139`, `invite-brand-member/index.ts:580`, `_shared/email/tripConfirmationEmail.ts:136`.
- The hardcoded `usemingla.com` string is **only the no-env fallback** (and only used under `DENO_TESTING=1` in `_shared/email/index.ts`). Since emails currently render the logo, the dev **`MINGLA_LOGO_URL` secret is set to the Storage URL in #1** (hashed in the secrets API, but its target is the only live logo image that exists).
- Git history has no committed `MINGLA_LOGO_URL=<value>`; only the doc/runbook references to the (never-published) usemingla.com path. The truth lives in the Supabase function secret, pointing at Storage.

### Recommended action for the logo
- **If keeping the current behavior:** nothing to do — `MINGLA_LOGO_URL` already points at the live Storage PNG (#1). Treat **#1 as canonical** and update any doc/runbook still claiming `usemingla.com/email-assets/`.
- **Optional hardening:** change the code fallback in the 4 files above from the dead `usemingla.com/email-assets/mingla-logo.png` to the live Storage URL #1, so a missing secret degrades to a working image instead of a 404. (Code change — out of scope for this read-only investigation; flag as a follow-up.)
- Note: bucket name `App Stuff` contains a space → URL **must** encode it as `App%20Stuff`. A path written with a literal space will 404.

---

## Evidence appendix (commands run)
- Invocation sweep: `grep -rn '<fn>'` across `app-mobile mingla-business mingla-admin supabase/functions` (excluding each fn's own dir + `node_modules` + `Mingla_Artifacts` docs) for all 6 names + camel/snake variants + `functions/v1/<fn>`.
- Migration/cron sweep: `grep -roE 'functions/v1/[a-z-]+' supabase/migrations/` → only install/thumb/notify/marketing/booking/installment + `run-place-intelligence-trial` + `run-signal-scorer`. None of the 6.
- Provider-in-fn checks: `grep -niE 'OPENAI|gemini|anthropic'` inside each fn's `index.ts`.
- Storage: MCP `execute_sql` on `storage.objects`/`storage.buckets` (project `gqnoajqerqhnvulmnyvv`).
- Live checks: `curl -sI` on all 3 logo candidates (#1 → 200; #2,#3 → 404).
