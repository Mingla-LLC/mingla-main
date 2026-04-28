# SPEC — ORCH-0667 — Share Saved Card Picker

**Status:** Spec-pending review
**Date:** 2026-04-25
**Author:** Mingla Forensics (SPEC mode)
**Mode:** SPEC (post-investigation)
**Investigation source:** [reports/INVESTIGATION_ORCH-0667_SHARE_SAVED_CARD.md](../reports/INVESTIGATION_ORCH-0667_SHARE_SAVED_CARD.md)
**Dispatch:** [prompts/SPEC_ORCH-0667_SHARE_SAVED_CARD_PICKER.md](../prompts/SPEC_ORCH-0667_SHARE_SAVED_CARD_PICKER.md)
**Severity:** S1 (constitutional-violation triple #1 + #3 + #9)

---

## 1. Layman summary

Replace the toast-only stub on the DM "Share Saved Card" button with a real picker that
shows the user's saved cards, lets them tap one to send, and delivers the card as a
tappable bubble in the chat (with push to the recipient). The migration adds a new
`'card'` message type to the chat schema, the service layer gets a `sendCardMessage`
method, the picker is an inline modal in `MessageInterface`, and the bubble renders in
the existing `MessageBubble` component. The lying success toast is deleted as part of
the subtraction step (Constitution #8).

---

## 2. Scope, non-goals, assumptions

### 2.1 In-scope (v1)

- DM-only sender path: button entry points at `MessageInterface.tsx:778` (more-options
  menu) and `:1353` (chat sheet)
- DB migration: new `'card'` value in `messages.message_type` CHECK + new `card_payload jsonb`
  column + soft constraint requiring payload when type=card
- Service: new `sendCardMessage` method on `messagingService` (additive, does NOT mutate
  existing `sendMessage` signature)
- Component (picker): new inline modal in `MessageInterface.tsx`, single-select
  tap-to-send, mirrors BoardSelectionSheet chrome at `:1241-1315`
- Component (bubble): new `'card'` branch in
  `app-mobile/src/components/chat/MessageBubble.tsx` (the file flagged for spec-task
  by the investigator)
- Local `ExpandedCardModal` mount in `MessageInterface.tsx` for tap-to-expand from chat
- Edge function: new `'direct_card_message'` notification type in
  `supabase/functions/notify-message/index.ts`, cloned from `'board_card_message'`
- 14 new i18n keys in `chat.json` and 2 deletions in `common.json`, translated across
  all 28 locale files
- Subtraction (Constitution #8): delete toast-only body of `handleShareSavedCard` in
  `AppHandlers.tsx:340-355` and the local `showNotification` call in
  `MessageInterface.tsx:617-620`

### 2.2 Non-goals (explicit; do NOT implement)

- Multi-select share — deferred ORCH-0667.D-6
- Share-card UI on Board Discussions / Collab session chat — deferred ORCH-0667.D-1
- Recipient-interaction notifications ("Friend saved the card you shared", "Friend
  opened the card you shared") — deferred ORCH-0667.D-2
- Reverse-direction share from `SavedTab` `onShareCard` prop — deferred ORCH-0667.D-7
- Refactor `ExpandedCardModal` to a global overlay — out of scope
- Fixing `handleAddToBoard` fake-success theatre — separate ORCH-0666
- Edit / recall / delete shared-card messages after send — out of scope (no edit on any
  message type today; preserves existing pattern)
- Localized push-notification body (server-side i18n) — keep English fallback for v1;
  separate hardening pass

### 2.3 Assumptions

- A1: `useSavedCards(currentUser.id)` returns `SavedCardModel[]` with full `card_data`
  payload — verified by investigator OBS-4
- A2: `messages` table is in `supabase_realtime` publication — verified (DM realtime
  works today via `messagingService.subscribeToConversation:560-624`)
- A3: `postgres_changes` realtime payload includes the new `card_payload` column
  automatically without subscription change (Postgres CDC returns full row)
- A4: `MessageBubble` component at `chat/MessageBubble.tsx:141` is the ONLY consumer of
  `MessageData.type` — verified via grep
- A5: Recipient on a pre-fix mobile build will gracefully render the `content` field
  (text fallback) because old `MessageBubble` has no card branch — defense via SC-9
- A6: New migration applied before mobile OTA ship (operational ordering — see §10
  step 2)

---

## 3. Decisions (5 default-locks)

| # | Decision | Lock | Rationale | Override evidence required |
|---|----------|------|-----------|---------------------------|
| D-1 | **Single-select picker** | LOCKED | Tap-to-send mirrors iMessage attachment UX. One bubble per card. Multi-select adds confusion ("did I send 3 bubbles or one bubble with 3 cards?") and doubles surface area. | Founder explicit ask for multi, OR demonstrated tap-to-send keyboard-race conflict. |
| D-2 | **Snapshot card payload** (trim list per §6) | LOCKED | Survives place-removal-from-pool (cross-ref 0659.D-1). Trim keeps payload <5 KB. | Demonstrated payload >5 KB after trim, OR realtime payload size limit hit. |
| D-3 | **Bubble + push for v1** | LOCKED | Reuse `notify-message` pipeline; clone `board_card_message` proven pattern (~30 LOC). | OneSignal push-budget concern (none known). |
| D-4 | **Local `ExpandedCardModal` mount in `MessageInterface`** (~5 LOC) | LOCKED | No global-overlay refactor cost. ExpandedCardModal is self-contained and accepts `card`/`isOpen` props. | Parallel ORCH initiative migrating to global overlay (none known). |
| D-5 | **Defer reverse-direction share from SavedTab** (D-7) | LOCKED | Out of v1 scope. Different sender flow even though same DB schema. | Founder explicit ask + scope-delta <10%. |

No overrides invoked.

---

## 4. Layer 1 — Database

### 4.1 Migration file (verbatim)

**Path:** `supabase/migrations/20260425000001_orch_0667_add_card_message_type.sql`

```sql
-- ORCH-0667 — Add card message type to direct messages.
-- Enables sharing saved cards from sender to recipient via DM.
-- Schema delta Option A (per investigation §8): widen message_type CHECK
-- + add card_payload jsonb + soft constraint requiring payload when type=card.
-- RLS unchanged: existing message SELECT/INSERT policies do not discriminate
-- by message_type; new card-type rows inherit existing per-conversation rules.

BEGIN;

-- 1. Widen the message_type CHECK constraint
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_message_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'file', 'card'));

-- 2. Add the card_payload column (snapshot, per investigation D-2)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS card_payload jsonb;

-- 3. Soft constraint: card_payload required when message_type = 'card'
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_card_requires_payload;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_card_requires_payload
  CHECK (message_type <> 'card' OR card_payload IS NOT NULL);

COMMENT ON COLUMN public.messages.card_payload IS
  'ORCH-0667: Snapshot of shared card data when message_type=card. '
  'Trimmed schema per spec §6 to stay <5KB. Snapshot (not reference) '
  'so the bubble survives the place being removed from the pool '
  '(cross-ref ORCH-0659.D-1 backfill lesson — distance is user-relative '
  'and place-pool churn is non-trivial).';

COMMIT;
```

### 4.2 RLS policies

**No change.** Existing policies in `20250128000003_create_direct_messaging.sql:154-186`:

- SELECT: participants of the conversation can read non-deleted messages
- INSERT: sender_id must equal auth.uid() AND sender must be a participant
- UPDATE: sender owns
- DELETE: sender owns

These do not discriminate by `message_type`. Card-type messages inherit the same
per-conversation access rules. **Verified by investigator** in five-truth-layer
reconciliation §5.

### 4.3 Indexes

**No new indexes needed.** `card_payload` is read on row fetch (already covered by
existing `idx_messages_conversation_id` and `idx_messages_conversation_created`).
v1 has no `WHERE card_payload->>...` queries.

### 4.4 Realtime publication

**No change.** `messages` table is already in `supabase_realtime` publication (proven
by working DM realtime today). New `card_payload` column is included in `postgres_changes`
payload automatically (Postgres CDC returns full row).

---

## 5. Layer 6 — Edge function

**Path:** `supabase/functions/notify-message/index.ts`

### 5.1 Type union widening (line 23)

```typescript
type: "direct_message" | "board_message" | "board_mention" | "board_card_message" | "direct_card_message";
```

### 5.2 Request interface additions (after line 36)

```typescript
// ORCH-0667: direct_card_message specific fields
cardId?: string;       // place_pool.id — for analytics dedup
cardTitle?: string;    // for push body
cardImageUrl?: string; // optional, reserved for rich-push v2
messageId?: string;    // already exists; used as idempotency anchor
```

### 5.3 New handler branch

Insert after the `'board_card_message'` block at `:241`:

```typescript
if (type === "direct_card_message") {
  const { conversationId, recipientId, messageId, cardTitle, cardId } = body;
  if (!conversationId || !recipientId || !messageId || !cardTitle) {
    return jsonResponse(
      { error: "conversationId, recipientId, messageId, cardTitle required for direct_card_message" },
      400
    );
  }

  // Sender display name lookup (mirror direct_message handler pattern)
  const { data: senderProfile } = await userClient
    .from("profiles")
    .select("display_name, username, first_name, last_name")
    .eq("id", senderId)
    .single();

  const senderName =
    senderProfile?.display_name ||
    senderProfile?.username ||
    [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") ||
    "Someone";

  const titleTrunc = truncate(cardTitle, 60);
  const fiveBucket = Math.floor(Date.now() / (5 * 60 * 1000));

  await callNotifyDispatch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    recipientId,
    type: "direct_card_message",
    title: `${senderName} shared an experience`,
    body: `🔖 ${titleTrunc}`,
    data: { deepLink: `mingla://chat/${conversationId}` },
    relatedId: messageId,
    senderId,
    idempotencyKey: `card_share:${messageId}:${recipientId}`,
  });

  return jsonResponse({ ok: true });
}
```

**Note:** Push body uses English fallback for v1 (server doesn't have user's locale at
fan-out time — mobile-side notification rendering is i18n-aware via in-app notifications
table). Localized push body deferred to a hardening pass.

---

## 6. Layer 5 — `CardPayload` schema (the trim list)

### 6.1 TypeScript interface

Define in `app-mobile/src/services/messagingService.ts` (export so picker + bubble can
share):

```typescript
export interface CardPayload {
  // Identity
  id: string;                    // place_pool.id (analytics dedup, NOT for refetch)

  // Render essentials (bubble + ExpandedCardModal)
  title: string;                 // bubble title + modal hero title
  category: string | null;       // chip render
  image: string | null;          // primary image URL (bubble thumbnail + modal hero)

  // ExpandedCardModal enrichment (all optional)
  images?: string[];             // gallery for modal carousel
  rating?: number;               // info section
  reviewCount?: number;          // info section
  priceRange?: string;           // info section
  address?: string;              // location section
  description?: string;          // body
  highlights?: string[];         // highlights section
  matchScore?: number;           // match badge
}
```

### 6.2 Field-by-field justification

| Field | Included? | Reason |
|-------|-----------|--------|
| `id` | YES | Analytics dedup; consistent with sender's source; NOT used to refetch (snapshot doctrine). |
| `title` | YES | Bubble headline + modal hero. |
| `category` | YES | Bubble chip + modal info section. |
| `image` | YES | Bubble thumbnail + modal hero. Primary visual hook. |
| `images` | OPT | Modal carousel — drop if total payload >5 KB. |
| `rating` | OPT | Modal info — small int, low cost. |
| `reviewCount` | OPT | Modal info — small int. |
| `priceRange` | OPT | Modal info — short string. |
| `address` | OPT | Modal location section — geocoded short string. |
| `description` | OPT | Modal body — truncate to 500 chars at trim time. |
| `highlights` | OPT | Modal highlights list — cap at 5 entries × 80 chars. |
| `matchScore` | OPT | Modal match badge — small number. |
| `strollData` | NO | Sender-specific personalization, irrelevant to recipient. |
| `picnicData` | NO | Sender-specific personalization, irrelevant to recipient. |
| `socialStats` | NO | Stale immediately; refetch from server if shown. |
| `source` | NO | Sender-context (`solo`/`collaboration`); recipient doesn't care. |
| `sessionName`, `sessionId` | NO | Collab metadata, irrelevant in DM context. |
| `dateAdded` | NO | Irrelevant; chat `created_at` is the new "shared at" time. |
| `travelTime`, `distanceKm`, `travelTimeMin` | NO | RECIPIENT distance differs from SENDER's; including would fabricate (Constitution #9). Cross-ref ORCH-0659/0660. Recipient's render computes locally if needed. |

### 6.3 Trim utility (in `messagingService`)

```typescript
function trimCardPayload(card: SavedCardModel): CardPayload {
  const trimmed: CardPayload = {
    id: card.id,
    title: card.title,
    category: card.category,
    image: card.image,
  };

  // Optional fields — added only if present and within size budget
  if (card.images?.length) trimmed.images = card.images.slice(0, 6);
  if (typeof card.rating === "number") trimmed.rating = card.rating;
  if (typeof card.reviewCount === "number") trimmed.reviewCount = card.reviewCount;
  if (card.priceRange) trimmed.priceRange = card.priceRange;
  if (card.address) trimmed.address = card.address;
  if (card.description) trimmed.description = card.description.slice(0, 500);
  if (card.highlights?.length) {
    trimmed.highlights = card.highlights.slice(0, 5).map(h => h.slice(0, 80));
  }
  if (typeof card.matchScore === "number") trimmed.matchScore = card.matchScore;

  // Size guard — drop optional fields in reverse priority if over budget
  let json = JSON.stringify(trimmed);
  const dropOrder: (keyof CardPayload)[] = ["highlights", "description", "images", "address"];
  for (const key of dropOrder) {
    if (json.length <= 5120) break;
    delete trimmed[key];
    json = JSON.stringify(trimmed);
  }

  return trimmed;
}
```

---

## 7. Layer 2 — Service

**Path:** `app-mobile/src/services/messagingService.ts`

### 7.1 Type widening (line 11)

```typescript
message_type: 'text' | 'image' | 'video' | 'file' | 'card';
```

### 7.2 Interface addition (after line 21, in `DirectMessage`)

```typescript
card_payload?: CardPayload;  // ORCH-0667: present iff message_type = 'card'
```

### 7.3 New method: `sendCardMessage`

Insert in the `MessagingService` class, near `sendMessage` (after `:514`):

```typescript
/**
 * ORCH-0667: Send a card-type message containing a snapshot of the saved card.
 * Mirrors sendMessage but with message_type='card' and card_payload populated.
 */
async sendCardMessage(
  conversationId: string,
  senderId: string,
  card: SavedCardModel,
): Promise<{ message: DirectMessage | null; error: string | null }> {
  try {
    const cardPayload = trimCardPayload(card);

    // content carries forward-safe text for old-build clients (SC-9)
    // — uses i18n key 'chat:cardSharedFallbackText' computed by caller and
    //   passed in via card.title; server-side fallback is just the title.
    const content = `Shared an experience: ${cardPayload.title}`;

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content,
        message_type: "card",
        card_payload: cardPayload,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "42501" || error.message?.includes("policy")) {
        return { message: null, error: "Cannot send card to this user" };
      }
      throw error;
    }

    const enrichedMessage = await this.enrichMessage(data, senderId);

    // Fire push + in-app notification via the existing pipeline
    this.sendCardMessageNotifications(
      conversationId,
      senderId,
      enrichedMessage,
      cardPayload
    ).catch((err) =>
      console.error("Error sending card-share notifications:", err)
    );

    return { message: enrichedMessage, error: null };
  } catch (error: any) {
    console.error("Error sending card message:", error);
    return { message: null, error: error.message || "Failed to send card" };
  }
}

/**
 * Fan out card-share notifications to all recipients (excluding sender).
 * Mirrors sendMessageNotifications but uses 'direct_card_message' type.
 */
private async sendCardMessageNotifications(
  conversationId: string,
  senderId: string,
  message: DirectMessage,
  cardPayload: CardPayload,
): Promise<void> {
  try {
    const { data: participants, error: participantsError } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .neq("user_id", senderId);

    if (participantsError || !participants || participants.length === 0) {
      return;
    }

    for (const participant of participants) {
      supabase.functions
        .invoke("notify-message", {
          body: {
            type: "direct_card_message",
            senderId,
            conversationId,
            recipientId: participant.user_id,
            messageId: message.id,
            cardTitle: cardPayload.title,
            cardId: cardPayload.id,
            cardImageUrl: cardPayload.image,
          },
        })
        .catch((err) =>
          console.log("Card share notification error (non-critical):", err)
        );
    }
  } catch (error) {
    console.error("Error sending card-share notifications:", error);
  }
}
```

### 7.4 Update preview switch (line 722)

Insert before the existing length-truncate branch:

```typescript
} else if (message.message_type === "card") {
  messagePreview = `🔖 ${message.card_payload?.title || "Shared experience"}`;
} else if (messagePreview.length > 50) {
  messagePreview = messagePreview.substring(0, 50) + "...";
}
```

---

## 8. Layer 3 — Hook

**No new hook.** Picker uses existing `useSavedCards(currentUser.id)`:

- Query key: `savedCardKeys.list(userId)` (factory-managed — Constitution #4 compliant)
- `staleTime: 5 * 60 * 1000` (5 min — picker doesn't need fresher; opening picker
  multiple times in 5 min reuses cache)
- `gcTime: 10 * 60 * 1000` (10 min)
- Returns `SavedCardModel[]` with full payload

**Cache invalidation:** none required for picker. Sending a card does not modify the
sender's saved-card list. The `messages` cache (if any) is updated via realtime echo.

---

## 9. Layer 4 — Component (picker)

**Path:** `app-mobile/src/components/MessageInterface.tsx`

### 9.1 New state (add near `:168` `showBoardSelection`)

```typescript
const [showSavedCardPicker, setShowSavedCardPicker] = useState(false);
const [pickerSubmittingCardId, setPickerSubmittingCardId] = useState<string | null>(null);
const [expandedCardFromChat, setExpandedCardFromChat] = useState<ExpandedCardData | null>(null);
const [showExpandedCardFromChat, setShowExpandedCardFromChat] = useState(false);
```

### 9.2 New imports (top of file)

```typescript
import { useSavedCards } from "../hooks/useSavedCards";
import { messagingService } from "../services/messagingService";
import { ExpandedCardModal } from "./ExpandedCardModal";  // path may differ — verify
import type { CardPayload } from "../services/messagingService";
import { useAuth } from "../hooks/useAuth";  // or whatever the user-id source is
```

### 9.3 Replace `handleShareSavedCard` (`:614-621`) with picker opener

```typescript
const handleShareSavedCard = () => {
  setShowMoreOptionsMenu(false);
  setShowSavedCardPicker(true);
  // No toast here. Real toast fires on real send result (success or error).
};
```

### 9.4 New handler: `handleSelectCardToShare`

```typescript
const handleSelectCardToShare = async (card: SavedCardModel) => {
  if (pickerSubmittingCardId) return;  // guard against double-tap
  setPickerSubmittingCardId(card.id);

  try {
    const conversationId = currentConversationId;  // existing local — verify name
    const senderId = currentUserId;  // existing local — verify name
    if (!conversationId || !senderId) {
      throw new Error("Missing conversation or sender context");
    }

    const { message, error } = await messagingService.sendCardMessage(
      conversationId,
      senderId,
      card,
    );

    if (error || !message) {
      showNotification(
        t("chat:cardShareFailedTitle"),
        t("chat:cardShareFailedToast"),
        "error",
      );
      return;
    }

    // Real success — toast reflects actual delivery
    showNotification(
      t("chat:cardSentTitle"),
      t("chat:cardSentToast", { name: friend.name }),
      "success",
    );
    setShowSavedCardPicker(false);
  } finally {
    setPickerSubmittingCardId(null);
  }
};
```

### 9.5 Picker modal JSX (insert after `:1315` BoardSelectionSheet block)

State render contract:

| State | Render |
|-------|--------|
| **Loading** (first fetch) | 3 skeleton rows: 48×48 gray placeholder thumbnail + 2-line gray bars (title 60% width, subtitle 40%). Animate opacity 0.4 ↔ 0.7 over 1.2s. |
| **Empty** (`data.length === 0`) | Title `t('chat:noSavedCardsToShareTitle')`, body `t('chat:noSavedCardsToShareBody')`, single "OK" button → closes picker. |
| **Populated** | Scrollable list of card rows. Each row: 48×48 rounded-8 thumbnail (left), title (bold, 1 line, ellipsis), category subtitle (regular, 1 line, ellipsis). Tap row → `handleSelectCardToShare(card)`. |
| **Submitting** (one row in flight) | The submitting row: opacity 0.5, "Sending…" badge replaces subtitle. Other rows: tap-disabled but visually unchanged. |
| **Error** (send failed) | Toast fires (per `handleSelectCardToShare`); picker stays open; submitted row resets to normal. User can retry by tapping again. |

Sketch (implementor fills exact StyleSheet — match `boardItem` / `boardInfo` patterns
at `:1259-1296` for visual coherence):

```tsx
{showSavedCardPicker && (
  <View style={styles.modalOverlay}>
    <View style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>{t("chat:pickerTitle")}</Text>
        <TouchableOpacity
          onPress={() => setShowSavedCardPicker(false)}
          style={styles.modalCloseButton}
        >
          <Icon name="close" size={12} color="rgba(255, 255, 255, 0.72)" />
        </TouchableOpacity>
      </View>

      <Text style={styles.modalSubtitle}>
        {t("chat:pickerSubtitle", { name: friend.name })}
      </Text>

      {savedCardsQuery.isLoading ? (
        <View style={styles.savedCardList}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.savedCardSkeletonRow}>
              <View style={styles.savedCardSkeletonThumb} />
              <View style={styles.savedCardSkeletonText}>
                <View style={[styles.savedCardSkeletonBar, { width: "60%" }]} />
                <View style={[styles.savedCardSkeletonBar, { width: "40%", marginTop: 6 }]} />
              </View>
            </View>
          ))}
        </View>
      ) : (savedCardsQuery.data?.length ?? 0) === 0 ? (
        <View style={styles.savedCardEmptyContainer}>
          <Text style={styles.savedCardEmptyTitle}>
            {t("chat:noSavedCardsToShareTitle")}
          </Text>
          <Text style={styles.savedCardEmptyBody}>
            {t("chat:noSavedCardsToShareBody")}
          </Text>
          <TouchableOpacity
            onPress={() => setShowSavedCardPicker(false)}
            style={styles.confirmButton}
          >
            <Text style={styles.confirmButtonText}>{t("chat:ok")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.savedCardList}>
          {savedCardsQuery.data?.map((card) => {
            const isSubmitting = pickerSubmittingCardId === card.id;
            const isOtherSubmitting =
              !!pickerSubmittingCardId && pickerSubmittingCardId !== card.id;
            return (
              <TouchableOpacity
                key={card.id}
                onPress={() => handleSelectCardToShare(card)}
                disabled={isSubmitting || isOtherSubmitting}
                style={[
                  styles.savedCardRow,
                  isSubmitting && { opacity: 0.5 },
                ]}
              >
                {card.image ? (
                  <Image
                    source={{ uri: card.image }}
                    style={styles.savedCardThumb}
                  />
                ) : (
                  <View style={[styles.savedCardThumb, styles.savedCardThumbPlaceholder]} />
                )}
                <View style={styles.savedCardInfo}>
                  <Text style={styles.savedCardTitle} numberOfLines={1}>
                    {card.title}
                  </Text>
                  <Text style={styles.savedCardSubtitle} numberOfLines={1}>
                    {isSubmitting ? t("chat:cardSending") : (card.category || "")}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  </View>
)}

{/* Local ExpandedCardModal mount for tap-to-expand from chat (D-4) */}
{showExpandedCardFromChat && expandedCardFromChat && (
  <ExpandedCardModal
    card={expandedCardFromChat}
    isOpen={showExpandedCardFromChat}
    onClose={() => {
      setShowExpandedCardFromChat(false);
      setExpandedCardFromChat(null);
    }}
  />
)}
```

### 9.6 Expand-from-bubble handler

Pass through to `MessageBubble` so it can fire the open. Add prop on `<MessageBubble>`
at `:887-913`:

```tsx
onCardBubbleTap={(payload: CardPayload) => {
  setExpandedCardFromChat(payload as unknown as ExpandedCardData);
  setShowExpandedCardFromChat(true);
}}
```

The `as unknown as ExpandedCardData` cast is acceptable because `CardPayload` is a
strict subset of `ExpandedCardData`. `ExpandedCardModal` reads only the fields present
in `CardPayload`. **If `ExpandedCardModal` reads any field NOT in `CardPayload`, the
implementor MUST either (a) widen `CardPayload`, (b) provide null-safe defaults inside
`ExpandedCardModal`, or (c) document the missing field as a known v1 gap.** Track
this verification as IMPL step 7c.

### 9.7 Subtraction (Constitution #8)

Delete the local `showNotification` call in `MessageInterface.tsx:617-620` (it was
firing the lying success toast). The new `handleShareSavedCard` already does NOT
call it — confirm the deletion is complete.

---

## 10. Layer 5 — Component (bubble)

**Path:** `app-mobile/src/components/chat/MessageBubble.tsx` (lines 11-21 + 191-233)

### 10.1 Type widening

Update `MessageData` interface (`:11-21`):

```typescript
interface MessageData {
  id: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'file' | 'card';
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  cardPayload?: CardPayload;  // ORCH-0667
  isMe: boolean;
  failed?: boolean;
}

import type { CardPayload } from "../../services/messagingService";
```

### 10.2 Update `MessageBubbleProps` (`:31-39`)

Add optional callback:

```typescript
onCardBubbleTap?: (payload: CardPayload) => void;
```

### 10.3 Add card branch (after line 232, before `{/* Failed indicator */}` block)

```tsx
{message.type === 'card' && message.cardPayload && (
  <TouchableOpacity
    onPress={() => onCardBubbleTap?.(message.cardPayload!)}
    activeOpacity={0.85}
    style={styles.cardBubbleContainer}
  >
    {message.cardPayload.image ? (
      <Image
        source={{ uri: message.cardPayload.image }}
        style={styles.cardBubbleImage}
        resizeMode="cover"
      />
    ) : (
      <View style={[styles.cardBubbleImage, styles.cardBubblePlaceholder]}>
        <Icon name="bookmark" size={24} color={colors.text.tertiary} />
      </View>
    )}
    <View style={styles.cardBubbleBody}>
      <Text
        style={[styles.cardBubbleTitle, isMe ? styles.textSent : styles.textReceived]}
        numberOfLines={2}
      >
        {message.cardPayload.title}
      </Text>
      {message.cardPayload.category ? (
        <View style={styles.cardBubbleChip}>
          <Text style={styles.cardBubbleChipText}>{message.cardPayload.category}</Text>
        </View>
      ) : null}
      <Text style={[styles.cardBubbleHint, isMe ? styles.textSent : styles.textReceived]}>
        {t('chat:cardBubbleTapHint')}
      </Text>
    </View>
  </TouchableOpacity>
)}

{/* Defense-in-depth: card-type message with missing payload */}
{message.type === 'card' && !message.cardPayload && (
  <Text style={[styles.messageText, isMe ? styles.textSent : styles.textReceived]}>
    {t('chat:cardBubbleUnavailable')}
  </Text>
)}
```

### 10.4 Style block additions

Implementor adds to the `StyleSheet.create` block:

| Style key | Properties |
|-----------|-----------|
| `cardBubbleContainer` | `flexDirection: 'column'`, `width: SCREEN_WIDTH * 0.6`, `borderRadius: 12`, `overflow: 'hidden'`, `backgroundColor: 'rgba(255,255,255,0.06)'` |
| `cardBubbleImage` | `width: '100%'`, `aspectRatio: 16/10`, `backgroundColor: colors.surface.subtle` |
| `cardBubblePlaceholder` | `alignItems: 'center'`, `justifyContent: 'center'` |
| `cardBubbleBody` | `padding: spacing.s`, `gap: spacing.xs` |
| `cardBubbleTitle` | `fontSize: typography.body.size`, `fontWeight: fontWeights.semibold` |
| `cardBubbleChip` | `alignSelf: 'flex-start'`, `paddingHorizontal: spacing.xs`, `paddingVertical: 2`, `borderRadius: radius.pill`, `backgroundColor: colors.surface.glass` |
| `cardBubbleChipText` | `fontSize: typography.caption.size`, `color: colors.text.secondary` |
| `cardBubbleHint` | `fontSize: typography.caption.size`, `opacity: 0.7` |

### 10.5 Wire `onCardBubbleTap` through

Update `MessageInterface.tsx:887-913` (the `<MessageBubble>` props block) to pass
`cardPayload` and `onCardBubbleTap`:

```tsx
<MessageBubble
  message={{
    id: item.message.id,
    content: item.message.content,
    timestamp: item.message.timestamp,
    type: item.message.type,
    fileUrl: item.message.fileUrl,
    fileName: item.message.fileName,
    fileSize: item.message.fileSize,
    cardPayload: item.message.cardPayload,  // ORCH-0667
    isMe: item.message.isMe,
    failed: item.message.failed,
  }}
  isMe={item.message.isMe}
  groupPosition={item.groupPosition}
  showTimestamp={revealedTimestampId === item.message.id}
  isRead={...}
  replyTo={...}
  onCardBubbleTap={(payload) => {
    setExpandedCardFromChat(payload as unknown as ExpandedCardData);
    setShowExpandedCardFromChat(true);
  }}
/>
```

### 10.6 Update `transformMessage` in `ConnectionsPage.tsx:952-969`

Add `cardPayload` propagation:

```typescript
const transformMessage = useCallback(
  (msg: DirectMessage, userId: string): Message => ({
    id: msg.id,
    senderId: msg.sender_id ?? '',
    senderName: msg.sender_name || "Unknown",
    content: msg.content,
    timestamp: msg.created_at,
    type: msg.message_type,
    fileUrl: msg.file_url,
    fileName: msg.file_name,
    fileSize: msg.file_size?.toString(),
    cardPayload: msg.card_payload,  // ORCH-0667
    isMe: msg.sender_id === userId,
    unread: !msg.is_read && msg.sender_id !== userId,
    isRead: msg.is_read ?? false,
    replyToId: msg.reply_to_id ?? undefined,
  }),
  []
);
```

### 10.7 Update local `Message` interface in `MessageInterface.tsx:53-68`

Add `cardPayload?: CardPayload`. Update the `type` union to include `'card'`.

---

## 11. Layer 7 — Realtime

**No code change.** Existing subscription on `messages` table at
`messagingService.ts:560-624` filters by `conversation_id` only — type-agnostic.
`enrichMessageRealtime` at `:686-694` returns `{...message}` — `card_payload` is
included automatically via spread.

**Implementor must NOT "improve" the subscription.** The current filter is correct.
Adding type-discrimination would BREAK card delivery.

---

## 12. i18n keys

### 12.1 New keys — `app-mobile/src/i18n/locales/en/chat.json`

```json
{
  "noSavedCardsToShareTitle": "No saved cards yet",
  "noSavedCardsToShareBody": "Save cards from the deck to share them with friends.",
  "pickerTitle": "Share a saved card",
  "pickerSubtitle": "Pick a card to send to {{name}}",
  "cardSending": "Sending…",
  "cardSentTitle": "Sent",
  "cardSentToast": "Card sent to {{name}}",
  "cardShareFailedTitle": "Couldn't send",
  "cardShareFailedToast": "Couldn't send. Tap to try again.",
  "cardBubbleTapHint": "Tap to view",
  "cardBubbleFallback": "Shared experience",
  "cardBubbleUnavailable": "Card unavailable",
  "cardSharedFallbackText": "Shared an experience: {{title}}",
  "ok": "OK"
}
```

### 12.2 Deletions (Constitution #8) — `en/common.json`

```diff
- "toast_card_shared": "Card Shared!",
- "toast_card_shared_msg": "A saved experience has been shared with {{name}}",
```

Same deletions in all 28 locale files.

### 12.3 Translation propagation

Implementor mirrors the new keys + deletions across all 28 locale files
(`ar, bin, bn, de, el, en, es, fr, ha, he, hi, id, ig, it, ja, ko, ms, nl, pl, pt, ro, ru, sv, th, tr, uk, vi, yo, zh`).
Match the existing pattern (machine translation acceptable for v1; native review
optional).

---

## 13. Success criteria (numbered, testable)

| # | Criterion | Layer | Verifier |
|---|-----------|-------|----------|
| **SC-1** | Migration applied successfully on a fresh DB. INSERT with `message_type='card'` + valid `card_payload` succeeds. INSERT with `message_type='card'` + `card_payload=NULL` rejects with `messages_card_requires_payload` check_violation. | DB | psql probe |
| **SC-2** | A non-participant cannot SELECT or INSERT a card-type message into a conversation (existing RLS holds without modification). | RLS | psql probe with two auth users |
| **SC-3** | Tapping "Share Saved Card" from the more-options menu OR the chat sheet opens the picker modal in <300ms. Picker shows `useSavedCards` data; empty state when 0 cards. | Component (picker) | Manual smoke + UI test |
| **SC-4** | Tapping a card in the picker (a) closes the picker, (b) inserts a `'card'`-type message with trimmed `card_payload`, (c) shows `cardSentToast` on success, (d) the new bubble appears in sender's chat list within 1s. | Full stack | Manual smoke |
| **SC-5** | Recipient's chat list shows the card bubble within 1s of send (realtime delivery). Bubble renders thumbnail + title + category chip + "Tap to view" hint. | Realtime + bubble | Two-device smoke |
| **SC-6** | Tapping the card bubble opens `ExpandedCardModal` with snapshot data. Closing returns to chat with no scroll-position loss. | Component (bubble + modal) | Manual smoke |
| **SC-7** | Recipient receives an OneSignal push: title `"{senderName} shared an experience"`, body `"🔖 {cardTitle}"`. Idempotency: only one push per (messageId, recipientId). | Edge fn + push | OneSignal dashboard + device |
| **SC-8** | Tapping the push opens the app to the chat (`mingla://chat/${conversationId}`), NOT to ExpandedCardModal directly. | Deep link | Device tap test |
| **SC-9** | A recipient on a pre-fix mobile build receives the message; their bubble renders the `content` field (`"Shared an experience: {title}"`) as readable text fallback (no blank, no crash). | Forward-safety | Old-build device smoke |
| **SC-10** | Grep across `app-mobile/src/**/*.{ts,tsx}` for `toast_card_shared` returns ZERO matches. Grep across `app-mobile/src/i18n/locales/**` returns ZERO matches in the JSON values (deletion complete in all 28 locales). | Subtraction proof | CI grep gate |
| **SC-11** | Tapping "Share Saved Card" never produces a fake-success toast. Either the picker opens (no toast), real send succeeds (real `cardSentToast` after DB ack), or real failure surfaces (`cardShareFailedToast` after error). | Constitution #1/#3 | Manual smoke + grep |
| **SC-12** | The `toast_card_shared_msg` string no longer exists in any code path. Grep on the i18n key returns ZERO active references. | Constitution #9 | CI grep gate |
| **SC-13** | Negative-control: existing text-message realtime delivery still works post-migration. Send a text message; recipient receives in <1s. No regression in image/video/file types. | Regression | Two-device smoke |
| **SC-14** | Card payload size: for any card in `useSavedCards`, `JSON.stringify(trimCardPayload(card)).length <= 5120`. | Performance | Unit test on trim function |
| **SC-15** | Picker double-tap guard: rapidly tapping two different cards in the picker results in only ONE message inserted (the first), the picker stays open with the first row in "Sending…" state, second tap is ignored. | UX correctness | Manual rapid-tap smoke |

---

## 14. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Schema accepts card type with payload | `INSERT INTO messages (..., message_type, card_payload) VALUES (..., 'card', '{"id":"x","title":"y","category":null,"image":null}'::jsonb)` | Insert succeeds | DB |
| T-02 | Schema rejects card type with NULL payload | `INSERT INTO messages (..., message_type, card_payload) VALUES (..., 'card', NULL)` | check_violation `messages_card_requires_payload` | DB |
| T-03 | Schema rejects unknown type | `... message_type='whatever'` | check_violation `messages_message_type_check` | DB |
| T-04 | RLS blocks non-participant | Auth as user not in conversation, INSERT card message | RLS denies (42501) | RLS |
| T-05 | Sender happy path | Tap button → picker opens → tap card → bubble appears in sender's chat list within 1s, success toast shows | Card delivered, realtime echo received | Full stack |
| T-06 | Recipient receives via realtime | Two devices in same conversation; sender shares; recipient watches | Bubble appears within 1s, push fires | Realtime + push |
| T-07 | Empty saved-cards picker | User with 0 saved cards taps button | Empty-state copy renders, OK button closes picker | Component |
| T-08 | Picker double-tap guard | Tap two different rows within 100ms | First inserts, second is no-op (disabled state) | Component |
| T-09 | Send failure (network) | Kill network mid-send | Error toast fires, picker stays open, tapped row resets | Service + component |
| T-10 | Send failure (RLS) | Force RLS denial (e.g. blocked user) | Error toast `cardShareFailedToast`, no message inserted | Service + RLS |
| T-11 | Tap bubble opens ExpandedCardModal | Tap a card-type bubble in chat | ExpandedCardModal opens with snapshot data; close returns | Component (bubble + modal) |
| T-12 | Old-build forward safety | Recipient on pre-fix build receives card message | `content` field renders as text fallback, no crash | Forward-safety |
| T-13 | Push tap deep-links to chat | Tap OneSignal push from cold start | App opens to chat (not modal), correct conversation | Deep link |
| T-14 | Push idempotency | Server is asked to fan out twice for same messageId | Recipient receives ONE push only (idempotency key blocks duplicate) | Edge fn |
| T-15 | Trim function size guard | Card with very long description + 20 highlights + 10 images | Trimmed payload <= 5120 bytes | Unit test |
| T-16 | Trim function preserves essentials | Card with all fields | Trimmed payload retains `id, title, category, image` always | Unit test |
| T-17 | Existing text message regression | Send text message post-migration | Delivers in <1s, renders normally | Regression |
| T-18 | Existing image message regression | Send image message post-migration | Delivers in <1s, renders normally | Regression |
| T-19 | Subtraction proof (CI grep) | Run grep gate `grep -rn "toast_card_shared" app-mobile/src/{,i18n/locales/}` | Zero matches | CI |
| T-20 | Realtime payload includes card_payload | Subscribe to conversation, share card, log raw payload | Payload contains `card_payload` field | Realtime |

---

## 15. Invariants

### 15.1 New invariant

**I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS** — Every `messages` row with
`message_type='card'` MUST have a non-null `card_payload jsonb` containing at minimum
`{id: string, title: string}`. Enforced by:

- DB CHECK constraint `messages_card_requires_payload` (hard guarantee at insert)
- Service layer validation in `sendCardMessage` (early reject before insert via
  required `card: SavedCardModel` parameter — TypeScript prevents nulls)
- Trim function `trimCardPayload` always returns at least `{id, title, category, image}`

Test: T-02 (DB check), T-15/T-16 (trim function), T-09/T-10 (service rejects).

### 15.2 Preserved invariants

| ID | How preserved |
|----|---------------|
| **I-DM-PARTICIPANTS-ONLY** (RLS) | No policy change. Card-type rows inherit existing per-conversation rules. Verified T-04. |
| **I-MESSAGE-IMMUTABILITY** | No UPDATE on card messages. Existing pattern preserved. |
| **Constitution #1** (no dead taps) | Picker opens; real send happens; real toast fires. SC-3, SC-4, SC-11. |
| **Constitution #2** (one owner per truth) | Card-type messages live in one place: `messages` table. No parallel "shared_cards" table. |
| **Constitution #3** (no silent failures) | Errors surface as user-facing toasts (`cardShareFailedToast`). No swallowed catches. SC-11. |
| **Constitution #4** (one query key per entity) | Picker uses `savedCardKeys.list(userId)` from existing factory. No hardcoded keys. |
| **Constitution #8** (subtract before adding) | Stub handler deleted; `toast_card_shared*` keys deleted from 28 locales BEFORE picker ships. SC-10, SC-12. |
| **Constitution #9** (no fabricated data) | Toast fires only on real send result. Trim function excludes recipient-relative fields (travelTime, distance) per ORCH-0659/0660 lesson. SC-11, SC-12. |
| **Constitution #13** (exclusion consistency) | RLS is the single source of message-access truth — service layer does NOT bypass with service-role-key sends. Card sends go through user-auth supabase client. |

---

## 16. Implementation order (numbered)

DB → edge fn → service → bubble → picker + modal → subtraction → i18n → CI gate →
manual smoke. Each step lists files touched and net effect.

1. **Write migration** `supabase/migrations/20260425000001_orch_0667_add_card_message_type.sql`
   per §4.1 (verbatim). [+1 file, ~30 lines]
2. **Apply migration** via Supabase dashboard or CLI in non-prod env first; verify
   T-01, T-02, T-03 pass. Then prod. **THIS MUST HAPPEN BEFORE ANY MOBILE OTA SHIP.**
3. **Update `notify-message` edge function** per §5: add `'direct_card_message'` to
   union, add request fields, add new branch. [+1 file edited, ~50 lines]
4. **Deploy `notify-message`** edge function via `supabase functions deploy notify-message`.
5. **Update `messagingService.ts`** per §7: widen union, add `CardPayload` interface,
   add `trimCardPayload`, add `sendCardMessage`, add `sendCardMessageNotifications`,
   update preview switch. [+1 file edited, ~120 lines net]
6. **Update `MessageBubble.tsx`** per §10.1-10.3: widen `MessageData.type`, add
   `cardPayload`, add `onCardBubbleTap`, add card branch JSX, add styles per §10.4.
   [+1 file edited, ~80 lines net]
7. **Update `MessageInterface.tsx`** per §9 + §10.5 + §10.7: add state, add imports,
   replace `handleShareSavedCard`, add `handleSelectCardToShare`, add picker modal JSX,
   add local `ExpandedCardModal` mount, widen local `Message` interface, wire
   `onCardBubbleTap`. [+1 file edited, ~150 lines net]
   - **7c. Verify ExpandedCardModal compatibility** (per §9.6): manually open the modal
     with a `CardPayload` cast and confirm no runtime null-deref on missing fields. If
     a missing field crashes, add null-safe defaults inside `ExpandedCardModal` OR
     widen `CardPayload`. Document in implementation report.
8. **Update `ConnectionsPage.tsx:952-969`** `transformMessage` per §10.6: propagate
   `card_payload`. [+1 file edited, ~3 lines]
9. **Subtraction:** delete the toast-only body of `handleShareSavedCard` in
   `AppHandlers.tsx:340-355` — replace with one-line stub
   `// ORCH-0667: Replaced by MessageInterface picker. NEVER restore toast-only stub. Constitution #1/#3/#9.`
   The handler is no longer wired (MessageInterface owns the new flow), but keep the
   export to avoid prop-drilling churn. [+1 file edited, ~15 lines net subtract]
10. **Add new i18n keys** per §12.1 to `en/chat.json` and **delete** `toast_card_shared*`
    from `en/common.json`. [+2 files edited]
11. **Translate** new keys + apply deletions across remaining 27 locale files (match
    existing pattern; machine translation acceptable). [+54 files edited]
12. **Add CI grep gate** to `scripts/ci-check-invariants.sh`:
    ```bash
    if grep -rln "toast_card_shared" app-mobile/src/ \
        --include='*.ts' --include='*.tsx' --include='*.json'; then
      echo "ERROR: ORCH-0667 — stale 'toast_card_shared' i18n key detected. Constitution #8 violation."
      exit 1
    fi
    ```
13. **Add CI grep gate** for the new picker pattern (regression prevention):
    ```bash
    # Ensure handleShareSavedCard never reverts to toast-only
    if grep -rn "i18n.t('common:toast_card_shared" app-mobile/src/; then
      echo "ERROR: ORCH-0667 — toast-only stub pattern detected. Use messagingService.sendCardMessage."
      exit 1
    fi
    ```
14. **Manual two-device smoke matrix** (sender + recipient, iOS + Android crossed):
    - T-05 (sender happy path)
    - T-06 (recipient receives via realtime)
    - T-07 (empty state)
    - T-08 (double-tap guard)
    - T-09 (network failure)
    - T-11 (tap bubble opens modal)
    - T-13 (push tap deep-link)
    - T-17/T-18 (text + image regression)

---

## 17. Regression prevention

**Class of bug:** toast-only stub on chat-affordance (Constitution #1 + #3 + #9 stack).

| Mechanism | Implementation |
|-----------|----------------|
| **Structural safeguard** | CI grep gate (impl steps 12 + 13) blocks reintroduction of `toast_card_shared` strings AND the toast-only call pattern. |
| **Test catches recurrence** | SC-10, SC-11, SC-12 + T-19 explicitly assert no fake-success toast. |
| **Protective comment** | `AppHandlers.tsx` near deleted handler: `// ORCH-0667: Replaced by MessageInterface picker. NEVER restore toast-only stub. Constitution #1/#3/#9.` |
| **Spec lock-in** | This SPEC document remains in `Mingla_Artifacts/specs/` as the binding contract for any future revisit. |
| **Invariant registration** | I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS added to `INVARIANT_REGISTRY.md` post-CLOSE. |

---

## 18. Discoveries register (carry forward)

| ID | Action | Notes |
|----|--------|-------|
| **ORCH-0667.D-1** | DEFER | Share-card on board-discussion surface — same picker UI + same schema, different sender path. File post-v1 ship. |
| **ORCH-0667.D-2** | DEFER | Recipient-interaction notifs ("Friend saved card you shared", "Friend opened card you shared") — listed NEVER BUILT in `VERIFICATION_PUSH_DELIVERY_MATRIX.md:54,64`. File post-v1. |
| **ORCH-0667.D-3** | NO ACTION | Cross-ref ORCH-0666 (AddToBoard fake-success theatre). Tracked under that ticket. |
| **ORCH-0667.D-4** | BUNDLED | Local `ExpandedCardModal` mount included in this spec (§9.5, §10.5). |
| **ORCH-0667.D-5** | BUNDLED | Toast subtraction included in this spec (§9.7, §12.2, impl step 9 + 10). |
| **ORCH-0667.D-6** | NON-GOAL | Multi-select share — explicit non-goal in §2.2. |
| **ORCH-0667.D-7** | DEFER | Reverse-direction share from `SavedTab.onShareCard` — explicit default-lock D-5. |

---

## 19. Acceptance checklist

This spec is APPROVED for IMPL dispatch when ALL items below PASS. Orchestrator runs
this checklist in REVIEW mode.

- [ ] §4.1 migration SQL is verbatim and applies cleanly on a fresh DB
- [ ] §4.2 RLS analysis confirms no policy change required
- [ ] §5 edge-fn changes are verbatim and complete (union, request fields, handler branch)
- [ ] §6 `CardPayload` schema is field-by-field justified, ≤5 KB budget enforced
- [ ] §7 service additions preserve existing `sendMessage` signature (additive only)
- [ ] §8 hook layer confirms no new query work needed
- [ ] §9 picker modal specifies all 5 states (loading, empty, populated, submitting, error)
- [ ] §10 bubble renderer specifies card branch + defense-in-depth fallback
- [ ] §11 realtime is explicitly NO-CHANGE
- [ ] §12 i18n keys list complete + deletion list complete
- [ ] §13 ≥13 success criteria, all observable + testable + unambiguous
- [ ] §14 ≥15 test cases covering happy + error + edge + regression
- [ ] §15 invariants list new + preserved with verification mapping
- [ ] §16 implementation order ≥14 numbered steps, file-precision, DB→edge→service→UI→subtraction→i18n→CI→smoke
- [ ] §17 regression prevention: CI gate + protective comment + invariant registered
- [ ] §18 discoveries register: every D-N has explicit action (BUNDLED / DEFER / NON-GOAL / NO ACTION)
- [ ] No scope creep beyond §2.1
- [ ] All 5 default-locks (§3) are explicitly stated; any override has cited evidence

---

**End of spec.**
