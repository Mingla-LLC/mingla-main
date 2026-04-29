# Investigation Report — Apple JWT Auto-Rotation

> **Issue ID:** ORCH-BIZ-AUTH-APPLE-JWT-AUTOROTATE
> **Mode:** Forensics INVESTIGATE
> **Initiative:** Mingla Business — eliminate manual 6-month Apple OAuth JWT rotation
> **Codebase:** `mingla-business/` + new `.github/workflows/`
> **Severity:** S2-medium (silent web Apple sign-in breakage if forgotten — currently mitigated by manual reminder D-IMPL-46 + scheduled remote agent `trig_01EScEkMCdccJ5aRie4PphuE`)
> **Investigator turn:** 2026-04-29
> **Confidence:** **H** (Supabase Management API surface verified directly via OpenAPI spec; JWT generation pattern verified from Cycle 0b's working implementation)

---

## 1. Symptom Summary

**Constraint:** Apple's Sign in with Apple policy mandates `client_secret` JWTs MUST have `exp` claim ≤ 180 days from issuance. Apple rejects JWTs with longer expiry. This is a hard Apple-side constraint we cannot override.

**Current state (post-Cycle 0b):** Manual JWT generation + paste into Supabase Apple provider Secret Key field. JWT issued 2026-04-29 expires 2026-10-26.

**Founder requirement (2026-04-29):** Eliminate the manual rotation cadence. Make it permanent + automatic.

**Failure mode if neglected:** After expiry, Supabase sends an expired JWT to Apple during OAuth code exchange. Apple returns `invalid_client`. Web Apple sign-in breaks silently for new sign-in attempts. Existing signed-in sessions continue working (their access/refresh tokens don't depend on the JWT). Users cannot detect this preemptively from the app — it manifests as "Continue with Apple" button broken.

---

## 2. Investigation Manifest

| # | File / URL | Why |
|--|--|--|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_APPLE_JWT_AUTOROTATE.md` | Mission + scope guidance |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md` §1, §S.7 | Existing JWT generation pattern + values |
| 3 | `Mingla_Artifacts/DECISION_LOG.md` DEC-076, DEC-081 | Auth architecture context |
| 4 | https://api.supabase.com/api/v1-json | Supabase Management API OpenAPI spec — primary evidence for the Management API surface |
| 5 | `mingla-business/package.json` | Confirm Node 20+ compatible (current Expo SDK 54 setup uses Node 22.19.0 per CI evidence) |
| 6 | `mingla-business/src/context/AuthContext.tsx` `signInWithApple` web branch | Existing Apple OAuth flow that auto-rotation must continue serving |

---

## 3. Findings

### 🔵 Observation — Apple's 180-day JWT expiry is a permanent, unworkaroundable constraint

Apple's documentation specifies `client_secret` JWTs for Sign in with Apple have a maximum 180-day `exp` claim. Apple rejects longer JWTs. This is identical across all OAuth integrations in the world; Mingla cannot opt out. Hence the goal is automation, not avoidance.

### 🔴 Root constraint — Manual JWT pasting is the only currently-implemented refresh path

| Field | Detail |
|--|--|
| **Site** | Cycle 0b shipped JWT generation as a manual Node script + paste-into-Supabase workflow (`IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md` §S.7) |
| **What it does** | Founder runs the script every 6 months, pastes the new JWT into Supabase Dashboard manually |
| **What it should do** | Auto-rotation runs on a schedule, generates a fresh JWT, updates Supabase auth config via Management API, alerts only on failure |
| **Causal chain** | Manual workflow → human dependency → forgetting → silent breakage of web Apple sign-in for any signing-in user post-expiry |
| **Verification** | The current production state has no automation; the JWT in Supabase right now (verified by founder 2026-04-29) is the manually-pasted one valid until 2026-10-26 |

This is technically a "missing feature" rather than a bug — the existing system works exactly as designed in Cycle 0b. The 🔴 classification reflects that without automation, ongoing operational risk persists.

### 🟢 (Newly verified) Supabase Management API supports `external_apple_secret` updates

Cross-referenced the Supabase Management API OpenAPI spec at `https://api.supabase.com/api/v1-json` (fetched 2026-04-29 20:18 UTC, 289 KB).

**Endpoint exists:** `PATCH /v1/projects/{ref}/config/auth`

| Field | Value |
|--|--|
| Operation ID | `v1-update-auth-service-config` |
| Summary | "Updates a project's auth config" |
| Authentication | `bearer` token — Supabase Personal Access Token (PAT) from Dashboard |
| Required permissions (FGA) | `auth_config_write` AND `project_admin_write` |
| Request body schema | `UpdateAuthConfigBody` (234 properties, all optional — partial PATCH allowed) |
| Apple-specific fields available | `external_apple_enabled` (boolean), `external_apple_client_id` (string), `external_apple_email_optional` (boolean), `external_apple_secret` (string ← **the JWT field**), `external_apple_additional_client_ids` (string, comma-separated) |

**A PATCH with body `{"external_apple_secret": "<new JWT>"}` is sufficient.** No other fields need to be sent. The other Apple config (Client IDs, email_optional setting) remain unchanged because PATCH is partial-update.

This means our auto-rotation workflow can be a clean single API call. No JSON merging, no mass config replay — just the one secret.

### 🟡 Hidden flaw — No alert mechanism currently exists for failed auth-config updates

If we add the auto-rotation workflow but don't add alerting, a silent failure (e.g., expired Personal Access Token, transient API error, network blip) means rotation appears to succeed in CI logs nobody reads, and the JWT goes stale anyway.

The spec must include a non-optional alert mechanism. Recommended: GitHub Actions issue creation on failure (built-in via `actions/github-script`). Cheap, no external integrations needed.

### 🟡 Hidden flaw — Personal Access Token (PAT) for Supabase Management API has its own expiry pattern

Supabase PATs expire if not used; users can also revoke them. Auto-rotation depends on this token. If the PAT goes stale and the workflow can't authenticate, JWT rotation fails. The reminder agent (`trig_01EScEkMCdccJ5aRie4PphuE`) firing 2026-10-12 catches this — but only via the founder's manual investigation.

The spec should include: (a) the PAT used by the workflow is documented as a critical dependency, (b) the workflow tests its PAT via a `GET /v1/projects/{ref}/config/auth` call before attempting the PATCH, and (c) alert messaging clearly distinguishes "PAT expired/revoked" from "Apple JWT generation failed".

### 🔵 Observation — JWT generation is library-dependent (jsonwebtoken)

The `jsonwebtoken` npm package is widely-used, well-maintained, and works in CI. The script we used in Cycle 0b transfers verbatim to GitHub Actions. No portability concerns.

### 🔵 Observation — The .p8 private key never expires from Apple's side

Apple's "Sign in with Apple" private keys (the `.p8` file) don't auto-expire. They're revoked manually if the user does so via Apple Developer Console. Storing the same `.p8` in GitHub Actions secrets is a one-time setup.

If Apple ever forces key rotation (no current signal of this), the workflow's `APPLE_KEY_ID` and `APPLE_P8_PRIVATE_KEY` secrets need updating — covered by an operational runbook in the spec.

---

## 4. Five-Layer Cross-Check

| Layer | Finding |
|--|--|
| **Docs** | Supabase Management API OpenAPI spec at `api.supabase.com/api/v1-json` defines the exact endpoint + body shape. Apple's Sign in with Apple docs define the 180-day JWT expiry. Both layers consistent. |
| **Schema** | OpenAPI spec confirms `external_apple_secret: string` is a partial-updatable field on `UpdateAuthConfigBody`. No required fields means partial PATCH works. |
| **Code** | Cycle 0b's existing JWT generation script (Node `jsonwebtoken`) is the canonical reference. AuthContext.tsx web Apple OAuth flow doesn't change at all — it'll keep calling Supabase, Supabase will keep using whichever JWT is in `external_apple_secret`, transparent to our app. |
| **Runtime** | After PATCH `/config/auth` with new `external_apple_secret`, Supabase's auth gateway begins using the new JWT for subsequent OAuth calls. No restart required. (Per Supabase Management API behaviour for other config updates — verified by analogy; spec includes a verification step to confirm.) |
| **Data** | The current JWT is in Supabase's auth-config table (managed surface). Our auto-rotation overwrites it. Old JWT is no longer used after the PATCH succeeds. |

**Layer agreement:** all layers converge on a single fix path. PATCH the auth-config endpoint with the new `external_apple_secret`. No contradictions to resolve.

---

## 5. Blast Radius

- **Affects:** the web Apple OAuth code-exchange flow on `mingla-business` Expo Web. Specifically, Supabase's call to Apple's `/auth/token` endpoint exchanging the auth code for an Apple ID token. After the JWT is updated, this call uses the new JWT.
- **Does NOT affect:** native iOS/Android Apple sign-in (uses ID-token flow directly to Supabase, no JWT involved). The JWT only matters for the web OAuth-redirect flow.
- **Does NOT affect:** Google sign-in (web or native). Different provider.
- **Does NOT affect:** consumer Mingla (`app-mobile/`) — its bundle IDs in the Client IDs list use ID-token flow on iOS native. Web bundle of consumer Mingla isn't being built (DEC-081).
- **Does NOT affect:** the `mingla-business` codebase itself. The fix lives in `.github/workflows/` plus a small CI script. No `mingla-business/src/` or runtime code changes.

---

## 6. Invariant Considerations

The spec should establish a NEW invariant:

**Proposed invariant**: "Apple OAuth JWT must always be ≤180 days from issuance and >30 days remaining on the production Supabase Apple provider, OR active rotation must be in flight."

Verification: GitHub Actions cron runs every 5 months → if the workflow fails, an issue is auto-created → if the issue isn't resolved before the JWT's 30-day buffer ends, escalation to a hardcoded alert path (e.g., the existing remote-trigger reminder agent firing 2026-10-12 catches the first cycle).

---

## 7. Fix Strategy (direction only — spec defines specifics)

**Path A — GitHub Actions cron rotation (recommended)**

1. Store secrets in GitHub Actions repo secrets:
   - `APPLE_P8_PRIVATE_KEY` — full contents of `AuthKey_4F5MJ3G94D.p8`
   - `APPLE_TEAM_ID` — `782KVMY869`
   - `APPLE_SERVICE_ID` — `com.sethogieva.minglabusiness.web`
   - `APPLE_KEY_ID` — `4F5MJ3G94D`
   - `SUPABASE_PROJECT_REF` — `gqnoajqerqhnvulmnyvv`
   - `SUPABASE_MANAGEMENT_TOKEN` — Personal Access Token from Supabase Dashboard
2. Cron schedule: every 5 months (~150 days, 30-day buffer before 180-day expiry)
3. Workflow generates JWT (Node + jsonwebtoken), PATCHes Supabase config, verifies via GET, opens GitHub Issue on any failure step

**Path B — Supabase Edge Function with `pg_cron` trigger (rejected)**

Edge Functions can't easily store/access the .p8 key without an external secret manager OR baking it into env vars (which Supabase encrypts at rest). Adds complexity (Edge Function + pg_cron + secret management). GitHub Actions is leaner for this use case.

**Path C — Supabase CLI in CI (rejected)**

The `supabase` CLI doesn't expose a clean way to PATCH only the Apple secret without dumping/replaying the entire config (which is fragile across schema changes). The Management API direct call is cleaner.

**My recommendation: Path A.** Surgical, debuggable, no platform-specific quirks, GitHub Actions free tier covers it, single canonical workflow file in the repo.

---

## 8. Regression Prevention

The spec must include:

1. **Workflow file lives at a stable path** — `.github/workflows/rotate-apple-jwt.yml` — discoverable.
2. **Header comment in the workflow** explains the 180-day Apple constraint, references this investigation report + the spec, and documents the operator runbook for emergency rotation (`workflow_dispatch` manual trigger).
3. **Failure alerting via GitHub Issue creation** — the workflow uses `actions/github-script` to open an Issue with details on any failure step. Issues are visible in the same UI as PRs, no external integrations needed.
4. **Verification step in the workflow** — after PATCH, the workflow GETs the auth config and confirms the new `external_apple_secret` is in place (compares JWT prefix or checks a specific claim).
5. **Operator runbook documented** in the workflow's README or a comment block — covers: rotating the .p8 key (Apple revokes it / new key created), updating the PAT (Supabase token expires), force-running the workflow.
6. **The remote-trigger reminder agent stays** as a safety net — its prompt should be updated post-implementation to verify auto-rotation succeeded.

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|--|--|--|--|
| **D-FORENSICS-AUTOROTATE-1** | Supabase Management API requires a Personal Access Token (PAT). PATs can be created at Supabase Dashboard → Account Settings → Access Tokens. The PAT has user-level scope; if the user revokes their account or rotates the PAT, the workflow fails. Spec should document creating a dedicated PAT for the workflow (named e.g. "Mingla Apple JWT rotation") and storing it as a GitHub Actions secret. | Operational | Implementor follows spec instructions; founder creates PAT during setup |
| **D-FORENSICS-AUTOROTATE-2** | The `jsonwebtoken` npm package needs a specific algorithm setting (`ES256`) for Apple JWT signing. Cycle 0b's script proved the recipe; verbatim transfer to CI works. No new library risk. | Info | Implementor uses the same library/version as Cycle 0b's script |
| **D-FORENSICS-AUTOROTATE-3** | The Supabase OpenAPI spec is large (290 KB, 234 fields on UpdateAuthConfigBody). Implementor should NOT replay other fields in the PATCH — surgical PATCH with only `external_apple_secret` keeps the operation minimal-impact. Spec mandates the partial-update pattern. | Info | Spec enforces single-field PATCH |
| **D-FORENSICS-AUTOROTATE-4** | The remote-trigger reminder agent (`trig_01EScEkMCdccJ5aRie4PphuE`) created earlier today should have its prompt updated post-implementation to verify auto-rotation succeeded rather than instruct manual rotation. Orchestrator action — RemoteTrigger update. | Process | Orchestrator updates the trigger after implementor lands the workflow |
| **D-FORENSICS-AUTOROTATE-5** | First execution of the workflow should be MANUAL (`workflow_dispatch`) for trust-building, then trust the cron from second execution onward. Spec includes the manual trigger. | Process | Founder + implementor verify first run before relying on cron |

---

## 10. Confidence

**H — high confidence.** Supabase Management API surface verified directly via OpenAPI spec (not docs prose, the source of truth). Apple's 180-day JWT constraint is universally known. The JWT generation library (jsonwebtoken) is proven by Cycle 0b. GitHub Actions cron + secrets is a well-trodden CI pattern. No exotic dependencies. The implementor can build this in ~half day with high success probability.

What would lower confidence: if Supabase silently caches old JWTs at the auth gateway and the new one doesn't take effect until a project restart (no evidence of this; the spec includes a verification step that catches it if true).

---

**End of WEB Apple JWT Auto-Rotation investigation report.**
