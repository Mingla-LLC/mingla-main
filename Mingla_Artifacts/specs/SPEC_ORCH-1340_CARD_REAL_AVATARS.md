# SPEC — ORCH-1340 [card-real-avatars]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 3 of 5 (after 1338 backend + 1339 cross-entity card; before 1341 sheet wiring)
**Phase:** SPEC (forensics SPEC mode — contract, not code)
**Binding investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md` — F-1, F-6, F-7, F-10 (the guard-rewrite inventory is THIS leg's heart), F-11 govern.
**Binding design:** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1337_GUEST_SOCIAL_PROOF.md` §1 (card cluster), §4 (copy), §5 (guard notes) — the design file is BINDING for every token, dimension, state, and motion; this SPEC cites its sections and restates only what the implementor needs inline.
**Binding payload contract:** `SPEC_ORCH-1338_GUEST_READ_BACKEND.md` §4.4 — `SocialProofSummary.sample: SocialProofSampleEntry[]` where `SocialProofSampleEntry = { avatarUrl: string; isMinglaUser: true }`, `SOCIAL_PROOF_SAMPLE_MAX = 5`, from `packages/offering-rendering/socialProofTypes.ts`. Consumed as-frozen; never redefined here.
**Binding card contract extended:** `SPEC_ORCH-1339_MOMENTUM_CARD_CROSS_ENTITY.md` §4.4 (`OfferingMomentum` props `{palette, theme, socialProof, testID}`; `RsvpMomentumDecision` gains `privateGuestList`/`hideRemainingCount`; `RsvpOfferingBody` config forwarding) — not contradicted; extended per §4 below.
**Sealed decisions honored (not re-opened):** D1 (visibility public|friends → real avatar on card; private → glyph; blocked-pair excluded; anon web = no names), D2 (privateGuestList suppresses cluster + affordance), D3 (buyers-only identity; extra seats glyphs — server-side, already encoded in the 1338 sample), DESIGN decisions (link label `palette.primaryText` NOT accent; chevron carries accent; glyph = loading state; photo-fades-over-glyph; error → glyph; private ≡ no-photo indistinguishable — written into the successor invariant; one Pressable, no affordance without the visible link; `onSeeWhosGoing` absent ⇒ inert, no dead tap).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`.
**Date:** 2026-07-10

---

## 1. Executive summary

The momentum card's "N going" cluster is three identical orange silhouettes on every surface (F-1). ORCH-1338 now serves a privacy-filtered avatar sample (`pg_public_social_proof().sample` — only `visibility_mode public|friends` guests WITH avatars, blocked pairs excluded, empty when `privateGuestList` is on). This leg makes the cluster REAL: photos fade in over the glyph disks where the sample provides them, the glyph remains the loading/fallback/anonymous state (15% avatar fill — F-11 — makes the mixed cluster the permanent normal), and the cluster gains its tap affordance ("See who's going ›" + one Pressable) that ORCH-1341 will wire to the guest-list sheet — absent handler ⇒ today's inert cluster, no dead tap.

The heart of the leg is the **deliberate, never-silent rewrite of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY** (F-10): the anon-cluster half is retired and superseded by I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (DRAFT); the bundled ADDRESS-privacy half survives VERBATIM as its own registry entry; the pinning test block (`orch_1157_rsvp_momentum.test.ts:120-130`) is rewritten under the tests-append-only override token `[TEST-MOD-APPROVED ORCH-1340]`; the component doc-contract header is rewritten; the registry-vs-component invariant-name drift is swept. New fails-on-revert guards pin the successor contract.

## 2. Scope & non-goals

**In scope**
- NEW shared pure component `packages/offering-rendering/GuestAvatarCluster.tsx` — the ONE disk system (photo/glyph/+N/see-row/Pressable) consumed by BOTH momentum cards (design "the disk is the atom" one-system rule; prevents two drifting cluster implementations).
- `RsvpMomentumDecision.tsx`: props delta (`guestSample`, `onSeeWhosGoing`), cluster block replaced by `GuestAvatarCluster`, doc-contract header rewrite.
- `OfferingMomentum.tsx` (1339's component): `onSeeWhosGoing` prop added; its glyph cluster region replaced by `GuestAvatarCluster` fed from `socialProof.sample`.
- `RsvpOfferingBody.tsx`: `RsvpOfferingConfig` + `DecisionUnit` forwarding for the two new fields.
- Body passthrough: `EventOfferingBody`/`TripOfferingBody`/`ExperienceOfferingBody` gain optional `onSeeWhosGoing` forwarded to `OfferingMomentum` (package-side seam so ORCH-1341 is app-side only).
- Config plumbing (`guestSample` only) on the two surfaces that feed the RSVP card scalars: `ConsumerEventDetailScreen` + `PublicEventPage` (both already hold the 1339 socialProof query; `sample` rides it).
- THE GUARD REWRITE (F-10): registry entry split (content contract §4.6 — applied by the ORCHESTRATOR at CLOSE), `orch_1157_rsvp_momentum.test.ts:120-130` + its header references (token-gated), component doc-contract, naming-drift sweep, plus the sanctioned in-branch update of ORCH-1339's new `orch_1339_*` T-2 prohibitions (see §4.7 — they would otherwise turn red on this leg by design).
- NEW fails-on-revert guard tests for the successor invariant.

**Non-goals (explicitly out)**
- The guest-list sheet, add-friend/message actions, and the tap HANDLER on any surface → ORCH-1341 (this leg ships the affordance seam; no consumer passes `onSeeWhosGoing` yet — after this leg alone, cards show photos and NO link, per the design's absent-handler state).
- Buyer-web tap behavior / `SeeWhosGoingGate` / QR / store links → ORCH-1342 (web mounts simply don't pass the prop yet).
- Any backend change; any change to `pg_public_social_proof` / `peer_list_event_guests` / `socialProofTypes.ts` (1338 frozen); any change to `rsvpMomentum.ts` / `socialProofMomentum.ts` derivations (counts/copy are 1339's, untouched).
- Names/usernames anywhere on the card — the payload physically cannot carry them (1338 whitelist) and the successor guards ban them (D1: names live only in 1341's authed sheet).
- Wizard/toggle work (1339), admin-web (no mounts, F-2), brand tiles (D7).

**Assumptions (investigation/design-proven, re-verified verbatim this session)**
- Cluster block today: `RsvpMomentumDecision.tsx:380-418` — plain View, `styles.avatar` disks 30×30 radius 999 borderWidth 2 `overflow:'hidden'`, `marginLeft:-8` overlap, `PersonGlyph` (:158-168), `+N` chip, "are pulling up" note. Geometry is KEPT; photos load INTO the existing disk (design §1.1).
- The 1157 momentum test strips ALL comments before asserting (`orch_1157_rsvp_momentum.test.ts:38-41`) — doc-comment rewrites never trip source assertions; only rendered code does.
- Tests-append-only mechanics (verbatim-read `.github/workflows/tests-append-only.yml` + `.github/scripts/test-append-only-check.js`): modifying an existing test file with ANY deleted line fails CI unless the **latest commit body** (the PR-head commit — the workflow pins `ref: github.event.pull_request.head.sha`) contains the case-sensitive token matching `\[TEST-MOD-APPROVED (?:META-)?ORCH-\d{4}(?:-[A-Z])?\]`, AND (Rule 0) the cited ORCH appears with a bracketed label in the same commit body. **Exact strings for this leg:** `[TEST-MOD-APPROVED ORCH-1340]` + `ORCH-1340 [card-real-avatars]`. Deletions of test files cannot be overridden at all. (Corrects F-10's `TEST-CHANGE-APPROVED` recollection — that token does not exist.)
- Biz-web bundle gate (verbatim-read `.github/workflows/web-build-check.yml`): `expo export -p web` + `scripts/ci/orch-1083-initial-bundle-budget.mjs` (deferred heavy deps must not enter the entry chunk; `__common` cap; initial-payload ceiling) + the ORCH-1137 lucide render-proof. **Binding:** avatar rendering uses React-Native core `<Image>` ONLY — no `expo-image`, no `FastImage`, no QR/canvas dep, zero new dependency — so the 1083 budget cannot move.
- Invariant-string occurrence inventory (grep-verified this session; complete): `RsvpMomentumDecision.tsx:25` (`I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY`), `orch_1157_rsvp_momentum.test.ts:9` (header) + `:120` (test title, RSVP-prefixed), `INVARIANT_REGISTRY.md:687` (`I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY`, no "RSVP"). WORLD_MAP mentions are historical narrative — orchestrator-owned, synced at CLOSE, not edited by the implementor.
- `RsvpMomentumDecision.displayName = "RsvpMomentumDecision"` exists at `:650` — the successor name-ban regex must not false-positive on React's `displayName` assignment (see §4.5 assertion design).

## 3. Cross-Surface Impact Declaration

Card render parity is AUTOMATIC (one shared package component chain, F-2); only the `guestSample` config plumbing is manual, and only on RSVP mounts (the cross-entity card reads `sample` from the `socialProof` object 1339 already plumbs everywhere).

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | Real avatars in the cluster on RSVP + standard + trip + experience details; glyph fallback; no link yet (handler unwired until 1341) | `ConsumerEventDetailScreen.tsx` (rsvpConfig `guestSample` one field) + shared package | Render automatic; config manual (1 field) |
| 2 | Consumer Android | YES | Same + opaque-fill policy unchanged (photo disks are opaque by nature) | same | Same code; runtime proof per platform |
| 3 | Buyer/anon Web (`/e /t /exp /checkout`) | YES | Same clusters on all four entity pages; anon payload already privacy-shaped server-side (D1/D9 — the RPC, not the client, decides) | `PublicEventPage.tsx` (RSVP config `guestSample` one field) + shared package | Render automatic; config manual (1 field) |
| 4 | Business iOS | YES | Same public pages (same code as #3); business RSVP preview stays honest zero-state (goingCount 0 ⇒ no cluster) | none beyond #3's files | Automatic |
| 5 | Business Android | YES | Same as #4 | none | Automatic |
| 6 | Admin Web (`mingla-admin/`) | NOT covered | — zero offering-rendering mounts (F-2) | none | — |
| 7 | Business Web preview (`/rsvp/[id]/preview`, wizard previews) | YES | Unchanged: preview passes no `guestSample`/`onSeeWhosGoing` ⇒ glyph-only inert cluster at count 0 (design §1.5 absent-handler state) | none | Automatic |

**Delivery constraints (routing note):** consumer = per-platform OTA-able (pure JS); business = NATIVE BUILD ONLY channel discipline (COMMS-0052/0063); web = Vercel `[deploy]` tag. One META PR at CLOSE (WORLD_MAP plan) — the token rules in §4.5 assume that; see §9 if legs split into separate PRs.

## 4. Layered specification

Database / edge function / service / hook / realtime: **none** (props-only leg; I-MOR-0827 — the package never fetches; the sample arrives through the hosts' existing 1339 socialProof reads).

### 4.1 Payload consumed (frozen; one contradiction flagged)

The card consumes `SocialProofSampleEntry = { avatarUrl: string; isMinglaUser: true }` (1338 §4.4). ⚠️ **Contradiction flag (resolved by dispatch precedence, not silently):** DESIGN §1.2/§1.6 sketched `guestSample` entries as `{ id: string; avatarUrl: string }`. The 1338 sample deliberately carries **no id** (anon-callable RPC; ids would be a scrape vector — 1338 §4.1.1 whitelist is `avatarUrl`/`isMinglaUser` ONLY). The META dispatch binds 1340 to `SocialProofSummary.sample`, so the 1338 shape WINS: **no `id` field; React keys are the disk index** (the existing cluster already keys by index, `RsvpMomentumDecision.tsx:387`). Design intent (stable keys) is unaffected: the sample is server-ordered and ≤5 entries.

Sample size note (flagged, harmless): 1338 serves ≤`SOCIAL_PROOF_SAMPLE_MAX = 5`; the card renders ≤`RSVP_CLUSTER_SHOWN = 3` disks (`rsvpMomentum.ts` — UNCHANGED). Contract: disk `i` (0-based, `i < momentum.shownAvatars`) renders `sample[i]`'s photo when present, else the glyph. Entries beyond the shown disks are ignored by the card (headroom for the 1342 web-gate mini-cluster echo, DESIGN §3.1).

### 4.2 NEW package component — `packages/offering-rendering/GuestAvatarCluster.tsx`

Pure (react + react-native + react-native-svg + `themePalette` only; NO fetch, NO app import — I-MOR-0827). The ONE cluster block both cards render. **All visuals per DESIGN §1.1–§1.4 (BINDING); the anatomy contract:**

```
clusterBlock  ← ONE <Pressable> when onSeeWhosGoing present; plain <View> when absent
├── clusterRow   disks (photo|glyph) + "+N" chip + note        ← geometry = today's cluster
└── seeRow       "See who's going" + ChevronGlyph              ← renders ONLY when onSeeWhosGoing present
```

**Props (exact):**
- `palette: ThemePalette; theme: ResolvedTheme;`
- `shownCount: number;` (the host's `momentum.shownAvatars` / `shownGlyphs` — disk count math stays owned by the derivations, UNCHANGED)
- `overflowCount: number;` (drives the `+N` chip, unchanged semantics)
- `goingCount: number;` (a11y group label)
- `guestSample?: ReadonlyArray<SocialProofSampleEntry>;` (default `[]`; import type from `./socialProofTypes`)
- `clusterNote: string;` (entity note — "are pulling up" etc., supplied by each card so 1339's copy table stays the single owner)
- `onSeeWhosGoing?: () => void;` (**exact sealed name**; absent ⇒ non-pressable View, NO seeRow, NO dead tap — design §1.5)
- `testID?: string;` (hosts pass their existing cluster testIDs through — `orch-1157-rsvp-cluster` / `orch-1339-momentum-cluster` stay stable)

**Disk states (DESIGN §1.2, restated because load-bearing):**
1. Glyph disk = today's exactly: fill `palette.accent`, 15px `PersonGlyph` stroked `palette.accentText`, 2px `palette.page` border, 30×30 r999 `overflow:'hidden'`, overlap `marginLeft:-8`. `PersonGlyph` moves/duplicates INTO this file (the rewritten 1157 test re-pins it here — §4.5).
2. Photo loading = the glyph disk IS the loading state; `<Image>` (RN core) absolute inset 0, `resizeMode:'cover'`, mounts at opacity 0 above the glyph. No skeleton/shimmer. Zero layout shift by construction.
3. Photo loaded: `onLoad` → opacity 0→1, 160ms, `Easing.out(Easing.ease)`, `useNativeDriver:true`, **`isInteraction:false`** (mandatory — the ORCH-1303 starvation class; DESIGN §1.7); plus the 1px `palette.panelBorder` inner hairline overlay (edge definition on uncontrolled photo content).
4. Photo failed: `onError` → unmount the Image; the disk stays a glyph disk permanently. **Indistinguishable from no-photo — deliberate.**
5. Private guest / no photo: same glyph disk. **Private ≡ no-photo ≡ failed-photo indistinguishability is the visual half of D1 and MUST hold** (successor invariant clause; a lock/dim/badge treatment would leak "someone is hiding"). Encoded: exactly ONE glyph-disk style object; no `lock`/badge/dim token anywhere in this file.
- `+N` chip: unchanged geometry/fill/text (design kept it non-tappable — the seeRow is the affordance).
- seeRow (design §1.1/§1.4): marginTop 10, minHeight 20, gap 4; label "See who's going" 13px `boldFontFamily(theme)` letterSpacing 0.2 color **`palette.primaryText`** (sealed: NOT accent — AA on arbitrary brand dials); NEW `ChevronGlyph` SVG 12×12 (viewBox 24, `M9 6l6 6-6 6`, strokeWidth 2.4, round cap) stroke `palette.accent` (UI mark, 3:1 rule).
- Pressed/hover: children opacity 0.7 (Pressable style fn); no scale (design §1.7).
- a11y (design §1.4/§1.8): the Pressable is ONE button, `accessibilityRole="button"`, label `` `${goingCount} going. See who's going` ``; disks + note hidden from the tree (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`). When non-pressable (handler absent): keep today's plain-View a11y (`accessibilityLabel` = `${goingCount} people going`).
- **NO hex literals; NO name fields; NO checkout tokens** — every color is `palette.*`/existing helpers; the THEME-DIAL and NO-CHECKOUT gates extend over this file via the new orch_1340 tests (§4.6).
- Android: photo disks opaque by nature; glyph = solid accent; `+N` chip fill supplied by the HOST (each card passes its own `opaqueCardFill(palette)` result via a `chipFill: string` prop — keeps the Platform switch single-owned in the cards; alternative acceptable form: export the existing `opaqueCardFill` helper — implementor picks ONE, documents it).

### 4.3 `RsvpMomentumDecision.tsx` (MODIFY)

1. **Props add (after 1339's two booleans):** `guestSample?: ReadonlyArray<SocialProofSampleEntry>;` (default `[]`) + `onSeeWhosGoing?: () => void;`. Props still carry NO name/username field — bound by the rewritten source guards.
2. **Cluster block (:380-418) replaced** by `<GuestAvatarCluster …/>` fed `momentum.shownAvatars` / `momentum.overflowCount` / `goingCount` / `guestSample` / note `"are pulling up"` / `onSeeWhosGoing` / testID `orch-1157-rsvp-cluster`. Render condition stays 1339's: `momentum.hasGoing && !privateGuestList` — that gate now suppresses the WHOLE clusterBlock **including the seeRow/affordance** (D2: cluster + affordance both gone; DESIGN §1.5 "absence IS the design" — nothing replaces it). `goingCount === 0` ⇒ no cluster and no link (existing `hasGoing` gate).
3. **Doc-contract header rewrite (:21-27 region ONLY within the header):** the glyph-only paragraph is REPLACED with the successor contract. Required content (prose may vary, substance may not): social proof is honest count + meter + a privacy-gated cluster; photos render ONLY from the server-filtered `SocialProofSummary.sample` (visibility public|friends, avatar-bearing, block-excluded, empty under privateGuestList — D1/D2/D9); the glyph is the loading/fallback/anonymous state and **private is indistinguishable from no-photo by design**; the props surface carries avatars and a tap callback but NEVER names/usernames/maybeCount/waitlistCount; names live only in the authed guest-list sheet (ORCH-1341). Cite `I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED` and `I-PROPOSED-1157-ADDRESS-PRIVACY` (the surviving half). The old name `I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY` (:25) must not survive anywhere in the file (drift sweep, §4.5-d).
4. Everything else byte-untouched: kicker, chips, meter, decision buttons, stepper, micro pill, variants, 1339's `deriveMomentum(goingCount, hideRemainingCount ? null : capacity)` call. The intact 1157 gates (:103-118 NO-CHECKOUT + DECISION-IS-HERO, :132-145 THEME-DIAL — `backgroundColor: palette.accent` remains via meter/going/dot, :147-152 Android opaque — `Platform.OS === "android"` + `overflow: "hidden"` remain via `opaqueCardFill`/styles, :168-179 P1-A) MUST stay green with zero edits.

### 4.4 `OfferingMomentum.tsx` (MODIFY — 1339's component, extended not contradicted)

1. Props add: `onSeeWhosGoing?: () => void;` — nothing else (the sample already rides `socialProof.sample`; 1339 §4.1 deliberately shaped for this).
2. Its glyph-cluster region is replaced by `<GuestAvatarCluster …/>` fed `shownGlyphs`/`overflowCount` from `deriveSocialProofMomentum`, `guestSample={socialProof.sample}`, the model's `clusterNote` (1339 copy table stays the owner), testID `orch-1339-momentum-cluster`.
3. Gates identical to the RSVP card: `privateGuestList === true` ⇒ no clusterBlock (incl. seeRow); `visible === false` ⇒ component renders null (1339 rule, untouched); `goingCount 0` ⇒ ticketed unit not rendered at all (1339 rule, untouched).
4. 1339's other contracts stay binding: no checkout tokens, no hex, no kicker/chips/decision, opaque fill pattern, static-or-`isInteraction:false` meter.

### 4.5 THE GUARD REWRITE (the heart — exact edit contracts)

#### (a) `Mingla_Artifacts/INVARIANT_REGISTRY.md` (~line 687) — content contract; **the ORCHESTRATOR applies this at CLOSE** (registry writes are orchestrator-owned per house rule; the implementor does NOT edit this file)

REPLACE the single entry `### I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)` (:687-690) with the following TWO entries (under the same ORCH-1157 section for the survivor; the successor lives under a new ORCH-1340 section when the orchestrator syncs):

1. **`### I-PROPOSED-1157-ADDRESS-PRIVACY (ACTIVE)`** — the surviving half, its rule text preserved VERBATIM from the current entry:
   - **Rule:** "the exact street address is hidden until the viewer is Going/Maybe (RSVP) / purchased (ticketed); the venue NAME must never carry the street."
   - **Enforcement:** unchanged from today's entry — "strict-grep + the address-gate + round-4/5 discover-card tests; fails-on-revert" (those tests are NOT touched by this leg).
   - **Established:** ACTIVE on ORCH-1157 close 2026-06-18; split out of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY at ORCH-1340 CLOSE (anon-cluster half retired and superseded — see I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED).
2. **`### I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (DRAFT)`** — the successor (DRAFT; the orchestrator flips ACTIVE at CLOSE; this SPEC does not):
   - **Rule (required substance, encode ALL clauses):** Guest identity on public surfaces is PRIVACY-GATED, never anonymous-by-blanket and never fabricated: (i) the momentum cluster may render real avatar PHOTOS only from the server-filtered sample (`pg_public_social_proof().sample`) — guests with `visibility_mode IN ('public','friends')` AND a non-empty avatar, blocked pairs excluded per authed viewer, `private` profiles excluded (D1/D9); (ii) guest NAMES/usernames never render on the card and never cross the wire to anon callers — names exist only in the authed guest-list read (`peer_list_event_guests`, ORCH-1341's sheet); (iii) `privateGuestList = true` suppresses the cluster, the "See who's going" affordance, and the peer list, enforced SERVER-side (D2); (iv) the glyph disk is the honest loading/fallback/anonymous state, and **a private guest is visually INDISTINGUISHABLE from a guest with no photo or a failed photo load** — no lock/dim/badge treatment may ever mark private guests (the D1 visual half); (v) no public maybe/waitlist count (carried forward from the retired invariant).
   - **Enforcement:** rewritten `orch_1157_rsvp_momentum.test.ts` identity block + NEW `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy*.test.ts` (client half) + ORCH-1338's `orch_1338_social_proof_reads.antiScrape.adversarial.test.ts` (server half); fails-on-revert.
   - **Established:** DRAFT at ORCH-1340 SPEC 2026-07-10; supersedes the anon-cluster half of I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (a.k.a. the component/test spelling `I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY` — naming drift swept at this CLOSE).

#### (b) `packages/offering-rendering/__tests__/orch_1157_rsvp_momentum.test.ts` — token-gated rewrite

**Edit surface (ONLY these regions):** the `:120-130` anon-only test block, and the header comment references at `:8-10` (invariant list) and `:15-16` ("re-introduce an `<Image>`/uri … FAIL" fails-on-revert note). Every other test in the file is UNTOUCHED (NO-CHECKOUT :103-110, DECISION-IS-HERO :112-118, THEME-DIAL :132-145, Android opaque :147-152, three-way reply :154-158, P1-A :168-179, all pure-derivation tests :45-99).

**Successor test block contract** (replaces :120-130; title cites the successor invariant):
- KEEP (carried forward): `assert(!/maybeCount/.test(COMPONENT))`, `assert(!/waitlistCount/.test(COMPONENT))`, `assert(!/guestName|guestPhoto|attendeeName|guestAvatar/.test(COMPONENT))`.
- ADD name-ban tightening: no `username` token and no name-bearing PROP declaration in the card source — assertion form must not false-positive on React's `displayName = ` assignment at `:650`: ban the declaration form (e.g. `/displayName\s*[?:]:/` and `/\busername\b/`), not the bare word `displayName`.
- REPLACE the `<Image`/`uri` bans (photos are now sanctioned) with STRUCTURE requirements: the card renders its cluster exclusively through `GuestAvatarCluster` (assert the import + JSX usage), and the card file itself STILL contains no `<Image\b` / `\buri\b` (the Image lives only inside `GuestAvatarCluster.tsx` — single photo-rendering owner).
- ADD affordance-integrity: source contains `onSeeWhosGoing` as an optional prop and NO no-op fallback (`assert(!/onSeeWhosGoing\s*=\s*\(\)\s*=>/.test(COMPONENT))` — the absent-handler path must be the non-pressable View, never a dead handler).
- The `PersonGlyph` presence assertion MOVES to the new `orch_1340_*` test against `GuestAvatarCluster.tsx` (the glyph's new home).

**Token mechanics (BINDING, exact):** this edit deletes lines ⇒ the commit that lands it MUST carry, in its body: `[TEST-MOD-APPROVED ORCH-1340]` and (Rule 0) `ORCH-1340 [card-real-avatars]`. The CI gate reads ONLY the PR-HEAD commit body (`git log -1` at `pull_request.head.sha`) — therefore **every commit pushed to the branch from this edit until merge must carry both strings in its body** (cheapest compliance: make this the standing commit-body footer for the remainder of the META branch). Renames/deletions of the file are FORBIDDEN (delete has no override).

#### (c) Component doc-contract rewrite — per §4.3-3 (RsvpMomentumDecision header) and a matching one-paragraph contract atop `GuestAvatarCluster.tsx` (states the payload-is-the-privacy-boundary rule: "this component receives ONLY the server-filtered avatar sample; it must never grow a name/username/id prop — names belong to the authed sheet").

#### (d) Naming-drift sweep — the complete occurrence list (grep-verified §2): after this leg, the string `SOCIAL-PROOF-ANON-ONLY` (either spelling) survives NOWHERE in `packages/`, `app-mobile/src`, `mingla-business/src`, or `.github/` (occurrences at `RsvpMomentumDecision.tsx:25`, test `:9`/`:120` all rewritten). `INVARIANT_REGISTRY.md:687` is the orchestrator's CLOSE edit (a). WORLD_MAP historical rows are exempt (narrative history, orchestrator-owned). A sweep assertion lands in the new guard test (§4.6).

#### (e) ORCH-1339's new test files — sanctioned in-branch update (flagged inter-spec wrinkle, not silently resolved)

`orch_1339_momentum_cross_entity.test.ts` / `orch_1339_momentum_adversarial.test.ts` (1339 §7 T-2) pin `OfferingMomentum` source to "no `<Image\b`, no `\buri\b`, no `onPress|Pressable`". Those assertions are CORRECT for leg 1339 in isolation and turn red the moment this leg lands — by design (1339 explicitly defers avatars/tap to 1340). **Contract:** this leg rewrites those specific prohibition lines to the successor form (no Image/uri/Pressable **in `OfferingMomentum.tsx` itself** — photos + press live only in `GuestAvatarCluster`; assert the `GuestAvatarCluster` import instead). **Token note:** while the META ships as ONE PR, these files are status-A (added) vs `origin/main`, so the append-only gate does not fire on intra-branch edits to them — no token needed for (e). If the plan changes to per-leg PRs, (e) becomes token-gated exactly like (b) and the §9 escrow applies.

### 4.6 NEW fails-on-revert guard tests (successor invariant enforcement)

**File:** `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy.test.ts` (+ `orch_1340_guest_identity_privacy_adversarial.test.ts`) — Deno source-structure suites in the 1157/1163 house style (read file → strip comments → assert), covering `GuestAvatarCluster.tsx`, `RsvpMomentumDecision.tsx`, `OfferingMomentum.tsx`:

1. **Identity wall:** no `guestName|guestPhoto|attendeeName|guestAvatar`, no `\busername\b`, no name-prop declaration, in ALL THREE files; `GuestAvatarCluster` imports its entry type from `./socialProofTypes` (the shape that cannot carry names).
2. **Single photo owner:** `<Image\b` appears in `GuestAvatarCluster.tsx` ONLY (the other two: zero matches).
3. **Fallback honesty:** `GuestAvatarCluster` contains `onError` (failed → glyph) and `PersonGlyph`; exactly one glyph-disk style (no second "private" disk style, no `lock`-token) — the indistinguishability clause (iv).
4. **Motion discipline:** if `Animated.` appears in `GuestAvatarCluster`, `isInteraction: false` appears (ORCH-1303 class extended to the new file, which the filename-scoped strict-grep does not cover).
5. **Affordance integrity:** `onSeeWhosGoing` optional in all three prop surfaces; seeRow string "See who's going" present in `GuestAvatarCluster`; NO no-op handler fallback; the D2 gate expression in each card (`!privateGuestList` guarding the cluster JSX) present.
6. **Theme dial extension:** no 3/6-digit hex literal in `GuestAvatarCluster.tsx` (mirror of `:132-145`); link label styled with `palette.primaryText`; chevron stroked `palette.accent`.
7. **Drift sweep (adversarial):** repo-source grep-class assertion — `SOCIAL-PROOF-ANON-ONLY` absent from the three component files and the momentum test file.
8. **No checkout / no fetch:** no `/checkout|priceAllIn|Reserve|cart/i` tokens, no `supabase|fetch(` in `GuestAvatarCluster.tsx` (NO-CHECKOUT + I-MOR-0827 extended).

### 4.7 Body passthrough + config plumbing (exact seams)

- `RsvpOfferingBody.tsx`: `RsvpOfferingConfig` adds `guestSample?: ReadonlyArray<SocialProofSampleEntry>; onSeeWhosGoing?: () => void;` — `DecisionUnit` forwards both into `RsvpMomentumDecision` (alongside 1339's two booleans). The floating-bar mount keeps `showMomentum=false` (cluster never renders there — no handler concern). Section anchors (`orch-1163-rsvp-inline-box` etc.) untouched.
- `EventOfferingBody.tsx` / `TripOfferingBody.tsx` / `ExperienceOfferingBody.tsx`: each adds optional `onSeeWhosGoing?: () => void;` forwarded verbatim to its `OfferingMomentum` mount (1339's mount lines). No other change; bodies stay pure.
- `ConsumerEventDetailScreen.tsx`: the 1339-extended `rsvpConfig` gains ONE field: `guestSample: socialProofQuery.data?.sample ?? []`. (RSVP branch only; the standard branch's `OfferingMomentum` gets `sample` for free inside `socialProof`.) NO `onSeeWhosGoing` here — 1341 wires handlers.
- `PublicEventPage.tsx`: the RSVP-branch config literal gains the same ONE field from the page's 1339 socialProof query. NO handler (1342 owns web tap).
- `app/rsvp/[id]/preview.tsx`: NO change (no sample, no handler — honest zero-state preview per design §1.5).

## 5. Success criteria (photo behavior is package-shared ⇒ split only where plumbing/platform proof is manual)

- **SC-1-iOS / SC-1-Android / SC-1-Web:** on a live public RSVP event whose sample returns ≥1 avatar, the cluster's leading disk(s) render the real photo(s) (fade-in ≤~200ms after load), trailing disks stay glyphs, `+N` chip and "are pulling up" unchanged; NO name/username appears anywhere on the card (DOM/accessibility-tree inspection on web; screenshot on native).
- **SC-2:** with `guestSample: []` (0% avatar fill — F-11's dominant case) the card renders byte-identically to today's glyph cluster: no layout shift, no empty frames, no broken-image glyph.
- **SC-3:** a failing avatar URL (404/garbage) renders the glyph disk permanently after `onError`, visually identical to a no-photo disk — verified by seeding one dead URL and one absent entry side-by-side and diffing screenshots (the indistinguishability clause).
- **SC-4:** `privateGuestList = true` (F-11's live host event): count + sub-line + meter render; the ENTIRE clusterBlock — disks, chip, note, AND the "See who's going" row — is absent on every card surface, with nothing in its place.
- **SC-5:** `goingCount === 0`: no cluster, no link (RSVP zero-state copy unchanged; ticketed unit not rendered — 1339 rules intact).
- **SC-6:** with `onSeeWhosGoing` ABSENT (every surface, this leg): the cluster is a non-pressable View, seeRow does not render, accessibility exposes no button — zero dead taps (runtime tap-proof: tapping the cluster does nothing).
- **SC-7:** with `onSeeWhosGoing` PRESENT (dev harness / 1341 preview): one Pressable ≥44pt spanning clusterRow+seeRow, a11y label `"{n} going. See who's going"`, pressed state opacity 0.7, handler fires exactly once per tap (runtime proof harness; full wiring is 1341's TEST).
- **SC-8:** the intact 1157 suite passes UNMODIFIED except the sanctioned block: NO-CHECKOUT, DECISION-IS-HERO, THEME-DIAL (no hex anywhere incl. the new file), Android opaque, P1-A, rounds 2/6/7/8/9, `orch_1157_*adversarial*`, all `orch_1163_*`; strict-grep `orch-1292` + `orch-1303` + `meta-orch-0991` + `orch-1043` green.
- **SC-9:** tests-append-only gate GREEN with the rewrite landed — the PR-head commit body carries `[TEST-MOD-APPROVED ORCH-1340]` + `ORCH-1340 [card-real-avatars]`.
- **SC-10:** `web-build-check.yml` green: expo web export + ORCH-1083 bundle budget unchanged (zero new deps — RN core `Image` only) + lucide render-proof.
- **SC-11:** the new `orch_1340_*` guard suite passes, and each §9 revert-run fails it as contracted.

## 6. Invariants

**Preserved (ID + how + verifying test):**
- **I-PROPOSED-1157-ADDRESS-PRIVACY** (the surviving half — verbatim text per §4.5-a): untouched by any code in this leg (no address fields anywhere near the cluster); its existing address-gate + round-4/5 tests stay binding and unedited.
- **I-PROPOSED-1157-NO-CHECKOUT-AFFORDANCE / DECISION-IS-HERO / USES-BRAND-THEME-DIAL / ANDROID_GLASS_USES_OPAQUE_FALLBACK:** untouched assertions stay green over the modified files; extended to `GuestAvatarCluster` by the orch_1340 suite (§4.6-6/8).
- **ORCH-1303 isInteraction:** the photo fade + any cluster animation carries `isInteraction:false`; existing strict-grep binds the card files by name, orch_1340 test §4.6-4 binds the new file.
- **I-MOR-0827-PACKAGE-ISOLATION:** sample arrives via props; no fetch enters the package (§4.6-8 + the packages gate).
- **Constitution #9 (no fabricated data):** the glyph fallback is honest; photos render only from real server-filtered sample entries; no placeholder faces.
- **I-PROPOSED-1339-GUEST-PRIVACY-GATES-LIVE / -HONEST-ENTITY-MOMENTUM (1339 DRAFTs):** the D2 gate expressions and copy tables are untouched; the cluster suppression now provably covers the affordance too (SC-4).
- **meta-orch-0991 / orch-1043 sheet gates:** untouched (no sheet code in this leg).

**Retired/superseded (deliberate, never silent):**
- **I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)** — anon-cluster half RETIRED, superseded by the successor; address half survives verbatim (§4.5-a). Both name spellings swept (§4.5-d).

**Proposed NEW (DRAFT — orchestrator flips at CLOSE):**
- **I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (DRAFT)** — full rule text in §4.5-a-2 (encodes D1, D2-affordance, no-names-on-card/no-names-for-anon, private≡no-photo indistinguishability, no public maybe/waitlist count carry-over). Enforcement: §4.5-b rewritten block + §4.6 suite + 1338's server-side adversarial suite.

## 7. Test cases

| # | Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|---|
| T-1 | happy mixed cluster | sample of 2, going 5 | render (harness/sim) | disks: photo, photo, glyph; `+2` chip; note; fade-in on load | runtime/sim |
| T-2 | zero-avatar fill | sample [], going 4 | render | 3 glyph disks + `+1` — byte-parity with today (screenshot diff) | runtime/sim |
| T-3 | failed image | sample[0].avatarUrl = dead URL | render | onError → glyph; INDISTINGUISHABLE from T-2 disk (screenshot diff) | runtime/sim |
| T-4 | private profile | guest flips visibility→private, re-fetch | live RPC + render | sample no longer contains them (1338 SC-4); card shows one fewer photo, count unchanged | data/live + runtime |
| T-5 | blocked pair | authed viewer blocks a sampled guest | live RPC + render | guest absent from sample (server-side); CLIENT performs no filtering (source assert: no block logic in package) | data/live + unit |
| T-6 | privateGuestList ON | F-11 live host event | all card surfaces | SC-4: no clusterBlock incl. seeRow; count/meter/decision intact | runtime/live |
| T-7 | goingCount 0 | RSVP zero + ticketed zero | render | SC-5 | unit + runtime |
| T-8 | absent handler inert | no `onSeeWhosGoing` | tap the cluster | nothing fires; no button in a11y tree | runtime/sim |
| T-9 | present handler | harness passes handler | tap once / rapid double-tap | fires once per tap; pressed opacity 0.7; ≥44pt target | runtime/sim |
| T-10 | source guards | 3 component files | orch_1340 deno suite | §4.6 items 1–8 all pass | unit (deno) |
| T-11 | rewritten 1157 block | momentum test file | deno run | successor assertions pass; intact blocks byte-unmodified (git diff scoped to :8-16 + :120-130 regions) | unit/CI |
| T-12 | token gate | PR head commit | tests-append-only workflow | green WITH token; (pre-merge rehearsal) red WITHOUT token on a scratch branch | CI |
| T-13 | bundle budget | web export | web-build-check | ORCH-1083 budget + lucide proof green; no new deps in package.json diff | CI |
| T-14 | cross-platform parity | SC-1 on iOS sim + Android emulator + web browser | Maestro (`--device <iOS UDID>`) + browser | per-surface screenshots; Android opaque fills verified | runtime |
| T-15 | sample>disks | sample of 5, going 3 | render | exactly 3 photo disks (min(shownAvatars, sample)); entries 4–5 ignored | unit + runtime |

## 8. Implementation order

1. `packages/offering-rendering/GuestAvatarCluster.tsx` (NEW) + barrel export in `index.ts`.
2. `RsvpMomentumDecision.tsx`: props + cluster swap + doc-header rewrite (§4.3).
3. `OfferingMomentum.tsx`: prop + cluster swap (§4.4).
4. `RsvpOfferingBody.tsx` config/forwarding + the three bodies' `onSeeWhosGoing` passthrough (§4.7).
5. Surface plumbing: `ConsumerEventDetailScreen.tsx` + `PublicEventPage.tsx` (`guestSample` one field each).
6. NEW guard tests `orch_1340_guest_identity_privacy*.test.ts` (§4.6) — land BEFORE the 1157 rewrite so coverage never gaps.
7. The 1157 test rewrite (§4.5-b) + the 1339 test-line updates (§4.5-e) — committed with the token strings in the commit body; keep the token in every subsequent commit body until merge.
8. Gates: deno suites + typecheck + lint + biz-web export smoke (worktree export needs `--clear`); fails-on-revert demonstrations (§9). NO deploy/OTA/apply (orchestrator owns SHIP). Registry content (§4.5-a) handed to the orchestrator for CLOSE.

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguards + the exact reverts each must catch:**
1. Strip the `onError` fallback from `GuestAvatarCluster` → §4.6-3 FAILS (broken-image dishonesty caught).
2. Add any name-bearing prop (`displayName?:`/`username`) to any of the three components → §4.6-1 + the rewritten 1157 block FAIL (identity wall).
3. Add a second "private-style" disk (lock/dim) → §4.6-3 single-glyph-style assertion FAILS (indistinguishability clause).
4. Move `<Image>` into a card file / add a fetch to the package → §4.6-2/8 FAIL (single photo owner; I-MOR-0827).
5. Re-inline a no-op `onSeeWhosGoing` default → §4.5-b affordance-integrity + §4.6-5 FAIL (dead-tap class).
6. Narrow the D2 gate back to cluster-only (seeRow leaks under privateGuestList) → §4.6-5 gate-expression assertion FAILS + SC-4 runtime check.
7. Hex literal in the new file → §4.6-6 FAILS (theme dial).
Implementor demonstrates ONE revert-run per family (1–7, sed-strip in a scratch copy) in the implementation report, each shown red-then-green.

**Protective comments:** `GuestAvatarCluster.tsx` header carries the payload-is-the-privacy-boundary contract (§4.5-c) naming I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED; the rewritten 1157 block's comment explains WHY the anon-only assertions were retired (D1 sealed decision, this SPEC) and that the address half lives on untouched.

**Token escrow (plan-change guard):** if the META pivots to per-leg PRs, §4.5-e's edits to `orch_1339_*` become append-only-gated — the same `[TEST-MOD-APPROVED ORCH-1340]` + Rule-0 label mechanics apply; nothing else changes.

## 10. Open questions

1. **Design `id` field dropped from `guestSample` entries** (§4.1 contradiction) — resolved by dispatch precedence (1338's `SocialProofSampleEntry` is the frozen shape; index keys). Veto path: adding an opaque non-profile `sampleKey` to 1338's payload — requires a 1338 SPEC amendment; NOT recommended (scrape surface for zero rendering value).
2. **`chipFill` prop vs exporting `opaqueCardFill`** (§4.2 Android note) — implementor picks one form and documents it; both satisfy the opaque-fallback invariant. No Seth input needed.
3. **1339's test files' prohibition lines** (§4.5-e) — flagged as the known inter-spec wrinkle; resolution bound here (sanctioned in-branch rewrite). If the orchestrator prefers 1339's tests to be born future-proof instead (write them WITHOUT the Image/Pressable bans), amend SPEC-1339 §7 T-2 before 1339 IMPLEMENT — either path is safe; do not do both.

## 11. Downstream routing

- **Next: mingla-implementor** — build exactly this contract in the META worktree (`~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]`, branch `META-ORCH-1337-social-proof-guest-list`). Dependencies: 1338's `socialProofTypes.ts` + 1339's `OfferingMomentum`/config seams must exist on the branch first (IMPLEMENT order 1338→1339→1340). Stop-and-amend on ANY file outside the allowlist. Registry content (§4.5-a) is prepared as a diff-block in the implementation report, NOT committed to the registry.
- **Then: mingla-tester** — §7 table: deno suites, the screenshot-diff indistinguishability proofs (T-2/T-3), live privateGuestList host (T-6), per-platform runtime proof (T-14, Maestro with explicit `--device`), token-gate rehearsal (T-12), fails-on-revert re-verification.
- **Then: orchestrator SHIP/CLOSE** — merge in the META PR (ALL CI green incl. tests-append-only with the token in the head commit), apply the registry edit (§4.5-a), flip I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED ACTIVE, sync WORLD_MAP naming-drift note, route ORCH-1341 (sheet + tap wiring) next.

---

## Scoped allowlist (the implementor may create/modify ONLY these)

**Package (`packages/offering-rendering/`):**
1. `GuestAvatarCluster.tsx` (NEW)
2. `RsvpMomentumDecision.tsx` (props + cluster swap + doc header ONLY)
3. `OfferingMomentum.tsx` (prop + cluster swap ONLY)
4. `RsvpOfferingBody.tsx` (config fields + DecisionUnit forwarding ONLY)
5. `EventOfferingBody.tsx`, 6. `TripOfferingBody.tsx`, 7. `ExperienceOfferingBody.tsx` (one optional prop + passthrough each)
8. `index.ts` (barrel export of `GuestAvatarCluster` + its props type ONLY)

**Tests:**
9. `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy.test.ts` (NEW)
10. `packages/offering-rendering/__tests__/orch_1340_guest_identity_privacy_adversarial.test.ts` (NEW)
11. `packages/offering-rendering/__tests__/orch_1157_rsvp_momentum.test.ts` (ONLY the :8-16 header refs + the :120-130 block; token per §4.5-b)
12. `packages/offering-rendering/__tests__/orch_1339_momentum_cross_entity.test.ts` + 13. `orch_1339_momentum_adversarial.test.ts` (ONLY the T-2 Image/uri/Pressable prohibition lines, per §4.5-e)

**Surfaces:**
14. `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (rsvpConfig `guestSample` one field)
15. `mingla-business/src/components/event/PublicEventPage.tsx` (RSVP config `guestSample` one field)

## DO-NOT-TOUCH (stop-and-amend before touching ANY of these)

- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — content contract in §4.5-a, applied by the ORCHESTRATOR at CLOSE, never by the implementor.
- `packages/offering-rendering/rsvpMomentum.ts`, `socialProofMomentum.ts`, `socialProofTypes.ts` (frozen derivations + 1338's frozen types).
- EVERY other existing test file — all `orch_1157_round*`, `orch_1157_rsvp_momentum_adversarial.test.ts`, all `orch_1163_*`, `orch_1167_*`, `meta_orch_1174_*`, `orch_1183_*`, `orch_1338_*` (the ONLY sanctioned edits are allowlist items 11–13).
- The intact assertion blocks WITHIN item 11 (`:45-118`, `:132-179`) — the token does not license touching them.
- `.github/workflows/*`, `.github/scripts/*` (the gates are consumed, never adjusted).
- All app services/hooks/stores (`socialProofService.ts`, `rsvpDeckService.ts`, `useFriends*`, `messagingService.ts`, `deepLinkService.ts`, `queryKeys.ts`), `BaseBottomSheet.tsx`, `MessageInterface.tsx` — 1341's territory or consume-only.
- All wizards + business edit screens (1339's, already landed), `publicEventsService.ts`, `serverDraftEventMapper.ts`, `liveEventAdapter.ts`.
- `supabase/` (everything — no backend in this leg), `mingla-admin/` (all), `packages/brand-rendering`, `connectionsService.ts`, `COMMS_LEDGER.md`, `WORLD_MAP.md`.
