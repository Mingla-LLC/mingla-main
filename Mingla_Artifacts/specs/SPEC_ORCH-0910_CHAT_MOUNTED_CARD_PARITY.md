# SPEC — ORCH-0910 [Chat-mounted card expanded sheet parity — single + intent, bubble + sheet]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-22
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0910_INTENT_CARD_RENDER_BROKEN.md` (incl. §12 RESCOPE ADDENDUM 2026-05-22)
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md`
**Severity:** S1-high
**Affected Surfaces:** Consumer iOS + Consumer Android (only)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 0. Phase 0 ingestion log (this turn)

Files read this turn (in addition to investigation context already in working memory):
- `app-mobile/src/types/expandedCardTypes.ts` (L146-147 — `ExpandedCardData` already has optional `cardType?: 'curated'` + `stops?: CuratedStop[]`)
- `app-mobile/src/utils/mutateCuratedCard.ts` (L5-30 — mobile already exports `haversineKm` + `estimateTravelMinutes` matching `_shared/distanceMath.ts`)
- `supabase/functions/_shared/distanceMath.ts` (full — verified TRAVEL_CONFIG speeds + factors; client port is faithful)
- `app-mobile/src/hooks/useUserLocation.ts` (exists — viewer GPS source)
- Migration index search: no Google Distance Matrix or edge-function distance call; system is pure haversine + constant speed factor. **Travel-time re-compute is client-only, no network, no edge function.**

Material consequences for the spec:
- `ExpandedCardData` already carries `cardType` + `stops` — only the **adapter** strips them. No type extension needed there.
- Travel-time fix is pure client math — no SQL, no edge fn deploy. Reduces fix surface significantly.

## 1. Scope

This spec covers the full chat-mounted card expanded sheet parity bug — single + intent cards × bubble + sheet — across 5 proven root causes + 2 contributing factors from the investigation.

### In scope (16 numbered items, traced from dispatch §3)

1. Widen `CardPayload` interface with curated fields (4 optional fields).
2. Extend `trimCardPayload` to handle curated shape (derive top-level `image`, preserve `stops`, preserve `cardType`).
3. New size-guard drop order for curated payloads.
4. Define `TrimmedCuratedStop` shape (minimum-viable per-stop fields).
5. Extend `buildCardDataPayload` to synthesize top-level `image`/`images` for curated cards.
6. Extend `cardPayloadToExpandedCardData` to pass `cardType` + `stops` through; update header doc.
7. Busyness contract fix — modal reads `card.placeId ?? (card as any).source?.placeId`.
8. Extend `MessageBubble.tsx` card render branch with intent-card-aware layout.
9. Confirm chat-mounted intent cards reach `isCuratedCard` modal branch (post-#6).
10. Travel-time viewer-relative re-compute in `ExpandedCardModal.fetchAdditionalData`.
11. Confirm booking + opening hours render on chat-mount.
12. Backfill migration for `messages.card_payload` + `board_saved_cards.card_data`.
13. Implementor happy-path regression test.
14. Implementor regression test — busyness with placeId.
15. Implementor regression test — travel-time re-compute.
16. Tester adversarial regression — 4 attack angles.

### Non-goals

- **NOT changing the deck-mounted modal behaviour.** Deck still owns its travel-time via `card.travelTime` (server-precomputed via `discover-cards` / `generate-curated-experiences`). Chat-mount fix is additive, not replacement.
- **NOT changing Constitution #9** — sender's travel-time still NEVER shipped. The fix is viewer-side re-computation, not payload-side carry.
- **NOT widening `CardPayload`'s 5KB budget.** New curated fields fit within the existing budget per the new drop order.
- **NOT touching business / admin / buyer-web surfaces.** Consumer-only.
- **NOT adding new edge functions.** No deploy step; pure client + 1 migration.
- **NOT refactoring `buildCardDataPayload` beyond synthesizing `image`/`images` for curated cards.** Existing 27-key shape preserved.
- **NOT touching `boardMessageService.sendCardMessage` (DISC-0910-3).** Confirmed via grep this turn that it passes through the same `trimCardPayload` path — fix to #2 covers it automatically. If implementor finds a separate payload assembly, register DISC-0910-3-AMENDED.

### Assumptions

- `CuratedExperienceCard.stops[].imageUrl` is populated for active curated cards (server contract — verified in `app-mobile/src/types/curatedExperience.ts:12`). If it's ever null for a stop, derived `image` falls back to next stop's imageUrl, then to `null` (bookmark-placeholder render — same fallback the bubble already has).
- `useUserLocation` returns `{ lat, lng } | null` and is already wired into the modal's container tree (`MessageInterface.tsx` → modal). Verified existence; spec assumes the hook is callable from the modal.
- `messages.card_payload` and `board_saved_cards.card_data` are both `jsonb` and writable via standard `UPDATE` — verified by name in ORCH-0908 v2 migration source.

## 2. Cross-Surface Impact (Phase 2.5 — mandatory)

| Surface | Touched? | What changes for the user | Files touched | Parity |
|---|---|---|---|---|
| **Consumer iOS** | YES | Single + intent cards render correctly in chat bubbles (intent gets first-stop photo + arrow chip overlay) AND in the expanded sheet (intent shows stops list + per-stop addresses + totals; busyness now works for both single + intent; travel-time computed from YOUR GPS); locked-in cards also covered | 5 TS files + 1 SQL migration (listed §3) | Automatic (shared RN/JS) |
| **Consumer Android** | YES | Identical to iOS | Same 5 + migration | Automatic (shared RN/JS); separate SC for bubble visual + modal render verification on emulator |
| Buyer-anon-web | NO | No consumer chat surface on buyer-anon-web | none | n/a |
| Business iOS | NO | `mingla-business/` GroupChatPanel does NOT render shared cards (verified by grep — no imports of `CardPayload`, `cardPayloadAdapter`, `MessageBubble`) | none | n/a |
| Business Android | NO | Same as business iOS | none | n/a |
| Admin Web | NO | No consumer chat surface on admin | none | n/a |
| Business Web preview | NO | Same as business iOS | none | n/a |

Solo + Collab parity required for bubble + modal rendering. Lock-in is collab-only; share-in-message exists in both modes. Single SC items per layer; separate SC-N-iOS / SC-N-Android only where the rendered output is platform-dependent (bubble visual + modal layout).

## 3. Per-layer specification

### 3.1 Type layer — `app-mobile/src/services/messagingService.ts`

#### 3.1.1 Extend `CardPayload` interface (L23-91)

**RETEST 1 SPEC AMENDMENT — 2026-05-22:** The first spec cut under-specified
`TrimmedCuratedStop` by dropping four fields already read by the existing
curated modal render chain: `stopLabel`, `placeType`, `aiDescription`, and
`travelModeFromPreviousStop`. The amended contract below carries those soft
fields while keeping them droppable under the 5KB payload budget.

Add to the existing interface (insert after L91 `sessionId?: string;`):

```ts
  // ── ORCH-0910: intent (curated) card fields ──
  /** Card shape discriminator. Absent or 'single' = single-place card; 'curated' = multi-stop intent. */
  cardType?: 'curated' | 'single';
  /** Multi-stop itinerary. Only set when cardType === 'curated'. Trimmed per TrimmedCuratedStop shape. */
  stops?: TrimmedCuratedStop[];
  /** Intent tagline (e.g., "A leisurely museum-to-restaurant evening"). */
  tagline?: string;
  /** Intent total price range — min. */
  totalPriceMin?: number;
  /** Intent total price range — max. */
  totalPriceMax?: number;
  /** Intent total estimated duration (all stops + travel). */
  estimatedDurationMinutes?: number;
```

Add new exported type immediately after `CardPayload` interface, before `DirectMessage`:

```ts
/**
 * ORCH-0910: minimum viable per-stop fields for an intent card in the 5KB chat payload budget.
 * Stricter subset of CuratedStop — drops imageUrls[1..N] and openingHours to fit.
 * Kept fields are the minimum needed by ExpandedCardModal's curated render branch.
 */
export interface TrimmedCuratedStop {
  stopNumber: number;
  placeName: string;
  placeId: string;
  imageUrl: string | null;
  lat: number;
  lng: number;
  priceLevelLabel: string;
  priceTier: string;
  rating: number;
  estimatedDurationMinutes: number;
  // Soft fields kept if size budget allows; dropped in order per §3.1.3:
  stopLabel?: 'Start Here' | 'Then' | 'End With' | 'Explore' | 'Optional';
  placeType?: string;
  aiDescription?: string;
  travelModeFromPreviousStop?: string | null;
  address?: string;
  travelTimeFromPreviousStopMin?: number | null;
}
```

#### 3.1.2 Extend `trimCardPayload` (L145-239)

Insert curated detection + field handling between the existing required-essentials block (L147-152) and the soft-field block (L154+):

```ts
// [ORCH-0910] Curated card detection + intent-specific fields.
const isCurated = card.cardType === 'curated' || Array.isArray(card.stops);
if (isCurated) {
  trimmed.cardType = 'curated';
  // Synthesize hero image from first stop with a valid imageUrl
  if (!trimmed.image) {
    const firstStopImage = card.stops?.find?.((s: any) => typeof s?.imageUrl === 'string' && s.imageUrl.length > 0)?.imageUrl;
    if (firstStopImage) trimmed.image = firstStopImage;
  }
  // Carry intent metadata
  if (typeof card.tagline === 'string' && card.tagline.length > 0) trimmed.tagline = card.tagline;
  if (typeof card.totalPriceMin === 'number') trimmed.totalPriceMin = card.totalPriceMin;
  if (typeof card.totalPriceMax === 'number') trimmed.totalPriceMax = card.totalPriceMax;
  if (typeof card.estimatedDurationMinutes === 'number') trimmed.estimatedDurationMinutes = card.estimatedDurationMinutes;
  // Trim stops to TrimmedCuratedStop shape
  if (Array.isArray(card.stops) && card.stops.length > 0) {
    trimmed.stops = card.stops.map((s: any, idx: number): TrimmedCuratedStop => ({
      stopNumber: typeof s.stopNumber === 'number' ? s.stopNumber : idx + 1,
      placeName: String(s.placeName ?? '').slice(0, 100),
      placeId: String(s.placeId ?? ''),
      imageUrl: typeof s.imageUrl === 'string' && s.imageUrl.length > 0 ? s.imageUrl : null,
      lat: Number(s.lat) || 0,
      lng: Number(s.lng) || 0,
      priceLevelLabel: String(s.priceLevelLabel ?? '').slice(0, 32),
      priceTier: String(s.priceTier ?? ''),
      rating: Number(s.rating) || 0,
      estimatedDurationMinutes: Number(s.estimatedDurationMinutes) || 45,
      stopLabel: typeof s.stopLabel === 'string' ? s.stopLabel : undefined,
      placeType: typeof s.placeType === 'string' ? s.placeType.slice(0, 80) : undefined,
      aiDescription: typeof s.aiDescription === 'string' ? s.aiDescription.slice(0, 300) : undefined,
      travelModeFromPreviousStop: typeof s.travelModeFromPreviousStop === 'string' ? s.travelModeFromPreviousStop : null,
      address: typeof s.address === 'string' ? s.address.slice(0, 200) : undefined,
      travelTimeFromPreviousStopMin: typeof s.travelTimeFromPreviousStopMin === 'number' ? s.travelTimeFromPreviousStopMin : null,
    }));
  }
}
```

#### 3.1.3 New size-guard drop order (replaces L221-230)

**RETEST 1 SPEC AMENDMENT — 2026-05-22:** Curated stop soft fields now drop in
the order `aiDescription → placeType → travelModeFromPreviousStop → stopLabel`
before `address`, so the payload can carry modal-read fields when budget allows
without exceeding the 5KB CardPayload ceiling.

Replace the existing `dropOrder` array with a single combined ordering that handles both single + curated:

```ts
// ORCH-0685 §6.3 + ORCH-0910 — drop optional fields in reverse priority if over budget.
// 'location', 'placeId', 'categoryIcon', 'image', 'cardType' are NOT in dropOrder.
// For curated cards: drop stop-soft-fields BEFORE dropping whole stops.
const dropOrder: (keyof CardPayload)[] = [
  'matchFactors',
  'socialStats',
  'tags',
  'openingHours',
  'highlights',
  'description',
  'images',
  'address',
  'tagline',                  // ORCH-0910 — soft intent field
];

let size = JSON.stringify(trimmed).length;
for (const key of dropOrder) {
  if (size <= 5120) break;
  delete trimmed[key];
  size = JSON.stringify(trimmed).length;
}

// ORCH-0910 — curated-specific drop order on stops[] subfields.
// Order: stops[].aiDescription → stops[].placeType → stops[].travelModeFromPreviousStop →
// stops[].stopLabel → stops[].address → stops[].travelTimeFromPreviousStopMin → tail-end stops.
// Keep at minimum stops[0] with {placeName, placeId, imageUrl, lat, lng, priceLevelLabel,
// priceTier, rating, estimatedDurationMinutes}.
if (Array.isArray(trimmed.stops) && size > 5120) {
  trimmed.stops = trimmed.stops.map(s => ({ ...s, aiDescription: undefined }));
  size = JSON.stringify(trimmed).length;
}
if (Array.isArray(trimmed.stops) && size > 5120) {
  trimmed.stops = trimmed.stops.map(s => ({ ...s, placeType: undefined }));
  size = JSON.stringify(trimmed).length;
}
if (Array.isArray(trimmed.stops) && size > 5120) {
  trimmed.stops = trimmed.stops.map(s => ({ ...s, travelModeFromPreviousStop: undefined }));
  size = JSON.stringify(trimmed).length;
}
if (Array.isArray(trimmed.stops) && size > 5120) {
  trimmed.stops = trimmed.stops.map(s => ({ ...s, stopLabel: undefined }));
  size = JSON.stringify(trimmed).length;
}
if (Array.isArray(trimmed.stops) && size > 5120) {
  trimmed.stops = trimmed.stops.map(s => ({ ...s, address: undefined }));
  size = JSON.stringify(trimmed).length;
}
if (Array.isArray(trimmed.stops) && size > 5120) {
  trimmed.stops = trimmed.stops.map(s => ({ ...s, travelTimeFromPreviousStopMin: undefined }));
  size = JSON.stringify(trimmed).length;
}
// Last resort: drop stops from end until size fits. Never drop stops[0].
while (Array.isArray(trimmed.stops) && trimmed.stops.length > 1 && size > 5120) {
  trimmed.stops = trimmed.stops.slice(0, -1);
  size = JSON.stringify(trimmed).length;
}
```

### 3.2 Collab-save layer — `app-mobile/src/components/helpers/collabSaveCard.ts`

Extend the `c.cardType === 'curated'` branch (L63-75) to additionally set top-level `image` + `images`:

```ts
...(c.cardType === 'curated'
  ? {
      cardType: c.cardType,
      stops: c.stops,
      tagline: c.tagline,
      totalPriceMin: c.totalPriceMin,
      totalPriceMax: c.totalPriceMax,
      estimatedDurationMinutes: c.estimatedDurationMinutes,
      pairingKey: c.pairingKey,
      experienceType: c.experienceType,
      shoppingList: c.shoppingList,
      // [ORCH-0910] Synthesize top-level image fields from stops so downstream readers
      // (rpc_admin_lock_and_schedule_card + chat renderer + ExpandedCardModal) have
      // honest top-level image to render.
      image: (c.stops as any[] | undefined)?.find?.(s => typeof s?.imageUrl === 'string' && s.imageUrl.length > 0)?.imageUrl,
      images: (c.stops as any[] | undefined)
        ?.map(s => s?.imageUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
        .slice(0, 6),
    }
  : {}),
```

### 3.3 Adapter layer — `app-mobile/src/services/cardPayloadAdapter.ts`

#### 3.3.1 Update header doc

Remove the line `// strollData, picnicData, nightOutData, cardType: undefined (modal's regular layout is reached for chat-shared cards)` and replace with:

```
 *   - strollData, picnicData, nightOutData: undefined (chat-share doesn't carry these)
 *   - cardType + stops: passed through when present (ORCH-0910 — unlocks the modal's
 *     isCuratedCard branch for chat-shared intent cards)
```

#### 3.3.2 Extend the return object (after L78 `sessionId: …`)

Add these lines before the closing `};`:

```ts
    // ORCH-0910: pass curated/intent fields through so ExpandedCardModal's isCuratedCard
    // branch fires for chat-mounted intent cards. ExpandedCardData already has these
    // optional fields (expandedCardTypes.ts L146-147) — adapter just had to stop stripping them.
    cardType: raw.cardType ?? legacy.cardType,
    stops: raw.stops ?? legacy.stops,
    tagline: raw.tagline ?? legacy.tagline,
    totalPriceMin: raw.totalPriceMin ?? legacy.totalPriceMin,
    totalPriceMax: raw.totalPriceMax ?? legacy.totalPriceMax,
    estimatedDurationMinutes: raw.estimatedDurationMinutes ?? legacy.estimatedDurationMinutes,
```

(Type assertions may be needed if `ExpandedCardData` does not yet allow these literally — add optional fields to that type if missing. Verified `cardType` + `stops` already exist at L146-147; add the other 4 if necessary.)

### 3.4 Modal layer — `app-mobile/src/components/ExpandedCardModal.tsx`

#### 3.4.1 Busyness contract fix (RC #4) — single-line change at L1522

```ts
// BEFORE:
(card as any).source?.placeId,
// AFTER:
(card.placeId ?? (card as any).source?.placeId),
```

Add a one-line comment above: `// ORCH-0910: chat-mounted cards carry placeId at top level (per cardPayloadAdapter); deck-mounted cards may carry it under .source — read both.`

#### 3.4.2 Travel-time viewer-relative re-compute

Add new state (near L1391):

```ts
const [viewerTravelTime, setViewerTravelTime] = useState<string | null>(null);
const [viewerDistance, setViewerDistance] = useState<number | null>(null);
```

Import the user-location hook (top of file):
```ts
import { useUserLocation } from '../hooks/useUserLocation';
import { useUserPreferences } from '...'; // existing
import { haversineKm, estimateTravelMinutes } from '../utils/mutateCuratedCard';
```

Inside the component, get viewer GPS + travel mode:
```ts
const { location: viewerLoc } = useUserLocation();
const travelMode: string = userPreferences?.travelMode ?? 'driving';
```

Inside `fetchAdditionalData`, add a new section after busyness fetch and before booking fetch (around L1532):

```ts
// [ORCH-0910] Chat-mounted travel-time viewer-relative re-compute.
// Trigger heuristic: card payload carries `lockInEvent` (proves chat-mount) OR
// card has no precomputed `travelTime`/`distance` (deck cards always have these).
const isChatMounted = !!(card as any).lockInEvent || (!card.travelTime && !card.distance);
if (isChatMounted && viewerLoc?.lat != null && viewerLoc?.lng != null) {
  // For intent: use stops[0]; for single: use card.location
  const targetLat =
    (card as any).cardType === 'curated'
      ? (card as any).stops?.[0]?.lat ?? card.location?.lat
      : card.location?.lat;
  const targetLng =
    (card as any).cardType === 'curated'
      ? (card as any).stops?.[0]?.lng ?? card.location?.lng
      : card.location?.lng;
  if (typeof targetLat === 'number' && typeof targetLng === 'number') {
    const distKm = haversineKm(viewerLoc.lat, viewerLoc.lng, targetLat, targetLng);
    const minutes = estimateTravelMinutes(distKm, travelMode);
    setViewerDistance(distKm);
    setViewerTravelTime(`${minutes} min`);
  } else {
    setViewerDistance(null);
    setViewerTravelTime(null);
  }
} else {
  // Not chat-mounted, OR no viewer GPS — keep null (modal sections render honest absence).
  setViewerDistance(null);
  setViewerTravelTime(null);
}
```

Reset in the modal-close branch (L1438-1444):
```ts
setViewerTravelTime(null);
setViewerDistance(null);
```

In the modal-render sections that consume `travelTime` / `distance` (currently L1916-1917 for single + L1860 for curated), prefer `viewerTravelTime ?? card.travelTime` and `viewerDistance ?? card.distance`. Cite exact lines in implementation report.

#### 3.4.3 Confirm curated branch is reachable (SC-9)

Implementation must verify that when an intent card's `cardPayload` carries `cardType: 'curated'` + `stops`, the modal's `isCuratedCard = (card as any).cardType === 'curated'` at L1707 evaluates `true` for chat-mounted intent cards. No code change required — just verify behavior via test in §6.

### 3.5 Bubble layer — `app-mobile/src/components/chat/MessageBubble.tsx`

#### 3.5.1 Add intent-card-aware layout to card render branch (L355-420)

Inside the existing `(() => { ... })()` IIFE after the `cp` normalizer (around L371), add:

```ts
const isIntentCard = cp.cardType === 'curated' || (Array.isArray((cp as any).stops) && (cp as any).stops.length > 0);
const intentStopCount = isIntentCard ? ((cp as any).stops?.length ?? 0) : 0;
const intentHeroImage = isIntentCard ? ((cp as any).stops?.[0]?.imageUrl ?? cp.image) : cp.image;
const effectiveImage = isIntentCard ? intentHeroImage : cp.image;
```

Replace the existing `{cp.image ? <Image…> : <placeholder>}` block (L387-397) with:

```tsx
<View style={styles.cardBubbleImageWrap}>
  {effectiveImage ? (
    <Image
      source={{ uri: effectiveImage }}
      style={styles.cardBubbleImage}
      resizeMode="cover"
    />
  ) : (
    <View style={[styles.cardBubbleImage, styles.cardBubblePlaceholder]}>
      <Icon name="bookmark" size={24} color={isMe ? 'rgba(255,255,255,0.7)' : colors.text.tertiary} />
    </View>
  )}
  {isIntentCard && intentStopCount > 0 && (
    <View style={styles.cardBubbleIntentChip}>
      <Icon name="arrow-forward" size={10} color="#fff" />
      <Text style={styles.cardBubbleIntentChipText} numberOfLines={1}>
        {`${intentStopCount} stops`}
      </Text>
    </View>
  )}
</View>
```

Add to `styles` (in `StyleSheet.create` block):
```ts
cardBubbleImageWrap: {
  position: 'relative',
},
cardBubbleIntentChip: {
  position: 'absolute',
  top: 8,
  right: 8,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 3,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.55)',
},
cardBubbleIntentChipText: {
  fontSize: 11,
  fontWeight: fontWeights.semibold,
  color: '#fff',
},
```

**Locked-in banner unchanged for both single + intent** (operator-confirmed simpler-is-better).

### 3.6 Database layer — new migration

Filename: `supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql` (timestamp adjusted to be after the most-recent migration on `Seth` — implementor confirms via `ls -1 supabase/migrations/ | tail -3` and picks next free slot).

```sql
-- ============================================================================
-- ORCH-0910 — backfill chat-card payloads with synthesized top-level image
--             and cardType discriminator for legacy intent rows.
--
-- Touches: messages.card_payload (jsonb), board_saved_cards.card_data (jsonb).
-- Rationale: ORCH-0910 fixes the writers going forward, but existing rows
--            (intent cards shared OR locked-in pre-fix) still render as
--            bookmark placeholders because they lack top-level `image`.
-- Pattern:   mirrors ORCH-0908 v2 backfill discipline (20260630000000) —
--            RAISE EXCEPTION if precount asserted rows but UPDATE moved zero.
-- ROLLBACK:  single `git revert`; no schema change to undo, only data fixes
--            on previously broken rows. Re-running the migration is idempotent
--            (the WHERE clause excludes already-backfilled rows).
-- ============================================================================

DO $$
DECLARE
  v_msg_precount integer;
  v_msg_updated integer;
  v_bsc_precount integer;
  v_bsc_updated integer;
BEGIN
  -- 1. messages.card_payload
  SELECT COUNT(*) INTO v_msg_precount
    FROM public.messages
   WHERE message_type = 'card'
     AND card_payload ? 'stops'
     AND NOT (card_payload ? 'image' AND card_payload->>'image' IS NOT NULL);

  UPDATE public.messages
     SET card_payload = card_payload
       || jsonb_build_object(
         'image', card_payload->'stops'->0->>'imageUrl',
         'cardType', 'curated'
       )
   WHERE message_type = 'card'
     AND card_payload ? 'stops'
     AND NOT (card_payload ? 'image' AND card_payload->>'image' IS NOT NULL);

  GET DIAGNOSTICS v_msg_updated = ROW_COUNT;

  IF v_msg_precount > 0 AND v_msg_updated = 0 THEN
    RAISE EXCEPTION 'ORCH-0910 backfill: messages precount % but UPDATE moved 0 rows', v_msg_precount;
  END IF;

  RAISE NOTICE 'ORCH-0910 messages backfill: % rows updated (precount %)', v_msg_updated, v_msg_precount;

  -- 2. board_saved_cards.card_data
  SELECT COUNT(*) INTO v_bsc_precount
    FROM public.board_saved_cards
   WHERE card_data ? 'stops'
     AND NOT (card_data ? 'image' AND card_data->>'image' IS NOT NULL);

  UPDATE public.board_saved_cards
     SET card_data = card_data
       || jsonb_build_object(
         'image', card_data->'stops'->0->>'imageUrl',
         'cardType', 'curated'
       )
   WHERE card_data ? 'stops'
     AND NOT (card_data ? 'image' AND card_data->>'image' IS NOT NULL);

  GET DIAGNOSTICS v_bsc_updated = ROW_COUNT;

  IF v_bsc_precount > 0 AND v_bsc_updated = 0 THEN
    RAISE EXCEPTION 'ORCH-0910 backfill: board_saved_cards precount % but UPDATE moved 0 rows', v_bsc_precount;
  END IF;

  RAISE NOTICE 'ORCH-0910 board_saved_cards backfill: % rows updated (precount %)', v_bsc_updated, v_bsc_precount;
END $$;

NOTIFY pgrst, 'reload schema';
```

**Idempotency:** the `WHERE` clause excludes rows already carrying a non-null `image`, so re-running the migration produces zero updates on a clean DB.

**Implementor MUST verify** via `mcp__supabase__list_tables` that `messages.card_payload` and `board_saved_cards.card_data` are both `jsonb` and that `message_type = 'card'` enum value exists, before staging.

## 4. Success Criteria

| ID | Criterion | Verifies |
|---|---|---|
| **SC-1** | A `Recommendation` with `cardType='curated'` + `stops[]` passed to `trimCardPayload` returns a `CardPayload` where `payload.image` equals `stops[0].imageUrl`, `payload.cardType === 'curated'`, and `payload.stops` is a non-empty `TrimmedCuratedStop[]`. | RC #1 fix |
| **SC-2** | A `Recommendation` with `cardType='curated'` + 5 stops × 6 images each (worst case) passed through `trimCardPayload` produces a `CardPayload` with `JSON.stringify(payload).length <= 5120`, with `stops[0]` retaining at minimum `{placeName, placeId, imageUrl, lat, lng, priceLevelLabel, priceTier, rating, estimatedDurationMinutes}`. | Drop-order correctness |
| **SC-3** | `buildCardDataPayload(curatedCard)` returns an object with `image` = first stop's imageUrl AND `images` = up to 6 stop imageUrls (deduped, non-null). | RC #2 fix |
| **SC-4** | `cardPayloadToExpandedCardData(payload)` where `payload.cardType === 'curated'` returns `ExpandedCardData` carrying `cardType: 'curated'` AND `stops` array. | RC #3 fix |
| **SC-5** | When user shares an intent card directly in a message on iOS, the chat bubble renders the first stop's photo (full-width) with a small `→ N stops` overlay chip in the top-right corner. Title shows the existing arrow-notation string. No bookmark placeholder. | Cell C bubble |
| **SC-5-Android** | Same as SC-5 on Android emulator. | Cell C Android parity |
| **SC-6** | When user locks-in an intent card during collab on iOS, the chat bubble renders identically to SC-5 (first-stop photo + arrow chip), with the orange "Locked in · <date>" banner unchanged above. | Cell D bubble |
| **SC-6-Android** | Same as SC-6 on Android. | Cell D Android parity |
| **SC-7** | Tapping any chat-shared OR locked-in intent card bubble opens the expanded modal, which renders the existing `isCuratedCard` branch (stops list with addresses, per-stop photos, total price range, total duration). | RC #3 cascade — Cell D sheet |
| **SC-8** | Tapping any chat-shared single card bubble (locked-in or not) opens the expanded modal with a working busyness section (when `placeId` is present in the payload). | RC #4 fix — Cell A/B sheet |
| **SC-9** | Tapping any chat-mounted card (single OR intent) on a device with GPS granted shows a viewer-relative travel-time + distance row in the modal (e.g., "12 min · 8.3 km"). Source = client-side haversine + `estimateTravelMinutes(travelMode)` from `mutateCuratedCard.ts`. | Travel-time re-compute |
| **SC-10** | On a device with GPS DENIED, the modal renders honestly without travel-time or distance (no fabricated values, no "0 min"). Constitution #9. | Honest fallback |
| **SC-11** | Booking options + opening hours sections render on chat-mounted single cards when adapter carries them (already-working behavior; verified preserved). | RC contributing #2 |
| **SC-12** | After backfill migration runs, every legacy row in `messages` with `card_payload ? 'stops'` has a non-null `card_payload->>'image'` AND `card_payload->>'cardType' = 'curated'`. Same for `board_saved_cards.card_data`. | Migration |
| **SC-13** | Backfill migration is idempotent — re-running produces zero second-pass updates. | Migration safety |
| **SC-14** | Single card shared-in-message (cell A) still renders correctly on both iOS + Android after all changes (no regression). | Parity preservation |
| **SC-15** | Single card locked-in (cell B) still renders correctly on both iOS + Android after all changes (no regression). | Parity preservation |
| **SC-16** | Solo-mode share of intent card produces same payload + same render as collab-mode share (single source of truth = `sendCardMessage`). | Solo + Collab parity |

## 5. Invariants

### Preserved
- **Constitution #2 (one owner per truth):** `card_payload` remains single source for chat card render. Adapter and bubble both read from it. No competing state authority introduced.
- **Constitution #3 (no silent failures):** broken bookmark-placeholder bubble + "No images available" replaced by honest renders (real photo + stops + busyness) or, when fundamentally absent (no GPS, no placeId), honest absence (no fabricated values).
- **Constitution #9 (no fabricated data):** viewer-relative travel-time = honest synthesis from viewer GPS + viewer travel mode; never displays sender's value. Image derived from `stops[0].imageUrl` is honest — it's the card's own data, not invented.
- **ORCH-0685 — CardPayload 5KB budget:** new drop order ensures curated payloads fit within budget.
- **ORCH-0908 v2 backfill discipline:** new migration mirrors RAISE EXCEPTION on row-count mismatch + idempotent WHERE clauses + documented rollback.
- **I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS:** payload still does NOT carry `travelTime`/`distance` from sender. Viewer-relative values computed at modal-render time, never persisted into payload.

### NEW (DRAFT — flip ACTIVE on CLOSE)
- **I-PROPOSED-CHAT-PAYLOAD-CURATED-AWARE:** every chat card payload writer (`trimCardPayload`, `buildCardDataPayload`, any future) MUST synthesize a top-level `image` for curated/intent cards. Enforcement: unit test in §6 + the existing CI strict-grep gate framework (new rule registered in `.github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs` per [[feedback_strict_grep_registry_pattern]]). DRAFT until CLOSE.
- **I-PROPOSED-CHAT-MODAL-PARITY:** `cardPayloadToExpandedCardData` MUST pass `cardType` + `stops` through. Deletion of either field from the adapter requires an ORCH amendment. Enforcement: unit test in §6 + strict-grep rule on the adapter file. DRAFT until CLOSE.
- **I-PROPOSED-CHAT-MOUNT-VIEWER-RELATIVE-TRAVEL:** chat-mounted modal MUST compute travel-time + distance from viewer GPS, never display sender's value. Enforcement: unit test in §6 verifying the re-compute path; existing `I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS` already blocks persisting sender's value. DRAFT until CLOSE.

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** | Curated trim — happy | `CuratedExperienceCard` with 3 stops, each with imageUrl | `payload.image === stops[0].imageUrl`, `payload.cardType === 'curated'`, `payload.stops.length === 3`, size ≤ 5120 | trimCardPayload (jest) |
| **T-02** | Curated trim — first stop has null imageUrl | Curated card; `stops[0].imageUrl = null`, `stops[1].imageUrl = 'http://...'` | `payload.image === stops[1].imageUrl` (next-stop fallback) | trimCardPayload |
| **T-03** | Curated trim — all stops have null imageUrl | Curated card; all stops imageUrl null | `payload.image === null`, but `payload.cardType === 'curated'` + `payload.stops` preserved | trimCardPayload |
| **T-04** | Curated trim — 5×6 worst case | 5 stops × 6 imageUrls each × 200-char aiDescription | size ≤ 5120; `stops[0]` retains required minimum; drops happen in correct order | size guard |
| **T-05** | Single trim — no regression | `Recommendation` with top-level image | `payload.image === recommendation.image`, no `cardType` set | trimCardPayload |
| **T-06** | buildCardDataPayload curated synth | curated card with stops | output has `image` = first stop imageUrl AND `images` = filtered list | collabSaveCard |
| **T-07** | Adapter passes cardType+stops | `CardPayload` with `cardType: 'curated'` + `stops` | output `ExpandedCardData` has `cardType` + `stops` | adapter |
| **T-08** | Adapter single-card no regression | `CardPayload` with no cardType | output has `cardType: undefined`, `stops: undefined` | adapter |
| **T-09** | Busyness fetch fires for chat-mount with placeId | mock modal mount with `card.placeId = 'pid-1'`, no `source` | busynessService.getVenueBusyness called with `placeId === 'pid-1'` | modal (jest mock) |
| **T-10** | Busyness fetch falls back for deck-mount with source.placeId | mock with `card.placeId = undefined`, `card.source.placeId = 'pid-2'` | called with `placeId === 'pid-2'` | modal (jest mock) |
| **T-11** | Travel-time re-compute fires on chat-mount with GPS | mock viewer at (lat1,lng1), card at (lat2,lng2), `lockInEvent` set | `setViewerTravelTime` called with non-null string | modal |
| **T-12** | Travel-time re-compute SKIPS on deck-mount | mock without `lockInEvent` AND with `card.travelTime` already set | `setViewerTravelTime(null)` | modal |
| **T-13** | Travel-time re-compute SKIPS on no-GPS | mock chat-mount, `viewerLoc = null` | `setViewerTravelTime(null)` (Constitution #9 honest absence) | modal |
| **T-14** | Bubble renders intent layout | `cardPayload.cardType === 'curated'`, `stops.length === 3` | bubble renders `→ 3 stops` overlay chip | MessageBubble (RTL render) |
| **T-15** | Bubble renders single layout | `cardPayload.cardType` absent | no intent chip; existing single-card layout | MessageBubble |
| **T-16** | Backfill — messages | seed 2 broken rows (stops, no image) + 1 already-fixed (stops + image) | after migration: 3/3 have image; precount=2, updated=2 | migration |
| **T-17** | Backfill — board_saved_cards | seed 2 broken rows | same — 2 updated, 0 on re-run | migration |
| **T-18** | Backfill — idempotent | run migration twice on same seed | second run updates 0 rows, no exception | migration |
| **T-19** (adversarial) | placeId missing fails gracefully | chat-share card with neither top-level placeId nor source.placeId | busyness lookup called with undefined; service handles gracefully (no crash, no busyness section renders) | modal |
| **T-20** (adversarial) | Curated card with 12 stops + 8 images each | extreme payload | size guard drops down to ≤ 5120 with stops[0..N] preserving minimum | trimCardPayload |
| **T-21** (adversarial) | GPS-denied user opens chat-mounted card | viewerLoc null, card present | modal renders without travel-time row; no fabricated "0 min" | modal |
| **T-22** (adversarial) | Backfill on partially-fixed remote | mixed seed (some rows have image, some don't, some have cardType already) | only the rows missing image OR null image get updated | migration |

**Implementor-owned (happy-path):** T-01, T-06, T-07, T-09, T-11, T-14, T-16, T-17 — must include `fails-on-revert verified at <hash>` receipts per ORCH-0840 Step 0.5.

**Tester-owned (adversarial):** T-19, T-20, T-21, T-22 — must attack different angles than implementor's tests. Tester also re-runs T-02, T-03, T-05, T-08, T-10, T-12, T-13, T-15, T-18 as independent verification.

## 7. Implementation Order

1. **Type layer first** — `messagingService.ts` widen `CardPayload` + add `TrimmedCuratedStop`. Type-check passes.
2. **Trim layer** — `trimCardPayload` curated detection + drop order. Implementor writes T-01..T-05 alongside.
3. **Collab-save layer** — `collabSaveCard.ts` synth image/images for curated. Implementor writes T-06.
4. **Adapter layer** — `cardPayloadAdapter.ts` pass cardType+stops, busyness contract fix (the single-line change in `ExpandedCardModal.tsx:1522` lives here in spirit but is a different file). Implementor verifies `ExpandedCardData` type accepts the extra fields (it does for cardType+stops; widen for the other 4 if not). Writes T-07, T-08.
5. **Modal layer** — `ExpandedCardModal.tsx` busyness L1522 fix + travel-time re-compute state + fetch path + render-site preference. Implementor writes T-09..T-13.
6. **Bubble layer** — `MessageBubble.tsx` intent variant. Implementor writes T-14, T-15.
7. **Migration last** — `supabase/migrations/<timestamp>_orch_0910_chat_intent_card_backfill.sql`. Implementor stages the file; **operator runs `supabase db push --linked`** (operator-owned per orchestrator skill carve-out). Implementor writes T-16, T-17, T-18 as SQL-level tests (DO block with seed + assert pattern).
8. **CI gates** — `.github/scripts/strict-grep/orch-0910-chat-payload-curated-aware.mjs` for invariant lockdown. Plug into existing strict-grep workflow per [[feedback_strict_grep_registry_pattern]].
9. **Implementor regression-check script** — `app-mobile/scripts/ci/orch-0910-regression-check.mjs` mirroring ORCH-0897 / ORCH-0908 pattern, covering T-01, T-06, T-07, T-09, T-11, T-14 as text-regex + behavioral assertions.

## 8. Regression Prevention

- **Structural safeguard:** I-PROPOSED-CHAT-PAYLOAD-CURATED-AWARE invariant + strict-grep rule preventing future writers from omitting top-level `image` synthesis for curated payloads.
- **Test gate:** ORCH-0910 happy-path + adversarial regression checks land under `app-mobile/scripts/ci/` and are picked up by the existing append-only CI workflow (`.github/workflows/tests-append-only.yml`) per ORCH-0840 [Regression-test enforcement + append-only CI]. Tests become immutable after merge.
- **Protective comment:** added at top of `trimCardPayload` documenting the curated detection contract + drop order rationale (one-paragraph, "why").

## 9. Open questions (resolved)

- Intent-bubble visual: operator-confirmed (a) first-stop photo full-width + `→ N stops` overlay chip. Resolved.
- Travel-time policy: viewer-GPS re-compute via client haversine. Resolved.
- Booking + opening hours: render when present. Resolved.
- Backfill scope: both `messages` + `board_saved_cards`. Resolved.
- Cell B fresh screenshot: deferred to TEST phase (Maestro sim repro will close the parity loop visually).

## 10. Discoveries reaffirmed for orchestrator

- **DISC-0910-1 (low):** double defensive `raw.card_data` normalizer in `MessageBubble.tsx` + `cardPayloadAdapter.ts` — leave in place; future cleanup ORCH after legacy-row sweep verified.
- **DISC-0910-2 (low):** new drop-order for curated cards — handled in this spec, no follow-up.
- **DISC-0910-3 (low):** `boardMessageService.sendCardMessage` — implementor confirms in pre-flight that it routes through `trimCardPayload`. If it has its own payload assembly, register DISC-0910-3-AMENDED.
- **DISC-0910-4 (medium):** Cell B fresh sim screenshot — covered by TEST phase parity-enforcement step.

## 11. Hard guards re-stated for implementor

- No code in this spec — implementor produces it.
- No scope creep beyond the 16 items. Tangential → DISC-0910-N follow-up.
- **No `supabase db push`** — operator owns migration apply.
- **No edge function deploy** — none touched.
- Consumer iOS + Android only.
- ORCH-0908 v2 backfill discipline preserved on the new migration.
- No AI attribution in commit messages.

---

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
