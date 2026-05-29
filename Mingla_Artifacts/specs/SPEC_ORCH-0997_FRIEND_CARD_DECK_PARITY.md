# SPEC — ORCH-0997 [Friend-page holiday/birthday cards render + open like the swipeable deck]

**Phase:** SPEC (forensics). Pairs with `reports/INVESTIGATION_ORCH-0997_FRIEND_CARD_DECK_PARITY.md` (both root causes PROVEN by live-fire 2026-05-29).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0997-[friend-card-deck-parity]/` on branch `ORCH-0997-friend-card-deck-parity`.
**Direction:** operator-chosen **"scoped fix"** — do NOT touch the deck (`SwipeableCards.tsx`); fix the friend-page open-path data + reshape the friend-page tile to the deck's visual language. (Option A "extract a shared deck-card component" was explicitly NOT chosen.)

---

## 1. Scope

1. **Fix the broken open path (RC#2).** The friend-page card rows (Birthday, Upcoming Holidays, custom "Your Special Days", and the fallback-card path) must open `ExpandedCardModal` with a correctly-shaped `ExpandedCardData` so the detail renders the hero image, location-derived data, and curated multi-stop plan identically to the deck.
2. **Reshape the friend-page tile (RC#1).** `CompactCard` must be re-skinned to the deck's visual language (portrait hero image + glass-style info chips), replacing the current 150-wide landscape thumbnail, so the cards read as the same product as the deck card — per a required `mingla-designer` pass.
3. **Regression prevention.** The producer must be typed so the field-name drift that caused RC#2 cannot recur silently.

## 2. Non-goals

- **No edit to `SwipeableCards.tsx` or the deck card** (LOCKED — scoped-fix decision). The deck is the visual reference only.
- **No shared `<RecommendationCard>` extraction / `PersonGridCard` consolidation** — registered as Discovery D-1 for a future ORCH, out of scope here.
- **No DB / edge-function / RLS change.** The source card data (`HolidayCard` from `usePairedProfileCards` → `get-person-hero-cards`) already carries the needed fields; the bug is purely client-side mapping + presentation.
- **No change to the `PairedSavesListScreen` / `onSaveCardPress` path** unless the implementor finds it shares the identical mapping defect (if so, register a sibling finding — do not silently widen).
- **No change to card generation / ranking / which cards appear.**

## 3. Assumptions

- The source card is `HolidayCard` (`app-mobile/src/services/holidayCardsService.ts:12–42`): single nullable `imageUrl` (NO `images[]`), flat `lat`/`lng`, `googlePlaceId`, `priceTier`, `cardType:"single"|"curated"`, `stops:number`, `stopsData:unknown[]|null`, `tagline`, `totalPriceMin/Max`, `website`, `estimatedDurationMinutes`, `experienceType`, `shoppingList`, `description` (often null), `rating` (nullable).
- `ExpandedCardModal` consumes `target.data` verbatim with NO normalization (`ExpandedCardModal.tsx:1392`); it reads `card.image`/`card.images` (`:1914–1915`), `card.location?.lat/lng` (`:1474–1475`), `card.categoryIcon || getCategoryIcon(card.category)` (`:1958`), and branches curated on `card.cardType`/stops.
- The deck's curated cards and the friend page's curated cards both originate from `generate-curated-experiences`, so a correctly-typed `stopsData` → `CuratedStop[]` renders identically.

## 4. Cross-Surface Impact (Phase 2.5)

| Surface | In scope? | Behaviour / files / parity |
|---|---|---|
| **Consumer iOS** (`app-mobile` iOS) | YES | Friend-profile holiday/birthday cards render in deck visual language + open full-fidelity. Files: `PersonHolidayView.tsx`, `ViewFriendProfileScreen.tsx`, new mapping helper. Parity with Android = **automatic** (shared RN code). |
| **Consumer Android** (`app-mobile` Android) | YES | Same as iOS; automatic parity. Both verified live (root cause proven on Android). |
| Buyer/anon Web (`mingla-business`) | NO | No friend page exists on buyer-web. |
| Business iOS / Android (`mingla-business`) | NO | No friend page in the business app. |
| Admin Web (`mingla-admin`) | NO | No equivalent surface. |
| Business Web preview | NO | No equivalent surface. |

Parity is automatic (one shared `app-mobile` code path serves both consumer platforms), so success criteria are not split per-platform — but the tester MUST verify on BOTH iOS and Android per parity enforcement.

## 5. Layer-by-layer contract

### 5.1 Type / helper layer (NEW — regression prevention) 🔒 LOCKED

Create a pure mapping helper that converts a `HolidayCard` into a valid `ExpandedCardData`. Suggested: `app-mobile/src/components/utils/holidayCardToExpandedCardData.ts` (or co-located util), signature:

```ts
export function holidayCardToExpandedCardData(
  c: HolidayCard,
  opts: { travelMode?: string; currencySymbol: string; currencyRate: number }
): ExpandedCardData
```

Required field mapping (🔒 LOCKED — every line):

| `ExpandedCardData` field | Source | Rule |
|---|---|---|
| `id` | `c.id` | direct |
| `title` | `c.title` | direct |
| `category` | `c.category` | direct |
| `categoryIcon` | `getCategoryIcon(c.category)` | never leave undefined |
| `image` | `c.imageUrl ?? ''` | **the RC#2 fix** — modal reads `image`, not `imageUrl` |
| `images` | `c.imageUrl ? [c.imageUrl] : []` | **the RC#2 fix** — gallery reads `images[]`; empty array → modal shows its own honest empty state, never the silent grey fallthrough caused by `undefined` |
| `location` | `(c.lat != null && c.lng != null) ? { lat: c.lat, lng: c.lng } : undefined` | **the RC#2 fix** — modal reads `location.lat/lng` for distance/map |
| `placeId` / `googlePlaceId` usage | `c.googlePlaceId ?? undefined` | map to `placeId` |
| `address` | `c.address ?? ''` | direct |
| `rating` | `c.rating ?? 0` | modal guards `rating > 0` |
| `reviewCount` | `0` | not provided by source; honest zero (modal hides when 0) |
| `description` / `fullDescription` | `c.description ?? ''` | direct |
| `priceTier` | `c.priceTier as PriceTierSlug \| undefined` (validate against `VALID_TIERS`) | direct |
| `priceRange` | `c.priceTier ? formatTierLabel(...) : undefined` | currency-aware (Constitution #10) |
| `website` | `c.website ?? undefined` | direct |
| `tagline` | `c.tagline ?? undefined` | direct |
| `highlights` / `tags` | `[]` | source has none; honest empty (no fabrication, Constitution #9) |
| `matchScore` / `matchFactors` / `socialStats` | neutral zero-objects matching the interface | required fields; never fabricate non-zero |
| `travelMode` | `opts.travelMode` | passthrough |
| `distance` / `travelTime` | `null` | modal computes distance from `location` + viewer; never fabricate |
| **Curated only** (`c.cardType === 'curated'`): `cardType: 'curated'`, `stops: (Array.isArray(c.stopsData) ? c.stopsData : []) as CuratedStop[]`, `totalPriceMin/Max`, `estimatedDurationMinutes`, `experienceType`, `shoppingList: (c.shoppingList ?? []) as string[]` | source | the implementor MUST confirm `stopsData` element shape conforms to `CuratedStop` (it is the same `generate-curated-experiences` output the deck renders); if a field is missing, map it explicitly — do not cast blindly |

- 🔒 No `?? <displayValue>` fabrication for ratings/prices/counts — missing → zero/empty so the modal hides the element (Constitution #9).
- 🔒 The helper returns a value typed `ExpandedCardData` so the compiler enforces completeness — this is the structural guard against RC#2 recurring (Discovery D-2).

### 5.2 Component layer — `PersonHolidayView.tsx`

**5.2a Open path (RC#2 fix) 🔒 LOCKED.**
- Replace BOTH `onCardPress({...})` payloads — the primary card path (`CardRow`, currently `:477–502`) and the fallback path (currently `:506–541`) — with a single call passing `holidayCardToExpandedCardData(c, {...})`. For the fallback `FallbackCard` shape, adapt it through an equivalent builder (it has `image`, `priceRange` already — map `image→image`+`images:[image]`).
- Change the `onCardPress` prop type (`:90–116`) to `(card: ExpandedCardData) => void`. Update `ViewFriendProfileScreen` accordingly (5.3).
- 🔒 No behavioural change to which cards render, shuffle, GPS-empty, loading, error, or empty states.

**5.2b Tile reshape (RC#1 fix) — `CompactCard` (`:246–340` + styles `:1109`,`:1216–1318`).**
- 🔒 LOCKED: the tile must adopt the deck card's visual language — a **portrait** card with the image as a tall hero (not a 100px-tall landscape strip), category/price/rating presented as **glass-style chips** consistent with the deck's `GlassBadge`, and a single consistent treatment (eliminate the curated-dark `#1C1C1E` vs single-white split that makes the row inconsistent — curated may carry a subtle distinguishing accent + the "· N stops" label, but must share the deck's chip/typography system).
- 🔒 LOCKED: horizontal-scroll rail layout is preserved (these remain compact rail items, not full-screen swipe cards — that was Option C, not chosen). The card is a smaller-scale expression of the deck card's language, not a literal full-bleed deck card.
- 🔒 LOCKED: honest states — missing image → the deck's image-fallback treatment (never a fabricated photo); missing rating/price → hidden chip (no "N/A").
- 🎨 OPEN: exact card width/height, hero aspect ratio, chip styling, corner radius, shadow, press feedback, and the curated accent — these are the `mingla-designer` pass's job (5.4). The implementor builds to the designer tokens.

### 5.3 Component layer — `ViewFriendProfileScreen.tsx`
- `handleCardPress` (`:263–266`) + the `ExpandedCardModal` mount (`:484–500`): since the payload is now already an `ExpandedCardData`, set it directly as `expandedCard` and pass `target={{ kind:"nightOut", data: expandedCard }}` unchanged. Update the `handleCardPress` param type to `ExpandedCardData`.
- 🔒 No change to the modal's other props (`onSave`, `currentMode="solo"`, `accountPreferences`) except: `accountPreferences` currency/measurement SHOULD reflect the real user locale rather than the hard-coded `{ currency:'USD', measurementSystem:'Imperial' }` at `:498` if a locale hook is readily available (🎨 OPEN — nice-to-have; if not trivially available, leave and register a follow-up).

### 5.4 Visual & UX granularity contract (Phase 3.6) — REQUIRED `mingla-designer` pass 🔒 LOCKED that it must exist
This SPEC owns the functional contract + the acceptance bar; the pixel-precise tile tokens are produced by `mingla-designer` and referenced here before IMPLEMENT. The designer contract MUST pin, for the reshaped `CompactCard` (light + dark): exact color tokens (surface/text/chip/border per state + computed contrast ≥4.5:1 body / ≥3:1 large), typography (family/weight/size/line-height per role), spacing on the 4px grid, hero aspect ratio + card dimensions at 375/390/430pt, chip system mirroring `GlassBadge`, motion/press feedback + `prefers-reduced-motion`, and all 9 states with Mingla-voice copy. No-AI-slop bans apply (no generic gradients, stock imagery, emoji icons). "References examined" must cite the in-app deck card as the primary reference. **Deliverable:** `Mingla_Artifacts/specs/DESIGN_ORCH-0997_FRIEND_CARD.md` (designer), referenced by the implementor.

## 6. Success criteria (observable / testable)

- **SC-1 (RC#2 hero):** Tapping ANY friend-page card with a non-null `imageUrl` opens the detail showing the **hero image** (not the "No images available" grey box). Verified iOS + Android.
- **SC-2 (RC#2 no-image honesty):** Tapping a card whose `imageUrl` is null opens the detail with the modal's standard empty-image treatment — never a fabricated image, never a crash.
- **SC-3 (RC#2 location):** For a card with non-null `lat`/`lng`, the detail's distance/travel/map-derived UI populates (parity with deck), driven by `card.location`.
- **SC-4 (RC#2 curated):** Tapping a curated friend-page card (`cardType:"curated"`) opens the multi-stop curated plan layout (stops timeline), matching the deck's curated detail — not a single-place layout.
- **SC-5 (RC#1 shape):** The friend-page card tiles render in the deck's visual language (portrait hero + glass-style chips, consistent curated/single treatment) per the designer tokens; no 150-wide landscape thumbnail, no dark/white inconsistency. Verified against the designer spec on iOS + Android at 375/390/430pt.
- **SC-6 (no regression):** Birthday hero, "Your Special Days" empty/populated, "Upcoming Holidays", archived, shuffle, GPS-empty, loading, error, and empty-cards states all render unchanged. Liked-Places + Add-to-calendar unchanged.
- **SC-7 (type guard):** The producer is typed `ExpandedCardData`; removing a required mapping (e.g. reverting `image`) is a compile error.

## 7. Invariants
- **Constitution #9 (no fabrication):** zero, empty, or hidden for missing data — never fake images/ratings/prices.
- **Constitution #10 (currency-aware):** price label uses the user's currency.
- **One-owner-per-truth:** the new helper becomes the single producer of `ExpandedCardData` for the friend page (removes the divergent ad-hoc producer).
- **NEW invariant `I-CARD-MODAL-DATA-SHAPE` (DRAFT):** any surface opening `ExpandedCardModal` MUST pass a value typed `ExpandedCardData` (no ad-hoc inline objects). Orchestrator-owned text; CI/grep enforcement optional follow-up.

## 8. Test cases

| Test | Scenario | Expected | Layer |
|---|---|---|---|
| T-01 (impl, happy) | `holidayCardToExpandedCardData` on a single card w/ imageUrl+lat/lng | returns `image` set, `images:[url]`, `location:{lat,lng}`, `categoryIcon` set | helper unit |
| T-02 (impl, edge) | mapping a card with `imageUrl:null`, `lat:null` | `image:''`, `images:[]`, `location:undefined`; no throw | helper unit |
| T-03 (tester, adversarial) | mapping a curated card; assert `cardType:'curated'` + `stops` is `CuratedStop[]` with stopNumber/placeId present (NOT empty, NOT untyped cast survives a malformed stop) | curated detail data integrity | helper unit |
| T-04 (live) | tap single friend card on device | hero image shows, no grey box (SC-1) | full stack, iOS+Android |
| T-05 (live) | tap curated friend card | multi-stop plan layout (SC-4) | full stack |
| T-06 (live) | tile visual vs designer spec | matches tokens (SC-5) | UI, iOS+Android |

T-01/T-02 = implementor happy-path regression (must fail-on-revert of the `image`/`location` mapping). T-03 = tester adversarial (curated stop-shape integrity — a different angle than T-01).

## 9. Implementation order
1. Add `holidayCardToExpandedCardData` helper + unit tests (T-01/T-02).
2. Rewire `PersonHolidayView` both `onCardPress` payloads through the helper; retype the prop (5.2a).
3. Retype `ViewFriendProfileScreen.handleCardPress` (5.3).
4. (After `mingla-designer` delivers `DESIGN_ORCH-0997_FRIEND_CARD.md`) reshape `CompactCard` to the tokens (5.2b).
5. Tester adversarial test (T-03) + live verification (T-04/05/06) iOS + Android.

## 10. Regression prevention
- The typed helper (SC-7) makes the field-name drift a compile error.
- T-01/T-02 lock the mapping (fail-on-revert proven).
- `I-CARD-MODAL-DATA-SHAPE` invariant documents the rule for future surfaces.

## 🔒 LOCKED / 🎨 OPEN summary
- 🔒 LOCKED: deck untouched; exact field mapping (§5.1); open-path rewire + retype; honest states; rail layout preserved; designer pass must exist + be referenced; the 7 success criteria; invariants.
- 🎨 OPEN: exact tile tokens (dimensions, hero ratio, chip styling, curated accent, motion) — owned by `mingla-designer`; the optional real-locale `accountPreferences` improvement; internal helper structure.
