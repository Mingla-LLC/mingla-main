/**
 * #3660 — in-app Accept/Decline for a pending brand invitation.
 *
 * Opened from the Home/Hub smart to-do via `open_pending_invite` → route here.
 * Tokenless: the edge fn trusts the signed-in email against the invitation row.
 * The email deep-link path (`/accept-brand-invitation?token=`) stays separate.
 *
 * Brand name is resolved from `useMyPendingInvites` (server truth), never from
 * the URL query string — a shared link must not spoof which brand is offered.
 */

import React, { useCallback, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvitePendingSheet } from "../src/components/team/InvitePendingSheet";
import { TopBar } from "../src/components/ui/TopBar";
import { accent, canvas, spacing, text as textTokens } from "../src/constants/designSystem";
import { useAuth } from "../src/context/AuthContext";
import { useMyPendingInvites } from "../src/hooks/useBrandInvitations";

function firstParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default function PendingBrandInviteRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const params = useLocalSearchParams<{
    invitationId?: string | string[];
  }>();

  const invitationId = useMemo(
    () => firstParam(params.invitationId).trim(),
    [params.invitationId],
  );

  const pendingQuery = useMyPendingInvites(userId, userId !== null && invitationId.length > 0);
  const matchedInvite = useMemo(() => {
    if (!invitationId || !pendingQuery.data) return null;
    return pendingQuery.data.find((row) => row.id === invitationId) ?? null;
  }, [invitationId, pendingQuery.data]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router]);

  const showLoading =
    invitationId.length > 0 &&
    userId !== null &&
    (pendingQuery.isPending || pendingQuery.isFetching) &&
    matchedInvite === null;

  return (
    <View
      style={[styles.host, { paddingTop: insets.top }]}
      testID="pending-brand-invite-route"
    >
      <TopBar leftKind="back" title="Invitation" onBack={handleClose} />
      {invitationId.length === 0 ? (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Invitation not found</Text>
          <Text style={styles.missingBody}>
            This invite link is missing its id. Open the pending invitation
            from your Home to-do list.
          </Text>
        </View>
      ) : userId === null ? (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Sign in to continue</Text>
          <Text style={styles.missingBody}>
            Sign in with the email that received this invitation, then open it
            from your Home to-do list.
          </Text>
        </View>
      ) : showLoading ? (
        <View style={styles.loading} testID="pending-brand-invite-loading">
          <ActivityIndicator color={accent.warm} />
        </View>
      ) : matchedInvite === null ? (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Invitation not found</Text>
          <Text style={styles.missingBody}>
            This invite is not pending for your account. It may have already
            been accepted or declined.
          </Text>
        </View>
      ) : (
        <InvitePendingSheet
          visible
          invitationId={matchedInvite.id}
          brandName={matchedInvite.brand_name}
          onClose={handleClose}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
    paddingBottom: spacing.md,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.xl,
  },
  missing: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  missingTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  missingBody: {
    fontSize: 15,
    color: textTokens.secondary,
    lineHeight: 22,
  },
});
