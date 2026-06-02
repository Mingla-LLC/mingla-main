/**
 * /brand/[id]/scanners — Brand-level scanner team (ORCH-1051).
 *
 * Mirrors /event/[id]/scanners but scoped to the brand. Lists all pending +
 * past brand-scoped invitations (scope='brand') so the operator can see
 * who's already in the brand's standing scanner roster. Invitations always
 * go out with scope='brand' from this surface (event-only invites stay on
 * the per-event screen).
 *
 * Status: ACTIVE post-ORCH-1051 (META-ORCH-1048 sub-C).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import {
  useScannerInvitationsForBrand,
  useRevokeScannerInvitation,
} from "../../../src/hooks/useScannerInvitations";
import type { ScannerInvitationRow } from "../../../src/services/scannerInvitationsService";

import { EmptyState } from "../../../src/components/ui/EmptyState";
import { IconChrome } from "../../../src/components/ui/IconChrome";
import { Pill } from "../../../src/components/ui/Pill";
import { Sheet } from "../../../src/components/ui/Sheet";
import { Toast } from "../../../src/components/ui/Toast";
import { Button } from "../../../src/components/ui/Button";

import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../src/utils/permissionGates";

import { InviteScannerSheet } from "../../../src/components/scanners/InviteScannerSheet";

const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string | null | undefined): string => {
  const safe = name ?? "";
  const parts = safe.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

interface InvitationStatusPillSpec {
  variant: "info" | "warn" | "draft" | "accent";
  label: string;
}

const invitationStatusPill = (
  status: ScannerInvitationRow["status"],
): InvitationStatusPillSpec => {
  switch (status) {
    case "pending":
      return { variant: "accent", label: "PENDING" };
    case "accepted":
      return { variant: "info", label: "ACCEPTED" };
    case "revoked":
      return { variant: "draft", label: "REVOKED" };
    case "expired":
      return { variant: "draft", label: "EXPIRED" };
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

export default function BrandScannersListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  const { rank: currentRank } = useCurrentBrandRole(
    typeof brandId === "string" ? brandId : null,
  );
  const canManageScanners = canPerformAction(currentRank, "MANAGE_SCANNERS");

  const invitationsQuery = useScannerInvitationsForBrand(
    typeof brandId === "string" ? brandId : null,
  );
  const revoke = useRevokeScannerInvitation({
    brandId: typeof brandId === "string" ? brandId : null,
    eventId: null,
  });

  // Brand surface only shows brand-scoped invitations. Event-scoped invites
  // live on /event/[id]/scanners.
  const invitations = useMemo<ScannerInvitationRow[]>(() => {
    const list = invitationsQuery.data ?? [];
    return list
      .filter((row) => row.scope === "brand")
      .sort((a, b) => {
        const ta = new Date(a.created_at ?? a.expires_at).getTime();
        const tb = new Date(b.created_at ?? b.expires_at).getTime();
        return tb - ta;
      });
  }, [invitationsQuery.data]);

  const [inviteSheetOpen, setInviteSheetOpen] = useState<boolean>(false);
  const [actionSheetForId, setActionSheetForId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof brandId === "string") {
      router.replace(`/brand/${brandId}` as never);
    }
  }, [router, brandId]);

  const handleInviteSuccess = useCallback((): void => {
    setInviteSheetOpen(false);
    showToast("Invitation sent.");
  }, [showToast]);

  const handleRevoke = useCallback(
    async (id: string): Promise<void> => {
      try {
        await revoke.mutateAsync(id);
        setActionSheetForId(null);
        showToast("Invitation revoked.");
      } catch {
        showToast("Couldn't revoke. Tap to try again.");
      }
    },
    [revoke, showToast],
  );

  const activeActionInvitation = useMemo<ScannerInvitationRow | null>(() => {
    if (actionSheetForId === null) return null;
    return invitations.find((i) => i.id === actionSheetForId) ?? null;
  }, [actionSheetForId, invitations]);

  if (typeof brandId !== "string") {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Brand scanners</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Brand not found"
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  const isFetching = invitationsQuery.isLoading;

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Brand scanners</Text>
        <View style={styles.chromeRight}>
          {canManageScanners ? (
            <IconChrome
              icon="plus"
              size={36}
              onPress={() => setInviteSheetOpen(true)}
              accessibilityLabel="Invite brand scanner"
            />
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.lede}>
          <Text style={styles.ledeText}>
            Brand-wide scanners can scan tickets at every event you own — now
            and later. Add door staff who work multiple shows here.
          </Text>
        </View>

        {isFetching && invitations.length === 0 ? (
          <View style={styles.emptyHost}>
            <Text style={styles.emptyLoadingText}>Loading scanners...</Text>
          </View>
        ) : invitations.length === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="user"
              title="No brand scanners yet"
              description={
                canManageScanners
                  ? "Add scanners who work across multiple events. For one-off scanners, invite from the event's scanners screen."
                  : "Ask an event manager or above to add brand-wide scanners."
              }
              cta={
                canManageScanners
                  ? {
                      label: "Invite brand scanner",
                      onPress: () => setInviteSheetOpen(true),
                      variant: "primary",
                    }
                  : undefined
              }
            />
          </View>
        ) : (
          <View style={styles.list}>
            {invitations.map((inv) => {
              const displayName = inv.invitee_name ?? inv.email;
              const initials = getInitials(displayName);
              const hue = hashStringToHue(inv.id);
              const pill = invitationStatusPill(inv.status);
              return (
                <Pressable
                  key={inv.id}
                  onPress={() => setActionSheetForId(inv.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Brand scanner ${displayName}, ${pill.label}`}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: `hsl(${hue}, 60%, 45%)` },
                    ]}
                  >
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={styles.rowSubline} numberOfLines={1}>
                      {inv.email}
                    </Text>
                    <View style={styles.rowPills}>
                      <Pill variant={pill.variant}>{pill.label}</Pill>
                      <Pill variant="info">BRAND-WIDE</Pill>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <InviteScannerSheet
        visible={inviteSheetOpen}
        event={null}
        brandId={brandId}
        operatorAccountId={operatorAccountId}
        brandOnly
        onClose={() => setInviteSheetOpen(false)}
        onSuccess={handleInviteSuccess}
      />

      <Sheet
        visible={actionSheetForId !== null}
        onClose={() => setActionSheetForId(null)}
        snapPoint="half"
      >
        {activeActionInvitation !== null ? (
          <View style={styles.actionSheet}>
            <Text style={styles.actionTitle}>
              {activeActionInvitation.invitee_name ?? activeActionInvitation.email}
            </Text>
            <Text style={styles.actionEmail}>
              {activeActionInvitation.email}
            </Text>
            <View style={styles.actionPills}>
              <Pill
                variant={
                  invitationStatusPill(activeActionInvitation.status).variant
                }
              >
                {invitationStatusPill(activeActionInvitation.status).label}
              </Pill>
              <Pill variant="info">BRAND-WIDE</Pill>
            </View>
            <View style={styles.actionSpacer} />
            {activeActionInvitation.status === "pending" ? (
              <Button
                label={revoke.isPending ? "Revoking..." : "Revoke invitation"}
                variant="destructive"
                size="lg"
                fullWidth
                disabled={!canManageScanners || revoke.isPending}
                loading={revoke.isPending}
                onPress={() => void handleRevoke(activeActionInvitation.id)}
                accessibilityLabel="Revoke pending invitation"
              />
            ) : (
              <Text style={styles.actionDisabledNote}>
                {activeActionInvitation.status === "revoked"
                  ? "This invitation has been revoked."
                  : activeActionInvitation.status === "expired"
                  ? "This invitation expired."
                  : "This invitation has been accepted."}
              </Text>
            )}
            <View style={styles.actionSpacer} />
            <Button
              label="Close"
              variant="ghost"
              size="md"
              fullWidth
              onPress={() => setActionSheetForId(null)}
              accessibilityLabel="Close action sheet"
            />
          </View>
        ) : null}
      </Sheet>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRight: { flexDirection: "row", gap: spacing.xs },
  chromeRightSlot: { width: 36 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  lede: {
    padding: spacing.sm + 2,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.md,
  },
  ledeText: {
    fontSize: 13,
    color: textTokens.secondary,
    lineHeight: 19,
  },
  emptyHost: { paddingTop: spacing.xl },
  emptyLoadingText: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowPressed: { backgroundColor: "rgba(255, 255, 255, 0.04)" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: "600", color: textTokens.primary },
  rowSubline: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  rowPills: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
  },
  actionSheet: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  actionEmail: {
    fontSize: 13,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  actionPills: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  actionSpacer: { height: spacing.sm },
  actionDisabledNote: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontStyle: "italic",
    paddingVertical: spacing.sm,
  },
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
