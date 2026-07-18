# IMPLEMENTATION — ORCH-1386 [PR #925 residue — native bundling of BOTH apps broken (`buffer`/react-native-svg) + disguised unvetted expo 54→57 major bump with unsupported RN pairing]

**Skill:** mingla-implementor (Claude) — IMPLEMENT (root cause externally proven in the ORCH-1385 report §12 D-1/D-2/D-3; reproduced before fixing)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1386-[expo57-revert-native-builds]/` on branch `ORCH-1386-expo57-revert-native-builds` (rebased onto origin/main at `05042e1f6`)
**Date:** 2026-07-17
**Status:** implemented and verified (native lane BOTH apps + web lane + gates; local bundle/export dry-runs only — EAS/[deploy]/OTA HOLD respected, lifts at CLOSE)
**Commits:** fix `63a9d94d3` · guard `4480a5b08` · report (this commit)

---

## 1. Summary

Any new native build of either app cut from main would have died at bundle time: Dependabot PR
#925 (`ca99afd88`, merged red) smuggled `expo ~54.0.34 → ~57.0.6` into BOTH mobile apps — the ONLY
manifest change it made to them; every `@expo/*` 54→57 move was lockfile-transitive — leaving
react-native at 0.81.5 (an unsupported SDK pairing), and under expo-57's resolver both apps' native
bundles failed on `Unable to resolve module buffer from
node_modules/react-native-svg/src/utils/fetchData.ts`. Per Seth's approved direction (revert, not
polyfill — return to the known-good QA'd framework the live 1.1.2 binaries run), this branch
reverts the expo line to `~54.0.34` in both apps with a minimal, structurally-reviewed lockfile
regen. Native iOS export now completes with exit 0 for BOTH apps from pristine `npm ci`; the
mingla-business web-build check's exact three commands stay green under expo 54; the ORCH-1385
`file:` declarations survive byte-identical. A two-layer guard (registry-pinned CI gate + a new
`.github/dependabot.yml`) makes a framework-major batch-rider structurally impossible to land
silently again. One extra fix component was forced during implementation: `babel-preset-expo` is
now DECLARED in app-mobile's devDependencies (it was referenced by `babel.config.js` but resolved
only via hoisting accident — the ORCH-1385 undeclared-dep class; npm's incremental placement broke
it during the revert).

## 2. Work-contract coverage (dispatch step decomposition)

| SC | Contract step | Result | Evidence / commit |
|----|---------------|--------|-------------------|
| SC-1 | Reproduce FIRST on the clean branch (CI-shape native bundle) | ✓ | Pristine `npm ci` from the #925 lockfiles (expo 57.0.6 on disk, verified), then `npx expo export --platform ios`: app-mobile exit 1 at 5840 modules, mingla-business exit 1 at 5396 modules, both with the byte-identical `Unable to resolve module buffer from …/react-native-svg/src/utils/fetchData.ts` (§10 transcript). The worktree's node_modules were STALE pre-#925 (expo 54.0.34 on disk vs 57 lockfile — ORCH-1387 D-D class), so repro without `npm ci` would have false-passed |
| SC-2 | Enumerate #925's manifest deltas; revert expo-family direct deps only | ✓ `63a9d94d3` | `git show ca99afd88 -- <both package.json>` shows EXACTLY one line per app: `expo ~54.0.34→~57.0.6`. No `@expo/*` direct dep was bumped by #925 (`@expo/vector-icons` untouched; metro-config/metro moves were transitive). Reverted those two lines verbatim. react-native untouched (0.81.5), admin/marketing untouched, ORCH-1385 `file:` declarations untouched |
| SC-3 | Minimal lockfile regen + structural review; @mingla linkage intact | ✓ `63a9d94d3` | §5. Family returns to 54-era; zero non-family churn beyond four attributed entries; all 12 `@mingla` linkage entries per app byte-identical to HEAD (programmatic JSON compare) |
| SC-4a | Native lane: repro command now succeeds BOTH apps | ✓ | From pristine `npm ci` at the final lockfiles: app-mobile `AM_FINAL_EXIT=0` + `Exported`, mingla-business `MB_FINAL_EXIT=0` + `Exported`; zero `Unable to resolve` in either log (§10) |
| SC-4b | Web lane: web-build check's exact commands | ✓ | `npx expo export -p web` exit 0; `ORCH-1083 bundle-budget PASS — initial payload 3253650 bytes (ceiling 9405478), 148 chunk files, 0 deferred specifiers…`; ORCH-1137 lucide glyph render-proof PASS (both signatures). The ORCH-1385 fix holds under expo 54 |
| SC-4c | Prior gates green; typecheck diff-vs-baseline zero NEW | ✓ / n-a | ORCH-1385: self-test 8/8 + gate PASS + companion 5/5 + adversarial 12/12. ORCH-1387 gate: **not in this tree** — it lives on the unmerged ORCH-1387 branch (in TEST); nothing here can affect it and there is ZERO file overlap (my workflow is a NEW file precisely to avoid its pending `strict-grep-mingla-business.yml` edit). tsc: §7 — zero NEW errors, error count went DOWN in both apps |
| SC-5 | Dependabot guard | ✓ `4480a5b08` | Repo had NO dependabot config anywhere (the npm_and_yarn PRs are UI-side grouped security updates). Mechanism chosen: BOTH layers — new `.github/dependabot.yml` with semver-major ignore rules (ignore conditions govern security updates too; `open-pull-requests-limit: 0` preserves the security-only posture) AND a registry-pinned CI gate (see §2a for why registry-pin beats the dispatch's commit-token sketch). #925 cited in both, in-file |
| SC-6 | Regression net: happy-path tests + fails-on-revert + named tester angles | ✓ `4480a5b08` | 14-case gate `--self-test` + 9-case node:test companion (imports the REAL gate module). Fails-on-revert: §6 — three drills, all red-then-green. Tester angles: §11 |
| SC-7 | Coherent commits, push with lease, no merges/deploys/EAS/stash | ✓ | 3 commits pushed with `--force-with-lease`; local exports only; zero `git stash` (foreign `stash@{0}` untouched, verified before and after) |

### 2a. Guard-mechanism justification (contract step 5's "pick and justify")

The dispatch sketched a diff-based gate keyed on a `[FRAMEWORK-MAJOR-APPROVED]` commit token for
the no-dependabot-config case. Implemented instead as a **registry-pinned gate** (with the
Dependabot config ALSO created, as defense-in-depth at the source):

- **COMMS-0106 proved commit-message tokens are fragile in this exact repo** — the append-only
  gate reads its token from HEAD only, so any commit stacked on an approved one silently reds CI.
- **COMMS-0109 proved diff-vs-base is fragile** — check reruns reuse the merge snapshot of the
  ORIGINAL event, so a diff-based gate can evaluate against a stale base.
- The registry pin is **writer-independent, event-independent and rerun-safe**: the tree either
  matches the committed registry or it does not. Moving a major REQUIRES editing
  `orch-1386-framework-major-registry.json` in the same PR — a reviewable file diff (stronger than
  a commit-message token) that IS the deliberate-human-approval act. The pairing table
  (`EXPO_RN_PAIRING`) additionally hard-fails any expo major with no vetted react-native pairing —
  #925 would have failed BOTH walls.

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `app-mobile/package.json` | ±1, +1 | `expo ~57.0.6 → ~54.0.34`; NEW `"babel-preset-expo": "~54.0.12"` in devDependencies (§4) |
| `mingla-business/package.json` | ±1 | `expo ~57.0.6 → ~54.0.34` |
| `app-mobile/package-lock.json` | +957/−1172 (net −215) | expo family 57-era → 54-era (§5) |
| `mingla-business/package-lock.json` | +828/−1485 (net −657) | same (§5) |
| `.github/scripts/strict-grep/orch-1386-framework-major-guard.mjs` | +549 (new) | the gate: manifest majors + lockfile-resolved majors + pairing + parity, `--self-test` (14), `--print-registry` |
| `.github/scripts/strict-grep/orch-1386-framework-major-registry.json` | +441 (new) | the approved-majors registry (generated by the gate; regeneration = the deliberate-upgrade act) |
| `.github/scripts/strict-grep/orch-1386-framework-major-guard.test.mjs` | +176 (new) | 9-case companion node:test suite, real-module provenance |
| `.github/workflows/framework-major-guard.yml` | +68 (new) | CI registration in its OWN workflow (no ORCH-1387 collision), paths-filtered to the 4 manifests + 4 lockfiles + guard files |
| `.github/dependabot.yml` | +147 (new) | semver-major ignores for the framework family across all four #925 directories (anchor-free YAML — Dependabot's parser rejects anchors) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1386_EXPO57_REVERT.md` | new | this report |

DO-NOT-TOUCH compliance: react-native lines untouched (0.81.5 both apps); `mingla-admin/**` +
`mingla-marketing/**` untouched (vite-8/next-15.5 stay — their builds pass); the six ORCH-1385
`file:` declarations untouched in both manifests and byte-identical in both lockfiles; zero product
source touched; no migrations; no existing workflow edited. The ONE addition beyond the literal
revert — the `babel-preset-expo` declaration — is inside the allowlisted manifest/lockfile files
and was REQUIRED for the native lane to build at all (§4); it is doctrine-aligned (ORCH-1385) and
carries its own fails-on-revert test.

## 4. The babel-preset-expo forced fix (discovered mid-implementation)

After the manifest revert + regen, mingla-business exported clean but app-mobile failed with
`SyntaxError: … Cannot find module 'babel-preset-expo'`. Cause: `app-mobile/babel.config.js`
references `babel-preset-expo` by name, but the manifest NEVER declared it — pre-#925 it worked
because npm happened to hoist expo's own dependency to top-level (`node_modules/babel-preset-expo`
@54.0.10 in the pre-#925 lockfile). During the incremental 57→54 regen, npm legally placed the
package NESTED (`node_modules/expo/node_modules/babel-preset-expo`), where babel's project-root
resolution cannot see it. This is the exact undeclared-dep bug class ORCH-1385 just eliminated for
`@mingla/*`. Fix: declare `babel-preset-expo ~54.0.12` in devDependencies → npm places it at root
deterministically. (mingla-business has NO babel.config.js — expo's default config resolves the
preset through its own dependency chain, which is why it never broke there; left untouched per
zero-churn.) A first attempt with `npm dedupe babel-preset-expo` was REJECTED: it churned 36
package placements and still did not hoist; the lockfile was reset to HEAD and regenerated cleanly
with the declaration. Protection: companion test 9 fails if the declaration is deleted while
babel.config.js still references the preset (drill D2, §6).

## 5. Lockfile structural review (ORCH-1385 §4a method)

Structural old↔new diff of the `packages` map per lockfile (added/removed/changed enumerated,
classified framework-family vs other):

| | app-mobile | mingla-business |
|---|---|---|
| family added / removed / changed | 9 / 49 / 30 | 10 / 69 / 15 |
| non-family added / removed / changed | 44 / 21 / **4** | 40 / 27 / **2** |

- **Family movement** = the point of the ORCH: all `@expo/*` 57-era entries (dom-webview,
  inline-modules, local-build-cache-provider, log-box, metro-file-map, …) vanish; the 54-era family
  returns (`expo 54.0.36`, `@expo/metro 54.2.x`, `@expo/metro-config 54.0.17`,
  `babel-preset-expo 54.0.12`); metro itself stays 0.83.3.
- **Non-family added** (44/40) = the expo-54 toolchain's own dependency closure returning —
  including **`node_modules/buffer 5.7.1`, the polyfill whose absence WAS the failure** — plus the
  54-era CLI satellites (@urql/*, better-opn, @0no-co/graphql.web, 54-era @babel/plugin-transform-*
  for babel-preset-expo@54, nested @expo/metro server deps). All causally family-required.
- **Non-family removed** (21/27) = 57-only satellites (agent-cli-detector, dnssd-advertise,
  fb-dotslash, fetch-nodeshim, multitars, toqr, whatwg-url-minimum, zod, chromium-edge-launcher, …)
  whose 57-era parents disappeared.
- **Non-family changed — the full list, attributed:** `postcss 8.5.19→8.4.49` (both apps —
  **FORCED**: expo-54's `@expo/metro-config@54.0.17` pins `postcss@~8.4.32`, which 8.5.19 does not
  satisfy; 8.4.49 is exactly what the live 1.1.2 binaries ran, and the postcss CVE was fixed in
  8.4.31, so no vulnerability regression); `@expo/metro`-nested `hermes-estree/hermes-parser
  0.35→0.32` + `ob1 0.84.4→0.83.3` (app-mobile; nested pins of @expo/metro 56→54.2);
  `@babel/plugin-transform-react-display-name 7.28.0→7.29.7` (mingla-business; babel-preset-expo@54
  re-resolution, in-range).
- **#925's security bumps SURVIVE** (spot-checked in both final lockfiles): ws 6.2.5 (both RN
  paths), @xmldom/xmldom 0.8.13, node-forge 1.4.0, fast-uri 3.1.3, flatted 3.4.2, js-yaml 3.15.0
  (app-mobile nested), @isaacs/brace-expansion 5.0.1 (app-mobile). Reverting #925 wholesale would
  have undone these — deliberately NOT done.
- **@mingla linkage:** all 12 entries per app (6 dep refs + 6 `../packages/*` metadata/link nodes)
  **byte-identical** to HEAD, verified by programmatic JSON comparison.
- **Known in-range drift vs the pre-#925 pins (enumerated honestly):** npm resolves a CHANGED spec
  fresh, so the family landed on the newest in-range patches — `expo 54.0.36` (pre-#925 pin:
  54.0.34; live binaries built at .34), `@expo/config 12.0.13→12.0.14`, `@expo/config-plugins
  54.0.4→54.0.5`, `babel-preset-expo 54.0.10→54.0.12`, `@expo/osascript 2.4.3→2.7.1`,
  `@expo/package-manager 1.10.5→1.13.1`, similar patch-line moves. Same SDK line, same manifest
  spec semantics the live apps shipped under. Byte-pinning to .34 would have required hand-splicing
  lockfile subtrees or losing the #925 security bumps; flagged for tester/CLOSE — if Seth wants
  exact-patch parity with the live binaries, that is a follow-up decision, not an accident.

## 6. Regression tests added + fails-on-revert

1. `.github/scripts/strict-grep/orch-1386-framework-major-guard.mjs` — 14-case `--self-test`
   (parsing incl. prerelease/0.x/garbage; #925 manifest shape; unregistered family dep;
   un-pinnable spec; stale registry; transitive-only lockfile disguise; new lockfile-only family
   package; nested-path attribution; pairing pass/fail; prerelease-no-bypass; cross-app parity).
2. `.github/scripts/strict-grep/orch-1386-framework-major-guard.test.mjs` — 9 node:test cases, ALL
   importing the real gate module or spawning the real binary (COMMS-0106 provenance rule): real
   tree passes; self-test intact; exact #925 shape fails; transitive disguise against the REAL
   lockfile fails; registry-only tamper fails (two-sided pin); prerelease no-bypass; missing
   registry fails CLOSED; committed registry ≡ `computeRegistry()` (anti-drift); babel-preset-expo
   declaration required by babel.config.js reference.
3. CI registration: `.github/workflows/framework-major-guard.yml` (self-test → gate → node --test).

**fails-on-revert verified at `4480a5b08`** — three true line-edit drills, no stash:
- **D1 (revert-the-revert):** `expo` flipped back to `~57.0.6` in BOTH manifests → gate exit 1
  with 4 named violations (major-moved ×2, no-approved-pairing ×2); companion suite 4 failures.
  `git checkout` restore → gate exit 0, suite 9/9.
- **D2 (declaration deletion):** the `babel-preset-expo` devDependencies line DELETED → companion
  test 9 fails with the doctrine message. Restore → 9/9.
- **D3 (fails-closed):** registry file removed → gate exit 1 (`the gate fails closed`), no silent
  pass. Restore → exit 0.

Append-only: NEW test files only; zero existing tests modified or deleted; no TEST-MOD token
needed. Both test artifacts appear in `git diff origin/main...HEAD --name-only` on this branch.

## 7. Typecheck (diff-vs-baseline per ORCH-1385 D-6; baselines captured under the #925 tree)

| App | Baseline (expo-57) | Post-revert | NEW error headlines |
|---|---|---|---|
| app-mobile | 1031 lines / 909 `error TS` | 1027 / 905 | **0** (four expo-57-induced `node_modules/expo-file-system` TS2307 vanish) |
| mingla-business | 993 lines / 845 `error TS` | 952 / 804 | **1 surfaced-latent, attributed** (below) |

The single only-in-post headline — `../packages/phone-input/CountryPickerModal.tsx(355,6) TS2741
children missing` — is a PRE-EXISTING latent defect made visible because the 54-era tree HEALED
react/jsx-runtime resolution inside `packages/phone-input` (under the 57 baseline that file carried
`Cannot find module 'react'` + TS2875 jsx-runtime errors and was largely un-typecheckable; 41 of
its error headlines vanished). Same visibility class as ORCH-1385 SC-4's payments-native precedent:
the source did not change; the type environment improved. Recorded as discovery D-3 (§13).

## 8. Data-model changes / edge functions

None. No migrations (`db push` N/A), no edge functions, nothing to deploy from this branch.

## 9. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS / Android (app-mobile) | YES (build-lane) | native bundling works again; JS toolchain returns to the QA'd expo-54 the live 1.1.2 binaries run; zero product-behaviour change intended | automatic (one manifest) |
| Business iOS / Android (mingla-business) | YES (build-lane) | same | automatic (one manifest) |
| Buyer/anonymous Web (business web) | YES (build-lane) | web bundle now produced by the expo-54 toolchain (as production always was — the deployed site pre-dates #925); check green; still deploy-frozen until CLOSE lifts the hold | automatic (same manifest) |
| Admin Web (mingla-admin) | NO | vite-8 lane untouched (out of scope; builds pass) | — |
| Business Web preview / marketing | NO | next bump untouched (out of scope) | — |

No user-visible pixel/behaviour change anywhere: this returns the toolchain to the framework the
shipped binaries and deployed web already run. CI impact: the new guard workflow runs only on
manifest/lockfile/guard-file changes (paths-filtered; see §12 note on required-check semantics).

## 10. Smoke / verification transcript (real output, abridged)

```
REPRO (pristine npm ci from #925 lockfiles; expo 57.0.6 verified on disk):
  app-mobile:      iOS Bundling failed 2126ms node_modules/expo-router/entry.js (5840 modules)
                   Error: Unable to resolve module buffer from …/app-mobile/node_modules/react-native-svg/src/utils/fetchData.ts   AM_EXPO_EXIT=1
  mingla-business: iOS Bundling failed 2066ms index.js (5396 modules)
                   Error: Unable to resolve module buffer from …/mingla-business/node_modules/react-native-svg/src/utils/fetchData.ts   MB_EXPO_EXIT=1

POST-FIX (pristine npm ci from the regenerated lockfiles; expo 54.0.36):
  app-mobile:      added 1150 packages … Exported: …/am-ios-final    AM_FINAL_EXIT=0   (grep "Unable to resolve" → 0)
  mingla-business: added 1286 packages … Exported: …/mb-ios-final    MB_FINAL_EXIT=0

WEB LANE (the web-build check's exact commands):
  npx expo export -p web → exit 0
  ORCH-1083 bundle-budget PASS — initial payload 3253650 bytes (ceiling 9405478), 148 chunk files, 0 deferred specifiers in the main entry chunk, __common within cap.
  ORCH-1137 render-proof PASS (both lucide glyph signatures)

GATES:
  ORCH-1385: self-test 8/8 · gate PASS · companion 5/5 · adversarial 12/12
  ORCH-1386: self-test 14/14 · gate PASS · companion 9/9
  YAML: dependabot.yml parses (4 update blocks × 10 ignores); framework-major-guard.yml parses (1 job / 5 steps)

DRILLS (at 4480a5b08): D1 GATE_ON_REVERT=1 (+4 suite fails) → restore 0/9-9 · D2 test-9 red → restore · D3 GATE_NO_REGISTRY=1 → restore 0
```

Local env: node v22.22.2 / npm 10.9.7 vs CI node 20 + `npm install` — same env used for failing and
passing runs; repro matches the recorded D-2 error byte-for-byte, so the comparison is valid.

## 11. Named adversarial angles for the tester (contract step 6)

- **A-1 Transitive-only disguise, live-fire:** bump a family entry in a REAL lockfile only (e.g.
  `@expo/metro-config` → 57.0.5, manifests untouched) and run the gate binary — must fail with the
  TRANSITIVE-disguise message. (Companion test 4 does this in-memory; attack the CLI path too.)
- **A-2 Prerelease strings:** `expo "57.0.0-rc.1"`, `react-native "0.82.0-nightly-…"`,
  build-metadata suffixes — the parser must never return null/54 for them; try to find a spec
  shape that bypasses `majorLineOf`.
- **A-3 The buffer failure RETURNS if the revert is reverted:** flip both manifests to `~57.0.6`,
  `npm install`, `npx expo export --platform ios` — the exact `buffer` error must come back
  (causal-chain proof, not just gate-red). Then restore.
- **A-4 Registry/table tamper:** approve major 57 in the registry WITHOUT extending
  `EXPO_RN_PAIRING` → pairing wall must hold; tamper registry only (manifest at 54) → two-sided
  mismatch must fail; verify the anti-drift case 8 catches a hand-edited registry.
- **A-5 New-family-member smuggle:** add `metro` (or a new `@expo/*`) as a direct dep, or inject a
  new family package into a lockfile — NEW-dep registration wall must fail it.
- **A-6 Dependabot config semantics:** after merge, confirm GitHub parses `.github/dependabot.yml`
  (Insights → Dependency graph → Dependabot shows no config error) and grouped security updates
  remain enabled; the file is deliberately anchor-free (Dependabot's parser rejects YAML anchors).
- **A-7 Independent lane re-run:** re-run both native exports + the three web-lane commands by the
  tester's own hand; compare the 3253650-byte budget figure.
- **A-8 HOLD discipline:** confirm nothing in this branch triggers EAS/[deploy]/OTA; cloud builds
  stay held until CLOSE.

## 12. Known issues / deferred

- **In-range family patch drift vs the live binaries' exact pins** (expo 54.0.36 vs 54.0.34 etc. —
  §5, enumerated). Same SDK line and spec; if exact-patch parity is wanted, it is a deliberate
  follow-up (pin-splice or `--save-exact` policy), not part of this revert.
- **The guard workflow is paths-filtered and NOT yet a required check.** If Seth marks it required
  in branch protection, the paths filter must be removed first (a skipped required check hangs
  merges) — tradeoff documented in the workflow header. Until then, the all-checks-green merge SOP
  is the enforcement (it runs red on any PR that touches manifests/lockfiles/guard files).
- **A deliberate expo-57 (or newer) upgrade remains its own future project**: pairing research
  (expo 57 pairs with RN > 0.81), native rebuilds, full QA — the deliberate-upgrade path is
  documented in the gate header and registry.
- No `[TRANSITIONAL]` code introduced.

## 13. Discoveries for Orchestrator

- **D-1 (gap, register-worthy): the repo has NO CI check that native-bundles either app** — the
  web-build check exists precisely because web breaks froze prod once (ORCH-0964), but the native
  equivalent (#925's actual kill-shot) is only ever exercised at EAS build time. A
  paths-filtered `expo export --platform ios` dry-run job (~3–5 min, on manifest/lockfile changes
  only) would have caught #925 at the PR. CI-cost decision → orchestrator/Seth.
- **D-2 (process): stale worktree node_modules nearly false-passed the repro** — the spawned
  worktree carried pre-#925 expo-54 node_modules against the #925 lockfile (ORCH-1387 D-D class,
  re-confirmed). Any lockfile-lane ORCH must `npm ci` before trusting ANY build evidence.
- **D-3 (latent type bug): `packages/phone-input/CountryPickerModal.tsx(355,6)` TS2741** —
  `{ children: ReactNode }` required but `{}` provided — pre-existing, surfaced now that
  react/jsx-runtime resolves inside the package (§7). Same family as ORCH-1385 D-4/ORCH-1387;
  candidate for the same tsconfig/type-contract sweep.
- **D-4 (npm behaviour, bug-class): `npm dedupe <pkg>` is NOT a placement fix** — it churned 36
  placements without hoisting the target. The deterministic placement fix for a root-referenced
  package is DECLARING it (direct deps always land at root). Worth a line in the engineering
  handbook next time it is touched.
- **D-5 (context): mingla-business builds without a babel.config.js** — only app-mobile pins its
  babel entry point explicitly. If business ever adds one referencing `babel-preset-expo`, it needs
  the same declaration (companion test 9 currently guards app-mobile only, by design — extend it
  then).

## 14. Operator action required

**None to run this branch's content** — no migration, no edge deploys, no `[deploy]`, no EAS.
Downstream is orchestrator-owned per the dispatch: REVIEW → TEST (angles §11) → CLOSE with a FRESH
PR (COMMS-0109 — never a rerun), merge on green; **CLOSE lifts the EAS/[deploy]/OTA HOLD** after
the orchestrator re-verifies both lanes on merged main. Post-merge, two one-time checks for
Seth/orchestrator: (1) GitHub → Insights → Dependency graph → Dependabot shows the new config
parsed without error; (2) decide whether `Framework Major Guard` becomes a required check (remove
its paths filter first if so, per §12).

## Comms-ledger actions this session

Acked and pushed to main at `05042e1f6` (before any code work): COMMS-0104/0105/0106/0107/0109
(WARN — factored: no OneLink/opener/web-perf/consent surface touched — dependency-revert lane only;
zero git stash, drills via line deletion + `git checkout` restore, foreign `stash@{0}` untouched
and verified still present; local-export error-boundary trap noted for the web lane — this ORCH's
web leg is build+budget+glyph-grep, no runtime-route claims; commits stay on the ORCH branch
rebased onto post-fix main, no PR merge this phase, CLOSE PR will be a fresh event).
