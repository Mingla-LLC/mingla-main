/**
 * ORCH-1150 — RsvpGuestConsole (A2 + A2-NEW host remove).
 *
 * A full-screen host console (NOT a sheet) for an RSVP event: pending approvals
 * (Approve / Deny per row + Approve-all), the Going list (each row carries a
 * Remove action → confirm dialog → approved→denied), and a read-only Waitlist.
 *
 * Constitution #1 (no dead taps): Approve / Deny / Remove / Approve-all all fire
 * a real mutation. Constitution #3 (no silent failures): per-row failures toast.
 * Android glass: rows use the opaque fallback.
 *
 * See SPEC §5.4.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Toast } from "../ui/Toast";
import {
  useBulkApproveRsvps,
  useRsvpGuestList,
  useSetRsvpStatus,
} from "../../hooks/useRsvpApprovals";
import type { RsvpGuest } from "../../services/rsvpApprovals";

const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});

export interface RsvpGuestConsoleProps {
  eventId: string;
  eventTitle?: string | null;
}

const isConfirmed = (g: RsvpGuest): boolean =>
  g.rsvpStatus === "going" && g.approvalStatus === "approved";

export const RsvpGuestConsole: React.FC<RsvpGuestConsoleProps> = ({
  eventId,
  eventTitle,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useRsvpGuestList(eventId);
  const setStatus = useSetRsvpStatus(eventId);
  const bulkApprove = useBulkApproveRsvps(eventId);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [removeTarget, setRemoveTarget] = useState<RsvpGuest | null>(null);

  const guests = useMemo<RsvpGuest[]>(() => data ?? [], [data]);
  const pending = useMemo(() => guests.filter((g) => g.approvalStatus === "pending"), [guests]);
  const going = useMemo(() => guests.filter(isConfirmed), [guests]);
  const waitlisted = useMemo(
    () => guests.filter((g) => g.rsvpStatus === "waitlisted"),
    [guests],
  );
  // ORCH-1150 R2 D-10: read-only "Maybe" group — non-binding, cap-neutral guests
  // (auto-approved). No approve/deny actions; the host just sees who might come.
  const maybe = useMemo(
    () => guests.filter((g) => g.rsvpStatus === "maybe"),
    [guests],
  );

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleApprove = useCallback(
    (g: RsvpGuest): void => {
      setStatus.mutate(
        { rsvpId: g.id, status: "approved" },
        {
          onError: () => showToast(`Couldn't update ${g.guestName}. Try again.`),
        },
      );
    },
    [setStatus, showToast],
  );

  const handleDeny = useCallback(
    (g: RsvpGuest): void => {
      setStatus.mutate(
        { rsvpId: g.id, status: "denied" },
        {
          onError: () => showToast(`Couldn't update ${g.guestName}. Try again.`),
        },
      );
    },
    [setStatus, showToast],
  );

  const handleConfirmRemove = useCallback((): void => {
    const g = removeTarget;
    if (g === null) return;
    setStatus.mutate(
      { rsvpId: g.id, status: "denied" },
      {
        onSuccess: () => setRemoveTarget(null),
        onError: () => {
          setRemoveTarget(null);
          showToast(`Couldn't remove ${g.guestName}. Try again.`);
        },
      },
    );
  }, [removeTarget, setStatus, showToast]);

  const handleBulkApprove = useCallback((): void => {
    bulkApprove.mutate(undefined, {
      onSuccess: (res) => {
        if (res.skippedForCapacity > 0) {
          showToast(`Approved ${res.approvedCount}. ${res.skippedForCapacity} didn't fit your limit.`);
        }
      },
      onError: () => showToast("Couldn't approve everyone. Try again."),
    });
  }, [bulkApprove, showToast]);

  const renderHeader = (): React.ReactElement => (
    <View style={styles.chromeRow}>
      <IconChrome icon="chevL" size={36} onPress={() => router.back()} accessibilityLabel="Back" />
      <Text style={styles.chromeTitle} numberOfLines={1}>
        {eventTitle && eventTitle.length > 0 ? eventTitle : "Guests"}
      </Text>
      <View style={styles.chromeSpacer} />
    </View>
  );

  // ---- States ----
  if (isLoading) {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        {renderHeader()}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={accent.warm} />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
        {renderHeader()}
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load guests.</Text>
          <Button label="Tap to retry" variant="secondary" size="md" onPress={() => void refetch()} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
      {renderHeader()}
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Pending section */}
        {pending.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Pending ({pending.length})</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Approve all ${pending.length}`}
                onPress={handleBulkApprove}
                disabled={bulkApprove.isPending}
                style={styles.bulkBtn}
                testID="rsvp-bulk-approve"
              >
                <Text style={styles.bulkBtnText}>Approve all ({pending.length})</Text>
              </Pressable>
            </View>
            {pending.map((g) => (
              <View key={g.id} style={styles.guestRow}>
                <View style={styles.guestInfo}>
                  <Text style={styles.guestName} numberOfLines={1}>
                    {g.guestName}
                    {g.plusCount > 0 ? <Text style={styles.plusChip}>  +{g.plusCount}</Text> : null}
                  </Text>
                  <Text style={styles.guestContact} numberOfLines={1}>
                    {g.guestEmail ?? g.guestPhone ?? "App guest"}
                  </Text>
                </View>
                <View style={styles.actionCol}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Approve ${g.guestName}`}
                    onPress={() => handleApprove(g)}
                    style={[styles.smallBtn, styles.approveBtn]}
                    testID={`rsvp-approve-${g.id}`}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Deny ${g.guestName}`}
                    onPress={() => handleDeny(g)}
                    style={[styles.smallBtn, styles.ghostBtn]}
                    testID={`rsvp-deny-${g.id}`}
                  >
                    <Text style={styles.ghostBtnText}>Deny</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Going section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Going ({going.length})</Text>
          {going.length === 0 ? (
            <Text style={styles.emptySub}>No one&apos;s confirmed yet.</Text>
          ) : (
            going.map((g) => (
              <View key={g.id} style={styles.guestRow}>
                <View style={styles.guestInfo}>
                  <Text style={styles.guestName} numberOfLines={1}>
                    {g.guestName}
                    {g.plusCount > 0 ? <Text style={styles.plusChip}>  +{g.plusCount}</Text> : null}
                  </Text>
                  <Text style={styles.guestContact} numberOfLines={1}>
                    {g.guestEmail ?? g.guestPhone ?? "App guest"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${g.guestName}`}
                  onPress={() => setRemoveTarget(g)}
                  style={[styles.smallBtn, styles.removeBtn]}
                  testID={`rsvp-remove-${g.id}`}
                >
                  <Text style={styles.removeBtnText}>Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        {/* Maybe section (read-only) — ORCH-1150 R2 D-10 */}
        {maybe.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maybe ({maybe.length})</Text>
            {maybe.map((g) => (
              <View key={g.id} style={styles.guestRow} testID={`rsvp-maybe-${g.id}`}>
                <View style={styles.guestInfo}>
                  <Text style={styles.guestName} numberOfLines={1}>
                    {g.guestName}
                    {g.plusCount > 0 ? <Text style={styles.plusChip}>  +{g.plusCount}</Text> : null}
                  </Text>
                  <Text style={styles.guestContact} numberOfLines={1}>
                    {g.guestEmail ?? g.guestPhone ?? "App guest"}
                  </Text>
                </View>
                <Icon name="users" size={18} color={textTokens.tertiary} />
              </View>
            ))}
          </View>
        ) : null}

        {/* Waitlist section (read-only) */}
        {waitlisted.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Waitlist ({waitlisted.length})</Text>
            {waitlisted.map((g) => (
              <View key={g.id} style={styles.guestRow}>
                <View style={styles.guestInfo}>
                  <Text style={styles.guestName} numberOfLines={1}>
                    {g.guestName}
                    {g.plusCount > 0 ? <Text style={styles.plusChip}>  +{g.plusCount}</Text> : null}
                  </Text>
                  <Text style={styles.guestContact} numberOfLines={1}>
                    {g.guestEmail ?? g.guestPhone ?? "App guest"}
                  </Text>
                </View>
                <Icon name="clock" size={18} color={textTokens.tertiary} />
              </View>
            ))}
          </View>
        ) : null}

        {/* Auto-mode + no pending hint */}
        {pending.length === 0 && going.length > 0 ? (
          <Text style={styles.footerHint}>
            Everyone who taps Going is in automatically.
          </Text>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
        title={removeTarget !== null ? `Remove ${removeTarget.guestName}?` : "Remove guest?"}
        description="They'll be moved out of this event and notified. If you have a waitlist, the next person is moved in automatically."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmLoading={setStatus.isPending}
        confirmDisabled={setStatus.isPending}
        destructive
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast((p) => ({ ...p, visible: false }))}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  chromeSpacer: { width: 36 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  bulkBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  bulkBtnText: { fontSize: typography.bodySm.fontSize, fontWeight: "700", color: accent.warm },
  guestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  guestInfo: { flex: 1, marginRight: spacing.sm },
  guestName: { fontSize: typography.bodySm.fontSize, fontWeight: "600", color: textTokens.primary },
  plusChip: { fontSize: typography.caption.fontSize, fontWeight: "700", color: accent.warm },
  guestContact: { fontSize: typography.caption.fontSize, color: textTokens.tertiary, marginTop: 2 },
  actionCol: { flexDirection: "row", gap: spacing.xs },
  smallBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
  },
  approveBtn: { backgroundColor: accent.warm },
  approveBtnText: { fontSize: typography.caption.fontSize, fontWeight: "700", color: "#fff" },
  ghostBtn: { backgroundColor: glass.tint.profileBase, borderWidth: 1, borderColor: glass.border.profileBase },
  ghostBtnText: { fontSize: typography.caption.fontSize, fontWeight: "600", color: textTokens.secondary },
  removeBtn: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: semantic.error },
  removeBtnText: { fontSize: typography.caption.fontSize, fontWeight: "600", color: semantic.error },
  emptyTitle: { fontSize: typography.bodyLg.fontSize, fontWeight: "600", color: textTokens.primary },
  emptySub: { fontSize: typography.bodySm.fontSize, color: textTokens.tertiary },
  footerHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
});

export default RsvpGuestConsole;
