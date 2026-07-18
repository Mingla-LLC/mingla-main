# TEST — ORCH-1386 [expo-57 revert — native builds restored + framework-major guard]

**Skill:** mingla-tester (Claude) — TEST phase, dispatched sub-agent
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1386-[expo57-revert-native-builds]/` on branch `ORCH-1386-expo57-revert-native-builds`, rebased onto origin/main (`d1065988e`); commits under test rehashed to fix `74221352d` / guard `76648781b` / report `a634b9d71`
**Date:** 2026-07-17
**Under test:** `IMPLEMENTATION_ORCH-1386_EXPO57_REVERT.md` (every claim assumed FALSE until reproduced)

---

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 3 · P4: 3

Phase 0.A exemption: build-config / CI-gate / dependency lane — zero UI/runtime surface shipped.
Live-fire here IS the build lane: pristine `npm ci` + native/web export exit codes, executed by my
own hand on this machine. No sim/device matrix applies; no physical-iPhone HITL step exists for
this change (nothing user-touchable shipped).

The headline causal chain is proven from my own seat: the `buffer` failure RETURNS when the revert
is reverted and VANISHES when restored (§4). The guard survived my transitive-disguise and
prerelease attacks everywhere the built artifact could actually change; three P3 wall-gaps are
pinned with evidence (§5). The implementor's entire battery re-ran green independently, including
BOTH apps' pristine-install native exports (§3). Dependabot config is schema-valid against the
official SchemaStore dependabot-2.0 schema (§7).

## 2. Claim-by-claim matrix (implementation report §2 SC decomposition)

| SC | Claim | Verdict | My independent evidence |
|----|-------|---------|------------------------|
| SC-1 | buffer repro was real | PASS (re-proven from my angle) | A-3 drill (§4): expo flipped to ~57 → `npm install` → export exit 1 with byte-identical error text |
| SC-2 | #925 mobile manifest delta = exactly one expo line per app; revert surgical | PASS | `git show ca99afd88 -- <manifests>` shows only `expo ~54.0.34→~57.0.6` ×2; branch diff = exactly those two lines back + `babel-preset-expo ~54.0.12` in app-mobile devDeps |
| SC-3 | lockfile regen minimal; @mingla linkage intact; security bumps survive | PASS | Programmatic JSON compare: 12 `@mingla` linkage entries per app byte-identical to origin/main; ws 6.2.5 (both RN paths), @xmldom/xmldom 0.8.13, node-forge 1.4.0, fast-uri 3.1.3, flatted 3.4.2 all present; `buffer 5.7.1` restored both apps; expo resolves 54.0.36; ZERO 56/57-era family residue in either lockfile |
| SC-4a | native lane exit 0 both apps from pristine `npm ci` | PASS | My own runs: app-mobile `npm ci` + `expo export -p ios` exit 0 (42MB export, 18MB `.hbc` Hermes bundle verified on disk — not a metadata-only stub); mingla-business `npm ci` + iOS export exit 0 |
| SC-4b | web lane: the check's 3 exact commands green | PASS | `npx expo export -p web` exit 0; ORCH-1083 budget PASS with initial payload **3253650 bytes / 148 chunks — byte-identical to the implementor's figure**; ORCH-1137 glyph render-proof PASS (both signatures) |
| SC-4c | prior gates green; tsc zero NEW | PASS | ORCH-1385: self-test 8/8, gate PASS, companion 5/5, adversarial 12/12 (my run). ORCH-1387 gate confirmed NOT in this tree (unmerged branch; zero file overlap — verified in `.github/scripts/strict-grep/` listing). tsc: mingla-business 952 lines / 804 `error TS`, app-mobile 1027 / 905 — EXACT match to §7's table; D-3 CountryPickerModal(355) present ×1; expo-57 `expo-file-system` TS2307s gone ×0 |
| SC-5 | Dependabot config correct | PASS (schema-level) | §7 — parse + official-schema + semantics all green; GitHub live parse = post-merge orchestrator check per dispatch |
| SC-6 | guard + tests + 3 fails-on-revert drills | PASS | §3 battery + §6 Step 0.5 (all three drills re-run red-then-green by my hand) |
| SC-7 | clean commits, no stash/merge/deploy | PASS | Zero `git stash` this session; foreign `stash@{0}: On main: anchor-uncommitted-pre-ORCH1318-build` verified intact before AND after; `git status` clean after every scratch drill; A-8 hold check: 0 `[deploy]` tokens in branch commits, 0 EAS/OTA files in the branch diff |

## 3. Independent battery re-run (clean seat, my own hand)

- ORCH-1386 gate `--self-test`: **14/14 PASS**. Gate real-tree run: **PASS exit 0**. Companion: **9/9**.
- ORCH-1385 battery: self-test **8/8**, gate **PASS**, companion **5/5**, adversarial **12/12**.
- app-mobile: pristine `npm ci` (final lockfile) → `npx expo export --platform ios` **exit 0**, export verified real (`_expo/static/js/ios/entry-6ea06b14….hbc`, 18MB; 42MB total).
- mingla-business: pristine `npm ci` → iOS export **exit 0**; web lane 3/3 commands green, budget figure byte-identical (3253650).
- tsc both apps: exact match to the implementor's §7 counts (see SC-4c row).
- YAML: `framework-major-guard.yml`, `orch-1386-tester-adversarial.yml` (mine), `dependabot.yml` all parse via js-yaml.

## 4. A-3 headline — the buffer failure RETURNS on revert-of-revert (live-fire, my angle)

Scratch state, never committed, fully restored (`git status` clean after; no stash):

1. **Pristine @ HEAD:** app-mobile `npm ci` → iOS export **exit 0** (real bundle on disk).
2. **Revert-the-revert:** `expo` flipped to `~57.0.6` in app-mobile/package.json → `npm install`
   (expo **57.0.7** on disk — current in-range patch of the same 57 major) → `npx expo export
   --platform ios` → **exit 1**:
   `Error: Unable to resolve module buffer from /…/app-mobile/node_modules/react-native-svg/src/utils/fetchData.ts: buffer could not be found within the project…`
   — the exact ORCH-1385 §12 D-2 failure, with the import chain traced
   (`BrandIcons.tsx → react-native-svg`). The fix is load-bearing, not coincidental.
3. **Restore:** `git checkout` manifest+lockfile → `npm ci` (expo **54.0.36** on disk) → export
   **exit 0**.

## 5. Guard attack results (A-1 transitive disguises, A-2 prerelease parser, A-4 registry tamper)

All via the REAL shipped module (COMMS-0106) on copies of the REAL manifests/lockfiles, plus one
CLI live-fire on the real tree (scratch, restored). Note: my first probe batch ran concurrently
with the A-3 scratch install and was CONTAMINATED (it read the live 57-flipped files); every
affected probe was re-run on the restored pristine tree — the results below are the clean runs.

**HELD (10):**
- Root framework package (`node_modules/expo`) moved lockfile-only, manifest untouched → exactly 1 violation, correctly named. **CLI live-fire too:** real lockfile tampered → gate binary exit 1 with the TRANSITIVE-disguise message → restore exit 0.
- Nested-only path (`node_modules/expo/node_modules/@expo/metro-config` @57) → flagged, correct last-segment attribution.
- NEW family package lockfile-only injection (mingla-business, `@expo/dom-webview` @57) → NEW-package wall fires.
- Family key with npm-alias spec (`expo: "npm:expo@57.0.6"`) → fail-loud un-pinnable.
- Prerelease matrix: `57.0.0-rc.1`→57, `~54.0.34-beta`→54, `~57.0.0-beta.2+build.7`→57, `0.82.0-nightly-…`→0.82 — no prerelease bypass; `workspace:*`, `file:`, `git+`, `latest`, `*`, `""`, `"0"` → null → fail-loud. (`~>54`→54 is CORRECT node-semver, `~>` aliases `~`.)
- FULL registry tamper (attacker regenerates the registry approving 57 in both apps) → checks A/B beaten as designed, **pairing wall kills it with 2 violations** — the last line holds.
- Registry lockfile allow-list widened (`expo: ["54","57"]`) → anti-drift deepEqual (companion test 8) catches.
- Ghost registry manifest entry → "no longer declares it" fires.
- Cross-app parity (54 vs 55 on real manifest copies) → fires.
- Step 0.5 drills D1/D2/D3 (§6) — all red-then-green.

**GAPS (severity-graded findings, NOT fixed here per hard guard):**

- **F-1 (P3) — alias blindness, both walls.** A lockfile entry at a non-family path carrying
  `"name": "expo", "version": "57.0.6"` (npm alias install) is invisible to check B
  (`lockPathName` keys on the path suffix; `meta.name` never read) — evidence: probe A-1d, 0
  failures. A manifest alias key (`"expo-fork": "npm:expo@57.0.6"`) is likewise invisible to
  check A (family test on the KEY only) — probe A-1e, 0 failures. **Impact bounded:** neither
  shape can move the RESOLVED `node_modules/expo` — replacing the real framework still trips A
  (manifest spec) or B (resolved version); the alias only smuggles a SECOND copy that product code
  would have to import by the alias name (a reviewable source diff). Not the #925 shape;
  Dependabot never authors aliases. **Fix (follow-up):** read `meta.name` in
  `lockfileFamilyMajors` and scan manifest spec bodies for `npm:<family>@` prefixes. Retest: my
  suite gains two cases when that lands.
- **F-2 (P3) — check A reads only `dependencies` + `devDependencies`.** A family entry in
  `optionalDependencies` (auto-installed) or `peerDependencies` (auto-installed since npm 7) is
  invisible at the manifest wall — probe A-1g, 0 failures. **Backstop holds:** installation moves
  the lockfile's resolved entries, which check B rejects (proven in A-1a). **Fix (follow-up):**
  merge those two maps into `manifestFamilyDeps`.
- **F-3 (P3) — range lower-bound laxity.** `majorLineOf(">=54 <58")` → "54" and
  `"54.x || 57.x"` → "54": a manifest range PERMITTING 57 sails through check A and the pairing
  check — probe A-1h, 0 failures. **Backstop holds:** the artifact that builds is pinned by the
  lockfile; any resolution at 57 changes the lockfile and check B fires. Behaviour now PINNED in
  my T5 with an in-test comment so a silent parser change surfaces. **Fix (follow-up, optional):**
  reject specs whose range spans multiple majors for family deps.

**P4 notes:**
- **F-4 (P4):** the shipped `framework-major-guard.yml` runs only the companion suite; my
  adversarial suite is registered via a NEW workflow `orch-1386-tester-adversarial.yml`
  (ORCH-1371/1372 precedent — zero edits to existing workflows per the hard guard). Orchestrator
  MAY fold it into the guard workflow as a step at CLOSE instead (the ORCH-1385 CLOSE pattern);
  either registration satisfies the net.
- **F-5 (P4):** companion test 7's first line `runAll(root, null) && runAll(root)` is a truthy
  no-op (an empty array is truthy, so the expression always yields the second call) — cosmetic;
  the assertion that follows still verifies the real thing.
- **F-6 (P4, praise):** the registry-pinned two-sided design is genuinely strong — writer- and
  event-independent (immune to the COMMS-0106/0109 trap classes), fails closed with no registry,
  and the pairing table survived a full registry tamper. The fail-loud null contract on
  alias/workspace/git specs is exactly right.

## 6. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Implementor's drills at pre-rebase `4480a5b08`; re-run by my hand at rebased `a634b9d71`:

- **D1 (revert-the-revert):** `expo` → `~57.0.6` both manifests (sed, no stash) → gate **exit 1
  with exactly 4 violations** (major-moved ×2, no-approved-pairing ×2 — texts captured verbatim);
  companion **5 pass / 4 fail**. `git checkout` restore → gate **exit 0**, companion 9/9.
- **D2 (declaration deletion):** `babel-preset-expo` devDeps line deleted → companion test 9 fails
  with the doctrine message (captured). Restore → 9/9.
- **D3 (fails-closed):** registry file moved aside → gate **exit 1**, "Cannot read registry … the
  gate fails closed" (no silent pass). Restore → exit 0.

## 7. Dependabot config validation (schema-level per dispatch)

- Parses clean via js-yaml (version 2, 4 update blocks).
- **SCHEMA VALID against the official SchemaStore `dependabot-2.0.json`** (fetched live,
  47,351 bytes; validated with ajv, allErrors, zero violations).
- Semantics verified programmatically: 4 npm blocks in exactly the four #925 directories
  (`/app-mobile`, `/mingla-business`, `/mingla-admin`, `/mingla-marketing`); each carries the full
  10-name family ignore (`expo`, `@expo/*`, `react-native`, `@react-native/*`, `react`,
  `react-dom`, `next`, `vite`, `metro`, `metro-*`) with `version-update:semver-major`, PLUS
  `semver-minor` on the 0.x react-native family; `open-pull-requests-limit: 0` preserves the
  security-only posture; no YAML anchors (Dependabot's parser rejects them).
- GitHub's LIVE parse (Insights → Dependency graph → Dependabot) = post-merge orchestrator check.

## 8. Adversarial test added (tester-owned, different angles)

- **Path:** `.github/scripts/strict-grep/orch-1386-framework-major-guard.adversarial.test.mjs` —
  9 cases T1–T9, ALL importing the REAL shipped gate module (COMMS-0106 provenance; nothing
  re-implemented). Angle deltas vs the companion are documented in the file header: root-package
  lockfile-only major, nested-only path, the mingla-business lockfile, npm-alias family spec,
  exotic/prerelease parser pins incl. the documented range laxity, full-registry-tamper vs the
  pairing wall, the `EXPO_RN_PAIRING` table pin, cross-app parity on real manifest copies, and the
  `runAll()` aggregator end-to-end on a scratch tree of the real four apps.
- **CI registration:** NEW workflow `.github/workflows/orch-1386-tester-adversarial.yml`
  (paths-filtered to the same manifest/lockfile/guard set).
- **fails-on-revert verified at `a634b9d71`, two-sided:** (a) FIX side — expo flipped to `~57.0.6`
  in the shipped app-mobile manifest → T9 red (8/1), restore → 9/9; (b) GATE side — the
  checkLockfile outside-approved-set failure push line-deleted → **T1+T2+T9 red (6/3)**, restore →
  9/9. On the shipped tree: 9/9 green.
- Both the implementor's test artifacts AND my two files appear in
  `git diff origin/main...HEAD --name-only` for the closing PR (verified post-commit).
- Append-only honored: zero existing test/workflow files modified.

## 9. Constitution 14-rule matrix

Build-config/CI/dependency lane; zero product source in the diff (verified: diff touches only
manifests, lockfiles, guard/test/workflow/dependabot files, and artifacts).

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | no UI shipped |
| 2 | One owner per truth | PASS | one registry file owns approved majors; two-sided pin + anti-drift test keeps it the sole owner |
| 3 | No silent failures | PASS | gate fails CLOSED on missing registry (D3, my run); un-parseable family specs fail loud, never default |
| 4 | One query key per entity | N/A | — |
| 5 | Server state server-side | N/A | — |
| 6 | Logout clears everything | N/A | — |
| 7 | `[TRANSITIONAL]` labeled | PASS | none introduced (grepped diff) |
| 8 | Subtract before adding | PASS | the fix IS a subtraction (revert); net lockfile lines −215 / −657 |
| 9 | No fabricated data | N/A | — |
| 10 | Currency-aware | N/A | — |
| 11 | One auth instance | N/A | — |
| 12 | Validate at the right time | N/A | — |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | — |

## 10. Device / parity matrix

Build-lane change; parity = per-surface build verification, not sim driving (Phase 0.A exemption).

| Surface | Result | Evidence |
|---|---|---|
| Consumer iOS (app-mobile native bundle) | PASS | my pristine `npm ci` + iOS export exit 0, real 18MB `.hbc` on disk |
| Consumer Android | PASS-by-lane | same JS bundle lane (expo export platform legs share resolution; the buffer failure was platform-agnostic module resolution) — no Android-specific claim was made or needed |
| Business iOS (mingla-business native bundle) | PASS | my pristine `npm ci` + iOS export exit 0 |
| Business Android | PASS-by-lane | as consumer Android |
| Buyer/anon Web (business web) | PASS | the web-build check's 3 exact commands green by my hand; budget byte-identical (3253650); still deploy-frozen until CLOSE lifts the hold |
| Admin Web | skipped — not shipped to | `mingla-admin/**` untouched on this branch (diff-verified); vite-8 lane out of scope |
| Marketing / Business Web preview | skipped — not shipped to | `mingla-marketing/**` untouched (diff-verified) |
| Physical iPhone HITL | N/A | no user-touchable runtime change exists to eyeball |

Edge functions / migrations: none in this branch (verified — no `supabase/` paths in the diff).

## 11. Discoveries for Orchestrator

- **TD-1 (routes with implementor D-1):** the native-bundle CI gap is real and my run re-confirms
  the cost estimate is honest — a cold `npm ci` + `expo export -p ios` for one app ran ~4–6 min on
  this machine; a paths-filtered CI job would have caught #925 at the PR.
- **TD-2 (process, new):** parallel scratch-state legs and module-probe legs in the SAME worktree
  contaminate each other — my first A-1 probe batch read the A-3 leg's 57-flipped live files and
  produced plausible-but-wrong HELD verdicts. Caught because probe detail texts named the wrong
  package. Rule of thumb for future testers: serialize any probe that reads live tree files
  against any scratch mutation, or point probes at frozen copies.
- **TD-3 (follow-up candidate):** F-1/F-2/F-3 guard hardenings (alias `meta.name` scan,
  optional/peer deps in check A, multi-major range rejection) — one small hygiene ORCH; my
  adversarial suite is ready to grow cases for each.
- **TD-4 (CLOSE choice):** adversarial-suite CI registration shipped as its own workflow (F-4);
  fold-in at CLOSE is equally valid — pick one, not both.

## 12. Accepted conditions

None required — verdict is unconditional PASS. (The in-range family patch drift — expo 54.0.36 vs
the live binaries' .34 — was already ACCEPTED at REVIEW per the WORLD_MAP stanza; my lockfile review
confirms it is exactly what tilde-spec semantics produce and EAS would resolve identically.)
