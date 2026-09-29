/**
 * Issue #1789 (#1767 Phase 1) — the "Options" section of the item sheet
 * (SPEC #1788 P-11, P-11a; DESIGN D-6).
 *
 * Lists an item's modifier groups and hands the editor panel the one group the
 * operator is working on. It renders INSIDE MenuItemSheet's body — never as a
 * second Sheet stacked over it (the shipped sub-sheet rule).
 *
 * It exists as its own component so `MenuItemSheet.tsx` — a SET-A
 * display-only-forever file — stays a plain form and never grows data hooks.
 *
 * Groups can only be attached to a SAVED item: a group carries a real
 * `menu_item_id` FK, so there is nothing to point at until the dish exists.
 * The section says that out loud instead of rendering a dead control.
 *
 * READ TRUTH (issue #3570). The read state is a state MACHINE, never a list
 * length. An options read that threw used to arrive here as `data ?? []` and
 * render "No choices yet." — the surface asserted a false fact, and the false
 * fact was the exact one that invites an owner to recreate groups that already
 * exist. `deriveMenuOptionsReadState` now owns which message renders, so the
 * success-shaped empty copy is reachable ONLY from a settled success, and a
 * failed REFETCH keeps every cached row on screen under a staleness marker
 * instead of silently passing old data off as current server truth.
 *
 * DELETE TRUTH (issue #3571). "Remove this group" opens a confirmation; it
 * never mutates on its own. The consequence is named out loud — the group AND
 * every choice in it, with no undo, because `menu_modifier_groups` CASCADEs
 * into `menu_modifiers` and the shipped schema cannot represent an undo. The
 * failure copy is classified, not a boolean: a group whose options have been
 * ordered is RESTRICTed by order history and can NEVER be deleted, so it is
 * told so plainly and offered no retry.
 *
 * RECONCILIATION (issue #3571, PR #3615 rework cycle 2). A delete refusal, the
 * open editor and the open confirmation are all statements ABOUT A GROUP, and
 * the group list is server truth that moves underneath them. Held in a single
 * unkeyed slot and never checked against that list, one refusal could be
 * erased by the next tap on a different group, could never be released by any
 * server signal, and could outlive the very group it named. All three were the
 * same defect. One render-phase reconciliation now answers "is this still
 * true?" for all three: a refusal is keyed by its group id, pinned to the
 * cached list as it stood on the FIRST RENDER THAT SHOWED IT, dropped when a
 * newer list supersedes that one, and dropped when its group is no longer in
 * the list. `editing` and the pending confirmation are reconciled against the
 * same list, so nothing on screen can describe — or ask about — a group the
 * server no longer reports. Pinning the version at the moment of rendering
 * rather than at the moment of rejection is cycle 3's fix: a version captured
 * when the mutation rejected could already be stale, and the refusal was then
 * dropped before anyone saw it.
 *
 * The read message and the delete message are separate, separately-testable
 * surfaces. A load failure and a save/delete failure are different facts and
 * this section must never conflate them.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  classifyModifierGroupDeleteFailure,
  useDeleteModifierGroup,
  useMenuModifierGroups,
  useSaveModifierGroup,
  type MenuModifierGroup,
  type ModifierGroupDeleteFailureCategory,
} from "../../hooks/useMenuModifiers";
import { isPermissionDeniedError } from "../../utils/supabaseErrorMessage";
import { modifierGroupSummary } from "./menuDepth";
import { MenuModifierGroupEditor } from "./MenuModifierGroupEditor";
import {
  MENU_TEXT_SAVE_COPY,
  classifyMenuTextSaveFailure,
  type MenuTextSaveFailure,
} from "./menuTextValidation";

/** Stable empty list — a fresh `[]` every render churns the focus effect. */
const NO_GROUPS: readonly MenuModifierGroup[] = Object.freeze([]);

/**
 * Stable empty refusal store, for the same reason: a fresh `Map` every render
 * would be a new identity and churn every memo keyed on it.
 */
const NO_DELETE_REFUSALS: DeleteRefusalsByGroup = new Map();

/** Stable empty anchor map — same reason, and the value cleared back to. */
const NO_REFUSAL_ANCHORS: ReadonlyMap<string, number> = new Map();

export interface MenuItemOptionsSectionProps {
  brandId: string | null;
  /** Null while the item is unsaved — groups need a real item id. */
  menuItemId: string | null;
  itemCurrency: string;
  canMutate: boolean;
  onSavingChange?: (saving: boolean) => void;
  testID?: string;
}

export function MenuItemOptionsSection({
  brandId,
  menuItemId,
  itemCurrency,
  canMutate,
  onSavingChange,
  testID,
}: MenuItemOptionsSectionProps): React.ReactElement {
  const groupsQuery = useMenuModifierGroups(brandId, menuItemId);
  const saveGroup = useSaveModifierGroup(brandId);
  const deleteGroup = useDeleteModifierGroup(brandId);

  const [editing, setEditing] = useState<MenuModifierGroup | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<MenuTextSaveFailure | null>(null);
  /*
   * PR #3615 rework cycle 2. ONE REFUSAL PER GROUP. A single slot could only
   * ever hold one subject, so recording Beta's ask destroyed Alpha's standing
   * refusal — the terminal state was erasable by the owner's own next tap.
   */
  const [deleteRefusals, setDeleteRefusals] =
    useState<DeleteRefusalsByGroup>(NO_DELETE_REFUSALS);
  const [pendingDeleteGroup, setPendingDeleteGroup] =
    useState<MenuModifierGroup | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const submissionInFlightRef = useRef<boolean>(false);
  const deletionInFlightRef = useRef<boolean>(false);
  const retryInFlightRef = useRef<boolean>(false);
  const groupRowRefs = useRef<Map<string, React.ElementRef<typeof Pressable>>>(
    new Map(),
  );
  /* #3571 P3-2 — the dialog's last-asked-about group; written at its use site. */
  const dialogGroupRef = useRef<MenuModifierGroup | null>(null);

  /*
   * #3570 — the read state, not the list length, decides what is said. The old
   * `groupsQuery.data ?? []` collapsed "the item genuinely has no groups" and
   * "the read threw" into the same value, and the render branched only on
   * `isLoading`, so an error fell straight through to the empty copy.
   */
  const readState = useMemo(
    () =>
      deriveMenuOptionsReadState({
        status: groupsQuery.status,
        isError: groupsQuery.isError,
        error: groupsQuery.error,
        data: groupsQuery.data,
      }),
    [
      groupsQuery.status,
      groupsQuery.isError,
      groupsQuery.error,
      groupsQuery.data,
    ],
  );

  /*
   * The rows are whatever the server last CONFIRMED, and they survive a failed
   * refetch untouched — nothing already rendered is ever removed because a
   * later read failed.
   */
  const groups = useMemo(
    () => groupsQuery.data ?? NO_GROUPS,
    [groupsQuery.data],
  );

  /*
   * PR #3615 rework cycle 2 — THE RECONCILIATION, and the only place that
   * decides whether a statement about a group is still true.
   *
   * Two facts come from the query, not from a string match:
   *   `hasServerList` — the server has actually answered at least once, so
   *     there IS a list to reconcile against. While it has not, nothing is
   *     dropped: an in-flight first read is not evidence a group is gone.
   *   `readVersion` — React Query's `dataUpdatedAt`, which stamps WHEN THE
   *     CACHED LIST WAS LAST REPLACED. Cycle 2's comment here said it
   *     "advances ONLY when a fetch settles successfully"; that is not true,
   *     and correcting it matters because someone will reason from it. A
   *     direct `queryClient.setQueryData` advances it too, and
   *     `useSaveModifierGroup.onSuccess` calls exactly that with a
   *     locally-merged array before the `invalidateQueries` that refetches —
   *     so saving ANY OTHER group in the same dish releases a standing
   *     refusal on a client-side write, a moment before the read it triggers
   *     returns. Nothing incorrect reaches the screen (that invalidate does
   *     refetch), but the release is coarser than "only a settled fetch".
   *     What never advances it is a fetch that FAILED — which is the property
   *     the release genuinely depends on, and it still holds.
   */
  const hasServerList = Array.isArray(groupsQuery.data);
  const readVersion = groupsQuery.dataUpdatedAt ?? 0;

  const liveGroupIds = useMemo(
    () => new Set(groups.map((group) => group.id)),
    [groups],
  );

  /*
   * PR #3615 rework cycle 3 — WHERE a refusal's read version comes from, and
   * the removal of the mechanism that got it wrong.
   *
   * Cycle 2 stamped it inside the delete mutation's `onError`, reading a ref
   * written during render. That ref held the newest version the component had
   * RENDERED, never the newest the client HELD: React Query writes the new
   * `dataUpdatedAt` into the cache the instant a read settles, and the render
   * that observes it comes afterwards. A rejection landing in that gap was
   * stamped with the superseded version and dropped by the very next render,
   * before it was ever shown — a destructive action that failed and then said
   * nothing at all, which is the exact defect class #3570 and #3571 exist to
   * remove. The ref is gone; nothing stamps a version at `onError` any more.
   *
   * A refusal is anchored HERE instead, on the first render that shows it,
   * and never re-anchored. That is also what the semantic always claimed: a
   * refusal survives until the next list AFTER it became visible. The map is
   * rebuilt from `deleteRefusals` on every run, so a forgotten refusal cannot
   * leave an anchor behind for a later refusal on the same group to inherit —
   * which would re-create "born already superseded" by another route.
   * Written during render, like `dialogGroupRef` below: a pure cache of a
   * value this render already has, idempotent under a double render.
   */
  const refusalAnchorsRef =
    useRef<ReadonlyMap<string, number>>(NO_REFUSAL_ANCHORS);

  /*
   * A refusal survives exactly as long as both remain true: its group is still
   * in the list, and the cached list has not been replaced since the render
   * that first showed it. A NEWER list supersedes it — that is the release
   * path a terminal refusal previously had no version of, and it is tied to
   * server state rather than to a client-side classification that a single
   * unlucky SQLSTATE could latch forever.
   */
  const liveRefusals = useMemo<DeleteRefusalsByGroup>(() => {
    if (deleteRefusals.size === 0) {
      refusalAnchorsRef.current = NO_REFUSAL_ANCHORS;
      return deleteRefusals;
    }
    const anchors = new Map<string, number>();
    const kept = new Map(deleteRefusals);
    for (const groupId of deleteRefusals.keys()) {
      const anchoredAt = refusalAnchorsRef.current.get(groupId) ?? readVersion;
      anchors.set(groupId, anchoredAt);
      /* No list to reconcile against yet: anchor, and release nothing. */
      if (!hasServerList) continue;
      /*
       * ONE predicate on purpose. A refusal survives only while BOTH hold:
       * its group is still in the list, and no newer list has superseded the
       * one it was anchored to. These are deliberately NOT split into two
       * guards — in production `groups` can only change through a write that
       * advances `dataUpdatedAt`, so the group-gone half is never
       * independently observable, and a separate line for it would be a check
       * that carries no information while looking like a guard. It is kept
       * inside the predicate as defence in depth against a future writer that
       * mutates the cached list without advancing the version.
       */
      if (!liveGroupIds.has(groupId) || anchoredAt !== readVersion) {
        kept.delete(groupId);
      }
    }
    refusalAnchorsRef.current = anchors;
    return kept.size === deleteRefusals.size ? deleteRefusals : kept;
  }, [deleteRefusals, liveGroupIds, hasServerList, readVersion]);

  /*
   * The same question asked of the open editor. `editing` held a group the
   * server had stopped reporting, so the section rendered no rows, no editor
   * and — because "Add a choice" is gated on nothing being edited — no way to
   * act at all, underneath an assertive alert about the vanished group.
   */
  let editingGroupId = editing?.id ?? null;
  if (
    editingGroupId !== null &&
    hasServerList &&
    !liveGroupIds.has(editingGroupId)
  ) {
    editingGroupId = null;
  }

  /*
   * And of the open confirmation. Asking about a group the server no longer
   * reports could only ever produce a doomed mutation.
   */
  let pendingDeleteTarget = pendingDeleteGroup;
  if (
    pendingDeleteTarget !== null &&
    hasServerList &&
    !liveGroupIds.has(pendingDeleteTarget.id)
  ) {
    pendingDeleteTarget = null;
  }

  /*
   * #3571 (PR #3615 rework, P3-2). `Modal` keeps its node mounted for 200ms
   * after `visible` drops so the exit animation can play. The pending group is
   * already gone by then, so the dialog used to swap the real group name for
   * the literal placeholder — "Remove “this group”?" — mid-dismissal, a
   * false statement a slow-motion capture catches. Hold the last group that
   * was actually asked about until the node is gone. Written during render for
   * the same reason as `refusalAnchorsRef`.
   */
  if (pendingDeleteTarget !== null) {
    dialogGroupRef.current = pendingDeleteTarget;
  }
  const dialogGroup = pendingDeleteTarget ?? dialogGroupRef.current;

  useEffect(() => {
    onSavingChange?.(saveGroup.isPending);
  }, [onSavingChange, saveGroup.isPending]);

  useEffect(
    () => (): void => {
      submissionInFlightRef.current = false;
      onSavingChange?.(false);
    },
    [onSavingChange],
  );

  useEffect(() => {
    if (focusGroupId === null) return;
    const frame = requestAnimationFrame(() => {
      const target = groupRowRefs.current.get(focusGroupId);
      if (target === undefined) return;
      if (Platform.OS === "web" && hasFocusCapability(target)) target.focus();
      else {
        const handle = findNodeHandle(target);
        if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
      }
      setFocusGroupId(null);
    });
    return (): void => cancelAnimationFrame(frame);
  }, [focusGroupId, groups]);

  /*
   * #3571 (PR #3615 rework, P2-1). A RETRYABLE delete failure is a fact about
   * one attempt, so it dies when the operator leaves the group it was about. A
   * PERMANENT refusal is a fact about the group itself — order history has
   * RESTRICTed it, or the account cannot remove it — so it survives, latched to
   * its group id, and only ever renders while that group is the one on screen.
   */
  const forgetTransientDeleteFailure = useCallback((): void => {
    setDeleteRefusals((current) => {
      if (current.size === 0) return current;
      const kept = new Map(current);
      for (const [groupId, refusal] of current) {
        if (refusal.canRetry) kept.delete(groupId);
      }
      return kept.size === current.size ? current : kept;
    });
  }, []);

  /**
   * Drops ONE group's refusal and leaves every other group's standing.
   *
   * The `key !== groupId` guard IS the cycle-2 fix. Cycle 1 cleared the single
   * shared slot at this point, so a tap on any OTHER group erased a standing
   * permanent refusal, erased the only on-screen explanation of it, and
   * re-armed a delete the database can never accept. Remove that guard and
   * every group's refusal is wiped again — which is the defect itself.
   */
  const forgetDeleteRefusalFor = useCallback((groupId: string): void => {
    setDeleteRefusals((current) => {
      if (current.size === 0) return current;
      const kept = new Map(current);
      for (const key of current.keys()) {
        if (key !== groupId) continue;
        kept.delete(key);
      }
      return kept.size === current.size ? current : kept;
    });
  }, []);

  const closeEditor = useCallback((): void => {
    if (saveGroup.isPending) return;
    setSaveError(null);
    setSuccessMessage(null);
    forgetTransientDeleteFailure();
    setEditing(null);
    setCreating(false);
  }, [saveGroup.isPending, forgetTransientDeleteFailure]);

  const handleSave = useCallback(
    (input: Parameters<typeof saveGroup.mutate>[0]): void => {
      if (submissionInFlightRef.current || saveGroup.isPending) return;
      submissionInFlightRef.current = true;
      onSavingChange?.(true);
      setSaveError(null);
      setSuccessMessage(null);
      saveGroup.mutate(input, {
        onSuccess: (savedGroup) => {
          setSaveError(null);
          setEditing(null);
          setCreating(false);
          setFocusGroupId(savedGroup.id);
          const count = savedGroup.modifiers.length;
          const announcement = `${savedGroup.name} saved with ${count} ${count === 1 ? "option" : "options"}.`;
          setSuccessMessage(announcement);
          AccessibilityInfo.announceForAccessibility(announcement);
        },
        onError: (error) => setSaveError(modifierGroupSaveError(error)),
        onSettled: () => {
          submissionInFlightRef.current = false;
          onSavingChange?.(false);
        },
      });
    },
    [saveGroup, onSavingChange],
  );

  /*
   * #3570 retry. `refetch()` on an already-fetching query issues ANOTHER
   * request, so the read retry needs the same synchronous latch the save path
   * uses: React-state-derived `isFetching` alone cannot stop two activations
   * inside one tick.
   */
  const handleRetryRead = useCallback((): void => {
    if (retryInFlightRef.current || groupsQuery.isFetching) return;
    retryInFlightRef.current = true;
    /*
     * PR #3615 rework, P3-3. The latch MUST release on every exit from this
     * call. A synchronous throw would escape before `.finally` is even
     * attached, and a rejection would leave the derived promise unhandled —
     * either way the retry control dies permanently while every visible signal
     * stays green. Nothing is swallowed: the read failure itself is already
     * carried by `groupsQuery.error` and rendered by `readState`.
     */
    try {
      void Promise.resolve(groupsQuery.refetch())
        .catch(() => undefined)
        .finally(() => {
          retryInFlightRef.current = false;
        });
    } catch {
      retryInFlightRef.current = false;
    }
  }, [groupsQuery]);

  /*
   * #3571 — "Remove this group" ASKS. It does not delete. The mutation lives
   * behind `confirmDeleteGroup` and nowhere else.
   */
  const requestDeleteGroup = useCallback(
    (groupId: string): void => {
      if (saveGroup.isPending || deleteGroup.isPending) return;
      const target = groups.find((group) => group.id === groupId) ?? null;
      if (target === null) return;
      /*
       * #3571 (PR #3615 rework, P3-1). "No retry" used to be true of the
       * DIALOG only: re-asking wiped the terminal message and issued a second
       * mutation the database can never accept. A permanent refusal is now
       * terminal for the FLOW — the ask never reopens for that group, and the
       * fact stays on screen instead of being erasable by the next tap. The
       * trigger is disabled alongside this guard, so no tap lands dead.
       */
      const standing = liveRefusals.get(groupId) ?? null;
      if (standing !== null && !standing.canRetry) return;
      /*
       * PR #3615 rework cycle 2. Scoped to the group BEING ASKED ABOUT. This
       * reset used to be unconditional, so one tap on any other group erased a
       * permanent refusal, erased the only on-screen explanation of it, and
       * re-armed a delete the database can never accept.
       */
      forgetDeleteRefusalFor(groupId);
      setPendingDeleteGroup(target);
    },
    [
      groups,
      saveGroup.isPending,
      deleteGroup.isPending,
      liveRefusals,
      forgetDeleteRefusalFor,
    ],
  );

  const cancelDeleteGroup = useCallback((): void => {
    if (deleteGroup.isPending) return;
    setPendingDeleteGroup(null);
  }, [deleteGroup.isPending]);

  const confirmDeleteGroup = useCallback((): void => {
    const target = pendingDeleteTarget;
    if (target === null || menuItemId === null) return;
    if (deletionInFlightRef.current) return;
    if (saveGroup.isPending || deleteGroup.isPending) return;
    deletionInFlightRef.current = true;
    setSaveError(null);
    setSuccessMessage(null);
    forgetDeleteRefusalFor(target.id);
    deleteGroup.mutate(
      { groupId: target.id, menuItemId },
      {
        onSuccess: () => {
          setPendingDeleteGroup(null);
          closeEditor();
        },
        onError: (deleteRejection) => {
          const failure = modifierGroupDeleteError(deleteRejection);
          /*
           * Scoped to the group it is about (P2-1). An unscoped refusal
           * followed the operator into the NEXT group's editor and asserted
           * something false about the group then on screen — as an assertive
           * live region, so a screen reader re-announced the lie out of
           * context.
           */
          /*
           * Cycle 3: NO read version is stamped here. Whatever this callback
           * could read would be the version of the last render, which the
           * settled-but-unrendered read in flight beside it may already have
           * superseded — and a refusal born superseded is dropped before it
           * is ever shown. The version is anchored on the first render that
           * shows this refusal, in `liveRefusals` above.
           */
          setDeleteRefusals((current) => {
            const next = new Map(current);
            next.set(target.id, { ...failure, groupId: target.id });
            return next;
          });
          /*
           * A failure that can never succeed must not keep a retry in front of
           * the operator. Close the ask; the inline alert carries the truth.
           * A retryable failure keeps the dialog open so the SAME destructive
           * action is the retry.
           */
          if (!failure.canRetry) setPendingDeleteGroup(null);
        },
        onSettled: () => {
          deletionInFlightRef.current = false;
        },
      },
    );
  }, [
    pendingDeleteTarget,
    menuItemId,
    deleteGroup,
    saveGroup.isPending,
    closeEditor,
    forgetDeleteRefusalFor,
  ]);

  /*
   * #3571 (PR #3615 rework, P2-1). The alert renders ONLY while the group it
   * belongs to is the one the operator is looking at — the open editor, or the
   * group currently being asked about. Anything else and the message would be
   * a statement about a group that is not on screen.
   */
  const visibleGroupId = pendingDeleteTarget?.id ?? editingGroupId ?? null;
  const visibleDeleteFailure =
    visibleGroupId === null
      ? null
      : (liveRefusals.get(visibleGroupId) ?? null);
  const removalBlockedReason =
    visibleDeleteFailure !== null && !visibleDeleteFailure.canRetry
      ? visibleDeleteFailure.message
      : null;

  /*
   * #3571 (PR #3615 rework cycle 3, P3). The OPEN confirmation reads its
   * error from the RAW refusal store, not the reconciled one, so the copy is
   * held for as long as its dialog is open.
   *
   * Reconciliation exists to stop the SECTION asserting something stale about
   * a group. The dialog is a different question: it is one attempt the
   * operator is still inside, and that copy is the assertive alert added so a
   * VoiceOver or TalkBack operator hears WHY the delete failed. A newer read
   * settling underneath used to blank it mid-announcement, leaving an open
   * confirmation with no stated reason for the failure that put it there —
   * and a sighted operator watching the reason vanish out of a dialog they
   * were still reading. It clears when the dialog closes, and when a retry
   * drops the refusal it describes.
   */
  const dialogDeleteFailure =
    pendingDeleteTarget === null
      ? null
      : (deleteRefusals.get(pendingDeleteTarget.id) ?? null);

  if (menuItemId === null) {
    return (
      <View style={styles.host} testID={testID ?? "menu-item-options-empty"}>
        <Text style={styles.groupLabel}>Options</Text>
        <Text style={styles.helper}>
          Save the item first, then add choices like “How would you like it?”
          or “Extras”.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host} testID={testID ?? "menu-item-options"}>
      <Text style={styles.groupLabel}>Options</Text>

      {visibleDeleteFailure !== null ? (
        <View style={styles.alert} testID="menu-item-options-error">
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            aria-live="assertive"
            style={styles.error}
          >
            {visibleDeleteFailure.message}
          </Text>
        </View>
      ) : null}

      {successMessage !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
          {successMessage}
        </Text>
      ) : null}

      {readState.kind === "loading" ? (
        <Text style={styles.helper} accessibilityLiveRegion="polite">
          Loading options…
        </Text>
      ) : readState.kind === "empty" && !creating ? (
        <Text style={styles.helper}>
          No choices yet. Add one so guests can say how they want it.
        </Text>
      ) : null}

      {readState.kind === "fatal-error" || readState.kind === "stale-error" ? (
        <View style={styles.alert} testID="menu-item-options-read-error">
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            aria-live="assertive"
            style={styles.error}
          >
            {readState.message}
          </Text>
          {readState.canRetry ? (
            <Button
              label="Try again"
              accessibilityLabel={MENU_OPTIONS_READ_COPY.retryAccessibleName}
              onPress={handleRetryRead}
              variant="secondary"
              size="md"
              loading={groupsQuery.isFetching}
              disabled={groupsQuery.isFetching}
              style={styles.readRetry}
              testID="menu-item-options-read-retry"
            />
          ) : null}
        </View>
      ) : null}

      {groups.map((group) =>
        editingGroupId === group.id ? (
          <MenuModifierGroupEditor
            key={group.id}
            menuItemId={menuItemId}
            group={group}
            currency={itemCurrency}
            nextSortOrder={group.sortOrder}
            onSave={handleSave}
            saving={saveGroup.isPending}
            saveError={saveError}
            onClearSaveError={() => setSaveError(null)}
            onRequestDelete={canMutate ? requestDeleteGroup : undefined}
            removalBlockedReason={removalBlockedReason}
            deleting={deleteGroup.isPending}
            onCancel={closeEditor}
          />
        ) : (
          <Pressable
            key={group.id}
            ref={(node) => {
              if (node === null) groupRowRefs.current.delete(group.id);
              else groupRowRefs.current.set(group.id, node);
            }}
            onPress={() => {
              if (saveGroup.isPending) return;
              setSaveError(null);
              setSuccessMessage(null);
              /* P2-1 — a transient refusal does not follow the operator. */
              forgetTransientDeleteFailure();
              setCreating(false);
              setEditing(group);
            }}
            disabled={!canMutate || saveGroup.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Edit the ${group.name} options`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`menu-item-option-group-${group.id}`}
          >
            <Text style={styles.rowTitle} numberOfLines={1}>
              {group.name}
            </Text>
            <Text style={styles.rowMeta}>
              {modifierGroupSummary({
                selectionMode: group.selectionMode,
                minSelect: group.minSelect,
                maxSelect: group.maxSelect,
                optionCount: group.modifiers.length,
              })}
            </Text>
          </Pressable>
        ),
      )}

      {creating ? (
        <MenuModifierGroupEditor
          menuItemId={menuItemId}
          group={null}
          currency={itemCurrency}
          nextSortOrder={groups.length}
          onSave={handleSave}
          saving={saveGroup.isPending}
          saveError={saveError}
          onClearSaveError={() => setSaveError(null)}
          onCancel={closeEditor}
        />
      ) : canMutate && editingGroupId === null ? (
        <Button
          label="Add a choice"
          onPress={() => {
            if (saveGroup.isPending) return;
            setSaveError(null);
            setSuccessMessage(null);
            setCreating(true);
          }}
          variant="secondary"
          size="sm"
          style={styles.add}
          testID="menu-item-options-add"
        />
      ) : null}

      <ConfirmDialog
        visible={pendingDeleteTarget !== null}
        onClose={cancelDeleteGroup}
        onConfirm={confirmDeleteGroup}
        title={menuModifierGroupDeleteTitle(dialogGroup)}
        description={menuModifierGroupDeleteDescription(dialogGroup)}
        variant="simple"
        destructive
        confirmLabel="Remove group"
        cancelLabel="Keep group"
        initialFocus="cancel"
        confirmLoading={deleteGroup.isPending}
        errorMessage={
          dialogDeleteFailure !== null && dialogDeleteFailure.canRetry
            ? dialogDeleteFailure.message
            : null
        }
        errorTestID="menu-item-options-delete-dialog-error"
        confirmTestID="menu-item-options-delete-confirm"
        cancelTestID="menu-item-options-delete-cancel"
        testID="menu-item-options-delete-dialog"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.xxs,
    marginTop: spacing.sm,
  },
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  helper: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  error: {
    ...typography.bodySm,
    // #3284 — `semantic.error` (#ef4444) misses 4.5:1 for TEXT on dark
    // surfaces; `errorText` is the token for error copy a human must read.
    color: semantic.errorText,
  },
  alert: {
    gap: spacing.xxs,
    marginBottom: spacing.xxs,
  },
  readRetry: {
    alignSelf: "flex-start",
    // #3570 — `Button size="md"` is already 44pt; this is the floor that keeps
    // the target legal if the size prop is ever changed.
    minHeight: 44,
  },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  row: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  rowTitle: {
    ...typography.body,
    color: textTokens.primary,
  },
  rowMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  pressed: {
    opacity: 0.6,
  },
  add: {
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
  },
});

export default MenuItemOptionsSection;

interface FocusCapable {
  focus: () => void;
}

function hasFocusCapability(value: unknown): value is FocusCapable {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "focus" in value &&
    typeof value.focus === "function"
  );
}

/**
 * Issue #3570 — the read-state machine.
 *
 * Every branch is named, so no state can borrow another's voice. In particular
 * a query that is DISABLED (`status: "pending"`, `fetchStatus: "idle"`, never
 * fetched) reports `loading`, not `empty`: React Query v5 leaves `isLoading`
 * false for it, which is how a never-issued request used to render "No choices
 * yet." having asked the server nothing at all.
 */
export type MenuOptionsReadState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "list" }
  | { kind: "fatal-error"; message: string; canRetry: boolean }
  | { kind: "stale-error"; message: string; canRetry: boolean };

export const MENU_OPTIONS_READ_COPY = Object.freeze({
  /* Generic and offline read failures — a retry can genuinely succeed. */
  fatal: "Couldn't load choices. Check your connection and try again.",
  /* A denial is terminal. Saying "try again" to it would be a lie. */
  fatalPermission: "You cannot load choices with this account.",
  stale: "Couldn't refresh choices. Showing the last saved version.",
  retryAccessibleName: "Retry loading options",
});

export interface MenuOptionsReadSnapshot {
  status: string;
  isError: boolean;
  error: unknown;
  data: MenuModifierGroup[] | undefined;
}

export function deriveMenuOptionsReadState(
  snapshot: MenuOptionsReadSnapshot,
): MenuOptionsReadState {
  const hasServerAnswer = Array.isArray(snapshot.data);
  if (snapshot.isError || snapshot.status === "error") {
    const terminal = isPermissionDeniedError(snapshot.error);
    if (hasServerAnswer) {
      return {
        kind: "stale-error",
        message: MENU_OPTIONS_READ_COPY.stale,
        canRetry: !terminal,
      };
    }
    return {
      kind: "fatal-error",
      message: terminal
        ? MENU_OPTIONS_READ_COPY.fatalPermission
        : MENU_OPTIONS_READ_COPY.fatal,
      canRetry: !terminal,
    };
  }
  /* Anything not settled successfully is still LOADING, never empty. */
  if (snapshot.status !== "success" || !hasServerAnswer) {
    return { kind: "loading" };
  }
  return (snapshot.data as MenuModifierGroup[]).length === 0
    ? { kind: "empty" }
    : { kind: "list" };
}

/**
 * Issue #3571 — delete failure copy. Separate from the SAVE copy on purpose:
 * "Your changes are still here" is true of a rejected save and false of a
 * rejected delete, and separate from the READ copy because a load failure and
 * a delete failure are different facts.
 */
export const MENU_OPTIONS_DELETE_COPY = Object.freeze({
  inUse:
    "Guests have already ordered these choices, so this group can't be removed. Turn the options off instead.",
  permission: "You cannot remove this group with this account.",
  generic: "We couldn't remove this group. Try again.",
});

export interface MenuModifierGroupDeleteFailure {
  category: ModifierGroupDeleteFailureCategory;
  message: string;
  canRetry: boolean;
}

/**
 * Issue #3571 (PR #3615 rework, P2-1). A delete refusal is a statement about
 * ONE group, so it carries the id of the group it is about. Held unscoped, the
 * message outlived its subject: refuse a delete on "Alpha", close that editor,
 * open "Beta" — and the assertive alert above Beta still said guests had
 * already ordered Alpha's choices. The alert renders only while its own group
 * is the one on screen.
 */
export interface ScopedModifierGroupDeleteFailure
  extends MenuModifierGroupDeleteFailure {
  groupId: string;
}

/**
 * One standing refusal per group id. Never a single shared slot.
 *
 * Issue #3571 (PR #3615 rework cycle 3). A refusal used to carry a `readAt`
 * stamped inside the mutation's `onError` — the read version the component
 * had last RENDERED, which a read already settled in the cache could have
 * superseded, so the refusal was dropped before it was ever shown. Which read
 * a refusal is pinned to is now decided on the first render that shows it and
 * held beside the store, not on the refusal, so there is no longer any way to
 * record a version that is already stale. See `liveRefusals`.
 */
export type DeleteRefusalsByGroup = ReadonlyMap<
  string,
  ScopedModifierGroupDeleteFailure
>;

export function modifierGroupDeleteError(
  error: Error,
): MenuModifierGroupDeleteFailure {
  const carried = error as Error & {
    category?: ModifierGroupDeleteFailureCategory;
  };
  const category =
    carried.category ?? classifyModifierGroupDeleteFailure(error);
  if (category === "in-use") {
    return {
      category,
      message: MENU_OPTIONS_DELETE_COPY.inUse,
      canRetry: false,
    };
  }
  if (category === "permission") {
    return {
      category,
      message: MENU_OPTIONS_DELETE_COPY.permission,
      canRetry: false,
    };
  }
  return {
    category,
    message: MENU_OPTIONS_DELETE_COPY.generic,
    canRetry: true,
  };
}

export function menuModifierGroupDeleteTitle(
  group: MenuModifierGroup | null,
): string {
  return `Remove \u201C${group?.name ?? "this group"}\u201D?`;
}

/**
 * Names the real consequence and the exact count. Deleting the group CASCADEs
 * into every option in it, and the shipped schema has no undo — so the copy
 * promises none.
 */
export function menuModifierGroupDeleteDescription(
  group: MenuModifierGroup | null,
): string {
  const name = group?.name ?? "This group";
  const choiceCount = group?.modifiers.length ?? 0;
  if (choiceCount === 0) {
    return (
      `\u201C${name}\u201D will be removed from your menu and your public page.` +
      " This can't be undone."
    );
  }
  const choiceWord = choiceCount === 1 ? "choice" : "choices";
  return (
    `\u201C${name}\u201D and its ${choiceCount} ${choiceWord} will be removed from` +
    " your menu and your public page. This can't be undone."
  );
}

function modifierGroupSaveError(error: Error): MenuTextSaveFailure {
  /*
   * Shared classification preserves #3563's exact safe copy:
   * "You cannot save this group with this account. Your changes are still here."
   * "You are offline. Reconnect, then try again. Your changes are still here."
   * "We could not save this group. Your changes are still here — try again."
   */
  const safe = error as Error & { category?: string };
  if (safe.category === "permission") {
    return {
      kind: "permission",
      message: MENU_TEXT_SAVE_COPY.modifier.permission,
    };
  }
  if (safe.category === "offline") {
    return { kind: "offline", message: MENU_TEXT_SAVE_COPY.modifier.offline };
  }
  return classifyMenuTextSaveFailure(error, "modifier");
}
