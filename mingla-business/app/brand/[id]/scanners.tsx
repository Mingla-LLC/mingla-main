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
  color,
  radius,
  space,
} from "../../../src/constants/designSystem";
import { useAuth } from "../../../src/context/AuthContext";
import { SignedInNotFoundNotice } from "../../../src/components/auth/SignedInNotFoundNotice";
// #3259 — names the signed-in account on the settled-null brand branch below.
import { useSwitchAccount } from "../../../src/hooks/useSwitchAccount";
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
import { Avatar } from "../../../src/components/ui/Avatar";
import { Button } from "../../../src/components/ui/Button";

import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { useBrand } from "../../../src/hooks/useBrands";
import { canPerformAction } from "../../../src/utils/permissionGates";

import { LazyInviteScannerSheet } from "../../../src/components/scanners/LazyInviteScannerSheet";

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
  const { signedInEmail, onSwitchAccount } = useSwitchAccount();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  const brandQuery = useBrand(typeof brandId === "string" ? brandId : null);
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
          { paddingTop: insets.top, backgroundColor: color.canvas },
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
            // #3259 P2-3 — the host's own hedge is for a reader we know
            // NOTHING about. When the notice renders it says this and names the
            // account, so showing both states one cause and then a different
            // set of causes a line apart. Signed-out keeps it verbatim.
            description={
              signedInEmail === null ? "It may have been deleted." : undefined
            }
          />
          {/*
            #3259 — a signed-in reader gets the account named and a way out. The
            client CANNOT tell a deleted row from an RLS-filtered one
            (`.maybeSingle()` returns `{data: null, error: null}` for both), so
            the copy states both possibilities and asserts neither.
          */}
          <SignedInNotFoundNotice
            variant="restricted"
            signedInEmail={signedInEmail}
            onSwitchAccount={onSwitchAccount}
            testID="brand-scanners-not-found-signed-in-notice"
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
        { paddingTop: insets.top, backgroundColor: color.canvas },
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
              const pill = invitationStatusPill(inv.status);
              return (
                <Pressable
                  key={inv.id}
                  onPress={() => setActionSheetForId(inv.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Brand scanner ${displayName}, ${pill.label}`}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Avatar name={displayName} size="row" />
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

      <LazyInviteScannerSheet
        visible={inviteSheetOpen}
        event={null}
        brandId={brandId}
        paymentProvider={brandQuery.data?.paymentProvider ?? null}
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
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[2],
    gap: space[2],
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: color.text1,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRight: { flexDirection: "row", gap: space[1] },
  chromeRightSlot: { width: 36 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  lede: {
    padding: space[2] + 2,
    borderRadius: radius.sm,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[4],
  },
  ledeText: {
    fontSize: 13,
    color: color.text2,
    lineHeight: 19,
  },
  emptyHost: { paddingTop: space[7] },
  emptyLoadingText: {
    fontSize: 14,
    color: color.text2,
    textAlign: "center",
  },
  list: { gap: space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2] + 2,
    padding: space[4] - 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  rowPressed: { backgroundColor: color.fill.inset },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: "600", color: color.text1 },
  rowSubline: {
    fontSize: 12,
    color: color.text3,
    marginTop: 2,
  },
  rowPills: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
  },
  actionSheet: {
    paddingHorizontal: space[6],
    paddingTop: space[4],
    paddingBottom: space[7],
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  actionEmail: {
    fontSize: 13,
    color: color.text2,
    marginBottom: space[2],
  },
  actionPills: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  actionSpacer: { height: space[2] },
  actionDisabledNote: {
    fontSize: 13,
    color: color.text3,
    fontStyle: "italic",
    paddingVertical: space[2],
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
