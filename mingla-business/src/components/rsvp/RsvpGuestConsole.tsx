/**
 * ORCH-1150 — RsvpGuestConsole (A2 + A2-NEW host remove).
 * ORCH-1334 — read-time identity + provenance: avatar, real name, "On Mingla" /
 * "RSVP'd on web" source badge, a PRESS-ISOLATED tappable row body that opens the
 * new guest-detail sheet. The write path is untouched; identity is resolved by
 * host_list_rsvp_guests at read time.
 *
 * A full-screen host console (NOT a sheet) for an RSVP event: pending approvals
 * (Approve / Deny per row + Approve-all), the Going list (each row carries a
 * Remove action → confirm dialog → approved→denied), and a read-only Waitlist.
 *
 * Constitution #1 (no dead taps): Approve / Deny / Remove / Approve-all all fire
 * a real mutation AND stay isolated from the row-body press target (the tappable
 * body is a Pressable SIBLING of the action cluster — tapping an action never
 * opens the sheet, tapping the body never fires an action). Constitution #3 (no
 * silent failures): per-row failures toast. Android glass: rows use the opaque
 * fallback.
 *
 * See SPEC_ORCH-1150 §5.4 + SPEC_ORCH-1334 §4E.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import type { RsvpGuest, RsvpSourceValue } from "../../services/rsvpApprovals";
import { deferAfterDismiss } from "../../utils/deferAfterDismiss";
import { RsvpGuestDetailSheet } from "./RsvpGuestDetailSheet";
import { SourceRefundStatusChip } from "../refunds/SourceRefundStatusChip";
import { useEventRsvpContributionRefunds } from "../../hooks/useRsvpContributionRefunds";
import { requestRsvpContributionRefund } from "../../services/sourceRefundService";

const ROW_BG = Platform.select({
  ios: glass.tint.profileBase,
  android: "#23262b",
  default: glass.tint.profileBase,
});
const ROW_BG_PRESSED = Platform.select({
  ios: glass.tint.profileElevated,
  android: "#2a2e34",
  default: glass.tint.profileElevated,
});

// ORCH-1334 — avatar helpers copied inline (byte-for-byte from
// app/event/[id]/guests/index.tsx:88-101 per SPEC §4E-10; NOT refactored into a
// shared util this ORCH).
const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

// ORCH-1334 — source-badge palette. Both badge texts are AA-safe LIGHTENED tokens
// on their translucent tinted fills over the dark row (WCAG AA kit I-38/I-39;
// SPEC §4E-4). The "On Mingla" text uses #ffa94d, NOT the brand accent.warm
// #eb7825 which measures 3.94:1 (iOS) / 3.38:1 (Android) on the composited
// accent.tint fill — below AA 4.5:1 for 11px/600 normal text; #ffa94d measures
// 6.00:1 (iOS) / 5.15:1 (Android). The web badge uses #7ab0ff — the token #3b82f6
// measures ~4.28:1 on the info-tint fill, below AA; #7ab0ff measures 6.43:1 (iOS)
// / 5.45:1 (Android).
const APP_BADGE_TEXT = "#ffa94d";
const WEB_BADGE_TEXT = "#7ab0ff";
const WEB_BADGE_BORDER = "rgba(59, 130, 246, 0.55)";

interface GuestAvatarProps {
  guest: RsvpGuest;
  size: number;
}

/** ORCH-1334 — profile image for app members (with initials fallback on error/
 *  absence), hue-hashed initials tile for web guests. Never fabricates a photo. */
export const GuestAvatar: React.FC<GuestAvatarProps> = ({ guest, size }) => {
  const [imgFailed, setImgFailed] = useState<boolean>(false);
  const showImage =
    guest.source === "app" &&
    typeof guest.avatarUrl === "string" &&
    guest.avatarUrl.length > 0 &&
    !imgFailed;

  const dimensionStyle = {
    width: size,
    height: size,
    borderRadius: radiusTokens.full,
  };

  if (showImage) {
    return (
      <Image
        source={{ uri: guest.avatarUrl as string }}
        style={[styles.avatarBase, dimensionStyle]}
        onError={() => setImgFailed(true)}
        accessibilityLabel={`${guest.displayName} avatar`}
      />
    );
  }

  return (
    <View
      style={[
        styles.avatarBase,
        dimensionStyle,
        styles.avatarInitials,
        { backgroundColor: `hsl(${hashStringToHue(guest.id)}, 60%, 45%)` },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.avatarInitialsText, { fontSize: size * 0.4 }]}>
        {getInitials(guest.displayName)}
      </Text>
    </View>
  );
};

interface SourceBadgeProps {
  source: RsvpSourceValue;
}

/** ORCH-1334 — the "where from" answer. The WORD carries the meaning (not
 *  color-only, per §4E-7). */
export const SourceBadge: React.FC<SourceBadgeProps> = ({ source }) => {
  const isApp = source === "app";
  return (
    <View
      style={[
        styles.badge,
        isApp
          ? { backgroundColor: accent.tint, borderColor: accent.border }
          : { backgroundColor: semantic.infoTint, borderColor: WEB_BADGE_BORDER },
      ]}
    >
      <Text
        style={[styles.badgeText, { color: isApp ? APP_BADGE_TEXT : WEB_BADGE_TEXT }]}
      >
        {isApp ? "On Mingla" : "RSVP'd on web"}
      </Text>
    </View>
  );
};

export interface RsvpGuestConsoleProps {
  eventId: string;
  eventTitle?: string | null;
}

const isConfirmed = (g: RsvpGuest): boolean =>
  g.rsvpStatus === "going" && g.approvalStatus === "approved";

const checkinLine = (guest: RsvpGuest): string | null => {
  if (!isConfirmed(guest)) return null;
  const total = 1 + guest.plusCount;
  const checked = (guest.checkedInAt ? 1 : 0) + guest.plusCheckedInCount;
  const sorted = [guest.checkedInAt, ...guest.plusCheckins.map((item) => item.checkedInAt)]
    .filter((value): value is string => typeof value === "string")
    .sort();
  const latest = sorted[sorted.length - 1];
  const time = latest ? new Date(latest).toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit",
  }) : null;
  return `${checked} of ${total} checked in${time ? ` · ${time} by scanner` : ""}`;
};

export const RsvpGuestConsole: React.FC<RsvpGuestConsoleProps> = ({
  eventId,
  eventTitle,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useRsvpGuestList(eventId);
  const setStatus = useSetRsvpStatus(eventId);
  const bulkApprove = useBulkApproveRsvps(eventId);
  const contributionRefunds = useEventRsvpContributionRefunds(eventId);
  const [refundPendingId, setRefundPendingId] = useState<string | null>(null);
  const [checkinFilter, setCheckinFilter] = useState<"all" | "not_checked_in" | "checked_in">("all");

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [removeTarget, setRemoveTarget] = useState<RsvpGuest | null>(null);
  // ORCH-1334 — the guest whose detail sheet is open (null = closed).
  const [selectedGuest, setSelectedGuest] = useState<RsvpGuest | null>(null);
  // #1376 [rsvp-console-modal-fix] Bug 2 — the sheet's OWN error notice, driven
  // into a <Toast> nested INSIDE RsvpGuestDetailSheet's <Sheet> (null = hidden).
  // Sheet approve/deny failures route here (not the console-root sibling <Toast>,
  // which iOS New-Arch drops while the sheet modal is up).
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  // #1376 SC-1b — mirror the latest open-sheet guest so the DEFERRED remove-confirm
  // (handleSheetRemove) can bail if a new sheet re-opened within the ~340ms defer
  // window, never presenting a ConfirmDialog over a freshly re-opened sheet.
  const selectedGuestRef = useRef<RsvpGuest | null>(selectedGuest);
  useEffect(() => {
    selectedGuestRef.current = selectedGuest;
  }, [selectedGuest]);

  const guests = useMemo<RsvpGuest[]>(() => data ?? [], [data]);
  const pending = useMemo(() => guests.filter((g) => g.approvalStatus === "pending"), [guests]);
  const going = useMemo(() => guests.filter(isConfirmed), [guests]);
  const visibleGoing = useMemo(() => going.filter((guest) => {
    if (checkinFilter === "all") return true;
    const checked = (guest.checkedInAt ? 1 : 0) + guest.plusCheckedInCount;
    return checkinFilter === "checked_in" ? checked > 0 : checked === 0;
  }), [checkinFilter, going]);
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
  const contributionByRsvp = useMemo(
    () =>
      new Map(
        (contributionRefunds.data ?? [])
          .filter((item) => item.rsvpId !== null)
          .map((item) => [item.rsvpId as string, item]),
      ),
    [contributionRefunds.data],
  );

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleApprove = useCallback(
    (g: RsvpGuest): void => {
      setStatus.mutate(
        { rsvpId: g.id, status: "approved" },
        {
          onError: () => showToast(`Couldn't update ${g.displayName}. Try again.`),
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
          onError: () => showToast(`Couldn't update ${g.displayName}. Try again.`),
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
          showToast(`Couldn't remove ${g.displayName}. Try again.`);
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

  // ORCH-1334 — sheet-scoped host actions. Approve/Deny fire the mutation and
  // close the sheet on success; Remove closes the sheet FIRST, then defers the
  // confirm dialog past the sheet's dismissal (no modal-over-modal).
  //
  // #1376 [rsvp-console-modal-fix] Bug 2 — on FAILURE the sheet stays OPEN by
  // design (the host retries in-context), so the error can't be deferred past a
  // dismissal that never happens; it routes to the sheet's own nested <Toast>
  // via setSheetNotice, NOT the console-root sibling showToast (which iOS drops
  // while the sheet modal is up).
  const handleSheetApprove = useCallback(
    (g: RsvpGuest): void => {
      setStatus.mutate(
        { rsvpId: g.id, status: "approved" },
        {
          onSuccess: () => setSelectedGuest(null),
          onError: () => setSheetNotice(`Couldn't update ${g.displayName}. Try again.`),
        },
      );
    },
    [setStatus],
  );

  const handleSheetDeny = useCallback(
    (g: RsvpGuest): void => {
      setStatus.mutate(
        { rsvpId: g.id, status: "denied" },
        {
          onSuccess: () => setSelectedGuest(null),
          onError: () => setSheetNotice(`Couldn't update ${g.displayName}. Try again.`),
        },
      );
    },
    [setStatus],
  );

  // #1376 Bug 1 — close-then-DEFER (NOT nest). Close the detail sheet FIRST, then
  // open the SHARED remove ConfirmDialog only AFTER the sheet's native modal has
  // fully dismissed, via the shipped deferAfterDismiss helper (#1360). Opening the
  // sibling ConfirmDialog in the SAME tick makes its <Modal> contend for the
  // screen-root VC during the sheet's 280ms unmount window and iOS New-Arch drops
  // it — the confirm never appears (device-proven on #1376). We do NOT nest the
  // ConfirmDialog inside the sheet because it is SHARED with the row-level Remove
  // (no sheet open there); only the sheet path's timing is fixed.
  // SC-1b guard: skip the confirm if a new sheet re-opened within the defer window.
  const handleSheetRemove = useCallback((g: RsvpGuest): void => {
    setSelectedGuest(null);
    deferAfterDismiss(() => {
      if (selectedGuestRef.current === null) {
        setRemoveTarget(g);
      }
    });
  }, []);

  // #1376 Bug 2 — open a guest's detail sheet, clearing any stale sheet notice so
  // a prior approve/deny error never re-appears over a freshly opened sheet.
  const handleSelectGuest = useCallback((g: RsvpGuest): void => {
    setSheetNotice(null);
    setSelectedGuest(g);
  }, []);

  const handleRefundContribution = useCallback(
    (contributionId: string): void => {
      setRefundPendingId(contributionId);
      void requestRsvpContributionRefund({
        eventId,
        contributionId,
        mode: "discretionary",
        reason: "Organizer-approved RSVP contribution refund",
      }).then(async () => {
        await contributionRefunds.refetch();
        showToast("Contribution refund requested.");
      }).catch(() => {
        showToast("Couldn't request this refund. Try again.");
      }).finally(() => setRefundPendingId(null));
    },
    [contributionRefunds, eventId, showToast],
  );

  // ORCH-1334 — one row: a press-isolated tappable body (avatar + name + source
  // badge, opens the sheet) SIBLING to the trailing action/status cluster.
  const renderRow = useCallback(
    (g: RsvpGuest, trailing: React.ReactNode, testID?: string): React.ReactElement => (
      <View key={g.id} style={styles.guestRow} testID={testID}>
        <Pressable
          style={({ pressed }) => [
            styles.rowBody,
            pressed ? { backgroundColor: ROW_BG_PRESSED, opacity: 0.92 } : null,
          ]}
          onPress={() => handleSelectGuest(g)}
          accessibilityRole="button"
          accessibilityLabel={`${g.displayName}, ${
            g.source === "app" ? "on Mingla" : "RSVP'd on web"
          }. Tap for details.`}
          testID={`rsvp-row-${g.id}`}
        >
          <GuestAvatar guest={g} size={40} />
          <View style={styles.guestInfo}>
            <Text style={styles.guestName} numberOfLines={1} ellipsizeMode="tail">
              {g.displayName}
              {g.plusCount > 0 ? <Text style={styles.plusChip}>  +{g.plusCount}</Text> : null}
            </Text>
            <View style={styles.metaRow}>
              <SourceBadge source={g.source} />
              {g.email !== null || g.phone !== null ? (
                <Text style={styles.guestContact} numberOfLines={1} ellipsizeMode="tail">
                  {g.email ?? g.phone}
                </Text>
              ) : null}
            </View>
            {checkinLine(g) ? (
              <Text style={styles.checkinTruth} numberOfLines={1}>
                {checkinLine(g)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.refundTrailing}>
          {contributionByRsvp.get(g.id)?.refund ? (
            <SourceRefundStatusChip
              refund={contributionByRsvp.get(g.id)!.refund!}
            />
          ) : null}
          {trailing}
        </View>
      </View>
    ),
    [contributionByRsvp, handleSelectGuest],
  );

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
        <View style={styles.checkinFilters} accessible accessibilityLabel="Check-in filters">
          {([
            ["all", "All"],
            ["not_checked_in", "Not checked in"],
            ["checked_in", "Checked in"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: checkinFilter === value }}
              accessibilityLabel={`${label} guests`}
              onPress={() => setCheckinFilter(value)}
              style={[styles.checkinFilter, checkinFilter === value && styles.checkinFilterActive]}
              testID={`issue-1447-checkin-filter-${value}`}
            >
              <Text style={[
                styles.checkinFilterText,
                checkinFilter === value && styles.checkinFilterTextActive,
              ]}>{label}</Text>
            </Pressable>
          ))}
        </View>

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
            {pending.map((g) =>
              renderRow(
                g,
                <View style={styles.actionCol}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Approve ${g.displayName}`}
                    onPress={() => handleApprove(g)}
                    style={[styles.smallBtn, styles.approveBtn]}
                    testID={`rsvp-approve-${g.id}`}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Deny ${g.displayName}`}
                    onPress={() => handleDeny(g)}
                    style={[styles.smallBtn, styles.ghostBtn]}
                    testID={`rsvp-deny-${g.id}`}
                  >
                    <Text style={styles.ghostBtnText}>Deny</Text>
                  </Pressable>
                </View>,
              ),
            )}
          </View>
        ) : null}

        {/* Going section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Going ({going.length})</Text>
          {visibleGoing.length === 0 ? (
            <Text style={styles.emptySub}>
              {going.length === 0 ? "No one's confirmed yet." : "No guests match this check-in filter."}
            </Text>
          ) : (
            visibleGoing.map((g) =>
              renderRow(
                g,
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${g.displayName}`}
                  onPress={() => setRemoveTarget(g)}
                  style={[styles.smallBtn, styles.removeBtn]}
                  testID={`rsvp-remove-${g.id}`}
                >
                  <Text style={styles.removeBtnText}>Remove</Text>
                </Pressable>,
              ),
            )
          )}
        </View>

        {/* Maybe section (read-only) — ORCH-1150 R2 D-10 */}
        {maybe.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maybe ({maybe.length})</Text>
            {maybe.map((g) =>
              renderRow(
                g,
                <View style={styles.statusIconWrap}>
                  <Icon name="users" size={18} color={textTokens.tertiary} />
                </View>,
                `rsvp-maybe-${g.id}`,
              ),
            )}
          </View>
        ) : null}

        {/* Waitlist section (read-only) */}
        {waitlisted.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Waitlist ({waitlisted.length})</Text>
            {waitlisted.map((g) =>
              renderRow(
                g,
                <View style={styles.statusIconWrap}>
                  <Icon name="clock" size={18} color={textTokens.tertiary} />
                </View>,
              ),
            )}
          </View>
        ) : null}

        {/* Auto-mode + no pending hint */}
        {pending.length === 0 && going.length > 0 ? (
          <Text style={styles.footerHint}>
            Everyone who taps Going is in automatically.
          </Text>
        ) : null}
      </ScrollView>

      <RsvpGuestDetailSheet
        visible={selectedGuest !== null}
        guest={selectedGuest}
        onClose={() => setSelectedGuest(null)}
        onApprove={handleSheetApprove}
        onDeny={handleSheetDeny}
        onRemove={handleSheetRemove}
        isActionPending={setStatus.isPending}
        notice={sheetNotice}
        onNoticeDismiss={() => setSheetNotice(null)}
        contributionId={selectedGuest
          ? contributionByRsvp.get(selectedGuest.id)?.contributionId ?? null
          : null}
        refund={selectedGuest
          ? contributionByRsvp.get(selectedGuest.id)?.refund ?? null
          : null}
        onRefundContribution={handleRefundContribution}
        isRefundPending={refundPendingId !== null}
      />

      <ConfirmDialog
        visible={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
        title={removeTarget !== null ? `Remove ${removeTarget.displayName}?` : "Remove guest?"}
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
  checkinFilters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  checkinFilter: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.full, borderWidth: 1, borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  checkinFilterActive: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.14)" },
  checkinFilterText: { color: textTokens.secondary, fontSize: typography.caption.fontSize, fontWeight: "700" },
  checkinFilterTextActive: { color: accent.warm },
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
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: ROW_BG,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  refundTrailing: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  // ORCH-1334 — the tappable body is its OWN press target (Constitution #1: the
  // trailing action cluster is a sibling, never swallowed by the body press).
  rowBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: 44,
  },
  avatarBase: {
    marginRight: spacing.sm,
    backgroundColor: glass.tint.profileBase,
  },
  avatarInitials: { alignItems: "center", justifyContent: "center" },
  avatarInitialsText: { color: "#fff", fontWeight: "700" },
  guestInfo: { flex: 1, minWidth: 0 },
  guestName: { fontSize: typography.bodySm.fontSize, fontWeight: "600", color: textTokens.primary },
  plusChip: { fontSize: typography.caption.fontSize, fontWeight: "700", color: accent.warm },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  guestContact: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  checkinTruth: {
    marginTop: 3,
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: semantic.success,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: typography.micro.letterSpacing,
  },
  actionCol: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingRight: spacing.md },
  statusIconWrap: { paddingRight: spacing.md, paddingLeft: spacing.xs },
  smallBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
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
