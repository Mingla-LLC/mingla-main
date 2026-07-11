# SPEC — ORCH-1339 [momentum-card-cross-entity]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 2 of 5 (consumes ORCH-1338's payload contract; precedes 1340 avatars + 1341 sheet)
**Phase:** SPEC (forensics SPEC mode — contract, not code)
**Binding investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md` (commit 0d3caa388) — findings F-1, F-2, F-3, F-4, F-5, F-10, F-11 and the Q11 insertion map govern this leg.
**Sealed orchestrator decisions honored (not re-opened):** D2 (`hideRemainingCount` = suppress scarcity sub-line + meter fill semantics, keep going count; `privateGuestList` = suppress cluster + affordance + list, server-enforced), D3 (ticketed identity = buyers; extra seats = glyphs), D5 (experience toggle home = Settings accordion appended to `ExperiencePricingStep` — file confirmed to exist with a local ToggleRow, verbatim-read), D7 (brand tiles OUT).
**Cross-leg contract:** all card data arrives as `SocialProofSummary` from `packages/offering-rendering/socialProofTypes.ts` (defined ONCE in SPEC_ORCH-1338 §4.4; created by ORCH-1338). This leg adds NO fetch to the package (I-MOR-0827) and renders GLYPH-ONLY clusters (real avatars are ORCH-1340's — do not front-run; the props shape already carries `sample` so 1340 extends without breaking).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`.
**Date:** 2026-07-10

---

## 1. Executive summary

Only RSVP pages show the "N going" momentum card today (F-1/F-2); ticketed events, trips, and experiences show zero social proof on any surface. The two host privacy toggles ("Private guest list", "Hide remaining count") save correctly but are rendered/gated NOWHERE public — and one real live host already has `privateGuestList=true` stored and silently ignored (F-4/F-11). Trips and experiences don't even have the toggles in their wizards (F-5).

This leg: (a) mounts a new pure, glyph-only momentum unit inside the three non-RSVP shared bodies (`EventOfferingBody` / `TripOfferingBody` / `ExperienceOfferingBody`) — one component change each, automatic 5-surface parity (F-2) — fed per-surface by ORCH-1338's `pg_public_social_proof` payload via props; (b) wires BOTH toggles as LIVE display gates everywhere the momentum renders, including the existing RSVP surfaces, with the server staying authoritative (D2); (c) adds the two toggles to the trip wizard (Step5Policy + published-edit Settings accordion) and the experience wizard (D5: ExperiencePricingStep accordion), persisted via a new no-clobber leaf-write RPC (the ORCH-1172/1296 jsonb pattern — the big trip/experience edit RPCs are NOT re-emitted); (d) fixes the wizard toggle sub-copy so it promises exactly what D2 enforces; (e) ships honest entity-appropriate momentum copy (Constitution #9 — no fake scarcity).

## 2. Scope & non-goals

**In scope**
- NEW pure package files: `OfferingMomentum.tsx` (the cross-entity momentum unit) + `socialProofMomentum.ts` (dep-free derivation + copy tables, deno-testable — mirrors `rsvpMomentum.ts`).
- Momentum mount in the three non-RSVP bodies + `socialProof` prop plumbing on all five app surfaces per the Q11 map (exact files §4.5/§4.6).
- D2 gate wiring in `RsvpMomentumDecision` (display-only props) + `RsvpOfferingConfig` + every RSVP mount (consumer screen, PublicEventPage RSVP branch, business RSVP preview).
- Trip + experience wizard toggles (create + edit-after-publish), hydration, and persistence via NEW RPC `biz_set_event_guest_privacy` (one migration).
- Wizard toggle sub-copy alignment (exact strings §4.8) in `CreatorStep6Settings` + `RsvpStep5Setup` + the new trip/experience toggle homes.
- New client service fns (`fetchSocialProof` per app; `setEventGuestPrivacy` business-side).
- Regression tests (new files only — no existing test edited; no tests-append-only token needed).

**Non-goals (explicitly out)**
- Real avatars in any cluster, the I-PROPOSED-1157 invariant/test/doc rewrite → ORCH-1340 (F-10 list untouched here).
- Tap affordance on the cluster, "See who's going", the guest-list sheet, add-friend/message → ORCH-1341. The momentum unit in THIS leg has NO onPress (mirrors F-1's current inert cluster).
- Buyer-web install funnel / OneLink / QR / `peer_list_event_guests` consumption → ORCH-1342 / 1341.
- Admin web (no offering-rendering mounts exist — F-2), brand-page tiles (D7), Chip-in panel, checkout paths, `host_list_rsvp_guests` family (1334).
- Any change to `pg_public_social_proof` / `peer_list_event_guests` (1338 owns them; consume as-frozen).
- Re-emitting `biz_update_live_trip`, `biz_update_live_experience`, `business_publish_trip_draft`, `biz_publish_experience` (COMMS-0029-class collision risk; the new leaf-write RPC exists precisely to avoid this).

**Assumptions (investigation-proven / verbatim-read this session)**
- Mount chain per surface = the Q11 map; "RsvpPublicBody" no longer exists (naming-drift note).
- The section-order gate tests assert ascending `indexOf` over EXISTING testID anchors (`meta_orch_1174_trip_standardize.test.ts:46-79` and siblings) — inserting a NEW section BETWEEN anchors keeps them green; no existing anchor may move.
- `orch_1157_rsvp_momentum.test.ts:103-158` + adversarial: adding two boolean props to `RsvpMomentumDecision` violates none of the pinned regexes (`<Image`, `\buri\b`, `guestName|guestPhoto|attendeeName|guestAvatar`, `maybeCount|waitlistCount`, hex literals); the glyph cluster is unchanged.
- `biz_update_live_trip` deep-merges only `theme.business_trip` (20260929:286-316); `biz_update_live_experience` leaf-sets only `experience_meta` keys (20261009:1262-1268, 1381-1390) — NEITHER owns `business_event.settings`, so trip/experience toggle writes need the 1296 leaf-write pattern → the new RPC.
- `tripsService.ts` selects `events.theme` (`:359,:487-494,:543`) and `experiencesService.ts` selects `theme` (`:79,:101-102,:168`) — hydration is feasible in-file without widening any query.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | Momentum unit on standard-event/trip/experience detail; D2 gates live on RSVP + all cards; glyph cluster only | `ConsumerEventDetailScreen.tsx`, `ConsumerTripDetailScreen.tsx`, `ConsumerExperienceDetailScreen.tsx`, `app-mobile/src/services/socialProofService.ts` (+ shared package) | Body render automatic (shared package); CONFIG plumbing manual per screen |
| 2 | Consumer Android | YES | Same as iOS + opaque-fill policy on the new unit | same files | Same code; runtime proof manual per platform |
| 3 | Buyer/anon Web (`/e`, `/t/…`, `/exp/…`, `/checkout`) | YES | Momentum on all four public entity pages; anon payload = counts+gates (server-shaped) | `PublicEventPage.tsx`, `app/t/[brandSlug]/[tripSlug].tsx`, `app/exp/[brandSlug]/[experienceSlug].tsx`, `FoundationEventPreview.tsx`, `TripPreview.tsx`, `ExperiencePreview.tsx`, `mingla-business/src/services/socialProofService.ts` | Body automatic; config manual |
| 4 | Business iOS | YES | Same public pages (same code as 3) + wizard toggles (trip Step5, experience Pricing accordion, copy fixes in event/RSVP wizards) + edit accordions | surface files of #3 + `TripCreatorStep5Policy.tsx`, `TripCreatorWizard.tsx`, `EditPublishedTripScreen.tsx`, `EditPublishedTripSettingsAccordion.tsx`, `ExperiencePricingStep.tsx`, `ExperienceCreatorWizard.tsx`, `CreatorStep6Settings.tsx`, `RsvpStep5Setup.tsx`, services | Automatic with #3 for public pages; wizards manual |
| 5 | Business Android | YES | Same as #4 | same files | Same code; runtime proof manual |
| 6 | Admin Web (`mingla-admin/`) | NOT covered | — zero offering-rendering mounts exist (F-2); admin attendee views are ORCH-1334's twin | none | — |
| 7 | Business Web preview (`/rsvp/[id]/preview` + wizard previews) | YES | Draft preview honors the host's OWN toggle state honestly (goingCount stays 0 → unit hidden; gates previewed on RSVP momentum) | `app/rsvp/[id]/preview.tsx` (gates from draft); trip/experience previews pass `socialProof=null` | Manual (preview passes draft-local config) |

**Delivery constraints (binding on SHIP, noted for routing):** business app = NATIVE BUILD ONLY (COMMS-0052 BLOCK + COMMS-0063 — never `eas update` the business channel); consumer app-mobile = OTA-able (pure JS, per-platform publishes, never `--platform all`); buyer-web = Vercel `[deploy]` commit-tag gate.

## 4. Layered specification

### 4.1 Shared payload type (consumed, not defined)

`SocialProofSummary` / `SocialProofSampleEntry` / `SocialProofEntityType` / `SOCIAL_PROOF_SAMPLE_MAX` from `packages/offering-rendering/socialProofTypes.ts` — defined ONCE in SPEC_ORCH-1338 §4.4. This leg imports; it MUST NOT redefine, fork, or extend the shape. 1339 reads `goingCount`, `capacity`, `privateGuestList`, `hideRemainingCount`, `entityType`; it deliberately ignores `sample` (glyph-only leg — 1340 consumes `sample` without a props change).

### 4.2 Database — Migration (the only migration in this leg)

**File:** `supabase/migrations/<VERSION>_orch_1339_set_event_guest_privacy.sql` — version strictly > 20261223000000 AND > ORCH-1338's final version. **Re-scan the frontier at IMPLEMENT** (same protocol as SPEC_ORCH-1338 §4.1: `git fetch origin` + ls all worktrees' `supabase/migrations`; 1334's migration expected nearby). Provisional: `20261224000100`. House file protocol: DROP IF EXISTS → CREATE → REVOKE PUBLIC → GRANT → COMMENT → `NOTIFY pgrst, 'reload schema'`. No auto-apply (orchestrator applies via Management API at SHIP).

**Function:** `biz_set_event_guest_privacy(p_event_id uuid, p_private_guest_list boolean DEFAULT NULL, p_hide_remaining_count boolean DEFAULT NULL) RETURNS jsonb` — `LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public`.

**Guard-FIRST ordering:**
1. `v_uid := auth.uid(); IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;`
2. Load event: `SELECT * FROM events WHERE id = p_event_id AND deleted_at IS NULL` → missing → `RAISE EXCEPTION 'event_not_found';`
3. Host gate: `IF biz_brand_effective_rank(v_event.brand_id, v_uid) < biz_role_rank('event_manager') THEN RAISE EXCEPTION 'not_authorized'; END IF;` (the exact 1334/1150 host predicate, verbatim-read at `20261004000000:126-128`).

**Write (the ORCH-1172/1296 no-clobber leaf pattern — byte-follow `20261222000000:225-250`):** COALESCE each param → existing theme leaf → `false`; ensure `business_event` and `business_event.settings` containers exist (`jsonb_set` create_missing=true); `jsonb_set` ONLY the two leaf keys `{privateGuestList}` / `{hideRemainingCount}`; UPDATE `events.theme` + `updated_at`. NULL param = keep existing (partial update). Entity-agnostic (works for all four event_types; standard/RSVP wizards keep their existing full write paths — co-existing leaf writes cannot clobber each other).

**Returns:** `jsonb_build_object('privateGuestList', v_private, 'hideRemainingCount', v_hide)` (the final persisted values — the client trusts the echo, not its optimistic state).

**Error shapes:** `authentication_required` / `event_not_found` / `not_authorized` (RAISE message tokens, same contract style as SPEC_ORCH-1338 §4.1.2).

**Grants:** `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated;` **RLS statement:** table RLS unchanged; the write is RPC-mediated and host-gated in-function.

### 4.3 Package — pure derivation (`socialProofMomentum.ts`, NEW)

Dep-free (no react / react-native imports — mirrors `rsvpMomentum.ts`), deno-testable. Exports:

- `deriveSocialProofMomentum(summary: Pick<SocialProofSummary, "entityType"|"goingCount"|"capacity"|"hideRemainingCount">): SocialProofMomentumModel` where the model is `{ visible: boolean; countLabel: string; subLabel: string | null; meterPercent: number; shownGlyphs: number; overflowCount: number; clusterNote: string }`.

**Derivation rules (Constitution #9 — missing is hidden, never faked; canonical voice; D2):**
- `goingCount <= 0` → `visible: false` (the unit is NOT rendered for ticketed entities at zero — no "be the first" fabrication next to possibly sold-out/ended tickets; the RSVP unit keeps its own existing zero-state, §4.4).
- Effective capacity for DISPLAY: `hideRemainingCount ? null : capacity` (D2: open-invite-style momentum, count kept; decision/CTA math elsewhere never uses this).
- Cluster sizing: reuse the exact `RSVP_CLUSTER_SHOWN = 3` semantics (shown = min(3, going), overflow = going − 3 when > 3).
- `meterPercent`: finite capacity → `min(100, round(going/capacity*100))`; full → 100; null capacity (incl. hidden) → fixed 18 (the existing open-invite fill).
- **Exact copy tables (decided here, per the dispatch):**

| entityType | count label | sub-line: finite, spots left > 0 | sub-line: full (spotsLeft = 0) | sub-line: capacity null OR hideRemainingCount | cluster note |
|---|---|---|---|---|---|
| `event` | `going` | `{n} spot(s) left · filling up` / `· filling fast` (≥80%) | `Sold out` | *(omitted — null)* | `are pulling up` |
| `trip` | `going` | same pattern | `Trip full` | *(omitted)* | `are on this trip` |
| `experience` | `booked` | same pattern | `Fully booked` | *(omitted)* | `have booked this` |

  - Singular/plural: `1 spot left`, else `{n} spots left`; "filling fast" at meterPercent ≥ 80 (byte-parity with `rsvpMomentum.ts:77-80`).
  - The capacity-null sub-line is OMITTED (not "Tickets available" — that could be false when tiers are ended/door-only; omission is the only always-honest string). No waitlist claims (waitlist truth lives in the CTA state machine, not here).
  - `rsvp` entityType is NOT handled by this function — the RSVP derivation stays solely in `rsvpMomentum.ts::deriveMomentum` (single-owner respected; the adversarial digit-leak tests keep binding it).
- No digits other than the going count and the spots-left number may appear in any sub-line (mirror of the 1157 adversarial no-leak contract — new test T-3 pins this).

### 4.4 Package — components

**A. `OfferingMomentum.tsx` (NEW, pure)** — the cross-entity momentum unit. Props:
`{ palette: ThemePalette; theme: ResolvedTheme; socialProof: SocialProofSummary | null; testID?: string }`.
- `socialProof` null OR `deriveSocialProofMomentum(...).visible === false` → render `null` (honest absence; zero layout shift; fetch-failure degrades to today's page).
- Renders (styles byte-follow `RsvpMomentumDecision.styles.momentum/momTop/momCount/momLabel/momSub/meterTrack/meterFill/cluster/avatar/avatarMore/clusterNote`): opaque card (`opaqueCardFill` pattern: `Platform.OS === "android" ? palette.page : opaqueSurfaceColor(palette)`) with count + count-label row, optional sub-line, meter, and the glyph cluster (`PersonGlyph`-equivalent SVG — a local copy or an exported shared glyph; NO `<Image>`, NO uri, NO identity props).
- Cluster suppressed entirely when `socialProof.privateGuestList === true` (D2) — count/sub-line/meter still render.
- NO kicker ("YOU'RE INVITED" is RSVP-only), NO chips, NO decision, NO Pressable/onPress anywhere (tap is 1341's).
- Meter animation: if animated, `Animated.timing(..., { isInteraction: false })` — MANDATORY (ORCH-1303 strict-grep class binds `Rsvp*` files by name; the same starvation mechanism applies here; simplest compliant option: no animation, static width).
- a11y: `accessibilityLabel` = `"{going} people going"` (or `"…booked"` for experience) on the count; cluster `accessibilityLabel` mirrors it.
- testIDs: root `orch-1339-momentum`, sub `orch-1339-momentum-sub`, meter `orch-1339-momentum-meter`, cluster `orch-1339-momentum-cluster`.
- Barrel-export from `packages/offering-rendering/index.ts` (component + model type + derivation).

**B. `RsvpMomentumDecision.tsx` (MODIFY — display gates only):**
- Props add: `privateGuestList?: boolean` (default false), `hideRemainingCount?: boolean` (default false).
- Line ~250 `const momentum = deriveMomentum(goingCount, capacity)` becomes `deriveMomentum(goingCount, hideRemainingCount ? null : capacity)` — D2 exactly: sub-line flips to the existing "Open invite", meter to the fixed 18 fill, going count kept. `ctaState`/decision logic untouched (capacity truth stays upstream in `resolveRsvpCta`).
- Cluster render condition `momentum.hasGoing ?` becomes `momentum.hasGoing && !privateGuestList ?` — D2 cluster suppression. Count/sub/meter unchanged.
- Doc-contract header: append two sentences describing the gates (do NOT touch the glyph-only paragraph — 1340 rewrites it under token).
- HARD constraints: no `<Image`, no `uri`, no `guestName|guestPhoto|attendeeName|guestAvatar|maybeCount|waitlistCount` tokens, no hex literals — the 1157 source-assert suite must stay green UNMODIFIED.

**C. `RsvpOfferingBody.tsx` (MODIFY):** `RsvpOfferingConfig` (:94-112) adds `privateGuestList?: boolean; hideRemainingCount?: boolean` (both default-absent = false). `DecisionUnit` (:959-1026) forwards `privateGuestList={config.privateGuestList ?? false}` / `hideRemainingCount={config.hideRemainingCount ?? false}` into `RsvpMomentumDecision`. No other change; `orch-1163-rsvp-inline-box` and all section anchors untouched.

**D. Body mounts (MODIFY × 3) — insertion points (each between two existing anchors; existing anchor ORDER unchanged so the ascending-indexOf gates stay green):**
- `EventOfferingBody.tsx`: new optional prop `socialProof?: SocialProofSummary | null` (default null). Mount `<OfferingMomentum …/>` between section 4 (pills row, `orch-1167-pills-row`, ends :359) and section 5 (ticket box block, :370) — social proof feeds the decision, decision (ticket box) stays the hero.
- `TripOfferingBody.tsx`: same prop; mount between §4 pills (`trip-body-meta-pills`) and §5 Presented By.
- `ExperienceOfferingBody.tsx`: same prop; mount between §4 vibe chips (`experience-body-vibes`) and §5 Presented By (after `stateBanner` if the banner region sits there — banner stays ABOVE momentum).
- Each mount is `{socialProof ? <OfferingMomentum palette={palette} theme={theme} socialProof={socialProof} testID="orch-1339-momentum-<entity>" /> : null}` — bodies stay pure (I-MOR-0827), zero fetch, zero state.

### 4.5 Services

**A. `app-mobile/src/services/socialProofService.ts` (NEW):**
`fetchSocialProof(eventId: string): Promise<SocialProofSummary | null>` → `supabase.rpc("pg_public_social_proof", { p_event_id: eventId })`; json `null` → `null`; error → throw (React Query owns retry; callers render nothing on error — fail-open is identity-safe in this leg because clusters are glyphs; 1340 inherits fail-CLOSE automatically since avatars exist only inside the payload).

**B. `mingla-business/src/services/socialProofService.ts` (NEW):** identical contract (business supabase client).

**C. `mingla-business/src/services/businessEvents.ts` (MODIFY — one added export):**
`setEventGuestPrivacy(eventId: string, patch: { privateGuestList?: boolean; hideRemainingCount?: boolean }): Promise<{ privateGuestList: boolean; hideRemainingCount: boolean }>` → `supabase.rpc("biz_set_event_guest_privacy", …)`; throws on RPC error (callers toast + keep the toggle UI on the persisted echo).

**D. Hydration (MODIFY):**
- `mingla-business/src/services/tripsService.ts`: the trip mapper (the fn consuming `event.theme` at `:487-494/:543`) surfaces `guestPrivacy: { privateGuestList, hideRemainingCount }` onto the `Trip` model, parsed via the same `#>> '{business_event,settings,…}'`-equivalent object path with `false` defaults.
- `mingla-business/src/utils/tripToLiveEvent.ts` (:132-134 region): replace the two hard-coded `false` literals with the mapped `trip.guestPrivacy.*` values.
- `mingla-business/src/services/experiencesService.ts`: the experience model mapper (`:101-102` region) surfaces the same two booleans from `theme.business_event.settings`.
- `mingla-business/src/hooks/useExperienceDraftAdapter.ts` (:116-119 region): replace the two hard-coded `false` with the mapped values.
- `publicEventsService.ts` / `serverDraftEventMapper.ts` / `liveEventAdapter.ts`: NO change (they already parse/diff both flags — F-4; this leg completes the read side elsewhere, per Discovery 3).

### 4.6 Hooks / per-surface config plumbing (the Q11 map — manual work per surface)

React-Query convention: follow the in-file sibling precedent (`ConsumerEventDetailScreen.tsx:284-290` `useQuery({ queryKey: ["rsvpMomentum", eventId], … staleTime: 60_000 })`) — literal key arrays `["socialProof", eventId]`, `staleTime: 60_000`, `enabled: eventId !== null`.

| Surface file | Change |
|---|---|
| `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | Add `useQuery(["socialProof", eventId], fetchSocialProof)` (enabled for BOTH branches). Standard branch: pass `socialProof={socialProofQuery.data ?? null}` into `EventOfferingBody` (:907). RSVP branch: extend `rsvpConfig` (:574-586) with `privateGuestList`/`hideRemainingCount` from the payload (`?? false`) — both `RsvpOfferingBody` (:931) and `RsvpOfferingFloatingBar` (:976) read the same config object, so both mounts gate together. |
| `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | Same query keyed by the trip's event id; pass `socialProof` into `TripOfferingBody` (:936). |
| `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` | Same; pass into `ExperienceOfferingBody` (:895). |
| `mingla-business/src/components/event/PublicEventPage.tsx` | One query for the page's event id (anon-safe RPC; page already anon-tolerant). Ticketed path: thread `socialProof` through `FoundationEventPreview` (:1005) → body. RSVP branch: extend the `config` literal (:821-841) with `privateGuestList: event.privateGuestList ?? false, hideRemainingCount: event.hideRemainingCount ?? false` (the LiveEvent model already parses them — F-4; payload values may substitute if the model fields are absent on the anon view — implementor picks whichever source is populated on this page, server remains authoritative either way). |
| `mingla-business/src/components/event/FoundationEventPreview.tsx` | Add passthrough prop `socialProof?: SocialProofSummary | null` → `EventOfferingBody`. |
| `mingla-business/src/components/trip/TripPreview.tsx` / `experience/ExperiencePreview.tsx` | Add the same passthrough prop → body (:478 / :381). FOUNDATION mode only; Legacy previews untouched. |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` / `app/exp/[brandSlug]/[experienceSlug].tsx` | Fetch via the business `socialProofService` keyed by the resolved event id; pass into TripPreview/ExperiencePreview. |
| `mingla-business/app/rsvp/[id]/preview.tsx` | Extend the config literal (:365-372) with `privateGuestList: draft.privateGuestList, hideRemainingCount: draft.hideRemainingCount` — the preview honestly previews the host's OWN draft toggles (goingCount stays 0). |
| Trip/experience wizard previews | pass `socialProof={null}` (unit hidden — honest zero-state). |

### 4.7 Wizards — trip + experience toggles (create + edit-after-publish)

**Trip create — `TripCreatorStep5Policy.tsx` (70 lines, verbatim-read):** `Step5Draft` adds `privateGuestList: boolean; hideRemainingCount: boolean`. Append a third `GlassCard` "Guest privacy" hosting two toggle rows in the `CreatorStep6Settings` ToggleRow visual pattern (`:120-160`; implement a local ToggleRow mirroring it — Step5 currently has none). Copy per §4.8.
**Trip create persistence — `TripCreatorWizard.tsx`:** the wizard parent owns Step5 state (existing `autosaveStep5` pattern). On Step-5 autosave AND on publish success, call `setEventGuestPrivacy(eventId, {…})` (the server-side draft events row exists — `business_publish_trip_draft` takes `p_event_id`). Failure → non-blocking toast "Couldn't save guest privacy — check Settings after publishing." + wizard continues (display prefs never block publish).
**Trip edit — `EditPublishedTripSettingsAccordion.tsx` (pure controlled editor, verbatim-read doc-contract) + `EditPublishedTripScreen.tsx`:** accordion gains two controlled props pairs (`privateGuestList`/`onPrivateGuestListChange`, `hideRemainingCount`/`onHideRemainingCountChange`) rendered as Switch rows in its existing pattern; the PARENT keeps the single-save contract: the two toggles are EXCLUDED from `buildLiveTripPatch` (never enter `biz_update_live_trip`, never trigger the refund gate or reason prompt on their own); in `handleConfirmSave`, after the gated patch succeeds (or immediately when the patch diff is empty), changed toggles persist via `setEventGuestPrivacy`. Hydration from `trip.guestPrivacy` (§4.5-D).
**Experience (D5) — `ExperiencePricingStep.tsx`:** append a "Guest privacy" Settings accordion section after the existing pricing sections, reusing the file's OWN local `ToggleRow` (:250-256). Props extend `ExperiencePricingStepProps` with the two values + change callbacks (wizard parent owns state — matches the file's controlled pattern).
**Experience persistence — `ExperienceCreatorWizard.tsx`:** on publish success (`biz_publish_experience` path) AND on edit-after-publish save, call `setEventGuestPrivacy`. Hydration via `useExperienceDraftAdapter` (§4.5-D). Because ExperiencePricingStep is mounted in BOTH create and edit flows, D5's single home covers both.

### 4.8 Wizard copy alignment (exact strings — D2-honest; current copy over-promises)

| File / control | Label (keep) | NEW sub-copy |
|---|---|---|
| `CreatorStep6Settings.tsx` privateGuestList | `Private guest list` | `Hide who's going. Guests still see the going count.` |
| `CreatorStep6Settings.tsx` hideRemainingCount | `Hide remaining count` | `Don't show "X left" or how full it is.` |
| `RsvpStep5Setup.tsx` privateGuestList (`rsvp-private-guestlist`) | `Keep the guest list private` | `Hide who's going. Only you see the list.` |
| `RsvpStep5Setup.tsx` hideRemainingCount (`rsvp-hide-count`) | `Hide the spots-left count` (label CHANGES from "Hide the Going count from guests") | `Guests see who's going — not how many spots remain.` |
| Trip Step5 + trip edit accordion (NEW rows) | `Private guest list` / `Hide remaining count` | `Hide who's going. Travelers still see the going count.` / `Don't show "X spots left" or how full it is.` |
| Experience accordion (NEW rows) | `Private guest list` / `Hide remaining count` | `Hide who's booked. Guests still see the booked count.` / `Don't show "X spots left" or how full it is.` |

No existing test pins any of these strings (grep-verified this session). Flagged in §10 for Seth's copy veto.

### 4.9 Realtime — none (counts refresh via query staleTime; no channel work in this leg).

## 5. Success criteria (SC-n split per platform where parity is manual; "Web" = buyer-web browser, "biz-iOS/Android" = business app)

- **SC-1-iOS / SC-1-Android / SC-1-Web:** a live public STANDARD event with ≥1 sold ticket shows the momentum unit (count + "going" + glyph cluster ≤3 + "+N" overflow + "are pulling up") between the pills row and the ticket box; with 0 sold, NO unit and NO layout gap.
- **SC-2-iOS / SC-2-Android / SC-2-Web:** same for a trip ("are on this trip", "Trip full" when full) on `ConsumerTripDetailScreen` / `/t/{brand}/{trip}`.
- **SC-3-iOS / SC-3-Android / SC-3-Web:** same for an experience ("booked", "have booked this", "Fully booked") on `ConsumerExperienceDetailScreen` / `/exp/{brand}/{exp}`.
- **SC-4-iOS / SC-4-Android / SC-4-Web (F-4's live host):** on the prod event with `privateGuestList=true`, every RSVP surface (consumer RSVP branch, buyer-web `/e/…`, business in-app public page) renders the momentum unit WITHOUT the glyph cluster; count, sub-line, meter, and decision buttons unchanged.
- **SC-5-iOS / SC-5-Android / SC-5-Web:** with `hideRemainingCount=true` on an RSVP event with finite capacity: sub-line reads `Open invite`, meter shows the fixed low fill, going count still renders; on a ticketed entity: sub-line omitted, meter fixed low fill, count renders (D2).
- **SC-6:** finite-capacity ticketed entity at ≥80% shows `filling fast`; below shows `filling up`; sold-out shows the per-entity full string; NO digit other than count + spots-left ever appears in a sub-line.
- **SC-7 (biz-iOS / biz-Android):** trip wizard Step 5 and the published-trip Settings accordion show the two toggles; flipping + saving persists (verify via SQL: `theme #>> '{business_event,settings,privateGuestList}'`), re-entering the editor hydrates the saved values; toggling in edit does NOT trigger the trip refund-gate/reason prompt by itself.
- **SC-8 (biz-iOS / biz-Android):** experience wizard Pricing step shows the Guest-privacy accordion (create AND edit-after-publish); persistence + hydration as SC-7.
- **SC-9:** `biz_set_event_guest_privacy` as a non-manager of the brand raises `not_authorized`; as anon raises `authentication_required`; a partial call (one param NULL) leaves the other flag untouched (live SQL proof).
- **SC-10:** wizard sub-copy matches §4.8 byte-exactly on all four toggle homes.
- **SC-11:** business RSVP draft preview (`/rsvp/[id]/preview`) reflects the draft's own toggles (cluster suppressed when the draft has privateGuestList on).
- **SC-12:** all existing gates stay green with ZERO edits to existing test files: `orch_1157_*` (incl. adversarial), `orch_1163_*`, `orch_1167_*`, `meta_orch_1174_trip_standardize` §1 order, `orch_1183_experience_standardize`, `orch-1292` taxonomy, `orch-1303` strict-grep, `meta-orch-0991` gorhom-sole-consumer, web bundle-budget (`web-build-check.yml` — no `<Image>` added).
- **SC-13:** with the socialProof fetch failing (network error), every page renders exactly as today (no crash, no empty card, no spinner residue).

## 6. Invariants

**Preserved (ID + how + verifying test):**
- **I-PROPOSED-1157-NO-CHECKOUT-AFFORDANCE** — `OfferingMomentum` + the RSVP unit carry no checkout/price/cart tokens; the momentum mount adds no CTA. Existing 1157 test + new T-2 source assertions.
- **I-PROPOSED-1157-DECISION-IS-HERO** — the momentum unit never displaces the decision/ticket box/reserve controls; it mounts ABOVE section 5 as content, adds no second decision. Existing single-decision assertions stay green.
- **I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE, incl. address half)** — clusters remain glyph-only, no identity props consumed, no address fields touched; the invariant's tests are untouched (rewrite = 1340 with token). New code introduces no `<Image>`/uri into momentum components (T-2).
- **I-PROPOSED-1157-USES-BRAND-THEME-DIAL** — `OfferingMomentum` colors derive exclusively from `palette.*` (accent/accentWash/page/panelBorder/…); NO 3/6-digit hex literal in any new package file (T-2 pins it, mirroring `orch_1157:132-145`).
- **ANDROID_GLASS_USES_OPAQUE_FALLBACK** — opaque card fill per the `opaqueCardFill` pattern + `overflow:'hidden'` (T-2).
- **ORCH-1303 isInteraction** — any `Animated.timing/spring` in a loop or repeated fill in the new unit carries `isInteraction:false` (T-2 asserts the token when `Animated.` is present).
- **ORCH-1292 taxonomy-label** — no raw slugs rendered by the new unit (it renders no taxonomy — trivially preserved; strict-grep gate untouched).
- **I-MOR-0827-PACKAGE-ISOLATION** — data via props only; fetch lives in app services; no app `src/` import in the package (packages gate + T-2).
- **COMMS-0057 (RSVP never merges into ticket path)** — client-side: the RSVP derivation stays in `rsvpMomentum.ts`, the ticketed derivation in `socialProofMomentum.ts`; no shared merge (T-3).
- **ORCH-1172 no-clobber theme writes** — the new RPC leaf-writes only its two keys (T-6 + SC-9 partial-update case); `hideAddressUntilTicket` and every other theme key byte-survive (live before/after diff in T-6).
- **Section-order gates (1163/1167/1174/1183)** — insertion between anchors; no anchor moved/renamed (SC-12).

**Proposed NEW (DRAFT — orchestrator flips on CLOSE):**
- **I-PROPOSED-1339-GUEST-PRIVACY-GATES-LIVE (DRAFT):** wherever a social-proof momentum unit renders, `privateGuestList` suppresses the cluster and `hideRemainingCount` suppresses scarcity sub-line + real meter fill (count retained), on every surface, with the server-side flags as the source of truth.
- **I-PROPOSED-1339-HONEST-ENTITY-MOMENTUM (DRAFT):** momentum copy is entity-appropriate per the §4.3 table; zero-count ticketed entities render NO unit; capacity-null/hidden renders NO availability claim; no digit beyond count + spots-left in sub-lines.

## 7. Test cases

| # | Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|---|
| T-1 | derivation happy/edge/full | all §4.3 branches per entity | pure fn calls | copy table byte-exact; meter 0/18/%/100; visible=false at 0; singular "1 spot left" | unit (deno) |
| T-2 | OfferingMomentum source contract | component source | deno source asserts | no `<Image\b`, no `\buri\b`, no `onPress|Pressable`, no hex literals, has opaque-fill + `overflow: "hidden"`, `isInteraction: false` present if `Animated.` present, no checkout tokens | unit (deno) |
| T-3 | derivation separation | rsvp vs ticketed owners | source asserts | `socialProofMomentum.ts` handles no `"rsvp"` branch; `rsvpMomentum.ts` unchanged (hash/content assert on key lines NOT required — assert no new entity strings leak into it) | unit (deno) |
| T-4 | body mounts | 3 bodies' source | deno source asserts | `orch-1339-momentum-<entity>` testID present between the two neighbor anchors (indexOf ordering incl. the new anchor); prop `socialProof` in each Props interface | unit (deno) |
| T-5 | RSVP gate wiring | RsvpMomentumDecision + RsvpOfferingBody source | deno source asserts | `hideRemainingCount ? null : capacity` at the deriveMomentum call; `!privateGuestList` in the cluster condition; config fields forwarded by DecisionUnit | unit (deno) |
| T-6 | RPC no-clobber | event with rich theme (hideAddressUntilTicket etc.) | live RPC call, before/after theme diff | only the two leaves change; partial call leaves sibling flag; echo matches persisted | data/live |
| T-7 | RPC guards | anon / non-manager / missing event | live RPC | the three error tokens (SC-9) | data/live |
| T-8 | wizard persistence e2e | trip Step5 toggle → publish → re-edit; experience accordion same | sim (business app) | SQL shows leaves; editors re-hydrate; no refund-gate prompt for toggle-only trip edit | runtime/sim |
| T-9 | F-4 live host | prod `pgl_true` RSVP event | consumer sim + buyer-web + biz app | cluster absent, count present, decision intact (SC-4) | runtime/live |
| T-10 | hideRemainingCount live | finite-capacity RSVP + ticketed event with flag on | all card surfaces | SC-5 semantics | runtime/live |
| T-11 | fetch-failure degradation | block the RPC (airplane/dev intercept) | each detail screen | page renders as today; no crash/spinner residue (SC-13) | runtime/sim |
| T-12 | copy strings | 4 toggle homes | source asserts + sim screenshot | §4.8 byte-exact (SC-10) | unit + runtime |
| T-13 | regression sweep | existing suites | deno + CI | SC-12 all green, zero existing test files modified | CI |
| T-14 | cross-platform parity proof | SC-1..5 on iOS sim + Android emulator + web | Maestro (`--device <iOS UDID>`) + browser | per-surface SC checkboxes with screenshots | runtime |

## 8. Implementation order

1. **Frontier re-scan** → finalize the migration version (§4.2); write `supabase/migrations/<VERSION>_orch_1339_set_event_guest_privacy.sql`.
2. Package pure layer: `socialProofMomentum.ts` → `OfferingMomentum.tsx` → barrel exports (`index.ts`).
3. Package gates: `RsvpMomentumDecision.tsx` props + `RsvpOfferingBody.tsx` config/forwarding.
4. Body mounts: `EventOfferingBody.tsx`, `TripOfferingBody.tsx`, `ExperienceOfferingBody.tsx`.
5. Services: both `socialProofService.ts` files; `businessEvents.ts::setEventGuestPrivacy`; hydration in `tripsService.ts`, `tripToLiveEvent.ts`, `experiencesService.ts`, `useExperienceDraftAdapter.ts`.
6. Surface plumbing (§4.6 table): consumer 3 screens → PublicEventPage + FoundationEventPreview → TripPreview/ExperiencePreview + the two business routes → rsvp preview.
7. Wizards (§4.7): trip Step5 + wizard persistence → trip edit accordion + screen → experience pricing accordion + wizard persistence → copy alignment (§4.8) in CreatorStep6Settings + RsvpStep5Setup.
8. Tests T-1…T-5, T-12-source, T-13 (new files only) + typecheck/lint/deno + the biz-web export smoke (worktree web export needs `--clear`).
9. Fails-on-revert demonstration (§9) in the implementation report. NO deploy, NO OTA, NO migration apply (orchestrator owns SHIP; delivery constraints §3).

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** new test file `packages/offering-rendering/__tests__/orch_1339_momentum_cross_entity.test.ts` (+ `orch_1339_momentum_adversarial.test.ts`) binding: the three mount anchors (T-4), the two RSVP gate expressions (T-5), the derivation copy table incl. the no-digit adversarial sweep across 0..cap×2 counts (T-1/T-3 style, mirroring `orch_1157_rsvp_momentum_adversarial.test.ts:59-76`), and the OfferingMomentum source contract (T-2). Business-side: `mingla-business/src/components/trip/__tests__/orch_1339_trip_guest_privacy.test.ts` + `mingla-business/src/components/experience/__tests__/orch_1339_experience_guest_privacy.test.ts` asserting the toggle homes render the rows + the copy strings + persistence calls `setEventGuestPrivacy` (mock-level), and a migration static test `supabase/migrations/__tests__/orch_1339_set_event_guest_privacy.test.ts` (guard order, grant-to-authenticated-only, leaf-write-only jsonb_set paths).

**Fails-on-revert requirement:** reverting any of — a body mount, a gate expression in `RsvpMomentumDecision`, the copy table, the RPC's host guard — makes at least one named test FAIL; restoring makes it PASS. Implementor demonstrates one revert-run per family (mount, gate, RPC guard) in the implementation report.

**Protective comments:** each mount carries `// ORCH-1339 — cross-entity social proof; gates are SERVER-authoritative (D2); cluster is GLYPH-only until ORCH-1340.`; the RPC header names ORCH-1172/1296 as the no-clobber precedent and warns against re-emitting the big edit RPCs (COMMS-0029 class).

## 10. Open questions

1. **Copy veto (Seth):** §4.3 momentum strings ("booked"/"are on this trip"/"have booked this"/"Trip full"/"Fully booked") and §4.8 wizard sub-copy are decided here per the dispatch; flag to Seth at review — pure string swaps, zero structural risk. Note the RSVP wizard label change ("Hide the Going count from guests" → "Hide the spots-left count") corrects an over-promise the D2 semantics never delivered.
2. **Trip draft-resume edge:** Step-5 toggle persistence rides autosave via the new RPC (events row exists); if a host toggles then force-kills before autosave fires, the value is lost like any unsaved wizard field — accepted (matches existing Step-5 behavior).
3. **PublicEventPage RSVP gate source** (§4.6): LiveEvent-parsed flags vs socialProof payload — both server-derived; implementor binds whichever is non-null on that page and documents it. If NEITHER is populated on the anon view path, stop-and-amend (do not invent a third read).
4. **Ended/cancelled momentum display** inherits SPEC_ORCH-1338 §10-3's choice; if Seth flips 1338 to live-only, no change needed here (payload null → unit hidden).

## 11. Downstream routing

- **Next: mingla-implementor** — build exactly this contract in the META worktree (`~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]`, branch `META-ORCH-1337-social-proof-guest-list`). Dependency: ORCH-1338's migration + `socialProofTypes.ts` must exist on the branch first (implement 1338 before 1339, or in one coordinated pass with 1338's contract frozen). Stop-and-amend on any file outside the allowlist.
- **Then: mingla-tester** — the §7 table: deno suites, live-fire RPC proofs (T-6/T-7), sim runtime proof on iOS + Android + web incl. the F-4 live-host case (T-9) and Maestro-driven wizard flows (T-8); physical-device pass per house rules where flagged.
- **Then: orchestrator SHIP/CLOSE** — apply the 1339 migration via Management API (one-curl verify), merge via ONE PR (all CI green), deliver: consumer per-platform OTA, business NATIVE BUILD ONLY (COMMS-0052/0063), web `[deploy]`; flip I-PROPOSED-1339-* ACTIVE; update WORLD_MAP; route ORCH-1340 (avatars + invariant rewrite w/ token) and ORCH-1341 (sheet) next.

---

## Scoped allowlist (the implementor may create/modify ONLY these)

**Package (`packages/offering-rendering/`):**
1. `socialProofMomentum.ts` (NEW)
2. `OfferingMomentum.tsx` (NEW)
3. `index.ts` (barrel exports for the two new modules ONLY)
4. `RsvpMomentumDecision.tsx` (two props + two gate expressions + header sentences ONLY)
5. `RsvpOfferingBody.tsx` (config fields + DecisionUnit forwarding ONLY)
6. `EventOfferingBody.tsx`, 7. `TripOfferingBody.tsx`, 8. `ExperienceOfferingBody.tsx` (one prop + one mount each)

**Backend:**
9. `supabase/migrations/<VERSION>_orch_1339_set_event_guest_privacy.sql` (NEW; version per §4.2 re-scan)

**Consumer (`app-mobile/src/`):**
10. `services/socialProofService.ts` (NEW)
11. `screens/Event/ConsumerEventDetailScreen.tsx`
12. `screens/Trip/ConsumerTripDetailScreen.tsx`
13. `screens/Experience/ConsumerExperienceDetailScreen.tsx`

**Business (`mingla-business/`):**
14. `src/services/socialProofService.ts` (NEW)
15. `src/services/businessEvents.ts` (one added export)
16. `src/services/tripsService.ts` (mapper fields only)
17. `src/services/experiencesService.ts` (mapper fields only)
18. `src/utils/tripToLiveEvent.ts` (two literals → mapped values)
19. `src/hooks/useExperienceDraftAdapter.ts` (two literals → mapped values)
20. `src/components/event/PublicEventPage.tsx`
21. `src/components/event/FoundationEventPreview.tsx`
22. `src/components/trip/TripPreview.tsx`
23. `src/components/experience/ExperiencePreview.tsx`
24. `app/t/[brandSlug]/[tripSlug].tsx`
25. `app/exp/[brandSlug]/[experienceSlug].tsx`
26. `app/rsvp/[id]/preview.tsx`
27. `src/components/trip/TripCreatorStep5Policy.tsx`
28. `src/components/trip/TripCreatorWizard.tsx`
29. `src/components/trip/EditPublishedTripScreen.tsx`
30. `src/components/trip/EditPublishedTripSettingsAccordion.tsx`
31. `src/components/experience/ExperiencePricingStep.tsx`
32. `src/components/experience/ExperienceCreatorWizard.tsx`
33. `src/components/event/CreatorStep6Settings.tsx` (sub-copy strings ONLY)
34. `src/components/rsvp/RsvpStep5Setup.tsx` (label + sub-copy strings ONLY)

**Tests (all NEW files):**
35. `packages/offering-rendering/__tests__/orch_1339_momentum_cross_entity.test.ts`
36. `packages/offering-rendering/__tests__/orch_1339_momentum_adversarial.test.ts`
37. `mingla-business/src/components/trip/__tests__/orch_1339_trip_guest_privacy.test.ts`
38. `mingla-business/src/components/experience/__tests__/orch_1339_experience_guest_privacy.test.ts`
39. `supabase/migrations/__tests__/orch_1339_set_event_guest_privacy.test.ts`

## DO-NOT-TOUCH (stop-and-amend before touching ANY of these)

- **Every existing test file** — especially `orch_1157_*` (incl. adversarial + rounds), `orch_1163_*`, `orch_1167_*`, `meta_orch_1174_*`, `orch_1183_*`, `orch_1292_*`, `orch1303_*` (tests-append-only gate; NO token use in this leg — 1340 owns the sanctioned 1157 rewrite).
- `packages/offering-rendering/rsvpMomentum.ts` (the RSVP derivation single-owner — adversarial-pinned).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (orchestrator writes at CLOSE) and the I-PROPOSED-1157 registry text.
- ORCH-1338's files: `socialProofTypes.ts` (import-only), the 1338 migration, `supabase/migrations/__tests__/orch_1338_*`.
- Existing migrations — above all `biz_update_live_trip` (20260929), `biz_update_live_experience` / `biz_publish_experience` (20261009), `business_publish_trip_draft` (20261101), the 1172/1296 RSVP edit chain, `pg_public_rsvp_by_slug`, `business_public_events_view` (20261220), all RLS.
- `publicEventsService.ts`, `serverDraftEventMapper.ts`, `liveEventAdapter.ts`, `EditPublishedScreen.tsx` (standard/RSVP toggle write/diff paths already work — F-4; read-side only elsewhere).
- `useRsvpOfferingState` / submit paths / `RsvpChipInPanel` / chip-in config; `EventTicketBox` / cart / checkout files; `ParallaxCoverShell`; `BaseBottomSheet.tsx`; `oneLinkResolver.ts` / `appsFlyerService.ts` / `deepLinkService.ts` (1341/1342 territory).
- `mingla-admin/` (all), brand-page tiles (`packages/brand-rendering`), `connectionsService.ts` (F-13 half-stub), `rsvpDeckService.ts` (existing momentum read stays as-is), `COMMS_LEDGER.md`.
