# SPEC: ORCH-0377 — Allow Users to Delete Their Own Submitted Feedback

**Status:** Ready for implementation
**Author:** Forensics (Spec mode)
**Date:** 2026-04-11
**Severity:** S2-medium (missing feature)
**Surface:** Profile & Settings > Feedback History

---

## Summary

Add the ability for beta testers to delete their own feedback submissions from the
history view. A trash icon on each feedback card opens a confirmation dialog. On
confirmation, the audio file, any screenshot files, and the database row are all
permanently removed (hard delete). The item vanishes from both the mobile history
and admin dashboard. No soft-delete, no archive, no undo.

---

## Scope

**In scope:**
- RLS DELETE policy for `beta_feedback` (users delete own rows)
- Storage DELETE policy for `beta-feedback` bucket (users delete own files)
- Service method to delete storage files + database row
- React Query mutation with cache invalidation
- Trash icon on each history item with confirmation dialog
- Loading, error, and empty states

**Out of scope:**
- Admin delete capability
- Soft-delete / archive / undo
- Batch delete (one at a time only)
- Any changes to the submit flow, admin page, or edge function

---

## Files to Modify

| # | File | What Changes |
|---|------|-------------|
| 1 | `supabase/migrations/20260411100001_beta_feedback_delete_policies.sql` | **NEW** — DELETE RLS policies for table + storage |
| 2 | `app-mobile/src/services/betaFeedbackService.ts` | Add `deleteFeedback()` method |
| 3 | `app-mobile/src/hooks/useBetaFeedback.ts` | Add `useDeleteFeedback()` mutation |
| 4 | `app-mobile/src/components/FeedbackHistorySheet.tsx` | Add trash icon, confirmation dialog, deleting state |

**Files NOT to modify:**
- `BetaFeedbackModal.tsx` — submit flow unchanged
- `BetaFeedbackButton.tsx` — entry point unchanged
- `submit-feedback/index.ts` — edge function unchanged
- `BetaFeedbackPage.jsx` — admin page unchanged (deleted rows vanish from queries)

---

## 1. Database Migration

**File:** `supabase/migrations/20260411100001_beta_feedback_delete_policies.sql`

```sql
-- ORCH-0377: Allow users to delete their own feedback submissions

-- Users can delete their own feedback rows
CREATE POLICY "Users can delete own feedback"
  ON beta_feedback FOR DELETE
  USING (auth.uid() = user_id);

-- Users can delete their own files from the beta-feedback storage bucket
CREATE POLICY "Users can delete own feedback files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'beta-feedback'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

**Why no admin DELETE policy:** Admins manage feedback via status changes (reviewed,
actioned, dismissed), not deletion. If admin delete is ever needed, it's a separate
ORCH item.

---

## 2. Service Layer

**File:** `app-mobile/src/services/betaFeedbackService.ts`

### New Function: `deleteFeedback`

**Signature:**
```typescript
async function deleteFeedback(
  feedbackId: string,
  audioPath: string,
  screenshotPaths: string[] | null,
): Promise<void>
```

**Behavior:**

1. **Delete storage files (best-effort):**
   - Build a list of all file paths: `[audioPath, ...(screenshotPaths ?? [])]`
   - Call `supabase.storage.from('beta-feedback').remove(allPaths)`
   - Supabase's `.remove()` accepts an array and silently skips files that don't exist
   - If `.remove()` returns an error, log it with `console.warn` but **do not throw** —
     storage cleanup is best-effort. The DB row is the authoritative record; orphaned
     files are harmless and can be cleaned up later.

2. **Delete database row (required):**
   - Call `supabase.from('beta_feedback').delete().eq('id', feedbackId)`
   - If this returns an error, **throw** with message:
     `Failed to delete feedback: ${error.message}`
   - RLS ensures users can only delete their own rows. Attempting to delete another
     user's row silently returns 0 affected rows (not an error). This is acceptable —
     the item simply won't disappear from the list, and the user can try again.

**Why storage-first, then DB:**
If the DB delete succeeds but storage fails, the files become orphaned (harmless).
If we did DB-first and it succeeded, then storage failed, we'd have no record of
which files to clean up. Storage-first is the safer order.

### Export Update

Add to `betaFeedbackService` object:
```typescript
deleteFeedback,
```

---

## 3. Hook Layer

**File:** `app-mobile/src/hooks/useBetaFeedback.ts`

### New Hook: `useDeleteFeedback`

```typescript
export function useDeleteFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['beta-feedback', 'delete'],
    mutationFn: (params: {
      feedbackId: string;
      audioPath: string;
      screenshotPaths: string[] | null;
    }) => betaFeedbackService.deleteFeedback(
      params.feedbackId,
      params.audioPath,
      params.screenshotPaths,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.all });
    },
    onError: (error) => {
      console.error('[useBetaFeedback] Delete failed:', error.message);
    },
  });
}
```

**Cache invalidation:** Invalidates `feedbackKeys.all` which causes `useFeedbackHistory`
to refetch. The deleted item disappears from the list automatically.

**No optimistic update:** The delete involves storage cleanup that takes time. Showing
the item as gone before it's confirmed could confuse the user if it fails. Instead,
show a loading state on the item during deletion.

---

## 4. UI Changes

**File:** `app-mobile/src/components/FeedbackHistorySheet.tsx`

### FeedbackItem Props Update

Add two new props:
```typescript
onDelete: (item: BetaFeedback) => void;
isDeleting: boolean;
```

### Trash Icon Placement

In the `itemHeader` row, the category badge is on the left and the date is on the right.
Add a trash icon **to the right of the date**, separated by a small gap:

```
[ Bug badge ]                    [ Apr 11, 2026 ]  [ trash icon ]
```

The trash icon:
- Icon name: `'trash'` (maps to Trash2 from lucide)
- Size: 16
- Color: `colors.gray[400]` (subtle, not alarming — the confirmation dialog handles the "are you sure")
- Disabled + reduced opacity when `isDeleting` is true
- `hitSlop={8}` for easy tap target
- `accessibilityLabel="Delete this feedback"`

When `isDeleting` is true, replace the trash icon with a small `ActivityIndicator`
(same size/position) so the user knows the delete is in progress.

### Confirmation Dialog

Use React Native's built-in `Alert.alert()` — this is the established pattern in the
codebase (see AppHandlers.tsx). No custom modal needed.

When trash icon is tapped, call:
```typescript
Alert.alert(
  'Delete Feedback',
  'Delete this feedback? This can\'t be undone.',
  [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
  ],
);
```

### FeedbackHistorySheet Changes

Add the delete mutation and wire it to `FeedbackItem`:

1. Import `useDeleteFeedback` from the hooks file
2. Import `Alert` from `react-native`
3. Add state: `const [deletingId, setDeletingId] = useState<string | null>(null)`
4. Initialize: `const deleteMutation = useDeleteFeedback()`
5. Create handler:
   ```typescript
   const handleDelete = async (item: BetaFeedback) => {
     setDeletingId(item.id);
     try {
       await deleteMutation.mutateAsync({
         feedbackId: item.id,
         audioPath: item.audio_path,
         screenshotPaths: item.screenshot_paths,
       });
     } catch {
       // Error already logged in hook. Show toast.
       Alert.alert('Error', 'Couldn\'t delete feedback. Try again.');
     } finally {
       setDeletingId(null);
     }
   };
   ```
6. Pass to FeedbackItem:
   ```typescript
   <FeedbackItem
     item={item}
     onViewScreenshot={(url) => setFullScreenImageUrl(url)}
     onDelete={handleDelete}
     isDeleting={deletingId === item.id}
   />
   ```

### Empty State After Last Delete

Already handled — the FlatList's `ListEmptyComponent={renderEmpty}` shows
"No feedback submitted yet" when the list is empty. Cache invalidation after
delete causes the FlatList to re-render with the updated (now empty) data.

### Sound Cleanup on Delete

If the user is currently playing audio from an item they delete, the sound object
will become orphaned. The existing cleanup in `FeedbackItem`'s `useEffect` return
handles this — when the component unmounts (removed from list after cache invalidation),
the sound is unloaded.

---

## 5. Implementation Order

| Step | Action | Depends On |
|------|--------|-----------|
| 1 | Apply database migration | Nothing |
| 2 | Add `deleteFeedback()` to service | Step 1 (needs RLS live) |
| 3 | Add `useDeleteFeedback()` hook | Step 2 |
| 4 | Update `FeedbackHistorySheet.tsx` | Steps 2, 3 |

---

## 6. Success Criteria

| # | Criterion | How to Verify |
|---|-----------|--------------|
| SC-1 | Trash icon visible on each feedback history card | Open history, see icon on every item |
| SC-2 | Tapping trash shows confirmation dialog with "Delete" and "Cancel" | Tap trash, verify dialog text and buttons |
| SC-3 | Tapping "Cancel" dismisses dialog, item unchanged | Tap Cancel, item still in list |
| SC-4 | Tapping "Delete" shows loading indicator on that item | Tap Delete, verify spinner replaces trash icon |
| SC-5 | After successful delete, item disappears from list | Delete an item, verify it's gone |
| SC-6 | Deleted item's audio file is removed from storage | Check Supabase Storage — file should not exist |
| SC-7 | Deleted item's screenshot files are removed from storage | Check storage for screenshot paths — should not exist |
| SC-8 | Deleted item's database row is removed | Query `beta_feedback` for the deleted ID — should return 0 rows |
| SC-9 | Deleted item disappears from admin dashboard too | Load admin Beta Feedback page — deleted item not in list or detail |
| SC-10 | Deleting last item shows empty state | Delete all items, see "No feedback submitted yet" |
| SC-11 | Rapid double-tap doesn't cause double-delete | Tap trash twice quickly — only one delete attempt, no crash |
| SC-12 | Delete failure shows error alert | Kill network then delete — see error dialog |
| SC-13 | Old feedback without screenshots deletes cleanly | Delete an audio-only entry — no crash on null screenshotPaths |

---

## 7. Regression Risks

| Risk | What Could Break | How to Verify |
|------|-----------------|--------------|
| Audio playback during delete | Sound object orphaned if playing item is deleted | Delete while playing — no crash, sound stops |
| Screenshot viewer during delete | If viewing a screenshot fullscreen and item is deleted | Close viewer, item gone — no crash |
| Submit flow broken | RLS changes could affect INSERT | Submit new feedback after migration — must work |
| Admin page broken | New RLS policy could interfere with admin SELECT/UPDATE | Load admin page — all data still visible and editable |
| History fetch broken | Hook changes could break the query | Open history — all items load normally |

---

## 8. Invariants

### Preserved
- **Audio is required** — delete doesn't affect the submit path
- **Beta tester gate** — only beta testers have feedback to delete (existing SELECT RLS)
- **User folder isolation** — DELETE storage policy uses same `foldername[1] = uid` pattern
- **No silent failures** — DB delete errors surface to user via Alert

### New
- **INV-DELETE-OWNERSHIP:** Users can only delete their own feedback. Enforced by RLS
  (`auth.uid() = user_id`). Attempting to delete another user's row returns 0 affected rows.
