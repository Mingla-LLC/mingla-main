# Load test fixtures (#426)

How to obtain credentials and IDs for k6 scripts in `scripts/load/`. See also [load-profile.md](./load-profile.md).

## Required (all scripts)

| Variable | Example | Notes |
|----------|---------|-------|
| `LOAD_BASE_URL` | `https://<ref>.supabase.co/functions/v1` | Supabase edge functions base |
| `SUPABASE_ANON_KEY` | Project anon key | `apikey` header on every request |

## Optional — checkout create (deeper path)

| Variable | Purpose |
|----------|---------|
| `LOAD_TEST_EVENT_ID` | Published event UUID with future `event_dates` |
| `LOAD_TEST_TICKET_TYPE_ID` | Valid ticket type for that event |

Without these, `ticket-checkout-create.js` uses synthetic UUIDs and expects **422** `event_no_active_dates` — still exercises validation + DB lookup (not 5xx).

### Finding staging event IDs

1. Open Supabase staging → **Table Editor** → `events` (published, future dates).
2. Copy `id` → `LOAD_TEST_EVENT_ID`.
3. From `ticket_types` for that event, copy a type `id` → `LOAD_TEST_TICKET_TYPE_ID`.

## Optional — agent-chat (full Ari path)

| Variable | Purpose |
|----------|---------|
| `LOAD_TEST_USER_JWT` | Supabase **access_token** for a test organizer account |
| `LOAD_TEST_BRAND_ID` | Brand UUID the user can access (optional) |

Without `LOAD_TEST_USER_JWT`, `agent-chat.js` only validates the **401 auth gate** (CI-safe, no Gemini cost).

### Obtain JWT (password grant)

Use a **dedicated load-test user** on staging — never production credentials.

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon>"
export LOAD_TEST_EMAIL="load-test@your-staging-domain.example"
export LOAD_TEST_PASSWORD="<staging-only-password>"

node scripts/load/fetch-test-jwt.mjs
# Prints: export LOAD_TEST_USER_JWT='eyJ...'
```

Or sign in via mingla-business staging, then copy the access token from browser devtools → Application → local storage (`sb-<ref>-auth-token`).

**JWT expiry:** Tokens expire (~1h). Re-run `fetch-test-jwt.mjs` before long load runs.

## Optional — marketing-send (direct dispatch path)

| Variable | Purpose |
|----------|---------|
| `LOAD_TEST_USER_JWT` | Organizer access token (same as agent-chat) |
| `LOAD_TEST_CAMPAIGN_ID` | Draft or scheduled campaign UUID owned by that user |

Without JWT, `marketing-send.js` validates the **401/403 auth gate** (CI-safe, no Resend calls).

With JWT but a synthetic `LOAD_TEST_CAMPAIGN_ID`, expect **403** (not owned) or **2xx** with `preview_skipped` when `MARKETING_SEND_LIVE_ENABLED=false` on staging.

### GitHub Actions (optional)

Add repo secrets for full agent-chat smoke:

- `LOAD_TEST_USER_JWT` — short-lived; rotate via automation or skip (auth-gate-only smoke is fine)
- `LOAD_TEST_EVENT_ID` / `LOAD_TEST_TICKET_TYPE_ID` — staging fixtures

## Example env file

Copy `scripts/load/fixtures/example.env` and fill values locally (do not commit).

## Safety

- Run load tests against **staging** only unless explicitly approved.
- Agent-chat with JWT invokes Gemini — keep VUs low (`LOAD_VUS=2`) for smoke.
- Do not commit secrets or real user JWTs.
