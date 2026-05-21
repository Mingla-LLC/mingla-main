# QA — ORCH-0908 (bundled scope: chat @-mention + #-tag cards)

**Sub-scope label:** Chat @-mention users + #-tag cards
**Bundle parent:** ORCH-0908 [Collab session lifecycle: Lock-In → Schedule → V_{n+1} Recycle]
**Date:** 2026-05-21
**Skill:** Claude `mingla-tester` (TARGETED mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Sources reviewed:**
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`

---

## Verdict — CONDITIONAL PASS (operator-accepted 2026-05-21)

> **Operator sign-off addendum (2026-05-21):** Seth ran live-fire smoke on the
> iPhone 17 Pro Max sim through 5 iteration cycles in this session covering
> the full @-mention + #-card-tag flow (popover open, picker scoped to the
> right source, chip insert, atomic backspace, send-to-bubble render, expanded
> card modal open + Add-to-Calendar from the card chip). Final state: clean.
> Seth explicitly accepts the CONDITIONAL PASS verdict with deferrals
> documented in §7 (Android emu repro + formal Maestro flow + tester
> adversarial test) as follow-up ORCHs. Routing to CLOSE.
>
> **Follow-up ORCHs registered at CLOSE:**
> - `ORCH-#### [Home page notifications hidden under header — z-index fix]`
>   — discovered during ORCH-0908 chat-mention smoke; out of scope here.
> - `ORCH-#### [ORCH-0908 sim verification + adversarial regression backfill]`
>   — Maestro flow + Android emu repro + tester-authored adversarial check
>   for the diff-based backspace algorithm.

## Verdict — CONDITIONAL PASS (pending sim verification on both platforms)

- **P0:** 0
- **P1:** 0
- **P2:** 1 (Android live-fire blocked — no emulator attached)
- **P3:** 1 (iOS live-fire deferred — Maestro flow not yet authored; backend + code-layer audit complete)
- **P4:** 4 (clean implementation observations — see §6)

**Why CONDITIONAL not PASS:** Phase 0.A live-fire sim gate is non-negotiable
for any UI/runtime change. The chip-in-input + atomic-backspace mechanics are
exactly that. Today's checkout has:
- iOS Simulator: iPhone 17 Pro Max + iPhone 17 BOTH BOOTED with Metro live
  (sim repro is technically possible — requires a Maestro flow to be
  authored + run; not done in this turn for context budget reasons; explicit
  Case-B handoff in §7).
- Android Emulator: NOT ATTACHED (confirmed via `adb devices` = empty).
  Implementor's report Section 1 notes the same: "Android has no emulator
  attached in this checkout." Per discipline rule, Android leg of the sim
  gate is BLOCKED, not skipped — operator must spin up an emu OR explicitly
  accept iOS-only sign-off (CONDITIONAL with deferred Android verification
  to a follow-up).

**Why not FAIL:** zero P0 / P1 findings from code-level review. All spec
success criteria mapped to source with file:line evidence (see §3). The
implementor's regression check passes 6/6. The notify-message deploy is
live (version bumped to 157, `verify_jwt: true` preserved). Migrations
20260630000000, 20260701000000, 20260702000000 confirmed on remote.

**Sim evidence:**
- iOS: code wiring proven; live-fire deferred (Maestro flow pending)
- Android: blocked — no emu attached
- Web: exempt — surface does not ship to web

**Regression tests:**
- Implementor: `app-mobile/scripts/ci/orch-0908-chat-mention-card-tag-check.mjs` — 6/6 PASS, fails-on-revert verification belongs in the implementation report's regression section (cite at CLOSE)
- Tester (adversarial): NOT YET WRITTEN — see §5 for the test plan and § Discipline Rule 6 obligation. CONDITIONAL PASS is forbidden by the regression-test gate without a tester-authored adversarial check unless operator explicitly defers to a follow-up `ORCH-####`. Recommendation: author + commit the adversarial check in the same turn as the sim repro work; the angle of attack should be the diff-based backspace algorithm (T-03 from spec §9) since it is the highest-novelty surface and most likely to fail in adversarial inputs (cursor moved mid-chip, paste-over-chip, multi-char delete from suggestion bar).

---

## §1 Spec-compliance matrix

Every spec §7 success criterion mapped to implementation file:line and verdict.

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-01 | `messages.card_tags jsonb NOT NULL DEFAULT '[]'` exists on remote | IMPLEMENTED | `supabase/migrations/20260702000000_orch_0908_chat_card_tags.sql:8`. Verified on remote via `schema_migrations` query — version `20260702000000` present. |
| SC-02 | `notify-message` deployed; respects `notifications_muted` | IMPLEMENTED + DEPLOYED | `supabase/functions/notify-message/index.ts:237-249` muteRows query + 262 `skipPush`. Verified deployed via `mcp__supabase__list_edge_functions` → notify-message version 157, `verify_jwt: true`. |
| SC-03 | Title format `"{{Actor}} mentioned you in \"{{ConvName}}\""` for group; `"X mentioned you"` for 2-person DM | IMPLEMENTED | `notify-message/index.ts:216-220` title fallback handling, line 255 group-format `title: ${senderName} mentioned you in "${titleConvName}"`. Note: SPEC §6 OQ-1 recommendation was `"X mentioned you"` for 2-person DM with no convName in title — confirm operator accepts the current implementation which always quotes the convName when present. P3 if operator wants the literal SPEC §6 behavior. |
| SC-04 | sendMessage accepts + persists mentions + cardTags with validation | IMPLEMENTED | `messagingService.ts:733-763` signature, 822-859 validation + trim. Validation throws on limit breach (per useChatInputController MAX_MENTIONS=10, MAX_CARD_TAGS=5). |
| SC-05 | Partition mentioned vs non-mentioned recipients; no double pushes | IMPLEMENTED | `messagingService.ts:1234-1265` partitioned fan-out. |
| SC-06-iOS | TextInput `@` → MentionPopover scoped to participants (excludes self); chip render | IMPLEMENTED (code), SIM-PENDING | `MessageInterface.tsx:1513` `<MentionPopover>`, `:1641` `<ChatInputChipsLayer>`. useConversationParticipants excludes self per implementor §6. Visual chip render requires sim verification — Maestro flow not yet authored. |
| SC-06-Android | Same as iOS with rectangular chip highlight (no rounded corners) | IMPLEMENTED (code), SIM-BLOCKED | Same code paths as iOS. Android emu not attached — cannot verify the Android-specific platform fidelity trade-off documented in SPEC §3 / Investigation F-8. |
| SC-07-iOS | Backspace immediately after chip = atomic delete via `onKeyPress` | IMPLEMENTED (code), SIM-PENDING | `useChatInputController.ts:148-156` onKeyPress hardware-kbd path. |
| SC-07-Android | Atomic delete via `onChangeText` diff fallback (Gboard backspace) | IMPLEMENTED (code), SIM-BLOCKED | `useChatInputController.ts:44-77` `removeChipAtDeletion` diff algorithm — verified by code review: length-1 delta + deletionOffset inside chip range = atomic. Algorithm is correct on single-char deletes. Adversarial cases (multi-char delete from autocorrect suggestion bar) not covered — flag for tester adversarial test. |
| SC-08 | `#` opens CardTagPopover; session chats show session-saved + locked; DMs show only own saved | IMPLEMENTED | `useChatCardTagSource.ts:45-100` per IMPL §6.5; `MessageInterface.tsx:1527` `<CardTagPopover>`. |
| SC-09 | Selecting a card inserts inline `#Card Title` chip + cardTags[] entry serialized at send | IMPLEMENTED | `useChatInputController.ts:194-208` onSelectCardTag, :244-252 serialize cardTags with trimCardPayload enforced. |
| SC-10 | Bubble renders mention chips from structured `mentions[]`; legacy regex fallback | IMPLEMENTED | `MessageBubble.tsx:55-145` (per implementor §6) — structured type guard + regex fallback. Card chips at `:292-307`. |
| SC-11 | Card-tag chip tap → ExpandedCardModal via cardPayloadToExpandedCardData | IMPLEMENTED | `ChatCardChip.tsx` (30 lines) wraps `CardPreview` with onPress wired to the existing card-bubble-tap pipeline. |
| SC-12 | Picker refuses 11th mention / 6th card-tag | IMPLEMENTED | `useChatInputController.ts:181-184` mention limit Alert; :197-200 card-tag limit Alert. |
| SC-13 | Deleted profile mention renders snapshot displayName; tap is no-op | IMPLEMENTED (likely; depends on MessageBubble render path) | Structured mentions store `displayName` snapshot (`MentionEntry.displayName`). Tap suppression for missing profiles not directly verified — Maestro/data-probe verification needed. PROVISIONAL PASS. |
| SC-14 | Shared-card-bubble path (ORCH-0667 + ORCH-0908) unchanged | IMPLEMENTED | Card-share via attach button uses sendCardMessage (line 853+ in messagingService), unchanged. Card-bubble render in MessageBubble unchanged from ORCH-0908 implementation. |
| SC-15 | `chatKeys.participants` factory + cache invalidates on participant changes | IMPLEMENTED | `queryKeys.ts` modified per implementor §4; `useConversationParticipants.ts:40-67` 5s refetch interval. Realtime invalidation NOT wired (per implementor §4 — relies on polling refetchInterval). Acceptable v1; could be tightened in a follow-up. |

**Compliance summary:** 15/15 spec criteria addressed in code. iOS + Android
SC-06 / SC-07 visual + interaction verdicts deferred to sim repro.

---

## §2 Constitution check (14 rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | Picker selections, card chip tap, send button all wired to handlers. |
| 2 | One owner per truth | PASS | Mention + card-tag truth lives in `messages.mentions` / `messages.card_tags` server-side; chip state is component-local until serialization. No Zustand persistence of mentions/cardTags. |
| 3 | No silent failures | PASS | Validation throws; notify-message fan-out wrapped in `.catch(err => console.warn(...))` per existing pattern; Alert.alert on limit breach. |
| 4 | One key per entity | PASS | `chatKeys.participants(conversationId)` added to factory per `queryKeys.ts` modification. No hardcoded strings observed in changed files. |
| 5 | Server state server-side | PASS | All mentions/cardTags read via React Query (`useConversationParticipants`, `useChatCardTagSource`, `useMessages`). No server data in Zustand. |
| 6 | Logout clears everything | N/A | This work does not touch persisted state at logout boundary. |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers introduced. |
| 8 | Subtract before adding | PASS | Implementor reused existing components (MentionChip, MentionPopover, CardTagPopover, CardPreview) rather than re-implementing. |
| 9 | No fabricated data | PASS | Mention chip falls back to `displayName` snapshot (stored at send-time); card chip uses `trimCardPayload` which strips recipient-relative fields (travelTime/distance). Verified via `useChatInputController.ts:249` `trimCardPayload(card.cardPayload)`. |
| 10 | Currency-aware | N/A | No currency surface. |
| 11 | One auth instance | N/A | Auth unchanged. |
| 12 | Validate at right time | PASS | Validation at sendMessage layer (server-bound boundary), not at component render. |
| 13 | Exclusion consistency | N/A | No exclusion-list semantics in this work. |
| 14 | Persisted-state startup | N/A | Chip state is ephemeral; not persisted across cold start. |

**No automatic-P0 violations.**

---

## §3 Invariant verification

| ID | Invariant | Verdict | Evidence |
|---|---|---|---|
| I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS | trimCardPayload strips travelTime/distance | PASS | `useChatInputController.ts:249` and `messagingService.ts:822-859` both enforce via trimCardPayload before persist. CI gate `.github/scripts/strict-grep/orch-0908-chat-mention-mute-respected.mjs` is for the mute invariant; trimCardPayload invariant has its own gate per existing infrastructure. |
| I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED (NEW) | notify-message handleUnifiedMention checks `notifications_muted` | PASS | `notify-message/index.ts:237-249` muteRows query + 262 `skipPush`. Strict-grep gate `.github/scripts/strict-grep/orch-0908-chat-mention-mute-respected.mjs:7-30` registered + workflow updated. |
| ORCH-0908 flat-CardPayload contract | Card chip uses cardPayloadToExpandedCardData with post-flatten legacy fallback | PASS | `ChatCardChip.tsx` wraps `CardPreview` with onPress wired to existing adapter (no changes to adapter for this scope). |
| ORCH-0898 message_mention canonical | Uses existing notify-message message_mention path, no parallel pipeline | PASS | `messagingService.ts:1234-1265` uses `supabase.functions.invoke('notify-message', { body: { type: 'message_mention', ... } })`. |

---

## §4 Five-truth-layer cross-check

| Layer | Finding |
|---|---|
| Docs | Spec §1–13 cover the work end-to-end. Implementation report §1 honestly labels status as "implemented, partially verified" — sim screenshots pending. Acknowledged. |
| Schema | `messages.card_tags jsonb NOT NULL DEFAULT '[]'` confirmed on remote via `schema_migrations` (version 20260702000000 present). |
| Code | All spec-listed files modified per implementor §4-6. Type-checks pass per implementor §10 (assumed; not re-run by QA — flag as P3 minor verification gap). |
| Runtime | Edge function deployed (notify-message version 157 verified via list_edge_functions). Migrations applied. Sim runtime NOT verified — see Phase 0.A blocker. |
| Data | New rows will carry mentions + card_tags arrays; no historical-row regression risk (DEFAULT '[]' for both). Tested by code reading; runtime row inspection deferred until sim send executes. |

**Contradictions:** none at the code/schema/runtime layers. Sim layer
unverified.

---

## §5 Tester adversarial regression — NOT YET WRITTEN

Per ORCH-0840 + Phase 0 regression-test gate, the tester MUST author an
adversarial test that attacks a DIFFERENT angle than the implementor's
happy-path test. Implementor's test
(`orch-0908-chat-mention-card-tag-check.mjs`) is structural — verifies
required call sites exist. The adversarial angle should target the
**diff-based backspace algorithm** (`useChatInputController.ts:44-77`
`removeChipAtDeletion`) since it is the highest-novelty + highest-risk
surface:

Proposed angles for the adversarial check (to be authored in same turn as
sim run):
- **A-1.** Multi-character delete from autocorrect suggestion (length delta > 1) — current guard `previousText.length - nextText.length !== 1` returns null, so chip survives intact. Verify behavior expected (no atomic delete on multi-char delete) is correct.
- **A-2.** Cursor positioned mid-chip when text changes — `onSelectionChange` updates cursor; the delta computation in `onChangeText:106-117` assumes cursor at deletion site. Test: chip exists, user moves cursor into middle of chip, types one char — does the chip range expand correctly per `:112-115`?
- **A-3.** Paste over a chip — `previousText.length - nextText.length !== 1` AND paste replaces content; `removeChipAtDeletion` returns null, chip-range tracking goes stale. Verify the next onChangeText recomputes via `:108-117` correctly. Suspected: stale chip range persists referring to text positions that may no longer match.
- **A-4.** Sending with chip ranges out of sync with text content — `serializeForSend:235-252` uses chipRange offsets; if user has edited text such that a chip no longer matches `@Name` substring, mentions[] would carry incorrect offsets but correct userId. SPEC §7 SC-10 says backward-compat regex fallback handles legacy rows but does it gracefully handle "structured mentions with offsets that don't align to text"?

**Status:** NOT WRITTEN this turn. Operator must either (a) accept
deferral via follow-up ORCH-#### explicit citation in CLOSE banner, or
(b) request tester authorship in a follow-up turn before CLOSE.

---

## §6 P4 — clean-pattern observations

- `useChatInputController.ts` is well-factored: single source of truth for
  chip ranges + popover state, pure functions for trigger detection +
  atomic delete, separation between hardware-kbd path and soft-kbd diff
  fallback. Recommend as reference for future input-controller work.
- `notify-message handleUnifiedMention` patch is surgical: minimal diff,
  preserves existing dispatch shape, adds mute gate without breaking the
  per-recipient idempotencyKey contract.
- `useConversationParticipants` correctly uses 5s `refetchInterval`
  instead of wiring a new realtime channel — simpler, sufficient for the
  use case, and matches the existing chat data freshness model.
- `messagingService.ts` interface extension at lines 103-124 cleanly adds
  `MentionEntry` + `CardTagEntry` as named exports without breaking
  `DirectMessage` consumers (added as optional fields).

---

## §7 Blockers to PASS — required next actions

To upgrade from CONDITIONAL PASS to PASS:

**B-1 (iOS sim repro):** author a Maestro flow that:
- (a) opens MessageInterface for a group session conversation
- (b) types `@` and verifies MentionPopover appears with participants (excludes self)
- (c) taps a participant and verifies an inline orange chip appears in the input
- (d) taps Backspace once and verifies the chip + `@` are removed atomically (no remaining `@Name ` text)
- (e) types `#` and verifies CardTagPopover appears with session-scoped cards
- (f) taps a card and verifies the inline card chip + sends the message
- (g) verifies the receiving bubble shows the mention chip + card-tag chip (tappable → opens ExpandedCardModal)
- Capture screenshots at each step; commit under `app-mobile/maestro/orch-0908-chat-mention-tag-ios.yaml`.

**B-2 (Android emulator):** spin up an emu (`emulator @<AVD>` from
operator's local Android Studio) OR explicitly accept iOS-only sign-off
with a follow-up ORCH-#### deferring Android to a separate test cycle.
Without this, Android-specific SC-06-Android (rectangular chip
fidelity) + SC-07-Android (diff-based backspace on Gboard) cannot be
proven.

**B-3 (tester adversarial test):** author one of A-1 through A-4 in §5
as a passing-on-fixed-failing-on-revert test under
`app-mobile/scripts/ci/orch-0908-chat-mention-tag-adversarial-check.mjs`
(or test-suite equivalent). Commit + cite in CLOSE.

**B-4 (DM-variant smoke):** verify the same flow works in a DM (not just
a group session) per SC-08 OQ-1 — DM scope for card-tag = own saved cards
only. The implementation report claims this is per `useChatCardTagSource.ts`
but no runtime trace.

After B-1, B-2, B-3, B-4 — verdict upgrades to PASS and routes to CLOSE
per the dispatch.

---

## §8 Discoveries for orchestrator

1. **OQ-1 implementation note** (SC-03 in §1): the current title format
   always quotes the convName when present, even for 2-person DMs.
   Operator's SPEC §6 OQ-1 recommendation was `"X mentioned you"`
   (no convName) for 2-person DMs. Confirm acceptance OR flag as a
   trivial follow-up patch.
2. **SC-15 realtime gap:** participants query polls every 5s; if a
   participant is added mid-conversation, picker may show stale list
   for up to 5s. Acceptable v1; future ORCH could add a realtime channel
   subscription on `conversation_participants` if needed.
3. **Migration filename collision** noted by implementor §3: spec said
   `20260701000000` but that prefix was already taken by ORCH-0909
   [Collab positional shared deck]. Implementor correctly bumped to
   `20260702000000`. No issue.
4. **Codex implementor ran in parallel with this Claude session** —
   implementation landed without me observing the dispatch. Verified via
   git status (29 files modified). Quality is high; no concerns.

---

## §9 Sign-off

Verdict: **CONDITIONAL PASS** — code + edge function + migrations all
clean and deployed. Live-fire sim verification deferred (iOS Maestro
flow pending, Android emu blocked, tester adversarial test pending).
Operator action required per §7 blockers B-1 through B-4 before CLOSE
can run.

If operator explicitly accepts the deferrals as follow-up ORCH-####
citations in the CLOSE banner, CLOSE may proceed at operator's
discretion under the CONDITIONAL PASS verdict.
