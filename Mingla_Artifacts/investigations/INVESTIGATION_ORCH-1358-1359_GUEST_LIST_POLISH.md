# INVESTIGATION — ORCH-1358 [social-proof-card-spacing] + ORCH-1359 [guest-list-sheet-identity-display]

**Phase:** INVESTIGATE (mingla-forensics)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1359-[guest-sheet-polish]` on branch `ORCH-1359-guest-sheet-polish` (rebased clean on `origin/main`).
**Scope:** Two paired follow-ups to META-ORCH-1337 [social-proof-guest-list], shipping together as ONE OTA release. Consumer-app + backend only. NO web changes to guest names (names never render on web — I-PROPOSED-1340).
**Date:** 2026-07-11
**Confidence:** `proven` for source-layer facts (every file read verbatim, DB column verified live via Management API SQL). Runtime sim-repro NOT performed — see "Repro status" (source + live-DB evidence is dispositive for these cosmetic/display/schema items; flagged honestly).

---

## Comms-ledger acks (read on entry)

Active WARN entries factored into this turn (no BLOCK rows active):
- **COMMS-0093** (META-ORCH-1337 CLOSE) — the parent. Migrations `20261225/26/27000000` LIVE on prod; `peer_list_event_guests` guard-first cap-100; the sheet's DM landing rides the internal open-DM rail, **never `Linking.openURL` (`mingla://` is not a registered scheme; app scheme = `com.mingla.app.v2`)**; I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED is ACTIVE.
- **COMMS-0088** (META-ORCH-1337 INTAKE) — the sheet MUST reuse BaseBottomSheet + `wrapInRNModal`; NO second RN `<Modal>` over the sheet; new migrations pick versions AFTER scanning the frontier (safe-migration protocol).
- **COMMS-0094** (ORCH-1331 CLOSE) — migration frontier now `20261228000000`; NEVER `db push` (history drift). My new migration is additive + applied via Management API.

---

## Symptom summary (expected vs actual)

| Item | Expected | Actual (current) |
|------|----------|------------------|
| **1358 (a)** | Visible vertical breathing room between the vibe/taxonomy pill cluster and the "See who's going" momentum card. | Card renders flush against the pills (zero gap) — screenshot "FIFA Grill Night". |
| **1359 (b)** | Guest row shows just the name. | Named rows show name (line 1) AND a second `@username` line (line 2). |
| **1359 (c)** | Named rows show the guest's public location (city) instead of the username. | No location field exists in the RPC payload / type / row. |
| **1359 (d)** | Tapping a guest's name opens that user's public profile page. | Rows are non-pressable (SEALED); no profile-open exists in the sheet. |
| **1359 (e)** | Unlinked (no-app) guests carry a SHORT "not on the app" indicator. | Unlinked rows render bare "Guest" (line 1) + empty line 2. |

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `packages/offering-rendering/socialProofTypes.ts` | types | Frozen `PeerGuestRow` / payload contract. |
| 2 | `app-mobile/src/services/socialProofService.ts` | service | `fetchPeerGuestList` → RPC call. |
| 3 | `app-mobile/src/hooks/useEventGuestList.ts` | hook | React-Query read feeding the sheet. |
| 4 | `supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql` | schema | Authoritative `peer_list_event_guests` definition (latest in chain). |
| 5 | `app-mobile/src/components/EventGuestListSheet.tsx` | component | Rows b/c/d/e render here. |
| 6 | `packages/offering-rendering/OfferingMomentum.tsx` | component | The shared momentum card (item a). |
| 7 | `packages/offering-rendering/EventOfferingBody.tsx` / `TripOfferingBody.tsx` / `ExperienceOfferingBody.tsx` | component | Card host bodies (item a placement). |
| 8 | `packages/offering-rendering/RsvpOfferingBody.tsx` / `RsvpMomentumDecision.tsx` | component | RSVP momentum card (byte-parity sibling). |
| 9 | `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` | component | **Item (d) — the peer public-profile surface.** |
| 10 | `app-mobile/src/hooks/useFriendProfile.ts` | hook | Peer-profile data source. |
| 11 | `app-mobile/app/index.tsx` | shell | `viewingFriendProfileId` overlay + `registerOpenDirectMessageSink` rail. |
| 12 | `app-mobile/src/services/deepLinkService.ts` | service | Open-DM shell sink (the reuse template for a profile sink). |
| 13 | `app-mobile/src/screens/{Event,Trip,Experience}/Consumer*DetailScreen.tsx` | screens | Sheet mount sites. |
| 14 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` + `specs/SPEC_ORCH-1341_GUEST_LIST_SHEET.md` | docs | Invariant impact. |
| 15 | live DB (`information_schema.columns`, `profiles`) | data | Confirm the real location column. |

---

## Q-scorecard

- **Q1 (item a):** Where is the pills→card flush gap, and does the fix hit all surfaces? — **Verdict:** The shared card style carries `marginBottom: 16` but NO `marginTop`; the pill rows carry `marginTop` but NO `marginBottom` → flush. Fix in shared package code hits ALL surfaces automatically. `proven`.
- **Q2 (item b):** What renders the `@username` line, and is the name source-of-truth safe to keep? — **Verdict:** `EventGuestListSheet.tsx:453-461` builds `line2 = @${username}` for named rows; line 1 (name) is independent and untouched. `proven`.
- **Q3 (item c):** What is the REAL location column, and how is location gated? — **Verdict:** `profiles.location` (text, nullable) — free-text "City, Region, Country". NOT net-new to the DB; net-new to the RPC/type/row. Must be whitelisted for NAMED rows only (same gate as identity). `proven`.
- **Q4 (item d):** Does a consumer peer public-profile surface exist? — **Verdict:** **YES** — `ViewFriendProfileScreen.tsx` (backed by `useFriendProfile.ts`), which already handles the `stranger` case and renders location. Reuse conflicts with a SEALED (DRAFT) invariant → **Seth decision needed on mechanism.** `proven`.
- **Q5 (item e):** How are unlinked vs anon-private guests distinguished today? — **Verdict:** Unlinked → line1 "Guest" / line2 empty; anon-Mingla-private → line1 "Someone" / line2 "Keeping it low-key". They are already distinct; item (e) adds a short caption to the unlinked case only. `proven`.
- **Q6 (batch):** Is the whole batch OTA-safe? — **Verdict:** YES — pure-JS RN/TS changes + ONE additive backend migration (CREATE OR REPLACE the existing RPC). No native module changes. `proven`.

---

## Findings (six-field evidence)

### F-1 — Item (a): shared momentum card has no top margin → flush against pills. `CONFIRMED ROOT CAUSE`
1. **Symptom:** Card sits with zero gap under the pill cluster ("FIFA Grill Night").
2. **Layer:** code (shared presentational package).
3. **Probe:** read `OfferingMomentum.tsx`, the three body placements, `RsvpMomentumDecision.tsx`, and each `pillsRow` style.
4. **Evidence:**
   - `packages/offering-rendering/OfferingMomentum.tsx:164-170` — `momentum: { borderRadius:20, borderWidth:1, padding:18, marginBottom:16, overflow:"hidden" }` — **no `marginTop`.**
   - `EventOfferingBody.tsx:1023` — `pillsRow: { flexDirection:"row", flexWrap:"wrap", gap:8, marginTop:8 }` — **no `marginBottom`.** `TripOfferingBody.tsx:915` — `marginTop:12`, no `marginBottom`. `RsvpOfferingBody.tsx:1523` — `marginTop:8`, no `marginBottom`.
   - `EventOfferingBody.tsx:351-389` — `<View style={styles.pillsRow}>` is immediately followed by `<OfferingMomentum .../>` with no spacer between.
   - `RsvpMomentumDecision.tsx:683-688` — `momentum: { ... marginBottom:16, overflow:"hidden" }` — identical, no `marginTop` (byte-parity sibling; the two cards' `momentum` styles are documented to "byte-follow" each other — `OfferingMomentum.tsx:159-162`).
5. **Mechanism:** The pill row has no bottom margin and the card has no top margin, so the card's border abuts the pills' bottom edge → zero visual gap.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

**Blast radius / surfaces:** `OfferingMomentum` and both bodies live in `packages/offering-rendering/` (shared). The consumer detail screens, buyer-web (`mingla-business`), and business preview all render these bodies. A `marginTop` on the shared card style therefore reaches **all surfaces automatically (parity is automatic, not manual).** No web-specific edit required. No test pins the card margins (grep of `packages/offering-rendering/__tests__/orch_1339_*` and `orch_1157_*` — no `marginTop`/`marginBottom` assertion on `momentum`), and no test asserts style-equality between the two cards, so the fix is low-risk.

### F-2 — Item (b): the `@username` second line on named rows. `CONFIRMED (feature change target)`
1. **Symptom:** Named rows show name + `@username`.
2. **Layer:** code (component).
3. **Probe:** read `EventGuestListSheet.tsx` render.
4. **Evidence:** `EventGuestListSheet.tsx:451-461`:
   ```
   const name = guest.displayName ?? guest.username ?? "Guest";
   const line1 = item.isNamed ? name : guest.isMinglaUser ? "Someone" : "Guest";
   const line2 = item.isYou ? "You"
     : item.isNamed ? (guest.username !== null ? `@${guest.username}` : "On Mingla")
     : guest.isMinglaUser ? "Keeping it low-key" : null;
   ```
   `line1` (the name) is derived independently of `line2`; removing the `@username` branch leaves the name source-of-truth (`displayName ?? username ?? "Guest"`) and the empty/anonymous fallbacks intact.
5. **Mechanism:** `line2` for named rows currently prints `@username`; item (b) drops it (item (c) replaces it with location).
6. **Severity:** `CONFIRMED (target)`.

### F-3 — Item (c): the real location column is `profiles.location`; net-new to the RPC only. `CONFIRMED (net-new backend)`
1. **Symptom:** No location in payload.
2. **Layer:** schema + data.
3. **Probe:** `information_schema.columns` live query (Management API SQL) + grep for the write/display paths.
4. **Evidence:**
   - Live DB: `profiles` has `location text NULL` and `country text NULL`. There is **NO** `city`/`town`/`home_city`/`based_in`/`hometown`/`region`/`neighborhood` column. **The column is `profiles.location`.**
   - Write path — `app-mobile/src/components/ProfilePage.tsx:245-256`: `placeString = "${city}, ${region}, ${country}"` from `expo-location` reverse geocode → `supabase.from('profiles').update({ location: placeString })`. So `location` is a self-authored, public, reverse-geocoded "City, Region, Country" string.
   - Display precedent — `ViewFriendProfileScreen.tsx:637-638`: `fullLocation = profile.location ?? countryName ?? not_shared; locationLine = fullLocation.split(',')[0].trim()` — the app's existing convention displays the **first comma-segment (city)** of `profiles.location`. `useFriendProfile.ts:37` already selects `location` from `profiles`.
   - RPC whitelist today — `20261225000000...sql:279-280`: "the ONLY profiles columns this query may touch: id, display_name, username, avatar_url, visibility_mode." `location` is NOT among them → net-new to the RPC.
5. **Mechanism:** To surface location the RPC whitelist must widen by exactly one column (`location`), emitted ONLY on named rows.
6. **Severity:** `CONFIRMED (net-new)`. Privacy note below.

**Privacy (I-PROPOSED-1340 / I-PROPOSED-1338):** `profiles.location` is already world-readable to authed users and already displayed on `ViewFriendProfileScreen` for any peer. Emitting it in the guest list adds NO new exposure beyond what an authed user can already see by opening a profile — **AND** it is gated to NAMED rows only (the RPC's existing `CASE WHEN linked_user_id IS NOT NULL AND visibility_mode IN ('public','friends')` guard), so private/anonymous/unlinked rows return `location = NULL`. Constitutional rule #9: no location → return NULL → the client renders nothing (name only). No fabrication.

### F-4 — Item (d): a peer public-profile surface EXISTS but reuse conflicts with a SEALED invariant. `CONFIRMED — SETH DECISION`
1. **Symptom:** Sheet rows are non-pressable; no profile-open.
2. **Layer:** code + docs (invariant).
3. **Probe:** grep for profile routes/screens/sheets; trace `onViewFriendProfile` → `viewingFriendProfileId`; read `ViewFriendProfileScreen.tsx`, `useFriendProfile.ts`, the shell rail, and `SPEC_ORCH-1341`.
4. **Evidence:**
   - **A surface exists:** `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` — props `{ userId: string; onBack; onMessage? }` (line 58-62); fetches via `useFriendProfile(userId)` (line 312). It renders name, avatar/hero, **location (`.split(',')[0]`, line 637-638)**, tier, level, bio, "vibe" chips, and — critically — **handles the `stranger` relationship** with an Add-Friend CTA (line 365-371, ORCH-0993). It is NOT friends-only. `useFriendProfile.ts:34-49` selects straight from `profiles` by `id` for ANY userId; `isFriend` is a computed flag, not a gate. Error/unavailable state at line 606-631.
   - **Mounted as a shell overlay:** `app/index.tsx:2539-2548` renders `<ViewFriendProfileScreen userId={viewingFriendProfileId} .../>`; `handleViewFriendProfile` / `setViewingFriendProfileId` drive it (line 2084-2086). Opened today from Discover, Connections, MessageInterface (tap a person), and the ORCH-0940 "Your Circle."
   - **A reuse rail pattern exists:** `deepLinkService.ts:378-413` — `registerOpenDirectMessageSink` / `hasOpenDirectMessageSink` / `openDirectMessageInApp(userId)`; registered in `app/index.tsx:1122` (`dismissAll` → set page). A parallel `openProfileInApp` sink is the direct analog. `deepLinkService.ts:40,166-173,317-319` already models a `{ kind:'profile'; userId }` destination routed via `handlers.setViewingFriendProfileId`.
   - **THE CONFLICT:** `SPEC_ORCH-1341_GUEST_LIST_SHEET.md:216` — **`I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY (DRAFT)`**: "guest-list rows are never pressable; the ONLY interactive elements are the per-row Add-friend and Message buttons; anonymous rows expose no actions; **profile-open from the sheet (if ever added) must use the BaseBottomSheet `overlay` slot, never a second RN Modal and never a row tap.**" The sheet enforces this (`EventGuestListSheet.tsx:27-28,479-481` "rows are NOT pressable (SEALED)") and a test asserts it (`SPEC_ORCH-1341:253` T-9 row-press assertion). This invariant is **DRAFT in the spec, NOT ACTIVE in `INVARIANT_REGISTRY.md`** (grep confirms 1341 sheet invariants are absent from the registry; 1338/1339/1340/1342 are ACTIVE).
   - **Navigation cost:** the sheet is opened from a detail FILE ROUTE (`/e`, `/t`, `/exp`) that sits ABOVE the shell (`app/index.tsx:1118-1120`). Opening the shell overlay requires `dismissAll()` first (the DM rail does exactly this) — which **pops the user off the event detail.** A detail-screen-local overlay avoids that.
5. **Mechanism:** Item (d) is achievable by reusing `ViewFriendProfileScreen`, but ONLY by superseding `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY` (making the name tappable) and choosing a navigation mechanism. That is a design-scope decision, not a mechanical fix.
6. **Severity:** `CONFIRMED — requires Seth scope decision` (see "SETH DECISION NEEDED (item d)" below). NO new profile screen is required.

### F-5 — Item (e): unlinked vs anon-private are already distinct; add a short unlinked caption. `CONFIRMED (target)`
1. **Symptom:** Unlinked rows render bare "Guest".
2. **Layer:** code (component).
3. **Probe:** read the row copy + a11y logic.
4. **Evidence:** `EventGuestListSheet.tsx:452,459-461` — unlinked (`isMinglaUser===false`) → `line1="Guest"`, `line2=null`; anon-Mingla-private (`isMinglaUser===true && isAnonymous===true`) → `line1="Someone"`, `line2="Keeping it low-key"`. The avatar for both is the shared glyph disk (line 440-445). a11yLabel for unlinked is bare `"Guest"` (line 492-493).
5. **Mechanism:** Add a short caption ("Not on Mingla") to `line2` for the unlinked case ONLY; the anon-Mingla-private copy stays "Keeping it low-key" (unchanged), preserving the on-Mingla-but-private vs not-on-app distinction and leaking no identity.
6. **Severity:** `CONFIRMED (target)`.

---

## Five-Truth-Layer reconciliation

| Layer | Item (c) location | Item (d) profile-open |
|-------|-------------------|-----------------------|
| **Docs** | I-1340 gates identity to public/friends non-blocked non-anon rows. | SPEC_ORCH-1341 DRAFT invariant SEALED profile-open away (overlay-slot only, never row tap). |
| **Schema** | `profiles.location text NULL` exists; RPC whitelist excludes it. | `profiles` world-readable to authed users (1334 posture) — `useFriendProfile` works for any peer. |
| **Code** | Sheet shows `@username` (b); no location field anywhere (c). | `ViewFriendProfileScreen` exists + handles strangers + shows location; sheet rows non-pressable. |
| **Runtime** | Not sim-repro'd (display/schema items). | Not sim-repro'd. |
| **Data** | Live: `profiles.location` present (verified). | n/a. |

**Contradiction flagged:** Docs (SPEC_ORCH-1341 DRAFT invariant says "no profile-open via row tap") vs the dispatch's item (d) ("tap name → open profile"). The docs layer holds a SEALED design decision that item (d) would overturn — this is the crux of the Seth decision.

---

## Repro status

No simulator repro was run. All five items are cosmetic (a), display-copy (b/e), schema/whitelist (c), or a design/navigation decision (d) — each fully determined by verbatim source reads + one live DB schema query, all pasted above. Per Prime Directive 7, reproducer-bound UI/gesture/keyboard/animation bugs require sim live-fire; these are not that class (no gesture/keyboard/animation/timing symptom — the "flush" gap is a static style fact proven at `OfferingMomentum.tsx:164-170`). Confidence is `proven` at the source/schema layer. The implementor + tester will validate the rendered result on device per the specs' success criteria.

---

## Blast radius / cross-surface map

- **Item (a):** shared `packages/offering-rendering` → consumer iOS/Android + buyer-web + business-preview, ALL automatically. In-scope: all four card surfaces. Out-of-scope: none.
- **Items (b)/(c)/(e):** `EventGuestListSheet.tsx` is **consumer-app-only** (imported solely by the three `Consumer*DetailScreen`s). Web NEVER renders guest names (I-1340). In-scope: consumer iOS + Android. Out-of-scope: buyer-web (names never shown), business (no guest sheet).
- **Item (c) backend:** `peer_list_event_guests` RPC is called only by `socialProofService.fetchPeerGuestList` (consumer). Widening its payload is additive; the anon `pg_public_social_proof` path is untouched.
- **Item (d):** consumer-app-only; touches the sheet + (per chosen option) the shell rail or the 3 detail screens.

---

## Invariant impact (flagged, not pre-decided)

- **I-PROPOSED-1338-GUARD-FIRST-PEER-READS (ACTIVE):** item (c) must keep guard order (auth → event public+live → privateGuestList → row-cap) and the whitelist discipline; adding `location` to the whitelist for named rows is the additive change, privacy-final server-side (no client re-filter). PRESERVED.
- **I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (ACTIVE):** item (c) location is returned ONLY on the same named rows that already expose identity; private/anon/unlinked rows get NULL. Items (b)/(e) do not change which rows are named/anonymous. PRESERVED.
- **I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY (DRAFT, SPEC_ORCH-1341):** item (d) would SUPERSEDE this (name tap opens profile). **Requires orchestrator/Seth ratification** — this is the Seth decision.
- **I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE (DRAFT):** whatever option is chosen for (d) must complete `onClose()` BEFORE navigating (mirrors the existing Message action, `EventGuestListSheet.tsx:394-406`). PRESERVED/EXTENDED.

---

## SETH DECISION NEEDED (item d) — tap-name → public profile

**Definitive answer:** A consumer peer public-profile surface **EXISTS** (`ViewFriendProfileScreen.tsx` + `useFriendProfile.ts`) and works for ANY peer (it already renders strangers and shows location). **No new profile screen is required.** BUT reusing it requires overturning the SEALED (DRAFT) invariant `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY`, which explicitly excluded profile-open-from-the-sheet, AND choosing a navigation mechanism. Options:

- **Option D-A — Shell profile-sink (mirror the DM rail).** Add `registerOpenProfileSink`/`hasOpenProfileSink`/`openProfileInApp(userId)` to `deepLinkService.ts` (byte-mirror the DM sink at lines 378-413); register it in `app/index.tsx` (`dismissAll()` → `setViewingFriendProfileId`). Sheet: name tap on NAMED rows → `onClose()` → `openProfileInApp(profileId)`. *Pros:* smallest wiring, exact parity with the proven DM rail, no prop threading. *Cons:* `dismissAll()` pops the user OFF the event detail (same as opening a DM today) — on back they land at the shell, not the detail.
- **Option D-B — Detail-screen-local overlay (RECOMMENDED).** Add an `onOpenProfile?: (userId) => void` prop to `EventGuestListSheet` (mirrors the existing `onOpenConversation?` seam). Each of the 3 `Consumer*DetailScreen`s holds a local `profileUserId` state and renders `<ViewFriendProfileScreen>` as an in-screen overlay ABOVE its content; sheet name tap → `onClose()` → host sets `profileUserId`. *Pros:* on back the user returns to the SAME event detail (best UX); no shell coupling; profile overlay layers correctly once the RN-Modal sheet is closed. *Cons:* wiring in 3 screens.
- **Option D-C — Defer item (d).** Ship b/c/e in this OTA now; land (d) as a fast-follow once the invariant supersession is ratified. *Pros:* unblocks the OTA immediately, avoids flipping a sealed design decision under time pressure. *Cons:* the tap-to-profile affordance waits one release.

**My recommendation:** **Ship b/c/e now (they are independently shippable and low-risk) and pick D-B for item (d)** — it gives the best UX (stays in the event context) and reuses the existing screen with a clean prop seam. If Seth wants the OTA out immediately without ratifying the invariant flip this turn, take **D-C** and I'll spec D-B for the fast-follow. In all cases the name tap is restricted to NAMED, non-You rows (anonymous/unlinked rows carry no `profileId` — deanonymization guard intact) and completes `onClose()` before navigating.

---

## Discoveries for Orchestrator

- **D-1:** `I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY` and `I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE` are DRAFT in `SPEC_ORCH-1341` but were **never promoted to `INVARIANT_REGISTRY.md`** at META-ORCH-1337 CLOSE (1338/1339/1340/1342 were). Registry gap — the orchestrator may want to backfill or formally supersede at this batch's CLOSE.
- **D-2:** `I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE` (DRAFT) still cites the OLD landing rail `mingla://chat/{id}?type=direct` → `parseDeepLink`; the shipped code (post-P1-2 rework) uses `openDirectMessageInApp` and explicitly bans `Linking.openURL`. The DRAFT text is stale vs shipped reality (COMMS-0093) — cosmetic doc drift.

---

## Recommended next phase + scope

Proceed to SPEC (this same skill, same turn — IA mode). Two specs: `SPEC_ORCH-1358_CARD_SPACING.md` (item a) and `SPEC_ORCH-1359_GUEST_LIST_IDENTITY.md` (items b/c/e as shippable, item d gated behind the Seth decision). Migration version: **`20261229000000`** (after frontier `20261228000000`). Batch is **OTA-safe** (pure JS + one additive CREATE-OR-REPLACE RPC migration; no native module change).
