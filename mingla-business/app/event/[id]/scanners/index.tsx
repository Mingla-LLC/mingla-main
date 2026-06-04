/**
 * /event/[id]/scanners — Scanner-team management screen.
 *
 * Reads scanner invitations from the canonical Postgres table via
 * `useScannerInvitationsForEvent`; revokes through the
 * `useRevokeScannerInvitation` mutation. Invitations go out via the
 * `invite-scanner` edge fn through `InviteScannerSheet`.
 *
 * Status: ACTIVE post-ORCH-1051 (META-ORCH-1048 sub-C).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import type { ScannerInvitationRow } from "../../../../src/services/scannerInvitationsService";
import { useAuth } from "../../../../src/context/AuthContext";
import { useManagedEventRoute } from "../../../../src/hooks/useManagedEventRoute";
import {
  capitalizeNoun,
  offeringKindConfig,
  offeringKindFromEventType,
} from "../../../../src/components/offering/offeringKind";
import {
  useScannerInvitationsForEvent,
  useRevokeScannerInvitation,
} from "../../../../src/hooks/useScannerInvitations";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { IconChrome } from "../../../../src/components/ui/IconChrome";
import { Pill } from "../../../../src/components/ui/Pill";
import { Sheet } from "../../../../src/components/ui/Sheet";
import { Toast } from "../../../../src/components/ui/Toast";
import { Button } from "../../../../src/components/ui/Button";

import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { canPerformAction } from "../../../../src/utils/permissionGates";

import { InviteScannerSheet } from "../../../../src/components/scanners/InviteScannerSheet";

// ---- Helpers --------------------------------------------------------

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatRelativeTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

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

// ---- Screen ---------------------------------------------------------

export default function EventScannersListRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  const routeEvent = useManagedEventRoute(
    typeof eventId === "string" ? eventId : null,
  );
  const event = routeEvent.event;
  const brand = routeEvent.brand;
  // META-ORCH-1059 — kind-aware copy lens for the shared scanners screen.
  const kindCfg = offeringKindConfig(
    offeringKindFromEventType(event?.event_type),
  );

  const { rank: currentRank } = useCurrentBrandRole(brand?.id ?? null);
  const canManageScanners = canPerformAction(currentRank, "MANAGE_SCANNERS");

  // React Query — canonical source post-ORCH-1051.
  const invitationsQuery = useScannerInvitationsForEvent(
    typeof eventId === "string" ? eventId : null,
  );
  const revoke = useRevokeScannerInvitation({
    brandId: brand?.id ?? null,
    eventId: typeof eventId === "string" ? eventId : null,
  });

  const invitations = useMemo<ScannerInvitationRow[]>(() => {
    const list = invitationsQuery.data ?? [];
    return [...list].sort(
      (a, b) => {
        const ta = new Date(a.created_at ?? a.expires_at).getTime();
        const tb = new Date(b.created_at ?? b.expires_at).getTime();
        return tb - ta;
      },
    );
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
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}` as never);
    }
  }, [router, eventId]);

  const handleInviteSuccess = useCallback(
    (details: { invitationId: string; scope: "event" | "brand" }): void => {
      setInviteSheetOpen(false);
      void details;
      showToast(
        details.scope === "brand"
          ? "Invitation sent — brand-wide scanner."
          : "Invitation sent.",
      );
    },
    [showToast],
  );

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

  useEffect(() => {
    if (routeEvent.replacementEventId !== null) {
      router.replace(`/event/${routeEvent.replacementEventId}/scanners` as never);
    }
  }, [routeEvent.replacementEventId, router]);

  if (event === null && routeEvent.isLoading && typeof eventId === "string") {
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
          <Text style={styles.chromeTitle}>Scanners</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          {/* META-ORCH-1059 — kept generic "Loading event..." on purpose: the
              row is still resolving here (event === null), so kind is unknown;
              also the locked shared-route-recovery marker. Kind-aware copy
              applies on the steady-state strings below. */}
          <Text style={styles.emptyLoadingText}>Loading event...</Text>
        </View>
      </View>
    );
  }

  if (event === null || typeof eventId !== "string") {
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
          <Text style={styles.chromeTitle}>Scanners</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title={`${capitalizeNoun(kindCfg.noun)} not found`}
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  // Hint to operator: still loading from server.
  const isFetching = invitationsQuery.isLoading;

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Scanners</Text>
        <View style={styles.chromeRight}>
          {canManageScanners ? (
            <IconChrome
              icon="plus"
              size={36}
              onPress={() => setInviteSheetOpen(true)}
              accessibilityLabel="Invite scanner"
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
        {isFetching && invitations.length === 0 ? (
          <View style={styles.emptyHost}>
            <Text style={styles.emptyLoadingText}>Loading invitations...</Text>
          </View>
        ) : invitations.length === 0 ? (
          <View style={styles.emptyHost}>
            <EmptyState
              illustration="user"
              title="No scanners invited"
              description={
                canManageScanners
                  ? "Invite door staff or backup scanners. They'll get an email with a one-tap accept link."
                  : "Ask your event manager or above to invite door staff."
              }
              cta={
                canManageScanners
                  ? {
                      label: "Invite scanner",
                      onPress: () => setInviteSheetOpen(true),
                      variant: "primary",
                    }
                  : undefined
              }
            />
          </View>
        ) : (
          <View style={styles.list}>
            {invitations.map((inv) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                onPress={() => setActionSheetForId(inv.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Invite sheet */}
      {brand !== null ? (
        <InviteScannerSheet
          visible={inviteSheetOpen}
          event={event}
          brandId={brand.id}
          operatorAccountId={operatorAccountId}
          onClose={() => setInviteSheetOpen(false)}
          onSuccess={handleInviteSuccess}
        />
      ) : null}

      {/* Action sheet for selected invitation */}
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
              {activeActionInvitation.scope === "brand" ? (
                <Pill variant="info">BRAND-WIDE</Pill>
              ) : null}
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

      {/* Toast */}
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

// ---- InvitationRow --------------------------------------------------

interface InvitationRowProps {
  invitation: ScannerInvitationRow;
  onPress: () => void;
}

const InvitationRow: React.FC<InvitationRowProps> = ({ invitation, onPress }) => {
  const displayName = invitation.invitee_name ?? invitation.email;
  const initials = getInitials(displayName);
  const hue = hashStringToHue(invitation.id);
  const subline = `${invitation.email} · invited ${formatRelativeTime(invitation.created_at ?? null)}`;
  const pill = invitationStatusPill(invitation.status);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Scanner ${displayName}, ${pill.label}`}
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
          {subline}
        </Text>
        <View style={styles.rowPills}>
          <Pill variant={pill.variant}>{pill.label}</Pill>
          {invitation.scope === "brand" ? (
            <Pill variant="info">BRAND-WIDE</Pill>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

// ---- Styles ---------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
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
  chromeRight: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  emptyHost: {
    paddingTop: spacing.xl,
  },
  emptyLoadingText: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
  },
  list: {
    gap: spacing.sm,
  },
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
  rowPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
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
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
  },
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
  permPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radiusTokens.sm,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  permPillText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.0,
    color: accent.warm,
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
  actionPills: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  actionSpacer: {
    height: spacing.sm,
  },
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
