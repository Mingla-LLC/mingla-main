# CLOSE NOTE — ORCH-0821 Ari MVP

**Date:** 2026-05-13
**Verdict:** CLOSED CONDITIONAL-PASS Grade A
**Closer:** Claude `mingla-orchestrator`
**Working tree:** /Users/sethogieva/Desktop/mingla-main on branch `Seth`

## Verdict counts

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 1 |
| P3 — LOW | 1 |
| P4 — NOTE | 5 |

## Conditions accepted as follow-up (ORCH-0822)

1. **C-1** — Live two-account cross-tenant probe on every `agent_*` table. RLS policies + executor ownership checks are mechanically correct via static verification; live confirmation pending.
2. **C-2** — Android Emulator parity check. Operator's MVP smoke was iOS only; Android visual + interaction parity pending.
3. **C-3** — Synthetic 201-turn rate-limit trip-test. `TURN_LIMIT_24H = 200` is code-verified; live trip-test pending.

None block single-operator beta. All three are operator-actionable in under 30 minutes.

## Evidence chain

| Artifact | Path |
|---|---|
| Design | `Mingla_Artifacts/ARI_DESIGN.md` (1467 lines) |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0821_ARI_MVP.md` |
| Implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0821_ARI_MVP.md` |
| QA | `Mingla_Artifacts/reports/QA_ORCH-0821_ARI_MVP_REPORT.md` |
| MVP commit | `674d5822 ORCH-0821 Ari MVP — Gemini-powered chat assistant` |
| Hardening commit | `b9121e2e ORCH-0821 hardening — friendly toast copy + 2 strict-grep gates` |

## Static / live gates run during CLOSE

| Gate | Result |
|---|---|
| `tsc --noEmit --skipLibCheck` (mingla-business) | exit 0 |
| `deno check supabase/functions/agent-chat/index.ts` | clean |
| `deno check supabase/functions/agent-confirm-action/index.ts` | clean |
| `deno test agentPromptInjection.test.ts` | 9/9 pass |
| `i-ari-no-oklch.mjs` | 13 files scanned clean |
| `i-ari-user-jwt-only.mjs` | 2 files scanned clean |
| Secret scan (mingla-business + supabase/functions) | zero hardcoded keys |
| `mcp__supabase__list_edge_functions` | agent-chat v13 + agent-confirm-action v6, both verify_jwt:true |
| pg_class / pg_policies introspection | 4 tables + 16 policies + 6-state-machine CHECK constraint |
| pg_constraint introspection | All `agent_*` FKs `ON DELETE CASCADE` from `auth.users` |
| DIAG marker reap (`[ORCH-0821-DIAG]`) | zero matches |

## Five new invariants codified

| ID | Statement | Verification |
|---|---|---|
| I-ARI-CONFIRM-AUTHORITY | Writes only via `agent-confirm-action`; `agent-chat` invokes executors only for `READ_ONLY_TOOL_NAMES` | Source review + grep |
| I-ARI-USER-JWT-ONLY | Tool executors use caller's JWT; service role whitelisted to `_shared/agentRateLimit.ts` | CI grep gate `i-ari-user-jwt-only.mjs` |
| I-ARI-USER-DATA-WRAP | User-stored content wrapped in `<user_data>` delimiters before Gemini sees it | Source review at agent-chat/index.ts:249,280 |
| I-ARI-NO-OKLCH | Ari mobile surface uses HSL/hex/rgb only | CI grep gate `i-ari-no-oklch.mjs` |
| I-ARI-PENDING-STATE-MACHINE | `agent_pending_actions.status` transitions enforced by atomic UPDATE-WHERE + DB CHECK constraint | Schema verification + source review |

## Findings carried forward

- **F-1 (P2):** Marketing composer error UX migrated from inline-form to top-of-screen Toast as part of canonical Toast unification. Accept as canonical pattern OR revert to inline mid-form positioning is an operator decision (no ORCH spawned; flag in next session if revert is preferred).
- **F-2 (P3):** Migration timestamp `20260603000001` is monotonicity-correct for `Seth` branch ordering but doesn't reflect wall-clock authoring date (2026-05-13). Cosmetic only.

## Files shipped

**Backend (10 new + 1 modified):**
- 1 migration: `supabase/migrations/20260603000001_orch_0821_ari_agent_tables.sql`
- 7 shared modules: `_shared/agentSystemPrompt.ts`, `agentTools.ts`, `agentGemini.ts`, `agentPromptInjection.ts` + `.test.ts`, `agentRateLimit.ts`, `cors.ts`
- 2 edge functions: `agent-chat/index.ts`, `agent-confirm-action/index.ts`

**Mobile (24 new + 4 modified):**
- 13 components under `src/components/ari/` and `src/screens/ari/`
- 4 hooks: `useAgentChat`, `useConfirmPendingAction`, `useAriPreferences`, `useConversationList`
- 1 service: `agentChatService.ts`
- New `app/(tabs)/ari.tsx` + `app/ari/settings.tsx` routes
- Modified: `(tabs)/_layout.tsx` (5-tab), `Toast.tsx` (swipe-up + GestureHandlerRootView), `designSystem.ts` (ariPalette), `(tabs)/marketing/campaigns/compose.tsx` (canonical Toast)

**Artifacts (5 new):**
- `ARI_DESIGN.md`, `specs/SPEC_ORCH-0821_ARI_MVP.md`, `reports/IMPLEMENTATION_ORCH-0821_ARI_MVP.md`, `reports/QA_ORCH-0821_ARI_MVP_REPORT.md`, this close note

**CI (2 new + 1 modified):**
- `.github/scripts/strict-grep/i-ari-no-oklch.mjs`, `.github/scripts/strict-grep/i-ari-user-jwt-only.mjs`
- `.github/workflows/strict-grep-mingla-business.yml` (2 new jobs registered)

## EAS OTA recommendation

The shipped surface is pure-RN client + edge functions; no native module additions beyond `react-native-svg` and `react-native-gesture-handler` which were already present in `mingla-business`. OTA is the right channel.

```bash
cd /Users/sethogieva/Desktop/mingla-main/mingla-business
eas update --branch production --platform ios --message "ORCH-0821: Ari MVP — Gemini-powered chat assistant"
eas update --branch production --platform android --message "ORCH-0821: Ari MVP — Gemini-powered chat assistant"
```

(Two separate invocations per `feedback_eas_update_no_web` — `--platform ios,android` comma syntax is invalid; `--platform all` fails on web due to `react-native-maps`.)

## Next dispatch

ORCH-0822 (the three follow-up conditions above) is the natural next item. It's not a launch blocker — recommended timing is "before broader rollout beyond operator," which is whenever the operator decides to invite the first non-operator user.

For everything else, the Priority Board is unchanged by this close.
