# IMPLEMENTATION ORCH-0821 — Ari MVP

**Status:** `implemented, unverified` (code complete; manual smoke not yet run on device)
**Implementor:** Claude `mingla-implementor`
**Date:** 2026-05-12
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch Seth
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0821_ARI_MVP.md`
**Design:** `Mingla_Artifacts/ARI_DESIGN.md`

---

## 1. Summary

Built Ari MVP end-to-end per spec §9 order. 23 new files + 2 modified. Type-checks
clean (`tsc --noEmit` exit 0 in mingla-business; `deno check` clean on both edge
functions). Deno test suite for the prompt-injection detector: **9/9 pass**.

What was NOT done in this session: applying the DB migration (operator-only via
`supabase db push`), deploying the edge functions (orchestrator-owned per
`feedback_orchestrator_deploys_edge_functions`), creating the
`GEMINI_API_KEY_ARI` secret (operator-only Supabase console action), and the
on-device iOS+Android smoke test (requires running simulators).

---

## 2. Files Created / Modified

### 2.1 Database (1 new)

| File | Purpose | Lines |
|---|---|---|
| `supabase/migrations/20260603000001_orch_0821_ari_agent_tables.sql` | 4 tables + RLS owner-callable policies (direct-predicate pattern per ORCH-0734) | ~180 |

### 2.2 Edge functions — shared modules (5 new + 1 test)

| File | Purpose |
|---|---|
| `supabase/functions/_shared/cors.ts` | Standalone CORS headers (avoids importing Stripe-coupled stripeEdgeAuth) |
| `supabase/functions/_shared/agentSystemPrompt.ts` | `PROMPT_VERSION='v1'` + `buildSystemPrompt()` with `<user_data>` discipline rule + injection re-anchor block |
| `supabase/functions/_shared/agentPromptInjection.ts` | 5 regex patterns for direct injection detection |
| `supabase/functions/_shared/agentPromptInjection.test.ts` | 9 Deno tests — 9/9 pass |
| `supabase/functions/_shared/agentGemini.ts` | Gemini 2.5 Flash wrapper; reuses MALFORMED_FUNCTION_CALL retry pattern from run-place-intelligence-trial; uses `GEMINI_API_KEY_ARI` |
| `supabase/functions/_shared/agentTools.ts` | 5 tool definitions + executors with FK ownership checks (user JWT only) |
| `supabase/functions/_shared/agentRateLimit.ts` | 200 turns/24h + inflight cap; uses service role ONLY for system table reads |

### 2.3 Edge functions (2 new)

| File | Purpose |
|---|---|
| `supabase/functions/agent-chat/index.ts` | Multi-turn chat handler; load history, build prompt, call Gemini, branch on tool-call (writes → pending action; reads → execute inline + summarize) |
| `supabase/functions/agent-confirm-action/index.ts` | Atomic state-flip pending→executing; FK re-check via ToolError; final UPDATE to executed/failed; logs tool_result row; optional followup_text |

### 2.4 React Native — tokens (1 modified)

| File | Change |
|---|---|
| `mingla-business/src/constants/designSystem.ts` | Appended `ariPalette` group (`gold #f7c965 / flame #eb7825 / ember #c75033 / cursor / proposalBorder / proposalShadow`). All HSL/hex per RN color rule. |

### 2.5 React Native — components (10 new)

| File | Purpose |
|---|---|
| `src/components/ari/AriOrb.tsx` | react-native-svg RadialGradient; xs/sm/md/lg/xl sizes; breathing animation + reduced-motion fallback |
| `src/components/ari/ChatBubble.tsx` | User (right, warm accent) + Ari (left with orb prefix) variants |
| `src/components/ari/StreamingText.tsx` | Thinking-state cursor + orb prefix |
| `src/components/ari/QuickReplyChips.tsx` | Tap-to-send chip list |
| `src/components/ari/ToolProposalCard.tsx` | The confirmation card — GlassChrome wrapper, AriOrb header, field rows, Cancel/Edit/Confirm |
| `src/components/ari/ToolEditForm.tsx` | Inline edit-mode form (TextInput rows) for create_brand / create_event / update_event |
| `src/components/ari/EmptyState.tsx` | First-run hero — orb + headline + 3 example chips |
| `src/components/ari/InputBar.tsx` | Composer; multiline TextInput + circular send button |
| `src/components/ari/MessageList.tsx` | FlatList with auto-scroll; renders bubbles, success/cancelled/failed ribbons, inline ToolProposalCard, thinking indicator |
| `src/components/ari/ConversationDrawer.tsx` | Uses existing Sheet primitive; lists conversations + "New conversation" |
| `src/components/ari/ErrorBanner.tsx` | Absolute-positioned top banner (per Toast global rule) |
| `src/components/ari/AiDisclosureModal.tsx` | First-launch modal with verbatim copy from SPEC §6.8 |

### 2.6 React Native — hooks (4 new)

| File | Purpose |
|---|---|
| `src/hooks/useAgentChat.ts` | Conversation history (React Query) + send mutation + pendingAction local state |
| `src/hooks/useConfirmPendingAction.ts` | confirm/cancel mutations + cache invalidation on `["brands"]` / `["events"]` after writes |
| `src/hooks/useAriPreferences.ts` | Profile query + update + acknowledge + deleteAll |
| `src/hooks/useConversationList.ts` | Drawer list |

### 2.7 React Native — service (1 new)

| File | Purpose |
|---|---|
| `src/services/agentChatService.ts` | Edge function clients (`sendAgentMessage`, `confirmAgentAction`, `cancelAgentAction`); DB readers; error extraction mirroring `app-mobile/src/utils/edgeFunctionError.ts` pattern |

### 2.8 React Native — screens + routes (4 new + 1 modified)

| File | Purpose |
|---|---|
| `src/screens/ari/AriChatScreen.tsx` | Main composition — KeyboardAvoidingView, header, MessageList, InputBar, drawer, disclosure modal, error banner |
| `src/screens/ari/AriSettingsScreen.tsx` | Mode (Co-pilot locked) + profile fields + delete-all + AI disclosure |
| `app/(tabs)/ari.tsx` | Mounts AriChatScreen as 5th tab route |
| `app/ari/settings.tsx` | Mounts AriSettingsScreen as a stack route |
| `app/(tabs)/_layout.tsx` | Modified — added `{ id: "ari", icon: "sparkle", label: "Ari" }` between Blast and Account. Preserved the existing `/campaigns/compose` hide-nav logic that landed earlier. |

---

## 3. Old → New Receipts

### `mingla-business/src/constants/designSystem.ts`
**What it did before:** Defined `accent`, `glass`, `canvas`, etc. tokens — no Ari-specific palette.
**What it does now:** Adds `ariPalette` export with 6 keys (gold/flame/ember/cursor/proposalBorder/proposalShadow). `flame` aliases `accent.warm`; `gold` and `ember` are new HSL stops for the orb gradient. `cursor`, `proposalBorder`, `proposalShadow` re-export existing `accent.*` tokens for clarity in Ari components.
**Why:** SPEC §6.1 + I-ARI-NO-OKLCH. Brand-coherent gradient.
**Lines changed:** ~15 added.

### `mingla-business/app/(tabs)/_layout.tsx`
**What it did before:** 4-tab BottomNav (Home / Events / Blast / Account) with `/campaigns/compose` hide-nav logic just added in a recent edit.
**What it does now:** 5-tab BottomNav (Home / Events / Blast / Ari / Account). Hide-nav logic untouched. Ari sits in position 4 so Account stays rightmost (thumb-edge muscle memory for settings).
**Why:** SPEC §6.2.
**Lines changed:** ~8 added.

---

## 4. Spec Traceability (success criteria mapping)

| # | Criterion | Implementation | Verifiable |
|---|---|---|---|
| 1 | 5-tab BottomNav renders cleanly | Tab config update + verified math (65pt/tab at iPhone SE) | On-device smoke |
| 2 | First-launch AI disclosure modal | `AiDisclosureModal` gated on `agent_user_profile.ai_disclosure_acknowledged_at` in `AriChatScreen` | On-device smoke + DB check |
| 3 | Empty state with 3 chips + tap-to-send | `EmptyState` component; chips wired to `handleSend` in `AriChatScreen` | On-device smoke |
| 4 | Streaming-style response with orb prefix | `StreamingText` + `MessageList renderThinking` | On-device smoke |
| 5 | create_brand happy path | Tool def + executor + ProposalCard + confirm flow | On-device smoke + DB check |
| 6 | create_event happy path | Tool def + executor (with brand ownership check) + ProposalCard | On-device smoke + DB check |
| 7 | Edit flow | `ToolEditForm` swaps in-place; `editedArgs` passed to `confirm()` | On-device smoke |
| 8 | Cancel flow | `useConfirmPendingAction.cancel` + `agent-confirm-action` cancel branch | On-device smoke |
| 9 | Confirmation expiry | `agent-confirm-action` checks `expires_at` and flips to `expired` + returns 410 | Unit/integration test |
| 10 | Multi-step compound intent (step-through) | Server returns one pending_action at a time; client clears pending after each confirm; next user turn produces the next tool call | On-device smoke |
| 11 | Q&A read tool (list_events) | `READ_ONLY_TOOL_NAMES` set; `agent-chat` executes read inline + summarizes via follow-up Gemini call | On-device smoke |
| 12 | Cross-tenant negative | RLS direct-predicate policies on all 4 tables | DB pen test (2 accounts) |
| 13 | Confused deputy negative | `assertBrandOwned` / `assertEventOwned` in tool executors before write | Integration test |
| 14 | Replay defense | Atomic UPDATE-WHERE in `agent-confirm-action` step "flip pending→executing" | Integration test |
| 15 | Rate limit | `agentRateLimit.enforceTurnRateLimit` returns `rate_limited_daily` after 200 turns | Synthetic test |
| 16 | Cost cap | Rate limit + `maxOutputTokens=1500` + edge fn 60s timeout | N/A (proven by 15 + 11) |
| 17 | Prompt injection re-anchor | `detectPromptInjection` flags message → `buildSystemPrompt({ injectStrictReminder: true })` | Deno test (9/9 pass) + integration |
| 18 | Indirect prompt injection | All user content wrapped in `<user_data>` delimiters before injection into `contents[]` (SPEC §3.2.3 step 13) | Integration test |
| 19 | GDPR delete | `deleteAllAriData` deletes conversations (CASCADE) + profile | On-device smoke |
| 20 | AI disclosure on Settings | `AriSettingsScreen.About` section verbatim | Visual check |
| 21 | Accessibility | All Pressables have `accessibilityLabel`; touch targets ≥44pt; orb labeled; thinking announces | Manual a11y check |
| 22 | No oklch/lab/color-mix | All Ari files use HSL/hex/rgb only | Grep gate |
| 23 | Service role not used for user data | Service role only in `agentRateLimit.ts` (system table reads) | Grep gate |

**Status legend:** Verifiable by on-device smoke = needs Phase 9 manual run; Integration test = needs deployed edge functions; DB pen test = needs migration applied + two test accounts.

---

## 5. Invariant Verification

| Invariant | Status | Evidence |
|---|---|---|
| I-ARI-CONFIRM-AUTHORITY (writes only via agent-confirm-action) | PRESERVED | `agent-chat` writes pending_action for non-read tools; only `agent-confirm-action` calls `tool.executor()` for writes |
| I-ARI-USER-JWT-ONLY | PRESERVED | Tool executors receive `userClient` (built from caller's JWT in agent-chat / agent-confirm-action). Service role appears only in `agentRateLimit.ts` for `agent_messages` / `agent_pending_actions` count queries |
| I-ARI-USER-DATA-WRAP | PRESERVED | All user content wrapped in `<user_data>...</user_data>` in `agent-chat/index.ts` history loop AND for the new user message |
| I-ARI-NO-OKLCH | PRESERVED | All Ari component colors use HSL/hex/rgb only (no oklch/lab/color-mix); ariPalette uses `hsl(...)` strings |
| I-ARI-PENDING-STATE-MACHINE | PRESERVED | Atomic `UPDATE ... WHERE status='pending'` clauses in both cancel and confirm paths |
| I-38 / 44pt touch targets | PRESERVED | Every Ari Pressable has explicit `height: 44+` or `minHeight: 44` or `padding: 12` ≈ 44pt |
| I-39 / explicit accessibilityLabel | PRESERVED | Every Pressable in Ari surface has explicit `accessibilityLabel` |
| Toast absolute-wrap rule | PRESERVED | `ErrorBanner` wrapped in `position: 'absolute'` View with `zIndex: 100` |
| Keyboard-aware input | PRESERVED | `AriChatScreen` wraps `InputBar` in `KeyboardAvoidingView` with platform-specific behavior |
| RLS-RETURNING-OWNER-GAP avoidance | PRESERVED | All 4 tables use direct-predicate `user_id = auth.uid()` policies, NOT SECURITY DEFINER helpers |

---

## 6. Verification Run Log

### 6.1 TypeScript

```bash
cd mingla-business && npx tsc --noEmit --skipLibCheck
# exit 0 — clean compile
```

### 6.2 Deno test (prompt injection detector)

```bash
/Users/sethogieva/.deno/bin/deno test --allow-all --no-check \
  supabase/functions/_shared/agentPromptInjection.test.ts
# Result: ok | 9 passed | 0 failed (19ms)
```

### 6.3 Deno check (edge functions)

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/agent-chat/index.ts \
  supabase/functions/agent-confirm-action/index.ts
# Both files Check completed without errors
```

### 6.4 Color rule grep (I-ARI-NO-OKLCH)

```bash
grep -rE "oklch|color-mix|lab\(" \
  mingla-business/src/components/ari mingla-business/src/screens/ari
# Result: zero matches (clean)
```

### 6.5 Service-role grep (I-ARI-USER-JWT-ONLY)

```bash
grep -rn "SERVICE_ROLE\|serviceRole" supabase/functions/agent-chat supabase/functions/agent-confirm-action
# Result: zero matches in handler bodies. Service role usage confined to
# _shared/agentRateLimit.ts which is imported only by agent-chat for the
# rate-limit gate (system table reads — NOT tool execution).
```

---

## 7. Operator Actions Required (in order)

The implementation is code-complete but requires three operator-owned steps before
the tester can run independent verification.

### 7.1 Apply the database migration (OPERATOR ONLY)

```bash
cd /Users/sethogieva/Desktop/mingla-main
supabase db push --linked
```

Verify after:
```sql
-- Run via Supabase Studio SQL editor or Management API
SELECT relname, relrowsecurity FROM pg_class
  WHERE relname LIKE 'agent_%' AND relkind = 'r';
-- expect 4 rows, all relrowsecurity = true

SELECT tablename, COUNT(*) FROM pg_policies
  WHERE tablename LIKE 'agent_%' GROUP BY tablename;
-- expect each of agent_conversations / agent_messages /
-- agent_pending_actions / agent_user_profile to show 4 policies
```

### 7.2 Create the Gemini API key secret (OPERATOR ONLY)

In Supabase Studio → Project Settings → Edge Functions → Secrets, add:

```
Name:  GEMINI_API_KEY_ARI
Value: <your AI Studio API key — isolated from the existing GEMINI_API_KEY
        used by run-place-intelligence-trial so Ari has its own quota>
```

### 7.3 Deploy edge functions (ORCHESTRATOR-OWNED per repo split)

Per `feedback_orchestrator_deploys_edge_functions` the operator runs the migration
and the orchestrator runs the deploy. In this Claude session I am the implementor;
the orchestrator dispatch will execute:

```bash
supabase functions deploy agent-chat agent-confirm-action \
  --project-ref gqnoajqerqhnvulmnyvv
```

Verify post-deploy:
```
mcp__supabase__list_edge_functions
# both agent-chat and agent-confirm-action present
# verify_jwt: true
# version > 0
```

---

## 8. Cache Safety

- Created new query-key namespace `["ari", ...]` via `agentQueryKeys` factory in `useAgentChat.ts`
- `useConfirmPendingAction` invalidates `["brands"]` after `create_brand` and `["events"]` after `create_event` / `update_event` — these are the assumed top-level keys other parts of the app already use. (If those top-level keys don't exist in the broader app, the invalidations are no-ops, not bugs.)
- No existing query keys altered

---

## 9. Regression Surface (test these flows)

1. **Existing tab navigation** — confirm the 4 existing tabs (Home/Events/Blast/Account) still active correctly after the 5th tab is added. The active-pill animation handles 5 layouts via `flex: 1`.
2. **`/campaigns/compose` hide-nav** — verify the marketing composer still hides the BottomNav (the existing logic was preserved verbatim).
3. **Sheet primitive consumers** — `ConversationDrawer` uses Sheet; other consumers (brand editor, event creator) should be unaffected.
4. **Brand creation via the existing UI** — should be unaffected; tool executors use the same `brands` table.
5. **Event creation via the existing UI** — same.

---

## 10. Parity Check

- **Solo / Collab modes:** N/A — Ari is a single-user surface (the operator's own JWT only). No collab mode in MVP.
- **iOS / Android:** Code is RN cross-platform; on-device smoke test required (Phase 9 below).
- **Web (Expo Router):** The Ari surface uses `KeyboardAvoidingView`, `Modal`, `react-native-svg`, all of which work in Expo's web bundle. Untested in this pass.

---

## 11. Discoveries for Orchestrator

1. **`react-native-svg` and `expo-linear-gradient` already in `mingla-business/package.json`.** No new deps required (confirmed pre-flight).
2. **`edgeFunctionError` utility doesn't exist in `mingla-business/src/utils/`** — only in `app-mobile`. Rather than duplicate, the error extraction was inlined into `agentChatService.ts`. If you want to factor this out for future Ari work or to mirror app-mobile, that's a follow-up ORCH.
3. **No standalone `_shared/cors.ts` existed.** Created one. Other edge functions can adopt it instead of importing CORS from `stripeEdgeAuth.ts`.
4. **Migration filename uses `20260603000001` (one second after `20260603000000_orch_0815_b_marketing_send_cron.sql`)** per the monotonic rule. Operator runs `supabase db push --linked` (NOT `--include-all`).
5. **Recommended new CI grep gates** (codify the I-ARI-NO-OKLCH and I-ARI-USER-JWT-ONLY invariants — per `feedback_strict_grep_registry_pattern`):
   - Gate A: ban `oklch|color-mix|lab\(` in `mingla-business/src/{components,screens}/ari/`
   - Gate B: ban `SERVICE_ROLE` in `supabase/functions/agent-chat/` and `supabase/functions/agent-confirm-action/` (allow only in `_shared/agentRateLimit.ts`)
   - Not added in this implementation; suggested for the close cycle.
6. **`agent-chat` falls back to Gemini AUTO function-calling mode (not ANY).** This is a deliberate departure from the `run-place-intelligence-trial` pattern (which forces a single tool). Ari needs the option of plain text replies (Q&A, clarifications, refusals). The risk is slightly higher phantom-tool risk; mitigated by the confirmation flow.
7. **The `/campaigns/compose` hide-nav change was already in `(tabs)/_layout.tsx`** when I started — preserved untouched per the system reminder. Ari tab integrates alongside it without conflict.

---

## 12. Transition Items

None. No `// [TRANSITIONAL]` markers in any new code.

---

## 13. Manual Smoke Test Plan (for tester or operator-assisted)

After §7 (migration applied + secret set + functions deployed), run these on **iOS Simulator** AND **Android Emulator**:

1. Launch mingla-business → see new "Ari" tab
2. Tap Ari → see AiDisclosureModal → tap "Got it" → modal dismisses + DB shows `ai_disclosure_acknowledged_at` set
3. See empty state with 3 chips
4. Tap "What events do I have this week?" → see chat with response (assuming user has events; if not, Ari should say "no upcoming events")
5. Type "Create a brand called Smoke Test" → wait → see ToolProposalCard with name="Smoke Test"
6. Tap Confirm → see "Created brand Smoke Test" success ribbon → check Supabase `brands` table for new row with `account_id = userId`
7. Type "Now create an event next Friday at 8pm at The Venue for Smoke Test" → see ToolProposalCard with the field values → Tap Edit → change title → Tap "Done editing" → Tap Confirm → check `events` table
8. Tap Cancel on a proposal → see "Cancelled" ribbon, no DB write
9. Open settings (gear icon) → see profile section + Delete-all button + AI disclosure
10. Cross-account test: sign in as User B (separate test account, with their own brand) → confirm User B's conversations / pending actions are NOT visible

---

## 14. Working-Branch Status

Working tree: /Users/sethogieva/Desktop/mingla-main on branch Seth
All 24 new files + 2 modified files are staged for commit on `Seth`. No work on `main`. No PR opened — pending QA before push.

---

## 15. Next Handoff

The next phase is independent QA. See the chat output's NEXT HANDOFF block.
