# SPEC — ORCH-0986 [Paired-profile redesign]

**Skill:** Claude `mingla-forensics` (SPEC)
**Date:** 2026-05-28
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0986-[paired-profile-holidays-redesign]/` on branch `ORCH-0986-paired-profile-holidays-redesign`
**Surfaces:** consumer-iOS + consumer-Android (`app-mobile/`)
**Inputs (binding):**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0986_PAIRED_PROFILE_HOLIDAYS.md` (root causes RC-1, CF-1, HF-1, HF-2; §9b speed/location; §9c locked brief + corrections)
- `Mingla_Artifacts/reports/DESIGN_ORCH-0986_PAIRED_PROFILE_REDESIGN.md` (commit `8f8561aca`) — visual/IA contract
**Routing after this SPEC:** Codex `implementor-mingla` → `mingla-tester` (iOS + Android).

> COMMS on entry: COMMS-0003 (external-API docs at SPEC) + COMMS-0002 (backend strict-grep allowlist) factored — see §11. No new third-party external API is introduced (no Google/OpenAI param changes); Supabase RPC/RLS patterns are cited inline (§3.1). COMMS-0006 BLOCK is scoped to ORCH-0980, not this ORCH.

---

## 1. Scope, Non-Goals, Assumptions

### Scope
1. **Visual + structural redesign** of `ViewFriendProfileScreen.tsx` (hero + overlapping sheet + quote bio + Message placement, all friend profiles) and `PersonHolidayView.tsx` (premium restyle of birthday + recommendation sections, paired-only), per the DESIGN artifact.
2. **Curated combo card image + field-contract fix** (RC-1) — curated cards expose a real hero image + correct camelCase fields.
3. **Expanded-curated stops-shape fix** (HF-1) — tapping a combo opens a populated multi-stop plan.
4. **Batched + parallel recommendation load** (HF-2) — one request resolves all paired sections; no per-section serialized fan-out; no live OpenAI in the load hot path.
5. **Friend-GPS-only location model** — paired recommendations center exclusively on the paired friend's last-known physical GPS, resolved server-side; never the viewer's or the friend's preference location; honest empty state when absent.
6. **First-class states** — loading (coherent skeletons), populated, no-cards-for-occasion, friend-GPS-missing, error, partial.
7. **Remove** the heart/save button from the profile. **Do not add** an "Ideal night out" feature.

### Non-Goals
- Fixing the upstream location-capture pipeline (`enhancedLocationTrackingService`) so `user_location_history` is reliably populated. That is owned by ORCH-0977's location rework; this SPEC consumes whatever GPS exists and shows the empty state otherwise. **Dependency flagged, not in scope.**
- Changing the curated experience-generation algorithm or signal scoring (singles are correct).
- The `bilateralMode`/Saves/Visits hidden tabs — left as-is (hidden); not removed.
- Any non-consumer surface.

### Assumptions
- A1: An active row in `pairings` between viewer and friend constitutes consent to use the friend's last-known location server-side to center recommendations (coords are never returned to the viewer's client).
- A2: `user_location_history` is the authoritative store of last-known physical GPS (cols incl. `user_id, latitude, longitude, created_at`).
- A3: "Always use last-known GPS" means no staleness rejection in v1 — the most recent row is used regardless of age; the empty state applies ONLY when the friend has zero location rows. Staleness cutoff is a future tunable (see Open Items).
- A4: Curated stops already carry a per-stop `imageUrl` (`generate-curated-experiences/index.ts:559`).

---

## 2. Cross-Surface Impact (Phase 2.5)

| # | Surface | In scope? | Behavior / files / parity |
|---|---------|-----------|---------------------------|
| 1 | **Consumer iOS** | YES | Full redesign + all logic. Files in §3. Parity automatic (shared RN). |
| 2 | **Consumer Android** | YES | Same shared RN code → automatic parity; platform-specific shadow/elevation + safe-area + no-blur-fallback per DESIGN §15. Manual per-surface success criteria SC-* tagged `-Android` where rendering differs. |
| 3 | Buyer/anon Web | NO | No paired-profile surface exists in `mingla-business`. |
| 4 | Business iOS | NO | No analog. |
| 5 | Business Android | NO | No analog. |
| 6 | Admin Web | NO | No analog. |
| 7 | Business Web preview | NO | No analog. |

Parity is automatic (one RN codebase). The only manual per-surface concerns are shadow/elevation, safe-area insets, and blur fallback — each gets an `-iOS`/`-Android` success criterion in §4.

---

## 3. Layer Specifications

### 3.1 Database layer — friend last-known GPS read (SECURITY DEFINER RPC)

**New migration:** `supabase/migrations/<TS>_orch_0986_paired_friend_last_location.sql` (timestamp must be later than the max prefix across `supabase/migrations/` AND all active `~/Desktop/mingla-orchs/*/supabase/migrations/` — check before naming).

**New RPC:** `public.get_paired_friend_last_location(p_viewer_id uuid, p_friend_id uuid)`
- `SECURITY DEFINER`, `SET search_path = public, pg_temp` (Supabase SECURITY DEFINER guidance: https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker — pin `search_path` to prevent hijack).
- Logic:
  1. Verify an active pairing exists: `EXISTS (SELECT 1 FROM pairings WHERE (user_a_id = p_viewer_id AND user_b_id = p_friend_id) OR (user_a_id = p_friend_id AND user_b_id = p_viewer_id))`. If not → `RETURN NULL` (no row). This is the consent gate (Invariant I-0986-PAIR-CONSENT).
  2. Return the latest `user_location_history` row for `p_friend_id`: `SELECT latitude, longitude, created_at ... WHERE user_id = p_friend_id ORDER BY created_at DESC LIMIT 1`.
- Returns `TABLE(latitude double precision, longitude double precision, captured_at timestamptz)`; zero rows when no pairing or no location.
- `GRANT EXECUTE ... TO authenticated;` (Supabase RPC execution grant: https://supabase.com/docs/guides/database/functions#calling-functions). Edge functions call it with the service-role client; the consent check still runs (defense in depth).
- **Read-only.** No writes. No RLS change to `user_location_history` (its owner-only policies stay; the DEFINER RPC is the only cross-user read path).

**Pre-flight data probe (implementor must run + record before `db push`):** confirm the RPC returns expected shape for a known pairing, and `NULL` for a non-paired pair. (Per orchestrator invariant-migration backstop.)

### 3.2 Edge function layer

#### 3.2a Shared helper extraction — `supabase/functions/_shared/personHeroCards.ts` (NEW)
Extract from `get-person-hero-cards/index.ts` (pure refactor, behavior-preserving except the fixes below) so both the single-occasion and batched endpoints share one implementation:
- `resolveBlendedPreferences(...)` — the mode/bilateral/custom/shuffle blending (current `:455-722`).
- `resolveSignalIds(blendedCategories)` — current `:818-826`.
- `mapPlacePoolRowToCard(...)` — current `:103-162` (unchanged).
- `curatedCardToCard(...)` — current `:236-265` **WITH the RC-1 fix below**.
- `planComboForHoliday(...)` — current `:279-348` **WITH the radius fix + summary surfacing below**.

#### 3.2b RC-1 fix — curated card image + field contract
Two coordinated changes:
1. In `generate-curated-experiences/index.ts` `buildCardFromStops` (`:623-637`): add a top-level **`imageUrl`** field sourced from the first main stop:
   `imageUrl: mainStops.find(s => s.imageUrl)?.imageUrl ?? null`.
   (Stops carry `imageUrl` per `:559`. Never fabricate — null when no stop has an image.) This benefits every curated consumer; verify collab-deck/discover consumers still map correctly (blast check in §8).
2. In the shared `curatedCardToCard`: read the producer's **actual camelCase fields** + the new image:
   - `imageUrl: raw.imageUrl ?? (Array.isArray(raw.stops) ? raw.stops[0]?.imageUrl : null) ?? null`
   - `totalPriceMin: raw.totalPriceMin ?? raw.total_price_min ?? null` (accept both; producer is camelCase)
   - `totalPriceMax: raw.totalPriceMax ?? raw.total_price_max ?? null`
   - `estimatedDurationMinutes: raw.estimatedDurationMinutes ?? raw.estimated_duration_minutes ?? null`
   - `shoppingList: Array.isArray(raw.shoppingList) ? raw.shoppingList : (Array.isArray(raw.shopping_list) ? raw.shopping_list : null)`
   - `category: raw.categoryLabel ?? raw.category ?? "Curated"` (producer emits `categoryLabel`)
   - `priceTier`: derive from `raw.stops` if a representative tier is desired, else null (no fabrication).

#### 3.2c Combo radius fix
In `planComboForHoliday`, replace the hardcoded `travelMode: "walking"` + `travelConstraintValue: 30` (`get-person-hero-cards/index.ts:307-309`) with a **city-scale** request: `travelMode: "driving"` + `travelConstraintValue` derived so the combo radius is comparable to the singles `initialRadius` (≈ 15–25 km). Rationale: walking×30 ≈ 2.9 km starves combos (Investigation §9b Q3). Cite `_shared/distanceMath.ts:TRAVEL_CONFIG` — `radiusKmForConstraint(constraint, travelMode, generosity)`.

#### 3.2d NEW batched endpoint — `supabase/functions/get-paired-profile-cards/index.ts`
Single call returning all paired sections.
- **Auth:** require `Authorization` bearer; `userClient.auth.getUser()` → `viewerId` (current `get-person-hero-cards` pattern).
- **Request:**
  ```ts
  {
    pairedUserId: string;            // friend
    sections: Array<{
      holidayKey: string;            // 'birthday' | standard id | 'custom_<uuid>'
      isCustomHoliday: boolean;
      yearsElapsed?: number;
      categorySlugs: string[];       // resolved client-side from sections (as today)
      curatedExperienceType: string | null;
    }>;
    mode?: "default" | "individual" | "bilateral";  // no per-call location field — see location model
  }
  ```
  **No `location` field.** Location is resolved server-side (§3.2e).
- **Behavior:**
  1. Resolve friend GPS server-side (§3.2e). If none → return `{ locationStatus: "missing", sections: {} }` (no card work).
  2. Resolve blended preferences ONCE for the friend (shared helper).
  3. For each requested section, resolve signals + composition rule. Run the singles RPC and `planComboForHoliday` for all sections **in parallel** (`Promise.all`), deduping place IDs across sections **server-side** (replaces the client `stage1/stage2/stage3` staging). Dedup order: birthday → customs → standard (stable, matches current intent).
  4. Plan combos in parallel; teasers/descriptions must NOT block — pass `skipDescriptions: true` to `generate-curated-experiences` and rely on the `curated_teaser_cache`; on cache-miss return the combo without a teaser rather than awaiting OpenAI (removes live-OpenAI from the hot path, Investigation §9b Q1).
- **Response:**
  ```ts
  {
    locationStatus: "ok" | "missing";
    sections: { [holidayKey: string]: { cards: Card[]; summary?: { emptyReason: string } } };
    // coords are NOT included
  }
  ```
- **`verify_jwt`:** default (true) — authenticated user call. Preserve in `config.toml`.

#### 3.2e Server-side location resolution (both endpoints)
- New shared `resolveFriendLocation(adminClient, viewerId, friendId)`:
  - Call `get_paired_friend_last_location(viewerId, friendId)` RPC.
  - Return `{ lat, lng, capturedAt } | null`. **Never** fall back to viewer location or preference location (Invariant I-0986-FRIEND-GPS-ONLY).
- `get-person-hero-cards` (single-occasion, used by shuffle) is updated identically: it stops trusting the client `location` for paired recs and resolves friend GPS server-side. The client `location` param is removed from the paired path. (Shuffle keeps working via the same resolution.)

### 3.3 Service layer — `app-mobile/src/services/personHeroCardsService.ts`
- Add `fetchPairedProfileCards(params: { pairedUserId, sections, mode })` calling `get-paired-profile-cards`.
- **Return the full response** including `locationStatus` and per-section `summary` (current code drops `summary` at `:57-60` — CF-1; fix it). New return type:
  `{ locationStatus: "ok" | "missing"; sections: Record<string, { cards: Card[]; summary?: { emptyReason: string } }> }`.
- Remove the `location` argument from the paired fetch (location is server-resolved). `useUserLocation` is no longer used to feed paired recs.
- Keep existing `fetchPersonHeroCards` (single-occasion) for shuffle, also dropping the `location` arg and returning `summary`.

### 3.4 Hook layer
- **NEW** `app-mobile/src/hooks/usePairedProfileCards.ts`:
  - One `useQuery` per profile (not per section). Query key (factory in `queryKeys.ts`): `personCardKeys.pairedProfile(pairedUserId, mode)` — **no location in the key** (location is server-resolved; friend GPS change is rare and handled by `staleTime`).
  - `queryFn` → `fetchPairedProfileCards({ pairedUserId, sections, mode })` where `sections` is the assembled list (birthday + customs + standard, with client-resolved `categorySlugs` per section via existing `sectionsToSlugsAndType` + `useHolidayCategories`).
  - `enabled`: `!!pairedUserId`.
  - `staleTime: 5 * 60 * 1000`; `gcTime: 24h`; `retry: 2`.
  - Returns `{ locationStatus, sections, isLoading, isError, refetch }`.
- Keep `useShufflePairedCards` (single-occasion shuffle), updated to the no-location contract and writing into the per-section cache slot of the batched data (or invalidating the profile query).
- Add `personCardKeys.pairedProfile` to the key factory; deprecate per-section `personCardKeys.paired` usage from the initial load (shuffle may retain a per-occasion slot).

### 3.5 Component layer

#### 3.5a `ViewFriendProfileScreen.tsx` — hero + sheet (all friend profiles)
Implement DESIGN §4–§9, §17. Key changes:
- Replace gradient-header + centered-avatar anatomy with: full-bleed hero photo (DESIGN §5.1) + translucent back/overflow chips (§5.2, tokens `glass.chrome.*`) + identity overlay (name/age/verified + metadata row, §5.3) + overlapping rounded sheet (§6, `glass.notificationsSheet.*`).
- Sheet order (§6.2): bio quote card (§7) → Message pill directly beneath bio (§8) → interest pills (§9) → (paired) birthday card → (paired) recommendation sections.
- Bio quote card: renders ONLY `profile.bio`; hide entirely if empty; **no image, no "Ideal night out" label** (§7.1).
- **Remove** the heart/save button entirely (it does not exist today on this screen's hero; ensure none is added). Message pill = dark `colors.gray[900]`, `touchTargets.large`, beneath bio.
- Stop passing `location` to `PersonHolidayView`; pass only `pairedUserId`, `pairingId`, identity props.
- Initials-gradient fallback only when `avatar_url` is null (§5.1); no small avatar circle.
- All states for the *profile* itself (loading/error/missing profile) preserved.

#### 3.5b `PersonHolidayView.tsx` — premium restyle + batched consumption
Implement DESIGN §10–§13, §17.
- Consume `usePairedProfileCards` ONCE at the top; pass each section its slice (`sections[holidayKey]`). Remove the per-section `usePairedCards` calls and the `stage1Ids/stage1Done/stage2Ids/stage2Done` staging machinery (server now dedups).
- `HolidaySectionView` / `CustomHolidaySectionView`: premium occasion headers (DESIGN §11.2); expanded body shows the horizontal row from the batched slice.
- Birthday card: premium white card (DESIGN §10.2), not the orange block. Liked-places footer + Add-to-calendar.
- `CompactCard`:
  - **Curated variant** (DESIGN §12.2): image-led card (`colors.gray[900]`, 224×276, image 154pt, `Curated plan` badge, title, price tier + `· {N} stops`, CTA arrow). Uses the now-non-null `imageUrl`. If `imageUrl` is null (data error), show the warm "Plan image unavailable" tile (§12.2 no-image state) — NOT a silent gray placeholder.
  - **Single variant** (DESIGN §12.3): refined 158×224 white card; hide price/rating when null (Constitution #9).
- States (DESIGN §13): coherent skeletons during load (§13.1); no-cards-for-occasion (§13.3); friend-GPS-missing replaces ALL rows (§13.4, driven by `locationStatus === "missing"`); error (§13.5); partial (§13.6, per-section `summary.emptyReason`).

#### 3.5c Expanded curated card stops fix (HF-1)
- `ViewFriendProfileScreen.handleCardPress` / the `ExpandedCardModal` target: ensure the curated card's **stops array** reaches the modal. Today the tap payload sets `stops: c.stops` (a count number) and `stopsData: c.stopsData` (array); `ExpandedCardModal.tsx:769` reads `localCard.stops` as an array. Fix by passing the array as `stops` to the modal target (map `stopsData → stops` when building `target.data`, or update the modal to read `stopsData`). The implementor must trace `target={{ kind: "nightOut", data }}` consumption and pick the single-source fix; add a test (T-09).

---

## 4. Success Criteria (observable, testable)

**Visual / structural**
- SC-1: Profile renders a full-bleed hero photo with name/age/verified + location·tier·level overlaid; back/overflow chips legible over bright AND dark photos. (-iOS: extends under status bar via insets; -Android: elevation chips clear the notch.)
- SC-2: Bio appears as the quote-styled card showing only `profile.bio`; no image, no "Ideal night out" text; card hidden when bio empty.
- SC-3: The dark Message pill renders directly beneath the bio (or at sheet top when bio absent). No heart/save button appears anywhere on the screen.
- SC-4: The hero/bio/Message/interests chrome renders for BOTH paired and non-paired friend profiles; birthday + recommendation sections render ONLY when paired.
- SC-5: Birthday section renders as the premium white card (not the orange block) with countdown + liked-places + Add-to-calendar.

**Curated card fix**
- SC-6: A curated combo card returned for a section renders a real hero image (from a stop) — never a gray placeholder on a dark card for successful data. When no stop image exists, the "Plan image unavailable" tile shows (not a silent placeholder).
- SC-7: Tapping a curated card opens the expanded plan with its stops populated (not empty).

**Speed / batched load**
- SC-8: Opening a paired profile issues exactly ONE recommendation request (`get-paired-profile-cards`), not one-per-section. (Verify via network/log.)
- SC-9: No section's combo blocks on an OpenAI call during load (`skipDescriptions: true`; teaser cache-miss returns combo without teaser).
- SC-10: Recommendation sections present a coherent skeleton state during load, not staggered per-row spinners.

**Location model**
- SC-11: Recommendations are centered on the friend's last-known GPS (`get_paired_friend_last_location`), never the viewer's or the friend's preference location. The viewer's client never receives the friend's coordinates.
- SC-12: When the friend has no location row, the friend-GPS-missing empty state replaces ALL recommendation rows with the DESIGN §13.4 copy; zero cards from any other location are shown.
- SC-13: The RPC returns NULL (no location) when no active pairing exists between viewer and friend (consent gate).

**States / truthfulness**
- SC-14: Single cards hide price when null and rating when null/≤0; no fabricated values (Constitution #9).
- SC-15: Service surfaces `summary.emptyReason` so UI distinguishes no-GPS / no-cards / service-error (CF-1 fixed).
- SC-16: A recommendation request failure shows the error card with retry; the rest of the profile still renders (no whole-screen failure).

**Accessibility / parity**
- SC-17: All interactive controls ≥44pt; white-on-hero text passes WCAG AA via the gradient; accessibility labels per DESIGN.
- SC-18-iOS / SC-18-Android: visual parity verified on both; platform shadow/elevation + safe-area + no-blur-fallback correct.

---

## 5. Invariants

| ID | Invariant | Preservation | Test |
|----|-----------|--------------|------|
| I-0986-FRIEND-GPS-ONLY | Paired recs center ONLY on the friend's last-known GPS; never viewer/preference location; no fallback location | Location resolved server-side via RPC; no client `location` param on paired path; empty state on absence | T-05, T-06 |
| I-0986-PAIR-CONSENT | Friend location is read only when an active pairing exists | RPC consent check returns NULL otherwise | T-07 |
| I-0986-NO-COORD-LEAK | Friend coordinates never returned to the viewer's client | Response omits coords; only `locationStatus` | T-08 (assert response shape) |
| I-0986-NO-FABRICATION (Constitution #9) | No fake image/price/rating/location/fallback card | Null → hidden/placeholder; combo image from real stop or honest tile | T-02, T-03, T-06 |
| I-0986-CURATED-IMAGE | Curated card exposes a renderable top-level image when any stop has one | `buildCardFromStops.imageUrl` + mapper read | T-01 |
| I-0986-NO-HEART | No heart/save button on the profile hero | Component contains none | T-04 (grep/render) |
| I-0986-SINGLE-FETCH | Initial paired load = one batched request | One `get-paired-profile-cards` call | T-10 |
| Constitution #3 (no silent failure) | Combo/section failures surface via `summary`/error state, not silent drop | Service returns `summary`; UI states | T-11 |

**New invariant for the registry** (orchestrator to add at CLOSE per Step 5e): `I-ORCH-0986-FRIEND-GPS-ONLY` + `I-ORCH-0986-CURATED-IMAGE` + `I-ORCH-0986-NO-HEART`.

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Curated card has image | Combo whose first stop has `imageUrl` | Mapped card `imageUrl` non-null = stop image | Edge/shared |
| T-02 | Curated no-image honesty | Combo, no stop image | `imageUrl` null → "Plan image unavailable" tile, never fabricated | Edge + Component |
| T-03 | Single null price/rating | Single with null price/rating | Price/rating hidden, layout stable | Component |
| T-04 | No heart button | Render profile (paired + non-paired) | No save/heart control present | Component |
| T-05 | Friend GPS used | Paired friend with a location row | Recs centered on that lat/lng; viewer location irrelevant | Edge + DB |
| T-06 | No friend GPS | Paired friend, zero location rows | `locationStatus: "missing"`; empty state; zero cards | Edge + Component |
| T-07 | Consent gate | viewer NOT paired with friend | RPC returns NULL; no location used | DB |
| T-08 | No coord leak | Any paired response | Response JSON has no latitude/longitude | Edge |
| T-09 | Expanded combo stops | Tap curated card | Expanded plan shows N stops (not empty) | Component |
| T-10 | Single batched fetch | Open paired profile | Exactly one `get-paired-profile-cards` request | Hook/Service |
| T-11 | Section failure surfaces | Force one section's combo to fail | That section shows error/empty reason; others render; profile intact | Service + Component |
| T-12 | Combo radius | Friend in a metro area | Combo returns ≥1 plan (not starved by 2.9km box) | Edge |
| T-13-iOS / T-13-Android | Parity | Render on both | Hero/sheet/cards correct; safe-area + shadow/elevation correct | Component |

**Regression-test gate (CLOSE Step 0.5):** implementor ships a happy-path test with a `fails-on-revert` anchor (e.g., T-01 curated image mapping, or T-06 GPS-missing empty state). Tester writes an adversarial test on a DIFFERENT angle (e.g., T-07 consent gate or T-08 coord-leak). app-mobile has no Jest harness — follow the ORCH-0975 precedent (node-assertion pattern) for component/mapper tests; edge/RPC tests under `supabase/functions/**/*.test.ts`.

---

## 7. Implementation Order

1. **DB:** new migration + `get_paired_friend_last_location` RPC (§3.1) + pre-flight probe. Operator applies via `supabase db push --linked`.
2. **Edge — shared helper + fixes:** extract `_shared/personHeroCards.ts`; apply RC-1 image/field fix (§3.2b) in `generate-curated-experiences` + shared mapper; combo radius fix (§3.2c); `resolveFriendLocation` (§3.2e).
3. **Edge — batched endpoint:** `get-paired-profile-cards` (§3.2d); update `get-person-hero-cards` to server-resolve location + return `summary`. Orchestrator deploys both functions (verify-first-call curl per memory).
4. **Service + hook:** `fetchPairedProfileCards` + `usePairedProfileCards` + key factory (§3.3, §3.4).
5. **Component — hero/sheet:** `ViewFriendProfileScreen` redesign (§3.5a).
6. **Component — sections/cards/states:** `PersonHolidayView` restyle + batched consumption + states; `CompactCard` curated + single (§3.5b); expanded stops fix (§3.5c).
7. **Tests** (§6) + strict-grep allowlist (§11).

Land in reviewable increments (DB+edge first, then service/hook, then UI) to respect sequential review.

---

## 8. Blast Radius / Regression Prevention

- `get-person-hero-cards`, `generate-curated-experiences`, `usePairedCards`, `PersonHolidayView`, `CompactCard` touched. `PersonHolidayView` is rendered only by `ViewFriendProfileScreen` (Investigation §5) — contained.
- **`buildCardFromStops` is shared** with other curated consumers (collab deck — `INVESTIGATION_ORCH-0906`; discover). Adding a top-level `imageUrl` is additive (new field); verify those consumers ignore-or-benefit and none break on the new field. The mapper change is local to the person-hero path. (Tester: blast check collab/discover curated rendering.)
- `ExpandedCardModal` is shared — the HF-1 stops fix must be verified against other curated surfaces that open it (collab/discover) so the chosen single-source fix doesn't regress them.
- Regression prevention: contract test (T-01) locks the curated producer↔consumer field agreement; T-08 locks no-coord-leak; strict-grep gate (below) locks no-heart + friend-GPS-only.

---

## 9. Realtime / Cache
- No realtime. React Query caching: profile-level query key, `staleTime 5m`. Shuffle writes into the section slice or invalidates the profile query.
- Logout clears React Query cache (existing behavior) — no new persistence; no Zustand server-state (Constitution #5).

---

## 10. Open Items (operator/designer, non-blocking)
- O-1: Staleness cutoff for friend GPS — v1 uses latest regardless of age (A3). If a cutoff is wanted later, add a `p_max_age` to the RPC + extend the empty state.
- O-2: Whether to remove the hidden `bilateralMode`/Saves/Visits/PersonTabBar dead UI (DESIGN §17 leaves hidden). Defer unless operator says remove.

---

## 11. CI / COMMS obligations for implementor
- **COMMS-0002:** the new edge function `get-paired-profile-cards` + the new migration + `_shared/personHeroCards.ts` MUST be added to `ORCH_0986_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit (per memory `feedback_close_commit_precommit_checks`).
- **New strict-grep gate** (per `feedback_strict_grep_registry_pattern`): one script `.github/scripts/strict-grep/orch-0986-paired-profile.mjs` + one job, asserting: (C1) no heart/save control in `ViewFriendProfileScreen.tsx`; (C2) no client `location` passed to the paired cards fetch (friend-GPS-only); (C3) no `"Ideal night out"` literal in the profile components.
- **COMMS-0003:** Supabase RPC/SECURITY DEFINER docs cited inline (§3.1). No third-party external API params changed.
- Migration filename collision check across active worktrees before naming (§3.1).

---

## 12. Confidence
SPEC is grounded in proven investigation findings (RC-1, HF-1, HF-2 proven at code+data) and a complete DESIGN artifact. Architecture (server-side location + batched endpoint + shared helper) is the minimal change that satisfies all locked decisions. The one external dependency (location capture under ORCH-0977) is explicitly out-of-scope with a defined empty-state behavior, so this SPEC is implementable today regardless of that pipeline's state.
