# Implementation Report: ORCH-0908 [Collab session lifecycle lock+schedule+recycle + chat @-mention + #-tag cards]

> Date: 2026-05-21  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`  
> Dispatch: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`  
> Status: implemented, partially verified

## 1. Layman Summary

Unified chat now has the wired substrate for participant `@` mentions and saved-card `#` tags: the composer can track chip ranges, serialize mentions/card tags on send, persist them through `messagingService`, render structured mention/card chips in bubbles, and route card chips into the existing ExpandedCardModal. The notify-message edge function now formats mention push titles as `{{Actor}} mentioned you in "{{ConvName}}"` and respects `conversation_participants.notifications_muted` while preserving the in-app notification row. Runtime simulator screenshots, DB push receipt, and edge deploy/version-bump remain pending because the operator owns the migration push and Android has no emulator attached in this checkout.

## 2. Request And Context

- **Request:** Implement locked chat @-mention + #-card-tag spec as part of parent ORCH-0908 PR.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`.
- **Affected surfaces:** consumer mobile iOS/Android shared RN code, `notify-message`, strict-grep CI, Supabase migration.
- **Related artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`, `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0908_COLLAB_SESSION_LIFECYCLE.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`.

## 3. Scope

- **In scope:** `messages.card_tags` migration, `notify-message` mention patch, message service validation/fan-out, chat input controller, conversation participants/card tag source hooks, input chips, bubble rendering, regression gate.
- **Out of scope:** `BoardDiscussionTab`, active-deck card tags, new mute UI, app-wide mention search, edge deploy before operator migration confirmation.
- **Assumptions corrected:** the spec requested migration `20260701000000_orch_0908_chat_card_tags.sql`, but linked remote history already contains version `20260701000000` for ORCH-0909; this implementation uses `20260702000000_orch_0908_chat_card_tags.sql` to preserve monotonic Supabase history.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `MessageInterface.tsx` | composer owner | Plain TextInput path; shared DM/session chat mount. |
| `MessageBubble.tsx` | message renderer | Regex-only mention renderer; card bubble tap already uses ExpandedCardModal path. |
| `messagingService.ts` | send/persist/notify owner | `trimCardPayload` exists; sendMessage needed structured args + partitioned notifications. |
| `notify-message/index.ts` | edge mention handler | `message_mention` existed but lacked mute check and title format. |
| `MentionPopover.tsx`, `CardTagPopover.tsx`, `MentionChip.tsx`, `CardPreview.tsx` | reusable UI | Existing components could be reused without changing `BoardDiscussionTab`. |
| `queryKeys.ts`, `useSavedCards.ts` | cache/query patterns | Added `chatKeys.participants`; reused own saved-card query for DM tags. |

## 5. Blast Radius

- **Direct changes:** chat composer, chat bubble renderer, message service, notify-message, migration, regression/strict-grep gates.
- **Cascade changes:** `ConnectionsPage` now passes mentions/cardTags through optimistic and persisted message transforms; `connectionsService`/`useMessages` types now tolerate new message fields.
- **Parity surfaces:** iOS/Android share code; Android chip rounded corners intentionally degrade to rectangular highlight.
- **Cache impact:** `chatKeys.participants(conversationId)` added; participant hook refetches every 5s without adding realtime channels.
- **State boundaries:** chip state is local component/hook state only; persisted truth stays on `messages`.
- **Auth/RLS/security:** no RLS changes; row access remains governed by existing `messages` policies.
- **Deploy path:** operator runs DB push; Codex/orchestrator deploys `notify-message` only after migration is confirmed live.

## 6. Old To New Receipts

### `supabase/migrations/20260702000000_orch_0908_chat_card_tags.sql`
- **Before:** `messages` had `mentions` but no `card_tags`.
- **After:** adds `card_tags jsonb NOT NULL DEFAULT '[]'::jsonb` with comment and schema reload notice at lines 7-15.
- **Why:** stores `#` card-tag entries without overloading single-card `card_payload`.

### `supabase/functions/notify-message/index.ts`
- **Before:** `handleUnifiedMention` sent `${senderName} mentioned you` and ignored conversation mute.
- **After:** title fallback/name handling at lines 216-220; dedup/self-filter at line 230; `conversation_participants.notifications_muted` lookup at lines 235-249; `skipPush` for muted users at line 262.
- **Why:** satisfies OQ-1/OQ-3 and preserves in-app notification rows.

### `app-mobile/src/services/messagingService.ts`
- **Before:** `sendMessage` accepted only content/file/reply fields and always sent regular message notifications.
- **After:** `MentionEntry`/`CardTagEntry` fields at lines 103-120; send signature/persist at lines 733-763; validation + trim at lines 822-859; partitioned mention-vs-regular fan-out at lines 1234-1265.
- **Why:** persists structured mention/card-tag arrays and prevents duplicate mention + regular pushes.

### `app-mobile/src/hooks/useChatInputController.ts`
- **Before:** no unified chat input state machine.
- **After:** trigger detection, chip range tracking, atomic deletion fallback, max limits, filtered sources, and send serialization at lines 27-285.
- **Why:** keeps chip truth local until send-time serialization.

### `app-mobile/src/hooks/useConversationParticipants.ts`
- **Before:** no reusable participants hook for chat mentions.
- **After:** queries `conversation_participants -> profiles`, excludes self, and refetches within 5s at lines 40-67.
- **Why:** picker source is current conversation only.

### `app-mobile/src/hooks/useChatCardTagSource.ts`
- **Before:** no unified source for `#` card picker.
- **After:** session chats read `board_saved_cards WHERE session_id = X`; DMs reuse `useSavedCards` for current user at lines 45-100.
- **Why:** enforces OQ-4 and DM own-saved scope.

### `app-mobile/src/components/MessageInterface.tsx`
- **Before:** composer owned raw `newMessage` state and sent only plain content.
- **After:** mounts participant/card hooks and controller at lines 273-323; serializes mentions/cardTags at lines 523-550; passes structured data to bubbles at lines 1268-1297; TextInput renders styled inline chips at lines 1619-1642.
- **Why:** brings @/# pickers + inline chip behavior into the unified chat.

### `app-mobile/src/components/chat/MessageBubble.tsx`
- **Before:** regex-only mention chip rendering; no `card_tags`.
- **After:** structured mention type guard/render with legacy regex fallback at lines 55-145; card chips render below text at lines 292-307.
- **Why:** new rows render by offsets; old rows still render if content has legacy `@Name` text.

### New chat components
- **`ChatInputChipsLayer.tsx`:** styled inline `<Text>` chip spans with iOS radius/Android rectangular highlight at lines 10-61.
- **`ChatCardChip.tsx`:** wraps `CardPreview` for card-tag bubble chips at lines 11-30.

### Regression and CI gates
- **`app-mobile/scripts/ci/orch-0908-chat-mention-card-tag-check.mjs`:** 6 structural checks for T-01/T-04/T-08/T-15 + mute invariant at lines 25-86.
- **`.github/scripts/strict-grep/orch-0908-chat-mention-mute-respected.mjs`:** strict-grep invariant gate at lines 7-30.
- **`.github/workflows/strict-grep-mingla-business.yml`:** registered the ORCH-0908 gate.
- **`app-mobile/package.json`:** added `test:orch-0908-chat`.

## 7. Implementation Details

- **Architecture decisions:** kept UI state in a dedicated hook; persisted only structured arrays on `messages`.
- **Data flow:** TextInput chip ranges -> `serializeForSend()` -> `ConnectionsPage.handleSendMessage()` -> `messagingService.sendMessage()` -> `messages.mentions/card_tags`.
- **Mutation/query behavior:** service validates caps and required payload fields; `trimCardPayload()` runs in both controller and service.
- **State handling:** atomic delete uses `onKeyPress` plus `onChangeText` diff fallback.
- **Error handling:** service throws validation errors into existing send error path; edge warns on mute lookup failure but still dispatches in-app rows.
- **Copy/accessibility:** reused existing popover/chip components and `onViewProfile` for mention taps.
- **Notifications/realtime:** no new message realtime channels; new DB column rides existing messages INSERT payload.

## 8. Spec / Goal Traceability

| Criterion | Evidence | Verification | Status |
|---|---|---|---|
| SC-01 migration exists/remote column | migration lines 7-15 | local file PASS; remote post-push pending | PARTIAL |
| SC-02 mute respected | notify-message lines 235-262 | strict-grep PASS; runtime push pending deploy | PARTIAL |
| SC-03 title format | notify-message line 255 | source PASS; runtime rows pending deploy | PARTIAL |
| SC-04 send persists + validates | messagingService lines 733-859 | regression PASS | PASS structural |
| SC-05 recipient partition | messagingService lines 1234-1265 | regression/source PASS | PASS structural |
| SC-06 iOS picker/chip | MessageInterface lines 273-323, 1619-1642 | sim screenshot not captured | UNVERIFIED |
| SC-06 Android picker/chip | ChatInputChipsLayer lines 53-59 | no Android emulator attached | UNVERIFIED |
| SC-07 iOS atomic delete | useChatInputController lines 96-155 | structural only | PARTIAL |
| SC-07 Android atomic delete | useChatInputController lines 44-77, 96-103 | structural only | PARTIAL |
| SC-08 `#` picker scope | useChatCardTagSource lines 45-100 | regression PASS | PASS structural |
| SC-09 card entry attached/trimmed | controller lines 244-252; service lines 843-859 | regression PASS | PASS structural |
| SC-10 structured + legacy mention render | MessageBubble lines 55-145 | regression PASS | PASS structural |
| SC-11 card chip opens modal | MessageBubble lines 292-307; MessageInterface lines 1293-1297 | regression PASS; sim pending | PARTIAL |
| SC-12 max caps | controller lines 27-28, 178-205; service lines 822-845 | regression PASS | PASS structural |
| SC-13 deleted/missing profile fallback | MessageBubble line 98 uses snapshot displayName | runtime insert test pending | PARTIAL |
| SC-14 attach-button card share unchanged | existing `onCardBubbleTap` preserved lines 1286-1292 | manual T-13 pending | UNVERIFIED |
| SC-15 participants cache refresh | useConversationParticipants lines 40-67 | source PASS; runtime participant add pending | PARTIAL |

## 9. Invariant Verification

| Invariant | Preserved | Notes |
|---|---:|---|
| One owner per truth | Yes | server truth remains `messages`; chip ranges are transient draft state. |
| No silent validation failure | Yes | service rejects invalid mentions/card tags instead of truncating silently. |
| No fabricated display | Yes | missing profile renders mention snapshot displayName. |
| I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS | Yes | `trimCardPayload()` enforced before persist. |
| I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED | Yes structurally | strict-grep and source check PASS; live push pending deploy. |
| No new message realtime channels | Yes | participant refresh uses polling; message rows use existing realtime. |

## 10. Parity Check

- **Mobile:** shared RN implementation; iOS rounded chip / Android rectangular highlight per locked spec.
- **Business app/admin/public:** no code touched.
- **Solo/collab:** DMs use own saved cards; session group chats use `board_saved_cards`.
- **Gaps:** iOS screenshots not captured despite booted simulators; Android emulator absent (`adb devices` showed no devices). Tester must run actual sim repro.

## 11. Cache And Persisted State Safety

- **Query keys changed:** `chatKeys.participants(conversationId)` in `queryKeys.ts`.
- **Invalidations/refetch:** participant list refetches every 5 seconds; no new realtime channel added.
- **Data shape changes:** `DirectMessage`, `connectionsService.Message`, and `useMessages.Message` tolerate `mentions` and `card_tags`.
- **AsyncStorage/Zustand impact:** persisted cached messages now include structured fields when present; no Zustand server data added.
- **Cold start behavior:** historical rows default to `card_tags=[]` after migration; pre-migration cached rows render with missing/empty arrays.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Remote migration ordering | `/Users/sethogieva/bin/supabase migration list --linked` | PASS | remote has `20260630000000`; also has occupied `20260701000000`, causing filename deviation. |
| ORCH-0908 regression | `node app-mobile/scripts/ci/orch-0908-chat-mention-card-tag-check.mjs` | PASS 6/6 | covers T-01/T-04/T-08/T-15 structurally. |
| Package wrapper | `cd app-mobile && npm run test:orch-0908-chat` | PASS 6/6 | package script added. |
| Strict-grep invariant | `node .github/scripts/strict-grep/orch-0908-chat-mention-mute-respected.mjs` | PASS | registered in workflow. |
| Edge Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/notify-message/index.ts` | PASS | required edge check passed. |
| Edge Deno tests | `/Users/sethogieva/.deno/bin/deno test supabase/functions/notify-message/` | BLOCKED | no test modules found. |
| Scoped diff whitespace | `git diff --check -- ...scoped files...` | PASS | no whitespace errors. |
| App typecheck | `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL pre-existing | full repo has known unrelated errors; filtered ORCH-0908 paths show only existing `ConnectionsPage.tsx(2884,52)` friend-type mismatch. |
| iOS simulator availability | `xcrun simctl list devices booted` | PARTIAL | iPhone 17 Pro Max + iPhone 17 booted; feature repro not captured. |
| Android emulator availability | `adb devices` | BLOCKED | no attached Android devices. |

## 13. Regression Surface

1. Message sending and optimistic updates: now carry `mentions/cardTags`; existing file/card sharing paths still pass empty arrays by default.
2. Message bubble rendering: changed text rendering path for all text messages, with legacy regex fallback retained.
3. Notification fan-out: mentioned recipients no longer receive the regular new-message notification for the same message.
4. Supabase migration ordering: filename deviates from spec to avoid remote version collision.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Migration filename deviation | Spec expected `20260701000000`; remote already occupied | Operator accepts `20260702000000` and runs normal `supabase db push --linked` | migration lines 4-6 |
| Edge deploy pending | Live pushes still use old handler until deployed | Operator confirms migration push; Codex/orchestrator deploys `notify-message` and verifies version bump | `notify-message` |
| Sim screenshots missing | SC-06/07/11/14 not visually proven | Claude TEST mode runs iOS + Android repro with screenshots | QA phase |
| Android unavailable | No parity screenshot/run from this machine | Attach/start emulator before TEST | `adb devices` empty |
| App-wide typecheck dirty | Existing unrelated type errors remain | Separate cleanup or accepted known gate failure | see Verification |

## 15. Discoveries For Orchestrator

- `20260701000000` is already present on linked remote and local for ORCH-0909; CLOSE must call out that the chat migration uses `20260702000000` to avoid Supabase version collision.
- Android emulator was not attached during implementation; TEST needs Android setup before declaring parity.
- Edge deploy is intentionally not run; this report is not a deploy receipt.

## 16. Deploy Notes

- **Migrations:** operator should run `supabase db push --linked` after reviewing `supabase/migrations/20260702000000_orch_0908_chat_card_tags.sql`. Do not use MCP apply migration.
- **Edge functions:** after operator confirms the migration landed, deploy with `supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv`, then verify version bump via `mcp__supabase__list_edge_functions`.
- **Mobile:** no native dependency added; RN/Expo code only.
- **Env/secrets:** no new env vars.

## Suggested Commit Message

```text
chat: add mention and card-tag payloads

Resolves: ORCH-0908 [Collab session lifecycle lock+schedule+recycle + chat @-mention + #-tag cards]
Evidence: npm run test:orch-0908-chat; deno check notify-message; strict-grep mention mute gate
Deploy: operator db push for 20260702000000, then notify-message deploy
```

## Ready-To-Test Checklist

1. Operator reviews/accepts migration filename deviation, then runs `supabase db push --linked`.
2. Codex/orchestrator deploys `notify-message` and records `mcp__supabase__list_edge_functions` version bump.
3. Claude `mingla-forensics` TEST mode runs iOS sim + Android emu: `@` picker, mention chip insert, atomic backspace, `#` picker, card chip bubble tap to ExpandedCardModal, attach-button card share regression.
4. Tester verifies muted mentioned user gets no push but does get in-app notification row.
