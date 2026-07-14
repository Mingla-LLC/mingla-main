# IMPLEMENTATION — ORCH-1369 [release-1.1.2-config]

**Status:** implemented and verified (config + CI gate; no runtime product code).
**Branch:** `ORCH-1369-release-1.1.2-config`
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1369-[release-1.1.2-config]/`
**Commit:** `e3dd7c90512938b1e4be0ebc77dffe21749a0478`

## 1. Summary

Hardened both apps' `eas.json` `submit.production` blocks into a release-ready
state and added a CI gate so the two learnings can't silently regress:

1. **Business iOS now carries the App Store Connect API key.** The
   `mingla-business` iOS submit block previously had only `ascAppId`, which
   forces `eas submit` into interactive Apple auth and stalls the unattended
   pipeline. Added the same three ASC API-key fields the consumer app already
   uses (`ascApiKeyPath` + `ascApiKeyId` `B39RMRV6D8` + `ascApiKeyIssuerId`
   `ee78d0ff-158c-4326-80ef-aec69745fc2d`; same key, same Apple team
   782KVMY869). Kept `ascAppId`.
2. **Both apps' Android internal-track upload now publishes.** Flipped
   `submit.production.android.releaseStatus` from `"draft"` to `"completed"` in
   BOTH `mingla-business/eas.json` and `app-mobile/eas.json`. A draft
   internal-track upload is unpublished and non-installable by internal testers;
   `"completed"` makes it installable. `track` stays `"internal"` — this is NOT
   a public rollout.
3. **New strict-grep gate** `orch-1369-release-submit-config.mjs`
   (I-RELEASE-SUBMIT-CONFIG) fails CI if either app's android `releaseStatus`
   is `"draft"`, or if the business iOS block is missing any of the three ASC
   API-key fields. Wired as a PR-blocking job + README row + INVARIANT_REGISTRY
   DRAFT entry.

Nothing else touched — no build profiles, app versions, `runtimeVersion`,
`updates`/OTA config, `track`, or the `.p8` key file.

## 2. SPEC success-criteria coverage

| SC | Requirement | Verified | Commit |
|----|-------------|----------|--------|
| SC-1 | business `eas.json` iOS gains `ascApiKeyPath`/`ascApiKeyId`/`ascApiKeyIssuerId` (keep `ascAppId`) | ✓ file shows all four fields; gate live PASS | `e3dd7c905` |
| SC-2 | business `eas.json` android `releaseStatus` `draft`→`completed` (track unchanged `internal`) | ✓ value is `completed`; `track` still `internal` | `e3dd7c905` |
| SC-3 | consumer `eas.json` android `releaseStatus` `draft`→`completed` (track unchanged `internal`) | ✓ value is `completed`; `track` still `internal` | `e3dd7c905` |
| SC-4 | strict-grep gate fails on (a) either `releaseStatus === "draft"` OR (b) missing any business-iOS ASC field; `--self-test` present | ✓ self-test 8/8 + fails-on-revert 3/3 | `e3dd7c905` |
| SC-5 | gate wired into runner + README row | ✓ CI job `orch-1369-release-submit-config` + README table row | `e3dd7c905` |

## 3. Files changed

| File | Change | ~lines |
|------|--------|--------|
| `mingla-business/eas.json` | +3 iOS ASC key fields; android releaseStatus draft→completed | +4 / -1 |
| `app-mobile/eas.json` | android releaseStatus draft→completed | +1 / -1 |
| `.github/scripts/strict-grep/orch-1369-release-submit-config.mjs` | NEW gate (self-test 8/8) | +~290 |
| `.github/workflows/strict-grep-mingla-business.yml` | +1 CI job wiring the gate | +13 |
| `.github/scripts/strict-grep/README.md` | +1 registry row (I-RELEASE-SUBMIT-CONFIG) | +1 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +1 DRAFT block + invariant entry | +8 |

## 4. Data-model changes applied

None. No migrations, no schema, no RLS.

## 5. Edge functions touched

None.

## 6. Regression tests added

The deliverable IS a regression gate. `orch-1369-release-submit-config.mjs`:
- `--self-test`: **8/8 PASS** (good pair passes; consumer-draft fails;
  business-draft fails; missing/blank/dropped business-iOS ASC field fails;
  bare `ascAppId`-only iOS block fails; invalid JSON fails).
- **fails-on-revert verified at `e3dd7c905`** by true value change against the
  committed files:
  - business android `completed`→`draft` → gate exit **1** ✓ → restored → exit 0
  - consumer android `completed`→`draft` → gate exit **1** ✓ → restored → exit 0
  - business iOS `ascApiKeyId` line deleted → gate exit **1** ✓ → restored → exit 0
  - restored state → gate exit **0** ✓

No separate jest/deno test: this ORCH has zero runtime product code; the gate +
its self-test + the live fails-on-revert proof are the regression protection.

## 7. Old → New receipts

### mingla-business/eas.json
- **Before:** `submit.production.ios` = `{ "ascAppId": "6768737367" }`;
  `submit.production.android.releaseStatus` = `"draft"`.
- **Now:** iOS adds `ascApiKeyPath` + `ascApiKeyId` + `ascApiKeyIssuerId`
  (keeps `ascAppId`); android `releaseStatus` = `"completed"` (`track` still
  `"internal"`).
- **Why:** SC-1/SC-2 — unattended iOS submit via the ASC API key; installable
  Android internal build.

### app-mobile/eas.json
- **Before:** `submit.production.android.releaseStatus` = `"draft"`.
- **Now:** `"completed"` (`track` still `"internal"`; iOS block already had the
  three ASC fields — unchanged).
- **Why:** SC-3.

### .github/scripts/strict-grep/orch-1369-release-submit-config.mjs (new)
- Reads both `eas.json` files; asserts A (consumer android=completed), B
  (business android=completed), C (business iOS has all three ASC fields);
  exit 0/1/2. Modeled on the sibling `orch-1367-release-version-parity.mjs`.
- **Why:** SC-4/SC-5.

## 8. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Consumer iOS | No | consumer iOS submit block unchanged |
| Consumer Android | Yes (release ops) | internal-track submit now publishes `completed` |
| Buyer/anon Web | No | no web surface touched |
| Business iOS | Yes (release ops) | submit now uses ASC API key (unattended) |
| Business Android | Yes (release ops) | internal-track submit now publishes `completed` |
| Admin Web (adjacent) | No | — |
| Business Web preview (adjacent) | No | — |

Impact is release-pipeline / CI only — no end-user runtime behavior changes.
Parity is explicit (each `eas.json` edited directly); the gate enforces it.

## 9. Smoke result

- `node --check` on the gate: syntax OK.
- Both `eas.json` parse as valid JSON.
- Workflow YAML parses (js-yaml): OK; job `orch-1369-release-submit-config`
  present.
- Gate `--self-test`: PASS 8/8. Gate live: PASS. Fails-on-revert: 3/3.

## 10. Known issues / deferred

None. No `[TRANSITIONAL]` code.

## 11. Operator action required

- No migration, no edge-function deploy.
- CLOSE: orchestrator flips I-RELEASE-SUBMIT-CONFIG DRAFT → ACTIVE.
- The config is a prerequisite for the actual 1.1.2 release submits (`eas
  submit --profile production` for both apps) — that submit is a separate
  operator action, not part of this ORCH.

## 12. Discoveries for Orchestrator

None. Scope held exactly to the four requested edits + the gate wiring.
Reviewed COMMS_LEDGER active entries — no OPEN BLOCK/WARN row bears on this
config-only ORCH.
