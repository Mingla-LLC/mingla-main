# META-ORCH-1270 — Vector D: Config / Monitoring / Blast-Radius / Cutover

**Phase:** INVESTIGATE (read-only static audit). **No code changed.**
**Scope:** Where Cloudinary credentials live, whether any secret leaks into a client bundle, the blast radius of the account deletion, WHY the existing usage monitor did not page Seth before the account died (twice), and the exact ordered steps to cut over to the new account without a third kill.

**Cloud name (dead):** `dhza7d54o` — FREE plan, DELETED by Cloudinary for exceeding usage.

---

## Headline answers

- **Secret in a client bundle?** NO. `CLOUDINARY_API_SECRET` appears ONLY in Supabase edge-function env reads (`Deno.env.get`) — never in any app/marketing/admin bundle. The cloud name `dhza7d54o` is NOT hardcoded in any shipped client code (only in a test fixture and historical report `.md` files).
- **Does the usage monitor actually ALERT?** A WORKING alert path EXISTS on paper (an 80%-used "balance low" email + a 100%-used "DOWN" email, hourly, to `seth@usemingla.com` via Resend). BUT it is gated behind a chain of ~7 silent-failure conditions, any one of which suppresses the alert while the dashboard still shows GREEN. The single most fragile link — Cloudinary's free-plan `/usage` response must contain a numeric `credits.used_percent` — is unproven and is the prime "why it recurred" suspect. There is NO push/SMS/Slack path; email is the only channel.
- **Cutover blast:** the key-swap is a Supabase-secrets update only. NO client app build is required to cut over (no literal cloud name in shipped code). Existing stored delivery URLs remain dead (they embed `dhza7d54o`), but prod DB was wiped 2026-06-22 so live rows are expected to be near-zero.

---

## 1. WHERE the cloud name / API key / secret are configured

### 1a. The only live credential consumers — Supabase edge-function env vars

All three secrets are read from `Deno.env` (Supabase project secrets), never hardcoded:

- `supabase/functions/event-cover-video-upload-intent/index.ts:300-301` — reads `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY`; the upload signature uses the SECRET via `cloudinarySignature` (below). Needs all THREE.
- `supabase/functions/event-cover-video-webhook/index.ts:61` — reads `CLOUDINARY_API_SECRET` (verifies Cloudinary's eager-processing callback signature). Needs the SECRET.
- `supabase/functions/_shared/eventCoverVideo.ts:252-254` (`providerConfigured`), `:267` (`cloudinarySignature` reads SECRET), `:287-288` + `:306` (`cloudinaryDestroy` reads CLOUD_NAME + API_KEY, signs with SECRET, POSTs to `.../video/destroy`). Used by webhook + cancel. Needs all THREE.
- `supabase/functions/event-cover-video-cancel/index.ts:96` — calls `cloudinaryDestroy` (inherits all THREE via the shared helper).
- `supabase/functions/api-health-probe/index.ts:439-441` — reads all THREE for the `/usage` probe (§3). Needs all THREE.

Because Supabase secrets are per-PROJECT (shared across every function in the project), setting the three secrets once covers all five consumers. No per-function config exists.

### 1b. Is the API SECRET exposed in a client bundle? NO — proven

- `grep` for `CLOUDINARY_API_SECRET` across the entire repo returns ONLY `Deno.env.get(...)` reads inside `supabase/functions/**` plus test files that `Deno.env.set` a dummy `"secret"`. Zero occurrences in `app-mobile/`, `mingla-business/`, `mingla-marketing/`, or `mingla-admin/`.
- The signature is computed **server-side** in the edge function (`eventCoverVideo.ts:267` `sha1Hex(base + secret)`); only the resulting signature — never the secret — is returned to the client.

### 1c. The API KEY does reach the client — by design, and is NOT a bundle leak

`event-cover-video-upload-intent/index.ts:376` returns `api_key: apiKey` inside the upload-intent HTTP response, and `:371` returns the upload URL `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`. This is the standard Cloudinary **signed-upload** pattern: the API key is public, the browser POSTs the file directly to Cloudinary with `api_key` + `signature`, and the secret never leaves the server. The key is fetched at RUNTIME from the edge function per upload — it is NOT baked into any app bundle at build time. Action: none required; this is safe. (When the key rotates, the new key flows through automatically because it comes from the edge env, not the bundle.)

### 1d. Cloud name / delivery-URL occurrences of `dhza7d54o` (exhaustive)

Nine total, all non-shipping:

- `supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts:23,28` — test fixture (a captured webhook payload). Not shipped, cosmetic.
- 7 `.md` files under `Mingla_Artifacts/reports/` + `WORLD_MAP.md` — historical documentation.

Zero occurrences in any client/marketing/admin source. Confirmed by `grep -rn "dhza7d54o"` (excluding node_modules/.git). The only client-side "cloudinary" references are: a comment in `app-mobile/src/utils/videoUrl.ts:22`, a comment in `app-mobile/src/components/SwipeableCards.tsx:333`, and legal boilerplate naming Cloudinary as a subprocessor in `mingla-marketing/lib/termsContent.ts:91` + `privacyContent.ts:100,133`. None carry a cloud name or key.

### 1e. Where the WARN/CRIT thresholds live (config, not credentials)

- DB-driven: `api_health_services.depletion_signal.balance = {kind:'cloudinary_used_pct', warn:80, crit:100}`, seeded by migration `supabase/migrations/20261121000000_orch_1201_r2_api_health_classes.sql:56-61`.
- Env override (only when the DB warn is null): `API_HEALTH_CLOUDINARY_WARN_PCT` (default 80) / `API_HEALTH_CLOUDINARY_CRIT_PCT` (default 100), `api-health-probe/index.ts:1129`.
- Alert recipients: `API_HEALTH_ALERT_EMAILS` (default `seth@usemingla.com`), `api-health-probe/index.ts:78-79`.

**No `.env` / `app.config.ts` / `vercel.json` / EAS config anywhere sets a Cloudinary cloud name or key.** Verified against `app-mobile/.env.example`, `mingla-marketing/.env.example`, `mingla-business/.env(.example)`, all `app.config.ts`, both `vercel.json`, all `eas.json` — none reference Cloudinary.

---

## 2. Blast radius of the deletion

- **No hardcoded/seeded delivery URLs in shipped code.** `grep` for `res.cloudinary.com` across `supabase/migrations/` returns nothing; across app/marketing source returns nothing (only the `status.cloudinary.com` STATUS feed and `api.cloudinary.com` API host, which are Cloudinary infra, not the dead cloud). No mock/seed/marketing asset points at `dhza7d54o`.
- **What is actually dead:** every fully-qualified delivery URL that was stored in the database at upload time — `events.cover_media_url`, brand cover URLs, and any `event_cover_video_jobs.processed_url` / `provider_payload` — because each embeds the literal `https://res.cloudinary.com/dhza7d54o/...` path returned by the (now-deleted) account. The client renders whatever string the DB holds, so those rows now render broken video/poster and fall through to the placeholder (`EventCoverMedia` `onError` → `EventCover` placeholder).
- **Live-row count (static estimate): near-zero.** Prod DB was wiped of ALL test data 2026-06-22 (MEMORY). Any cover uploaded AFTER the wipe and BEFORE the account death is dead; anything from before the wipe is already gone. Exact count requires a live `SELECT count(*) FROM events WHERE cover_media_url ILIKE '%dhza7d54o%'` (+ the brand/jobs tables) — recommended as the first cutover step so the true user-visible breakage is quantified rather than assumed.
- **New uploads after cutover self-heal** — they will carry the NEW cloud name (it comes from `CLOUDINARY_CLOUD_NAME` env at upload time). Old rows do NOT self-heal: the dead cloud name is baked into their stored URL. They need either re-upload or a one-time DB string-rewrite (only worthwhile if the live-count query finds meaningful rows).

---

## 3. THE MONITORING FAILURE — why it recurred (core finding)

### 3a. The alert path EXISTS and is fully wired

Tracing the chain end to end:

1. **Cron:** `supabase/migrations/20261120000000_orch_1201_api_health_hub.sql:233-247` schedules `orch_1201_api_health_probe` at `0 * * * *` (HOURLY) via `pg_cron` + `pg_net.http_post` to `/functions/v1/api-health-probe`.
2. **Probe:** `api-health-probe/index.ts:438-472` `probeCloudinary()` GETs `https://api.cloudinary.com/v1_1/{cloud}/usage`, reads `credits.used_percent` into `detail.used_percent`; sets synthetic status `down` iff `used_percent >= 100` (`:460`), else `healthy`.
3. **Balance eval:** `evaluateBalance` (`index.ts:1111-1133`) → `evaluateBalanceForSignal` (`logic.ts:356-363`, kind `cloudinary_used_pct`): `balanceLow = used_percent >= warn(80)`, severity `crit` at `>=100`.
4. **State machine:** `runAlertStateMachine` (`index.ts:559-675`) → `decideBalanceTransition` fires a ONE-SHOT `sendLowBalanceAlert` on the ok→low transition (i.e., first time it crosses 80%), re-alerting at most every 24h.
5. **Delivery:** `trySend("balance_low", "💳 [API HEALTH] Cloudinary balance low", ...)` → `sendOpsAlertEmail` (`_shared/stripeOpsAlertEmail.ts:37`) → Resend email to `seth@usemingla.com`.

So on paper Seth SHOULD have received a "Cloudinary balance low" email at 80% used, an hour or more before deletion. **Channel is email-only — there is no push, SMS, or Slack path anywhere in the probe.**

### 3b. Why it (very likely) never fired — seven silent-failure dependencies

Every one of these must hold for the 80% email to send; ANY single break suppresses the alert AND leaves the admin dot GREEN (no visible symptom). This is the recurrence mechanism:

1. **`credits.used_percent` must be a NUMBER in the free-plan `/usage` response (PRIME SUSPECT).** `probeCloudinary` (`:457`) uses a strict `typeof === "number"` guard; if absent → `null`. `evaluateBalanceForSignal` (`logic.ts:357-358`): `if (used == null ...) return {balanceLow: null}` → NO alert, and the synthetic status stays `healthy` (green). Cloudinary's free tier meters storage / bandwidth / transformations / objects as SEPARATE blocks and the single `credits.used_percent` field may be absent, zero, or not track the metric that actually triggered suspension. If so, the monitor watches a number that never trips while the real cap is breached. **Must be verified against a live `/usage` response from the NEW account before trusting the monitor.**
2. **All THREE `CLOUDINARY_*` secrets must be present in the probe's env.** Missing any → `:442-443` returns status `unknown` + `"CLOUDINARY_* missing"`, no `used_percent`, no alert.
3. **Both migrations must be applied to LIVE prod (`gqnoajqerqhnvulmnyvv`).** If `20261121...r2` did not apply, `depletion_signal.balance.kind` is absent; `evaluateBalance:1120` returns `{balanceLow:null}` (the env fallback at `:1127-1129` only fills a null WARN — it does NOT synthesize the `kind`, so a missing signal still yields no alert).
4. **Vault secrets `supabase_url` + `service_role_key` must exist.** The cron builds its target URL from `vault.decrypted_secrets` (`migration :238,240`); if either row is missing, `url := NULL || '/functions/...'` and the hourly probe never actually runs — no checks at all, silently.
5. **`api_health_alert_state` must have a seeded `cloudinary` row.** `runAlertStateMachine:578-579`: `if (!prev) continue` silently skips any service without a state row. (Seeded at `migration :114-116`; a DB wipe or a missed migration would drop it.)
6. **`RESEND_API_KEY` must be set and not sandbox.** `sendOpsAlertEmail:45-52`: missing key → logs a warning and returns WITHOUT sending; `assertNotResendSandbox` (`:68`) throws if the sender domain is a Resend sandbox.
7. **The DOWN/crit path is too late by design.** `decideAvailabilityTransitions:250` needs N=2 consecutive failed ticks (≈2 hours) AND synthetic `down` only appears at `used_percent >= 100` (`:460`). By 100% the free plan is already over-limit and subject to deletion, so only the 80% WARN email could have paged early — and that one is gated behind failure #1.

### 3c. Verdict

The monitor is NOT proven to have alerted. Statically there are multiple silent-null paths that compute a number nobody is paged about while showing green — consistent with an account dying twice with zero warning. The design intends to alert; the wiring is fragile and unverified end to end.

**Runtime verification to close this (needs live prod, read-only):**
- `SELECT * FROM cron.job WHERE jobname='orch_1201_api_health_probe';` — is it scheduled?
- `SELECT status, detail, checked_at FROM api_health_checks WHERE service_key='cloudinary' ORDER BY checked_at DESC LIMIT 50;` — did the probe ever run, and was `detail.used_percent` ever a non-null number?
- `SELECT * FROM api_health_alert_state WHERE service_key='cloudinary';` — does the row exist; did `last_balance_state`/`last_balance_alert_at` ever move?
- `SELECT name FROM vault.secrets WHERE name IN ('supabase_url','service_role_key');` — cron plumbing present?
- Confirm `CLOUDINARY_*` + `RESEND_API_KEY` are set on the api-health-probe function (Supabase secrets list).
- Also relevant: ORCH-1209's "fix" was WEB delivery bandwidth only (`IMPLEMENT_ORCH-1209.md` — "only ever fixed WEB video bandwidth ... zero backend"). It added NO account-level usage cap and did NOT touch the alert path, so the monitor gap survived the first death untouched.

---

## 4. Cutover checklist (ordered) — do NOT skip the guardrails

**Guardrail-first: items 1-4 must be TRUE before the new key goes live (item 5), so a third kill is impossible.**

1. **Quantify the blast radius (read-only, live prod).** `SELECT count(*) FROM events WHERE cover_media_url ILIKE '%dhza7d54o%';` plus the brand-cover and `event_cover_video_jobs` equivalents. Decide re-upload vs one-time URL rewrite based on the count (expected near-zero post-wipe).

2. **Prove the monitor can see the new account's usage.** Before wiring anything, hit the NEW account's `GET https://api.cloudinary.com/v1_1/{newCloud}/usage` with the new key/secret and confirm the JSON contains a numeric `credits.used_percent`. If it does NOT, the current probe is blind — the probe must be extended to also read the per-metric blocks (bandwidth/storage/transformations/objects) and alert on whichever is closest to its free-plan cap. This is the #1 leak-proofing prerequisite (fixes silent-failure #1).

3. **Verify the alert plumbing end to end (fixes silent-failures #2-#7).** Confirm on LIVE prod: cron `orch_1201_api_health_probe` scheduled; vault `supabase_url` + `service_role_key` present; `api_health_alert_state` has a `cloudinary` row; both api-health migrations applied; `RESEND_API_KEY` set and non-sandbox with a verified sender; `API_HEALTH_ALERT_EMAILS` includes Seth. Then force one probe run and confirm an `api_health_checks` cloudinary row lands with a numeric `used_percent`. Optionally lower `API_HEALTH_CLOUDINARY_WARN_PCT` (e.g. 50 or 60) to page far earlier given the tiny 25-credit free ceiling.

4. **Add a hard usage CAP / circuit-breaker (there is none today).** The upload path (`event-cover-video-upload-intent`) has only per-video duration/bitrate caps (`:143-171,311-321`) — NO account-level guard. Add a pre-upload gate that reads the latest `api_health_checks` cloudinary `used_percent` (or the live `/usage`) and refuses new upload intents above a hard threshold (e.g. 90%), failing closed with a user-facing "media temporarily unavailable". This makes it structurally impossible to blow past the cap regardless of whether the email fires. (Ideally pair with the Vector A/B/C fixes so delivery + transformation + storage stop feeding the meter.)

5. **Swap the secrets (the actual cutover — secrets only, NO app build).** Set on the LIVE prod project (`gqnoajqerqhnvulmnyvv`), NOT the DR clone:
   - `supabase secrets set CLOUDINARY_CLOUD_NAME=<new> CLOUDINARY_API_KEY=<new> CLOUDINARY_API_SECRET=<new> --project-ref gqnoajqerqhnvulmnyvv`
   - This single update covers all five consumers (upload-intent, webhook, cancel, shared helper, api-health-probe) because Supabase secrets are project-scoped.
   - **No code references the cloud name literally**, so no edge-function code change is needed and **no client app build / OTA is needed to cut over.** New uploads immediately use the new cloud.

6. **Re-deploy the edge functions that read the secrets** (so they pick up the new env if the runtime caches it): `event-cover-video-upload-intent`, `event-cover-video-webhook`, `event-cover-video-cancel`, `api-health-probe`. Verify with one live call each (upload-intent returns the new `upload.url` host; api-health-probe returns a cloudinary check row).

7. **Confirm the NEW cloud's webhook/notification URL is reachable** — the upload sets `eager_notification_url` to `${SUPABASE_URL}/functions/v1/event-cover-video-webhook` (`upload-intent:322-323`); no Cloudinary-side console config is needed (it is passed per-upload), but confirm the webhook still verifies signatures against the NEW secret.

8. **The `preload=none` leak-proofing is WEB-only and ships without an app-store build.** The bandwidth gate (`packages/offering-rendering/EventCoverMedia.tsx:243` `video.preload = "none"`) lives on the DOM `<video>` path (web bundles → Vercel/web export). It needs NO native build. The NATIVE poster/lazy gate from ORCH-1209 (FIX 3 native, same file) is pure JS but "shipped DARK" (never delivered to installed apps) — it reaches existing installs only via an EAS OTA update (no native module changed) or the next native build. That native gate is Vector A's leak-proofing, NOT a cutover blocker: the key-swap itself is complete after step 6.

9. **Backfill/repair dead rows (only if step 1 found meaningful counts).** Either re-upload the affected covers or run a one-time DB rewrite swapping `dhza7d54o` → `<new cloud>` in stored URLs — only valid if the underlying assets were migrated to the new account (they were NOT, since the old account is deleted), so in practice this means RE-UPLOAD, not string-swap. Given the 2026-06-22 wipe, likely a no-op.

**Bottom line:** the cutover is a 3-secret update + 4 function redeploys; it requires no client build. The real work is the guardrails (steps 2-4) — a usage-aware alert that actually pages, plus a hard pre-upload cap — which must land BEFORE the new key so the account cannot be killed a third time.
