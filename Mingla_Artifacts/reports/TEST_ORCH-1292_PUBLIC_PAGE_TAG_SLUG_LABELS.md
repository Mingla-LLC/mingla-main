# TEST — ORCH-1292 [public-page-tag-slug-labels]

- **ORCH-ID:** ORCH-1292
- **Label:** [public-page-tag-slug-labels]
- **Skill:** mingla-tester (production gatekeeper)
- **SPEC (contract):** `Mingla_Artifacts/reports/INVESTIGATION_SPEC_ORCH-1292_PUBLIC_PAGE_TAG_SLUG_LABELS.md` §7–§8
- **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1292_PUBLIC_PAGE_TAG_SLUG_LABELS.md`
- **Fix commit under test:** `61dbece87`
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1292-[public-page-tag-slug-labels]/` on branch `ORCH-1292-public-page-tag-slug-labels`
- **Date:** 2026-07-03

---

## 1. Verdict

# ✅ PASS

**Finding counts:** P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise / non-blocking observation).

**Confidence:** `proven` at source + unit + gate levels, and **runtime-verified** — the ACTUAL branch
`taxonomyLabel()` resolver was executed in a real headless Chromium browser rendering the pills, with
a captured screenshot + DOM-text assertions. Full RN-component (`EventOfferingBody`) bundling was not
performed because the app's Metro/esbuild bundler is unavailable in this environment and the worktree
has no `node_modules`; this is an accepted, stated cap — the sole NEW logic is `taxonomyLabel`, and
`Pill` is a proven verbatim `<View><Text>{children}</Text></View>` text wrapper (SPEC §2 F-1/F-2), so
running the real resolver in a real browser and screenshotting the resulting pills exercises the exact
user-visible output. **Runtime confidence: source-proven + unit-verified + real-browser-resolver-render.**

**Regression gate:** SATISFIED. Implementor happy-path Deno test present + independently re-proven
fails-on-revert. Tester adversarial gate + adversarial Deno test added on-branch, different angle,
both proven fail-then-pass. All appear in the closing diff.

---

## 2. SC-by-SC matrix

| SC | Criterion (SPEC §7/§8) | Verdict | Evidence |
|----|------------------------|---------|----------|
| SC-1 | `taxonomyLabels.ts` dep-free; `TAXONOMY_LABELS` 45 canonical pairs verbatim; `taxonomyLabel` Title-Case fallback; empty→empty; no react/rn import | PASS | File has 0 imports (read); 45 keys verified at runtime (`Object.keys(...).length === 45`); byte-diffed against `eventTaxonomy.ts:46-98` — all 45 labels identical; Deno unit test 6/6 |
| SC-2 | Barrel `index.ts` adds `export { taxonomyLabel, TAXONOMY_LABELS }`; `rsvpMomentum` export incl. `partyTypeLabel` unchanged | PASS | Diff shows additive export block only; ORCH-1157 Deno test 15/15 incl. `partyTypeLabel humanizes…` still green |
| SC-3 | `EventOfferingBody.tsx` 3 pill children `{tag}`→`{taxonomyLabel(tag)}`; `.map`/`key`/`<Pill>`/`testID="orch-1167-pills-row"`/section comments byte-identical | PASS | Diff = 3 one-token swaps + 1 import; `testID="orch-1167-pills-row"` present @L335; ORCH-1167 gate PASS |
| SC-4 | `RsvpOfferingBody.tsx` 3 pill children resolved; `testID="orch-1167-pills-row"` + `<Pill>` intact | PASS | Diff = 3 one-token swaps + 1 import; `testID` present @L1017 |
| SC-5 | `RsvpMomentumDecision.tsx` drops `partyTypeLabel` import, adds `taxonomyLabel`; chip resolved; `testID="orch-1157-rsvp-chips"` + chip structure intact | PASS | Diff matches; `testID` present @L316; chip @L329 = `{taxonomyLabel(slug)}` |
| SC-6 | New gate `orch-1292-taxonomy-label-parity.mjs` — drift (set-equality + byte-exact) + render-site (fails-on-revert) + `--self-test` | PASS | Self-test exit 0; real run exit 0; independently reproduced fails-on-revert (§4) |
| SC-7 | New workflow job — self-test BEFORE real-run; one registry-comment line; no existing job modified | PASS | YAML parses (js-yaml); job present; the implementor's edit added the parity job (verified) |
| SC-8 | New Deno unit test — 7 slugs, per-taxonomy, unknown fallback, empty, all 45, fails-on-revert | PASS | 6/6; independently re-run; fails-on-revert reproduced (§4) |
| SC-9 | Existing gates green: ORCH-1167 + ORCH-0824; ORCH-1157 test; isolation | PASS | ORCH-1167 PASS; ORCH-0824 clean; ORCH-1157 15/15 |
| SC-10 | I-MOR-0827-PACKAGE-ISOLATION — package imports no app `src/` | PASS | `taxonomyLabels.ts` 0 imports; the two `.tsx` add only package-local `./taxonomyLabels`; commit touches no cross-app path |

All 10 SCs PASS.

---

## 3. Findings

No P0/P1/P2/P3 findings.

- **P4-1 (praise).** The drift gate's decision to enforce **set-equality** (not just "canonical ⊆ map")
  is the right call — it catches an EXTRA non-canonical key, which a one-directional check would miss.
  The `taxonomyLabel(slug)` signature being byte-identical to the dropped `partyTypeLabel(slug)` made
  the Site-3 swap a clean type-preserving one-token edit. Good, minimal, single-owner design.
- **P4-2 (observation, non-blocking, routed to Discoveries).** The implementor gate's render check uses
  a **file-wide** `src.includes("taxonomyLabel(tag)")` + a `>{tag}<` negative. This false-PASSES on a
  wrong-variable regression (e.g. a pill rendering `{taxonomyLabel(i)}`) and on a fallback-only resolver
  regression. Neither is a defect in the shipped code (the shipped code is correct), but they are gate
  blind spots. **The tester adversarial gate + adversarial unit test added here close both** (§5). No
  code change required.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the fix commit `61dbece87` (branch HEAD `48f826825`). All reverts done by true
line-edit in the working tree, gate/test run, then `git checkout --` restore. Tree confirmed clean
after (`git status --porcelain` shows only the pre-existing forensics `WORLD_MAP.md` + untracked
INVESTIGATION_SPEC — no product edits left).

**(a) Gate render-site fails-on-revert.** Reverted the EventOfferingBody vibe pill
`{taxonomyLabel(tag)}` → `{tag}`:
```
node .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs
  ✗ EventOfferingBody.tsx: pills row still renders the RAW slug {tag} — reverted to unmapped kebab-case.
exit=1
```
Restore → `exit=0` (clean). **Reproduced.**

**(b) Gate drift fails-on-revert.** Dropped the `"pool-party": "Pool Party"` pair from `TAXONOMY_LABELS`:
```
  ✗ TAXONOMY_LABELS is MISSING canonical slug "pool-party" (expected label "Pool Party").
exit=1
```
Restore → `exit=0`. **Reproduced.**

**(c) Unit-test fails-on-revert.** Reverted `taxonomyLabel` to `slug => slug` (raw):
```
deno test .../orch_1292_taxonomy_labels.test.ts  →  1 passed | 5 failed
  (only "empty string → empty string" survives; the 5 canonical-label assertions flip)
```
Restore → 6/6 pass. **Reproduced.**

**fails-on-revert verified at commit `61dbece87`.** The implementor's claim is honest and independently confirmed.

---

## 5. Adversarial test added (tester-owned, DIFFERENT angle, on-branch, in-diff)

The implementor covered happy-path slug→label, generic fallback, full-45 coverage, and self-test BAD
fixtures for dropped/renamed/extra label + render-site raw-`{tag}` revert + momentum→partyTypeLabel.
My additions attack angles the implementor did **not**:

### 5a. Sibling CI-enforced gate — `.github/scripts/strict-grep/orch-1292-taxonomy-label-adversarial.mjs` (NEW)

Registered as a NEW appended workflow job `orch-1292-taxonomy-label-adversarial` (self-test step gates
the real-run step; no existing job modified — workflow diff is +13/−0; YAML re-parsed OK, 293 jobs).

Distinct angles:
- **(E) Scope-bound render check.** Instead of a file-wide `includes()`, it extracts EACH taxonomy
  `.map((tag …)` body and asserts the pill child is `taxonomyLabel(<own-var>)` — catching a
  **wrong-variable / out-of-scope** resolve the implementor gate misses.
- **(B) Strict byte-exact drift.** Rejects a substring/truncated label, a trailing-whitespace label,
  and a case-flipped label (the implementor's single "Pool Bash" rename never exercises these).
- **(C) Fallback-masking drop.** A dropped canonical slug whose Title-Case fallback would *equal* its
  label must still fail set-equality (and is explicitly flagged "fallback would MASK this at runtime").

**Self-test:** `--self-test` → `SELF-TEST PASS` (GOOD passes; every BAD fixture fails; and it asserts
the WRONG_VAR fixture *would pass the implementor gate*, proving the angle is genuinely new).
**Real run on clean tree:** `exit=0` clean.

**Proven superiority on the REAL file (fail-then-pass).** Injected `{taxonomyLabel(i)}` (wrong var —
the map index) into the real EventOfferingBody vibe pill:
```
implementor gate  → "clean … all 3 render sites resolve"   exit=0   (FALSE-PASS)
adversarial gate  → ✗ EventOfferingBody.tsx: vibeTags pill does NOT resolve via
                      taxonomyLabel(tag) inside its own .map (wrong var / raw / out-of-scope)  exit=1
```
Restore → adversarial gate `exit=0`. **fails-on-revert verified at commit `61dbece87`.**

### 5b. Adversarial Deno unit test — `packages/offering-rendering/__tests__/orch_1292_taxonomy_labels_adversarial.test.ts` (NEW)

8 tests, behavioral edges: mixed known+unknown in one array (canonical+fallback coexist);
cross-taxonomy non-collision (45 unique, `pop`→`Pop` not shadowed); empty-array group omission
(`[].map(taxonomyLabel)===[]`); **map-precedence over fallback** (`laid-back`→`Laid-back`, NOT the
fallback's `Laid Back`); punctuated labels byte-exact (`R&B/Soul`, `Hip-Hop/Rap`, `Electronic/EDM`,
`Disco/Funk`, `Reggae/Dancehall`, `Mixed/Variety`); malformed-input no-throw; purity/no-mutation.
Result: **8/8 pass.**

**Fails-on-revert (subtler than the implementor's).** A **fallback-only** revert (delete the
`TAXONOMY_LABELS[slug] ??` lookup, keep the fallback) — a regression the implementor gate MISSES
(it never executes the resolver, so `exit=0`) — is caught by this unit test:
```
deno test .../orch_1292_taxonomy_labels_adversarial.test.ts  →  4 passed | 4 failed
  (map-precedence + punctuation + mixed + per-list assertions flip; "Laid Back" ≠ "Laid-back")
implementor gate on same revert → exit=0 (MISS)
```
Restore → 8/8 pass. **fails-on-revert verified at commit `61dbece87`.**

**Closing-diff visibility.** Both the implementor happy-path test and the two tester adversarial files
are in `git diff origin/main...HEAD --name-only` (confirmed §7).

---

## 6. Constitution 14-rule matrix (re-verified independently against the diff)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No interactive control added; display-only text swap |
| 2 | One owner per truth | PASS | ONE resolver `taxonomyLabel`; drift gate keeps it in parity with the single canonical `eventTaxonomy.ts` |
| 3 | No silent failures | PASS | Unknown slug → Title-Case fallback (never raw, never blank, never throw); empty→empty proven |
| 4 | One query key per entity | N/A | No data fetch |
| 5 | Server state server-side | N/A | Pure display; no Zustand/store touched |
| 6 | Logout clears everything | N/A | No auth/state |
| 7 | Label `[TRANSITIONAL]` | PASS | None introduced; retained `partyTypeLabel` documented as backward-compat, not transitional |
| 8 | Subtract before adding | PASS | Site-3 removed the humanized `partyTypeLabel` render, routed to the canonical resolver (net-simpler consistency) |
| 9 | No fabricated data | PASS | Labels transcribed verbatim from canonical source; drift gate forbids invention |
| 10 | Currency-aware | N/A | No money |
| 11 | One auth instance | N/A | No auth |
| 12 | Validate at right time | N/A | No datetime |
| 13 | Exclusion consistency | PASS | All three taxonomy groups + both bodies + momentum handled uniformly; no group left raw |
| 14 | Persisted-state startup | N/A | No persistence |

No violations.

---

## 7. Device / parity matrix

Parity is **automatic** — all surfaces mount the SAME two shared bodies + the one momentum unit (no
per-surface fork, no `.web.tsx`), upheld by I-PROPOSED-1167-SHELL-AGNOSTIC-BODY. The single shared
`taxonomyLabel` swap covers every surface at once.

| # | Surface | Ships here | Verdict | Evidence |
|---|---------|:---------:|---------|----------|
| 1 | Consumer iOS | YES | PASS (shared code) | Same `EventOfferingBody`/`RsvpOfferingBody`/`RsvpMomentumDecision`; native rides next build (no OTA) |
| 2 | Consumer Android | YES | PASS (shared code) | as #1 |
| 3 | Buyer/anon Web `/e/{brandSlug}/{eventSlug}` | YES | PASS — real-browser resolver render (§8) | Ships via Vercel `[deploy]` on merge |
| 4 | Business iOS | YES | PASS (shared code) | authed biz-web runtime capped per `feedback_biz_web_authed_runtime_unreachable_cap_claims`; native rides next build |
| 5 | Business Android | YES | PASS (shared code) | as #4 |
| 6 | Admin Web | NO | N/A | Admin does not render these public-event pills (census-confirmed, SPEC §5) |
| 7 | Business Web preview (adjacent) | YES | PASS (shared code) | ships via Vercel `[deploy]` |

**Physical iPhone HITL:** not required. This is a pure display-string swap in a shared props-only
package; the real resolver was proven in a real browser (§8) and the causal chain (`Pill` = verbatim
text wrapper) needs no hardware-keyboard/gesture path. No physical-device step applicable.

**Live edge-deploy state:** N/A — commit touches zero edge functions / migrations (verified §9).

---

## 8. Runtime proof (strongest feasible)

**Method.** The worktree has no `node_modules` and the monorepo's Metro/esbuild web bundler is not
runnable here, so a full `EventOfferingBody` RN-web export was infeasible. Instead I ran the **ACTUAL
branch code** at runtime: a Deno step imported `{ taxonomyLabel, TAXONOMY_LABELS }` from the real
`packages/offering-rendering/taxonomyLabels.ts`, serialized the real map (JSON) + the real function
(`.toString()`) into a module, and a Playwright (1.61.1) headless **Chromium** page rendered the pills
exactly as the components `.map` them, fed Seth's 7 example slugs + 1 unknown slug.

**DOM-text assertions (extracted from the rendered page, not hardcoded):**
```
laid-back              → Laid-back              OK
exclusive              → Exclusive              OK
pool-party             → Pool Party             OK
afrobeats              → Afrobeats              OK
hiphop-rap             → Hip-Hop/Rap            OK
pop                    → Pop                    OK
rnb-soul               → R&B/Soul               OK
secret-warehouse-rave  → Secret Warehouse Rave  OK   (unknown → Title-Case fallback)
any After-pill still equals its raw slug?  false
ASSERT_ALL_CANONICAL = true   (node exit 0)
```

**Screenshot:** `Mingla_Artifacts/evidence/ORCH-1292/orch-1292-public-pills-canonical-labels.png`
(before/after panels: raw slugs vs canonical labels rendered by the real resolver in Chromium).

This matches Seth's requested strings exactly ("Pool Party", "Hip-Hop/Rap", "R&B/Soul"). Confidence
capped honestly at **source-proven + unit-verified + real-browser-resolver-render** (not a full
RN-component sim render).

---

## 9. No-regression sweep (full outputs)

```
ORCH-1292 parity gate      --self-test  → SELF-TEST PASS                exit=0
ORCH-1292 parity gate      real         → clean (45 labels, 3 sites)     exit=0
ORCH-1292 ADVERSARIAL gate --self-test  → SELF-TEST PASS                exit=0
ORCH-1292 ADVERSARIAL gate real         → clean (byte-exact + scoped)    exit=0
ORCH-1167 canonical-9-section-order     → PASS                          exit=0
ORCH-0824 event-taxonomy-parity         → clean (3 modules byte-equal)   exit=0
Deno: orch_1292_taxonomy_labels(.happy) + _adversarial + orch_1157      → 29 passed | 0 failed
```
- **testIDs intact:** `testID="orch-1167-pills-row"` present in EventOfferingBody (@L335) and
  RsvpOfferingBody (@L1017); `testID="orch-1157-rsvp-chips"` in RsvpMomentumDecision (@L316).
- **Section order intact:** ORCH-1167 canonical-9-section-order gate PASS (it anchors the section
  comments + pills-row/ticket-box testIDs).
- **`partyTypeLabel` humanizer retained + green:** ORCH-1157 test `partyTypeLabel humanizes canonical
  kebab slugs…` still passes (function exported, unused by components, not removed).
- **Scope adherence (`git show --stat 61dbece87`):** 8 allowlist files (taxonomyLabels.ts, index.ts,
  EventOfferingBody.tsx, RsvpOfferingBody.tsx, RsvpMomentumDecision.tsx, the parity gate, the workflow,
  the happy-path test) + the IMPLEMENTATION report. **None** of the DO-NOT-TOUCH files
  (`eventTaxonomy.ts` ×3, `rsvpMomentum.ts` + its test, `orch-1167`/`orch-0824` gates) are in the
  commit. No data-model/edge/migration change (verified — commit has no `supabase/functions/**` code
  or `migrations/**`).

---

## 10. Discoveries for Orchestrator (never fixed here)

- **Gate blind spots the shipped code does not trip (P4-2).** The implementor's parity gate render
  check is file-wide and does not (a) bind the resolve to each `.map` scope (misses a wrong-variable
  resolve) nor (b) execute the resolver (misses a fallback-only revert). Both are now closed by the
  tester's sibling adversarial gate + adversarial unit test added on this branch — no product change
  needed. Recommend keeping BOTH gate jobs at CLOSE.
- **COMMS-0040 (WARN, OPEN)** coordination hold on `RsvpMomentumDecision.tsx` / offering-rendering RSVP
  exports: this ORCH's change is display-only + additive and does NOT perform the structural
  RsvpPublicBody→packages promotion the hold guards; no conflict. Factored, not acked to ledger (tester
  performs no anchor writes / merges).
- **COMMS-0052 (BLOCK, ALL — business OTA freeze, ACKNOWLEDGED):** honored — this QA run performed zero
  `eas update`/deploy/merge/push; the fix rides Vercel `[deploy]` (web) + next native builds at CLOSE.

---

## 11. Routing

**PASS → CLOSE (orchestrator).** At CLOSE: flip `I-PROPOSED-1292-TAXONOMY-LABEL-AT-RENDER` DRAFT→ACTIVE
in the invariant registry + README; ship business/buyer web via Vercel `[deploy]`; native rides next
builds; **no OTA** (COMMS-0052). Keep both strict-grep jobs (`orch-1292-taxonomy-label-parity` +
`orch-1292-taxonomy-label-adversarial`).
