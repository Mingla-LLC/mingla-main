# Security Audit Protocol

Every finding here is minimum P1. Authentication or data exposure = P0.

---

## Step 1 — Attack Surface Mapping

Enumerate every entry point:

| Entry Point | Type | Auth Required? | Notes |
|-------------|------|---------------|-------|
| Edge functions (72) | HTTP | Most yes | Check each |
| Supabase direct (RLS) | PostgreSQL | Via JWT | RLS enforces |
| Realtime channels | WebSocket | Via JWT | Channel-level |
| Storage buckets (6) | HTTP | Bucket policies | Per-bucket |
| Admin routes (14 pages) | HTTP | 3-layer auth | Check each |
| Deep links (12 routes) | URL scheme | Via app auth | Check handler |

---

## Step 2 — Authentication Audit

### OAuth Flow
- [ ] Google Sign-In: token validated server-side?
- [ ] Apple Sign-In: token validated server-side?
- [ ] OAuth tokens not stored in plain text on device?
- [ ] OAuth tokens not logged anywhere?

### OTP Flow
- [ ] Rate limited (can't brute force 6-digit code)?
- [ ] OTP expires after reasonable time?
- [ ] Failed attempts tracked and limited?
- [ ] Phone number validated (E.164 format) before sending?

### Session Management
- [ ] JWT expiry reasonable (not infinite)?
- [ ] Refresh token rotation (old tokens invalidated)?
- [ ] 401 from edge function triggers refresh (not logout)?
- [ ] Grace period prevents logout during normal refresh?
- [ ] Multiple device sessions handled correctly?

### Sign-Out
- [ ] All tokens invalidated?
- [ ] React Query cache cleared?
- [ ] Zustand stores cleared?
- [ ] AsyncStorage cleared?
- [ ] Realtime subscriptions removed?
- [ ] Push tokens unregistered?
- [ ] No user data accessible after sign-out?
- [ ] Sign in as different user shows ONLY their data?

---

## Step 3 — Authorization Audit (RLS)

For every table with user data, verify the RLS policy matrix:

| Table | anon | authenticated (own) | authenticated (other) | service_role |
|-------|------|--------------------|-----------------------|-------------|
| profiles | ❌ | ✅ read, ✅ update | ✅ read (friends) | ✅ all |
| saves | ❌ | ✅ all own | ❌ | ✅ all |
| ... | ... | ... | ... | ... |

**Critical checks:**
- [ ] No table without RLS enabled (grep for tables, check each)
- [ ] No `USING (true)` on user data tables
- [ ] Blocked users: completely invisible (bidirectional)
- [ ] Friends: can see profile but not private data
- [ ] Paired: can see each other's saves
- [ ] Admin: only admin_users table members

---

## Step 4 — Data Exposure Audit

### API Responses
- [ ] Edge functions return only necessary fields?
- [ ] No internal IDs, admin flags, or system fields exposed?
- [ ] Error messages don't leak schema info?
- [ ] Error messages don't leak user existence (login)?
- [ ] Pagination doesn't allow enumeration?

### Client-Side Storage
- [ ] No API keys in mobile code (check bundle)?
- [ ] No service_role key in mobile or admin code?
- [ ] Sensitive data not in console.log?
- [ ] Tokens not in URL parameters?
- [ ] No sensitive data in crash reports?

### Location Privacy
- [ ] Real lat/lng never exposed to other users?
- [ ] Approximate location uses deterministic offset?
- [ ] "Go Dark" actually hides from all queries?
- [ ] Blocked users can't see location?

---

## Step 5 — Input Validation Audit

For every edge function:
- [ ] All string inputs sanitized?
- [ ] All numeric inputs range-checked?
- [ ] SQL injection: only parameterized queries?
- [ ] No string interpolation in Supabase queries?
- [ ] File upload: type and size validated?
- [ ] JSON parsing: wrapped in try/catch?
- [ ] URL parameters: validated before use?

### Specific Injection Vectors
- [ ] Phone number: E.164 format enforced?
- [ ] Storage paths: no user input in paths without sanitization?
- [ ] Display names: HTML entities escaped in admin?
- [ ] Search queries: sanitized before DB query?

---

## Step 6 — Third-Party Risk

For each external API:
- [ ] API key stored in environment variables (not code)?
- [ ] API key delivered to mobile via secure edge function?
- [ ] Response from API validated before use?
- [ ] Timeout on all external calls?
- [ ] Rate limiting considered?
- [ ] Fallback if API is down?
- [ ] No sensitive user data sent to third parties unnecessarily?

| API | Key Protected? | Response Validated? | Timeout? | Fallback? |
|-----|---------------|-------------------|----------|-----------|
| Google Places | | | | |
| OneSignal | | | | |
| RevenueCat | | | | |
| Twilio | | | | |
| OpenAI | | | | |
| Ticketmaster | | | | |
| OpenWeatherMap | | | | |

---

## Step 7 — Admin Security

- [ ] 3-layer auth (email allowlist → password → OTP 2FA)?
- [ ] Admin actions logged to audit log?
- [ ] No admin endpoint accessible without admin auth?
- [ ] Destructive operations require confirmation?
- [ ] Admin can't escalate their own privileges?
- [ ] Admin data access logged (who accessed what, when)?
