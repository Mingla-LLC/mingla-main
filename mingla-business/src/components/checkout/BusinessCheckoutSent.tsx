import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  BUYER_CLAIM_COPY,
  buyerBusinessSentCopy,
} from "../../constants/buyerClaimCopy";
import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { postHogService } from "../../services/postHogService";
import { Icon } from "../ui/Icon";

export interface BusinessCheckoutSentProps {
  buyerName: string;
  onDone: () => void;
  surface: "event" | "trip" | "experience";
}

export function BusinessCheckoutSent({
  buyerName,
  onDone,
  surface,
}: BusinessCheckoutSentProps): React.ReactElement {
  const captured = useRef(false);
  const firstName = buyerName.trim().split(/\s+/)[0] ?? "";
  const copy = useMemo(
    () =>
      firstName.length > 0
        ? buyerBusinessSentCopy(firstName)
        : {
            title: "Ticket sent.",
            body: "We emailed and texted a link to the ticket.",
          },
    [firstName],
  );

  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    postHogService.capture("biz_checkout_for_someone_else_completed", {
      attached_to_caller: false,
      offering_type: surface,
    });
  }, [surface]);

  return (
    <View style={styles.host} testID="business-checkout-ticket-sent">
      <View style={styles.badge}>
        <Icon name="check" size={36} color={textTokens.primary} />
      </View>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel={BUYER_CLAIM_COPY.bizCheckout.done}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>{BUYER_CLAIM_COPY.bizCheckout.done}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
    marginTop: spacing.sm,
    maxWidth: 440,
  },
  button: {
    minHeight: 52,
    minWidth: 220,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  buttonLabel: {
    ...typography.buttonLg,
    color: "#0c0e12",
  },
});

export default BusinessCheckoutSent;
