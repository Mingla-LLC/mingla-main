// ORCH-0942 [META-ORCH-0929 dead-code reap] — 2026-05-23
//
// This test file is intentionally a no-op stub.
//
// Before ORCH-0942, this file tested `CollabSessionChatBanners` and
// `InChatDeckSheet` — both exports of `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`
// that were orphaned by META-ORCH-0929 [Collab decks live in group chat — Home is solo-only]
// and structurally deleted by ORCH-0942 [META-ORCH-0929 dead-code reap].
//
// The original assertions (`typeof CollabSessionChatBanners === "function"`,
// `typeof InChatDeckSheet === "function"`, plus banner-visibility fixtures) targeted
// code paths that no longer exist. The Pragmatic Append-Only policy
// (ORCH-0840 [Regression-test enforcement + append-only CI]) categorically forbids
// test-file deletion, so this file remains in the tree as a documented no-op
// rather than being removed. Re-introducing the deleted symbols would also re-trip
// the new forward-looking assertion in
// `app-mobile/src/components/connections/__tests__/CollabDeckSheet.ghostSessionRegression.test.tsx`
// (the inverse `assert.doesNotMatch(chatBanners, /InChatDeckSheet/, ...)`).
//
// If a future ORCH ever resurrects `CollabSessionChatBanners` or `InChatDeckSheet`,
// open a new ORCH amending ORCH-0942's DEC-164 first, then re-author this file's
// fixtures against the resurrected exports.
//
// Citation: Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md §3.4.1
// Citation: Mingla_Artifacts/DECISION_LOG.md DEC-164

export const ORCH_0942_DEAD_CODE_REAP_NO_OP = true;
