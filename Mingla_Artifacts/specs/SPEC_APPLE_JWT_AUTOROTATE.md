# Spec — Apple JWT Auto-Rotation via GitHub Actions

> **Issue ID:** ORCH-BIZ-AUTH-APPLE-JWT-AUTOROTATE
> **Mode:** Forensics SPEC (companion to `Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md`)
> **Codebase:** `mingla-business/` + new `.github/workflows/`
> **Confidence:** H
> **Authored:** 2026-04-29
> **Status:** READY-TO-DISPATCH (implementor)

---

## 1. Scope

**In scope:**
- New file `.github/workflows/rotate-apple-jwt.yml` — GitHub Actions workflow that runs every 5 months (~150 days), regenerates the Apple Sign in with Apple `client_secret` JWT, PATCHes Supabase Management API to update the live JWT.
- New file `scripts/rotate-apple-jwt.mjs` — Node.js script invoked by the workflow that handles JWT generation + Supabase PATCH + verification.
- Updated remote-trigger agent `trig_01EScEkMCdccJ5aRie4PphuE` post-implementation (orchestrator action — out of implementor scope, called out for clarity).
- Operator-runbook comment block in the workflow file documenting setup, rotation, key changes, manual trigger procedure.

**Non-goals:**
- ❌ Touching Cycle 0b auth code (`AuthContext.tsx`, `supabase.ts`, `app/auth/callback.tsx` etc.)
- ❌ Replacing the Supabase Management API approach with Edge Functions or Supabase CLI (rejected in investigation §7)
- ❌ Auto-rotating the .p8 private key (Apple keys don't auto-expire; manual procedure documented in runbook)
- ❌ Auto-rotating the Supabase Personal Access Token (operator runbook documents how to refresh it manually if it expires)
- ❌ Multi-environment rotation (only `gqnoajqerqhnvulmnyvv` Supabase project is in scope; if staging/prod separation is added later, this workflow gets parameterised)
- ❌ Replacing or disabling the existing remote-trigger reminder agent (it stays as a safety net; orchestrator updates its prompt separately)

**Assumptions:**
- Repository is hosted on GitHub at `Mingla-LLC/mingla-main` (verified via the existing remote URL).
- GitHub Actions are enabled for the repository.
- The founder will create a Supabase Personal Access Token + add 6 GitHub Actions secrets one-time during setup.
- Apple's policy and Supabase's Management API surface remain stable through the implementation cycle (no breaking changes mid-build).

---

## 2. Layer-by-Layer Changes

### 2.1 GitHub Actions secrets (founder-side, NOT in code)

The implementor cannot add these — founder must add them via GitHub repo Settings → Secrets and variables → Actions → New repository secret. Document in the workflow's header comment.

| Secret name | Value | Rotation frequency | Source |
|--|--|--|--|
| `APPLE_P8_PRIVATE_KEY` | Full multi-line contents of `AuthKey_4F5MJ3G94D.p8` (including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines) | Only when Apple key is rotated (rare) | `~/Downloads/AuthKey_4F5MJ3G94D.p8` (founder's local machine) |
| `APPLE_TEAM_ID` | `782KVMY869` | Never (unless Apple Developer Team changes) | Apple Developer Console → top-right menu |
| `APPLE_SERVICE_ID` | `com.sethogieva.minglabusiness.web` | Only if Service ID renamed/replaced | Apple Developer Console → Identifiers → Services IDs |
| `APPLE_KEY_ID` | `4F5MJ3G94D` | Only when Apple key is rotated | Apple Developer Console → Keys → "Mingla Sign in with Apple Key" |
| `SUPABASE_PROJECT_REF` | `gqnoajqerqhnvulmnyvv` | Never (project lifetime) | Supabase Dashboard → Project Settings → API → Project URL host prefix |
| `SUPABASE_MANAGEMENT_TOKEN` | A Personal Access Token created at Supabase Dashboard → Account → Access Tokens → "Generate new token" | When PAT expires or is revoked | Supabase Dashboard |

### 2.2 The script — `scripts/rotate-apple-jwt.mjs` (NEW)

```javascript
#!/usr/bin/env node
/**
 * Apple JWT auto-rotation script.
 *
 * Runs in GitHub Actions on a 5-month cron schedule (or manual trigger).
 * Generates a fresh 180-day Apple Sign in with Apple client_secret JWT,
 * PATCHes Supabase auth config to update external_apple_secret, verifies
 * the update by GET-checking the same field.
 *
 * Exit codes:
 *   0  success
 *   1  missing required env var
 *   2  JWT generation failed
 *   3  Supabase PAT auth failed (GET pre-flight returned 401/403)
 *   4  Supabase PATCH failed
 *   5  Supabase verification failed (PATCH succeeded but GET shows different value)
 *
 * Per ORCH-BIZ-AUTH-APPLE-JWT-AUTOROTATE
 * Spec: Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md
 * Investigation: Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md
 */

import jwt from "jsonwebtoken";

const REQUIRED_ENV = [
  "APPLE_P8_PRIVATE_KEY",
  "APPLE_TEAM_ID",
  "APPLE_SERVICE_ID",
  "APPLE_KEY_ID",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_MANAGEMENT_TOKEN",
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("[fatal] missing env vars:", missing.join(", "));
  process.exit(1);
}

const {
  APPLE_P8_PRIVATE_KEY,
  APPLE_TEAM_ID,
  APPLE_SERVICE_ID,
  APPLE_KEY_ID,
  SUPABASE_PROJECT_REF,
  SUPABASE_MANAGEMENT_TOKEN,
} = process.env;

// ---------------------------------------------------------------------------
// Step 1: generate fresh JWT
// ---------------------------------------------------------------------------

let newJwt;
try {
  newJwt = jwt.sign({}, APPLE_P8_PRIVATE_KEY, {
    algorithm: "ES256",
    expiresIn: "180d",
    audience: "https://appleid.apple.com",
    issuer: APPLE_TEAM_ID,
    subject: APPLE_SERVICE_ID,
    keyid: APPLE_KEY_ID,
  });
} catch (err) {
  console.error("[fatal] JWT generation failed:", err.message);
  process.exit(2);
}

console.log("[info] JWT generated, length:", newJwt.length);

// ---------------------------------------------------------------------------
// Step 2: pre-flight — verify PAT works (GET auth config)
// ---------------------------------------------------------------------------

const baseUrl = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth`;
const headers = {
  Authorization: `Bearer ${SUPABASE_MANAGEMENT_TOKEN}`,
  "Content-Type": "application/json",
};

const preflight = await fetch(baseUrl, { method: "GET", headers });
if (!preflight.ok) {
  console.error(
    `[fatal] Supabase PAT pre-flight failed: HTTP ${preflight.status} ${preflight.statusText}`,
  );
  console.error("[fatal] check that SUPABASE_MANAGEMENT_TOKEN is valid + not expired");
  process.exit(3);
}

console.log("[info] Supabase PAT verified (GET /config/auth returned 200)");

// ---------------------------------------------------------------------------
// Step 3: PATCH external_apple_secret
// ---------------------------------------------------------------------------

const patch = await fetch(baseUrl, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ external_apple_secret: newJwt }),
});

if (!patch.ok) {
  const errBody = await patch.text();
  console.error(
    `[fatal] PATCH /config/auth failed: HTTP ${patch.status} ${patch.statusText}`,
  );
  console.error("[fatal] response body:", errBody.slice(0, 1000));
  process.exit(4);
}

console.log("[info] PATCH succeeded");

// ---------------------------------------------------------------------------
// Step 4: verify — GET and confirm the JWT is in place
// ---------------------------------------------------------------------------
//
// Supabase masks/redacts the secret in the GET response (security best
// practice). We can't compare the full JWT verbatim. But we can confirm:
//   (a) external_apple_enabled is still true (not accidentally disabled)
//   (b) external_apple_client_id is still our Service ID (not blanked)
//   (c) external_apple_secret is non-empty and non-null
// If all three pass, the rotation took effect.

const verify = await fetch(baseUrl, { method: "GET", headers });
if (!verify.ok) {
  console.error(`[fatal] verification GET failed: HTTP ${verify.status}`);
  process.exit(5);
}
const cfg = await verify.json();

const expectedClientIdContains = APPLE_SERVICE_ID;
const enabled = cfg.external_apple_enabled === true;
const clientIdValid =
  typeof cfg.external_apple_client_id === "string" &&
  cfg.external_apple_client_id.includes(expectedClientIdContains);
const secretPresent =
  typeof cfg.external_apple_secret === "string" &&
  cfg.external_apple_secret.length > 0;

if (!enabled || !clientIdValid || !secretPresent) {
  console.error("[fatal] post-rotation verification failed:");
  console.error(`  external_apple_enabled: ${cfg.external_apple_enabled}`);
  console.error(`  external_apple_client_id: ${cfg.external_apple_client_id}`);
  console.error(
    `  external_apple_secret: ${secretPresent ? "<masked but present>" : "MISSING/EMPTY"}`,
  );
  process.exit(5);
}

console.log("[success] Apple JWT rotated. New expiry: 180 days from now.");
console.log("[success] external_apple_enabled:", enabled);
console.log("[success] external_apple_client_id:", cfg.external_apple_client_id);
console.log("[success] external_apple_secret: <masked but present>");

process.exit(0);
```

**Notes:**
- `process.env` for everything — secrets passed in via GitHub Actions `env:` block.
- Built-in Node `fetch` (Node 18+).
- `jsonwebtoken` is the only dep.
- All errors surface to stdout/stderr; GitHub Actions captures these into the run log.
- Exit codes are distinct so the workflow can decide what to do per failure mode.

### 2.3 The workflow — `.github/workflows/rotate-apple-jwt.yml` (NEW)

```yaml
# ─────────────────────────────────────────────────────────────────────────────
# Apple JWT Auto-Rotation
#
# Apple's Sign in with Apple OAuth client_secret JWTs MUST expire within 180
# days (Apple policy, not configurable). This workflow rotates the JWT every
# 5 months on the 1st of the month at 08:00 UTC, leaving ~30 days buffer
# before the previous JWT actually expires.
#
# On any failure (token generation, Supabase PAT invalid, PATCH rejected,
# post-PATCH verification fail), this workflow opens a GitHub Issue tagged
# 'rotation-failure'. Triage that issue immediately: web Apple sign-in will
# break for new users when the current JWT expires (~30 days away).
#
# Manual trigger: workflow_dispatch on the Actions tab. Use this for the
# first-run verification, emergency early rotation, or after rotating the
# Apple .p8 key (in which case update the APPLE_P8_PRIVATE_KEY +
# APPLE_KEY_ID secrets first).
#
# Operator runbook:
# 1. To rotate the .p8 key (Apple revokes / new key created):
#    a. Apple Developer Console → Keys → create new "Sign in with Apple" key
#    b. Download the .p8 file (one-time download)
#    c. Note the new Key ID
#    d. GitHub Settings → Secrets → update APPLE_P8_PRIVATE_KEY and APPLE_KEY_ID
#    e. Trigger this workflow manually (workflow_dispatch) to validate
#
# 2. To rotate the Supabase PAT (token expired/revoked):
#    a. Supabase Dashboard → Account Settings → Access Tokens → generate new
#    b. GitHub Settings → Secrets → update SUPABASE_MANAGEMENT_TOKEN
#    c. Trigger this workflow manually to validate
#
# 3. Emergency rotation (e.g. JWT exposed in logs):
#    a. Trigger this workflow manually
#    b. Verify the run succeeded
#    c. Old JWT is invalidated automatically by the new one
#
# Per ORCH-BIZ-AUTH-APPLE-JWT-AUTOROTATE
# Spec: Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md
# Investigation: Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md
# ─────────────────────────────────────────────────────────────────────────────

name: Rotate Apple OAuth JWT

on:
  schedule:
    # 0 8 1 */5 * = 08:00 UTC, day 1 of every 5th month
    # That's roughly: Jan 1, Jun 1, Nov 1 (every 5 months from Jan)
    # First fire after merge: next 1st-of-an-eligible-month at 08:00 UTC
    # For Mingla: this lines up to start ~2026-06-01 onward (depending on merge date)
    - cron: "0 8 1 */5 *"
  workflow_dispatch:

jobs:
  rotate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      issues: write   # to create rotation-failure issues
      contents: read  # to checkout the script

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install jsonwebtoken
        run: npm install --no-save jsonwebtoken@^9

      - name: Run rotation script
        id: rotate
        env:
          APPLE_P8_PRIVATE_KEY: ${{ secrets.APPLE_P8_PRIVATE_KEY }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_SERVICE_ID: ${{ secrets.APPLE_SERVICE_ID }}
          APPLE_KEY_ID: ${{ secrets.APPLE_KEY_ID }}
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_MANAGEMENT_TOKEN: ${{ secrets.SUPABASE_MANAGEMENT_TOKEN }}
        run: node scripts/rotate-apple-jwt.mjs

      - name: Open issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const runUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
            const today = new Date().toISOString().split("T")[0];
            const title = `🔴 Apple JWT rotation failed — ${today}`;
            const body = [
              `Auto-rotation of the Apple Sign in with Apple JWT failed.`,
              ``,
              `**Run:** ${runUrl}`,
              `**Date:** ${today}`,
              ``,
              `## Impact`,
              ``,
              `Web Apple sign-in (Continue with Apple on \`mingla-business\` Expo Web) will break for NEW sign-in attempts when the previous JWT expires (~30 days from this run unless the previous run also failed).`,
              ``,
              `Existing signed-in users are NOT affected — their access/refresh tokens are independent of the JWT.`,
              ``,
              `## Triage`,
              ``,
              `1. Open the run URL above and read the logs.`,
              `2. Match the exit code to the cause:`,
              `   - **1** missing env var → check GitHub Actions secrets are set`,
              `   - **2** JWT generation failed → \`.p8\` key may be malformed; verify \`APPLE_P8_PRIVATE_KEY\` content`,
              `   - **3** Supabase PAT pre-flight 401/403 → \`SUPABASE_MANAGEMENT_TOKEN\` expired/revoked. Generate new PAT in Supabase Dashboard, update the secret`,
              `   - **4** PATCH rejected → check response body in logs; could be Supabase API change or rate-limit`,
              `   - **5** verification failed → manual rotation may have happened concurrently, or Supabase config got reset`,
              `3. After fixing the underlying issue, re-run this workflow manually via \`workflow_dispatch\`.`,
              `4. Verify rotation succeeded by checking Supabase Dashboard → Auth → Providers → Apple → Secret Key field is non-empty.`,
              ``,
              `## Reference`,
              ``,
              `- Spec: \`Mingla_Artifacts/specs/SPEC_APPLE_JWT_AUTOROTATE.md\``,
              `- Investigation: \`Mingla_Artifacts/reports/INVESTIGATION_APPLE_JWT_AUTOROTATE.md\``,
              `- Workflow file: \`.github/workflows/rotate-apple-jwt.yml\``,
            ].join("\n");
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title,
              body,
              labels: ["rotation-failure", "auth", "urgent"],
            });
```

**Notes on the workflow:**
- `permissions: issues: write` is required for the failure-issue creation.
- `timeout-minutes: 5` — the script runs in seconds; 5 min is generous.
- `npm install --no-save` avoids polluting `package.json` since this is a CI-only dep (the project's main `package.json` doesn't need `jsonwebtoken`).
- `actions/checkout@v4` and `actions/setup-node@v4` and `actions/github-script@v7` are pinned major versions — implementor should verify these are current at build time and bump if needed (commonly fine for ~12 months).

### 2.4 No source code changes

`mingla-business/src/`, `mingla-business/app/`, etc. — untouched. The Apple OAuth runtime flow doesn't change. Supabase keeps using whatever JWT is in `external_apple_secret`; auto-rotation just keeps that field fresh.

---

## 3. Success Criteria

1. **`.github/workflows/rotate-apple-jwt.yml` exists** with the §2.3 content (or structurally-equivalent merge if the file pre-exists).
2. **`scripts/rotate-apple-jwt.mjs` exists** with the §2.2 content.
3. **Founder has added all 6 GitHub Actions secrets** (verifiable by founder via Settings → Secrets, NOT verifiable by automation alone).
4. **First `workflow_dispatch` run completes successfully** (founder triggers manually after secrets are added). The run logs show `[success] Apple JWT rotated.`
5. **After the first run, Supabase Dashboard → Authentication → Providers → Apple → Secret Key** is non-empty (new JWT in place).
6. **Web Apple sign-in still works** post-rotation (founder tests on web — should be transparent, no behavioural difference).
7. **GitHub Actions cron schedule registered** — visible in the Actions tab, "Next scheduled run" shown.
8. **Failure path tested** — implementor temporarily breaks one secret (e.g., wrong PAT), runs manually, verifies a failure-issue is auto-created, then restores the secret and re-runs to verify recovery.
9. **TypeScript / linter checks for `mingla-business/`** still pass (no source changes affect them; `scripts/` is outside the TS project).
10. **Implementor report** written at `Mingla_Artifacts/reports/IMPLEMENTATION_APPLE_JWT_AUTOROTATE.md` with:
    - Old → New receipts for both new files
    - Verification matrix mapping success criteria 1–9 to PASS/UNVERIFIED status
    - Founder-side setup steps (with EXACT secret values for the 4 known constants — `APPLE_TEAM_ID`, `APPLE_SERVICE_ID`, `APPLE_KEY_ID`, `SUPABASE_PROJECT_REF`)

---

## 4. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | First manual run (post-setup) | All 6 secrets set correctly, workflow_dispatch | Workflow runs in <60s; logs `[success]`; Supabase Apple Secret Key field non-empty | Full stack |
| T-02 | JWT actually rotates | Run T-01, then re-run T-01 immediately | Both runs succeed; the JWT in Supabase changes between runs (verify by checking JWT prefix in logs differs) | Full stack |
| T-03 | Web Apple sign-in unaffected | Post-T-01 | Sign in with Apple on web → Home loads → sign out → sign in again → still works | Runtime |
| T-04 | Cron schedule registered | After workflow file merged | GitHub Actions UI shows "Scheduled" with next run timestamp | CI |
| T-05 | Failure issue creation — bad PAT | Set `SUPABASE_MANAGEMENT_TOKEN` to invalid string, manual trigger | Workflow exits 3; issue auto-opened with title `🔴 Apple JWT rotation failed` | CI + alerting |
| T-06 | Failure issue creation — missing key | Unset `APPLE_P8_PRIVATE_KEY`, manual trigger | Workflow exits 1; issue auto-opened | CI + alerting |
| T-07 | Recovery from failure | After T-05/T-06, restore secret + re-run manually | Workflow succeeds; previous failure issue stays open until manually closed (no auto-close to avoid masking ongoing problems) | CI + ops |
| T-08 | Verification step catches bad PATCH | (Hard to fault-inject in tests) Code-trace verify the verification logic checks `external_apple_enabled === true` AND `external_apple_client_id` contains the Service ID AND `external_apple_secret` is non-empty | Verification logic exits 5 if any check fails | Code-trace |
| T-09 | Native iOS/Android Apple sign-in unaffected | Post-T-01, smoke iOS dev client | Native Apple sign-in works exactly as before (uses ID-token flow, JWT untouched) | Mobile |

---

## 5. Implementation Order

1. **Create `scripts/rotate-apple-jwt.mjs`** with §2.2 content verbatim
2. **Create `.github/workflows/rotate-apple-jwt.yml`** with §2.3 content verbatim
3. **Verify file paths and indentation are correct** — YAML is whitespace-sensitive; JS module path must match the workflow's `node scripts/...` invocation
4. **Run `npx tsc --noEmit` from `mingla-business/`** — must still exit 0 (this is unchanged territory; sanity check)
5. **Commit + push the new files**. The cron registers when the file lands on the default branch (typically `main`).
6. **Founder action — add 6 GitHub Actions secrets** per §2.1 table. Implementor cannot do this; provide founder a checklist with copy-pasteable values for the 4 known constants.
7. **Founder action — create a Supabase Personal Access Token** at Supabase Dashboard → Account → Access Tokens → "Generate new token". Name it "Mingla Apple JWT rotation". Copy the token value. Add it as `SUPABASE_MANAGEMENT_TOKEN` GitHub secret.
8. **Founder action — paste the .p8 file contents** as `APPLE_P8_PRIVATE_KEY` GitHub secret. The full multi-line content including BEGIN/END lines goes in the "Value" field; GitHub Actions handles multi-line secrets correctly.
9. **First manual run** — Actions tab → "Rotate Apple OAuth JWT" → Run workflow → observe logs. Verify success.
10. **Founder smoke-test web Apple sign-in** — confirm the rotation didn't break anything. Native iOS/Android Apple sign-in not affected (no JWT involved on native).
11. **Implementor writes report** at `Mingla_Artifacts/reports/IMPLEMENTATION_APPLE_JWT_AUTOROTATE.md` per §3.10 success criterion.
12. **Implementor writes a clear founder-handoff section** in the report with paste-by-paste setup instructions for the 6 secrets — the founder uses this to complete steps 6-8.

---

## 6. Invariants

| ID | Description | How preserved |
|--|--|--|
| I-1 | designSystem.ts not touched | Out of scope |
| I-2 | Auth flow on iOS/Android unchanged | No source code changes; only Supabase auth-config secret_key field updated, transparent to runtime |
| I-3 | iOS / Android / web all execute | Auto-rotation is invisible to all three — they continue using whatever JWT is currently in Supabase |
| I-4 | No imports from `app-mobile/` | New files don't import anything from app-mobile |
| I-5 | Mingla = experience app | Out of scope |
| I-6 | tsc strict clean | New files are CI scripts (.mjs, .yml), not part of TS project |
| I-7 | No silent failures | Failure-issue creation on any error is non-optional |
| I-8 | No Supabase code touched | We only update auth config via Management API, not migrations or RLS |
| I-9 | No animation timings touched | Out of scope |
| I-10 | No copy / currency changes | Out of scope |
| **I-NEW (proposed)** | "Production Apple OAuth JWT MUST be ≤180 days from issuance AND ≥30 days from expiry, OR an active rotation is in flight (open rotation-failure issue)." | Cron runs every 5 months; failure issue opens immediately on any failure |

---

## 7. Regression Prevention

1. **Workflow header comment** explicitly cites the spec + investigation + Apple's 180-day constraint. Future maintainers reading the file see the rationale, not just the YAML.
2. **Operator runbook in the workflow header** covers the 3 most likely operational scenarios (rotate .p8, rotate PAT, emergency rotation). No tribal knowledge required.
3. **Failure issue body** includes triage steps mapped to exit codes — when something breaks at 3am, the on-call has a checklist.
4. **First-run is manual (workflow_dispatch)**, not cron — implementor + founder verify the workflow works before relying on it. After the first successful run, cron can be trusted.
5. **The remote-trigger reminder agent stays as a backstop** — orchestrator updates its prompt post-implementation to verify auto-rotation succeeded rather than instruct manual rotation.

---

## 8. Cache Safety / Parity / Constitution

- No React Query keys changed.
- No persisted state changes.
- No solo/collab parity (not relevant to this layer).
- Constitution #3 (no silent failures): satisfied via failure-issue creation.
- Constitution #7 (label temporary fixes): N/A — auto-rotation is permanent infrastructure, not a stopgap.
- DEC-079 (kit closure): unaffected.
- DEC-081 (mingla-web discontinued): honoured — no `mingla-web/` work.

---

## 9. Implementor Handoff Checklist

Before declaring this spec implemented, the implementor MUST confirm:

- [ ] `scripts/rotate-apple-jwt.mjs` exists with §2.2 content
- [ ] `.github/workflows/rotate-apple-jwt.yml` exists with §2.3 content
- [ ] `npx tsc --noEmit` from `mingla-business/` exits 0
- [ ] Implementor report written: `Mingla_Artifacts/reports/IMPLEMENTATION_APPLE_JWT_AUTOROTATE.md`
- [ ] Report includes a founder-handoff checklist with EXACT paste-able values for the 4 constant secrets (`APPLE_TEAM_ID`, `APPLE_SERVICE_ID`, `APPLE_KEY_ID`, `SUPABASE_PROJECT_REF`)
- [ ] AGENT_HANDOFFS.md entry pending for orchestrator

After implementor lands, founder MUST (separate, post-merge step):

- [ ] Create Supabase Personal Access Token + add as GitHub secret
- [ ] Paste .p8 contents as GitHub secret
- [ ] Add the 4 constant secrets
- [ ] Manually trigger the workflow once (workflow_dispatch)
- [ ] Verify run succeeds + Supabase Secret Key field non-empty
- [ ] Smoke-test web Apple sign-in still works
- [ ] Verify cron is registered (Actions tab → "Next scheduled run")

After all founder steps pass, orchestrator MUST (separate, ratification step):

- [ ] Update remote-trigger agent `trig_01EScEkMCdccJ5aRie4PphuE` prompt to "verify auto-rotation succeeded" rather than "instruct manual rotation"
- [ ] Update D-IMPL-46 status in IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md from "manual rotation reminder" to "auto-rotation in place; reminder agent is safety net"
- [ ] Add INV-NEW (proposed in §6) to canonical invariant registry once it exists

---

**End of Apple JWT Auto-Rotation spec.**
