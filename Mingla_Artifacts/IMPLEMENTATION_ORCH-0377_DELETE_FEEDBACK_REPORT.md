# Implementation Report: ORCH-0377 — Delete Own Feedback

**Status:** Implemented, partially verified (needs device testing)
**Date:** 2026-04-11
**Spec:** SPEC_ORCH-0377_DELETE_FEEDBACK.md

---

## Summary

Added the ability for beta testers to delete their own feedback from the history view.
Each feedback card now has a trash icon. Tapping it shows a native confirmation dialog.
On confirmation, storage files (audio + screenshots) are deleted best-effort, then the
database row is hard-deleted. The item vanishes from both mobile history and admin.

---

## Files Changed (3) + Files Created (1)

### [supabase/migrations/20260411100001_beta_feedback_delete_policies.sql] — NEW
**What it did before:** Did not exist.
**What it does now:** Two RLS DELETE policies — users can delete own `beta_feedback` rows and own files in `beta-feedback` storage bucket.
**Why:** SC-5 through SC-9 — delete must be authorized by RLS.
**Lines:** 13

### [app-mobile/src/services/betaFeedbackService.ts]
**What it did before:** No delete capability.
**What it does now:** New `deleteFeedback(feedbackId, audioPath, screenshotPaths)` — removes storage files (best-effort), then deletes DB row (required). Exported on service object.
**Why:** SC-5, SC-6, SC-7, SC-8, SC-13.
**Lines changed:** ~25

### [app-mobile/src/hooks/useBetaFeedback.ts]
**What it did before:** Submit mutation + history query only.
**What it does now:** New `useDeleteFeedback()` mutation — calls `deleteFeedback()`, invalidates `feedbackKeys.all` on success, logs errors.
**Why:** SC-5 — cache invalidation removes item from list.
**Lines changed:** ~25

### [app-mobile/src/components/FeedbackHistorySheet.tsx]
**What it did before:** History list with play + screenshot view. No delete.
**What it does now:** Trash icon on each card header (right of date). Tapping shows `Alert.alert` confirmation. During delete, spinner replaces trash icon. On success, item vanishes (cache invalidation). On error, error Alert shown. `deletingId` state prevents double-tap.
**Why:** SC-1 through SC-4, SC-10, SC-11, SC-12.
**Lines changed:** ~45

---

## Spec Traceability

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Trash icon on each card | IMPLEMENTED | FeedbackItem header row, Icon name='trash' |
| SC-2 | Confirmation dialog | IMPLEMENTED | Alert.alert with Cancel + Delete(destructive) |
| SC-3 | Cancel dismisses | IMPLEMENTED | Cancel button style='cancel' — native dismiss |
| SC-4 | Loading indicator during delete | IMPLEMENTED | ActivityIndicator replaces trash when isDeleting |
| SC-5 | Item disappears after delete | IMPLEMENTED | invalidateQueries on feedbackKeys.all |
| SC-6 | Audio file removed from storage | IMPLEMENTED | supabase.storage.remove([audioPath, ...]) |
| SC-7 | Screenshot files removed from storage | IMPLEMENTED | screenshotPaths spread into remove array |
| SC-8 | DB row removed | IMPLEMENTED | supabase.delete().eq('id', feedbackId) |
| SC-9 | Gone from admin too | IMPLEMENTED | Hard delete — row doesn't exist for admin query |
| SC-10 | Empty state after last delete | IMPLEMENTED | FlatList ListEmptyComponent already handles this |
| SC-11 | Double-tap protection | IMPLEMENTED | deletingId state + isDeleting disables button |
| SC-12 | Error shows alert | IMPLEMENTED | catch → Alert.alert('Error', message) |
| SC-13 | Audio-only deletes cleanly | IMPLEMENTED | screenshotPaths ?? [] handles null |

---

## Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| Audio is required (submit) | YES — delete path doesn't touch submit |
| Beta tester gate | YES — SELECT RLS unchanged |
| User folder isolation | YES — DELETE storage policy uses foldername[1] = uid |
| No silent failures | YES — DB errors throw, surfaced via Alert |
| INV-DELETE-OWNERSHIP (new) | YES — RLS auth.uid() = user_id |

---

## Verification Status

| Check | Result |
|-------|--------|
| TypeScript compilation | PASS — 0 new errors |
| Migration SQL syntax | PASS — standard CREATE POLICY |
| Service logic | PASS — storage best-effort, DB required |
| Hook invalidation | PASS — feedbackKeys.all |
| UI wiring | PASS — props passed, dialog wired |
| Device testing | UNVERIFIED — needs physical device |

---

## Discoveries for Orchestrator

None.
