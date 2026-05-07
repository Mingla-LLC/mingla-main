# Mingla — Complete Environment Setup (All Domains)

**Purpose:** everything needed to set up a new dev machine (Mac, Linux, Windows) so the entire Mingla stack works locally + can deploy/test against the live Supabase project. Hand this to a fresh Claude session and it can replicate your environment.

**Last verified:** 2026-05-07
**Project ref:** `gqnoajqerqhnvulmnyvv` (a.k.a. "Mingla-dev" — but per [DEC-024](../Mingla_Artifacts/DECISION_LOG.md), this single Supabase project IS production. There is no separate prod environment.)

---

## 1. The Big Picture — Where Each Secret Lives

Mingla has **four config layers**. Knowing which is which prevents 90% of "but it works on the old machine" bugs.

| Layer | Where stored | When read | Who manages | In git? |
|-------|--------------|-----------|-------------|---------|
| **Supabase Edge Function secrets** | Supabase Dashboard → Edge Functions → Secrets | At edge fn runtime (`Deno.env.get(...)`) | Supabase team / operator via dashboard or `supabase secrets set` | NO — server-side |
| **Supabase Vault** | Postgres extension `vault.secrets` | Inside Postgres / pg_cron triggers | Operator via SQL `vault.create_secret(...)` | NO — DB-side |
| **Local `.env` per app** | `app-mobile/.env`, `mingla-business/.env`, `mingla-admin/.env`, `mingla-admin/.env.local` | At `npm start` / `expo start` / `vite dev` (build time + runtime via `process.env.X`) | You per machine | NO — gitignored |
| **EAS Secrets** | Expo / EAS Build cloud | At cloud build time (`eas build`) | Operator via `eas secret:create` / EAS dashboard | NO — managed by EAS |
| **Hardcoded fallbacks in `app.config.ts`** | `app-mobile/app.config.ts`, `mingla-business/app.config.ts` | At build time via `process.env.X ?? "fallback"` | Lives in source | YES — committed |

**Heuristic:**
- If it's in a `Deno.env.get(...)` call → it's a Supabase Edge Function secret.
- If it's `process.env.EXPO_PUBLIC_X` in mobile → it's in `.env` locally + EAS Secret in cloud builds.
- If it's `import.meta.env.VITE_X` → it's in `mingla-admin/.env`.
- If it's `vault.decrypted_secrets` lookup in SQL → it's a Vault secret.

---

## 2. Domain Map

```
mingla-main/
├── app-mobile/           ← consumer iOS/Android (React Native + Expo)
├── mingla-business/      ← business operator iOS/Android (React Native + Expo)
├── mingla-admin/         ← internal admin web dashboard (React + Vite)
└── supabase/
    ├── functions/        ← 72 Deno edge functions (shared backend)
    ├── migrations/       ← 293+ Postgres migrations
    └── config.toml       ← edge fn config (verify_jwt, etc.)
```

All 4 domains read from the SAME Supabase project. Same database. Same auth users. Same edge functions. Different frontends.

---

## 3. Supabase Edge Function Secrets (Backend — most important)

These are read by Deno code via `Deno.env.get("X")`. They live ONLY on the Supabase server side. **You do NOT need them locally** unless you're running `supabase functions serve` locally (rare).

### How to set / update

```bash
# Option A — CLI (preferred for code-as-config)
supabase secrets set SECRET_NAME=value --project-ref gqnoajqerqhnvulmnyvv

# Option B — Dashboard
# Go to: https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions/secrets
# Click "Add new secret"
```

### How to verify what's set

```bash
supabase secrets list --project-ref gqnoajqerqhnvulmnyvv
# Lists names only (values redacted — by design)
```

### Complete list of Edge Function secrets in active use

| Secret Name | Used By (edge functions) | Purpose | How to obtain |
|-------------|--------------------------|---------|---------------|
| `SUPABASE_URL` | ALL functions | Self-reference for cross-fn calls | **Auto-set by Supabase** — do NOT manually set |
| `SUPABASE_ANON_KEY` | ALL functions | Anon-key client for user-scoped queries | **Auto-set by Supabase** |
| `SUPABASE_SERVICE_ROLE_KEY` | ALL functions | Service-role client for RLS-bypass operations | **Auto-set by Supabase** |
| `GOOGLE_MAPS_API_KEY` | `admin-seed-places`, `admin-refresh-places`, `admin-place-search`, `backfill-place-photos`, `get-companion-stops`, `get-picnic-grocery` | Google Places v1 API + Distance Matrix + Photos API | Google Cloud Console → APIs & Services → Credentials → enable Places API + Distance Matrix |
| `OPENAI_API_KEY` | `ai-reason`, `generate-holiday-categories` | GPT-4o-mini for card validation + holiday categorization | platform.openai.com → API keys |
| `ANTHROPIC_API_KEY` | `score-place-photo-aesthetics` (still active) | Claude Haiku 4.5 vision for photo aesthetic scoring. **NOTE:** dropped from `run-place-intelligence-trial` per ORCH-0733/DEC-101 but still used elsewhere | console.anthropic.com → API keys |
| `GEMINI_API_KEY` | `run-place-intelligence-trial` (sole vision provider post-DEC-101) | Gemini 2.5 Flash vision for place intelligence | aistudio.google.com → Get API key |
| `SERPER_API_KEY` | `run-place-intelligence-trial` (action: `fetch_reviews`) | Serper.dev Google reviews scraper | serper.dev → API key |
| `RESEND_API_KEY` | `admin-send-email`, friend/pair email senders | Transactional email | resend.com → API keys |
| `TICKETMASTER_API_KEY` | `ticketmaster-events` | Event discovery | developer.ticketmaster.com |
| `EVENTBRITE_TOKEN` | `events` | Event discovery (alternative to TM) | eventbrite.com → API user keys |
| `OPENWEATHER_API_KEY` | `weather` | Current weather + forecast for cards | openweathermap.org → API keys |
| `TWILIO_ACCOUNT_SID` | `send-otp`, `verify-otp`, `send-pair-request`, `send-phone-invite` | Twilio account ID | twilio.com console |
| `TWILIO_AUTH_TOKEN` | same as above | Twilio auth | twilio.com console |
| `TWILIO_VERIFY_SERVICE_SID` | `send-otp`, `verify-otp` | Twilio Verify service for SMS OTP | twilio.com → Verify → Services |
| `TWILIO_MESSAGING_SERVICE_SID` | `send-phone-invite` | Twilio Messaging service for invites | twilio.com → Messaging → Services |
| `TWILIO_FROM_PHONE` / `TWILIO_FROM_NUMBER` | `send-phone-invite`, `send-pair-request` | Sender phone number | twilio.com → Phone Numbers |
| `ONESIGNAL_APP_ID` | `_shared/push-utils.ts` (used by 12+ notify-* functions) | OneSignal push app ID | onesignal.com → Settings → Keys & IDs |
| `ONESIGNAL_REST_API_KEY` | `_shared/push-utils.ts` | OneSignal REST API key | onesignal.com → Settings → Keys & IDs |
| `STRIPE_SECRET_KEY` | `_shared/stripe.ts` (used by `brand-stripe-onboard`, `brand-stripe-refresh-status`, `stripe-webhook`) | Stripe API key. **Test mode** during dev (per DEC-112: Express Connect + DEC-114: Marketplace platform model) | dashboard.stripe.com → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Webhook signature verification | dashboard.stripe.com → Developers → Webhooks → endpoint signing secret |
| `DISABLE_PHOTO_URL_TRANSFORM` | `_shared/imageCollage.ts` | **ORCH-0737 v6 kill-switch.** Set to `"true"` to revert to native-resolution photo decode without redeploy. Leave UNSET (or `"false"`) for normal v6 operation. | Set only if v6 photo URL transforms break |

### What `Deno.env.get()` returns vs what I see in `supabase secrets list`

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` won't appear in `supabase secrets list` because they're auto-injected by the Supabase runtime. Everything else above will (or should) appear.

---

## 4. Supabase Vault (DB-side secret)

Vault is the encrypted secrets store inside Postgres. Used by triggers / pg_cron functions that can't reach env vars.

### Currently active

| Secret Name | Used By | Purpose |
|-------------|---------|---------|
| `service_role_key` | `tg_kick_pending_trial_runs()` trigger function (ORCH-0737 cron) | Lets the pg_cron job authenticate when calling the worker edge fn via `pg_net.http_post` |

### How to set / verify

```sql
-- Verify
SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') AS vault_ready;

-- Set (operator does this, requires service-role auth)
SELECT vault.create_secret('eyJ...', 'service_role_key');

-- Update existing
SELECT vault.update_secret(
  (SELECT id FROM vault.secrets WHERE name = 'service_role_key'),
  'eyJ...'
);
```

The secret VALUE is a Supabase service-role JWT. Get it from:
- Supabase Dashboard → Project Settings → API → `service_role` key (the long `eyJ...` one — NOT the publishable key)

---

## 5. `app-mobile/` Environment (Consumer App)

### Local `.env` (gitignored — must create per machine)

Path: `app-mobile/.env`

```bash
# Supabase — copy from Dashboard → Project Settings → API
EXPO_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # the "anon public" key (NOT service_role)

# Mapbox — Directions API for travel time + traffic
# mapbox.com → Account → Tokens → public token (`pk.eyJ...`)
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.eyJ...

# Mixpanel — behavioral analytics (optional; analytics disabled if unset)
# mixpanel.com → Project Settings → Access Keys → Project Token
EXPO_PUBLIC_MIXPANEL_TOKEN=...

# Google Maps — for native iOS/Android map SDK (NOT the same as edge fn key, but
# can share if you allow client-side use; recommend separate restricted key)
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...

# Google OAuth client IDs (these are NOT secrets — they're public IDs;
# kept in .env for per-environment override)
GOOGLE_WEB_CLIENT_ID=169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=169132274606-k622epnsdbthemkatrctjpadcke6un46.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=169132274606-ibip7eu1oq892ilolnfjarqefn1d65as.apps.googleusercontent.com

# Optional booking integrations (disabled if unset; bookingService gracefully no-ops)
EXPO_PUBLIC_OPENTABLE_API_KEY=
EXPO_PUBLIC_EVENTBRITE_API_KEY=
EXPO_PUBLIC_VIATOR_API_KEY=
```

### Native config files (committed but not secrets)

| File | Purpose |
|------|---------|
| `app-mobile/google-services.json` | Firebase / FCM Android push messaging config. Already committed. |
| `app-mobile/app.config.ts` | Expo app config — reads from `process.env` with hardcoded fallbacks |
| `app-mobile/eas.json` | EAS Build config (development / preview / production channels) |

### EAS Secrets (cloud build time)

For `eas build` to produce production builds, the EAS service needs the same env vars set as cloud secrets:

```bash
cd app-mobile
eas secret:list                                      # see what's already set
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://..."
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJ..."
eas secret:create --scope project --name EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN --value "pk..."
eas secret:create --scope project --name EXPO_PUBLIC_MIXPANEL_TOKEN --value "..."
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY --value "AIza..."
eas secret:create --scope project --name GOOGLE_WEB_CLIENT_ID --value "...apps.googleusercontent.com"
eas secret:create --scope project --name GOOGLE_IOS_CLIENT_ID --value "...apps.googleusercontent.com"
eas secret:create --scope project --name GOOGLE_ANDROID_CLIENT_ID --value "...apps.googleusercontent.com"
```

If you've already set these for the project on the OLD machine, they ARE on EAS cloud — no need to re-create from Mac unless they don't match local `.env`.

### Submit-time secrets

`app-mobile/eas.json` references `./play-service-account.json` for Android Play Store submission. This file is gitignored. Get it from:
- Google Play Console → Setup → API access → Service Accounts → JSON key

Place at `app-mobile/play-service-account.json` if you plan to `eas submit` from this machine.

---

## 6. `mingla-business/` Environment (Business Operator App)

### Local `.env` (gitignored)

Path: `mingla-business/.env`

```bash
# Supabase — same project as app-mobile
EXPO_PUBLIC_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Google Maps — needed because business app shows event maps + brand locations
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...

# Google OAuth — DIFFERENT client IDs from app-mobile (separate Google project entries)
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=169132274606-3o5ecs4kn9fag36sbm8hesgmgl5bgf5e.apps.googleusercontent.com
GOOGLE_WEB_CLIENT_ID=169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=169132274606-3o5ecs4kn9fag36sbm8hesgmgl5bgf5e.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=169132274606-5cmvk27gpgr9dbhu5l2o2hgg4l53fc25.apps.googleusercontent.com

# Optional weather + place-discovery for business event-planning UI
EXPO_PUBLIC_OPENWEATHER_API_KEY=...
EXPO_PUBLIC_FOURSQUARE_API_KEY=...

# Sentry — error tracking (optional in dev; required in prod)
# Get DSN from sentry.io → Settings → Projects → mingla-business → Client Keys (DSN)
EXPO_PUBLIC_SENTRY_DSN=https://...@o....ingest.sentry.io/...

# Stripe — Cycle B2a Stripe Connect onboarding (test mode during dev)
# Get from Stripe Dashboard → Developers → API keys → Publishable key (TEST mode)
# Format: pk_test_...
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_...
```

**IMPORTANT: Google Sign-In gotcha (per `mingla-business/.env.example` comments):**
- The Web Application Client ID (Web one) MUST be registered in Supabase Dashboard → Authentication → Providers → Google → Client IDs (comma-separated list, Web FIRST).
- The iOS Client ID must ALSO be in that list (after the Web).
- If any `aud` in an ID token is missing from that list, Supabase returns: `"Unacceptable audience in id_token"` and login fails.

### `mingla-business/app.config.ts` reads env at build time

Hardcoded fallbacks for OAuth IDs are committed in `app.config.ts` (lines 13-15, 72-90). They work for the current dev project — if you fork to a different Google project, override via `.env`.

### EAS Secrets

```bash
cd mingla-business
eas secret:list
# Set the same EXPO_PUBLIC_* vars as above for cloud builds
```

`eas.json` defines `SENTRY_DISABLE_AUTO_UPLOAD` per-channel:
- development / preview: `"true"` (don't upload sourcemaps)
- production: `"false"` (DO upload — needs Sentry auth token in EAS Secrets as `SENTRY_AUTH_TOKEN`)

If shipping prod builds, also set EAS secret `SENTRY_AUTH_TOKEN` (Sentry → Settings → Account → API → Auth Tokens, scope `project:releases`).

---

## 7. `mingla-admin/` Environment (Web Admin Dashboard)

### Local `.env` (gitignored)

Path: `mingla-admin/.env` AND/OR `mingla-admin/.env.local`

`.env.local` overrides `.env` and is the conventional Vite local-dev override file.

```bash
# Vite uses VITE_* prefix (NOT EXPO_PUBLIC_*) to expose vars to client code
VITE_SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

That's it. Admin reads ONLY these two. All admin features hit Supabase directly via the JS client; there are no third-party API keys in admin-side code.

### How admin authenticates

Admin uses 3-layer auth (per `mingla-admin/README.md`):
1. Email allowlist (`admin_users` table)
2. Password (Supabase auth)
3. OTP 2FA via Twilio (uses the `send-otp` / `verify-otp` edge fns; secrets live on backend)

You don't configure these on the admin side — they're enforced by the edge fns.

### Deploy

`mingla-admin` is a static Vite build:
```bash
cd mingla-admin
npm run build              # outputs to dist/
# Deploy dist/ to your host (Vercel / Netlify / Cloudflare Pages — wherever it lives now)
```

Whoever owns the admin host needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set as env vars in their deploy config.

---

## 8. Tooling Setup On Mac (one-time)

### 8.1 Install package managers

```bash
# Homebrew (Mac package manager)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 8.2 Install required tools

```bash
brew install jq                              # JSON parsing for SQL probe pack
brew install deno                            # Deno runtime — runs unit tests for shared edge fn helpers
brew install supabase/tap/supabase           # Supabase CLI
brew install gh                              # GitHub CLI (for PRs / repo auth)
brew install --cask 1password-cli            # OPTIONAL — secure secret transfer

# Node
brew install nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc
nvm install 20
nvm alias default 20

# Expo / EAS — installs as a global npm package
npm install -g eas-cli expo-cli
```

### 8.3 Authenticate

```bash
# GitHub
gh auth login                  # Or set up SSH key + add to GitHub

# Supabase CLI
supabase login                 # Opens browser; OK to grant
# Verify
supabase projects list
# Should show "Mingla-dev (gqnoajqerqhnvulmnyvv)"

# EAS / Expo
eas login                      # Opens browser
# Verify
eas whoami                     # Should print your Expo username
```

### 8.4 Pull repo

```bash
mkdir -p ~/dev
cd ~/dev
gh repo clone Mingla-LLC/mingla-main          # or `git clone https://...`
cd mingla-main
git checkout Seth                              # or main, depending on workstream
git pull origin Seth
```

### 8.5 Install dependencies per app

```bash
# Root (if any)
npm install 2>/dev/null

# Consumer mobile
cd app-mobile && npm install && cd ..

# Business mobile
cd mingla-business && npm install && cd ..

# Admin
cd mingla-admin && npm install && cd ..
```

---

## 9. Transferring Secrets From Windows → Mac (the actual values)

You have THREE categories of secrets to move:

### 9.1 Supabase Edge Function secrets — **ALREADY ON SERVER**, no transfer needed

These live on Supabase, not on your machine. Mac will use them automatically when calling deployed edge fns. Verify:

```bash
supabase secrets list --project-ref gqnoajqerqhnvulmnyvv
# You should see ~25 secrets listed (names only, values redacted)
```

If anything is missing (recent secrets added during a session might be missing if you were creating them locally only), see §3 for how to add.

### 9.2 Local `.env` files — **MUST transfer**

These have your local API keys (Mapbox, Mixpanel, etc.). They're gitignored. Choose ONE of:

**Option A: 1Password Secure Note (recommended)**
1. On Windows, copy each `.env` content into a 1Password Secure Note titled e.g. `mingla-app-mobile-env`
2. On Mac, open the Note, copy contents, paste into the same path

**Option B: AirDrop / encrypted Dropbox / encrypted USB**
1. Tar them up: `tar czf mingla-envs.tar.gz app-mobile/.env mingla-business/.env mingla-admin/.env mingla-admin/.env.local`
2. AirDrop or copy securely to Mac
3. `tar xzf mingla-envs.tar.gz` in repo root

**Option C: rebuild them by hand using §5, §6, §7 above as templates**
This is safest if the Windows .env contents are out of date.

### 9.3 Claude Code config — **MUST transfer (or recreate)**

Path on Windows: `C:\Users\user\.claude.json`
Path on Mac: `~/.claude.json`

Contains the Supabase Management API token used by every Claude session (read at `mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN`). Without it, the live SQL probe pack in the v6 handoff can't run.

**Option A: copy the file directly** (1Password / encrypted transfer)
**Option B: regenerate**
1. On Mac, run `claude` once (`brew install claude-code` if missing) to create `~/.claude.json`
2. Get a fresh Personal Access Token: dashboard → Account → Personal Access Tokens → Generate
3. Edit `~/.claude.json` and place the token under `.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN`

### 9.4 Project memory (Claude's institutional knowledge) — **OPTIONAL but useful**

Path on Windows: `C:\Users\user\.claude\projects\c--Users-user-Desktop-mingla-main\memory\`
Path on Mac: `~/.claude/projects/-Users-<you>-dev-mingla-main/memory/`

Contains all the `feedback_*.md`, `reference_*.md`, `project_*.md`, `user_*.md` and the `MEMORY.md` index. This is what makes Claude on Mac instantly know your preferences (no Co-Authored-By, sequential pacing, "diagnose first" workflow, etc.) and project-specific patterns.

```bash
# Copy via your secure transfer method, then on Mac:
mkdir -p ~/.claude/projects/-Users-<you>-dev-mingla-main/
cp -r /path/to/transfer/memory ~/.claude/projects/-Users-<you>-dev-mingla-main/
```

The exact directory name on Mac depends on your repo path with `/` replaced by `-`. Run `claude` once in the repo, it'll create the directory; then drop `memory/` into it.

---

## 10. Verifying Everything Works (end-to-end smoke)

After tooling + secrets are in place, run this checklist on Mac:

### 10.1 Supabase connectivity

```bash
TOKEN=$(jq -r '.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN' ~/.claude.json)
curl -sS -X POST "https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/database/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT count(*) FROM place_pool"}'
# Should print: [{"count":18560}] (or similar)
```

If 401: token expired — generate new PAT and update `~/.claude.json`.

### 10.2 Edge function deploy capability

```bash
cd ~/dev/mingla-main
supabase functions list --project-ref gqnoajqerqhnvulmnyvv
# Should print all 72 edge functions with versions
```

If "not logged in" → `supabase login` again.

### 10.3 Consumer mobile app starts

```bash
cd app-mobile
npx expo start --no-dev --no-minify
# Press `i` for iOS simulator OR `a` for Android emulator
# OR scan QR with Expo Go on physical device
# Should reach the welcome screen — login should work using EXPO_PUBLIC_SUPABASE_*
```

If "Supabase URL is not configured" or "ANON KEY missing" → `.env` not loaded correctly. Verify with:
```bash
cd app-mobile && cat .env | head
# Should show EXPO_PUBLIC_SUPABASE_URL etc.
```

### 10.4 Business mobile app starts

```bash
cd mingla-business
npx expo start
# Same as above. Apple Sign-In + Google Sign-In should both work.
```

### 10.5 Admin web app starts

```bash
cd mingla-admin
npm run dev
# Opens http://localhost:5173 (or similar)
# Login with admin credentials (must be in admin_users table on Supabase + you must
# pass the OTP 2FA via Twilio)
```

If "Supabase config missing" → `.env.local` not present. Copy `.env.example` → `.env.local` and fill.

### 10.6 Edge function deploy

```bash
# Trivial smoke — re-deploy the v6 worker without changes:
supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
# Should print "Deployed Function..." with new version number
```

If it fails, check:
1. `supabase login` is current
2. You have `developer` or higher role on the Supabase project

### 10.7 Unit test runner (Deno)

```bash
cd supabase/functions/_shared
deno test imageCollage.test.ts
# Should print "8 passed (8 of 8)"
```

If `transformPhotoUrlForTile` not exported → check that you pulled commit `497eaf59` or later.

### 10.8 EAS build readiness (optional)

```bash
cd app-mobile
eas build:list                 # see prior builds
eas build --platform ios --profile preview --non-interactive --dry-run  # would-build check
```

---

## 11. Common Gotchas (learned the hard way)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `supabase functions deploy` fails with "max_request_duration_seconds is not a valid key" | CLI version too old | `brew upgrade supabase`. Or remove that key from `supabase/config.toml` per [DEC-024 / ORCH-0737 v3 patch](../supabase/config.toml). Default 150s applies. |
| Mobile login "Unacceptable audience in id_token" | Google Web Client ID not in Supabase auth provider list | Supabase Dashboard → Auth → Providers → Google → add the Web client ID first, then iOS client ID. Comma-separated. |
| Edge fn 546 errors during full-city trial run | Memory exhausted from native-resolution photo decode | v6 fixed this via URL transforms; if regression, set Edge fn secret `DISABLE_PHOTO_URL_TRANSFORM=true` to revert |
| `vault.create_secret` fails with permission denied | Trying to call from anon-key client | Must be service-role authenticated. Use Supabase Dashboard SQL editor (logged in as you) OR call from edge fn with service-role |
| Push notifications not firing | OneSignal IDs missing from edge fn secrets | `supabase secrets set ONESIGNAL_APP_ID=... ONESIGNAL_REST_API_KEY=...` |
| Mobile build fails with "google-services.json missing" | The committed file got deleted | `git checkout HEAD -- app-mobile/google-services.json` |
| Stripe webhooks 400 on `whsec_...` mismatch | Webhook secret rotated in Stripe but edge fn secret stale | `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...` with the new value |
| `supabase secrets list` shows fewer than expected | Some secrets were set on a different project | Verify `--project-ref gqnoajqerqhnvulmnyvv` is correct |
| `EXPO_PUBLIC_*` var "is not set" warning at runtime | `.env` file location wrong (must be in app-specific subdir) OR Metro cache | Restart Metro: `npx expo start --clear` |
| Twilio OTP returns "Authenticate" error | TWILIO_VERIFY_SERVICE_SID wrong format (must start `VA...`) | Get correct Service SID from Twilio Console → Verify → Services |
| MCP supabase shows "0 tools" in `/mcp` | Known upstream MCP server bug | Per [`feedback_supabase_mcp_workaround.md`](~/.claude/projects/.../memory/), use the Management API direct SQL endpoint (jq + curl) |

---

## 12. Quick Reference — Where to Get Each Service Key

| Service | URL | What to grab | For which secret |
|---------|-----|--------------|------------------|
| Supabase | https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv | Settings → API | `SUPABASE_*` keys (auto-set), `service_role` for vault |
| Google Cloud | https://console.cloud.google.com | APIs & Services → Credentials | `GOOGLE_MAPS_API_KEY`, `GOOGLE_*_CLIENT_ID` |
| Anthropic | https://console.anthropic.com | API Keys | `ANTHROPIC_API_KEY` |
| Google AI Studio | https://aistudio.google.com/app/apikey | Get API key | `GEMINI_API_KEY` |
| OpenAI | https://platform.openai.com/api-keys | Create new secret key | `OPENAI_API_KEY` |
| Serper | https://serper.dev/api-key | Copy API key | `SERPER_API_KEY` |
| Resend | https://resend.com/api-keys | Create API key | `RESEND_API_KEY` |
| Twilio | https://console.twilio.com | Account SID + Auth Token + Verify Service + Messaging Service + Phone Numbers | `TWILIO_*` |
| OneSignal | https://app.onesignal.com → app → Settings → Keys & IDs | App ID + REST API Key | `ONESIGNAL_*` |
| Stripe | https://dashboard.stripe.com → Developers → API keys | Test/Live publishable + secret + webhook signing | `STRIPE_*` |
| Mapbox | https://account.mapbox.com → Access tokens | Public token (`pk.eyJ...`) | `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` |
| Mixpanel | https://mixpanel.com → Project Settings → Project Token | Project Token | `EXPO_PUBLIC_MIXPANEL_TOKEN` |
| OpenWeather | https://openweathermap.org/api | API keys | `OPENWEATHER_API_KEY` |
| Ticketmaster | https://developer.ticketmaster.com | My Apps → Consumer Key | `TICKETMASTER_API_KEY` |
| Eventbrite | https://www.eventbrite.com/platform/api | API user keys → Private Token | `EVENTBRITE_TOKEN` |
| Foursquare | https://foursquare.com/developers/apps | API key | `EXPO_PUBLIC_FOURSQUARE_API_KEY` |
| Sentry | https://sentry.io → Settings → Projects → Client Keys (DSN) | DSN | `EXPO_PUBLIC_SENTRY_DSN` |
| Expo / EAS | https://expo.dev | Account → Access Tokens | EAS auth (CLI handles via `eas login`) |
| GitHub | https://github.com → Settings → Developer settings → Personal access tokens | classic or fine-grained PAT | `gh auth login` flow |

---

## 13. What's NOT Needed (anti-checklist)

These confused me on past machine setups; documenting so you don't waste time:

- ❌ **`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as edge fn secrets you set manually** — Supabase auto-populates these. Setting manually breaks them.
- ❌ **A separate "production" Supabase project** — there isn't one. Mingla-dev IS production per DEC-024.
- ❌ **Apple Tap to Pay entitlement (`com.apple.developer.proximity-reader.payment.acceptance`)** — currently OMITTED per `mingla-business/app.config.ts:23-27`. Awaiting Apple approval. Re-add for Cycle 13 only.
- ❌ **`max_request_duration_seconds` in supabase/config.toml** — current CLI doesn't recognise it. Will fail deploy. Removed per ORCH-0737 v3 patch.
- ❌ **A `.env` at repo root** — there isn't one. Each app has its own. Don't put global secrets there.
- ❌ **Anthropic key for `run-place-intelligence-trial`** — Anthropic was dropped per ORCH-0733/DEC-101. Gemini is sole vision provider for that fn. (Anthropic still active for `score-place-photo-aesthetics`.)

---

## 14. The Test Suite (Mac-runnable verification)

After everything is set up, run this from the repo root to verify end-to-end:

```bash
#!/bin/bash
# Save as: scripts/verify-env.sh && chmod +x scripts/verify-env.sh

set -e
echo "=== 1. Tooling ==="
node --version && nvm current
npm --version
deno --version | head -1
supabase --version
eas --version
gh --version | head -1

echo
echo "=== 2. Local .env files ==="
test -f app-mobile/.env && echo "✓ app-mobile/.env" || echo "✗ MISSING app-mobile/.env"
test -f mingla-business/.env && echo "✓ mingla-business/.env" || echo "✗ MISSING mingla-business/.env"
test -f mingla-admin/.env -o -f mingla-admin/.env.local && echo "✓ mingla-admin/.env(.local)" || echo "✗ MISSING mingla-admin/.env"

echo
echo "=== 3. Claude config ==="
test -f ~/.claude.json && echo "✓ ~/.claude.json exists" || echo "✗ MISSING ~/.claude.json"
TOKEN=$(jq -r '.mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN' ~/.claude.json 2>/dev/null)
test -n "$TOKEN" && [ "$TOKEN" != "null" ] && echo "✓ Supabase Management API token present" || echo "✗ Token missing in .claude.json"

echo
echo "=== 4. Live Supabase SQL probe ==="
RESULT=$(curl -sS -X POST "https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/database/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT count(*) AS n FROM place_pool"}' 2>/dev/null)
echo "Result: $RESULT"
echo "$RESULT" | grep -q '"n":' && echo "✓ Live SQL probe works" || echo "✗ Probe failed (token issue?)"

echo
echo "=== 5. Supabase CLI auth ==="
supabase projects list 2>&1 | head -3

echo
echo "=== 6. Edge fn unit tests ==="
cd supabase/functions/_shared
deno test imageCollage.test.ts 2>&1 | tail -3
cd -

echo
echo "=== 7. Node deps installed ==="
test -d app-mobile/node_modules && echo "✓ app-mobile" || echo "✗ run: cd app-mobile && npm install"
test -d mingla-business/node_modules && echo "✓ mingla-business" || echo "✗ run: cd mingla-business && npm install"
test -d mingla-admin/node_modules && echo "✓ mingla-admin" || echo "✗ run: cd mingla-admin && npm install"

echo
echo "=== Done. ==="
```

Run: `bash scripts/verify-env.sh`. If all checks ✓, you're operational.

---

## 15. Index — Files Reference

Pointers to the source-of-truth files in the repo for everything above:

| What | File |
|------|------|
| Edge fn secrets used | grep `Deno.env.get` across `supabase/functions/` |
| Edge fn JWT verify config | `supabase/config.toml` |
| Mobile env example | `app-mobile/.env.example` |
| Business env example | `mingla-business/.env.example` (also `mingla-business/env.example`) |
| Mobile build config | `app-mobile/app.config.ts` + `app-mobile/eas.json` |
| Business build config | `mingla-business/app.config.ts` + `mingla-business/eas.json` |
| Admin build config | `mingla-admin/vite.config.js` (no env handling needed) |
| Vault setup history | `Mingla_Artifacts/DECISION_LOG.md` (search "vault") |
| MCP / Management API workaround | `~/.claude/projects/<sanitized>/memory/feedback_supabase_mcp_workaround.md` + `reference_supabase_management_api.md` |
| Stripe Connect setup (Cycle B2a) | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md` |
| Sentry setup (business) | `mingla-business/app/_layout.tsx` |

---

## 16. Authority

- **Project:** Mingla (Mingla LLC)
- **Supabase project ref:** `gqnoajqerqhnvulmnyvv`
- **Compiled by:** orchestrator session, 2026-05-07
- **For:** Windows → Mac handoff, but reusable for any new dev machine
- **Sister docs in `clade transfer/`:**
  - `HANDOFF_ORCH_0737_V6_PIPELINE_REDESIGN.md` — current cycle context
  - `HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` — Cycle B2a parallel workstream
  - `HANDOFF_ORCH_0742_PHASE_2.md` — ORCH-0742 brand-id state
  - `ANDROID_GLASS_OPACITY_HANDOFF.md` — UI workstream
  - `HANDOFF_PLACE_POOL_PRICE_FIELDS_INVESTIGATION.md` — pricing investigation

When in doubt: read the source. `grep -r "process.env\.\|Deno.env.get(" .` will surface any env reference I missed.
