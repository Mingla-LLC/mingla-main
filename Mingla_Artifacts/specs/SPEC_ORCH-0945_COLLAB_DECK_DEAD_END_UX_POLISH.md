# SPEC — ORCH-0945 [Collab deck dead-end UX polish]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`
**Direction doc:** `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`
**Severity:** S2-medium · **Class:** ux + design-debt
**Mobile-only · No backend changes · iOS-consumer + Android-consumer**

---

## 1. Scope

**IN scope:**

1. Per-reason copy + diagnostic detail in the collab deck dead-end at [SwipeableCards.tsx:1883-1942](app-mobile/src/components/SwipeableCards.tsx#L1883-L1942) for ALL 5 `PositionalDeadEndReason` values.
2. Service-layer expansion to surface `acceptedCount` + `pendingGpsUserIds` + `detail` from `discover-cards` dead-end response (currently dropped at [deckService.ts:868-877](app-mobile/src/services/deckService.ts#L868-L877)).
3. New "Notify the group" primary CTA on the dead-end card that auto-posts a structured-text banner (system message) into the session's discussion.
4. Magic-token parser in [MessageBubble.tsx:142-150](app-mobile/src/components/discussion/MessageBubble.tsx#L142-L150) system-message branch — 7 token types per investigation contract.
5. Read-only mode for `PreferencesSheet` via new optional `viewParticipantId` prop — used when a non-named user taps another participant's deep-link token.
6. Section-focus mode for `PreferencesSheet` via new optional `initialFocusSection` prop — `'travel' | 'location' | 'categories' | 'dates'`.
7. 5-minute debounce per `(session_id, current_user_id, reason)` tuple — same banner re-posted within window becomes a short "re-flagged" variant OR no-ops.
8. Two new invariants registered + 1 new strict-grep CI gate.

**NON-goals (out of scope):**

1. Auto-suggest / what-if probing (e.g. "if Marcus drives 45min you'd have 12 matches"). Operator vetoed at INTAKE.
2. Any change to `discover-cards/index.ts` or any other edge function.
3. Any change to the aggregator (`pg_aggregate_collab_prefs`), the V_n contract, the deck determinism logic, or `messages` table schema. Contract 5 of the direction doc holds.
4. Solo deck dead-end states — collab-only ORCH.
5. Chat-native prefs sheet META-ORCH redesign (separate scope; this ORCH ships first).
6. ORCH-0918 banner styling rewrite — reuse existing system-message render shell, only extend with token parsing.
7. Adding new `message_type` values — categorically forbidden (schema CHECK constraint locked).
8. Backfill or migration of any kind.
9. Compose CTA pre-fill for non-`quorum_not_met` reasons (every other reason auto-posts a structured banner).
10. Push notification on banner post — banner appears in chat normally and the session's existing notification logic decides if it pushes.
11. Analytics tracking for banner post (Mixpanel) — desirable but additive; defer to follow-up if not trivially additive in the implementor's chosen file structure.
12. Internationalization of new copy — English-only this pass; add i18n keys but defer translation.

**Assumptions:**

- `useBoardSession` continues to load `participant_prefs` for ALL participants (verified by investigation §Five-layer cross-check).
- `session.participants[].profiles.first_name` is non-null for all accepted participants (operator can override copy fallback at SPEC follow-up if false).
- `discover-cards` continues to return `dead_end: true` + `reason` + `acceptedCount` + `pending_gps_user_ids` in the exact shape at [discover-cards/index.ts:741-774](supabase/functions/discover-cards/index.ts#L741-L774).

---

## 2. Cross-Surface Impact (Phase 2.5 mandatory)

| Surface | Covered? | Behavior |
|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | ✅ YES | Polished dead-end + chat banner + read-only PreferencesSheet view. Files: `app-mobile/src/components/SwipeableCards.tsx`, `app-mobile/src/components/PreferencesSheet.tsx`, `app-mobile/src/components/discussion/MessageBubble.tsx`, `app-mobile/src/services/deckService.ts`, `app-mobile/src/services/collabDeadEndBannerService.ts` (new), `app-mobile/src/contexts/RecommendationsContext.tsx`. Parity automatic with Android (shared codebase). |
| **Consumer Android** | ✅ YES | Same as iOS — shared `app-mobile/`. Automatic parity. |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout`, `/e/`, `/b/`) | ❌ NO | No collab decks on buyer web. |
| **Business iOS/Android** | ❌ NO | Not a business surface — collab is consumer-only. |
| **Admin Web** (`mingla-admin/`) | ❌ NO | No admin equivalent of the collab deck. |
| **Business Web preview** | ❌ NO | Same as Business iOS/Android. |

**Parity is automatic** (single `app-mobile/` codebase); no per-surface success criteria required.

---

## 3. Layer specifications

### 3.1 Service layer — `deckService.ts`

**File:** `app-mobile/src/services/deckService.ts`
**Edit:** Replace return shape at [lines 868-877](app-mobile/src/services/deckService.ts#L868-L877).

**New type:**

```ts
export type CollabDeadEndPayload = {
  reason: 'intersection_empty' | 'no_matching_candidates' | 'no_unswiped_candidates' | 'quorum_not_met' | 'all_pools_exhausted';
  acceptedCount: number;
  pendingGpsUserIds: string[];
  detail?: string;
};
```

**Return-shape addition** to the collab-v2 path: alongside existing `curatedEmptyReason`, expose `collabDeadEndPayload?: CollabDeadEndPayload`. Existing callers consuming `curatedEmptyReason` continue working unchanged (backwards-compatible).

**Parsing rule:** when `data.dead_end === true`, construct payload from `{ reason: data.reason, acceptedCount: data.acceptedCount ?? 0, pendingGpsUserIds: Array.isArray(data.pending_gps_user_ids) ? data.pending_gps_user_ids : [], detail: typeof data.detail === 'string' ? data.detail : data.sourceBreakdown?.reason }`. Defensive — never throw on missing fields.

### 3.2 Context layer — `RecommendationsContext.tsx`

**File:** `app-mobile/src/contexts/RecommendationsContext.tsx`
**Edit:** Lines 803, 1915-1917.

**Additions:**

- New context value `collabDeadEndPayload?: CollabDeadEndPayload` exposed alongside existing `collabDeckDeadEndReason`.
- Sourced from `activeDeck.collabDeadEndPayload` (set by deck service).
- Type updated at the `RecommendationsContextValue` interface declaration (line 125 area).

**No behavior change** to deck refresh, batching, or any other context concern. Pure additive read.

### 3.3 Component layer — `SwipeableCards.tsx` dead-end branch

**File:** `app-mobile/src/components/SwipeableCards.tsx`
**Edit:** Lines 1883-1942 (the dead-end render branch).

**Replace** the 2-branch ternary (`isIntersectionEmpty ? ... : ...`) with a `renderDeadEnd()` helper that switches on `collabDeadEndPayload?.reason ?? 'pool-empty'`.

**Per-reason render contract** — copy + diagnostic + CTAs:

| Reason | Title | Subtitle (diagnostic) | Primary CTA | Secondary CTA |
|---|---|---|---|---|
| `intersection_empty` (1 outlier detected) | `"{Outlier} is too far from the group"` | `"{Outlier}: {mode} {time}min from {locLabel} · {Self}: {mode} {time}min from {locLabel} · {Other}: ..."` | `"Notify the group"` → auto-post banner with `[[open-prefs:travel:{outlier_uid}]]` token | `"Shift my preferences"` → open own PreferencesSheet |
| `intersection_empty` (multi-outlier / no single overlap) | `"No location overlap yet"` | One-line "Seth in DC · Priya in LA · Marcus in Queens" | `"Notify the group"` → auto-post banner with one `[[open-prefs:location:UID]]` token per participant | `"Shift my preferences"` |
| `no_matching_candidates` — GPS-gap variant (server `detail` matches `/no gps/i` OR client sees ≥1 participant with `use_gps_location !== true && custom_lat == null`) | `"Waiting for {Name} to share location"` | (if multiple pending) `"Waiting for {Name1}, {Name2} to share location"` | `"Notify the group"` → banner with `[[open-prefs:location:{pending_uid}]]` per pending participant | `"Shift my preferences"` |
| `no_matching_candidates` — no-categories variant | `"Pick some categories"` | `"Nobody has picked categories or intents yet"` | `"Notify the group"` → banner with `[[open-prefs:self:categories]]` | `"Shift my preferences"` |
| `no_unswiped_candidates` | `"You've all seen everything for now"` | `"{N} cards reviewed this session"` | `"Notify the group"` → banner with `[[open-dismissed]]` | `"Review dismissed"` (existing button, preserved) + `"Shift my preferences"` |
| `quorum_not_met` | `"Waiting for {N} more to accept"` | `"Pending: {Name1}, {Name2}"` (if N=1 — single name; if N>1 — comma list) | `"Notify the group"` → banner with `[[compose-mention:{pending_uid}:can you tap accept?]]` per pending | `"Shift my preferences"` |
| `all_pools_exhausted` | `"You've exhausted today's options"` | `"Try a wider date window?"` | `"Notify the group"` → banner with `[[open-prefs:self:dates]]` | `"Shift my preferences"` |

**Outlier-detection helper** (client-side, no server change):

```
function detectIntersectionOutliers(circles, participantNames):
  for each participant P:
    count = number of OTHER participants whose circle overlaps with P's circle
  if exactly one P has count === 0 AND every other P has count === participantsLength - 2:
    return { mode: 'single', outlier: that P }
  else:
    return { mode: 'multi' }
```

Circles are computed client-side from `participant_prefs` (lat/lng + travel_mode + travel_time → meters radius via existing helpers). If the existing client-side circle helper is missing, fall back to mode='multi' (always rendering the per-name multi-token banner) — graceful degradation.

**Copy formatting helpers:**

- `formatTravelMode('walking' | 'driving' | 'transit') → 'walking' | 'driving' | 'transit'` (lowercase noun for prose; promote to title at sentence start).
- `formatLocationLabel(prefs) → custom_location text if non-empty; else 'their location' fallback; never display raw lat/lng to the user`.
- `formatFirstName(profile) → profile.first_name if non-empty; else profile.display_name; else 'A participant'`.

### 3.4 Service layer — `collabDeadEndBannerService.ts` (NEW FILE)

**File:** `app-mobile/src/services/collabDeadEndBannerService.ts` (create)

**Export:** `postCollabDeadEndBanner({ sessionId, reason, payload, participants, participantPrefs, currentUserId }) → Promise<void>`

**Responsibilities:**

1. Compose plain-text banner body per the table in §3.3 (copy + tokens).
2. Check client-side debounce key in AsyncStorage: `orch_0945_banner_debounce:{sessionId}:{currentUserId}:{reason}`. If a record exists within 5 minutes:
   - Skip insert entirely (silent no-op for tap; UI shows brief toast "Already flagged just now").
   - OR (implementor choice) post a short "re-flagged" variant: `"{CurrentUser} re-flagged this. [[open-prefs:...]]"`.
3. Insert message via existing `boardDiscussionService.sendMessage(sessionId, { content, message_type: 'text', user_id: null })`. Verify the discussion service accepts `user_id: null` system messages today — if not, this SPEC is blocked and the SPEC writer is to be re-dispatched.
4. On success, write debounce key + timestamp to AsyncStorage.
5. On failure, surface a `toastManager.warning('Couldn't post to the chat. Tap to retry.', 3000)` and do NOT write debounce key (so retry path is clean).

**No new RPC. No new Supabase table. No edge function.**

### 3.5 Component layer — `MessageBubble.tsx` token parser

**File:** `app-mobile/src/components/discussion/MessageBubble.tsx`
**Edit:** Lines 142-150 (system-message branch).

**Replace** the `<Text>{message.content}</Text>` render with a `renderSystemBannerContent(message.content)` helper that:

1. Splits the content on the regex `/(\[\[[a-z\-]+(?::[a-zA-Z0-9\-_,]+)*\]\])/g`.
2. For each segment:
   - If it matches a known token pattern, render as a `<TouchableOpacity>` with the appropriate tap handler (per §3.6 token-tap routing).
   - Else render as plain `<Text>`.
3. If ANY token is malformed/unrecognized, render that token segment as plain text (the literal `[[bad-token]]` shows to the user). Better visible than silently swallowed — visible bug is fixable, silent bug isn't.

**Visual treatment:** tappable segments use the existing link color (`#eb7825` per the codebase) and underline. Plain-text segments use existing system-message muted color.

**Accessibility:** each tappable segment gets `accessibilityRole="link"` and `accessibilityLabel` matching its visible text.

### 3.6 Token-tap routing (cross-layer behavior contract)

When a user taps a token in `MessageBubble`, the handler dispatches as follows:

| Token | Handler |
|---|---|
| `[[open-prefs:{section}:{user_id}]]` | If `user_id === currentUser.id` → call `openPreferencesSheet({ initialFocusSection: section })`. Else → call `openPreferencesSheet({ viewParticipantId: user_id, initialFocusSection: section })`. |
| `[[open-prefs:self:{section}]]` | Always → `openPreferencesSheet({ initialFocusSection: section })`. |
| `[[open-dismissed]]` | Dispatch event consumed by `SwipeableCards` to call `setDismissedSheetVisible(true)`. |
| `[[compose-mention:{user_id}:{text}]]` | Open chat composer with `@{first_name} {text}` pre-filled. |

**Cross-layer wire-up:** `MessageBubble` does not own the prefs sheet or composer state. It dispatches a context-level event (`useChatActions` hook, new) that `ConnectionsPage` or `SwipeableCards` consumes to mount the right surface. Exact hook shape TBD by implementor — SPEC requires only that the wire-up is centralized, not how.

### 3.7 Component layer — `PreferencesSheet.tsx` new props

**File:** `app-mobile/src/components/PreferencesSheet.tsx`
**Edit:** Props interface at lines 74-88.

**Add 2 optional props:**

```ts
interface PreferencesSheetProps {
  // ... existing
  viewParticipantId?: string;        // when present, sheet renders that participant's prefs read-only
  initialFocusSection?: 'travel' | 'location' | 'categories' | 'dates';
}
```

**Behavior changes:**

1. **Pref loading:** when `viewParticipantId` is set, load from `session.participant_prefs[viewParticipantId]` instead of current user's prefs.
2. **Editability central guard:**
   ```ts
   const isEditable = !viewParticipantId;
   ```
   Every `onPress`, `onChangeText`, `onValueChange`, save/apply RPC call site MUST short-circuit on `!isEditable`. **No exceptions.**
3. **Visual mode:** when `!isEditable`, apply `opacity: 0.85` to chips; hide save/apply buttons; replace sheet header with `"{Name}'s picks (read-only)"`.
4. **Section focus:** when `initialFocusSection` is set, scroll to and visually highlight that section on mount (one-time, on visibility transition false→true).
5. **No write RPC under any circumstance** when `viewParticipantId` is set. New invariant `I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE` enforces.

**Backwards compatibility:** when both props are undefined, behavior is byte-for-byte identical to today.

### 3.8 Realtime / cache invalidation

**No changes.** The banner message rides the existing `messages` realtime channel. Once inserted, it appears in every participant's chat via the existing realtime subscription. No new query keys, no new invalidations.

---

## 4. Success criteria

| # | Criterion | Layer |
|---|---|---|
| SC-01 | `deckService.collab-v2` returns `collabDeadEndPayload` with `reason`, `acceptedCount`, `pendingGpsUserIds`, `detail` on every dead-end response | Service |
| SC-02 | `RecommendationsContext` exposes `collabDeadEndPayload` alongside `collabDeckDeadEndReason` | Context |
| SC-03 | `SwipeableCards` dead-end branch renders `intersection_empty` (1 outlier) with outlier first name + each participant's mode/time/location | Component |
| SC-04 | `SwipeableCards` dead-end branch renders `intersection_empty` (multi-outlier) with per-name multi-token banner copy | Component |
| SC-05 | `SwipeableCards` dead-end branch renders `no_matching_candidates` GPS-gap variant with pending-name diagnostic | Component |
| SC-06 | `SwipeableCards` dead-end branch renders `no_matching_candidates` no-categories variant | Component |
| SC-07 | `SwipeableCards` dead-end branch renders `no_unswiped_candidates` with "Review dismissed" CTA preserved | Component |
| SC-08 | `SwipeableCards` dead-end branch renders `quorum_not_met` with pending-name list | Component |
| SC-09 | `SwipeableCards` dead-end branch renders `all_pools_exhausted` with date-widen suggestion | Component |
| SC-10 | "Notify the group" CTA on each reason posts a system message via `boardDiscussionService.sendMessage` with `user_id: null` and the per-reason token-bearing content | Service + Component |
| SC-11 | Same banner re-posted by same user within 5 minutes either no-ops with toast OR posts the short "re-flagged" variant — never duplicates | Service |
| SC-12 | `MessageBubble` system-message branch parses `[[open-prefs:travel:UID]]`, `[[open-prefs:location:UID]]`, `[[open-prefs:categories:UID]]`, `[[open-prefs:dates:UID]]`, `[[open-prefs:self:SECTION]]`, `[[open-dismissed]]`, `[[compose-mention:UID:TEXT]]` and renders them as inline tap targets | Component |
| SC-13 | Unrecognized/malformed token is rendered as literal text (visible bug, not silent swallow) | Component |
| SC-14 | Tapping `[[open-prefs:travel:UID]]` opens own travel section when `UID === self`; opens read-only view of `UID`'s travel section otherwise | Component + Cross-layer |
| SC-15 | `PreferencesSheet` with `viewParticipantId` set loads that user's prefs, renders read-only, displays "{Name}'s picks (read-only)" header | Component |
| SC-16 | `PreferencesSheet` with `viewParticipantId` set NEVER calls `upsert_participant_prefs` for any tap path (invariant `I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE`) | Component + Strict-grep |
| SC-17 | `PreferencesSheet` with `initialFocusSection` set scrolls to that section on mount | Component |
| SC-18 | `PreferencesSheet` with both new props undefined behaves byte-for-byte as today | Component (regression) |
| SC-19 | Solo deck dead-end path is untouched (`isBoardSession` gate at SwipeableCards.tsx:1886 still in place) | Component (regression) |
| SC-20 | No edit to `discover-cards/index.ts`, no edit to any migration in `supabase/migrations/`, no edit to aggregator, no new `message_type` value — Contract 5 invariant intact | Backend (negative criterion) |
| SC-21 | Strict-grep gate `i-proposed-orch-0945-dead-end-reason-coverage` PASSES on the implementor's branch | CI |
| SC-22 | Strict-grep gate `i-proposed-orch-0945-prefs-sheet-read-only-no-write` PASSES on the implementor's branch | CI |
| SC-23 | All existing strict-grep gates still PASS post-fix (ORCH-0939, ORCH-0931, ORCH-0943, ORCH-0863) | CI (regression) |
| SC-24 | Sim live-fire on iOS sim for at least `intersection_empty` (1 outlier) — banner posts, link tap routes correctly for both self + other-tapper | Tester live-fire |
| SC-25 | Sim live-fire on Android emulator for at least `intersection_empty` (1 outlier) parity check | Tester live-fire |

---

## 5. Invariants

**New invariants (registered in `Mingla_Artifacts/INVARIANT_REGISTRY.md`):**

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-DEAD-END-REASON-COVERAGE` | Every value of `PositionalDeadEndReason` (5 total) must have a dedicated render branch in `SwipeableCards` dead-end. No fall-through to generic copy. | Strict-grep gate `i-proposed-orch-0945-dead-end-reason-coverage` scans `SwipeableCards.tsx` for all 5 reason string literals inside the dead-end render helper. |
| `I-PROPOSED-COLLAB-DEAD-END-PAYLOAD-PROPAGATED` | `deckService` collab-v2 path must surface `acceptedCount` + `pendingGpsUserIds` in its return shape. Regression guard against future "reason only" reversions. | Strict-grep gate same file scans `deckService.ts` for the field names inside the collab-v2 return block. |
| `I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE` | When `PreferencesSheet` has `viewParticipantId` set, no code path may call `upsert_participant_prefs` or `PreferencesService.updateUserPreferences`. | Strict-grep gate `i-proposed-orch-0945-prefs-sheet-read-only-no-write` scans `PreferencesSheet.tsx` for those RPC/service names and verifies an `isEditable` guard within 10 lines above each call site. |

**Existing invariants preserved:**

- Contract 5 of `PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` — no backend touches.
- All `I-PROPOSED-ORCH-0943-*`, `I-PROPOSED-ORCH-0939-*`, `I-PROPOSED-ORCH-0931-*` invariants preserved.
- ORCH-0902 deck determinism · ORCH-0909 positional shared deck · V_n contract · bouncer chain rules — all untouched.

---

## 6. Test cases

### Implementor regression tests (T-01..T-09)

| Test | Scenario | Expected | `[FAILS-ON-REVERT KEY]` |
|---|---|---|---|
| T-01 | `intersection_empty` 1-outlier render | Title = "{Outlier} is too far from the group" + diagnostic shows 3 participant rows by first name | YES |
| T-02 | `intersection_empty` multi-outlier render | Title = "No location overlap yet" + N inline name links | NO |
| T-03 | `no_matching_candidates` GPS-gap render | Title names the pending participant | YES |
| T-04 | `no_matching_candidates` no-categories render | Generic "Pick some categories" prompt | NO |
| T-05 | `no_unswiped_candidates` render | "Review dismissed" CTA preserved alongside notify CTA | NO |
| T-06 | `quorum_not_met` render | Pending names listed | NO |
| T-07 | `all_pools_exhausted` render | Date-widen suggestion in copy | NO |
| T-08 | "Notify the group" inserts a system message | `boardDiscussionService.sendMessage` called with `user_id: null` + token-bearing content | YES |
| T-09 | Debounce: same banner within 5min | No second insert OR short "re-flagged" variant | YES |

### Tester adversarial tests (T-A01..T-A10)

| Test | Scenario | Expected |
|---|---|---|
| T-A01 | `PreferencesSheet` with `viewParticipantId` set — try to tap every chip | No state change; no RPC fires |
| T-A02 | `PreferencesSheet` with `viewParticipantId` — call save handler directly | Function short-circuits on `!isEditable`; no RPC |
| T-A03 | Malformed token in system message: `[[open-prefs:invalid]]` | Renders as literal text |
| T-A04 | Token with injection attempt: `[[open-prefs:travel:'); DROP TABLE--]]` | Renders as literal text (regex pattern locks alphanumeric+dash+underscore only) |
| T-A05 | Tap deep-link from chat as the named user | Opens own editable PreferencesSheet focused on right section |
| T-A06 | Tap deep-link from chat as a different user | Opens read-only view of named user's prefs |
| T-A07 | Rapid-tap "Notify the group" 5x within 1 second | At most 1 banner inserts; debounce holds |
| T-A08 | Multi-outlier banner with 3 inline name tokens — tap each | Each routes to correct user's sheet (self vs other) |
| T-A09 | `quorum_not_met` `[[compose-mention]]` token tap | Composer opens with `@{name}` pre-filled |
| T-A10 | Existing system messages (round-start, "Plan another outing") without tokens | Render unchanged from today (no regression on ORCH-0918/0898/0899 banners) |

### Sim live-fire (tester phase)

- **iOS sim:** `intersection_empty` 1-outlier scenario (set 2 participants with non-overlapping reach; verify banner posts; tap link as outlier opens own travel; tap link from other account opens read-only view).
- **Android emulator:** same scenario, parity check.
- **Other 4 reasons:** source-only verification acceptable with confidence ceiling `suspected` per Phase 0.A (matches operator's investigation dispatch).

---

## 7. Implementation order

1. **Service layer** (`deckService.ts`) — extend collab-v2 return shape with `collabDeadEndPayload`. Backwards-compatible. Land first; all downstream consumers see new field.
2. **Context layer** (`RecommendationsContext.tsx`) — propagate `collabDeadEndPayload`.
3. **New service** (`collabDeadEndBannerService.ts`) — write the banner-post helper with debounce. No UI yet.
4. **MessageBubble token parser** — extend system-message branch with token detection + tap routing. Plain text for unrecognized tokens. Test in isolation.
5. **PreferencesSheet new props** — add `viewParticipantId` + `initialFocusSection`. Central `isEditable` guard. Test that existing callers (no new props) are unchanged.
6. **SwipeableCards dead-end branch** — replace 2-branch ternary with per-reason renderer. Wire to banner service. Wire token-tap routing to sheet props via context event.
7. **Invariants + strict-grep gates** — register 3 invariants in `INVARIANT_REGISTRY.md`; add 2 strict-grep scripts to `.github/scripts/strict-grep/`; register in `.github/workflows/strict-grep-mingla-business.yml`.
8. **Regression tests** — write T-01..T-09 in `app-mobile/src/components/__tests__/orch-0945-*.test.tsx` with at minimum T-01, T-03, T-08, T-09 carrying `[FAILS-ON-REVERT KEY]` markers. CI runs them.

---

## 8. Regression prevention

| Risk | Safeguard |
|---|---|
| Future implementor adds a 6th `PositionalDeadEndReason` value server-side and forgets the client render branch | `I-PROPOSED-DEAD-END-REASON-COVERAGE` strict-grep gate fails CI |
| Future implementor drops `acceptedCount`/`pendingGpsUserIds` from `deckService` return | `I-PROPOSED-COLLAB-DEAD-END-PAYLOAD-PROPAGATED` strict-grep gate fails CI |
| Future implementor adds an edit handler in `PreferencesSheet` without `isEditable` guard, leaking write capability into read-only mode | `I-PROPOSED-PREFS-SHEET-READ-ONLY-NO-WRITE` strict-grep gate fails CI |
| Token-injection vector (XSS-style) via malicious system message content | Regex pattern is alphanumeric+dash+underscore+colon only; everything else renders as plain text. T-A04 verifies. |
| ORCH-0918 existing banners regress | T-A10 verifies; no token = render-unchanged path |
| Solo deck inadvertently inherits collab dead-end behavior | `isBoardSession` gate at SwipeableCards.tsx:1886 preserved; SC-19 verifies |

---

## 9. Hard guards (implementor must respect)

- **NO** edit to `supabase/`, `mingla-business/`, `mingla-admin/`, `packages/`, OR any file under `~/.claude/`.
- **NO** edit to `messages` table schema, `messages_message_type_check` constraint, or any migration file.
- **NO** new `message_type` value — `'text'` + NULL sender remains the only path for system messages.
- **NO** `supabase db push` — no DB changes possible since none are in scope.
- **NO** edge function deploy — no edge function changes in scope.
- **NO** push to remote, open PR, or merge until operator-confirmed CLOSE.
- **NO** `[deploy]` tag (mobile-only diff; Vercel deploys do not need to fire).
- **NO** edit to `useBoardSession.ts:updatePreferences` or the existing `upsert_participant_prefs` RPC contract.
- **NO** widening of scope to chat-native sheet META-ORCH territory.

---

## 10. Expected staged file count + paths

| # | Path | Action |
|---|---|---|
| 1 | `app-mobile/src/services/deckService.ts` | Modify — extend return shape |
| 2 | `app-mobile/src/contexts/RecommendationsContext.tsx` | Modify — propagate payload |
| 3 | `app-mobile/src/components/SwipeableCards.tsx` | Modify — per-reason dead-end render |
| 4 | `app-mobile/src/components/PreferencesSheet.tsx` | Modify — new 2 props + isEditable guard |
| 5 | `app-mobile/src/components/discussion/MessageBubble.tsx` | Modify — token parser |
| 6 | `app-mobile/src/services/collabDeadEndBannerService.ts` | Create — banner helper |
| 7 | `app-mobile/src/services/__tests__/collabDeadEndBannerService.test.ts` | Create — debounce + insert test |
| 8 | `app-mobile/src/components/__tests__/orch-0945-dead-end-render.test.tsx` | Create — T-01..T-07 component renders |
| 9 | `app-mobile/src/components/__tests__/orch-0945-message-bubble-token-parser.test.tsx` | Create — T-A03, T-A04 token parser |
| 10 | `app-mobile/src/components/__tests__/orch-0945-prefs-sheet-read-only.test.tsx` | Create — T-A01, T-A02 read-only mode |
| 11 | `.github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.mjs` | Create — strict-grep gate |
| 12 | `.github/scripts/strict-grep/i-proposed-orch-0945-dead-end-reason-coverage.test.mjs` | Create — gate self-test |
| 13 | `.github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.mjs` | Create — strict-grep gate |
| 14 | `.github/scripts/strict-grep/i-proposed-orch-0945-prefs-sheet-read-only-no-write.test.mjs` | Create — gate self-test |
| 15 | `.github/workflows/strict-grep-mingla-business.yml` | Modify — register 2 new jobs |
| 16 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Modify — register 3 invariants |
| 17 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` | Create — implementor report |

**Expected staged file count: 17.** Implementor may compress by combining test files; final count between 14-18 is acceptable.

---

## 11. Open questions deferred to IMPLEMENT

These do not block the SPEC; implementor chooses with operator override possible:

1. **Debounce — silent no-op vs short "re-flagged" variant.** Implementor picks one. Document choice in implementation report.
2. **Token-tap dispatch shape** — context event vs prop drilling vs imperative ref. SPEC requires centralization; implementor picks the React-idiomatic shape.
3. **Outlier-detection helper location** — co-locate in `SwipeableCards.tsx` vs new helper module. Implementor picks. If new module, must be under `app-mobile/src/utils/`.
4. **i18n keys** — add new keys to `app-mobile/src/locales/en/cards.json` (and any other relevant namespace) but defer translation. English-only this pass.
5. **Mixpanel analytics for banner post** — defer if non-trivial; flag in implementation report if added.

---

## 12. Next-handoff

NEXT HANDOFF — paste into Codex `implementor-mingla` (or Claude `mingla-implementor` if operator prefers):

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` consuming the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md`. Mobile-only diff, iOS + Android consumer, no backend changes (Contract 5 of `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` holds). Stage exactly the 14-18 files in §10. Honor all 9 hard guards in §9 — no edge function deploy, no `supabase db push`, no push/PR/merge. Use `/ui-ux-pro-max` as the pre-flight design step before writing any visible UI code per operator memory. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0945_COLLAB_DECK_DEAD_END_UX_POLISH.md` with old→new receipts and the implementation report template, then return to the operator. Mandatory regression tests: T-01..T-09 in §6 must run + report; at minimum T-01, T-03, T-08, T-09 carry `[FAILS-ON-REVERT KEY]` markers and the implementor verifies fails-on-revert by reverting then running. The next dispatch will be Claude `mingla-tester` for TARGETED test mode with live-fire on iOS sim + Android emulator for `intersection_empty` 1-outlier scenario (SC-24, SC-25), then Codex `orchestrator-mingla` for CLOSE. No `[deploy]` tag at CLOSE (mobile-only).

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
