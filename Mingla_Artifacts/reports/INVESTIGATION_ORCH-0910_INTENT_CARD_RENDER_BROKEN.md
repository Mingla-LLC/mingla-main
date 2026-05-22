# INVESTIGATION — ORCH-0910

> **RESCOPE NOTICE (2026-05-22):** Original scope ("intent card render broken in collab lock-in + direct-share chat bubbles; single-card parity re-audit") was operator-rescoped 2026-05-22 to full chat-mounted parity after operator surfaced that single-card EXPANDED SHEETS are also degraded (busyness missing, travel-time null, weather sometimes missing). This investigation initially claimed cell A (single shared-in-message) "works" — that was a confidence violation; the BUBBLE renders but the EXPANDED SHEET has its own root causes. Corrections live in §12 below; sections 1-11 preserved as written for audit trail.

**ORCH-ID (rescoped):** ORCH-0910 [Chat-mounted card expanded sheet parity — single + intent, bubble + sheet]
**ORCH-ID (original):** ORCH-0910 [Intent card render broken in collab lock-in + direct-share chat bubbles; single-card parity re-audit]
**Mode:** INVESTIGATE
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** HIGH on root cause for broken cells (C, D); HIGH on cell A (operator screenshot); MEDIUM on cell B (no fresh screenshot — see §10 open question)

---

## 1. Symptom recap + live-fire evidence

Operator screenshots 2026-05-21, 3-person consumer-app collab chat "Testing stuff":

- **Screenshot 1 (chat thread):** intent card "Nasher Museum of Art at Duke University → Parizade" renders the orange "Locked in · Sat, May 23 at 12:00 PM" header correctly, then body is an empty grey panel with only a bookmark glyph centered. The "Tap to view" hint is the only other text. Title "Nasher Museum of Art at Duke University → Parizade" appears below the panel. Above it in the same thread, a **single place card "Pineapple Sol" shared directly in a message renders correctly** — hero image of the building, "cafe-outline" category chip, "Icebreakers" tag, "Tap to view". This is live-fire confirmation that cell A (single shared-in-message) works today.
- **Screenshot 2 (expanded sheet after tap):** orange "Locked in" header + "Add to Calendar" button (correct), grey hero area with text "No images available", title "Nasher Museum of Art at Duke University → Parizade", "Experience" tag, "0.0" rating chip, "Chill · $50 max" tier chip, Saved / Schedule / Share row. The rich place-detail sections (carousel, gallery, opening hours, weather, busyness, stops listing) are absent.

**Sim re-repro:** Not run this turn. The operator has already produced live-fire repro frames for cells C (intent locked-in bubble) + D (intent locked-in expanded sheet). Source-only reasoning is sufficient for proving root cause because the failure is a deterministic payload-shape contract violation that is fully readable in source (see §5). Cell A is also live-fire-confirmed via the Pineapple Sol bubble in screenshot 1. Cell B (single locked-in bubble) has NO fresh screenshot — see §10 open question for operator.

## 2. Phase 0 ingestion log

Files / artifacts read this turn:

- `Mingla_Artifacts/WORLD_MAP.md` (top, ORCH-0910 INTAKE banner I registered last turn; ORCH-0897 / 0898 / 0906 / 0908 / 0909 CLOSE banners)
- `Mingla_Artifacts/MASTER_BUG_LIST.md` (top, ORCH-0910 INTAKE banner)
- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0910_INTENT_CARD_RENDER_BROKEN.md` (this dispatch)
- `git log` on `app-mobile/src/components/chat/MessageBubble.tsx`, `ExpandedBusinessEventSheet.tsx`, `connections/ChatListItem.tsx`, `services/messagingService.ts`
- `git diff Seth~10` on `MessageBubble.tsx` (showed the ORCH-0908 v2 defensive normalizer + ORCH-0667 substrate)
- `app-mobile/src/components/chat/MessageBubble.tsx` (full file — card render branch at L355-420)
- `app-mobile/src/services/messagingService.ts` L17-239 (`CardPayload` interface + `trimCardPayload`), L1029-1075 (`sendCardMessage`)
- `app-mobile/src/services/cardPayloadAdapter.ts` (full file — chat→modal adapter)
- `app-mobile/src/components/helpers/collabSaveCard.ts` (full file — `buildCardDataPayload` writes the `card_data` blob lock-and-schedule later reads)
- `app-mobile/src/types/curatedExperience.ts` (full file — `CuratedExperienceCard` shape)
- `app-mobile/src/components/ExpandedCardModal.tsx` (grep — `isCuratedCard` branch at L1707, `stops`-based curated render path at L1821+, `cardType === 'curated'` checks at L1450, L1707)
- `supabase/migrations/20260630000000_orch_0908_card_payload_flatten.sql` (full file — the prior single-card fix)
- `supabase/migrations/20260629000000_orch_0908_combined_lock_schedule.sql` (the buggy v1 it superseded — confirmed via cross-reference, not re-read in full)

## 3. Single-card fix archeology

**Prior single-card fix = ORCH-0908 v2 migration `supabase/migrations/20260630000000_orch_0908_card_payload_flatten.sql`** (deployed inside the bundle commit `74142108` "Close ORCH-0908 + ORCH-0909 + ORCH-0906"). Mechanism:

- The combined lock-and-schedule RPC `rpc_admin_lock_and_schedule_card` is recreated to build `card_payload` by spreading `saved_card.card_data` at the TOP LEVEL (`COALESCE(v_card_data, '{}'::jsonb) || jsonb_build_object('lockInEvent', ..., 'scheduledAt', ..., ...)`) instead of nesting it under `card_data` (the v1 shape from `20260629000000`).
- A one-shot backfill flattens existing rows.
- Defensive client-side normalizer at `MessageBubble.tsx:361-371` reads `raw.card_data` as a fallback so any nested row that slips through still renders. Same defensive normalizer in `cardPayloadAdapter.ts:30-31` for the expanded sheet.

**Verdict on parity coverage of the prior fix:**

| Cell | Path covered by ORCH-0908 v2? | Why |
|---|---|---|
| A. Single shared-in-message | Was never broken by the v1 nested shape — direct share uses `messagingService.sendCardMessage` → `trimCardPayload` on a `Recommendation` that has top-level `image`. The nested `card_data` bug was specific to the SERVER-SIDE RPC, not the client-side direct-share path. | Different code path; never went through the buggy RPC. |
| B. Single locked-in | Fixed by the migration: RPC now spreads `card_data` at top level, so `card_payload.image` is present when `card_data.image` is present, which it always is for a single-place saved card (`buildCardDataPayload` writes `image: card.image` and `Recommendation` has top-level `image`). | Migration `20260630000000` is the canonical current definition of the RPC. |
| C. Intent shared-in-message | **NOT COVERED** — `trimCardPayload` reads `card.image`, but `CuratedExperienceCard` has no top-level `image` field (it has `stops[].imageUrl`). Result: `card_payload.image` is `undefined`/missing. | See root cause §5.A. |
| D. Intent locked-in | **NOT COVERED** — `buildCardDataPayload` writes `image: card.image` and `image` is undefined on `CuratedExperienceCard`. The RPC then spreads `card_data` at top level → `card_payload.image` is still missing. Adding the lock-in extras alongside doesn't help. | See root cause §5.A + §5.B. |

So the prior fix correctly handled both single-card paths but never extended to the curated/intent payload shape.

## 4. Bug surface matrix — current state vs intended

|  | Single place card | Intent (curated) card |
|---|---|---|
| **Shared directly in a message** | Cell A — WORKS (live-fire-confirmed via Pineapple Sol bubble in screenshot 1) | Cell C — **BROKEN** (no top-level image in `trimCardPayload` output, bubble shows bookmark placeholder, sheet shows "No images available") |
| **Locked-in by collab session** | Cell B — assumed WORKS per ORCH-0908 v2 migration trace; needs fresh sim confirmation (see §10) | Cell D — **BROKEN** (live-fire screenshots 1 + 2 — bookmark placeholder bubble, "No images available" sheet, no stops rendering) |

## 5. Five-truth-layer trace — root causes proven

### Layer trace inputs

- **Docs:** ORCH-0667 substrate spec (chat card share), ORCH-0685 spec (modal-render-relevant fields added to CardPayload), ORCH-0908 v2 migration comment (flat CardPayload contract). All three describe the CardPayload contract as **flat top-level fields the renderer reads directly**.
- **Schema:** `messages.card_payload jsonb` — no enforced inner shape; RLS irrelevant here.
- **Code:** See six-field evidence below.
- **Runtime:** Live-fire repro = operator screenshots 2026-05-21. Repro produces empty grey bubble + bookmark glyph in cell C/D bubble + "No images available" in cell D sheet.
- **Data:** Per operator screenshot, the intent card payload writes `title` correctly ("Nasher Museum of Art at Duke University → Parizade") and a category chip resolves to "Experience" — but `image`/`images` are missing. A live SQL probe on the production `messages` row for that conversation would confirm `card_payload->>'image' IS NULL AND card_payload->>'images' IS NULL AND card_payload ? 'stops' = true` (HIGH confidence based on source trace; can be verified via Supabase MCP if needed before SPEC).

### 🔴 Root Cause #1 — `trimCardPayload` doesn't carry curated/intent fields

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/services/messagingService.ts:145-239` (`trimCardPayload`) |
| **Exact code** | `const trimmed: CardPayload = { id: card.id, title: card.title \|\| 'Saved experience', category: card.category ?? null, image: card.image ?? null };` and the function never reads `card.stops`, `card.cardType`, `card.totalPriceMin`, `card.totalPriceMax`, or `card.estimatedDurationMinutes` |
| **What it does** | For a single-place `Recommendation` (which carries top-level `image`), produces a CardPayload that the renderer can display. For a `CuratedExperienceCard` (which has NO top-level `image` — image lives in `stops[].imageUrl`), produces a CardPayload with `image: null` and no preserved `stops` array. |
| **What it should do** | Detect curated cards (`card.cardType === 'curated'` or `Array.isArray(card.stops)`), derive a top-level `image` from `card.stops[0]?.imageUrl`, preserve `cardType: 'curated'`, preserve a trimmed `stops` array (subject to the 5KB size budget — drop low-priority stop fields like `aiDescription`, `openingHours`, `imageUrls[1..]`, etc. before exceeding), preserve `totalPriceMin`/`totalPriceMax`/`estimatedDurationMinutes`/`tagline` so the modal's `isCuratedCard` branch can render the stops list, total price range, and total duration. |
| **Causal chain** | Operator shares an intent card directly in chat (cell C) → `MessageInterface.tsx:902` calls `messagingService.sendCardMessage(conversationId, senderId, card)` → `sendCardMessage:1041` calls `trimCardPayload(card)` → returns `{ id, title, category, image: null }` → inserted into `messages.card_payload` → realtime delivers to recipients → `MessageBubble.tsx:387` `cp.image ? <Image /> : <bookmark placeholder />` evaluates the placeholder branch → user sees empty grey body with bookmark glyph. |
| **Verification step** | Add a sim `console.log('[ORCH-0910-DIAG] trim result', trimmed)` inside `trimCardPayload`, share an intent card from the deck to a conversation, observe `image: null` and missing `stops` in Metro logs. Alternatively a Supabase MCP probe on a `messages` row from "Testing stuff" with `message_type='card'` AND `card_payload->>'title' LIKE '%→%'` will show the same. |

### 🔴 Root Cause #2 — `buildCardDataPayload` doesn't synthesize top-level `image` for curated cards

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/helpers/collabSaveCard.ts:30-76` |
| **Exact code** | Top-level: `image: card.image, images: card.images, ...` followed by a curated-conditional spread `...(c.cardType === 'curated' ? { cardType, stops, tagline, totalPriceMin, totalPriceMax, estimatedDurationMinutes, pairingKey, experienceType, shoppingList } : {})` |
| **What it does** | When a user right-swipes a curated card during collab, this writes `card_data` to `board_user_swipe_states` and (on quorum) to `board_saved_cards.card_data`. For curated cards: writes `image: undefined` (stripped from JSONB), writes `images: undefined`, but DOES write `stops`, `cardType`, etc. |
| **What it should do** | For curated cards, additionally set `image: card.stops?.[0]?.imageUrl ?? null` and `images: card.stops?.map(s => s.imageUrl).filter(Boolean).slice(0, 6)` so downstream readers that depend on the flat ORCH-0667 image contract have something to render — even before the renderer learns to draw a curated bubble layout. |
| **Causal chain** | Operator (or another participant) right-swipes an intent card in collab → `SwipeableCards.tsx` invokes `collabSaveCard` → `buildCardDataPayload(card)` → `card_data` is persisted with no top-level `image`/`images` (only nested `stops[].imageUrl`) → later, the operator locks the card in → `rpc_admin_lock_and_schedule_card` reads `board_saved_cards.card_data` and spreads it at top level → `card_payload.image` is `undefined` → MessageBubble renders the bookmark placeholder. |
| **Verification step** | Supabase MCP probe `SELECT card_data->>'image' AS img, card_data->'stops'->0->>'imageUrl' AS stop0_img FROM board_saved_cards WHERE id = '<saved-card-id>'`. Expect `img IS NULL` and `stop0_img IS NOT NULL` for a curated card. |

### 🔴 Root Cause #3 — `cardPayloadToExpandedCardData` strips `cardType` + `stops` → modal never enters curated branch for chat-shared cards

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/services/cardPayloadAdapter.ts:22-79` |
| **Exact code** | The header comment is explicit: `// strollData, picnicData, nightOutData, cardType: undefined (modal's regular layout is reached for chat-shared cards)`. The function returns an `ExpandedCardData` literal that includes no `cardType` and no `stops` — both fields are deliberately omitted. |
| **What it does** | When the operator taps a card bubble in chat, `MessageBubble.onCardBubbleTap` fires `setExpandedCardFromChat(cardPayloadToExpandedCardData(payload))` (`MessageInterface.tsx:1415-1419`). The adapter returns a `ExpandedCardData` without `cardType` or `stops`. `ExpandedCardModal.tsx:1707` evaluates `const isCuratedCard = (card as any).cardType === 'curated';` → `false` regardless of source payload → modal falls into the regular single-card layout → carousel reads empty `images: []` → renders "No images available". The Experience tag + tier chip + rating still render because those come from the standard chrome that reads top-level fields the adapter does set (using legacy fallbacks). |
| **What it should do** | Pass `cardType` through from the payload (`raw.cardType ?? legacy.cardType`), preserve `stops` (typed as `CuratedStop[]`), preserve `tagline`, `totalPriceMin`/`totalPriceMax`, `estimatedDurationMinutes`. The modal already has a working `isCuratedCard` render branch (L1821+ renders the stops list, addresses, totals) — the adapter is the only thing preventing chat-shared intent cards from reaching it. |
| **Causal chain** | Operator taps the locked-in intent card bubble → `MessageInterface.tsx:1417` calls `cardPayloadToExpandedCardData(payload)` → returns `ExpandedCardData` with no `cardType`/`stops` → `ExpandedCardModal` `isCuratedCard = false` → regular layout → carousel section sees empty `images` → "No images available" string renders → user sees the broken expanded sheet in screenshot 2. |
| **Verification step** | Add `console.log('[ORCH-0910-DIAG] adapter out', result.cardType, result.stops?.length)` at the end of `cardPayloadToExpandedCardData`; tap an intent card bubble; observe `undefined undefined`. |

### 🟠 Contributing factor — `CardPayload` TS interface has no `cardType` or `stops`

`messagingService.ts:23-91`. Even if the three root causes are fixed at the writer/reader layers, the type system will silently fight (`as any` casts) unless `CardPayload` is widened with optional `cardType?: 'curated' | 'single'`, `stops?: TrimmedCuratedStop[]`, `tagline?: string`, `totalPriceMin?: number`, `totalPriceMax?: number`, `estimatedDurationMinutes?: number`. The shape budget (≤5KB) must be re-validated with a worst-case 5-stop curated card.

### 🟠 Contributing factor — `MessageBubble.tsx` card branch is single-card only

`MessageBubble.tsx:372-420`. The render branch assumes a single hero image + single title + single category chip. It does not have an intent-aware layout (stacked thumbnails, "Start: X → End: Y" path subline, total-price range, stops count). Even after fix #1+#2 plumb `cardType` + `stops` through, the bubble will render a single image (the first stop's) without telling the viewer this is a multi-stop intent. The fix scope must extend the bubble layout with an intent-card variant — operator/designer call on the visual.

### 🟡 Hidden flaw — `messages` table backfill needed for already-broken rows

Already-sent intent card messages on remote (including in the operator's "Testing stuff" conversation) have `card_payload` missing `image`/`stops`/`cardType`. Even after the writer/reader fixes ship, those legacy rows continue to render as bookmark placeholders unless the SPEC includes a one-shot UPDATE that backfills `card_payload->image` from `card_payload->'stops'->0->>'imageUrl'` and adds `cardType: 'curated'` where `card_payload ? 'stops'`. The ORCH-0908 v2 backfill pattern is the template (`20260630000000` lines 184-208).

### 🔵 Observation — intent direct-share path uses the same `sendCardMessage` as single-card direct-share

`MessageInterface.tsx:902` calls `messagingService.sendCardMessage` for any card the user shares from the share modal, regardless of `cardType`. So fix #1 to `trimCardPayload` automatically fixes cell C the moment it lands — no separate intent-share code path needs to be authored. (Verified by reading `MessageInterface.tsx` grep results.)

## 6. Blast radius

- **`messages` table** — affects every conversation that has ever received an intent card share OR an intent card lock-in. Operator's "Testing stuff" conversation has at least one such row. Production may have dozens to hundreds depending on collab+intent adoption rates.
- **`board_saved_cards` table** — every right-swiped intent card has `card_data` written by `buildCardDataPayload` with the no-`image` defect (Root Cause #2). These rows feed both the lock-in payload AND the Saved tab + future modal opens. Backfill scope likely extends here too.
- **`MessageInterface.tsx`** — single shared file owns both direct-share + chat-mounted modal open paths.
- **`MessageBubble.tsx`** + **`ExpandedCardModal.tsx`** + **`cardPayloadAdapter.ts`** + **`messagingService.ts`** + **`collabSaveCard.ts`** — five files in the implementation diff.
- **No surface beyond Consumer iOS + Consumer Android.** Business-iOS/Android (the new ORCH-0897 GroupChatPanel) is a planner-side moderation UI and does not render shared cards (verified by grep of `mingla-business/` — `GroupChatPanel.tsx` does not import `CardPayload`, `cardPayloadAdapter`, or `MessageBubble`).
- **Solo + Collab parity:** intent cards CAN be shared from solo mode too (via the share modal). The fix to `trimCardPayload` covers solo direct-share automatically. Lock-in is collab-only — no solo parallel.

## 7. Invariant lenses

- **No silent failures (Constitution #3):** current behavior IS a silent failure — bookmark placeholder + "No images available" do not surface that the card is broken; the viewer just sees nothing. The fix restores honest rendering.
- **No fabricated data (Constitution #9):** if SPEC chooses to derive `image` from `stops[0].imageUrl`, that is honest synthesis from the card's own data, not fabrication. If SPEC chooses to fall back to a generic Mingla-branded placeholder, that must NOT show a fake rating/category — current chrome already passes this bar.
- **One owner per truth (Constitution #2):** `card_payload` is the single source of truth for chat card render. The three root causes are all violations of this — the writer omits fields, the adapter strips fields, the renderer can't ask anywhere else.
- **Solo + Collab parity ([[feedback_solo_collab_parity]]):** confirmed — fixes apply to both modes.

## 8. Open questions for SPEC phase (operator/designer input needed)

1. **Intent bubble visual treatment.** Should the chat bubble for an intent card show: (a) first stop's hero image, full width; (b) a 2-thumbnail stack (first + last stop); (c) a composite/collage; (d) a stylized "itinerary card" with arrow notation like "Start: Nasher → End: Parizade" subline below the title with a small map icon? Recommend (a) for v1 — minimal designer ask, leverages existing layout — with a tiny "→ 2 stops" chip on the image overlay. This needs designer + operator alignment before SPEC freezes the visual.
2. **Expanded-sheet treatment.** The modal's `isCuratedCard` branch already renders stops + addresses + totals (`ExpandedCardModal.tsx:1821+`). Fix #3 (passing `cardType` + `stops` through the adapter) unlocks it for chat-shared/locked-in intent cards. **Does the operator want the chat-mounted modal to render that branch as-is, or with a "from this chat" footer adjustment?** Recommend as-is for v1.
3. **Lock-in bubble for intent cards.** The `Locked in · <date>` banner is layout-correct in the operator screenshot — should it remain visually identical for intent, or should it include something like "Locked plan · <date> · 2 stops"? Recommend identical for v1 — simplest spec, lowest risk.
4. **Backfill scope.** Backfill `messages.card_payload` only (1 table), OR backfill BOTH `messages.card_payload` + `board_saved_cards.card_data` (2 tables)? Recommend both, mirroring the ORCH-0908 v2 pattern. The `board_saved_cards` backfill is the more important one because lock-in re-reads from there.
5. **Size budget under curated payload.** The CardPayload 5KB budget was set for single cards. A 5-stop intent card with 6 photos each + opening hours + AI descriptions can easily exceed. SPEC needs to define the trim/drop order for curated fields: drop `stops[].aiDescription` → `stops[].imageUrls[1..N]` → `stops[].openingHours` → `stops[].address` → keep `{ placeName, imageUrl, priceLevelLabel, rating }` per stop as the minimum. Document this trim order with the same rigor as the single-card drop order.

## 9. Discoveries for orchestrator

- **DISC-0910-1 (low):** `MessageBubble.tsx:355-420` and `cardPayloadAdapter.ts:22-79` both contain identical `raw.card_data` fallback normalizer code (ORCH-0908 defensive read for legacy nested rows). Once the legacy-row backfill is verified clean, both normalizers can be removed in a future cleanup ORCH. No action needed now.
- **DISC-0910-2 (low):** `trimCardPayload` size-guard drop order does not include the new curated fields (whatever fix #1 introduces). The drop order needs to be re-thought for curated cards — see §8 question 5.
- **DISC-0910-3 (low):** `boardMessageService.sendCardMessage` (`app-mobile/src/services/boardMessageService.ts:599`) is a SECOND share-card-to-board-chat code path (Board Discussion tab, ORCH-0436-era). Verify in SPEC whether it also passes through `trimCardPayload` or has its own payload assembly — if separate, the fix may need to touch it too. Quick grep suggests it's wired into the same flow but worth a 5-minute confirm in SPEC Phase 1.
- **DISC-0910-4 (medium):** Cell B (single locked-in) was not visually verified this turn — only inferred from the migration history + code trace. Recommend operator includes a fresh "single card locked-in" sim screenshot in the SPEC phase confirmation step so we close the parity loop with evidence.

## 10. Open ask for operator

**Single ask:** can you share one fresh iOS-sim screenshot of a SINGLE place card that's been locked-in in the same "Testing stuff" conversation (or any collab session), so we have live-fire confirmation that cell B (single locked-in bubble) renders correctly today and ORCH-0908 v2 actually held? Source trace says it does, but parity audit deserves visual proof. Not a blocker for moving to SPEC — but if cell B is ALSO broken, the fix scope expands and the SPEC must include a re-trace of the ORCH-0908 v2 migration on the live remote.

## 11. Suggested next phase

**SPEC dispatch to Claude `mingla-forensics` (SPEC mode).** Spec must cover:

1. Extend `CardPayload` interface with optional curated fields (`cardType`, `stops`, `tagline`, `totalPriceMin`/`Max`, `estimatedDurationMinutes`).
2. Extend `trimCardPayload` to handle curated shape — derive top-level `image`, preserve trimmed `stops` array, define new size-guard drop order for curated fields.
3. Extend `buildCardDataPayload` to set top-level `image`/`images` for curated cards (derived from `stops[].imageUrl`).
4. Extend `cardPayloadToExpandedCardData` to pass `cardType` + `stops` through.
5. Extend `MessageBubble.tsx` card render branch with an intent-card-aware layout (operator-confirmed visual, per §8 Q1).
6. Migration: one-shot UPDATE on `messages.card_payload` AND `board_saved_cards.card_data` to backfill top-level `image` from `stops[0].imageUrl` and tag `cardType: 'curated'` where `card_payload ? 'stops'`. Mirror the ORCH-0908 v2 backfill discipline (RAISE EXCEPTION on row-count assertion, rollback path documented).
7. Happy-path regression test (intent card share + lock-in both render correctly, both shaped tests run in Maestro or jest-based assertion on the trim/adapter outputs with `fails-on-revert` receipt).
8. Adversarial regression test (5-stop curated card payload exceeds 5KB → size guard drops correct fields, retained fields are sufficient to render).
9. Cross-Surface Impact: Consumer iOS + Consumer Android only. All other surfaces explicitly NOT in scope.
10. Solo + Collab parity verified by independent SC per mode.

After SPEC review approval → IMPLEMENT (Claude `mingla-implementor`) → TEST (Claude `mingla-tester`, iOS + Android sim parity mandatory) → CLOSE.

---

**Confidence summary:**
- Root causes #1, #2, #3 — **HIGH confidence (proven via code trace + operator live-fire screenshots).**
- Cell B parity assumption — **MEDIUM confidence** (no fresh visual; operator confirmation requested in §10).
- Backfill scope — **HIGH confidence** for `messages` table; **MEDIUM-HIGH** for `board_saved_cards.card_data` (need 5-min SPEC-phase confirm).
- SPEC question answers — operator/designer judgment calls, not investigation gaps.

---

## 12. RESCOPE ADDENDUM (2026-05-22) — chat-mounted single-card expanded sheet is ALSO broken

Operator surfaced 2026-05-22: even for single cards, the chat-mounted expanded sheet is missing weather, busyness, traffic, and other rich sections. My initial cell-A "WORKS" verdict was bubble-only; I never verified the expanded sheet for single chat-shared cards. That was a confidence violation. Honest matrix:

| Surface | Single card | Intent card |
|---|---|---|
| Bubble | works | broken (no photo) |
| Expanded sheet — chrome (title, tier, rating) | works | works |
| Expanded sheet — hero image | works | **broken** |
| Expanded sheet — stops list | n/a | **broken** |
| Expanded sheet — weather | likely works (location passes through) — sim verify in TEST | broken (no location synthesized) |
| Expanded sheet — busyness | **BROKEN — root cause #4 below** | broken (same RC #4 + no fetch trigger) |
| Expanded sheet — travel-time/traffic | NULL by design (Constitution #9) — operator decision: re-compute from VIEWER GPS | NULL by design — same |
| Expanded sheet — booking + opening hours | passes through if trimmed — operator decision: render when present | broken (no per-stop hours plumbed) |

### 🔴 Root Cause #4 (added 2026-05-22) — Busyness contract mismatch: adapter writes `placeId` at top level, modal reads `source.placeId`

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/services/cardPayloadAdapter.ts:68` (writes `placeId: f('placeId', undefined)` at top level) AND `app-mobile/src/components/ExpandedCardModal.tsx:1522` (reads `(card as any).source?.placeId` inside the non-curated busyness branch). |
| **Exact code** | Adapter L68: `placeId: f('placeId', undefined),` — flat top-level. Modal L1522: `const busyness = await busynessService.getVenueBusyness(card.title, card.location.lat, card.location.lng, card.address, (card as any).source?.placeId, card.category, weather?.utcOffsetSeconds);` — `(card as any).source` is `undefined` for chat-mounted cards because the adapter never sets a `source` object. |
| **What it does** | For EVERY chat-mounted single card, the busyness service call receives `placeId = undefined`. Even if `busynessService.getVenueBusyness` falls back to name+lat+lng lookup, the Google Place ID is the precise dedup key — without it the lookup is fuzzy and frequently misses, returning no busyness data. The user sees no "busy now" indicator. |
| **What it should do** | Adapter must shape `placeId` consistent with what the modal reads. Two clean fixes: (a) adapter writes both `placeId` AND `source: { placeId }`; (b) modal reads `card.placeId ?? (card as any).source?.placeId`. SPEC will choose — option (b) is the smaller diff and the more honest contract since `placeId` is canonically top-level on the deck-mounted Recommendation too. |
| **Causal chain** | Operator taps any single card bubble (chat-shared OR locked-in) → MessageBubble.onCardBubbleTap → cardPayloadToExpandedCardData → ExpandedCardData with `placeId` at top level → ExpandedCardModal fetchAdditionalData → busyness branch reads `source?.placeId` → undefined → lookup fails silently → no busyness section renders. |
| **Verification step** | Add `console.log('[ORCH-0910-DIAG] busyness lookup pid:', (card as any).source?.placeId, card.placeId)` at L1521; tap a single chat-shared card; observe `undefined <a-valid-uuid>` in Metro. |

### 🟠 Contributing factor (added 2026-05-22) — Travel-time/traffic is NULL by design but operator wants viewer-relative re-compute

`cardPayloadAdapter.ts:48-49` hardcodes `distance: null, travelTime: null` per ORCH-0685 [chat-share modal substrate] + Constitution #9 (don't render sender's recipient-relative values). This is intentional and correct AT THE ADAPTER. The fix scope: add a NEW fetch path inside `ExpandedCardModal.fetchAdditionalData` (after weather + busyness, before booking) that, when card came from chat-mount (detectable via `lockInEvent` presence OR new explicit `mountedFromChat` flag), re-runs the existing Distance Matrix path with `viewerGPS → card.location` and populates the modal's local `distance` + `travelTime` state. Does NOT mutate the payload; computes fresh per-viewer per-open. Honest, viewer-relative, no fabrication.

### 🟠 Contributing factor (added 2026-05-22) — Booking + opening hours render contract on chat-mount

The adapter currently passes `openingHours` + `phone` + `website` through (lines 52-54). They render in the modal's `PracticalDetailsSection` only when the values exist. For chat-shared single cards, `trimCardPayload` includes them if present (lines 190-194). For intent cards, none of this is currently plumbed because the modal falls into the regular layout instead of the curated layout. SPEC scope: confirm the regular-layout render works when fields are present (likely already does); for intent cards this is automatically fixed by Root Cause #3 (passing `cardType`+`stops` enables `isCuratedCard` branch which has its own per-stop opening-hours render at L1854+).

### Updated SPEC scope (replaces §11)

SPEC must cover, in addition to original 10 items:

11. Busyness contract fix — modal reads `card.placeId ?? (card as any).source?.placeId` (or equivalent), with regression test that proves a chat-mounted card with `placeId` triggers a busyness fetch.
12. Travel-time viewer-relative re-compute — new fetch path in `fetchAdditionalData` that runs Distance Matrix from viewer GPS to `card.location` (or `curatedCard.stops[0]` for intent) when on chat-mount; populates local `distance` + `travelTime` state; renders in existing modal sections.
13. Booking + opening hours: confirm chat-mount renders them when adapter carries them; for intent, fixed by Root Cause #3 cascade.
14. Backfill scope expanded: covers `messages.card_payload` + `board_saved_cards.card_data` (mirrors ORCH-0908 v2 pattern).
15. Adversarial test: a single chat-shared card with `placeId` present produces a busyness fetch (proves RC #4 didn't regress).
16. Regression test: a chat-shared single card with `location` produces a Distance Matrix call from a mocked viewer GPS (proves RC #5 contributing factor works).

### Confidence summary (updated)

- Root causes #1, #2, #3, #4 — **HIGH** (code-traced + operator live-fire for intent).
- Cell A bubble — **HIGH** (Pineapple Sol screenshot live-fire).
- Cell A expanded sheet — **HIGH** that busyness is broken (RC #4 traced), HIGH that traffic is null by design (lines 48-49), MEDIUM that weather is missing (operator-reported; sim re-verify in TEST).
- Cell B bubble — **MEDIUM** still (no fresh screenshot; ORCH-0908 v2 trace stands).
- Backfill scope — **HIGH** for both tables.
