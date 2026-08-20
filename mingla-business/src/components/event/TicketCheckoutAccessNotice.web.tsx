import React from "react";
import { usePathname, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { semantic, spacing, text as textTokens, typography } from "../../constants/designSystem";
import { usePublicTicketCheckoutEligibility } from "../../hooks/useEventTicketCheckoutAccess";
import { Button } from "../ui/Button";

export interface TicketCheckoutAccessNoticeProps {
  eventId: string;
}

export const TicketCheckoutAccessNotice: React.FC<
  TicketCheckoutAccessNoticeProps
> = ({ eventId }) => {
  const query = usePublicTicketCheckoutEligibility(eventId);
  const router = useRouter();
  const pathname = usePathname();
  if (query.isLoading) {
    return <View style={styles.notice}><ActivityIndicator /><Text style={styles.copy}>Checking checkout access…</Text></View>;
  }
  if (query.isError) {
    return (
      <View style={styles.notice} accessibilityRole="alert">
        <Text style={styles.error}>Checkout access couldn't be checked.</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={() => void query.refetch()} />
      </View>
    );
  }
  const state = query.data?.state ?? "unrestricted";
  if (state === "unrestricted" || state === "allowed") return null;
  if (state === "sign_in_required") {
    return (
      <View style={styles.notice} accessibilityRole="alert" testID="ticket-access-sign-in-required">
        <Text style={styles.title}>Restricted sale</Text>
        <Text style={styles.copy}>Sign in with an approved Mingla account to continue.</Text>
        <Button
          label="Sign in"
          size="sm"
          onPress={() => router.push(`/auth?next=${encodeURIComponent(pathname)}` as never)}
          accessibilityLabel="Sign in with an approved Mingla account"
        />
      </View>
    );
  }
  return (
    <View style={styles.notice} accessibilityRole="alert" testID="ticket-access-restricted">
      <Text style={styles.title}>Restricted sale</Text>
      <Text style={styles.copy}>This checkout is limited to approved Mingla accounts.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  notice: { gap: spacing.sm, padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: "rgba(235,120,37,0.45)", backgroundColor: "rgba(235,120,37,0.10)" },
  title: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  copy: { ...typography.bodySm, color: textTokens.secondary },
  error: { ...typography.bodySm, color: semantic.error },
});

export default TicketCheckoutAccessNotice;
