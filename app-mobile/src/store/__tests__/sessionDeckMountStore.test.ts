// ORCH-0942 [META-ORCH-0929 dead-code reap] — 2026-05-23
//
// This test file is intentionally a no-op stub.
//
// Before ORCH-0942, this file tested `useSessionDeckMountStore` — a Zustand
// mutex at `app-mobile/src/store/sessionDeckMountStore.ts` that was orphaned by
// META-ORCH-0929 [Collab decks live in group chat — Home is solo-only] and
// structurally deleted by ORCH-0942 [META-ORCH-0929 dead-code reap]. The store's
// only consumers were inside the dead `CollabSessionChatBanners` + `InChatDeckSheet`
// functions (lines 525 + 630 of the prior `CollabSessionChatBanners.tsx`), both
// of which were never rendered as JSX after META-ORCH-0929 close.
//
// The original assertions tested the mutex's acquire/release semantics across
// 'dedicated-screen' vs 'in-chat-sheet' owner strings — a single-mount discipline
// that META-ORCH-0929's `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` invariant
// now enforces structurally at a higher layer (single `<CollabDeckSheet>` mount
// from `MessageInterface.tsx`). The Pragmatic Append-Only policy
// (ORCH-0840 [Regression-test enforcement + append-only CI]) categorically forbids
// test-file deletion, so this file remains as a documented no-op rather than
// being removed.
//
// Citation: Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md §3.2.2
// Citation: Mingla_Artifacts/DECISION_LOG.md DEC-164

export const ORCH_0942_SESSION_DECK_MOUNT_STORE_DELETED = true;
