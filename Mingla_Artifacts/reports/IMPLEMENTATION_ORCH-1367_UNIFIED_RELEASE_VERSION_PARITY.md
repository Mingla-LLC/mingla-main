# IMPLEMENTATION — ORCH-1367 [unified-release-version]

**Status:** implemented and verified (config + CI gate; no runtime UI).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1367-[unified-release-version]/` on branch `ORCH-1367-unified-release-version`.
**Date:** 2026-07-14.
**Commit:** `022d965be` (single IMPLEMENT commit — all SCs below satisfied by it).

---

## 1. Summary

The two Mingla mobile apps had silently drifted apart on their marketing version: the consumer app (`app-mobile`) was on **1.1.1** (bumped at ORCH-1318) while the business app (`mingla-business`) was on **1.1.0** (last shipped as business 1.1.0/build-32 at ORCH-1355). This change unifies both to **1.1.2** and adds a CI parity gate so they can never diverge on `main` again — the build now fails the instant the two `expo.version` values disagree.

Nothing user-facing changes at runtime. This is a release-hygiene + CI-guard change: two one-line version bumps, one new strict-grep gate, its workflow wiring + README/registry registration.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied by (commit `022d965be`) |
|----|-----------|--------|------------------------------------------|
| SC-1 | `app-mobile/app.json` `expo.version` = "1.1.2" (was "1.1.1"); only that field changed | ✓ | `app-mobile/app.json` line 5 |
| SC-2 | `mingla-business/app.json` `expo.version` = "1.1.2" (was "1.1.0"); only that field changed | ✓ | `mingla-business/app.json` line 5 |
| SC-3 | `runtimeVersion`, `ios.buildNumber`, `android.versionCode`, `eas.json` untouched | ✓ | diff shows only the two `version` lines changed in the app.json files |
| SC-4 | CI gate fails the build when the two `expo.version` values diverge | ✓ | `.github/scripts/strict-grep/orch-1367-release-version-parity.mjs` + workflow job `orch-1367-release-version-parity` |
| SC-5 | Gate wired into the runner that invokes the other strict-grep gates | ✓ | `.github/workflows/strict-grep-mingla-business.yml` (new job) + README table row |
| SC-6 | Invariant `I-RELEASE-VERSION-PARITY` registered DRAFT with the full triad | ✓ | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (new DRAFT section) |
| SC-7 | Fails-on-revert proven for the gate | ✓ | §6 below (live gate exit 1 on divergence, exit 0 on parity) |

---

## 3. Files changed

| File | Change | Δ |
|------|--------|---|
| `app-mobile/app.json` | `expo.version` "1.1.1" → "1.1.2" | +1 / -1 |
| `mingla-business/app.json` | `expo.version` "1.1.0" → "1.1.2" | +1 / -1 |
| `.github/scripts/strict-grep/orch-1367-release-version-parity.mjs` | NEW gate script | +178 (new) |
| `.github/workflows/strict-grep-mingla-business.yml` | NEW CI job `orch-1367-release-version-parity` | +13 |
| `.github/scripts/strict-grep/README.md` | new row in "Active gates registered" | +1 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | new DRAFT section + `I-RELEASE-VERSION-PARITY` triad | +12 |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1367_UNIFIED_RELEASE_VERSION_PARITY.md` | this report | new |

---

## 4. Data-model changes applied

None. No migrations, no schema, no RLS. Backend untouched.

---

## 5. Edge functions touched

None.

---

## 6. Regression test — the gate + fails-on-revert proof

The gate script IS the enforcement + regression test (the established strict-grep config-gate pattern, matching the precedent config gates `orch-1321`/`orch-1322`: "self-tested N/N + fails-on-revert", no separate `.test.ts`). It is a new, append-only file at a real repo path.

**Path:** `.github/scripts/strict-grep/orch-1367-release-version-parity.mjs`

**`--self-test` (synthetic, baked into the script — 6/6 cases):**
```
$ node .github/scripts/strict-grep/orch-1367-release-version-parity.mjs --self-test
ORCH-1367 release-version-parity self-test PASS (6/6 cases).   (exit 0)
```
Cases: matching versions pass; 1.1.1-vs-1.1.0 divergence fails; 1.1.2-vs-1.1.1 divergence fails; missing consumer version fails; blank business version fails; invalid JSON fails.

**Real run on the actual repo files (both at 1.1.2 → PASS):**
```
$ node .github/scripts/strict-grep/orch-1367-release-version-parity.mjs
ORCH-1367 I-RELEASE-VERSION-PARITY PASS — app-mobile/app.json and mingla-business/app.json both carry expo.version "1.1.2".   (exit 0)
```

**Fails-on-revert — proven with the LIVE gate via a true value change (not a comment-out):**
```
# STEP A — set mingla-business/app.json expo.version 1.1.2 -> 1.1.0 (the old divergent value)
# STEP B — run the live gate:
$ node .github/scripts/strict-grep/orch-1367-release-version-parity.mjs
ORCH-1367 I-RELEASE-VERSION-PARITY FAIL:
  expo.version diverges across the two apps — they MUST match on main:
  app-mobile/app.json = "1.1.2", mingla-business/app.json = "1.1.0".
  Unify both to the same release version before merging.
GATE_EXIT=1
# STEP C — restore mingla-business/app.json expo.version 1.1.0 -> 1.1.2
# STEP D — re-run the live gate:
$ node .github/scripts/strict-grep/orch-1367-release-version-parity.mjs
ORCH-1367 I-RELEASE-VERSION-PARITY PASS — ... expo.version "1.1.2".
GATE_EXIT=0
```
`git diff` after restore confirmed the only net change to `mingla-business/app.json` is the intended `1.1.0 → 1.1.2` bump (clean restore, no residue).

**fails-on-revert verified at `022d965be`** (test path `.github/scripts/strict-grep/orch-1367-release-version-parity.mjs`; live-gate exit 1 on divergence, exit 0 on parity; `--self-test` 6/6).

---

## 7. Old → New receipts

### app-mobile/app.json
**What it did before:** declared `expo.version: "1.1.1"`.
**What it does now:** declares `expo.version: "1.1.2"`.
**Why:** SC-1 — unify the consumer marketing version with the business app to the matched 1.1.2 release.
**Lines changed:** 1.

### mingla-business/app.json
**What it did before:** declared `expo.version: "1.1.0"`.
**What it does now:** declares `expo.version: "1.1.2"`.
**Why:** SC-2 — unify the business marketing version with the consumer app to the matched 1.1.2 release.
**Lines changed:** 1.

### .github/scripts/strict-grep/orch-1367-release-version-parity.mjs (NEW)
**What it did before:** did not exist.
**What it does now:** reads `expo.version` from both `app-mobile/app.json` and `mingla-business/app.json`; exits non-zero (1) when either version is missing/blank/unparseable or the two differ; exits 0 when equal; `--self-test` proves 6/6; exits 2 on a script error (app.json not found). Pure node builtins — no dependencies (matches the `orch-1321` config-gate precedent).
**Why:** SC-4 — enforce version parity in CI.
**Lines changed:** +178 (new file).

### .github/workflows/strict-grep-mingla-business.yml
**What it did before:** ran the existing strict-grep gates; last job `orch-1355-draft-promotion-no-remount`.
**What it does now:** additionally runs `orch-1367-release-version-parity` (self-test step + real-run step), same checkout + setup-node@20 shape as the other config gates.
**Why:** SC-5 — wire the gate into the runner that invokes the other strict-grep gates. The workflow's `paths` triggers already include both `app-mobile/**` and `mingla-business/**`, so the gate runs on any future version change to either app.
**Lines changed:** +13.

### .github/scripts/strict-grep/README.md
**What it did before:** "Active gates registered" table ended at the ORCH-1355 rows.
**What it does now:** adds the `I-RELEASE-VERSION-PARITY` → `orch-1367-release-version-parity.mjs` row (step 3 of the documented 4-step registration process).
**Why:** SC-5 — registry consistency.
**Lines changed:** +1.

### Mingla_Artifacts/INVARIANT_REGISTRY.md
**What it did before:** top invariant section was the ACTIVE ORCH-1358/1359/1360 batch.
**What it does now:** adds a `## DRAFT — ORCH-1367` section with `I-RELEASE-VERSION-PARITY` (Rule / Enforcement / Regression test / Established), including the documented config-consumer coupling (see §10).
**Why:** SC-6 — register the invariant DRAFT with the full triad.
**Lines changed:** +12.

---

## 8. Cross-surface impact table

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS | Yes (build metadata only) | marketing version 1.1.1 → 1.1.2; no code/UI change. Applies at the next native 1.1.2 store build. |
| Consumer Android | Yes (build metadata only) | same version bump; shared `app-mobile/app.json`. |
| Buyer/anonymous Web | No | web build reads no marketing `version`; nothing user-visible. |
| Business iOS | Yes (build metadata only) | marketing version 1.1.0 → 1.1.2; no code/UI change. Applies at the next native 1.1.2 store build. |
| Business Android | Yes (build metadata only) | same version bump; shared `mingla-business/app.json`. |
| Admin Web (adjacent) | No | unrelated app. |
| Business Web preview (adjacent) | No | no marketing `version` surface. |

Parity across the two apps is now **enforced** by the CI gate (not manual). The version bump itself is automatic per app (single `app.json` each drives both iOS + Android for that app).

---

## 9. Smoke result

No simulator/device smoke — this is config + CI, with no runtime surface to drive. Verification is the gate itself: `node --check` (syntax OK), `--self-test` (6/6), live real-run (PASS at 1.1.2), live fails-on-revert (exit 1 on divergence / exit 0 on parity), both `app.json` files re-parse as valid JSON with `expo.version === "1.1.2"`, and the workflow YAML parses cleanly (ruby `YAML.load_file` — 334 jobs, `orch-1367-release-version-parity` present).

---

## 10. Known issues / deferred — CONFIG-CONSUMER COUPLING (documented, intentional; NOT a defect)

Both apps declare `runtimeVersion: { policy: "appVersion" }` — consumer at the top level (`app-mobile/app.json`), business per-platform under `ios` and `android` (`mingla-business/app.json`). Under this policy **the marketing `version` string IS the OTA runtime version**. Therefore bumping `version` to 1.1.2 **deliberately rebaselines the OTA runtime to 1.1.2 for both apps.**

This is **correct and intended** because a matched **native 1.1.2 store build** is being cut alongside this change. There is deliberately **no** attempt to preserve 1.1.1 OTA continuity for the consumer app and **no** change to `runtimeVersion` — the dispatch's config-consumer dependency walk confirms:
- `app.config.ts` in both apps spreads `...config` and does **not** override `version` → `app.json` is the authoritative `version` source.
- `eas.json` `appVersionSource: "remote"` governs only the build number / `versionCode` auto-increment — **not** the marketing `version` string.
- The root `./app.json` is a legacy `minglagreatdev` stub with **no** `version` field → out of scope, not compared by the gate.

Operational consequence (for the orchestrator/operator, not a code task): after merge, the next OTA update for either app must target runtime **1.1.2**, and the native 1.1.2 builds must be the ones on the stores before any 1.1.2 OTA is published. Per COMMS-0052/0063, the business app ships via native build only (no `eas update` to its production channel).

---

## 11. Operator action required

- **No migration.** No `db push`. No edge-function deploy.
- **Merge:** one PR to `main` (opened by IMPLEMENT; orchestrator/operator merges after REVIEW + tester). The `strict-grep-mingla-business.yml` workflow (incl. the new `orch-1367-release-version-parity` job) runs on the PR because the diff touches `app-mobile/**`, `mingla-business/**`, `.github/scripts/strict-grep/**`, and the workflow file itself.
- **After merge:** the native 1.1.2 store builds (consumer + business) are cut off `main` — orchestrator/operator owned. The gate then blocks any future PR that reintroduces version drift.

---

## 12. Discoveries for Orchestrator

1. **Root `./app.json` is a legacy stub** (`com.sethogieva.minglagreatdev`, projectId `76bcd738-…`, no `version`/`expo.name`). It is not one of the two shipping apps and is deliberately excluded from the parity gate. Not fixed (out of scope) — flagging in case it should be removed under a future hygiene ORCH.
2. **`eas.json appVersionSource: "remote"`** on both apps means `buildNumber`/`versionCode` are EAS-remote-managed; only the marketing `version` lives in `app.json`. No action — noted so a future reader doesn't expect build numbers in `app.json`.
3. **Comms:** read the active COMMS ledger on entry — no BLOCK rows addressed to ORCH-1367/implementor/ALL; the material WARN is COMMS-0052/0063 (never OTA the business production channel; ship business fixes as native builds), which is consistent with the 1.1.2 native-build coupling documented in §10. No new COMMS entry warranted (this ORCH is self-contained; no cross-ORCH file overlap).
