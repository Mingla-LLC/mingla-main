# IMPLEMENTATION — ORCH-0898 Group Chat Header Fix

**Status:** implemented, partially verified  
**Date:** 2026-05-21  
**Working tree observed by Codex:** `/Users/sethogieva/Desktop/mingla-main` on branch `orch-0892-b-v2-close`  
**Spec inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md`, `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT_v2.md`, `Mingla_Artifacts/reports/QA_ORCH-0898_COLLAB_GROUP_CHAT_REPORT.md`

## Summary

Fixed the ORCH-0898 Friends-tab group-chat open path so collaboration-session group chats keep their session name when opened and render a group header instead of falling back to a fake direct-message participant. The chat list now also prefixes group previews with the last sender name, preserving the session-name title while making group rows easier to scan.

## Follow-Up Rework 2026-05-21

Operator reported the UI still showed literal "Group chat" and still exposed the right-side more menu in the opened group chat. The second fix invalidates the pre-ORCH-0898 conversations cache (`v2-orch-0898-group-metadata`), fetches `collaboration_sessions.name` for any group conversation with `session_id`, falls back to a per-tap session-name lookup if needed, changes the visible emergency fallback to `Collaboration chat`, and hard-disables the DM more-menu modal when `friend.conversationType === "group"`.

## Changes

| Area | Files | Change |
|---|---|---|
| Chat list | `app-mobile/src/components/connections/ChatListItem.tsx` | Keeps `conversation.name` as the group row title and prefixes group previews with `sender_name`. |
| Open path | `app-mobile/src/components/ConnectionsPage.tsx` | Detects `conversation.type === 'group'`, passes `conversationType`, `sessionId`, `participantCount`, and participant profile metadata into `MessageInterface`, resolves missing names from `collaboration_sessions.name`, invalidates stale cached rows, and skips DM-only block/friendship/profile probes for group chats. |
| Header UI | `app-mobile/src/components/MessageInterface.tsx` | Renders group chat header as session name + stacked participant avatars + `N people in chat`; hides and hard-disables the one-on-one friend action menu for group chats. |
| Types | `app-mobile/src/hooks/useMessages.ts`, `app-mobile/src/services/connectionsService.ts`, `app-mobile/src/services/messagingService.ts` | Widens local chat types to carry ORCH-0898 group metadata through the existing RN surface. |
| Regression | `app-mobile/scripts/ci/orch-0898-regression-check.mjs` | Adds T-15/T-16/T-17 to lock the group open-path metadata, group header, and sender-prefixed group preview contracts. |

## Verification

| Gate | Result |
|---|---|
| `node app-mobile/scripts/ci/orch-0898-regression-check.mjs` | PASS - 20/20 |
| `npm --prefix app-mobile run test:orch-0898` | PASS - 20/20 |
| `npm --prefix app-mobile run test:orch-0898-adv` | PASS - 15/15 |
| `git diff --check` on touched files | PASS |
| `npx tsc --noEmit` from `app-mobile/` | FAIL - existing ORCH-0898/monorepo errors remain, including `BoardDiscussion.tsx` DirectMessage shape drift, pre-existing `ConnectionsPage.tsx` Friend type collision, `HomePage.tsx` SessionSwitcherItem drift, and package path React type resolution errors. No new error class was isolated to this header/list fix. |

## Residual Risk

Runtime visual verification is still required in iOS and Android simulators: create/open a collaboration-session group chat from the Friends tab and confirm the row title is the session name, the opened chat header is the same session name, stacked avatars render, and the member count matches the roster.
