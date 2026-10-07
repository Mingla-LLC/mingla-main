/**
 * #3660 — in-app Accept/Decline for a pending brand invitation.
 *
 * Opened from the Home/Hub smart to-do via `open_pending_invite` → route here.
 * Tokenless: the edge fn trusts the signed-in email against the invitation row.
 * The email deep-link path (`/accept-brand-invitation?token=`) stays separate.
 */

import React, { useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvitePendingSheet } from "../src/components/team/InvitePendingSheet";
import { TopBar } from "../src/components/ui/TopBar";
import { canvas, spacing, text as textTokens } from "../src/constants/designSystem";

function firstParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default function PendingBrandInviteRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    invitationId?: string | string[];
    brandName?: string | string[];
  }>();

  const invitationId = useMemo(
    () => firstParam(params.invitationId).trim(),
    [params.invitationId],
  );
  const brandName = useMemo(() => {
    const raw = firstParam(params.brandName).trim();
    return raw.length > 0 ? raw : "this brand";
  }, [params.brandName]);

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/home" as never);
  }, [router]);

  return (
    <View
      style={[styles.host, { paddingTop: insets.top }]}
      testID="pending-brand-invite-route"
    >
      <TopBar leftKind="back" title="Invitation" onBack={handleClose} />
      {invitationId.length > 0 ? (
        <InvitePendingSheet
          visible
          invitationId={invitationId}
          brandName={brandName}
          onClose={handleClose}
        />
      ) : (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Invitation not found</Text>
          <Text style={styles.missingBody}>
            This invite link is missing its id. Open the pending invitation
            from your Home to-do list.
          </Text>
        </View>
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
