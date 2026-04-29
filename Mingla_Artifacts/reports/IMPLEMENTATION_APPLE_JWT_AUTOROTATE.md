# Implementation Report — Apple JWT Auto-Rotation

> **Issue ID:** ORCH-BIZ-AUTH-APPLE-JWT-AUTOROTATE
> **Codebase:** `mingla-business/` (nominally — actual changes in repo root `.github/workflows/` + `scripts/`)
> **Predecessor:** Cycle 0b shipped (`b2cc5daa`). Forensics + spec just landed (uncommitted).
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_APPLE_JWT_AUTOROTATE.md`
> **Spec:** `Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md`
> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md`
> **Status:** implemented, partially verified

---

## 1. Summary

Built the Apple JWT auto-rotation workflow per spec. Two new files, zero
source code changes. Cron runs every 5 months, regenerates the JWT from
the stored `.p8`, PATCHes Supabase Management API to refresh
`external_apple_secret`, verifies the update succeeded, opens a GitHub
Issue on any failure step.

After founder one-time setup (6 GitHub Actions secrets + first manual
trigger), web Apple sign-in stays alive forever without further
intervention.

---

## 2. Old → New Receipts

### `scripts/rotate-apple-jwt.mjs` (NEW)

**What it did before:** did not exist.

**What it does now:** Node ESM script that:
1. Validates 6 required env vars (exits 1 if any missing)
2. Generates a 180-day Apple `client_secret` JWT using `jsonwebtoken` (ES256, with the configured Service ID, Team ID, Key ID, .p8 private key) — exits 2 on failure
3. Pre-flights the Supabase PAT with a `GET /v1/projects/{ref}/config/auth` — exits 3 on 401/403 (signals PAT expired)
4. PATCHes the same endpoint with `{ external_apple_secret: <newJwt> }` — exits 4 on failure with the response body logged
5. Verifies the PATCH took effect with another GET — checks `external_apple_enabled === true`, `external_apple_client_id` contains the Service ID, and `external_apple_secret` is non-empty (exits 5 on any check failure)
6. Logs `[success]` lines and exits 0

**Why:** Spec §2.2 — the canonical rotation logic. Library: `jsonwebtoken` (same lib used in Cycle 0b's manual script). API: native `fetch` (Node 18+).

**Lines changed:** +131 (new file).

### `.github/workflows/rotate-apple-jwt.yml` (NEW)

**What it did before:** did not exist.

**What it does now:** GitHub Actions workflow with:
- **Trigger**: cron `0 8 1 */5 *` (08:00 UTC, day 1 of every 5th month — Jan/Jun/Nov pattern) AND `workflow_dispatch` for manual triggers
- **Permissions**: `issues: write` (for failure-issue creation), `contents: read` (for checkout)
- **Steps**:
  1. Checkout (`actions/checkout@v4`)
  2. Setup Node 20 (`actions/setup-node@v4`)
  3. Install jsonwebtoken (`npm install --no-save jsonwebtoken@^9`)
  4. Run `node scripts/rotate-apple-jwt.mjs` with all 6 secrets passed via `env:`
  5. **On failure**: `actions/github-script@v7` opens a GitHub Issue with the run URL, exit-code-mapped triage steps, and impact assessment. Labels: `rotation-failure`, `auth`, `urgent`
- **Header comment block**: cites Apple's 180-day constraint, references investigation + spec, includes 3-scenario operator runbook

**Why:** Spec §2.3 — the canonical workflow. Failure-issue creation per spec §7 (regression prevention).

**Lines changed:** +101 (new file).

---

## 3. Spec Traceability — verification matrix

Per spec §3 success criteria.

| # | Criterion | Status | Evidence |
|--|--|--|--|
| 1 | `.github/workflows/rotate-apple-jwt.yml` exists with §2.3 content | ✅ PASS | File created verbatim; YAML structure visually verified to match spec |
| 2 | `scripts/rotate-apple-jwt.mjs` exists with §2.2 content | ✅ PASS | File created verbatim |
| 3 | All 6 GitHub Actions secrets added by founder | ⏳ UNVERIFIED | Founder action — see §7 below |
| 4 | First `workflow_dispatch` run succeeds | ⏳ UNVERIFIED | Founder action — after secrets added |
| 5 | Supabase Apple Secret Key non-empty post-run | ⏳ UNVERIFIED | Founder smoke after first run |
| 6 | Web Apple sign-in still works post-rotation | ⏳ UNVERIFIED | Founder smoke |
| 7 | Cron registered visible in GitHub Actions UI | ⏳ UNVERIFIED | Founder verifies in Actions tab |
| 8 | Failure path tested (deliberate broken secret) | ⏳ UNVERIFIED | Founder + orchestrator post-implementation |
| 9 | TypeScript / linter checks for `mingla-business/` still pass | ✅ PASS | `cd mingla-business && npx tsc --noEmit` returns no output (exit 0) |
| 10 | Implementor report written | ✅ PASS | This report |

**Summary**: 4/10 implementor-verifiable gates PASS. 6/10 require founder-side actions (secret setup + smoke runs).

---

## 4. Invariant Verification

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | designSystem.ts not touched |
| I-2 | ✅ Preserved | Auth flow on iOS/Android/web at runtime unchanged. The JWT in Supabase auth-config gets refreshed periodically; consuming code (AuthContext, supabase.ts, app/auth/callback.tsx) doesn't change. |
| I-3 | ✅ Preserved | iOS / Android / web all execute. The rotation only touches Supabase's auth-config layer. |
| I-4 | ✅ Preserved | No imports from app-mobile. Both new files are CI-side. |
| I-5 | ✅ Preserved | Mingla = experience app. No copy / domain text touched. |
| I-6 | ✅ Preserved | `cd mingla-business && npx tsc --noEmit` exits 0 (verified) |
| I-7 | ✅ Preserved | No silent failures. Failure-issue creation in workflow is non-optional (`if: failure()` step always runs on any prior step's failure). Script's exit codes (1-5) map directly to triage paths in the issue body. |
| I-8 | ✅ Preserved | No Supabase migrations or RLS touched. Only auth-config secret_key field mutated. |
| I-9 | ✅ Preserved (N/A) | No animation timings touched |
| I-10 | ✅ Preserved (N/A) | No copy / currency changes |
| DEC-079 | ✅ Honoured | Kit closure preserved (no kit changes) |
| DEC-081 | ✅ Honoured | mingla-web not built. Workflow lives at repo root, fix lives entirely in CI. |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|-----------|-----------|
| 1 | No dead taps | N/A (no UI changes) |
| 2 | One owner per truth | ✅ — Supabase auth-config remains the single source of truth for auth secrets |
| 3 | No silent failures | ✅ — failure-issue creation guaranteed on any error |
| 4 | One query key per entity | N/A |
| 5 | Server state stays server-side | ✅ — JWT lives in Supabase managed config |
| 6 | Logout clears everything | N/A |
| 7 | Label temporary fixes | ✅ — header comment in workflow documents the "permanent infrastructure" nature + reversal conditions |
| 8 | Subtract before adding | ✅ — additions only, no broken code layered on |
| 9 | No fabricated data | N/A |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | ✅ — single Supabase project, single auth config |
| 12 | Validate at the right time | ✅ — pre-flight GET validates PAT before attempting PATCH; post-PATCH GET verifies the update took effect |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✅ — runtime auth flow unchanged, persistence layer intact |

---

## 6. Cache Safety / Parity / Regression Surface

**Cache safety**: N/A. No React Query keys, no persisted state shape changes, no migrations.

**Parity**: iOS / Android / web all unchanged at runtime. Native ID-token flow doesn't use the JWT at all. Web OAuth-redirect flow uses whatever JWT is currently in Supabase — auto-rotation just keeps that fresh.

**Regression surface (3-5 features most likely to break post-deployment)**:
1. **Web Apple sign-in immediately after first manual trigger** — if the rotation succeeded but the new JWT is somehow malformed, web Apple sign-in could break. Verification step in the script catches malformed responses; founder should still smoke-test web Apple sign-in after first run.
2. **iOS/Android Apple sign-in unchanged** — uses ID-token flow, not OAuth, no JWT involved. Zero risk.
3. **Google sign-in (web + native)** — different provider entirely. Zero risk.
4. **Existing signed-in users on web** — their refresh tokens are independent of the JWT. Zero risk.
5. **The first scheduled cron run after merge** — depending on when this lands, the cron may not fire for several months. First MANUAL trigger is the actual verification gate.

---

## 7. Founder Setup — Action Required

The implementor cannot add GitHub Actions secrets. Founder MUST do this once before the workflow can run.

### 7.1 Add 6 GitHub Actions secrets

Open: https://github.com/Mingla-LLC/mingla-main/settings/secrets/actions

Click **New repository secret** 6 times. Use these EXACT names + values:

| Secret name | Value |
|--|--|
| `APPLE_TEAM_ID` | `782KVMY869` |
| `APPLE_SERVICE_ID` | `com.sethogieva.minglabusiness.web` |
| `APPLE_KEY_ID` | `4F5MJ3G94D` |
| `SUPABASE_PROJECT_REF` | `gqnoajqerqhnvulmnyvv` |
| `APPLE_P8_PRIVATE_KEY` | Full multi-line content of `~/Downloads/AuthKey_4F5MJ3G94D.p8` (open the file in a text editor, select all, copy — INCLUDING the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines and all the base64 between them) |
| `SUPABASE_MANAGEMENT_TOKEN` | (see §7.2) |

### 7.2 Generate Supabase Personal Access Token

1. Open Supabase Dashboard → **Account Settings** → **Access Tokens**
   (https://supabase.com/dashboard/account/tokens)
2. Click **Generate new token**
3. Name: `Mingla Apple JWT rotation`
4. Click Generate
5. **Copy the token immediately** (you won't be able to see it again)
6. Back in GitHub Settings → Secrets → add it as `SUPABASE_MANAGEMENT_TOKEN`

### 7.3 Trigger the workflow manually (first run verification)

1. Open: https://github.com/Mingla-LLC/mingla-main/actions
2. Find **Rotate Apple OAuth JWT** in the left sidebar
3. Click **Run workflow** → leave branch as `Seth` (or `main` after merge) → **Run workflow**
4. Wait ~30 seconds. The run should show green check (success).
5. If green: open Supabase Dashboard → Authentication → Providers → Apple → confirm "Secret Key (for OAuth)" field is non-empty.
6. **Smoke test**: open web app → sign out → tap **Continue with Apple** → should still work end-to-end. The new JWT is now in production.
7. **If red**: open the **Issues** tab — an auto-created issue titled `🔴 Apple JWT rotation failed` will have triage steps. Read the run logs, fix the underlying cause, re-trigger the workflow.

### 7.4 Verify the cron schedule

1. After step 7.3 succeeds, open the workflow page in Actions tab
2. Confirm "Next scheduled run" timestamp is shown (~5 months from now)

After 7.1–7.4 are all green, you're done forever. The cron runs autonomously every 5 months. Failure auto-creates issues. The reminder agent (`trig_01EScEkMCdccJ5aRie4PphuE` firing 2026-10-12) becomes the safety-net backstop.

---

## 8. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|--|--|--|--|
| **D-IMPL-AUTOROTATE-1** | The workflow's `npm install --no-save jsonwebtoken@^9` step runs from the workspace root, where there's NO `package.json`. npm v7+ supports `npm install <pkg>` without a package.json (installs into ./node_modules), so this should work as spec'd. **Watch-point**: if the first manual run fails at this step with an ENOENT or "no package.json" error, the fix is to add `working-directory: ./scripts` to BOTH the install step AND the run step (the script then runs from `scripts/` with its own `node_modules` resolved via that path). The script invocation would change to `node rotate-apple-jwt.mjs` (relative to scripts/). Marked as a low-probability watch-point, not a current bug. | Watch-point | Track during first manual run; fix surgically if it fails |
| **D-IMPL-AUTOROTATE-2** | Cron schedule `0 8 1 */5 *` evaluates to "08:00 UTC, day 1, every 5 months starting from January" → Jan 1, Jun 1, Nov 1 of any year. After merge today (2026-04-29), the first cron fire is **2026-06-01 08:00 UTC**. The current JWT expires 2026-10-26, so the June 1 + Nov 1 fires will both refresh well before the existing JWT expires. The reminder agent firing 2026-10-12 will see a fresh JWT (rotated Nov 1 will not yet have happened — but the Jun 1 rotation will have). | Info | None — cron cadence is intentional |
| **D-IMPL-AUTOROTATE-3** | The PAT (Personal Access Token) the founder will create at step §7.2 has user-level scope. If the founder rotates their own Supabase login credentials or revokes the PAT, the rotation workflow will fail with exit code 3 and auto-open an issue. This is the fail-safe behavior. | Info | Founder aware via §7's runbook |
| **D-IMPL-AUTOROTATE-4** | Once auto-rotation is verified working (founder completes §7), orchestrator should update the existing remote-trigger reminder agent (`trig_01EScEkMCdccJ5aRie4PphuE`, fires 2026-10-12) to verify auto-rotation succeeded rather than instruct manual rotation. Spec §9 calls this out as orchestrator action. | Process | Orchestrator updates trigger via RemoteTrigger after founder verifies §7 |

---

## 9. Transition Items

No new transitional code. The workflow is permanent infrastructure. Header
comment documents the conditions under which it can be removed (Apple
extends JWT expiry policy beyond 180 days OR Supabase Management API
deprecates the auth-config endpoint — neither expected).

---

## 10. Files Changed Summary

| Path | Action | Net lines |
|------|--------|-----------|
| `scripts/rotate-apple-jwt.mjs` | NEW | +131 |
| `.github/workflows/rotate-apple-jwt.yml` | NEW | +101 |

**Total**: 2 created, 0 modified, 0 deleted. Net ~+232 lines.

---

## 11. Working method actually followed

1. ✅ Pre-flight reads — dispatch + spec + investigation context (already in conversation context from the forensics session)
2. ✅ Verified `.github/workflows/` and `scripts/` directories exist; no name collision with `rotate-apple-jwt.*`
3. ✅ Announced 4-line plan (verbatim spec implementation, npm install watch-point logged)
4. ✅ Created `scripts/rotate-apple-jwt.mjs` with verbatim spec §2.2 content
5. ✅ Created `.github/workflows/rotate-apple-jwt.yml` with verbatim spec §2.3 content
6. ✅ tsc clean check (`cd mingla-business && npx tsc --noEmit` → exit 0)
7. ✅ Wrote this report including the founder-handoff section per dispatch §7
8. ⏳ Founder secret setup + first manual run — pending

---

## 12. Hand-off

Per locked sequential rule, **stopping here**. tsc clean. 4/10
implementor-verifiable gates PASS. Founder must complete §7 to verify the
workflow actually runs successfully end-to-end.

The fix is high-confidence (forensics root cause was six-field-proven; spec
was implemented verbatim; no source-code surface area to introduce
regressions). Watch-point logged at D-IMPL-AUTOROTATE-1 in case the npm
install step fails at first run.

Hand back to `/mingla-orchestrator` for review + AGENT_HANDOFFS update +
founder smoke gating.

---

**End of Apple JWT Auto-Rotation implementation report.**
