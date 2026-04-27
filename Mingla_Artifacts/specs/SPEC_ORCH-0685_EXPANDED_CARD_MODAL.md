# SPEC — ORCH-0685 — Shared-card modal compatibility (chat-mounted ExpandedCardModal)

**Status:** Spec-pending review
**Date:** 2026-04-26
**Author:** Mingla Forensics (SPEC mode)
**Mode:** SPEC (post-investigation)
**Investigation source:** [reports/INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md](../reports/INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md)
**Dispatch:** [prompts/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md](../prompts/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md)
**Severity:** S1 (constitutional violation triple #1 + #3 + #12 + invariant-class miss on #9 ORCH-0659/0660 boundary)
**Prior spec under repair:** [specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md](SPEC_ORCH-0667_SHARE_SAVED_CARD.md) §6, §9.6 (the IMPL step 7c that was skipped)

---

## 1. Layman summary

When a user taps a shared-card chat bubble, the `ExpandedCardModal` that opens must show **~95% the same content** as the same modal opened from the deck or saved tab — image, title, translated category, rating, price tier, address, weather strip, busyness/popular times, opening hours, booking options. The Save button must work (tapping it actually saves the shared card to the recipient's collection). Every category-leak surface — primary chip, sub-component prop sites, icon fallback, and locale fallback — must produce a translated label or honest empty state, never a raw slug.

Mechanism: widen `CardPayload` from 12 fields to a richer set carrying the load-bearing render fields (`location`, `placeId`, `categoryIcon`, `tags`, `matchFactors`, `socialStats`, `phone`, `website`, `openingHours`, `selectedDateTime`); replace the unsafe `as unknown as ExpandedCardData` cast with a typed helper; wire the Save button to `savedCardsService.saveCard`; wrap raw category at `WeatherSection`/`TimelineSection` prop sites with `getReadableCategoryName`; fallback `categoryIcon` to `getCategoryIcon(card.category)`; audit + fill all 29 locale `common.json` files for `category_*` parity. Recipient-relative fields (`travelTime`, `distance`) remain explicitly forbidden in the payload per Constitution #9 and ORCH-0659/0660 lesson — codified as a new CI-gated invariant.

---

## 2. Scope, non-goals, assumptions

### 2.1 In-scope

1. `CardPayload` interface widening — add 10 fields per DEC-1 (§6).
2. `trimCardPayload` v2 — extract new fields, extended drop order under 5KB pressure, **explicit forbidden-field guard** for recipient-relative fields.
3. Typed cast cleanup — replace `as unknown as ExpandedCardData` at [MessageInterface.tsx:942-948](../../app-mobile/src/components/MessageInterface.tsx#L942-L948) with explicit helper `cardPayloadToExpandedCardData(p: CardPayload): ExpandedCardData` (§7.4).
4. Save handler implementation — replace [MessageInterface.tsx:1387](../../app-mobile/src/components/MessageInterface.tsx#L1387) no-op with real handler calling `savedCardsService.saveCard(currentUserId, card, 'solo')` (§9.4).
5. `<ExpandedCardModal>` mount changes — wire `isSaved` + `onSave` props on the chat-mounted instance ([MessageInterface.tsx:1378-1389](../../app-mobile/src/components/MessageInterface.tsx#L1378-L1389), §9.5).
6. `categoryIcon` fallback at [ExpandedCardModal.tsx:1781](../../app-mobile/src/components/ExpandedCardModal.tsx#L1781) — `card.categoryIcon ?? getCategoryIcon(card.category)` (§10.1).
7. Sub-component category wrappers (defense-in-depth) at [ExpandedCardModal.tsx:1874](../../app-mobile/src/components/ExpandedCardModal.tsx#L1874), [:1994](../../app-mobile/src/components/ExpandedCardModal.tsx#L1994), [:2008](../../app-mobile/src/components/ExpandedCardModal.tsx#L2008) — wrap with `getReadableCategoryName` (§10.2).
8. Locale audit + fill — 29 `common.json` files, 12 required `category_*` keys minimum (§11).
9. New i18n keys for Save toasts in 29 `chat.json` files (§11.2).
10. New invariant `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` registered in [INVARIANT_REGISTRY.md](../INVARIANT_REGISTRY.md), CI-gated in [scripts/ci-check-invariants.sh](../../scripts/ci-check-invariants.sh) (§12 + §15).
11. New CI gate for locale parity (29 locales × 12 keys) (§15).
12. **IMPL STEP X — field-shape verification documentation** (mandatory) — implementor must produce a row-by-row table mapping every `card.<field>` read in `ExpandedCardModal.tsx` to its disposition (widened / null-safe-default / out-of-scope per spec / forbidden per Constitution #9). This step exists explicitly to prevent another step-7c-class skip (§16).

### 2.2 Non-goals (explicit; do NOT implement)

- **D-4 (DEFER):** dead `MatchFactorsBreakdown` import in `ExpandedCardModal.tsx`. File post-CLOSE as cleanup ORCH.
- **D-5 (DEFER):** dead reads of `reviewCount`, `highlights`, `fullDescription`, `socialStats` (modal never renders them for any card). File post-CLOSE as same cleanup ORCH. **Important:** even though we widen `CardPayload` to include these fields, **the modal does NOT render them today and adding render sites is out of scope for ORCH-0685.** The widening enables future render-site addition without re-touching the trim function.
- **D-6 (DEFER):** stroll/picnic detection at [ExpandedCardModal.tsx:1503-1510](../../app-mobile/src/components/ExpandedCardModal.tsx#L1503-L1510) uses legacy English display names (`"Take a Stroll"`, `"Picnic Date"`). Misses canonical slugs. File separate ORCH.
- **D-7 (DEFER):** `currentMode="solo"` hardcoded at [MessageInterface.tsx:1388](../../app-mobile/src/components/MessageInterface.tsx#L1388). Out of scope unless implementor judges as ≤3 lines AND it has zero behavioral impact on other modal sub-features (in which case bundle as labeled "discretionary inline" per implementor report).
- **D-9 (DEFER):** `BusynessSection` `\|\| "N/A"` literal preempt. Out of scope; benign for chat-share today (location-gated; busyness fetch only fires once location is widened, and `BusynessSection` is gated on `busynessData` truthiness — confirmed not user-visible for the chat-share path with the v2 widening).
- **D-8 (ESCALATE program-level, NOT in this spec):** "Implementation report MUST list every spec-mandated IMPL verification step." Orchestrator-level concern. ORCH-0685 mitigates this class of risk for itself via §16 step 12 ("IMPL STEP X — field-shape verification documentation"), but the program-level invariant remains separate orchestrator follow-up.
- Recipient-relative fields (`travelTime`, `travelTimeMin`, `distance`, `distanceKm`, `distance_km`) — **explicitly forbidden** per Constitution #9 and ORCH-0659/0660 lesson. Codified as new invariant in §12.
- Group / multi-recipient DM share path — still ORCH-0667.D-1 deferred.
- The chat bubble (`MessageBubble.tsx` card branch) — accepted as-is by user.
- The picker preview row at [MessageInterface.tsx:1361-1368](../../app-mobile/src/components/MessageInterface.tsx#L1361-L1368) — accepted as-is by user.
- DB migration — none. `messages.card_payload jsonb` is permissive; widened payload writes through unchanged.
- Edge function changes — none. `notify-message` `direct_card_message` handler reads only `cardTitle` + `cardId`; both unchanged.
- Realtime subscription — none. Postgres CDC carries the full row; new fields propagate automatically.
- Native-build changes — none. Pure JS/TS + locale JSON; OTA-eligible.

### 2.3 Assumptions

- **A1:** `SavedCardModel` ([savedCardsService.ts:17-41](../../app-mobile/src/services/savedCardsService.ts#L17-L41)) carries `location`, `placeId`, `categoryIcon`, `tags`, `matchFactors`, `socialStats`, `phone`, `website`, `openingHours`, `selectedDateTime` via the `[key: string]: any` index signature on line 40. Implementor verifies via grep + a sample saved-card row inspection before widening trim. **If a field is genuinely absent on most saved cards in production data, document as known v1 gap in IMPL STEP X table and accept honest empty state at modal render.**
- **A2:** `savedCardsService.saveCard(profileId, card, source)` ([savedCardsService.ts:67-116](../../app-mobile/src/services/savedCardsService.ts#L67-L116)) handles the duplicate-row case (Postgres error code `23505`) silently — logs warn, returns void. Treated as success by our handler. The user's optimistic transition to "Saved" is correct in the duplicate-tap case because the row already exists. **Confirmed by direct read of service body in v2 forensics §A2.**
- **A3:** `messages.card_payload jsonb` accepts any JSON shape; the soft constraint `messages_card_requires_payload` only checks NOT NULL when `message_type='card'`. Widening the payload shape does not violate any DB constraint.
- **A4:** Postgres realtime CDC ships the full row including the widened JSONB — confirmed by ORCH-0667 §11 realtime no-change clause; preserved here.
- **A5:** Old-build recipients (running pre-fix mobile) reading a v2 `card_payload` ignore unknown JSON keys at the runtime read site; their bubble + modal render only the v1 fields they know about. **Forward-safe by virtue of structural typing — TypeScript reads only declared keys; extra keys are silently dropped.** Verified by reading the v1 `MessageBubble.tsx:238-277` card branch — only reads `cardPayload.image`, `cardPayload.title`, `cardPayload.category`. No assertion on field set. SC-12 verifies.
- **A6:** `ExpandedCardModal` accepts `card: ExpandedCardData | null` as its `card` prop ([expandedCardTypes.ts:246](../../app-mobile/src/types/expandedCardTypes.ts#L246)). The typed cast helper produces a non-null `ExpandedCardData` from a `CardPayload`, satisfying the type contract.
- **A7:** 29 locales total (verified by `ls app-mobile/src/i18n/locales/` returning `ar, bin, bn, de, el, en, es, fr, ha, he, hi, id, ig, it, ja, ko, ms, nl, pl, pt, ro, ru, sv, th, tr, uk, vi, yo, zh`). v2 forensics dispatch said "28" — verified count is **29**. Spec uses 29.
- **A8:** Implementor has either Supabase MCP access or the ability to inspect a live `messages.card_payload` row to confirm runtime shape. If neither, the implementor proceeds against the trim function output (deterministic) and notes this in the IMPL STEP X table as confidence MEDIUM not HIGH for the data-layer claim.

---

## 3. Decisions (4 default-locks, all USER-BOUND)

These were bound by the user via orchestrator AskUserQuestion on 2026-04-26. Override requires founder explicit ask in chat.

| # | Decision | Lock | Rationale | Override evidence required |
|---|----------|------|-----------|---------------------------|
| **DEC-1** | **Widen CardPayload aggressively** — pull `location`, `placeId`, `categoryIcon`, `tags`, `matchFactors`, `socialStats`, `phone`, `website`, `openingHours`, `selectedDateTime` into the payload. | LOCKED | User answer: "Widen aggressively: pull every render-relevant field into CardPayload." Adds ~600-1000 bytes per card. Modal renders ~95% identical to deck-tap. Highest fidelity, single field-pair (`location` + `placeId`) unlocks 3 biggest sections (weather + busyness + booking). | Demonstrated payload >5KB after trim with all DEC-1 fields, OR realtime payload size limit hit. |
| **DEC-2** | **Save button wires to `savedCardsService.saveCard`** — real save with all 4 states (loading / success / already-saved-silent-success / error toast). | LOCKED | User answer: "Wire to saveCard (Recommended)." Recipient's most natural intent on seeing a shared card is "I want this." Closes the loop, adds second-order share metric (saves-from-shares). | Founder explicit ask for hide-button OR toast-explainer instead. |
| **DEC-3** | **Defensive slug-leak fix** — (a) audit + fill 29 locale `common.json` for 12 `category_*` key minimum; (b) wrap `card.category` at `WeatherSection` + `TimelineSection` (×2) prop sites with `getReadableCategoryName`; (c) `categoryIcon` fallback at modal level: `card.categoryIcon ?? getCategoryIcon(card.category)`. | LOCKED | User answer: "Proceed defensively." Catches all 3 plausible leak mechanisms (locale fallback / sub-component leak / icon fallback) in one spec without waiting for screenshot. | Founder produces a screenshot showing slug source not in DEC-3's 3 buckets. |
| **DEC-4** | **Defer cleanups** — D-4 (dead `MatchFactorsBreakdown` import), D-5 (dead reads of `reviewCount`/`highlights`/`fullDescription`/`socialStats`), D-6 (stroll/picnic detection), D-7 (`currentMode` passthrough), D-9 (BusynessSection N/A preempt) → out of ORCH-0685 scope. File post-CLOSE as cleanup ORCHs. | LOCKED | User answer: "Defer all to separate ORCH (Recommended)." Smaller scope = faster ship + clearer test surface. | None — user steered explicitly. |

No overrides invoked.

---

## 4. Layer 1 — Database

**No migration. No RLS change. No index change.**

`messages.card_payload jsonb` is permissive — widened payload writes through unchanged.

The soft constraint `messages_card_requires_payload` (added in `20260425000001_orch_0667_add_card_message_type.sql`) only enforces NOT NULL when `message_type='card'`. The widened payload remains non-null and satisfies the constraint.

**Confirmed via [SPEC_ORCH-0667 §4.1, §4.2, §11](SPEC_ORCH-0667_SHARE_SAVED_CARD.md)** — realtime publication unchanged, RLS unchanged.

---

## 5. Layer 2 — Edge functions

**No edge function changes.**

`notify-message` `direct_card_message` handler at [supabase/functions/notify-message/index.ts](../../supabase/functions/notify-message/index.ts) reads only `cardTitle` + `cardId` from the request body — both unchanged. Push body remains `🔖 ${cardTitle}`.

Confirmed via [SPEC_ORCH-0667 §5](SPEC_ORCH-0667_SHARE_SAVED_CARD.md) and v2 forensics §G "Will NOT be modified".

---

## 6. Layer 5 — `CardPayload` v2 schema

### 6.1 TypeScript interface (verbatim)

Replace the existing `CardPayload` at [app-mobile/src/services/messagingService.ts:6-28](../../app-mobile/src/services/messagingService.ts#L6-L28) with:

```typescript
/**
 * ORCH-0667 + ORCH-0685: snapshot payload for shared-card chat messages.
 *
 * Carries every ExpandedCardModal-render-relevant field so chat-shared cards
 * render with ~95% parity to deck-tap cards (per ORCH-0685 DEC-1).
 *
 * EXPLICITLY EXCLUDED — do NOT add `travelTime`, `travelTimeMin`, `distance`,
 * `distanceKm`, `distance_km` or any other recipient-relative field. Sender's
 * value would fabricate for the recipient (Constitution #9 violation).
 * Cross-ref: ORCH-0659/0660 distance/travel-time lesson.
 * Enforced by: invariant I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS +
 * CI gate in scripts/ci-check-invariants.sh.
 *
 * SIZE BUDGET: 5KB (preserved from ORCH-0667). Drop order under pressure
 * defined in trimCardPayload (§6.3): drop optional rich fields first,
 * essentials never dropped.
 */
export interface CardPayload {
  // ── REQUIRED ESSENTIALS (never dropped under size pressure) ─────────────
  id: string;                    // place_pool.id — analytics dedup; NOT for refetch
  title: string;                 // hero / bubble title
  category: string | null;       // canonical slug (e.g., 'casual_food'); rendered via getReadableCategoryName at every consumer site
  image: string | null;          // primary image URL

  // ── ORCH-0685 DEC-1 ADDITIONS — modal-render-relevant ──────────────────
  /** lat/lng pair. Required by ExpandedCardModal weather + busyness + booking fetch gates ([ExpandedCardModal.tsx:1343,1361,1382](../../app-mobile/src/components/ExpandedCardModal.tsx#L1343)). */
  location?: { lat: number; lng: number };
  /** Google Place ID. Required by ExpandedCardModal booking dedup at line 1369. */
  placeId?: string;
  /** Optional explicit icon name; falls back to getCategoryIcon(category) at render. */
  categoryIcon?: string;
  /** Render in CardInfoSection tag chips row. */
  tags?: string[];
  /** Render path TBD (currently never rendered — bundled for future enablement per DEC-4 D-5 deferral). */
  matchFactors?: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  /** Render path TBD (currently never rendered). */
  socialStats?: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  /** Phone number for booking + PracticalDetailsSection phone row. */
  phone?: string;
  /** Website URL for booking + PracticalDetailsSection website row. */
  website?: string;
  /** Opening-hours data; multiple-shape per ExpandedCardData docstring. Used by extractWeekdayText + PracticalDetailsSection opening-hours expander. */
  openingHours?:
    | string
    | { open_now?: boolean; weekday_text?: string[] }                                    // Google legacy
    | { openNow?: boolean; periods?: unknown[]; nextOpenTime?: string; nextCloseTime?: string; weekdayDescriptions?: string[] }  // Google v1
    | Record<string, string>                                                              // Mingla legacy ({ monday: "9-5", ... })
    | null;
  /** Date/time for weather + timeline. ISO string only (Date instances are not JSON-serializable; deserialize on read). */
  selectedDateTime?: string;

  // ── ORCH-0667 ORIGINAL OPTIONAL FIELDS (preserved) ──────────────────────
  images?: string[];             // gallery — drop first under pressure
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  address?: string;
  description?: string;          // capped 500 chars at trim
  highlights?: string[];         // cap 5 × 80 chars at trim
  matchScore?: number;
}
```

### 6.2 Field-by-field justification (v1 → v2 delta)

| Field | v1 status | v2 status | Justification |
|-------|-----------|-----------|---------------|
| `id`, `title`, `category`, `image` | REQUIRED | REQUIRED (unchanged) | Bubble + modal essentials. Never dropped. |
| `images` | OPT | OPT (unchanged) | Modal carousel. Capped 6. |
| `rating`, `reviewCount` | OPT | OPT (unchanged) | CardInfoSection metrics. |
| `priceRange` | OPT | OPT (unchanged) | CardInfoSection price chip + TimelineSection. |
| `address` | OPT | OPT (unchanged) | Directions + PracticalDetailsSection + TimelineSection. |
| `description` | OPT | OPT (unchanged) | CardInfoSection body, capped 500 chars. |
| `highlights` | OPT | OPT (unchanged) | Modal highlights section, cap 5×80. (Note: modal does not render today per D-5 deferral; preserved for future enablement.) |
| `matchScore` | OPT | OPT (unchanged) | Modal match badge. (Note: modal does not render today per D-5 deferral.) |
| **`location`** | (excluded) | **OPT (NEW)** | **DEC-1 critical add.** Unlocks weather, busyness, booking sections. Adds ~30 bytes. |
| **`placeId`** | (excluded) | **OPT (NEW)** | **DEC-1.** Booking dedup key. Adds ~24 bytes. |
| **`categoryIcon`** | (excluded) | **OPT (NEW)** | **DEC-1.** Modal icon. Adds ~10 bytes. Falls back to `getCategoryIcon(category)` at render even when absent. |
| **`tags`** | (excluded) | **OPT (NEW)** | **DEC-1.** CardInfoSection tag chips. Capped 10 tags × 32 chars at trim. Adds ~50-200 bytes. |
| **`matchFactors`** | (excluded) | **OPT (NEW)** | **DEC-1 (forward-positioned).** Modal does not render today per D-5; persisted for future enablement. Adds ~80 bytes. |
| **`socialStats`** | (excluded) | **OPT (NEW)** | **DEC-1 (forward-positioned).** Same — persisted for future render. Adds ~80 bytes. |
| **`phone`** | (excluded) | **OPT (NEW)** | **DEC-1.** Booking + practical-details phone row. Adds ~15 bytes. |
| **`website`** | (excluded) | **OPT (NEW)** | **DEC-1.** Booking + practical-details website row. Adds ~50 bytes. |
| **`openingHours`** | (excluded) | **OPT (NEW)** | **DEC-1.** Opening-hours expander. Adds ~100-400 bytes (drops first under pressure). |
| **`selectedDateTime`** | (excluded) | **OPT (NEW)** | **DEC-1.** Weather date selection. ISO string. Adds ~30 bytes. |
| `strollData`, `picnicData`, `nightOutData` | (excluded) | **REMAIN excluded** | Context-specific (deck-mode metadata). Not relevant in chat-share. Adds 1-3 KB if included. Spec excludes per ORCH-0667 §6.2. |
| `cardType` | (excluded) | **REMAIN excluded** | Curated branch detection. Chat-shared cards always render regular layout. |
| `fullDescription` | (excluded) | **REMAIN excluded** | Modal does not render. D-5 deferred. |
| `travelTime`, `distance` | (excluded) | **EXPLICITLY FORBIDDEN** | **Constitution #9 + ORCH-0659/0660.** Recipient-relative; sender's value fabricates. CI-gated in §15. |
| `dateAdded` | (excluded) | **REMAIN excluded** | Chat `created_at` is the new "shared at" time. |
| `source`, `sessionId`, `sessionName` | (excluded) | **REMAIN excluded** | Sender-context, irrelevant to recipient. |

**Total v2 additions:** ~650-900 bytes worst case. Combined with v1 essentials (~1,500-2,500 bytes), maximum total payload ≈ 2,500-3,400 bytes. **Well under 5KB budget.**

### 6.3 `trimCardPayload` v2 (verbatim)

Replace [messagingService.ts:53-88](../../app-mobile/src/services/messagingService.ts#L53-L88) with:

```typescript
/**
 * ORCH-0667 + ORCH-0685: trim a SavedCardModel to a CardPayload, enforcing
 * the <5KB budget.
 *
 * Drop order under pressure (v2 — extended for ORCH-0685):
 *   matchFactors → socialStats → tags → openingHours → highlights →
 *   description → images → address
 * Required fields {id, title, category, image} are NEVER dropped.
 * NEW fields with hard render dependencies (location, placeId, categoryIcon)
 * are also never dropped — without them, ExpandedCardModal sections silently
 * skip (defeats the entire ORCH-0685 fix).
 *
 * FORBIDDEN FIELDS — do NOT extract under any circumstance:
 *   - travelTime, travelTimeMin, distance, distanceKm, distance_km
 *   - These are recipient-relative; sender's value fabricates (Constitution #9).
 *   - Cross-ref: ORCH-0659/0660. Enforced by:
 *     I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS (CI-gated).
 */
export function trimCardPayload(card: any): CardPayload {
  // [ORCH-0685 RC-2 FIX] Required essentials — never dropped, never absent.
  const trimmed: CardPayload = {
    id: card.id,
    title: card.title || 'Saved experience',
    category: card.category ?? null,
    image: card.image ?? null,
  };

  // [ORCH-0685 DEC-1] Hard-render-dependent additions (never dropped under pressure).
  if (card.location && typeof card.location.lat === 'number' && typeof card.location.lng === 'number') {
    trimmed.location = { lat: card.location.lat, lng: card.location.lng };
  }
  if (typeof card.placeId === 'string' && card.placeId.length > 0) {
    trimmed.placeId = card.placeId;
  }
  if (typeof card.categoryIcon === 'string' && card.categoryIcon.length > 0) {
    trimmed.categoryIcon = card.categoryIcon;
  }

  // [ORCH-0685 DEC-1] Soft-render fields (drop in size-guard order if budget exceeded).
  if (Array.isArray(card.tags) && card.tags.length) {
    trimmed.tags = card.tags
      .slice(0, 10)
      .map((t: any) => String(t).slice(0, 32));
  }
  if (card.matchFactors && typeof card.matchFactors === 'object') {
    const mf = card.matchFactors;
    trimmed.matchFactors = {
      location: Number(mf.location) || 0,
      budget: Number(mf.budget) || 0,
      category: Number(mf.category) || 0,
      time: Number(mf.time) || 0,
      popularity: Number(mf.popularity) || 0,
    };
  }
  if (card.socialStats && typeof card.socialStats === 'object') {
    const ss = card.socialStats;
    trimmed.socialStats = {
      views: Number(ss.views) || 0,
      likes: Number(ss.likes) || 0,
      saves: Number(ss.saves) || 0,
      shares: Number(ss.shares) || 0,
    };
  }
  if (typeof card.phone === 'string' && card.phone.length > 0) trimmed.phone = card.phone;
  if (typeof card.website === 'string' && card.website.length > 0) trimmed.website = card.website;
  if (card.openingHours !== undefined && card.openingHours !== null) {
    // openingHours has multiple legacy shapes; preserve as-is; size guard handles bloat.
    trimmed.openingHours = card.openingHours;
  }
  if (card.selectedDateTime instanceof Date) {
    trimmed.selectedDateTime = card.selectedDateTime.toISOString();
  } else if (typeof card.selectedDateTime === 'string' && card.selectedDateTime.length > 0) {
    trimmed.selectedDateTime = card.selectedDateTime;
  }

  // [ORCH-0667 v1 fields — preserved]
  if (Array.isArray(card.images) && card.images.length) {
    trimmed.images = card.images.slice(0, 6);
  }
  if (typeof card.rating === 'number') trimmed.rating = card.rating;
  if (typeof card.reviewCount === 'number') trimmed.reviewCount = card.reviewCount;
  if (card.priceRange) trimmed.priceRange = card.priceRange;
  if (card.address) trimmed.address = card.address;
  if (card.description) {
    trimmed.description = String(card.description).slice(0, 500);
  }
  if (Array.isArray(card.highlights) && card.highlights.length) {
    trimmed.highlights = card.highlights
      .slice(0, 5)
      .map((h: any) => String(h).slice(0, 80));
  }
  if (typeof card.matchScore === 'number') trimmed.matchScore = card.matchScore;

  // [ORCH-0685 §6.3] Size guard — drop optional fields in reverse priority if over budget.
  // Order: drop the heaviest, lowest-render-priority fields first.
  // 'location', 'placeId', 'categoryIcon' are NOT in dropOrder — they unlock 3 modal sections.
  const dropOrder: (keyof CardPayload)[] = [
    'matchFactors',  // never rendered today (D-5 forward-positioned)
    'socialStats',   // never rendered today (D-5 forward-positioned)
    'tags',          // CardInfoSection chips — graceful empty
    'openingHours',  // expander — graceful hide
    'highlights',    // never rendered today (D-5 forward-positioned)
    'description',   // body — graceful empty
    'images',        // carousel — falls back to single image
    'address',       // displays empty
  ];
  let size = JSON.stringify(trimmed).length;
  for (const key of dropOrder) {
    if (size <= 5120) break;
    delete trimmed[key];
    size = JSON.stringify(trimmed).length;
  }

  return trimmed;
}
```

### 6.4 Forbidden-field guard (manual + CI-gated)

The trim function above does NOT contain any extraction of `travelTime`, `travelTimeMin`, `distance`, `distanceKm`, or `distance_km`. The CI gate in §15 enforces this structurally — any future edit that adds such an extraction fails the gate.

---

## 7. Layer 2 — Service

**Path:** [app-mobile/src/services/messagingService.ts](../../app-mobile/src/services/messagingService.ts)

### 7.1 No `sendCardMessage` change

The existing `sendCardMessage` ([messagingService.ts:583-620](../../app-mobile/src/services/messagingService.ts#L583-L620)) calls `trimCardPayload(card)` and inserts the trimmed payload. With the v2 trim function, the inserted JSON is the new richer shape. No edit needed to `sendCardMessage`.

### 7.2 No `enrichMessage` / realtime change

`enrichMessage` returns `{...message}` — `card_payload` field is included via spread. Realtime subscription propagates the full row. No edit.

### 7.3 No `transformMessage` change

[ConnectionsPage.tsx:947-966](../../app-mobile/src/components/ConnectionsPage.tsx#L947-L966) propagates `cardPayload: msg.card_payload`. The widened JSONB flows through unchanged.

### 7.4 New helper: `cardPayloadToExpandedCardData`

**Path:** new file `app-mobile/src/services/cardPayloadAdapter.ts` (or appended to `messagingService.ts` — implementor picks; recommend separate file for testability).

```typescript
/**
 * ORCH-0685 §7.4: typed converter from CardPayload (chat-share snapshot)
 * to ExpandedCardData (the modal's expected input).
 *
 * Replaces the unsafe `as unknown as ExpandedCardData` cast at
 * [MessageInterface.tsx:942-948] (Constitution #12 fix).
 *
 * Fields not carried in CardPayload are filled with null-safe defaults that
 * let ExpandedCardModal render its sections honestly:
 *   - distance, travelTime: null (Constitution #9 — never fabricate from sender)
 *   - tags: [] (CardInfoSection renders empty tag row gracefully)
 *   - matchFactors, socialStats: null/empty (modal does not render today;
 *     forward-positioned per D-5 deferral)
 *   - fullDescription: falls back to description
 *   - strollData, picnicData, nightOutData, cardType: undefined
 *     (modal's regular layout is reached for chat-shared cards)
 */
import type { CardPayload } from './messagingService';
import type { ExpandedCardData } from '../types/expandedCardTypes';

export function cardPayloadToExpandedCardData(p: CardPayload): ExpandedCardData {
  return {
    id: p.id,
    title: p.title,
    category: p.category ?? '',
    categoryIcon: p.categoryIcon ?? '',  // ExpandedCardModal:1781 falls back to getCategoryIcon(category) when empty per §10.1
    description: p.description ?? '',
    fullDescription: p.description ?? '',  // CardPayload only carries one description; reuse for both
    image: p.image ?? '',
    images: p.images ?? (p.image ? [p.image] : []),
    rating: p.rating ?? 0,
    reviewCount: p.reviewCount ?? 0,
    priceRange: p.priceRange,                       // optional in ExpandedCardData
    distance: null,                                 // Constitution #9 — recipient-relative
    travelTime: null,                               // Constitution #9 — recipient-relative
    travelMode: undefined,
    address: p.address ?? '',
    openingHours: p.openingHours ?? null,
    phone: p.phone,
    website: p.website,
    highlights: p.highlights ?? [],
    tags: p.tags ?? [],
    matchScore: p.matchScore ?? 0,
    matchFactors: p.matchFactors ?? { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: p.socialStats ?? { views: 0, likes: 0, saves: 0, shares: 0 },
    location: p.location,
    selectedDateTime: p.selectedDateTime ? new Date(p.selectedDateTime) : undefined,
    placeId: p.placeId,
    // strollData, picnicData, nightOutData, cardType, stops, tagline, totalPriceMin/Max,
    // estimatedDurationMinutes, pairingKey, experienceType, priceTier, tip, shoppingList
    // are intentionally undefined — chat-shared cards render the regular layout per §2.2.
  };
}
```

**Type contract verification:** the function returns `ExpandedCardData` typed strictly. TypeScript will refuse to compile if any required field is missing or typed wrong. This restores Constitution #12 validation that the unsafe cast bypassed.

**Note on `socialStats.shares`:** ExpandedCardData declares `shares` required ([expandedCardTypes.ts:66](../../app-mobile/src/types/expandedCardTypes.ts#L66)) but the v2 `CardPayload.socialStats` does NOT carry `shares` (see §6.1 — only `views`, `likes`, `saves`). The default-fill above adds `shares: 0` when populating from CardPayload. Implementor MAY widen `CardPayload.socialStats` to include `shares?: number` if a saved card carries it; otherwise this default is correct.

---

## 8. Layer 3 — Hook

**No new hook. No hook change.**

`useSavedCards` continues to power the picker. Save handler (§9.4) calls `savedCardsService.saveCard` directly without React Query mutation wrapper because (a) the modal does not display the user's saved-cards count anywhere that needs invalidation, (b) `saveCard` already records userActivity + increment_place_engagement RPCs, (c) the saved-card cache invalidation, if needed for any future surface, can be handled by an explicit `queryClient.invalidateQueries({ queryKey: savedCardKeys.list(userId) })` call within the handler — implementor adds this if the recipient's saved-cards screen is reachable from the chat in the same session (recommended).

**Implementor MUST verify** in IMPL STEP X table whether `useSavedCards`'s `staleTime: 5 * 60 * 1000` would mask a fresh save from the recipient's saved-cards screen if they navigate there immediately. If yes, add `queryClient.invalidateQueries(savedCardKeys.list(currentUserId))` in the handler.

---

## 9. Layer 4 — Component (MessageInterface.tsx)

### 9.1 Imports added

At the top of [app-mobile/src/components/MessageInterface.tsx](../../app-mobile/src/components/MessageInterface.tsx):

```typescript
// ORCH-0685: Save handler + typed cast helper
import { savedCardsService } from '../services/savedCardsService';
import { cardPayloadToExpandedCardData } from '../services/cardPayloadAdapter';
// Note: showNotification and useTranslation hook are already imported in v1.
// useQueryClient may need to be added if §8 invalidation is wired:
// import { useQueryClient } from '@tanstack/react-query';
// import { savedCardKeys } from '../hooks/queryKeys'; // adjust path per project key factory
```

### 9.2 New state (add near `:185-186` `showSavedCardPicker`)

```typescript
// ORCH-0685: Save handler state
const [isSavingSharedCard, setIsSavingSharedCard] = useState(false);
const [sharedCardIsSaved, setSharedCardIsSaved] = useState(false);
```

`sharedCardIsSaved` resets to `false` when the modal closes (handled in §9.5 `onClose`).

### 9.3 Cast site cleanup at line 942-948

Replace:

```typescript
onCardBubbleTap={(payload) => {
  setExpandedCardFromChat(payload as unknown as ExpandedCardData);
  setShowExpandedCardFromChat(true);
}}
```

With:

```typescript
onCardBubbleTap={(payload) => {
  setExpandedCardFromChat(cardPayloadToExpandedCardData(payload));
  setShowExpandedCardFromChat(true);
  setSharedCardIsSaved(false);  // fresh modal session
}}
```

### 9.4 Save handler implementation

Add near §9.2 state (e.g., after `handleSelectCardToShare`):

```typescript
/**
 * ORCH-0685 §9.4: Real Save handler for chat-mounted ExpandedCardModal.
 * Replaces the no-op at MessageInterface.tsx:1387 (CF-2 dead-tap fix).
 *
 * Behavior:
 *   - Loading: button disabled while saving (via isSavingSharedCard).
 *   - Success: button transitions to "Saved" state via sharedCardIsSaved
 *     (passed as isSaved prop on <ExpandedCardModal>). Optional success toast.
 *   - Already-saved: savedCardsService.saveCard handles 23505 silently
 *     (idempotent upsert). Treated as success — UI transitions to "Saved".
 *   - Error: error toast surfaces. sharedCardIsSaved stays false.
 *   - Constitution #1: every tap produces real feedback.
 *   - Constitution #3: errors surface, never swallowed.
 */
const handleSaveSharedCard = async (cardData: ExpandedCardData): Promise<void> => {
  if (isSavingSharedCard || sharedCardIsSaved) return;  // double-tap + already-saved guard

  if (!currentUserId) {
    showNotification(
      t('chat:cardSaveFailedTitle'),
      t('chat:cardSaveFailedToast'),
      'error',
    );
    return;
  }

  setIsSavingSharedCard(true);
  try {
    // savedCardsService.saveCard accepts SavedCardModel-shaped object with id+title+category+image+matchScore.
    // ExpandedCardData carries all of these. Pass directly.
    await savedCardsService.saveCard(currentUserId, cardData, 'solo');
    setSharedCardIsSaved(true);
    showNotification(
      t('chat:cardSavedTitle'),
      t('chat:cardSavedToast'),
      'success',
    );
    // Optional: trigger haptic feedback here per existing app pattern (implementor matches).
  } catch (error: any) {
    console.error('[ORCH-0685] Save shared card failed:', error);
    showNotification(
      t('chat:cardSaveFailedTitle'),
      t('chat:cardSaveFailedToast'),
      'error',
    );
  } finally {
    setIsSavingSharedCard(false);
  }
};
```

### 9.5 `<ExpandedCardModal>` mount changes (lines 1378-1389)

Replace:

```tsx
{showExpandedCardFromChat && expandedCardFromChat && (
  <ExpandedCardModal
    visible={showExpandedCardFromChat}
    card={expandedCardFromChat}
    onClose={() => {
      setShowExpandedCardFromChat(false);
      setExpandedCardFromChat(null);
    }}
    onSave={async () => { /* no-op in chat-mounted modal */ }}
    currentMode="solo"
  />
)}
```

With:

```tsx
{showExpandedCardFromChat && expandedCardFromChat && (
  <ExpandedCardModal
    visible={showExpandedCardFromChat}
    card={expandedCardFromChat}
    onClose={() => {
      setShowExpandedCardFromChat(false);
      setExpandedCardFromChat(null);
      setSharedCardIsSaved(false);  // fresh state on next open
    }}
    onSave={handleSaveSharedCard}
    isSaved={sharedCardIsSaved}
    currentMode="solo"
  />
)}
```

`currentMode="solo"` retained per DEC-4 D-7 deferral.

---

## 10. Layer 4 — Component (ExpandedCardModal.tsx)

### 10.1 `categoryIcon` fallback at line 1781

**Imports (top of file):** add

```typescript
import { getCategoryIcon } from '../utils/categoryUtils';
```

**Replace line 1781:**

```tsx
categoryIcon={card.categoryIcon}
```

with:

```tsx
categoryIcon={card.categoryIcon || getCategoryIcon(card.category)}
```

**Why `||` not `??`:** the v1 forensics confirmed `card.categoryIcon` may be the empty string `""` from the cast helper (§7.4 default `?? ''`). `??` would treat `""` as truthy and skip the fallback. `||` correctly treats `""` as falsy and computes the fallback. **Implementor confirms via spec-driven test T-07.**

### 10.2 Sub-component category-prop wraps (defense-in-depth, DEC-3b)

**Imports (top of file, if not already):** add

```typescript
import { getReadableCategoryName } from '../utils/categoryUtils';
```

**Replace [line 1874](../../app-mobile/src/components/ExpandedCardModal.tsx#L1874):**

```tsx
category={card.category}
```

with:

```tsx
category={getReadableCategoryName(card.category)}
```

**Replace [line 1994](../../app-mobile/src/components/ExpandedCardModal.tsx#L1994):**

```tsx
category={card.category}
```

with:

```tsx
category={getReadableCategoryName(card.category)}
```

**Replace [line 2008](../../app-mobile/src/components/ExpandedCardModal.tsx#L2008):**

```tsx
category={card.category}
```

with:

```tsx
category={getReadableCategoryName(card.category)}
```

**DO NOT change** the control-flow uses of `card.category` at lines 1328, 1370, 1387, 1405-1409, 1456, 1505-1506, 1510 — those are slug comparisons / API call inputs, NOT user renders. Wrapping them would break behavior (e.g., busynessService API may expect raw slug not localized label).

**DO NOT change** [line 1780](../../app-mobile/src/components/ExpandedCardModal.tsx#L1780) `<CardInfoSection category={card.category}>` — `CardInfoSection` already calls `getReadableCategoryName` internally at line 120 (verified). Double-wrapping would pass an already-translated label into the helper, which would fall through the legacy slug map (no match) and hit the title-case fallback — graceful but redundant. Leave as-is.

**Implementor STATIC CHECK before edit:** confirm via grep that `WeatherSection` and `TimelineSection` do NOT internally call `getReadableCategoryName` on the `category` prop. If they do (introduced by parallel work after v2 forensics ran), then double-wrapping is the same redundancy issue — implementor decides whether to keep or remove the modal-level wrap. Spec preference: **wrap at modal level for defense-in-depth**, since the modal is the single truth and sub-components may be reused elsewhere.

### 10.3 No other changes

- Do NOT add `MatchFactorsBreakdown` render — D-4 deferred.
- Do NOT add render sites for `reviewCount`, `highlights`, `fullDescription`, `socialStats` — D-5 deferred.
- Do NOT change stroll/picnic detection — D-6 deferred.
- Do NOT change `currentMode` handling — D-7 deferred unless implementor judges trivial.
- Do NOT change `BusynessSection` — D-9 deferred.

---

## 11. Layer 7 — i18n

### 11.1 Locale audit (DEC-3a)

**Required keys per locale `common.json` (12 minimum, 14 recommended):**

| Key | Type | Notes |
|-----|------|-------|
| `category_nature` | required | 10 visible canonical |
| `category_icebreakers` | required | |
| `category_drinks_and_music` | required | |
| `category_brunch` | required | |
| `category_casual_food` | required | |
| `category_upscale_fine_dining` | required | |
| `category_movies` | required | |
| `category_theatre` | required | |
| `category_creative_arts` | required | |
| `category_play` | required | |
| `category_brunch_lunch_casual` | required | legacy bundle, still resolved by `getReadableCategoryName` |
| `category_movies_theatre` | required | legacy bundle |
| `category_nature_views` | recommended | en alias for `category_nature`; some locales may have both |
| `category_flowers` | recommended | hidden category but harmless to translate; en has it |

**29 locales total:** `ar, bin, bn, de, el, en, es, fr, ha, he, hi, id, ig, it, ja, ko, ms, nl, pl, pt, ro, ru, sv, th, tr, uk, vi, yo, zh`.

**Current state (v2 forensics partial audit):**
- `en/common.json` — 23 `category_*` keys (full + duplicates)
- `es/common.json` — 23 keys (full)
- `fr/common.json` — **13 keys (gap)**
- 26 other locales — **unaudited**

**Implementor procedure:**

1. For each of 29 locales, grep `common.json` for `category_*`.
2. List missing keys per locale.
3. Fill missing keys via machine translation (matches existing pattern per [SPEC_ORCH-0667 §12.3](SPEC_ORCH-0667_SHARE_SAVED_CARD.md)). Use the canonical English values from `en/common.json` as the source.
4. Document the gap-fill in the implementation report (file × key matrix).

### 11.2 New i18n keys for Save toasts (DEC-2)

Add to `en/chat.json` (and machine-translate to 28 other locales):

```json
{
  "cardSavedTitle": "Saved",
  "cardSavedToast": "Card saved to your collection.",
  "cardSaveFailedTitle": "Couldn't save",
  "cardSaveFailedToast": "Couldn't save. Tap to try again."
}
```

Existing `chat:cardSendingTitle` etc. patterns are preserved. No deletions.

### 11.3 Translation propagation

Same pattern as ORCH-0667 §12.3 — machine translation acceptable. Spec writer does not require native-speaker review for v1 ship; can be a hardening pass post-CLOSE if the user surfaces a translation quality concern.

---

## 12. Invariants

### 12.1 New invariant — `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS`

```
ID:        I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS
Category:  Constitution #9 (no fabricated data)
Origin:    ORCH-0685 §6.4 + §15.1 (codifies ORCH-0659/0660 lesson at the
           CardPayload trim boundary)
Statement: trimCardPayload (in app-mobile/src/services/messagingService.ts)
           MUST NEVER extract or persist any of the following fields into
           the trimmed payload: travelTime, travelTimeMin, distance,
           distanceKm, distance_km. These are recipient-relative —
           sender's value would fabricate for the recipient.
CI gate:   scripts/ci-check-invariants.sh §I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS
           greps the body of trimCardPayload for the forbidden field names
           and FAILS the build if any match.
Test:      T-10 (success criterion SC-10)
Comment:   See trimCardPayload docstring for rationale + ORCH-0659/0660
           cross-ref.
```

### 12.2 Preserved invariants

| ID | How preserved |
|----|---------------|
| **I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS** (ORCH-0667) | Required fields `{id, title, category, image}` never dropped — v2 trim function preserves this guarantee in §6.3. |
| **I-DM-PARTICIPANTS-ONLY** (RLS) | No policy change. |
| **I-MESSAGE-IMMUTABILITY** | No UPDATE on card messages. |
| **Constitution #1** (no dead taps) | CF-2 fixed — Save button has real handler with all 4 states. SC-2..SC-5. |
| **Constitution #2** (one owner per truth) | CardPayload remains single shape for chat-shared cards. ExpandedCardModal remains single render. No duplication. |
| **Constitution #3** (no silent failures) | Save errors surface as toasts. SC-4, SC-5. Locale-fallback path in `getReadableCategoryName` already surfaces gracefully — preserved. |
| **Constitution #4** (one query key per entity) | Optional `queryClient.invalidateQueries(savedCardKeys.list(userId))` per §8 implementor note — uses existing factory. |
| **Constitution #8** (subtract before adding) | Unsafe cast at MessageInterface.tsx:942-948 REMOVED before adding the typed helper. No-op `onSave` REMOVED before adding the real handler. |
| **Constitution #9** (no fabricated data) | New invariant I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS structurally enforces. SC-10. |
| **Constitution #12** (validate at the right time) | Typed cast helper restores TypeScript type-checking that the `as unknown as` bypassed. SC-9 implicitly verifies via tsc. |
| **Constitution #13** (exclusion consistency) | RLS unchanged; saveCard goes through user-auth supabase client (no service-role bypass). |

---

## 13. Success criteria (numbered, observable, testable)

| # | Criterion | Layer | Verifier |
|---|-----------|-------|----------|
| **SC-1** | Sender shares a card with full SavedCardModel data; recipient taps the bubble; modal renders with weather strip + busyness section + booking options + opening-hours expander all populated (location-gated sections fire, NOT skipped). | Full stack | Two-device manual smoke + Supabase logs showing weather/busyness/booking edge calls fired |
| **SC-2** | Recipient taps Save → button transitions to "Saved" state within 500ms → row inserted in `saved_card` table → success toast `cardSavedToast` shows. | Component + service + DB | Manual smoke + SQL probe |
| **SC-3** | Recipient taps Save twice in same modal session → first tap saves; second tap is no-op (button stays "Saved", no duplicate row, no second toast). | Component | Manual rapid-tap smoke + SQL count |
| **SC-4** | Save with network down → error toast `cardSaveFailedToast` surfaces; button stays "Save" (no false "Saved" transition); no row inserted. | Component + service | Network-kill smoke |
| **SC-5** | Save with RLS denial (e.g., simulated by force-mocking saveCard error) → error toast surfaces. | Component + service | Mocked-error unit test |
| **SC-6** | Category chip in `CardInfoSection` renders translated label ("Casual" not `casual_food`) in en, es, fr at minimum. After 29-locale audit, all 12 required `category_*` keys resolve in every locale. | Component + i18n | Per-locale render snapshot or grep on locale JSON |
| **SC-7** | Card with `categoryIcon` undefined OR empty string renders correct category-specific icon (computed via `getCategoryIcon(card.category)`), not the `"star"` fallback. | Component | Per-category render check |
| **SC-8** | `trimCardPayload(card)` for a typical chat-shareable card produces a payload ≤ 5120 bytes. | Service | Unit test |
| **SC-9** | `trimCardPayload(card)` for a maximum-fields card (all DEC-1 additions populated, all v1 optionals populated) stays ≤ 5120 bytes after the size guard's drop sequence. | Service | Unit test with fixtures |
| **SC-10** | `grep -E "(travelTime\|travelTimeMin\|distance\|distanceKm\|distance_km)" app-mobile/src/services/messagingService.ts` returns ZERO matches inside the body of `trimCardPayload`. **CI gate.** | CI | Bash grep + line-range filter |
| **SC-11** | Sender + recipient open the same shared card; ExpandedCardModal renders identically (modulo recipient-relative fields which are intentionally null on both sides). Pixel-diff or section-presence diff < 5%. | Two-device | Two-device smoke |
| **SC-12** | A recipient running pre-fix mobile build (no v2 trim, no widened CardPayload reader) opens a v2 payload — bubble renders, modal opens, modal renders v1 fields it knows about, ignores new JSON keys without crash. | Forward-safety | Old-build device smoke |
| **SC-13** | All 29 locale `common.json` files contain all 12 required `category_*` keys (CI gate). | i18n | Bash grep + per-locale assert |
| **SC-14** | `WeatherSection`, `TimelineSection` × 2 prop sites in `ExpandedCardModal.tsx` pass the result of `getReadableCategoryName(card.category)`, not raw `card.category`. **CI gate** — grep for `category={card.category}` in lines 1860-2020 returns ZERO matches (after the §10.2 edits). | Component | Bash grep |
| **SC-15** | `ExpandedCardModal.tsx:1781` reads `card.categoryIcon \|\| getCategoryIcon(card.category)` (or equivalent). **CI gate** — grep for the literal pattern returns exactly 1 match. | Component | Bash grep |
| **SC-16** | TypeScript compilation (`pnpm tsc --noEmit` or equivalent) succeeds for `app-mobile/src/` after the edits — no new errors introduced. The unsafe `as unknown as ExpandedCardData` cast is removed; `cardPayloadToExpandedCardData` returns a strictly-typed ExpandedCardData. | Compile | tsc --noEmit |
| **SC-17** | The chat-mounted modal's `<ExpandedCardModal>` mount passes `isSaved={sharedCardIsSaved}` and `onSave={handleSaveSharedCard}` (verified via grep on `MessageInterface.tsx`). | Component | Bash grep |

---

## 14. Test cases

| # | Scenario | Input | Expected | Layer |
|---|----------|-------|----------|-------|
| **T-01** | Sender happy path | Sender shares a card with full data (location, placeId, image, rating, address, phone, website) | Recipient bubble appears within 1s; tap opens modal with all sections populated | Full stack |
| **T-02** | Recipient Save success | Recipient taps Save in modal | Row inserted in `saved_card` table; success toast; button transitions to "Saved" | Component + service + DB |
| **T-03** | Recipient Save idempotent | Recipient taps Save → already-saved card row exists | Service returns silently (23505 swallowed); UI still transitions to "Saved" | Service + DB |
| **T-04** | Save network failure | Network killed mid-save | Error toast fires; button stays "Save"; no row | Component + service |
| **T-05** | Save RLS-denied (mocked) | Force `saveCard` to throw an RLS error | Error toast surfaces | Component + service |
| **T-06** | Save double-tap guard | Tap Save twice within 100ms | Only ONE saveCard call (verified via spy); button transitions once | Component |
| **T-07** | categoryIcon fallback | Card with `categoryIcon=undefined` and `category='casual_food'` | Modal renders the food/utensils icon, not the `"star"` default | Component |
| **T-08** | trimCardPayload size guard (typical) | Card with all v1 fields + DEC-1 additions populated typically | Payload ≤ 5120 bytes; no field dropped | Service unit test |
| **T-09** | trimCardPayload size guard (worst case) | Card with maximum-length description, 6 images, all DEC-1 fields | Payload ≤ 5120 bytes after drop sequence; required + DEC-1-hard fields intact | Service unit test |
| **T-10** | Forbidden-field gate (CI) | Implementor introduces `trimmed.travelTime = card.travelTime` in trim function | CI gate fails with file:line + invariant ID | CI |
| **T-11** | Two-device symmetry | Sender (iOS) + recipient (Android) on same conversation; sender shares; both tap bubble | Both modals render identical sections (recipient-relative fields null on both, same image, same translated category, same weather/busyness/booking sections) | Two-device |
| **T-12** | Old-build forward-safety | Recipient on pre-fix mobile build receives v2 payload | Bubble renders; tapping opens modal (with whatever fields the old code reads); no crash | Forward-safety |
| **T-13** | Locale parity (en/es/fr) | Open modal with card category `casual_food`; locale switched to en/es/fr | Translated label renders ("Casual" / "Comida casual" / "Décontracté" or whichever the locale defines) | i18n |
| **T-14** | Locale parity (29-locale CI) | Run `scripts/ci-check-invariants.sh` | All 29 locale `common.json` files contain all 12 required keys; gate passes | CI |
| **T-15** | Sub-component category wrap | Open modal with card containing a stroll-categorized SavedCard via the chat-shared path | TimelineSection receives translated label (verified via React DevTools or test render) | Component |
| **T-16** | Cast helper type contract | Pass a malformed CardPayload (e.g., missing `id`) to `cardPayloadToExpandedCardData` | TypeScript refuses to compile (compile-time guarantee — runtime test is N/A) | Compile |
| **T-17** | Modal close resets state | Open modal, save card, close modal, reopen with different card | `sharedCardIsSaved` resets to false; second save fires | Component |
| **T-18** | Push notification regression | Sender shares card → recipient receives OneSignal push | Push body unchanged from v1 (`🔖 ${cardTitle}`); SC-7 of ORCH-0667 holds | Edge fn + push |
| **T-19** | Realtime delivery regression | Recipient is in the conversation when sender shares | Bubble appears within 1s via realtime subscription | Realtime |
| **T-20** | Picker regression | Sender uses share picker (out of scope but sanity-check) | Picker still works; subtitle still shows raw `card.category` (accepted by user) | Component |

---

## 15. CI gates

Add to [scripts/ci-check-invariants.sh](../../scripts/ci-check-invariants.sh) before the final FAIL check:

```bash
# ──────────────────────────────────────────────────────────────────────────
# I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS  (ORCH-0685 §12.1)
# trimCardPayload MUST NEVER extract recipient-relative fields.
# ──────────────────────────────────────────────────────────────────────────
TRIM_BODY=$(awk '/export function trimCardPayload/,/^\}/' app-mobile/src/services/messagingService.ts)
if echo "$TRIM_BODY" | grep -E "(travelTime|travelTimeMin|distance|distanceKm|distance_km)" > /dev/null; then
  echo "ERROR: ORCH-0685 — trimCardPayload extracts a recipient-relative field. Constitution #9 violation."
  echo "Forbidden fields: travelTime, travelTimeMin, distance, distanceKm, distance_km."
  echo "Cross-ref: ORCH-0659/0660 + INVARIANT_REGISTRY.md I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS."
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────
# I-LOCALE-CATEGORY-PARITY  (ORCH-0685 §11.1)
# Every locale's common.json MUST contain all 12 required category_* keys.
# ──────────────────────────────────────────────────────────────────────────
REQUIRED_CATEGORY_KEYS=(
  "category_nature"
  "category_icebreakers"
  "category_drinks_and_music"
  "category_brunch"
  "category_casual_food"
  "category_upscale_fine_dining"
  "category_movies"
  "category_theatre"
  "category_creative_arts"
  "category_play"
  "category_brunch_lunch_casual"
  "category_movies_theatre"
)
LOCALE_PARITY_FAIL=0
for locale_dir in app-mobile/src/i18n/locales/*/; do
  locale=$(basename "$locale_dir")
  common_json="${locale_dir}common.json"
  if [ ! -f "$common_json" ]; then
    echo "ERROR: ORCH-0685 — missing $common_json"
    LOCALE_PARITY_FAIL=1
    continue
  fi
  for key in "${REQUIRED_CATEGORY_KEYS[@]}"; do
    if ! grep -q "\"$key\"" "$common_json"; then
      echo "ERROR: ORCH-0685 — locale '$locale' missing key '$key' in common.json"
      LOCALE_PARITY_FAIL=1
    fi
  done
done
if [ "$LOCALE_PARITY_FAIL" -ne 0 ]; then
  echo "Cross-ref: ORCH-0685 §11.1 + INVARIANT_REGISTRY.md I-LOCALE-CATEGORY-PARITY."
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────
# I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS  (ORCH-0685 §10.2)
# Sub-component category props in ExpandedCardModal MUST be wrapped with getReadableCategoryName.
# Lines 1860-2020 cover WeatherSection + 2x TimelineSection prop sites (post-edit).
# ──────────────────────────────────────────────────────────────────────────
RAW_CATEGORY_PROPS=$(sed -n '1860,2020p' app-mobile/src/components/ExpandedCardModal.tsx | grep -cE 'category=\{card\.category\}' || true)
if [ "$RAW_CATEGORY_PROPS" -ne 0 ]; then
  echo "ERROR: ORCH-0685 §10.2 — found $RAW_CATEGORY_PROPS raw 'category={card.category}' prop site(s) in ExpandedCardModal.tsx lines 1860-2020."
  echo "All sub-component category props in this range MUST be wrapped: category={getReadableCategoryName(card.category)}."
  exit 1
fi
```

**Note:** the `awk` body extractor in the first gate is fragile (depends on `^}` closing brace). Implementor MAY substitute a more robust line-range extractor (e.g., parse `BEGIN { in_fn=0 } /^export function trimCardPayload/{in_fn=1} in_fn{print} /^}$/{if(in_fn) exit}`). Spec is permissive on the exact bash; the failure mode (any forbidden-field match in trim body → fail) must hold.

---

## 16. Implementation order (numbered)

Each step lists files touched + what to verify before moving to the next.

1. **Create cast helper** — new file `app-mobile/src/services/cardPayloadAdapter.ts` with `cardPayloadToExpandedCardData` per §7.4. Run `pnpm tsc --noEmit` to confirm strict-mode passes (no `any`, no missing required field). [+1 file, ~50 lines]

2. **Widen `CardPayload` interface** — replace [messagingService.ts:6-28](../../app-mobile/src/services/messagingService.ts#L6-L28) with §6.1 verbatim. Run `pnpm tsc --noEmit` — expect new errors at consumer sites (good; we fix them in step 3). [+1 file edited, ~70 net lines]

3. **Update `trimCardPayload`** — replace [messagingService.ts:53-88](../../app-mobile/src/services/messagingService.ts#L53-L88) with §6.3 verbatim. Run unit tests (T-08 + T-09) — expect ≤ 5120 bytes for both fixtures. [+1 file edited, ~100 net lines]

4. **Add Save handler + state in MessageInterface.tsx** — add §9.1 imports, §9.2 state, §9.4 handler. [+1 file edited, ~50 net lines]

5. **Replace cast site at lines 942-948** — apply §9.3 verbatim. [+0 net lines, 4 lines changed]

6. **Replace `<ExpandedCardModal>` mount at lines 1378-1389** — apply §9.5 verbatim. [+2 net lines]

7. **Update `ExpandedCardModal.tsx` imports + line 1781** — apply §10.1. Add `getCategoryIcon`, change line 1781 fallback. [+1 line import, ~1 line changed]

8. **Update `ExpandedCardModal.tsx` lines 1874, 1994, 2008** — apply §10.2 verbatim. Add `getReadableCategoryName` import if not already present. [+1 line import (if needed), 3 lines changed]

9. **i18n: add new chat keys** — add §11.2 4 new keys to `app-mobile/src/i18n/locales/en/chat.json`. Machine-translate to other 28 locale `chat.json` files. [+29 files edited, ~4 keys × 29 = ~116 lines added]

10. **i18n: locale category-key audit + fill** — for each of 29 locales, grep `common.json` for the 12 required `category_*` keys. Fill missing via machine translation matching existing pattern. [Up to 29 files edited; expected: fr + ~25 unaudited locales need fills; en + es + zh need none]

11. **Register new invariant** — add `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` to [Mingla_Artifacts/INVARIANT_REGISTRY.md](../INVARIANT_REGISTRY.md) per §12.1 verbatim. Add `I-LOCALE-CATEGORY-PARITY` and `I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS` (informational, CI-gated). [+1 file edited, ~30 lines]

12. **IMPL STEP X — field-shape verification documentation (MANDATORY).** Implementor produces a row-by-row verification table in the implementation report mapping every `card.<field>` read site in `ExpandedCardModal.tsx` to its disposition (widened in CardPayload v2 / null-safe-default in cast helper / out-of-scope per §2.2 / forbidden per §6.4). The table must enumerate at least 30 fields covering everything in the v2 forensics report's §5 inventory. **This step is the ORCH-0685 mitigation for the IMPL step 7c skip class — do NOT mark the implementation complete without this section.**

13. **Add CI gates** — add §15 verbatim to [scripts/ci-check-invariants.sh](../../scripts/ci-check-invariants.sh). Run the script locally — confirm all three new gates pass post-edit and the existing gates still pass. [+1 file edited, ~70 lines]

14. **TypeScript compile check** — run `pnpm tsc --noEmit` against `app-mobile/`. Expect zero new errors (existing baseline errors per ORCH-0680 are acceptable).

15. **Manual two-device smoke matrix:**
    - T-01 (sender happy path)
    - T-02 (recipient Save success)
    - T-03 (Save idempotent)
    - T-07 (categoryIcon fallback)
    - T-11 (sender+recipient symmetry)
    - T-13 (locale parity en/es/fr)
    - T-19 (realtime delivery regression)

16. **Old-build forward-safety check** — install pre-fix build on a third device, share v2 payload from a fixed device, confirm no crash (T-12).

17. **Implementation report** — write to `Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md`. Include §A spec compliance crosswalk, §B file-by-file changes, §C IMPL STEP X verification table (per step 12 above), §D unit test results, §E manual smoke matrix outcomes, §F any deferred discoveries, §G commit message draft. **No Co-Authored-By line** per memory rule.

---

## 17. Regression prevention

**Class of bug being fixed:** unsafe field-shape assumption between two TypeScript types crossed at runtime via `as unknown as` cast (the IMPL step 7c skip pattern); silent-skip rendering for absent fields without empty-state surfacing; recipient-relative fabrication risk at the trim boundary.

| Mechanism | Implementation |
|-----------|----------------|
| **Structural safeguard 1** | Typed cast helper `cardPayloadToExpandedCardData` replaces unsafe `as unknown as`. TypeScript validates field-shape at compile time; missing required field = compile error. Constitution #12 restored. |
| **Structural safeguard 2** | CI gate `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` blocks reintroduction of `travelTime`/`distance` extractions in `trimCardPayload`. Failure surfaces with file:line + invariant ID. |
| **Structural safeguard 3** | CI gate `I-LOCALE-CATEGORY-PARITY` blocks new locales from being added without the 12 required keys. |
| **Structural safeguard 4** | CI gate `I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS` blocks future maintainer from removing the `getReadableCategoryName` wrapper at modal sub-component prop sites. |
| **Test catches recurrence** | T-09 (max-fields size guard); T-10 (forbidden-field gate); T-14 (locale parity); SC-15 (categoryIcon fallback grep); SC-16 (tsc compile). |
| **Protective comments** | Verbatim docstrings at top of `CardPayload` interface (§6.1), `trimCardPayload` body (§6.3), `cardPayloadToExpandedCardData` (§7.4), and `handleSaveSharedCard` (§9.4) — each names the cross-referenced ORCH (0659/0660/0667/0685) and rationale. |
| **Spec lock-in** | This SPEC document remains in `Mingla_Artifacts/specs/` as the binding contract. Future revisits cite this spec. |
| **IMPL STEP X institutional memory** | Step 12 of §16 is the ORCH-0685 in-spec response to D-8 (program-level process invariant). The implementor MUST produce the field-shape verification table; orchestrator REVIEW gates the closure on this table's existence. |

---

## 18. Discoveries register (carry-forward)

| ID | Title | Action |
|----|-------|--------|
| **ORCH-0685.D-1** | Picker preview row impoverishment (v1 forensics) | Closed — user accepted as fine. |
| **ORCH-0685.D-2** | Locale parity audit (v1 forensics carryover) | **BUNDLED** into this spec §11.1. |
| **ORCH-0685.D-3** | `category_groceries` missing in en/common.json | Closed — user confirmed groceries cards never reach the share flow. |
| **ORCH-0685.D-4** | `MatchFactorsBreakdown` imported but never rendered (v2 forensics HF-1) | **DEFER** — file post-CLOSE as cleanup ORCH (S2). |
| **ORCH-0685.D-5** | Dead reads of `reviewCount`/`highlights`/`fullDescription`/`socialStats` (v2 forensics HF-2) | **DEFER** — same cleanup ORCH. |
| **ORCH-0685.D-6** | Stroll/picnic detection uses legacy display names (v2 forensics CF-3) | **DEFER** — separate ORCH for category-detection-modernization (S2). |
| **ORCH-0685.D-7** | `currentMode` hardcoded `"solo"` in chat-mounted modal (v2 forensics OBS-4) | **DEFER** — separate ORCH unless implementor judges trivial inline (≤3 lines). |
| **ORCH-0685.D-8** | Process invariant proposal: implementation report MUST list every spec-mandated IMPL verification step | **ESCALATE program-level** — orchestrator follow-up. ORCH-0685 mitigates self via §16 step 12 ("IMPL STEP X"); the program-level invariant remains separate. |
| **ORCH-0685.D-9** | `BusynessSection` `\|\| "N/A"` literal preempt (v2 forensics HF-3) | **DEFER** — benign for chat-share path even after v2 widening; spec writer confirmed. |
| **ORCH-0685.D-10** | Locale parity audit (v1+v2 carryover) | **BUNDLED** as §11.1 — same as D-2. |

---

## 19. Acceptance checklist (orchestrator REVIEW)

This spec is APPROVED for IMPL dispatch when ALL items below PASS:

- [ ] §3 4 default-locks (DEC-1..DEC-4) explicitly stated and tied to user-bound steering
- [ ] §6.1 CardPayload v2 interface verbatim TypeScript with field-by-field justification table
- [ ] §6.3 trimCardPayload v2 verbatim TypeScript with explicit forbidden-field guard
- [ ] §7.4 cardPayloadToExpandedCardData verbatim TypeScript with type contract verification
- [ ] §9.4 handleSaveSharedCard verbatim with all 4 states (loading / success / already-saved / error)
- [ ] §9.5 `<ExpandedCardModal>` mount changes verbatim
- [ ] §10.1, §10.2 ExpandedCardModal touch sites cited with line numbers + verbatim diff direction (5 specific lines: 1781, 1874, 1994, 2008, plus imports)
- [ ] §11.1 locale parity gap fully enumerated (29 locales × 12 keys minimum)
- [ ] §11.2 new i18n chat keys defined verbatim
- [ ] §12.1 new invariant `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` defined with ID + statement + CI gate + test mapping
- [ ] §13 ≥15 success criteria (this spec has 17), all observable + testable + unambiguous
- [ ] §14 ≥15 test cases (this spec has 20) covering happy + error + edge + i18n + symmetry + forward-safety + regression
- [ ] §15 CI gates verbatim bash (3 gates added)
- [ ] §16 ≥12 implementation order steps (this spec has 17) including the **IMPL STEP X — field-shape verification documentation** mandatory step
- [ ] §17 regression prevention names structural safeguards + tests + protective comments + spec lock-in
- [ ] §18 discoveries register lists D-1 through D-10 with explicit action codes (BUNDLED / DEFER / ESCALATE / closed)
- [ ] No scope creep beyond §2.1
- [ ] All 4 default-locks (§3) are explicitly stated; any override has cited evidence
- [ ] Spec preserves Constitution #1 (Save dead-tap fix), #2, #3 (errors surface), #4, #8 (subtract before adding), #9 (recipient-relative forbidden), #12 (typed cast restores validation), #13
- [ ] Spec preserves invariant `I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS` from ORCH-0667
- [ ] No DB migration (§4 confirmed)
- [ ] No edge function change (§5 confirmed)
- [ ] No realtime change (§7.2 confirmed)
- [ ] No native module change (§2.2 confirmed; OTA-eligible)
