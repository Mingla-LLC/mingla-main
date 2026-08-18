# Strict-Grep Hardening Registry — Mingla Host

This directory holds the modular CI gate scripts that enforce Mingla
Host invariants. Each script enforces ONE invariant.

## 🔴 `MANIFEST.json` is the single source of truth (ORCH-1383)

**The authoritative list of gates is [`MANIFEST.json`](./MANIFEST.json), not this
README and not the workflow file.** Every `.mjs` in this directory (recursive,
including `__tests__/`) has **exactly one** manifest entry with an explicit
`enforcement` state — `batch:A..E`, `external:<workflow>`, `fixture`,
`unenforced`, or `infrastructure`. A gate file may never exist unaccounted-for
(**I-PROPOSED-1383-GATE-MANIFEST-TOTALITY**), and that is machine-checked by
`meta-1383-manifest-parity.mjs` on every PR.

Per **DEC-101 D-17b-5** this remains a **registry pattern**. ORCH-1383 changed
only *where the registry lives*: **"one script + one workflow job" became "one
script + one manifest entry."** The registry survives; its enforcement became
machine-checked instead of hand-maintained.

**Why:** the hand-maintained table below drifted to ~32 rows against 379 real
gates — a >90% drift — and 21 real gates ended up on disk, carrying
`process.exit(1)` contracts, executed by **no CI workflow at all** (one of them
went dark *one day after its own ORCH closed*). A registry a human must remember
to update is a registry that silently rots. See
`Mingla_Artifacts/reports/ORCH-1383_DIFFERENTIAL_PROOF.md`.

### Useful queries

```bash
# every gate and how it is enforced
node -e 'for (const g of require("./.github/scripts/strict-grep/MANIFEST.json").gates)
           console.log(g.enforcement.padEnd(12), g.script)'

# the 21 gates CI never runs (frozen + tracked, NOT fixed — see SPEC_ORCH-1383 §5.5)
node -e 'console.log(require("./.github/scripts/strict-grep/MANIFEST.json")
           .gates.filter(g => g.enforcement === "unenforced").map(g => g.script).join("\n"))'

# run a whole dependency class exactly as CI does
node .github/scripts/strict-grep/run-batch.mjs --class A
```

## ⚠️ NUL-byte files are grep-invisible — sweeps & registry greps MUST be binary-aware

Plain `grep` (and `grep -r`) classify any file containing a NUL byte as
*binary* and **silently skip its contents** — no match, exit 1, no warning.
Git-tracked fuzz fixtures embed raw NUL bytes on purpose (e.g. a `'a\x00b'`
hostile-input row), so a plain-`grep` ORCH-renumber sweep or registry-consistency
scan will **quietly miss every ORCH-ID / gate reference inside them**. This
already bit the 1383→1399 sweep: 3 stale `ORCH-1382` strings survived inside
`mingla-marketing/lib/__tests__/links-src.tester.test.ts` because its NUL byte
hid them from `grep` (fixed under issue #957).

**Rule — any repo-wide sweep or registry-consistency scan (ORCH-renumber,
gate-registry audit, MANIFEST parity, ID-consistency) MUST use a binary-aware
reader:** `grep -a` / `git grep -a` / `rg --text`, or a Node/Python pass that
reads bytes (`fs.readFileSync(f,'utf8')` / `open(f,'rb').read()`) over
`git ls-files`. Never trust a plain `grep -r` to be exhaustive. Enforced for the
`links-src`↔ORCH-ID class by `issue-957-nul-hidden-orch-id-consistency.mjs`,
whose `--self-test` proves the check still fires on a NUL-hidden stale string.

## Active gates — HISTORICAL, DO NOT EXTEND

> ⚠️ **This table is a partial historical record (~32 of 379 gates) and is NOT
> authoritative.** It is retained because several gates cross-reference it. **Do
> not add rows here** — add a `MANIFEST.json` entry instead. Ignore this table
> when answering "is gate X enforced?"; ask `MANIFEST.json`.

| Invariant | Script | Cycle | Cross-reference |
|---|---|---|---|
| I-37 | `i37-topbar-cluster.mjs` | 17b | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-37 |
| I-38 | `i38-icon-chrome-touch-target.mjs` | 17c | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-38 |
| I-39 | `i39-pressable-label.mjs` | 17c | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-39 |
| I-PROPOSED-A | `i-proposed-a-brands-deleted-filter.mjs` | 17e-A | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-A |
| I-PROPOSED-C | `i-proposed-c-brand-crud-via-react-query.mjs` | 17e-A | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-C |
| I-PROPOSED-K | `i-proposed-k-require-cycles.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-K |
| I-PROPOSED-L | (process invariant — orchestrator skill SKILL.md Step 1.5; no script) | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-L |
| I-PROPOSED-M | `i-proposed-m-persist-key-whitelist.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-M |
| I-PROPOSED-N | `i-proposed-n-transitional-exit-condition.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-N |
| I-PROPOSED-T | `i-proposed-t-stripe-country-allowlist.mjs` | B2a Path C V3 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-T |
| I-PROPOSED-U | `i-proposed-u-mingla-tos-gate.mjs` | B2a Path C V3 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-U |
| I-PROPOSED-V | `i-proposed-v-stripe-notification-via-shared.mjs` | B2a Path C V3 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-V |
| I-PROPOSED-W | `i-proposed-w-notifications-app-type-prefix.mjs` | B2a Path C V3 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-W |
| I-PROPOSED-Y | `i-proposed-y-platform-web-url-from-env.mjs` | B2a Path C V3 forensics fix | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-Y |
| I-PROPOSED-Z | `i-proposed-z-home-no-fabricated-events.mjs` | ORCH-0754 | `Mingla_Artifacts/specs/SPEC_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md` |
| I-PROPOSED-X | `i-proposed-x-web-deprecation.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-X |
| ORCH-0783 | `orch-0783-event-cover-image-provider-pivot.mjs` | ORCH-0783 | `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` |
| I-NO-BOTTOMNAV-OUTSIDE-LAYOUT + I-DESKTOP-GATE-VIA-HOOK | `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` | ORCH-0885-A | `Mingla_Artifacts/specs/SPEC_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md` §6 + §10 |
| I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT) | `orch-0892-no-bespoke-keyboard-plumbing.mjs` | ORCH-0892-A | `Mingla_Artifacts/specs/SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md` §6 + §10 + §13 — INFORMATIONAL until ORCH-0892-C flips to BLOCK |
| I-COMMS-LEDGER-ENTRY-STANZA + I-RESPONSE-2-SECTION-SHAPE | `meta-orch-0954-comms-ledger-stanza.mjs` | META-ORCH-0954 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA + I-RESPONSE-2-SECTION-SHAPE |
| I-1292-TAXONOMY-LABEL-AT-RENDER | `orch-1292-taxonomy-label-parity.mjs` | ORCH-1292 | ORCH-1292 — public-page taxonomy slug→canonical-label resolution + drift/fails-on-revert / adversarial scope+fallback-masking; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-1292-TAXONOMY-LABEL-AT-RENDER |
| I-1292-TAXONOMY-LABEL-AT-RENDER | `orch-1292-taxonomy-label-adversarial.mjs` | ORCH-1292 | ORCH-1292 — public-page taxonomy slug→canonical-label resolution + drift/fails-on-revert / adversarial scope+fallback-masking; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-1292-TAXONOMY-LABEL-AT-RENDER |
| I-PROPOSED-1303-WEB-COVER-VIDEO-URI-UNMANGLED | `orch-1303-web-cover-video-uri.mjs` | ORCH-1303 | ORCH-1303 — business-WEB picked-video blob: URL reaches the uploader unmangled (`resolveRawClipUploadUri` web branch); no `file://blob:` mangle; native byte-identical; `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1303_HERO_COVER_VIDEO_WEB_UPLOAD.md` |
| I-PROPOSED-1336-NOTIFICATIONS-TOP-ALIGN | `orch-1336-notifications-top-align.mjs` | ORCH-1336 | ORCH-1336 — consumer `NotificationsSheet` populated+online body contributes no flex-growing sibling above the section list (populated branch returns `null` when online; dead `notificationsBody` flex:1 style removed; offline banner intrinsic above list); notifications hug the top; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1336-NOTIFICATIONS-TOP-ALIGN |
| I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS (config) | `orch-1322-no-android-media-permissions.mjs` | ORCH-1322 | ORCH-1322 — consumer `app-mobile/app.json` lists NO media/storage perm in `expo.android.permissions` + full 4-set in `blockedPermissions` (READ_MEDIA_IMAGES/VIDEO + READ/WRITE_EXTERNAL_STORAGE) so none survive the AAB manifest merge; Google Play Photo & Video Permissions compliance; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS |
| I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS (routing) | `orch-1322-gallery-permission-wrapper-routed.mjs` | ORCH-1322 | ORCH-1322 — the shared `requestGalleryPermission` wrapper (`app-mobile/src/utils/mediaLibraryPermission.ts`) short-circuits `{granted:true}` on Android before any ImagePicker call, and all 3 gallery gates (BetaFeedbackModal, MessageInterface, cameraService) route through it — no raw `ImagePicker.requestMediaLibraryPermissionsAsync()` outside the wrapper (prevents Android ≤12 dead-tap after the perm strip); `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1322-NO-CONSUMER-ANDROID-MEDIA-PERMISSIONS |
| I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE | `orch-1355-wizard-update-callback-stable.mjs` | ORCH-1355 | ORCH-1355 — `RsvpCreatorWizard.tsx` `handleUpdate` is STABLE (no `liveDraft` in its useCallback deps) and builds the debounced autosave payload from the store's FRESH post-write state (`useDraftEventStore.getState().getDraft(draftId)`), never a captured `liveDraft` (`...liveDraft`) — so two sequential `updateDraft` calls in one handler COMPOUND instead of the second clobbering the first, and the guest-limit OFF write is never dropped from autosave (no server-echo snap-back); `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE |
| I-PROPOSED-1355-TOGGLE-SINGLE-PATCH | `orch-1355-toggle-single-patch.mjs` | ORCH-1355 | ORCH-1355 — in `RsvpStep5Setup.tsx` the capacity toggle (`toggleCapacity`) and the visibility "private" pick each persist via ONE combined `updateDraft` patch (capacity-OFF folds `rsvpWaitlistEnabled:false`; private folds `rsvpDiscoverable:false`) — no sequential dependent second write the wizard's stale-closure autosave could drop; bans the `if (capacityOn) updateDraft(` / `if (opt.id === "private") updateDraft(` bug shapes; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1355-TOGGLE-SINGLE-PATCH |
| I-PROPOSED-1355-DRAFT-PROMOTION-NO-REMOUNT | `orch-1355-draft-promotion-no-remount.mjs` | ORCH-1355 | ORCH-1355 (symptom 1) — both create routes (`app/rsvp/[id]/edit.tsx` + `app/event/[id]/edit.tsx`) reconcile the `d_*`→server draft promotion IN PLACE: the rendered draft resolves from a route-state `effectiveDraftId` (`promotedServerId ?? idParam`), `handleAutosaveDraft` sets `setPromotedServerId(serverId)` and calls `router.setParams(...)` — and NEVER an eager `router.replace(` to the new `[id]` (which replaces the expo-router screen, remounts the name `TextInput`, and drops the keyboard mid-type). Bans `router.replace(` inside `handleAutosaveDraft`; requires `router.setParams(` + `setPromotedServerId(` there and `useDraftById(effectiveDraftId)`; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1355-DRAFT-PROMOTION-NO-REMOUNT |
| I-RELEASE-VERSION-PARITY | `orch-1367-release-version-parity.mjs` | ORCH-1367 | ORCH-1367 — `app-mobile/app.json` and `mingla-business/app.json` MUST carry the SAME `expo.version` on main (the two apps ship a matched release build, currently 1.1.2); the gate reads both `expo.version` values and exits non-zero on divergence, missing/blank version, or invalid JSON. Both apps use `runtimeVersion: { policy: "appVersion" }`, so version parity keeps the OTA runtime in lockstep. Self-tested 6/6 + fails-on-revert; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-RELEASE-VERSION-PARITY (DRAFT until CLOSE) |
| I-RELEASE-SUBMIT-CONFIG | `orch-1369-release-submit-config.mjs` | ORCH-1369 | ORCH-1369 — the two apps' `eas.json` `submit.production` blocks stay release-ready: (a) BOTH `app-mobile/eas.json` and `mingla-business/eas.json` `submit.production.android.releaseStatus` MUST be `"completed"`, never `"draft"` (a draft internal-track upload is UNPUBLISHED/non-installable by internal testers; `track` stays `"internal"` — not a public rollout), and (b) `mingla-business/eas.json` `submit.production.ios` MUST declare all three ASC API-key fields (`ascApiKeyPath` + `ascApiKeyId` + `ascApiKeyIssuerId`, non-empty strings) so unattended `eas submit` uses the App Store Connect API key instead of stalling on interactive Apple auth (bare `ascAppId` is insufficient). The gate reads both `eas.json` files and exits non-zero on any `"draft"` releaseStatus, any missing/blank business-iOS ASC field, or invalid JSON. Self-tested 8/8 + fails-on-revert; `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-RELEASE-SUBMIT-CONFIG (DRAFT until CLOSE) |
| I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL | `orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs` | ORCH-1371/1372 | ORCH-1371 [add-friend-country-picker-hidden] + ORCH-1372 [pair-request-country-picker-hidden] — the consumer country picker (`CountryPickerModal`, an RN `<Modal>`) must NEVER be co-present with a `wrapInRNModal` `BaseBottomSheet`'s RN `<Modal>` window (iOS presents one modal at a time, so the second never appears). INV-1: `AddFriendView.tsx` renders NO `<CountryPickerModal>` and owns NO `showCountryPicker`/`setShowCountryPicker` (both hoisted to `ConnectionsPage`). INV-2: `ConnectionsPage.tsx` renders `<CountryPickerModal>` as a sibling of the friends sheet, includes `addFriendPickerOpen` in `anyFriendsChildOpen`, and keeps `visible={showFriendsModal && !anyFriendsChildOpen}` (adversarial: no bare `visible={showFriendsModal}`). INV-3: `PairRequestModal.tsx` self-gates `visible={visible && !showCountryPicker}` (adversarial: no bare `visible={visible}`). Comment-stripped reads; `--self-test` 8/8 + fails-on-revert (pre-fix tree fails INV-1/INV-2/INV-3); `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL (DRAFT until CLOSE) |

## Future gates (proposed but not yet implemented)

| Invariant | Proposed cycle | Notes |
|---|---|---|
| I-32 rank parity | 13a | Mobile UI rank thresholds in `permissionGates.ts` MUST mirror SQL `biz_role_rank()` numeric values |
| I-34 canManualCheckIn decommission | 13b | Field stays gone; references only allowed in migration v1→v2 strip logic |
| I-36 ROOT-ERROR-BOUNDARY | 16a | `app/_layout.tsx` MUST wrap `<Stack>` with `<ErrorBoundary>` |

## How to add a new gate (4 steps)

1. **Write the gate script** at `.github/scripts/strict-grep/iN-name.mjs`.
   Mirror the structure of `i37-topbar-cluster.mjs`:
   - Walk relevant files
   - Parse via `@babel/parser` (or appropriate parser for non-TSX targets)
   - Apply detection logic
   - Honor allowlist comment pattern: `// orch-strict-grep-allow <gate-tag> — <reason>`
   - Output rich error format on violation (file + line + suggested fix + cross-reference)
   - Exit `0` (clean), `1` (violation), `2` (inconclusive — script error)

2. **Register ONE `MANIFEST.json` entry** (ORCH-1383 — this replaces "add a job"):
   ```jsonc
   {
     "script": ".github/scripts/strict-grep/iN-name.mjs",
     "kind": "file",
     "enforcement": "batch:A",     // A = pure node. Use B if you need an npm dep.
     "invocation": "node",         // "node" | "node --test" | "bash" | "npm run"
     "modes": ["self-test", "plain"],  // EXACTLY what CI should run. Order matters.
     "selfTest": "wired",          // "wired" | "capable-unwired" | "none"
     "jobKeys": []
   }
   ```
   Pick the class by **what the gate needs installed**, which is the only thing
   the batching separates:

   | Class | Job | Use when your gate… |
   |---|---|---|
   | **A** | `static-gates` | needs nothing but node + a checkout ← almost always |
   | **B** | `dep-gates` | needs an npm package (`@babel/parser`, `madge`, `typescript`, `yaml`) |
   | **C** | `expo-export-gate` | reads the `expo export -p web` stderr side-effect |
   | **D** | `jest-suites` | is an `app-mobile` `npm run` structural suite |
   | **E** | `full-clone-gates` | reads **git history** (needs `fetch-depth: 0`) |

   If you add a class-B gate, add its dependency to that job's
   `npm install --no-save` line. **Do NOT add a job for your gate** — if you find
   yourself editing `jobs:` in `strict-grep-mingla-business.yml`, you are doing it
   the pre-1383 way.

   **The one exception — `job:<jobKey>` (4 carve-out jobs).** Four gates assert that
   *their own job key exists in the workflow file*, so batching them would make them
   fail; SC-16 forbids editing them, so their jobs are preserved byte-for-byte:
   `orch-0778-web-stripe-native-import-gate`, `orch-0885-a-no-bottomnav-on-wide-desktop`,
   `orch-1271-admin-authz-foundation`, `orch-1273-offerings-read-only`. **Do not copy
   this pattern for a new gate** — do not write a gate that asserts its own CI job
   exists. Assert against `MANIFEST.json` instead; that is where registration lives
   now. Carve-out gates are NOT covered by `run-batch`'s `executed === expected`, so
   parity gate **P9** covers them instead: it fails the PR if a carve-out job is
   deleted, stops running its gate, or drops one of its invocation modes.

   `modes` is not decoration: it is the exact set of invocation forms CI runs.
   2 gates in this repo are `--self-test`-ONLY and must never gain a plain run.
   Changing `modes` changes **what CI asserts**.

   `meta-1383-manifest-parity.mjs` fails the PR if you add the script and forget
   the entry (P1), or add an entry with no script (P2), or let the counts drift (P3).

3. **Cross-reference in `Mingla_Artifacts/INVARIANT_REGISTRY.md`** — add a
   "CI enforcement" line in the I-N entry pointing to the script.
   **Do NOT add a row to the historical table above** — `MANIFEST.json` is the
   registry now.

4. **Test locally** — run the gate from the repo root against synthetic violation
   fixtures + clean fixtures; verify exit codes (`0` clean / `1` violation /
   `2` inconclusive) and error clarity. Then run its whole class the way CI will:
   ```bash
   node .github/scripts/strict-grep/run-batch.mjs --class A
   node .github/scripts/strict-grep/meta-1383-manifest-parity.mjs   # needs: npm i --no-save yaml
   ```
   ⚠️ **Run from a path with no `[` `]` in it.** 3 gates resolve a sibling script
   via a `file://` URL and break on the percent-encoded brackets in the standard
   per-ORCH worktree name (`ORCH-NNNN-[label]`), failing with `MODULE_NOT_FOUND`
   on a `%5B`-mangled path. That is a pre-existing bug in those gates, not your
   change — see `Mingla_Artifacts/reports/ORCH-1383_DIFFERENTIAL_PROOF.md` §6.

**Give your gate a `--self-test`.** 168 of the gates here have none: they can be
proven to *execute* and to exit 0, but **nothing proves that exit 0 means
anything** — they have never been shown to fail on the defect they exist to catch.
Every historical dark-gate failure in this repo lives in that group. A gate
without a `--self-test` is a decoration until demonstrated otherwise. The
`selfTestWiredFloor` ratchet in `MANIFEST.json` only ever goes up.

## Allowlist comment pattern

If a violation is genuinely intentional (e.g., test fixtures, historical
migrations, internal kit primitives), add a comment IMMEDIATELY above the
offending code with this verbatim format:

```
// orch-strict-grep-allow <gate-tag> — <reason>
```

The `<gate-tag>` is gate-specific. Examples:
- I-37: `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>`
- I-34 (future): `// orch-strict-grep-allow canManualCheckIn — <reason>`

Each gate script reads the line immediately above its detected violation
and skips if the verbatim allowlist tag is present. Anything else (no
comment, wrong tag, malformed) is still a violation.

Other registered gate tags:
- I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER (`orch-0976-single-promotion-owner.mjs`, batch A, self-test wired): `// orch-strict-grep-allow single-promotion-owner — <reason>` — excuses a genuine NON-promotion `createServerDraft(` call (e.g. `useCreateServerDraft`'s fresh-draft mint); every d_*→server promotion must go through `src/utils/draftPromotion.ts`.
- I-38: `// orch-strict-grep-allow icon-chrome-touch-target — <reason>`
- I-39: `// orch-strict-grep-allow pressable-no-label — <reason>`
- I-PROPOSED-A: `// orch-strict-grep-allow brands-deleted-filter — <reason>`
- I-PROPOSED-C: `// orch-strict-grep-allow setBrands-call — <reason>`
- I-PROPOSED-K/M/N/X: no allowlist tag; update the baseline/script with SPEC-backed rationale.
- I-PROPOSED-T: `// orch-strict-grep-allow stripe-country-out-of-scope — <reason>`
- I-PROPOSED-U: `// orch-strict-grep-allow stripe-no-tos-gate — <reason>`
- I-PROPOSED-V: `// orch-strict-grep-allow stripe-notification-direct — <reason>`
- I-PROPOSED-W: `// orch-strict-grep-allow notifications-cross-app-read — <reason>`
- I-PROPOSED-Y: `// orch-strict-grep-allow platform-web-url-historical — <reason>`
- I-PROPOSED-Z: no allowlist tag; Home must not contain fabricated event signatures.
- I-PROPOSED-2113-ASSERTION-NOT-COMMENT-SATISFIED (`issue-2113-comment-satisfied-assertion.mjs`, batch A, self-test wired): `// orch-strict-grep-allow comment-satisfied-assertion — <reason>` on the line IMMEDIATELY above the assertion — excuses a source-text assertion whose only satisfying occurrence in the target is a comment or a narrating string literal. Use it only when the ANNOTATION ITSELF is the subject (a protective header banner, a rationale marker guarded against removal, a `// orch-strict-grep-allow` tag), never as a stand-in for a behavioural assertion. Pre-existing sites are carried in `issue-2113-comment-satisfied-allowlist.json` instead, as exact `{test, target, pattern}` triples with a `reason` of >= 20 characters; wildcards are rejected and a missing reason is a hard error. **The gate ships in REPORT mode** (`ENFORCEMENT_MODE = "report"`, exits 0, prints every violation with file:line) until the #2113 backlog is cleared.

## Conventions

- **Exit codes:** `0` clean, `1` violation, `2` script error / inconclusive.
- **Error format:** rich (file path + line number + offending pattern +
  suggested fix + cross-reference to INVARIANT_REGISTRY).
- **Warning format:** for cases the gate cannot statically verify (e.g.,
  dynamic JSX attribute values), report `WARN:` line but do NOT exit
  non-zero. The reviewer manually verifies during PR review.
- **Parse failures:** report `PARSE-FAIL:` per file. Exit `2` ONLY if
  every file failed (scaffold broken). Exit `0` or `1` otherwise based
  on violations found.
- **No new mingla-business dependencies.** Gate scripts use CI-installed
  parser packages via `npm install --no-save` in the workflow YAML.

## Cross-references

- Workflow: `.github/workflows/strict-grep-mingla-business.yml`
- Active invariants: `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- Decision lock: `Mingla_Artifacts/DECISION_LOG.md` DEC-101 (Cycle 17b)
- Memory: `feedback_strict_grep_registry_pattern.md` (operator-readable
  pattern documentation for future skill sessions)
