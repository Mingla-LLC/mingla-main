# INVESTIGATION — ORCH-0685 — Shared-card chat bubble shows raw category slug + missing rich details

**Mode:** INVESTIGATE-ONLY
**Severity:** S1-high (degrades a primary social action that ships in production today)
**Confidence:** HIGH on root cause, schema, code-path trace, symmetry, classification. MEDIUM on locale completeness across all 28 locales (audited 3 spot-checked: en, es, fr).
**Date:** 2026-04-25
**Investigator:** Mingla Forensics (orchestrator-dispatched, user invoked TAKE OVER)
**Dispatch:** [prompts/FORENSICS_ORCH-0685_SHARED_CARD_BUBBLE_DETAILS.md](../prompts/FORENSICS_ORCH-0685_SHARED_CARD_BUBBLE_DETAILS.md)
**Prior art:** [specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md), [reports/INVESTIGATION_ORCH-0667_SHARE_SAVED_CARD.md](INVESTIGATION_ORCH-0667_SHARE_SAVED_CARD.md)

---

## 1 — Layman summary

When a user shares a saved card in a 1:1 chat, the bubble that renders shows only the image, the title, a chip with a raw category slug like `casual_food` instead of "Casual", and a "Tap to view" hint. Nothing else. The price tier, star rating, address, highlights, and description that the system already wrote to the database in `messages.card_payload` are silently dropped at render time. The translation helper that converts slugs to readable labels exists in the codebase and works — it is simply never imported into the chat code path.

Both the sender and the recipient see the same impoverished bubble. It is symmetric: the optimistic-send path and the realtime-receive path both render through one component (`MessageBubble`) which renders one set of fields. Neither path is privileged.

The data is not the problem. The schema persists 9 fields. The bubble consumes 3. This is a render-side omission compounded by a missing translation call — and underneath it, a spec that under-specified what "rich card preview in chat" should mean.

---

## 2 — Symptom summary

| Field | Value |
|-------|-------|
| **Expected** | Shared card bubble shows enough to evaluate the experience without tapping in: name, image, **readable** category label, price tier, rating, address. Both sender and recipient see the same. |
| **Actual** | Shared card bubble shows only image + title + raw slug chip (`casual_food`, `nature`, `drinks_and_music`) + tap hint. Rating/price/address/highlights/description are absent from the render even though they are present in `card_payload`. |
| **Reproduction** | 100% deterministic. Every shared card on every device renders the same minimal bubble for both parties. |
| **Bisect** | This is the implementation as shipped under ORCH-0667 (commit window ending 2026-04-25). It has never rendered any other way. Missing-feature class, not regression. The hypothesis "Implementor followed the spec literally and the spec is the boundary" is confirmed below. |

---

## 3 — Investigation manifest

| # | File | Why |
|---|------|-----|
| 1 | [Mingla_Artifacts/specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md) §6, §10.3, §10.4 | Confirm what the binding spec required for `CardPayload` fields and bubble layout |
| 2 | [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0667_SHARE_SAVED_CARD.md](INVESTIGATION_ORCH-0667_SHARE_SAVED_CARD.md) §9 | Cross-reference the prior fix-strategy direction |
| 3 | [app-mobile/src/services/messagingService.ts:6-88](../../app-mobile/src/services/messagingService.ts#L6-L88) | `CardPayload` interface + `trimCardPayload` field inventory |
| 4 | [app-mobile/src/services/messagingService.ts:583-620](../../app-mobile/src/services/messagingService.ts#L583-L620) | `sendCardMessage` — what shape goes into `messages.card_payload` |
| 5 | [app-mobile/src/components/chat/MessageBubble.tsx:1-23](../../app-mobile/src/components/chat/MessageBubble.tsx#L1-L23) | Imports + MessageData interface — confirm no `getReadableCategoryName` import |
| 6 | [app-mobile/src/components/chat/MessageBubble.tsx:238-284](../../app-mobile/src/components/chat/MessageBubble.tsx#L238-L284) | The card-bubble branch — inventory of fields actually rendered |
| 7 | [app-mobile/src/components/MessageInterface.tsx:1292-1376](../../app-mobile/src/components/MessageInterface.tsx#L1292-L1376) | Picker preview row — second slug-leak site |
| 8 | [app-mobile/src/components/MessageInterface.tsx:925-950](../../app-mobile/src/components/MessageInterface.tsx#L925-L950) | `<MessageBubble>` props wiring — confirm `cardPayload` is passed |
| 9 | [app-mobile/src/components/ConnectionsPage.tsx:947-966](../../app-mobile/src/components/ConnectionsPage.tsx#L947-L966) | `transformMessage` — DB row → render shape; confirm `cardPayload` propagated |
| 10 | [app-mobile/src/utils/categoryUtils.ts:46-117](../../app-mobile/src/utils/categoryUtils.ts#L46-L117) | `getReadableCategoryName` exists and works (legacy resolution + i18n + title-case fallback) |
| 11 | [app-mobile/src/services/savedCardsService.ts:5-64](../../app-mobile/src/services/savedCardsService.ts#L5-L64) | Confirm `SavedCardModel.category` originates as a slug (`cardData.category \|\| record.category`) — not pre-translated |
| 12 | [app-mobile/src/i18n/locales/en/common.json:62-84](../../app-mobile/src/i18n/locales/en/common.json#L62-L84) | Confirm `common:category_*` keys exist for the 13 slugs (en) |
| 13 | `app-mobile/src/i18n/locales/{es,fr}/common.json` (grep counts) | Locale parity spot-check (en=23, es=23, **fr=13** — 10-key gap) |

---

## 4 — Findings

### 🔴 RC-1 — Bubble component renders `cardPayload.category` as a raw string with no translation lookup

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/components/chat/MessageBubble.tsx:263-269](../../app-mobile/src/components/chat/MessageBubble.tsx#L263-L269) |
| **Exact code** | `{message.cardPayload.category ? (`<br>`  <View style={styles.cardBubbleChip}>`<br>`    <Text style={styles.cardBubbleChipText} numberOfLines={1}>`<br>`      {message.cardPayload.category}`<br>`    </Text>`<br>`  </View>`<br>`) : null}` |
| **What it does** | Reads `message.cardPayload.category` (a slug like `casual_food`, `nature`, `drinks_and_music`, `upscale_fine_dining`, `creative_arts`, `play`, `brunch`, `theatre`, `movies`, `flowers`, `groceries` per [categoryUtils.ts:25-36](../../app-mobile/src/utils/categoryUtils.ts#L25-L36)) and renders it verbatim inside a `<Text>`. No i18n lookup. No legacy-slug normalization. |
| **What it should do** | Either (a) call `getReadableCategoryName(message.cardPayload.category)` from [categoryUtils.ts:50](../../app-mobile/src/utils/categoryUtils.ts#L50) at render time, or (b) read a pre-translated label that the trim function wrote in. Today it does neither. |
| **Causal chain** | User shares card → `trimCardPayload` at [messagingService.ts:53-88](../../app-mobile/src/services/messagingService.ts#L53-L88) copies `card.category` (slug) verbatim into `cardPayload.category` (line 57: `category: card.category ?? null`) → row inserted into `messages` table → enriched message returned to sender's UI **AND** delivered via realtime to recipient's UI → both UIs pass the message through `transformMessage` ([ConnectionsPage.tsx:959](../../app-mobile/src/components/ConnectionsPage.tsx#L959)) which propagates `cardPayload` unchanged → both UIs render the bubble through `MessageBubble.tsx:238-277` card branch → both UIs reach line 266 and render the slug. |
| **Verification** | Grep for `getReadableCategoryName` in [chat/MessageBubble.tsx](../../app-mobile/src/components/chat/MessageBubble.tsx) returns **zero matches**. Imports at lines 1-8 reference `colors`, `typography`, `fontWeights`, `radius`, `spacing`, `MentionChip`, `ReplyQuoteBlock`, `CardPayload` — no category utility import. The slug → label conversion never happens in this code path. **Confidence: HIGH.** |

### 🔴 RC-2 — Bubble component renders only 3 of 9 persisted fields (rating, priceRange, address, highlights, description, reviewCount, matchScore, images dropped at render)

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/components/chat/MessageBubble.tsx:238-277](../../app-mobile/src/components/chat/MessageBubble.tsx#L238-L277) (card branch JSX) |
| **What it does** | Renders 4 elements: (1) image OR bookmark-icon placeholder, (2) `cardPayload.title`, (3) `cardPayload.category` chip (raw slug — see RC-1), (4) `t('chat:cardBubbleTapHint')` static text. **Nothing else from `cardPayload` is touched.** |
| **What it should do** | Per the user's actual ask, render enough to evaluate the experience without tapping in — at minimum some combination of price tier, rating, address. Spec writer owns the exact shortlist; the symptom is that the user can see this is "missing key details." |
| **Causal chain** | Same trim function ([messagingService.ts:53-88](../../app-mobile/src/services/messagingService.ts#L53-L88)) writes `images`, `rating`, `reviewCount`, `priceRange`, `address`, `description`, `highlights`, `matchScore` into the persisted JSON — confirmed by lines 61-76 of the trim function. The DB carries the data. The bubble JSX never reads it. |
| **Verification** | Inspected the entire card branch (lines 238-277). The only `cardPayload.` accesses are `.image`, `.title`, `.category`. Grep for `cardPayload\.(rating\|priceRange\|address\|highlights\|description\|reviewCount\|matchScore\|images)` in MessageBubble.tsx returns **zero matches**. **Confidence: HIGH.** |

### 🟠 CF-1 — Picker preview row renders the same raw slug under the title

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/components/MessageInterface.tsx:1361-1368](../../app-mobile/src/components/MessageInterface.tsx#L1361-L1368) |
| **Exact code** | `<View style={styles.savedCardInfo}>`<br>`  <Text style={styles.savedCardTitle} numberOfLines={1}>`<br>`    {card.title}`<br>`  </Text>`<br>`  <Text style={styles.savedCardSubtitle} numberOfLines={1}>`<br>`    {isSubmitting ? t('chat:cardSending') : (card.category \|\| '')}`<br>`  </Text>`<br>`</View>` |
| **What it contributes** | This is the *picker* — the modal the sender sees when choosing which card to share, before any DB write. The row subtitle renders `card.category` raw (same slug source as the bubble). So the sender sees the slug **twice**: once in the picker before sending, and once in the bubble after sending. |
| **Why classified as Contributing Factor, not Root Cause** | The user's report focuses on the bubble. The picker is a parallel render of the same data with the same omission, but it is a distinct surface. Fixing only the bubble would leave the picker leaking. Fixing both is one decision; classifying them as twin sites of the same omission keeps the spec scope honest. |
| **Confidence** | **HIGH.** |

### 🟠 CF-2 — Spec under-specified the bubble layout and was silent on translation

| Field | Evidence |
|-------|----------|
| **File + line** | [Mingla_Artifacts/specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md §10.3](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md) (lines 728-765 in spec) |
| **Spec verbatim** | `{message.cardPayload.category ? (`<br>`  <View style={styles.cardBubbleChip}>`<br>`    <Text style={styles.cardBubbleChipText}>{message.cardPayload.category}</Text>`<br>`  </View>`<br>`) : null}` — spec wrote the slug-render directly. No translation call. No rating/price/address/highlight chips. |
| **Spec §6 schema verbatim** | `category: string \| null;       // chip render` — comment says "chip render" but does not say "translate slug to label." |
| **Why classified as Contributing Factor, not Root Cause** | The implementor faithfully shipped what the spec asked for (RC-1 and RC-2 confirm). The spec, however, is a contract. A contract that under-specifies translation and omits the rich-detail chips does not produce a rich bubble. This is the **boundary cause**: the implementor cannot exceed the spec without scope creep. The spec author drew the boundary too tight. |
| **What the spec did right** | §6.2 (field-by-field justification table) **explicitly listed `rating`, `reviewCount`, `priceRange`, `address`, `description`, `highlights`, `matchScore`, `images` as "Modal info / body / location / highlights / match badge" — i.e., reserved for the ExpandedCardModal that opens on tap, not the bubble itself.** The bubble was intentionally minimal-by-design. The user is now telling us that intent was wrong; the bubble needs more. |
| **Confidence** | **HIGH.** |

### 🟡 HF-1 — `category_groceries` i18n key is missing from `en/common.json`; if a groceries card is shared the bubble (after fix) would still show "Groceries" only via the title-case fallback path

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/i18n/locales/en/common.json:62-84](../../app-mobile/src/i18n/locales/en/common.json#L62-L84) |
| **Detail** | Visible category keys present: `category_nature`, `category_icebreakers`, `category_drinks_and_music`, `category_brunch`, `category_casual_food`, `category_brunch_lunch_casual` (legacy), `category_upscale_fine_dining`, `category_movies`, `category_theatre`, `category_movies_theatre` (legacy), `category_creative_arts`, `category_play`, `category_nature_views`, `category_flowers`. Notable: `category_groceries` is absent. Per `categoryUtils.ts:13`, `groceries` is a hidden category — it should not appear in user-facing flows. But if a card with `category='groceries'` were ever shared (e.g., a curated edge case), the bubble would render "Groceries" via the title-case fallback in `getReadableCategoryName` ([categoryUtils.ts:113-114](../../app-mobile/src/utils/categoryUtils.ts#L113-L114)) — which is graceful but not locale-aware. |
| **Why hidden flaw, not contributing factor** | Doesn't cause today's symptom (the symptom is that even fully-mapped slugs leak). But becomes relevant the moment the spec wires in `getReadableCategoryName`. Spec writer must decide whether to (a) add `category_groceries` to all 28 locale `common.json` files, or (b) accept the title-case fallback for hidden categories, or (c) filter shareable cards to visible categories only at the picker layer. |
| **Confidence** | **HIGH** that the key is missing in en. **MEDIUM** on the right resolution path. |

### 🟡 HF-2 — French locale `common.json` has 13 `category_*` keys vs en's 23; many slugs would fall through to title-case fallback in fr — partial-translation surface

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/i18n/locales/fr/common.json` (count via `grep -c "category_"` returned 13). en and es both return 23. |
| **Detail** | Once `getReadableCategoryName` is wired into the bubble, fr-locale users will see English-style title-case fallbacks (e.g., "Casual Food", "Drinks And Music") for slugs missing in fr's `common.json`. This is graceful (not a crash) but creates a partial-translation experience. |
| **Why hidden flaw, not contributing factor** | Doesn't cause today's symptom. Becomes visible only after the fix lands. Must be on the spec-writer's checklist. |
| **Confidence** | **MEDIUM.** Spot-check via grep count; did not enumerate which specific keys are missing in fr or audit all 28 locales. |

### 🟡 HF-3 — Picker preview row uses raw slug as subtitle in lieu of rich detail (parallel impoverishment)

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/components/MessageInterface.tsx:1361-1368](../../app-mobile/src/components/MessageInterface.tsx#L1361-L1368) |
| **Detail** | The picker row (which is what the sender uses to *choose* which card to share) shows only image + title + slug. No rating, no price, no address. If the user has 12 saved cards all in the same category, the subtitle is identical for every row — providing no disambiguation. This is a parallel UX gap to the bubble itself. |
| **Why hidden flaw, not contributing factor** | The user's report did not call out the picker explicitly, only the chat bubble. But fixing the bubble while leaving the picker bare would be inconsistent. Likely the spec-writer should align the picker preview with the bubble's rich-detail set, OR explicitly accept that picker-row density differs from bubble density (denser bubble, terser picker — both are defensible). |
| **Confidence** | **HIGH.** |

### 🔵 OBS-1 — Sender and recipient render through the exact same component and field set; **no asymmetry**

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/components/MessageInterface.tsx:925-950](../../app-mobile/src/components/MessageInterface.tsx#L925-L950) (single `<MessageBubble>` JSX block, used for both directions) |
| **Detail** | The sender's optimistic-send path returns the enriched message from `sendCardMessage` ([messagingService.ts:617](../../app-mobile/src/services/messagingService.ts#L617)) which contains the same `card_payload` shape as a realtime-fetched row (the row IS the row that was inserted; both sides read from the DB-shaped object). Both sides go through `transformMessage` at [ConnectionsPage.tsx:947-966](../../app-mobile/src/components/ConnectionsPage.tsx#L947-L966) which propagates `cardPayload` unchanged. Both sides then render through the same `<MessageBubble cardPayload={...}>` at MessageInterface.tsx:925-950. **One render path. One bug.** |
| **Implication** | The user's perception that "it's broken from each of our perspectives" is correct, and the technical reason is that there is only one perspective at the render layer — both the sender's optimistic copy and the recipient's realtime copy hit the same JSX. The bubble's slug-leak applies symmetrically. |

### 🔵 OBS-2 — Group-chat (multi-recipient direct) path: out of v1 scope per ORCH-0667 D-1, no separate code path exists

| Field | Evidence |
|-------|----------|
| **File + line** | [Mingla_Artifacts/specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md §2.2](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md) (Non-goals) — "Share-card UI on Board Discussions / Collab session chat — deferred ORCH-0667.D-1" |
| **Detail** | Confirmed by grep across `BoardDiscussionTab.tsx`, `BoardDiscussion.tsx`, `board/CardDiscussionModal.tsx`, `SessionViewModal.tsx` — none of them mount the share-card picker. Group-chat surface is a non-goal for ORCH-0667 and remains so. ORCH-0685 fix should match scope: 1:1 DM only. |
| **Why observation** | Bounds the spec writer's scope. No separate render path to audit. |

### 🔵 OBS-3 — `getReadableCategoryName` is a known, working, tested helper that already handles legacy slugs and i18n fallbacks

| Field | Evidence |
|-------|----------|
| **File + line** | [app-mobile/src/utils/categoryUtils.ts:46-117](../../app-mobile/src/utils/categoryUtils.ts#L46-L117) |
| **Detail** | The helper already: (a) resolves ~50 legacy slug aliases to current canonical slugs (lines 53-100), (b) strips `category.` and `screen_` prefixes, (c) calls `i18n.t('common:category_${slug}')` with locale awareness, (d) detects "key not found" via `translated === key` and falls back to title-cased slug (lines 113-114). It is the canonical answer for slug → label conversion in this app. Used elsewhere (in cards, chips, filters) — not novel infrastructure. |
| **Why observation** | The fix is "import this and call it." The infrastructure is in place. |

---

## 5 — Field inventory table

This is the contractual artifact the spec-writer needs. Every field in `CardPayload`, where it is persisted, where it is consumed.

| Field | Persisted in `card_payload`? | Where (file:line) | Rendered in **picker row**? | Rendered in **bubble**? | Notes |
|-------|------------------------------|-------------------|----------------------------|--------------------------|-------|
| `id` | YES | [messagingService.ts:55](../../app-mobile/src/services/messagingService.ts#L55) | NO | NO (used as React key in tap handler — not visual) | Analytics dedup only. |
| `title` | YES | [messagingService.ts:56](../../app-mobile/src/services/messagingService.ts#L56) | YES — [MessageInterface.tsx:1363](../../app-mobile/src/components/MessageInterface.tsx#L1363) | YES — [MessageBubble.tsx:261](../../app-mobile/src/components/chat/MessageBubble.tsx#L261) | Both display surfaces. ✓ |
| `category` | YES | [messagingService.ts:57](../../app-mobile/src/services/messagingService.ts#L57) — copies slug verbatim | YES (raw slug) — [MessageInterface.tsx:1366](../../app-mobile/src/components/MessageInterface.tsx#L1366) | YES (raw slug) — [MessageBubble.tsx:266](../../app-mobile/src/components/chat/MessageBubble.tsx#L266) | **RC-1: needs `getReadableCategoryName()` lookup.** |
| `image` | YES | [messagingService.ts:58](../../app-mobile/src/services/messagingService.ts#L58) | YES — [MessageInterface.tsx:1351-1359](../../app-mobile/src/components/MessageInterface.tsx#L1351-L1359) | YES — [MessageBubble.tsx:245-255](../../app-mobile/src/components/chat/MessageBubble.tsx#L245-L255) | Both display surfaces. ✓ |
| `images[]` | YES (cap 6) | [messagingService.ts:61-63](../../app-mobile/src/services/messagingService.ts#L61-L63) | NO | NO | Reserved for ExpandedCardModal (per spec §6.2). |
| `rating` | YES | [messagingService.ts:64](../../app-mobile/src/services/messagingService.ts#L64) | NO | **NO** — RC-2 | Persisted, never displayed in chat surfaces. |
| `reviewCount` | YES | [messagingService.ts:65](../../app-mobile/src/services/messagingService.ts#L65) | NO | **NO** — RC-2 | Persisted, never displayed. |
| `priceRange` | YES | [messagingService.ts:66](../../app-mobile/src/services/messagingService.ts#L66) | NO | **NO** — RC-2 | Persisted, never displayed. |
| `address` | YES | [messagingService.ts:67](../../app-mobile/src/services/messagingService.ts#L67) | NO | **NO** — RC-2 | Persisted, never displayed. |
| `description` | YES (cap 500 chars) | [messagingService.ts:68-70](../../app-mobile/src/services/messagingService.ts#L68-L70) | NO | **NO** — RC-2 | Persisted, never displayed. |
| `highlights[]` | YES (cap 5×80 chars) | [messagingService.ts:71-75](../../app-mobile/src/services/messagingService.ts#L71-L75) | NO | **NO** — RC-2 | Persisted, never displayed. |
| `matchScore` | YES | [messagingService.ts:76](../../app-mobile/src/services/messagingService.ts#L76) | NO | **NO** — RC-2 | Persisted, never displayed. |

**Summary:** 9 of 12 persisted fields (`images`, `rating`, `reviewCount`, `priceRange`, `address`, `description`, `highlights`, `matchScore` — and `id` which is intentionally non-visual) are paid for in storage and bandwidth, then dropped at render. Of the 3 fields rendered in the bubble, 1 (category) is rendered in the wrong form (slug instead of label).

---

## 6 — Slug rendering proof

### 6.1 Exact slug-render line

[app-mobile/src/components/chat/MessageBubble.tsx:266](../../app-mobile/src/components/chat/MessageBubble.tsx#L266):
```tsx
{message.cardPayload.category}
```

### 6.2 `getReadableCategoryName` signature

[app-mobile/src/utils/categoryUtils.ts:50](../../app-mobile/src/utils/categoryUtils.ts#L50):
```typescript
export const getReadableCategoryName = (categoryKey: string): string => {
  if (!categoryKey) return 'Experience';
  // ... legacyToSlug normalization ...
  // ... strip 'category.' prefix ...
  const slug = legacyToSlug[stripped] ?? legacyToSlug[categoryKey] ?? stripped;
  const normalizedSlug = slug.replace(/-/g, '_').toLowerCase();
  const key = `common:category_${normalizedSlug}`;
  const translated = i18n.t(key);
  if (translated === key) {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return translated;
};
```

### 6.3 Import audit

| File | Imports `getReadableCategoryName`? | Uses `cardPayload.category` raw? |
|------|------------------------------------|----------------------------------|
| `app-mobile/src/components/chat/MessageBubble.tsx` | **NO** (verified by grep — imports at lines 1-8 contain no categoryUtils reference) | **YES** at line 266 |
| `app-mobile/src/components/MessageInterface.tsx` | **NO** (verified by grep) | **YES** at line 1366 (picker row subtitle) |

### 6.4 i18n key existence (en/common.json)

| Slug | Key in en/common.json? | Line |
|------|------------------------|------|
| `nature` | YES | 62 |
| `icebreakers` | YES | 63 |
| `drinks_and_music` | YES | 64 |
| `brunch` | YES | 65 |
| `casual_food` | YES | 67 |
| `upscale_fine_dining` | YES | 69 |
| `movies` | YES | 70 |
| `theatre` | YES | 71 |
| `creative_arts` | YES | 73 |
| `play` | YES | 74 |
| `flowers` | YES | 84 (mapped to "Nature & Views" — debatable but present) |
| `groceries` | **NO** — would fall through to title-case fallback | — |
| `brunch_lunch_casual` (legacy) | YES | 68 |
| `movies_theatre` (legacy) | YES | 72 |

10 of 10 visible slugs are mapped. 1 hidden slug (groceries) is not. Fallback path is graceful.

### 6.5 Locale parity

| Locale | `category_*` count |
|--------|---------------------|
| en | 23 |
| es | 23 |
| fr | **13** |

fr is 10 keys short of en (HF-2). Other 25 locales not enumerated; spec writer should commission a full audit before declaring i18n complete.

---

## 7 — Sender vs recipient render path

### 7.1 Sender path

1. User taps card in picker → `handleSelectCardToShare(card)` at [MessageInterface.tsx:627](../../app-mobile/src/components/MessageInterface.tsx#L627)
2. → `messagingService.sendCardMessage(conversationId, senderId, card)` at [messagingService.ts:589](../../app-mobile/src/services/messagingService.ts#L589)
3. → `trimCardPayload(card)` produces a `CardPayload` with the slug copied verbatim ([messagingService.ts:53-88](../../app-mobile/src/services/messagingService.ts#L53-L88))
4. → INSERT into `messages` with `message_type='card', card_payload=<trimmed>`
5. → DB returns the inserted row (full row including `card_payload`)
6. → `enrichMessage` returns `DirectMessage` with `card_payload` field populated
7. → Sender's local message-list state appends this enriched message
8. → React re-renders → `<MessageBubble message={...cardPayload}>` → renders slug

### 7.2 Recipient path

1. Postgres CDC fires INSERT event on the `messages` table
2. → Realtime subscription handler in `messagingService.ts:686-694` returns `{...message}` (full row, including `card_payload`)
3. → Recipient's local message-list state appends the realtime message
4. → `transformMessage` at [ConnectionsPage.tsx:947-966](../../app-mobile/src/components/ConnectionsPage.tsx#L947-L966) maps `msg.card_payload → cardPayload` (line 959)
5. → React re-renders → `<MessageBubble message={...cardPayload}>` → renders slug

### 7.3 Symmetry verdict

**No asymmetry.** Both paths converge on the same `MessageBubble` instance with structurally identical `cardPayload` (same DB row in both cases — sender reads the just-inserted row, recipient reads the same row via CDC). Both renders produce the same slug-only chip and the same minimal field set. The user's intuition that "from each of our perspectives" the card is broken is correct because there is one render path for both perspectives.

---

## 8 — Five-truth-layer reconciliation

| Layer | Source-of-truth read | Verdict |
|-------|----------------------|---------|
| **Docs** | [SPEC_ORCH-0667 §6 (CardPayload schema)](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md), §6.2 (field-by-field justification — explicitly reserves rating/price/etc for ExpandedCardModal not the bubble), §10.3 (bubble JSX renders raw `cardPayload.category`), §13 SC list (no SC asserts category is rendered as a translated label; no SC asserts price/rating/address appears in the bubble). The spec is **self-consistent and shipped exactly as written**. |
| **Schema** | `messages.card_payload jsonb`, soft-required when `message_type='card'` (migration `20260425000001_orch_0667_add_card_message_type.sql`, applied per ORCH-0667 close). Schema persists ALL 9+ optional fields. Schema is permissive — it stores rich data. |
| **Code** | [MessageBubble.tsx:238-277](../../app-mobile/src/components/chat/MessageBubble.tsx#L238-L277) renders 3 fields. [MessageInterface.tsx:1361-1368](../../app-mobile/src/components/MessageInterface.tsx#L1361-L1368) renders 2 fields. No translation lookup at either site. Code is **strict subset** of what schema allows. |
| **Runtime** | Cannot capture device logs in this pass. But the code-path trace is deterministic — every shared card, every send, every receive will produce the same render output because the JSX is unconditional within the card branch. |
| **Data** | Did not run a SQL probe in this pass (would require live DB credentials and the OPTIONAL probe was not performed). However, the trim function's output is structurally provable: any non-trivial card flowing through `trimCardPayload` will produce a `card_payload` JSON containing rating/priceRange/address/etc IF those fields exist on the source `SavedCardModel`. The DB carries the data; the UI ignores it. |

**Verdict:** Layers do not contradict each other in a *broken* way. They contradict each other in a *truthful* way: docs (the spec) say "the bubble renders these 3 fields and category as a slug." Schema says "I can persist 9 fields." Code says "I will render the 3 the spec asked for." The disagreement is between **the user's expectation** and **the spec's intent** — not between layers. This is the signature of a spec-compliance gap, not a code defect.

---

## 9 — Root cause classification

**Verdict: BOTH a code defect AND a spec-compliance gap, but predominantly the latter.**

| Aspect | Code defect | Spec-compliance gap |
|--------|-------------|---------------------|
| Slug instead of translated label | Possible: implementor could have called `getReadableCategoryName` defensively. | But: the spec ([SPEC_ORCH-0667 §10.3](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md)) wrote `<Text>{message.cardPayload.category}</Text>` literally. The implementor matched it. |
| Missing rich-detail chips | Possible: implementor could have added chips beyond what spec asked. | But: the spec [§6.2](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md) explicitly justified rating/price/address as **modal-only** content, not bubble content. Implementor honored the boundary. |

**Justification for "predominantly spec gap":** A spec is a binding contract. The implementor cannot exceed the spec without scope creep, and orchestrator REVIEW would (correctly) reject expansion. The spec author drew the boundary too tight. The user's report at 2026-04-25 (this orchestrator intake) is the first evidence that the boundary was wrong.

**Severity stays S1.** It's a primary social action, user-visible, and the slug-leak is technically a Constitution #3 candidate (silent translation failure surfacing as raw machine string in user-facing chrome — see §10).

---

## 10 — Constitutional check

| # | Principle | Violated by ORCH-0685? | Reasoning |
|---|-----------|------------------------|-----------|
| **#1** | No dead taps | NO | Tap-to-expand opens `ExpandedCardModal` correctly (verified by spec §10.3 wiring at [MessageBubble.tsx:240-241](../../app-mobile/src/components/chat/MessageBubble.tsx#L240-L241)). The bubble is interactive. |
| **#2** | One owner per truth | NO | Card data flows through one schema column (`card_payload`), one trim function, one render component. No duplicate state authority. |
| **#3** | No silent failures — errors must surface, never swallow | **YES (in spirit)** | The slug-leak is a *silent translation failure*. The translation layer exists, would resolve the slug to a label, but is never called. The user-facing artifact is a raw machine string (`casual_food`) presented as if it were a label. This is a "silent loss of meaning" — not an exception swallowed, but a transformation skipped. The chat surface is hiding the fact that a translation step is missing. |
| **#4** | One query key per entity | NO | Picker uses existing `savedCardKeys.list(userId)` factory. No drift. |
| **#5** | Server state stays server-side | NO | Bubble reads from React Query / message-list state — not Zustand. |
| **#6** | Logout clears everything | N/A | No session-leak surface here. |
| **#7** | Label temporary fixes | N/A | No transitional code in scope. |
| **#8** | Subtract before adding | NO (but a spec-side reminder applies) | When the bubble is enriched, the picker preview should be aligned (HF-3) — not parallel-evolved. |
| **#9** | No fabricated data — never show fake ratings, prices, times | NO (defensively HONORED) | Per spec §6.2, recipient-relative fields (`travelTime`, `distanceKm`, `travelTimeMin`) are deliberately excluded from `card_payload` because the sender's value would fabricate for the recipient. **This is correct and must be preserved when the bubble is enriched.** Spec-writer must NOT add `travelTime` or `distance` to the bubble — those are recipient-computed, not sender-snapshotted. Cross-ref ORCH-0659/0660 lesson. |
| **#10** | Currency-aware UI | **AT RISK (preventive, not violated yet)** | `priceRange` is currently NOT rendered. If the spec adds a price chip, it must respect the user's locale: a `$$$` from a US-shared card should still render as `$$$` to a UK recipient (price-tier symbols are universal), but if the spec ever proposes literal currency amounts (e.g., "$45 entrée"), then locale-aware formatting becomes mandatory. The current `priceRange` shape (per `SavedCardModel`) is a string like `"$$"` — symbol-tier, not amount, so it's safe. **Spec-writer must verify shape at field-add time.** |
| **#11** | One auth instance | N/A | — |
| **#12** | Validate at the right time | N/A | — |
| **#13** | Exclusion consistency | NO | RLS unchanged; participants-only access holds for card messages. |
| **#14** | Persisted-state startup | NO | Card messages persist correctly in the message list cache. |

**Net constitutional load:** 1 active in-spirit violation (#3), 1 preventive risk for the spec-writer (#10), 1 preserved invariant the spec-writer must NOT break (#9 — never add `travelTime`/`distance` to the bubble).

---

## 11 — Blast radius

| Surface | Affected today? | After fix |
|---------|-----------------|-----------|
| 1:1 DM chat — sender side | YES (slug + missing details) | Fixed |
| 1:1 DM chat — recipient side | YES (slug + missing details) | Fixed |
| 1:1 DM chat — picker preview | YES (slug + missing details) | Fix should align (HF-3) |
| Group / multi-recipient DM | N/A — no group share path exists for ORCH-0667 (deferred D-1) | No change |
| Board discussion / collab session chat | N/A — no share-card UI per OBS-2 | No change |
| ExpandedCardModal opened from bubble tap | NO — modal already renders rich data because it consumes the full `card_payload` JSON | No change needed |
| Saved card page itself (`SavedTab`) | NO — uses `SavedCardModel` directly, not the trim form | No change |
| Admin dashboard | NO — admin doesn't render chat content | No change |
| Realtime subscription | NO — propagates `card_payload` correctly already | No change |
| Storage size | NO — trim function size guard preserves <5KB | No change |
| Push notifications | NO — push body uses `cardTitle` (already a string), not `category` | No change |

**Affected query keys:** None — fix is render-layer only. No invalidation needed.

**Cross-domain:** Mobile only.

**Locale impact (post-fix):** All 28 locales must have full `common:category_*` coverage to avoid mixed-language bubble chips. Audit needed (HF-2).

---

## 12 — Invariant violations

| Invariant ID | Violated? | Notes |
|--------------|-----------|-------|
| **I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS** (per ORCH-0667 §15.1) | **NO** | Persisted payload always contains `{id, title, category, image}`. This invariant is satisfied even though render is partial. |
| **I-DM-PARTICIPANTS-ONLY** (RLS) | NO | Unchanged. |
| **I-MESSAGE-IMMUTABILITY** | NO | No UPDATE on card messages. |

**No new invariant violations.** ORCH-0685 is a render-omission and translation-skip, not a data-integrity bug.

---

## 13 — Fix strategy (direction only — not a spec)

The spec writer must bind the following decisions:

1. **Translation wiring** — call `getReadableCategoryName(cardPayload.category)` at render time in the bubble AND in the picker preview row. Recommended over translating-at-trim-time because: (a) it is locale-reactive — recipient sees the label in their locale, not the sender's; (b) i18n keys can be updated without re-migrating data; (c) the helper already handles legacy slug normalization centrally.
2. **Bubble enrichment field set** — minimum-viable: title + image + translated category chip + price chip (when present) + rating chip (when present, e.g., "★ 4.6"). Maximum-defensible: add address one-line + 2 highlights stacked. **The spec writer must commit to a specific shortlist** so the implementor cannot interpret "rich" loosely.
3. **Preserve fabrication boundaries** — DO NOT add `travelTime`, `distanceKm`, `travelTimeMin` to the bubble. These are recipient-relative and the persisted snapshot does not (and must not) carry them (per Constitution #9 + spec §6.2). If distance is desired in the bubble, it must be computed at render time on the recipient's device — but this is out-of-scope for ORCH-0685 unless the user explicitly asks.
4. **Picker-row alignment** — decide whether the picker preview matches the bubble (consistent richness, more information density) or stays denser (smaller rows, more cards visible at once with terser preview). Both are defensible; spec writer commits to one.
5. **Hidden-category handling** — decide whether `groceries` cards should be shareable at all, or whether the picker should filter to visible-categories-only at fetch time. If shareable, add `category_groceries` to all locale `common.json` files.
6. **Locale audit** — before shipping, audit all 28 `common.json` files for `category_*` key parity. Reuse the HF-2 finding to scope the audit.
7. **Subtraction (Constitution #8)** — none required. The current code is not pattern-violating; it is feature-incomplete. No deletion before addition.
8. **Regression prevention** — add a CI grep gate that fails if `cardPayload.category` is rendered without a `getReadableCategoryName` wrapper. The pattern is narrow enough to enforce structurally.

**Estimated implementor surface (rough):** 1 import + 1 call site widened (bubble), 1 import + 1 call site widened (picker), 3-5 new chip styles in MessageBubble StyleSheet, ~10-15 new i18n keys (rating-chip and price-chip labels if any), translation propagation across 28 locale files (auto-machine), 1 CI grep gate. Total: ~3-4 hours of implementor time, single-pass scope.

---

## 14 — Discoveries register

| ID | Title | Recommendation |
|----|-------|----------------|
| **ORCH-0685.D-1** | Picker preview row impoverishment (HF-3) — same slug-leak + missing details applied to picker subtitle | **BUNDLE** into ORCH-0685 fix. Same translation call, same enrichment principles. Out-of-spec to fix bubble while leaving picker bare. |
| **ORCH-0685.D-2** | Locale parity audit — fr has 13 of 23 expected `category_*` keys (HF-2); 25 other locales unaudited | **BUNDLE** as a verification step in the spec. Spec writer should commission a full count and gate ship on parity OR explicitly accept fallback-only rendering for missing-locale slugs (graceful but English-leaking). |
| **ORCH-0685.D-3** | `category_groceries` missing in en/common.json (HF-1); hidden category, may not need to be addressed if picker filters to visible categories only | **DEFER** unless user wants groceries shareable. Document as known fallback case. |
| **ORCH-0685.D-4** | Group-chat / board-discussion share path (ORCH-0667.D-1 still deferred) | **NO CHANGE** — out of ORCH-0685 scope. ORCH-0667.D-1 still tracks this. |
| **ORCH-0685.D-5** | Distance/travel-time on the bubble — out-of-scope per Constitution #9 + ORCH-0659/0660 lesson | **NON-GOAL.** Spec writer must explicitly mark as non-goal to prevent scope creep. |

---

## 15 — Open questions for the spec-writer

1. **What is the minimum-viable detail set for the bubble?** Title + image + translated category chip is the floor (matches user complaint about slugs). Above the floor, what is mandatory: price chip? rating chip? address one-liner? short highlights list? Pick a specific shortlist.
2. **Should the picker preview match the bubble exactly, or stay denser?** Two defensible UX choices — pick one.
3. **Should the slug → label translation happen at render time (recommended) or at trim time (locale-frozen at send)?** Render-time is locale-reactive but adds a function call per render; trim-time is one-shot but freezes the label in the sender's locale. Pick one.
4. **For `priceRange`, is the rendering shape a symbol tier (`$$$`) or an amount (`$45`)?** Verify against `SavedCardModel.priceRange` actual contents — Constitution #10 implication.
5. **For `rating`, is there a target format?** Stars + decimal (★ 4.6)? Numeric only (4.6)? Stars only (★★★★½)? Locale considerations for decimal separator.
6. **Should hidden categories (`groceries`, `flowers`) be shareable?** If yes, add `category_groceries` to all 28 locales; if no, filter at picker fetch.
7. **Is there a maximum bubble height?** Adding 3-4 chips could push the bubble taller than chat ergonomics tolerate. iMessage caps at ~120px; pick a max.
8. **Does the bubble need to respond to dark/light theme differently with rich chips?** Existing chip style is glass-ish; adding price/rating chips needs design-token discipline (cross-ref `mingla-designer` skill).

---

**End of investigation report.**
