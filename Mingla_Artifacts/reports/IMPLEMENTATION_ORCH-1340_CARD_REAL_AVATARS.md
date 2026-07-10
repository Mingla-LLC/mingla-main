# IMPLEMENTATION — ORCH-1340 [card-real-avatars]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 3 of 5 (after 1338 backend + 1339 cross-entity card; before 1341 sheet wiring)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1340_CARD_REAL_AVATARS.md` (binding) · DESIGN §1/§4/§5 (pixel contract)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on `META-ORCH-1337-social-proof-guest-list`
**Commits:** code+tests `1745bf29a` (carries `[TEST-MOD-APPROVED ORCH-1340]` + `ORCH-1340 [card-real-avatars]`) · report (this commit)
**Date:** 2026-07-10 · **Status:** implemented, partially verified (all structural/CI gates green locally; per-platform runtime screenshots + live-event proofs are the tester's T-1..T-9/T-14)

## 1. Summary

The momentum card's three identical orange silhouettes are now a real, privacy-gated avatar cluster on every card surface. A NEW shared `GuestAvatarCluster` (packages/offering-rendering) is the ONE disk system — photo-in-disk, glyph-in-disk, `+N` chip, "See who's going ›" row, one Pressable — rendered by BOTH `RsvpMomentumDecision` and `OfferingMomentum`. Photos come ONLY from ORCH-1338's server-filtered `SocialProofSummary.sample` and fade in over the glyph (160ms, `isInteraction:false`); a failed photo reverts to the glyph permanently, so private ≡ no-photo ≡ failed-photo is visually indistinguishable (D1's visual half). The `onSeeWhosGoing` affordance seam is threaded through every body — absent handler (all surfaces, this leg) means an inert non-pressable cluster with NO see-row and no dead tap; ORCH-1341/1342 wire the handlers. The heart of the leg — the sanctioned, never-silent retirement of the 1157 anon-cluster invariant — is executed: the pinning test block is rewritten under the append-only token, the component doc-contracts cite the successor `I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED`, the naming drift is swept, and two new fails-on-revert guard suites pin the successor contract.

## 2. SPEC success-criteria coverage

| SC | Status | Evidence / hash |
|---|---|---|
| SC-1-iOS / SC-1-Android / SC-1-Web (real photos lead, glyphs trail, no names) | ✓ structural + bundle @ `1745bf29a`; runtime per-platform = tester T-1/T-14 | Cluster renders `sample[i]` photo else glyph (`guestSample[i]?.avatarUrl`); identity wall green (orch_1340 §4.6-1); component in the exported web `__common` chunk (grep "See who's going" hit) |
| SC-2 (sample [] ⇒ byte-parity glyph cluster) | ✓ structural @ `1745bf29a`; screenshot diff = tester T-2 | `guestSample = []` default; glyph disk = exact prior geometry (30×30 r999 b2, −8 overlap, accent fill, PersonGlyph 15px) pinned by orch_1340 adversarial geometry test |
| SC-3 (dead URL ⇒ permanent glyph, indistinguishable) | ✓ structural @ `1745bf29a`; screenshot diff = tester T-3 | `onError` → `setFailed(true)` unmounts Image; single glyph-disk style asserted (exactly one `backgroundColor: palette.accent` in the file); revert family 1 red-proof |
| SC-4 (privateGuestList ⇒ whole clusterBlock incl. see-row absent) | ✓ @ `1745bf29a` | Gate expressions kept verbatim: `momentum.hasGoing && !privateGuestList ?` (RSVP) and `{!socialProof.privateGuestList ? (` (OM) now wrap the WHOLE `GuestAvatarCluster` (see-row included); orch_1340 D2 test + 1339 T-5 green; live host event = tester T-6 |
| SC-5 (goingCount 0 ⇒ no cluster, no link) | ✓ @ `1745bf29a` | Unchanged `hasGoing` gate (RSVP) + 1339 invisible-at-0 derivation (cross-entity) — both suites green |
| SC-6 (absent handler ⇒ non-pressable, no see-row, no a11y button) | ✓ structural @ `1745bf29a`; runtime tap-proof = tester T-8 | Early-return inert branch: plain View, `${goingCount} people going` label, no button role, no see-row (adversarial inert-branch test isolates the branch and asserts) |
| SC-7 (present handler ⇒ ONE Pressable ≥44pt, label, 0.7 pressed, fires once) | ✓ structural @ `1745bf29a`; runtime harness = tester T-9 | Exactly one `<Pressable` in the file; `accessibilityRole="button"`; label `` `${goingCount} going. See who's going` ``; `pressed: { opacity: 0.7 }`; block ≈60pt (30 disk + 10 gap + 20 see-row) by design geometry |
| SC-8 (intact 1157 suite + 1163 + strict-grep green) | ✓ @ `1745bf29a` | 136/136 across 16 in-scope suites (verbatim §5); strict-grep 0991 + 1292×2 + 1303 + sheet-scroll(1043) + 1167 all PASS (verbatim §5) |
| SC-9 (tests-append-only green with token) | ✓ @ `1745bf29a` | Local gate run: `11 passed, 0 failed` — 1157 file MODIFIED 12 deleted lines, token honored; negative rehearsal in scratch clone without token: `10 passed, 1 failed` (fails exactly on the 1157 file); self-test 6/6 |
| SC-10 (web-build-check: export + 1083 budget + 1137 lucide) | ✓ @ `1745bf29a` | `npx expo export -p web --clear` OK (2390 modules); `ORCH-1083 bundle-budget PASS — initial payload 3250493 bytes (ceiling 9405478), 145 chunk files, 0 deferred specifiers`; `ORCH-1137 render-proof PASS`; package.json diff EMPTY (zero new deps — RN core `<Image>` only) |
| SC-11 (orch_1340 suites pass; §9 reverts fail as contracted) | ✓ @ `1745bf29a` | 45/45 core-4-suite run; all 7 §9 families demonstrated red-then-green (§6) |

## 3. Files changed (14 @ `1745bf29a`, +849/−186)

| File | Δ |
|---|---|
| `packages/offering-rendering/GuestAvatarCluster.tsx` (NEW) | +295 |
| `packages/offering-rendering/RsvpMomentumDecision.tsx` | +63/−76 |
| `packages/offering-rendering/OfferingMomentum.tsx` | +45/−85 |
| `packages/offering-rendering/RsvpOfferingBody.tsx` | +14/−1 |
| `packages/offering-rendering/EventOfferingBody.tsx` / `TripOfferingBody.tsx` / `ExperienceOfferingBody.tsx` | +8 each |
| `packages/offering-rendering/index.ts` (barrel) | +8 |
| `__tests__/orch_1340_guest_identity_privacy.test.ts` (NEW) | +161 |
| `__tests__/orch_1340_guest_identity_privacy_adversarial.test.ts` (NEW) | +162 |
| `__tests__/orch_1157_rsvp_momentum.test.ts` (token-gated) | +36/−12 |
| `__tests__/orch_1339_momentum_adversarial.test.ts` (§4.5-e, status-A) | +33/−12 |
| `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | +4 |
| `mingla-business/src/components/event/PublicEventPage.tsx` | +4 |

Allowlist compliance: every changed file is on the SPEC allowlist. Allowlist item 12 (`orch_1339_momentum_cross_entity.test.ts`) needed NO edit — it carries no Image/uri/Pressable prohibition lines (verified by read; SPEC's "ONLY the T-2 prohibition lines" scope is satisfied by editing the adversarial file alone). `deno.lock` was transiently churned by a legacy-suite run and RESTORED (not committed). DO-NOT-TOUCH: registry, derivations, socialProofTypes, all other tests, workflows — untouched (git diff confirms).

## 4. Data-model changes

None (props-only leg — no DB, no edge functions, no RLS, no migration; I-MOR-0827 holds: the sample rides the hosts' existing 1339 socialProof queries).

## 5. Gates run (verbatim tails)

```
deno (core 5 suites: 1340×2 + 1157 + 1339×2):        ok | 61 passed | 0 failed (214ms)
deno (16 in-scope suites incl. 1157 rounds 2/6/7,
      1163 shared/r2/r4, 1338, 1303, 1292×2):        ok | 136 passed | 0 failed (897ms)
meta-orch-0991:  I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER OK (485 files)
orch-1292 parity:      clean — 45 canonical labels ... all 3 render sites via taxonomyLabel
orch-1292 adversarial: clean — 45 canonical labels byte-exact
orch-1303:       gate PASS — every pulse-loop + meter timing carries isInteraction:false
1043 sheet-scroll (i-bottomsheet-inline-scroll-binding): OK
orch-1167 shell-agnostic-body: PASS
tests-append-only (local, vs origin/main):  Append-only check: 11 passed, 0 failed.
tests-append-only self-test:                Self-test: 6 passed, 0 failed.
tests-append-only WITHOUT token (scratch clone rehearsal): 10 passed, 1 failed  ← red exactly on the 1157 file
web export:      Web Bundled 23956ms index.js (2390 modules)
ORCH-1083:       PASS — initial payload 3250493 bytes (ceiling 9405478), 145 chunks, 0 deferred specifiers, __common within cap
ORCH-1137:       render-proof PASS
```

**Typecheck (`npx tsc --noEmit`, both apps) — zero NEW errors attributable to this diff.** Both apps carry a large pre-existing baseline (app-mobile 902 vs 876 on anchor main; business 780 vs 750). Signature-level diff (file+code, line-numbers normalized) shows every worktree-only signature is either (a) the established `../packages/offering-rendering/*` boundary-noise class (TS2307 "Cannot find module 'react'" / TS7031 implicit-any binding elements / TS2875 jsx-runtime) that EVERY package file already exhibits on main (e.g. `RsvpMomentumDecision.tsx` shows the identical class in the main log) — my new/edited package files simply join that class; or (b) three business signatures in files **byte-identical to origin/main** and absent from my diff (`packages/phone-input/CountryPickerModal.tsx`, `src/components/ui/IconChrome.tsx`, `src/components/ui/Sheet.web.tsx`) — node_modules environment skew between the two checkouts, not this leg. Logs: scratchpad `tsc-*.log` (4 files).

**Jest:** no jest suite added/needed (package tests are Deno house-style). The adjacent batteries were run and baselined: `mingla-business` `src/components/event/__tests__` = 10 failed / 46 passed — **byte-identical failing-suite set on anchor main** (timing-only diff). `app-mobile` `src/screens/Event/__tests__` = 3 suites fail under jest **identically on anchor main** (they are node-assert scripts, not jest suites; no workflow runs them via jest). Zero new failures from this diff.

**Pre-existing latent failures found (NOT fixed — scope discipline):** see §12.

## 6. Regression tests + fails-on-revert

New guard files (both in the closing diff, same branch as the code):
- `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy.test.ts` — 8 tests (SPEC §4.6 items 1–6, 8)
- `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy_adversarial.test.ts` — 9 tests (§4.5-d drift sweep, one-Pressable rule, inert-branch isolation, a11y contract, exact motion pins, disk geometry, photo honesty, host chipFill, sample plumbing)

**fails-on-revert verified at `1745bf29a`** — all SEVEN SPEC §9 families demonstrated by sed-mutation in a scratch copy, each red on the contracted assertion, then green on the pristine restore (`ok | 45 passed | 0 failed`):

| # | Revert (sed-strip in scratch) | Red assertion (verbatim test name) |
|---|---|---|
| 1 | delete `onError={handleError}` + handler | `fallback honesty: onError → glyph permanently; ONE glyph-disk treatment; no private marker` |
| 2 | add `username?: string;` prop to RsvpMomentumDecision | `I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED: photos only via GuestAvatarCluster; names never` + `identity wall: …` |
| 3 | add a second `backgroundColor: palette.accent` "private" disk style | `fallback honesty: … ONE glyph-disk treatment …` |
| 4 | inline `<Image source={{ uri: "x" }} />` into OfferingMomentum | `T-2 (ORCH-1340 successor): photos/sample flow ONLY through GuestAvatarCluster` + `single photo owner: …` |
| 5 | default `onSeeWhosGoing = () => undefined` in the cluster | `affordance integrity: optional onSeeWhosGoing, no no-op fallback, see-row only with handler` |
| 6 | narrow the RSVP D2 gate to `momentum.hasGoing ?` | `D2 gates: privateGuestList suppresses the WHOLE cluster block (affordance included) in both cards` |
| 7 | hex literal `#ff0000` in GuestAvatarCluster | `theme dial: no hex in GuestAvatarCluster; primaryText link label; accent chevron` |

## 7. Old → New receipts

### packages/offering-rendering/GuestAvatarCluster.tsx (NEW, +295)
**Before:** did not exist — each card owned a private glyph-disk cluster (two drifting copies).
**Now:** the ONE disk system. `AvatarDisk` renders the glyph ALWAYS (it IS the loading state); a sampled photo mounts invisibly above (RN core `<Image>`, `resizeMode:"cover"`, absoluteFill) and fades in on `onLoad` (160ms, `Easing.out(ease)`, `useNativeDriver:true`, `isInteraction:false`) with a 1px `palette.panelBorder` hairline; `onError` unmounts the photo permanently. `+N` chip keeps the exact geometry with HOST-supplied `chipFill` (SPEC OQ-2: `chipFill: string` prop chosen over exporting `opaqueCardFill` — the Android-opaque Platform switch stays single-owned in the cards; the cluster has NO Platform import). Handler present ⇒ one Pressable wrapping clusterRow+seeRow ("See who's going" 13px bold `palette.primaryText` + 12×12 accent `ChevronGlyph`, `M9 6l6 6-6 6` sw2.4 round), a11y = ONE button labeled `` `${n} going. See who's going` `` with children hidden; handler absent ⇒ plain View, no see-row. Header carries the payload-is-the-privacy-boundary contract naming the successor invariant.
**Why:** SPEC §4.2; DESIGN §1.1–§1.9 ("the disk is the atom").

### packages/offering-rendering/RsvpMomentumDecision.tsx (+63/−76)
**Before:** private glyph cluster block (disks/chip/note, `PersonGlyph` local); doc header carried `I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY` and the "<Image>/uri never" contract.
**Now:** props add `guestSample` (default `[]`, 1338 frozen entry type import) + `onSeeWhosGoing`; the cluster block is `<GuestAvatarCluster …/>` behind the byte-identical gate `momentum.hasGoing && !privateGuestList ?` with stable testID `orch-1157-rsvp-cluster` and note "are pulling up"; `PersonGlyph` + disk styles removed (moved to the cluster). Doc header rewritten to the successor contract (photos only from the server-filtered sample; glyph = loading/fallback/anonymous; private ≡ no-photo; names only in 1341's authed sheet; cites `I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED` + surviving `I-PROPOSED-1157-ADDRESS-PRIVACY`); retired spelling swept. Kicker, chips, meter, decision buttons, stepper, micro pill, variants, `deriveMomentum` call — byte-untouched (1157 NO-CHECKOUT / DECISION-IS-HERO / THEME-DIAL / Android-opaque / P1-A / adversarial all green with zero edits).
**Why:** SPEC §4.3; F-10 guard rewrite.

### packages/offering-rendering/OfferingMomentum.tsx (+45/−85)
**Before:** 1339 glyph-only cluster (local `PersonGlyph`, react-native-svg import), header said "GLYPH-only until 1340 / sample deliberately unread / no Pressable until 1341".
**Now:** props add `onSeeWhosGoing`; cluster region is `<GuestAvatarCluster …/>` fed `momentum.shownGlyphs`/`overflowCount`, `guestSample={socialProof.sample}`, the model's `clusterNote` (1339 copy table stays the owner), `chipFill={opaqueCardFill(palette)}`, stable testID `orch-1339-momentum-cluster`, behind the byte-identical `{!socialProof.privateGuestList ? (` gate. `PersonGlyph`/svg import/disk styles removed. Header rewritten to the successor contract. Meter stays STATIC; `visible===false` ⇒ null and going-0 rules untouched.
**Why:** SPEC §4.4 (extends 1339, not contradicts).

### packages/offering-rendering/RsvpOfferingBody.tsx (+14/−1)
**Before:** `RsvpOfferingConfig` ended at 1339's two D2 booleans; DecisionUnit forwarded those only.
**Now:** config adds `guestSample?: ReadonlyArray<SocialProofSampleEntry>` + `onSeeWhosGoing?: () => void`; DecisionUnit forwards both (`?? []` / verbatim). Floating-bar mount keeps `showMomentum={false}` (no cluster there). Section anchors untouched.
**Why:** SPEC §4.7.

### Event/Trip/ExperienceOfferingBody.tsx (+8 each)
**Before:** no affordance seam.
**Now:** optional `onSeeWhosGoing` prop forwarded verbatim to the `OfferingMomentum` mount — package-side seam so ORCH-1341/1342 are app-side only. Mount order/testIDs/null-gates untouched (1339 T-4 green).
**Why:** SPEC §4.7.

### index.ts (+8)
**Now:** barrel-exports `GuestAvatarCluster` + `GuestAvatarClusterProps` only (SPEC allowlist item 8's ONLY-clause honored; older comments left byte-intact).

### ConsumerEventDetailScreen.tsx / PublicEventPage.tsx (+4 each)
**Before:** rsvpConfig carried the two 1339 gates from the socialProof query.
**Now:** ONE field each — `guestSample: socialProofQuery.data?.sample ?? []`. No handler wired (1341 = consumer sheet, 1342 = web tap). Standard/trip/experience branches get photos for free through the `socialProof` object already plumbed by 1339.
**Why:** SPEC §4.7 config plumbing. (`app/rsvp/[id]/preview.tsx` untouched — honest zero-state preview.)

### __tests__/orch_1157_rsvp_momentum.test.ts (+36/−12, token-gated)
**Before:** `:120-130` anon-only block banned `<Image>`/`uri` outright, pinned `PersonGlyph` in the card, header cited the retired invariant.
**Now:** ONLY the `:8-16` header refs + that block changed (git diff confirms; all other assertions byte-identical): successor-titled test keeps the name/count bans verbatim, tightens the name wall (`\busername\b`, `displayName` declaration-form ban that excludes React's `displayName =` assignment), requires the `GuestAvatarCluster` import + JSX, keeps the card file itself Image/uri-free (single photo owner), and adds the no-op-fallback ban. The block's comment explains WHY the anon-only assertions were retired (D1) and that the ADDRESS half lives on. PersonGlyph pin moved to the orch_1340 suite.
**Why:** SPEC §4.5-b; token mechanics verified against `.github/scripts/test-append-only-check.js` (`MOD_TOKEN = /\[TEST-MOD-APPROVED (?:META-)?ORCH-\d{4}(?:-[A-Z])?\]/`, HEAD-commit body).

### __tests__/orch_1339_momentum_adversarial.test.ts (+33/−12, status-A vs origin/main — no token required, carried anyway)
**Before:** T-2 banned `<Image>`/`uri`/`.sample`-consumption/`Pressable`/`onPress` in OfferingMomentum — correct for leg 1339, red-by-design once 1340 landed.
**Now:** successor form — the bans now scope to OfferingMomentum ITSELF, plus assertions that the sample and handler are forwarded verbatim to `GuestAvatarCluster` and no no-op fallback exists. All other tests (checkout, theme-dial, Android-opaque, 1303, D2 gate, T-3 separation, sweeps) byte-untouched. `orch_1339_momentum_cross_entity.test.ts` needed no edit.
**Why:** SPEC §4.5-e (the flagged inter-spec wrinkle, resolved as bound).

## 8. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Consumer iOS | YES | Real avatars on RSVP + event/trip/experience clusters; no link yet | Render automatic (shared package); config manual: 1 field (done) |
| Consumer Android | YES | Same; photo disks opaque by nature, glyph solid accent, chip fill host-opaque | Same code; per-platform runtime proof = tester T-14 |
| Buyer/anon Web | YES | Same on /e /t /exp public pages; RPC decides privacy server-side | Render automatic; config manual: 1 field (done); export+budget proven |
| Business iOS / Android | YES | Same public pages (same code); preview stays honest zero-state | Automatic; NATIVE BUILD ONLY channel (COMMS-0052/0063 — no OTA) |
| Admin Web | NO | zero offering-rendering mounts (F-2) | — |
| Business Web preview | YES (unchanged behavior) | no sample/handler passed ⇒ glyph-only inert cluster at count 0 | Automatic |

## 9. Smoke result

No simulator/device run this session (per-platform runtime proof is the tester's T-14 with Maestro `--device`). Compile-level smoke: the full business web export bundled 2390 modules including the new component (its "See who's going" literal lands in the `__common` chunk) with the 1083 budget + 1137 lucide proofs green — a real Metro parse/bundle of every touched file. Deno structural suites exercise all three components' source contracts.

## 10. Known issues / deferred

- **No `[TRANSITIONAL]` code.**
- The cross-entity cluster's inert a11y label is now `` `${goingCount} people going` `` on ALL entities (SPEC §4.2's exact non-pressable contract) — 1339's label read "people booked" for experiences. Cosmetic a11y wording only; flagged for the tester/orchestrator (a `clusterNoteA11y` variant would need a SPEC amendment).
- Web hover feedback rides the Pressable pressed-state styling (SPEC's "Pressable style fn"); rn-web pointer hover shows the cursor but the 0.7 opacity binds to press — matches SPEC §4.2 text; DESIGN §1.4's hover note would need a web-specific state hook (1342's territory if wanted).
- After this leg alone, cards show photos and NO link on every surface — by design (absent-handler state); 1341/1342 wire the handlers.

## 11. Operator / orchestrator action required

- **No migration. No edge deploy. Nothing to apply.**
- **Registry edit (orchestrator-owned, at CLOSE — SPEC §4.5-a; NOT committed by me).** Replace `INVARIANT_REGISTRY.md:687-690` (`### I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)`) with:

```diff
-### I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)
-- **Rule:** RSVP social proof is the going COUNT + capacity meter + an anonymous faceless cluster ONLY — never guest names/avatars, no public maybe/waitlist count (constitution rule 9, no fabricated data). AND the exact street address is hidden until the viewer is Going/Maybe (RSVP) / purchased (ticketed); the venue NAME must never carry the street.
-- **Enforcement:** strict-grep + the address-gate + round-4/5 discover-card tests; fails-on-revert.
-- **Established:** ACTIVE on ORCH-1157 close 2026-06-18.
+### I-PROPOSED-1157-ADDRESS-PRIVACY (ACTIVE)
+- **Rule:** the exact street address is hidden until the viewer is Going/Maybe (RSVP) / purchased (ticketed); the venue NAME must never carry the street.
+- **Enforcement:** strict-grep + the address-gate + round-4/5 discover-card tests; fails-on-revert.
+- **Established:** ACTIVE on ORCH-1157 close 2026-06-18; split out of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY at ORCH-1340 CLOSE (anon-cluster half retired and superseded — see I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED).
```

  and add under a new ORCH-1340 section:

```diff
+### I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (DRAFT)
+- **Rule:** Guest identity on public surfaces is PRIVACY-GATED, never anonymous-by-blanket and never fabricated: (i) the momentum cluster may render real avatar PHOTOS only from the server-filtered sample (`pg_public_social_proof().sample`) — guests with `visibility_mode IN ('public','friends')` AND a non-empty avatar, blocked pairs excluded per authed viewer, `private` profiles excluded (D1/D9); (ii) guest NAMES/usernames never render on the card and never cross the wire to anon callers — names exist only in the authed guest-list read (`peer_list_event_guests`, ORCH-1341's sheet); (iii) `privateGuestList = true` suppresses the cluster, the "See who's going" affordance, and the peer list, enforced SERVER-side (D2); (iv) the glyph disk is the honest loading/fallback/anonymous state, and a private guest is visually INDISTINGUISHABLE from a guest with no photo or a failed photo load — no lock/dim/badge treatment may ever mark private guests (the D1 visual half); (v) no public maybe/waitlist count (carried forward from the retired invariant).
+- **Enforcement:** rewritten `orch_1157_rsvp_momentum.test.ts` identity block + `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy*.test.ts` (client half) + ORCH-1338's `orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` (server half); fails-on-revert.
+- **Established:** DRAFT at ORCH-1340 SPEC 2026-07-10; supersedes the anon-cluster half of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (a.k.a. the component/test spelling I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY — naming drift swept at this CLOSE). Orchestrator flips ACTIVE at CLOSE.
```

- **Token escrow:** every commit pushed to this branch until merge must keep `[TEST-MOD-APPROVED ORCH-1340]` + `ORCH-1340 [card-real-avatars]` in its body (the CI gate reads ONLY the PR-head commit). Both branch commits so far comply; keep the footer on tester/CLOSE commits.
- **COMMS ledger:** entry acks NOT written by me — `COMMS_LEDGER.md` is on this SPEC's DO-NOT-TOUCH list and the dispatch scopes my git writes to this worktree. Relevant rows read + factored: COMMS-0052/0063 (business OTA frozen — routing note only, I deploy nothing), COMMS-0087 (TS7 CI pin, already merged). Orchestrator may append acks at CLOSE.
- **Delivery routing (for SHIP):** consumer = per-platform OTA-able (pure JS); business = NATIVE BUILD ONLY; web = Vercel `[deploy]`.

## 12. Discoveries for Orchestrator

1. **Latent main-red test debt (pre-existing, reproduced byte-identically in the pristine anchor on `main`; NOT touched by this leg):**
   - `packages/offering-rendering/__tests__/orch_1157_round8_android_gap_and_stop_time.test.ts` (4 cases) + `orch_1157_round9_android_gap_wrapinrnmodal.test.ts` (4 cases) + `orch_1163_r3_rsvp_floating_active.test.ts` §6b (1 case) — 9 deno failures on main today. No workflow appears to run these files (the docs-only-CLOSE latent-red class).
   - `mingla-business` jest `src/components/event/__tests__`: 10 failing tests across 4 suites on main (`EditPublishedScreen_when_save_gate`, `EventListCard_defensiveFilter`, `PublicEventPage.closeButton.adversarial`, `RsvpPublicBody.parallaxLayering.orch1150r2`) — identical set on the anchor.
   - `app-mobile` `src/screens/Event/__tests__`: 3 files are node-assert scripts that fail under jest on main too (one, `orch_1138_event_reserve_float_dock`, fails its own assertion when run directly).
   - Legacy deno suites `orch_1167_r2/r3/r7` + `meta_orch_1174_legB3` fail identically on main under `--sloppy-imports` (uncaught errors / env deps).
2. **tsc/eslint environment skew:** three business tsc signatures (`CountryPickerModal`, `IconChrome` 'hovered', `Sheet.web` cursor) differ between the worktree and anchor node_modules on files byte-identical to main; eslint `import/no-unresolved` fires on all `@mingla/*` aliases (resolver config gap). Worth one hygiene ORCH if CI ever starts type-gating these apps.
3. **Metro cross-checkout resolution:** the worktree web export resolved one expo-router asset through `../../../mingla-main/mingla-business/node_modules/...` — the known shared-cache/watchFolder behavior; harmless here (CI installs fresh) but reinforces the no-concurrent-OTA rule.
4. **a11y wording drift** (§10): inert cross-entity cluster label now says "people going" for experiences (was "people booked") — SPEC-exact but flagged.
5. **Drift-sweep completeness note:** after this leg, exactly ONE occurrence of `SOCIAL-PROOF-ANON-ONLY` survives in the swept paths — the ban regex inside `orch_1340_guest_identity_privacy_adversarial.test.ts:48` itself (an enforcement site must name the token it bans; same pattern as every strict-grep gate). All §4.5-d inventory occurrences (component `:25`, momentum test `:9`/`:120`) are gone; registry `:687` is the orchestrator's CLOSE edit.

## 13. Invariant preservation check (Pre-Flight step 6 / Post-Flight)

Preserved Y: I-PROPOSED-1157-ADDRESS-PRIVACY (untouched tests) · NO-CHECKOUT / DECISION-IS-HERO / THEME-DIAL / ANDROID-OPAQUE (assertions green, extended to the new file by orch_1340) · ORCH-1303 (photo fade carries `isInteraction:false`; gate PASS) · I-MOR-0827 (no fetch; §4.6-8) · Constitution #9 (glyph fallback honest, no placeholder faces — adversarial pin) · 1339 DRAFTs (D2 gates + copy tables untouched; suppression now provably covers the affordance) · meta-orch-0991/1043 (gates PASS). Retired-with-successor (deliberate, never silent): the anon-cluster half of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY → I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (DRAFT; registry edit = orchestrator at CLOSE, §11).
