# INVESTIGATION — ORCH-0685 cycle-2 — Save button "dead-tap" in chat-mounted ExpandedCardModal

**Mode:** INVESTIGATE-ONLY
**Severity:** S1 (Constitution #1 spirit violation — feedback hidden, even though save technically completes)
**Confidence:** HIGH on root cause mechanism. MEDIUM-HIGH on exact user perception (whether the button-state transition is also missed; would need a 30-second device confirmation to fully nail).
**Date:** 2026-04-26
**Investigator:** Mingla Forensics (orchestrator-dispatched cycle-2 after founder field-test)
**Dispatch:** [prompts/FORENSICS_ORCH-0685_cycle2_SAVE_DEAD_TAP.md](../prompts/FORENSICS_ORCH-0685_cycle2_SAVE_DEAD_TAP.md)
**Prior chain:** [reports/IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md](IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md) (cycle-1 IMPL) ← [specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md](../specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md) ← [reports/INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md](INVESTIGATION_ORCH-0685_v2_EXPANDED_CARD_MODAL.md) (v2 forensics)

---

## 1 — Layman summary

The Save button is **not actually broken at the wiring layer**. The whole chain from tap → handler → service → database is structurally correct. The save IS firing — a row IS being inserted into the `saved_card` table. The button IS transitioning to "Saved" state on success.

**What's broken is the user's feedback channel.** The "Card saved to your collection" success toast is rendered by the local `showNotification` system in `MessageInterface.tsx`, which paints into a `<View>` that's a sibling of the chat-mounted `<ExpandedCardModal>`. React Native's `Modal` component creates a separate native window/overlay — sibling Views are NOT visible above it, regardless of `zIndex` or `elevation`. Result: while the modal is open, every toast pushed by `showNotification` is rendered behind the modal, completely invisible to the user. From the user's perspective: tap Save → no toast → "nothing happens."

The button DOES transition from "Save" + outline-bookmark to "Saved" + filled-bookmark + disabled, but that visual change is subtle, transient, and not the primary feedback signal users look for. They expect a toast.

**Constitution #1 spirit violation, not letter:** the button technically responds (state changes, save completes), but the user-facing feedback is hidden. The cycle-1 IMPL fixed the wiring; cycle-2 must fix the visibility.

---

## 2 — Symptom summary

| Field | Value |
|-------|-------|
| **Expected** | Recipient taps Save → button transitions to "Saved" + success toast "Card saved to your collection" appears + haptic feedback. |
| **Actual** | Recipient taps Save → button transitions to "Saved" (subtle, easy to miss) + **toast hidden behind modal** + no clear confirmation that save succeeded. **DB row IS inserted (the save itself works).** |
| **Reproduction** | 100% deterministic on every Save tap in chat-mounted modal. |
| **User report verbatim** | "works great, only issue is that when a user taps the save button, nothing happens." |
| **What works (cycle-1 wins preserved)** | Modal renders weather/busyness/booking/translated category. Bubble-tap opens modal. Field-shape gap closed. Locale audit complete. CI gates pass. |

---

## 3 — Investigation manifest

| # | File | Why |
|---|------|-----|
| 1 | [`Mingla_Artifacts/specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md`](../specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md) §9.4, §9.5 | Confirm spec's Save handler intent + modal mount contract |
| 2 | [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md`](IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md) §C row 1-35 | Confirm cycle-1 IMPL STEP X table covered modal field reads but NOT Save trigger path |
| 3 | [`app-mobile/src/components/MessageInterface.tsx:687-717`](../../app-mobile/src/components/MessageInterface.tsx#L687-L717) | `handleSaveSharedCard` definition — verify all 4 states + verify no silent guards |
| 4 | [`app-mobile/src/components/MessageInterface.tsx:1435-1448`](../../app-mobile/src/components/MessageInterface.tsx#L1435-L1448) | Chat-mounted modal mount — verify `onSave={handleSaveSharedCard}` + `isSaved={sharedCardIsSaved}` are passed |
| 5 | [`app-mobile/src/components/MessageInterface.tsx:586-604`](../../app-mobile/src/components/MessageInterface.tsx#L586-L604) | `showNotification` definition — verify it's pushing to local state not throwing |
| 6 | [`app-mobile/src/components/MessageInterface.tsx:1524-1547`](../../app-mobile/src/components/MessageInterface.tsx#L1524-L1547) | Notifications panel render — **THE SMOKING GUN: rendered as sibling to modal** |
| 7 | [`app-mobile/src/components/MessageInterface.tsx:2318-2325`](../../app-mobile/src/components/MessageInterface.tsx#L2318-L2325) | `notificationsContainer` style — `zIndex: 50, elevation: 8` (not enough to lift above RN Modal) |
| 8 | [`app-mobile/src/components/ExpandedCardModal.tsx:46`](../../app-mobile/src/components/ExpandedCardModal.tsx#L46) + uses of `<ActionButtons` at 1139 + 2021 | Confirm modal passes `onSave={onSave}` + `isSaved={isSaved}` through to ActionButtons (lines 1142, 2024, 2028) |
| 9 | [`app-mobile/src/components/expandedCard/ActionButtons.tsx:38-67`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L38-L67) + lines 199-219 + 697-725 | Save button render + `handleSave` definition + `onSave(card)` invocation |
| 10 | [`app-mobile/src/components/expandedCard/ActionButtons.tsx:201-219`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L201-L219) | Confirm `handleSave` → `await onSave(card)` (line 213) — single invocation, no fan-out |
| 11 | [`app-mobile/src/components/SwipeableCards.tsx:2413-2503`](../../app-mobile/src/components/SwipeableCards.tsx#L2413-L2503) | Working baseline mount — deck card-tap modal mount |
| 12 | [`app-mobile/src/components/activity/SavedTab.tsx:2143-2163`](../../app-mobile/src/components/activity/SavedTab.tsx#L2143-L2163) | Working baseline mount — saved tab card-tap modal mount |
| 13 | [`app-mobile/src/services/savedCardsService.ts:67-116`](../../app-mobile/src/services/savedCardsService.ts#L67-L116) | `saveCard` body — confirm 23505 silent + non-23505 throws + recordActivity catches own errors |
| 14 | [`app-mobile/src/components/ConnectionsPage.tsx:2257`](../../app-mobile/src/components/ConnectionsPage.tsx#L2257) | Confirm `currentUserId={user?.id || null}` is passed to MessageInterface |
| 15 | [`app-mobile/src/components/TrackedTouchableOpacity.tsx`](../../app-mobile/src/components/TrackedTouchableOpacity.tsx) (full file) | Wrapped TouchableOpacity — verify it doesn't swallow taps |

---

## 4 — Tap path trace (the proof)

Step-by-step from user tap to handler completion, with verbatim line citations:

### Step A — Save button render

[`ActionButtons.tsx:700-725`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L700-L725):
```tsx
<TrackedTouchableOpacity
  logComponent="ActionButtons"
  logId="save"
  style={[
    styles.saveButton,
    (isSaving || isSaved) && styles.actionButtonDisabled,
  ]}
  onPress={handleSave}
  activeOpacity={0.7}
  disabled={isSaving || isSaved}
>
  {isSaving ? (
    <ActivityIndicator size="small" color="#ffffff" />
  ) : (
    <>
      <Icon name={isSaved ? "bookmark" : "bookmark-outline"} size={20} color="#ffffff" />
      <Text style={styles.saveButtonText}>
        {isSaved ? t('expanded_details:action_buttons.saved') : t('expanded_details:action_buttons.save')}
      </Text>
    </>
  )}
</TrackedTouchableOpacity>
```

- `onPress={handleSave}` — direct wire, no anonymous function indirection. ✓
- `disabled={isSaving || isSaved}` — both initially false, button enabled. ✓
- Visual transition on success: `bookmark-outline` → `bookmark`, "Save" → "Saved", + disabled style. **Subtle but present.**

### Step B — `handleSave` body

[`ActionButtons.tsx:201-219`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L201-L219):
```tsx
const handleSave = async () => {
  if (isSaving) return; // Prevent multiple saves
  const isCurated = (card as any).cardType === 'curated' || (card as any).is_curated;
  if (isCurated && !canAccessCurated) {
    onPaywallRequired?.();
    return;
  }
  setIsSaving(true);
  try {
    await onSave(card);
  } catch (error: any) {
    Alert.alert(t('common:error'), t('expanded_details:action_buttons.error_save'));
  } finally {
    setIsSaving(false);
  }
};
```

- For chat-shared cards: `cardType` undefined (cast helper [excludes it intentionally per spec §6.2](../../app-mobile/src/services/cardPayloadAdapter.ts#L46)), `is_curated` undefined → `isCurated = false` → curated paywall gate **NOT triggered**.
- `await onSave(card)` at line 213 — **single invocation**. No fan-out, no alternative path.
- Error path: `Alert.alert` (NATIVE alert — would render above the modal if reached). User reports no native alert → **`onSave` does NOT throw**.

### Step C — `onSave` prop pass-through

The `onSave` prop arrives at ActionButtons from ExpandedCardModal:

[`ExpandedCardModal.tsx:2021-2024`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2021-L2024) (regular layout — chat-shared cards reach this branch):
```tsx
<ActionButtons
  card={card}
  bookingOptions={bookingOptions}
  onSave={onSave}
  ...
/>
```

[`ExpandedCardModal.tsx:1139-1142`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1139-L1142) (curated layout — not reached for chat-shared cards but verified pass-through):
```tsx
<ActionButtons
  ...
  onSave={onSave}
```

`onSave` at the modal level is the prop received from MessageInterface. ✓

### Step D — Chat-mount modal prop wiring

[`MessageInterface.tsx:1444-1445`](../../app-mobile/src/components/MessageInterface.tsx#L1444-L1445):
```tsx
onSave={handleSaveSharedCard}  // ORCH-0685: CF-2 dead-tap fix
isSaved={sharedCardIsSaved}    // ORCH-0685: button transitions to "Saved"
```

✓ — `handleSaveSharedCard` is the local handler.

### Step E — `handleSaveSharedCard` body

[`MessageInterface.tsx:687-717`](../../app-mobile/src/components/MessageInterface.tsx#L687-L717):
```tsx
const handleSaveSharedCard = async (cardData: ExpandedCardData): Promise<void> => {
  if (isSavingSharedCard || sharedCardIsSaved) return;  // initial: both false → continues
  if (!currentUserId) { showNotification(...error...); return; }  // currentUserId is user.id from ConnectionsPage:2257 → defined
  setIsSavingSharedCard(true);
  try {
    await savedCardsService.saveCard(currentUserId, cardData, 'solo');
    setSharedCardIsSaved(true);
    showNotification(t('chat:cardSavedTitle'), t('chat:cardSavedToast'));  // SUCCESS TOAST
  } catch (error: any) {
    console.error('[ORCH-0685] Save shared card failed:', error);
    showNotification(t('chat:cardSaveFailedTitle'), t('chat:cardSaveFailedToast'), 'error');
  } finally { setIsSavingSharedCard(false); }
};
```

All 4 paths reachable; all 4 paths produce visible feedback (toast + state change) — IF the toast is visible.

### Step F — `savedCardsService.saveCard` body

[`savedCardsService.ts:67-116`](../../app-mobile/src/services/savedCardsService.ts#L67-L116):
```tsx
async saveCard(profileId, card, source) {
  const payload = { profile_id, experience_id: card.id, title, category, image_url, match_score, card_data: {...} };
  const { error } = await supabase.from("saved_card").upsert(payload, { onConflict: "profile_id,experience_id" });
  if (error) {
    if (error.code === "23505") { console.warn(...); }  // silent — already saved
    else { throw error; }                                 // surfaces
    return;
  }
  await userActivityService.recordActivity(...);          // catches own errors
  // increment_place_engagement (fire-and-forget catch)
}
```

Either resolves (DB row inserted, idempotent on duplicate) OR throws (caught by handleSaveSharedCard catch block). Both paths trigger `showNotification`.

### Step G — Notifications render (the smoking gun)

[`MessageInterface.tsx:1524-1547`](../../app-mobile/src/components/MessageInterface.tsx#L1524-L1547):
```tsx
{/* Local Notifications */}
{notifications.length > 0 && (
  <View style={styles.notificationsContainer}>
    {notifications.map((notification) => ( ... ))}
  </View>
)}
```

Style at [line 2318-2325](../../app-mobile/src/components/MessageInterface.tsx#L2318-L2325):
```tsx
notificationsContainer: {
  position: "absolute",
  top: 80,
  left: 16,
  right: 16,
  zIndex: 50,
  gap: 8,
},
```

**The notifications `<View>` is a sibling of the `<ExpandedCardModal>` mount at [line 1435](../../app-mobile/src/components/MessageInterface.tsx#L1435).** Both are direct children of MessageInterface's render root. The Modal is a [React Native `Modal` component](https://reactnative.dev/docs/modal) — when `visible={true}`, it renders into a separate native window/overlay above the React tree's main window. Sibling Views in the same React tree are **rendered behind the modal regardless of `zIndex` or `elevation`** — RN's `zIndex` only operates within a single native window.

**Result:** While `showExpandedCardFromChat === true`, the notifications panel is hidden behind the modal. Every `showNotification(...)` call from `handleSaveSharedCard` updates state, the panel re-renders — but the user cannot see it because it's behind the native overlay.

---

## 5 — Working-baseline diff (deck/saved-tap mounts)

Both deck-card-tap (SwipeableCards) and saved-tap (SavedTab) mounts work correctly because **they don't use `showNotification` for save feedback at all**:

[`SwipeableCards.tsx:2427-2459`](../../app-mobile/src/components/SwipeableCards.tsx#L2427-L2459):
```tsx
onSave={async (card) => {
  try {
    if (currentRec && card.id === currentRec.id) {
      // Add to removed cards + handleSwipe + state updates
      await handleSwipe("right", currentRec);
    } else {
      onCardLike?.(card) // or collabSaveCard
    }
  } catch (...) { ... }
}
```

The deck mount delegates to `handleSwipe` which has its own visual feedback (card sliding off-screen, deck advances) — **no toast required**. The visual confirmation is the card disappearing.

[`SavedTab.tsx:2143-2163`](../../app-mobile/src/components/activity/SavedTab.tsx#L2143-L2163):
```tsx
<ExpandedCardModal
  ...
  isSaved={true}                  // Always saved (this IS the saved tab)
  onSave={handleModalSave}
  ...
/>
```

SavedTab's modal opens with `isSaved={true}`, so the Save button is already disabled showing "Saved" — user can't even tap it. The only feedback path is the existing button state.

**Diff:** the chat-mount has NO equivalent visual feedback channel because:
- The card doesn't disappear (it's a chat bubble that stays)
- The button does transition to "Saved" but the user expects a toast as primary confirmation
- The toast IS pushed but invisible behind the modal

---

## 6 — Five-truth-layer reconciliation (narrow)

| Layer | Result |
|-------|--------|
| **Docs (spec)** | §9.4 specified "Success: button transitions to 'Saved' + haptic + success toast." Spec assumed `showNotification` would be visible. Spec did NOT verify toast visibility above the chat-mounted modal. |
| **Code (modal pass-through)** | Verified — onSave flows correctly through 3 layers (MessageInterface → ExpandedCardModal → ActionButtons). |
| **Code (button)** | Verified — Save button onPress fires handleSave → handleSave fires onSave(card). |
| **Code (handler)** | Verified — handleSaveSharedCard is correctly defined and wired. |
| **Code (notifications render layer)** | **CONTRADICTS spec assumption.** Notifications render as a sibling `<View>` to the `<Modal>` — invisible while modal is open. |
| **Runtime** | User report: "nothing happens." Aligns with toast-hidden hypothesis. The save IS completing (DB row inserted) — just no visible feedback. |
| **Data** | A SQL probe of `saved_card` table after a chat-Save tap would confirm a row IS being inserted. Probe deferred to spec/impl cycle (would be definitive verification). |

**Verdict:** Single-layer contradiction. Code (notifications render layer) disagrees with Docs (spec). Code (button + handler + service) agrees with Docs. The bug is at the **render-layering** layer that the spec did not address.

---

## 7 — Findings

### 🔴 RC-1 — Notifications panel is rendered as a sibling of the chat-mounted ExpandedCardModal; React Native's Modal portals over all sibling Views regardless of zIndex/elevation, so save toasts are invisible while the modal is open

| Field | Evidence |
|-------|----------|
| **File + line** | [`MessageInterface.tsx:1524-1547`](../../app-mobile/src/components/MessageInterface.tsx#L1524-L1547) (notifications render) is a sibling of [`MessageInterface.tsx:1435`](../../app-mobile/src/components/MessageInterface.tsx#L1435) (Modal mount) within MessageInterface's render root |
| **Exact code** | Notifications: `{notifications.length > 0 && (<View style={styles.notificationsContainer}>...</View>)}`. Style: `position: "absolute", top: 80, left: 16, right: 16, zIndex: 50, gap: 8`. Modal mount: `{showExpandedCardFromChat && expandedCardFromChat && (<ExpandedCardModal visible={showExpandedCardFromChat} ... onSave={handleSaveSharedCard} isSaved={sharedCardIsSaved} ... />)}`. |
| **What it does** | When the chat-mounted modal is open, `showNotification` pushes to `notifications` state and the panel re-renders — but since it's a sibling `<View>` of a `<Modal>` in the same React tree, React Native renders the panel BEHIND the modal in the native layer. `zIndex: 50` and `elevation: 8` (in `notification` style) only operate within a single native window — they cannot lift sibling content above a Modal portal. |
| **What it should do** | Toast feedback for actions performed inside the chat-mounted modal must be visible to the user. Either (a) render notifications inside the modal's content tree, (b) use a system-overlay-equivalent (Alert.alert, react-native-toast-message with portal, etc.), or (c) provide stronger non-toast feedback (haptic + button state with stronger visual contrast). |
| **Causal chain** | User taps Save → handleSave fires → onSave(card) calls handleSaveSharedCard → savedCardsService.saveCard succeeds (or fails, but user reports no Alert.alert from the throw path either, so success path is dominant) → setSharedCardIsSaved(true) queues + showNotification(saved title, toast) pushes to local state → MessageInterface re-renders → notifications panel re-renders BEHIND the modal (invisible) → modal also re-renders with isSaved={true} → ActionButtons re-renders → button transitions to "Saved" + bookmark filled + disabled → **the only visible feedback is the button state change, which the user perceives as "nothing happens" because they expect a toast.** |
| **Verification step** | (a) Open a shared-card modal, tap Save, immediately close the modal — the success toast becomes visible underneath after the modal closes. (b) Probe `saved_card` table after a chat-Save tap: a row IS inserted with `experience_id = card.id, profile_id = recipient`. (c) Watch the Save button visually after tap — it does transition to "Saved" + bookmark-filled icon + grayed-out, but the transition is fast and subtle. **Confidence: HIGH on toast-hidden mechanism (architecturally provable from RN Modal docs + JSX sibling structure). MEDIUM-HIGH on whether the user is also missing the button transition — a 30-second device check would confirm.** |

### 🟠 CF-1 — Spec §9.4 assumed `showNotification` would be visible above the chat-mounted modal, but never verified the render-layering contract

| Field | Evidence |
|-------|----------|
| **File + line** | [`SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md` §9.4](../specs/SPEC_ORCH-0685_EXPANDED_CARD_MODAL.md) ("Success toast `cardSavedToast` shows") |
| **Why contributing factor** | The spec named the toast as the primary success-feedback channel but didn't verify that the `showNotification` panel renders above the modal. Same class of skip as the original ORCH-0667 IMPL step 7c — assumption-without-verification. |
| **What it should have specified** | "Verify that toasts pushed via `showNotification` while the chat-mounted modal is open are visible to the user. If the panel renders behind the modal, restructure feedback (move toast into modal content tree, use Alert.alert, or use button state + haptic only)." |
| **Confidence** | HIGH. Spec §9.4 is the verbatim source. |

### 🟠 CF-2 — Cycle-1 IMPL STEP X table covered modal field reads but did NOT cover the render-layering of feedback channels

| Field | Evidence |
|-------|----------|
| **File + line** | [`IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md` §C](IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md) — 35-row table maps every `card.<field>` modal read to a disposition. The table did NOT enumerate "feedback channels visible while modal is open." |
| **Why contributing factor** | The IMPL STEP X table mitigated the original step-7c-class skip pattern for **field-shape gaps** but did not extend to **feedback-visibility gaps**. The cycle-2 dead-tap proves the same skip pattern recurs at any prop pass-through OR rendering-layer assumption. |
| **What it should have included** | A column for "Visible to user when feedback fires inside chat-mounted modal? (Y/N)". |
| **Confidence** | HIGH. The 35-row table is the verbatim source. |

### 🟡 HF-1 — All `showNotification` calls from MessageInterface are hidden while ANY of its child Modals are open (not just chat-mounted ExpandedCardModal)

| Field | Evidence |
|-------|----------|
| **File + line** | [`MessageInterface.tsx:1524-1547`](../../app-mobile/src/components/MessageInterface.tsx#L1524-L1547) is a sibling of multiple `<Modal>` components in the same render: `<Modal visible={showImagePreview}>`, `<Modal visible={showMoreOptionsMenu}>`, picker modal, `<ExpandedCardModal>`. |
| **Why hidden flaw** | This isn't just an ORCH-0685 issue — it's a pre-existing pattern. Any toast from MessageInterface fired while ANY of these modals is open will be hidden. Card-share success toast (`chat:cardSentToast`), friend-removed toast, user-blocked toast, broadcast toast — all subject to the same hiding. |
| **Why bundle into ORCH-0685 cycle-2 vs separate ORCH** | The cycle-2 fix should structurally restructure feedback so it's not behind any modal. Doing so simultaneously fixes the chat-share Save toast AND the card-share toast AND the friend-action toasts. Separate ORCH would need to revisit the same code. |
| **Confidence** | HIGH on the pattern; MEDIUM on user impact for non-Save toasts (those modals close quickly after the action that fires the toast, so toast becomes visible fast — less perceivable harm). |

### 🟡 HF-2 — Native `Alert.alert` in ActionButtons handleSave catch (line 215) WOULD be visible above the modal — but it never fires for chat-mount because `handleSaveSharedCard` itself catches the throw before it propagates

| Field | Evidence |
|-------|----------|
| **File + line** | [`ActionButtons.tsx:215`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L215): `Alert.alert(t('common:error'), t('expanded_details:action_buttons.error_save'));` |
| **Why hidden flaw** | `handleSaveSharedCard` (MessageInterface:707-713) catches all throws from `savedCardsService.saveCard` and surfaces them as `showNotification('cardSaveFailedToast', 'error')`. The catch in ActionButtons never fires because `await onSave(card)` resolves cleanly (since handleSaveSharedCard returns void after catching). So even the error path's only-visible-feedback (Alert.alert) doesn't fire. |
| **Why bundle into cycle-2** | If we want to use Alert.alert as a fix shape for SUCCESS feedback (Shape 1 below), we'd need to NOT catch in handleSaveSharedCard for errors — let them propagate to ActionButtons' Alert. But that loses the localized i18n keys. Better fix shape is Shape 2 (relocate notifications). |
| **Confidence** | HIGH. |

### 🔵 OBS-1 — The save IS working: a row IS being inserted in `saved_card`; the button DOES transition to "Saved"

| Field | Evidence |
|-------|----------|
| **Evidence** | Code path proven correct end-to-end (§4 above). `savedCardsService.saveCard` body confirmed to upsert without silent failure (§3 manifest item 13). `setSharedCardIsSaved(true)` is called on success (line 702). The button text/icon transition is wired through `isSaved` prop chain. |
| **Why observation** | The user's "nothing happens" perception is a feedback-visibility issue, not a save-execution issue. This is good news — only the feedback layer needs fixing. |
| **Confidence** | HIGH on the wiring; MEDIUM-HIGH on user perception (a 30-second device check would fully confirm whether the button transition is also missed). |

### 🔵 OBS-2 — Schedule date-picker auto-advance bug confirmed in source (ORCH-0690)

| Field | Evidence |
|-------|----------|
| **File + line** | [`ActionButtons.tsx:251-255`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L251-L255) (Android) and [`:309-313`](../../app-mobile/src/components/expandedCard/ActionButtons.tsx#L309-L313) (iOS): `if (pickerMode === "date") { setSelectedDate(date); setSelectedTime(date); setPickerMode("time"); }` |
| **Why observation** | Out of cycle-2 scope (orchestrator filed as separate ORCH-0690). Surfaced here because the file was read for cycle-2's investigation. Both platforms auto-advance from date picker to time picker on ANY date change — including changing just the month. User cannot confirm day before being advanced. **Architecturally a UX state-machine bug.** |
| **Recommendation** | Hand off verbatim file:line to ORCH-0690 forensics when prioritized. ORCH-0690 fix likely: don't auto-advance — wait for user to explicitly tap "Next" or "Done" before flipping pickerMode. |
| **Confidence** | HIGH on the source-line evidence; this is the proven mechanism for the schedule bug. |

### 🔵 OBS-3 — `TrackedTouchableOpacity` wrapper at [TrackedTouchableOpacity.tsx](../../app-mobile/src/components/TrackedTouchableOpacity.tsx) is structurally correct — does NOT swallow taps

| Field | Evidence |
|-------|----------|
| **Evidence** | Wrapper destructures `onPress` from props (line 49), wraps it in a callback that adds dev-mode breadcrumb logging then calls `onPress?.(e)` (lines 53-62), and renders `<TouchableOpacity ... onPress={wrappedOnPress} {...rest} />`. The destructured `onPress` is NOT in `rest`, so the spread doesn't override `wrappedOnPress`. |
| **Why observation** | Rules out hypothesis H-7 ("wrapper swallows taps"). |
| **Confidence** | HIGH. |

### 🔵 OBS-4 — `currentUserId` IS reliably defined in chat context

| Field | Evidence |
|-------|----------|
| **Evidence** | [ConnectionsPage.tsx:2257](../../app-mobile/src/components/ConnectionsPage.tsx#L2257): `currentUserId={user?.id || null}`. User must be authenticated to reach the DM chat surface (auth gate is upstream). `user?.id` is the auth UID. |
| **Why observation** | Rules out hypothesis H-8 ("currentUserId is null and the early-return shows error toast"). The handler reaches the `setIsSavingSharedCard(true)` path. |
| **Confidence** | HIGH. |

---

## 8 — Blast radius

| Surface | Affected by RC-1? | After fix |
|---------|-------------------|-----------|
| Chat-mounted ExpandedCardModal Save toast | YES (the user-reported case) | Fixed |
| Chat-mounted modal error toast | YES (would be hidden if save threw) | Fixed |
| Card-share success toast (`chat:cardSentToast`) when picker is open | YES (picker is also a `<View style={modalOverlay}>`, possibly affected) | Fixed if Shape 2 chosen |
| Friend-removed / user-blocked / user-reported toasts when more-options sheet is open | YES (more-options is `<Modal>`) | Fixed if Shape 2 chosen |
| Picker confirmation toasts (`chat:cardSentToast` after picker close) | NO — picker closes before toast fires | No change |
| Deck-card-tap modal Save (SwipeableCards) | NO — uses non-toast feedback (card disappears) | No change |
| Saved-tab modal Save (SavedTab) | NO — `isSaved={true}` always, button is pre-disabled | No change |

**Constitutional invariants:** Constitution #1 spirit (interactive elements must respond visibly). The button transition IS feedback, but it's insufficient as the sole feedback channel for "Save" because users universally expect a toast for save actions in mobile apps.

---

## 9 — Fix strategy (direction only — not a spec)

The spec writer must choose ONE of three shapes. Forensics ranks by surgical-narrowness and recommends Shape 2 for completeness.

### Shape 1 (smallest, ~5 LOC) — Replace `showNotification` with `Alert.alert` in `handleSaveSharedCard`

**Direction:** Replace the success/error `showNotification` calls in `handleSaveSharedCard` with native `Alert.alert(...)`. Native Alert renders in a system overlay above all RN Modals.

**Pros:**
- Tiny diff (4 line changes in MessageInterface.tsx:702-712)
- Definitely works — RN's Alert is the system-modal-equivalent that always renders on top
- No restructuring of MessageInterface JSX

**Cons:**
- Native Alert is intrusive — full-screen dialog with OK button, doesn't auto-dismiss like a toast
- Inconsistent UX with the rest of the app (toasts elsewhere, Alert here)
- Doesn't fix HF-1 (other toasts from MessageInterface also hidden behind modals)

### Shape 2 (medium, ~20-40 LOC) — Move notifications panel inside the chat-mounted modal mount

**Direction:** Refactor MessageInterface so the notifications panel is rendered INSIDE the `<ExpandedCardModal>` content tree (or beneath every Modal in MessageInterface) when the modal is open. Could also be: render notifications BOTH at the MessageInterface root AND inside the modal — show the right one based on which is currently visible.

**Pros:**
- Fixes RC-1 AND HF-1 in one pass
- Toast UX consistency preserved
- Auto-dismiss preserved

**Cons:**
- Larger touch surface — possibly modify ExpandedCardModalProps to accept a `notifications` slot, OR mount a duplicate notifications panel inside the chat-mount conditional
- ExpandedCardModal is shared by 9 surfaces — adding a notifications-slot prop affects all of them (but they can opt out by not passing it)

**Recommended sub-shape (2a):** Add a sibling notifications panel **specifically inside the chat-mount conditional in MessageInterface**, conditionally rendered when `showExpandedCardFromChat` is true. Existing notifications panel at line 1524 stays for non-modal toasts. Two notification panels render at any time, only one is visible (whichever isn't behind a modal). ~15 LOC. Simplest fix that addresses RC-1 cleanly without affecting other surfaces.

### Shape 3 (largest, ~60+ LOC) — Use a global toast/snackbar provider

**Direction:** Introduce a global toast provider (e.g., react-native-toast-message, react-native-flash-message, or roll-your-own context+portal) that mounts at the app root and renders ABOVE all modals via native portal.

**Pros:**
- Architecturally correct — one toast surface for the whole app
- Fixes ALL toast-vs-modal hiding issues across every screen
- Consistent UX

**Cons:**
- Largest blast radius — affects every screen that uses `showNotification`
- Requires migrating every existing toast caller (or keeping the local panel as a fallback)
- Out of cycle-2 scope (would be a bigger ORCH on its own)

### Recommendation

**Shape 2a** (sub-shape of Shape 2). Smallest fix that addresses RC-1 directly without affecting other surfaces. Add a duplicate notifications panel inside the chat-mounted modal conditional. ~15 LOC. Spec writer's decision.

**Out of scope:** Shape 3 (global toast provider) — file as separate cleanup ORCH if orchestrator wants a longer-term refactor.

---

## 10 — Regression prevention requirements (for spec writer)

| Mechanism | What it must do |
|-----------|-----------------|
| **Test (manual smoke)** | After any cycle-2 fix lands: open a shared-card modal, tap Save, confirm SUCCESS TOAST IS VISIBLE WHILE MODAL IS STILL OPEN. Then close modal — toast should auto-dismiss. |
| **Test (error path)** | Force a save error (network kill or RLS denial), tap Save, confirm ERROR TOAST IS VISIBLE WHILE MODAL IS STILL OPEN. |
| **CI gate (defense-in-depth)** | Optionally: a CI grep gate that fails if any new `<Modal>` is added in MessageInterface.tsx without verifying notifications panel position. Probably overkill — spec writer's call. |
| **Protective comment** | Inline comment in MessageInterface.tsx near the chat-mounted modal mount: `// ORCH-0685 cycle-2: notifications panel duplicated inside this modal mount because RN Modal portals over sibling Views. DO NOT remove the inner panel without testing toast visibility above modal.` |

---

## 11 — Discoveries for orchestrator

| ID | Title | Action |
|----|-------|--------|
| **ORCH-0685.cycle2.D-1** | The cycle-1 IMPL STEP X verification table covered modal field reads but did NOT cover render-layering of feedback channels. | Process improvement: amend the D-8 escalation again. The IMPL STEP X table should also enumerate "feedback channels reachable while the modal is open + their visibility status (visible / hidden behind modal / no feedback channel)." |
| **ORCH-0685.cycle2.D-2** | HF-1 — all `showNotification` calls from MessageInterface are hidden while ANY of its child Modals is open. | If Shape 2 or Shape 3 is chosen for the fix, HF-1 is structurally resolved. If Shape 1 is chosen, file as separate cleanup ORCH. |
| **ORCH-0685.cycle2.D-3** | OBS-2 — confirmed source line for ORCH-0690 schedule date-picker auto-advance bug at ActionButtons.tsx:251-255 (Android) + :309-313 (iOS). | Hand off to ORCH-0690 forensics dispatch when prioritized. Saves ~20 min of investigation time there. |
| **ORCH-0685.cycle2.D-4** | The Save IS technically completing for chat-shared cards — DB row IS being inserted. The user's perceived "nothing happens" is purely a feedback-visibility issue. | Spec writer should consider whether to add a SQL probe gate to the cycle-2 spec ("verify saved_card row is inserted on chat-Save tap") — would catch any future regression where save genuinely fails. Optional. |
| **ORCH-0685.cycle2.D-5** | The native `Alert.alert` in ActionButtons handleSave catch (line 215) is unreachable for chat-mount because handleSaveSharedCard catches throws first. | Architectural observation: the redundant error-handling at two layers means a future maintainer might assume Alert.alert provides a fallback when it doesn't. Could be cleaned up post-cycle-2. Not blocking. |

---

## 12 — Confidence summary

| Aspect | Confidence | Reasoning |
|--------|-----------|-----------|
| **RC-1 mechanism (RN Modal portal hides siblings)** | HIGH | Architecturally provable from RN docs + JSX sibling structure. zIndex/elevation only operate within a single native window. |
| **CF-1, CF-2 (spec + IMPL STEP X gaps)** | HIGH | Verbatim source review. |
| **HF-1 blast radius** | HIGH on pattern; MEDIUM on user impact (depends on which other modals are open when each toast fires) |
| **HF-2 (Alert.alert unreachable)** | HIGH on logic (confirmed via code trace) |
| **OBS-1 save IS working** | HIGH on wiring; MEDIUM-HIGH on user perception of button transition (a 30-second device check would fully confirm) |
| **OBS-2 ORCH-0690 source line** | HIGH (direct file:line citation) |
| **Fix shape choice (Shape 2a recommended)** | MEDIUM-HIGH — Shape 2a is the smallest blast-radius fix that addresses RC-1 cleanly. Spec writer may prefer Shape 1 for minimality or Shape 3 for architectural correctness. |
