/**
 * #4111 Wave D (D6) — "Message {Brand}" under a Likes → Calendar plan item
 * (ticket order, RSVP, reservation, stay). Opens the shared sheet with that
 * plan already picked (entry 'calendar').
 *
 * Nothing is fetched until the tap: then the brand's public identity (name +
 * theme) and whether it takes messages. While that resolves the button shows
 * a spinner; a brand that is not taking messages, or a failed read, says so
 * in a toast — never a dead tap.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
// DEEP specifier: suites mock the offering barrel.
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

import { useBrandEnquiryProfile, useBrandIdentity } from "../../hooks/useBrandEnquiries";
import { toastManager } from "../ui/Toast";
import { Icon } from "../ui/Icon";
import type { CalendarPlanMessageTarget } from "./calendarPlanMessage";
import { ENQUIRY_ACCENT } from "./EnquiryTag";
import { useExplorerBrandMessage } from "./useExplorerBrandMessage";

export function CalendarPlanMessageButton({
  target,
  onCancelReservation,
  testID,
}: {
  target: CalendarPlanMessageTarget;
  onCancelReservation?: (reservationId: string) => void;
  testID?: string;
}): React.ReactElement {
  const { t } = useTranslation("enquiry");
  const [armed, setArmed] = useState(false);
  const identity = useBrandIdentity({ brandId: target.brandId, brandSlug: target.brandSlug }, armed);
  const brand = useMemo(
    () =>
      identity.data === null || identity.data === undefined
        ? null
        : {
            id: identity.data.id,
            name: identity.data.name,
            slug: identity.data.slug,
            theme: resolveTheme(identity.data.theme, null),
          },
    [identity.data],
  );
  const profile = useBrandEnquiryProfile(armed ? brand?.id ?? null : null);
  const message = useExplorerBrandMessage({ brand, entry: "calendar", onCancelReservation });
  const brandName = brand?.name ?? target.brandName;

  // Tap → (identity → profile) → open once.
  const { open, available } = message;
  useEffect(() => {
    if (!armed) return;
    if (identity.isError || (identity.isSuccess && identity.data === null) || profile.isError) {
      setArmed(false);
      toastManager.show(t("enquiry:open_failed", { brand: brandName }), "error");
      return;
    }
    if (!profile.isSuccess) return;
    setArmed(false);
    if (!available) {
      toastManager.show(t("enquiry:unavailable", { brand: brandName }), "info");
      return;
    }
    open(target.prefill);
  }, [armed, available, brandName, identity.data, identity.isError, identity.isSuccess, open, profile.isError, profile.isSuccess, t, target.prefill]);

  const label = t("enquiry:message_brand", { brand: target.brandName });
  return (
    <>
      <Pressable
        onPress={() => setArmed(true)}
        disabled={armed}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: armed, disabled: armed }}
        hitSlop={6}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        testID={testID ?? `calendar-message-${target.prefill.contextKind}-${target.prefill.contextId}`}
      >
        {armed ? (
          <ActivityIndicator size="small" color={ENQUIRY_ACCENT} />
        ) : (
          <Icon name="chatbubble-outline" size={14} color={ENQUIRY_ACCENT} />
        )}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {message.overlays}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    maxWidth: "92%",
    marginLeft: 16,
    marginTop: -2,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.45)",
    backgroundColor: "rgba(235,120,37,0.10)",
  },
  pressed: { opacity: 0.8 },
  label: { flexShrink: 1, color: "#fdba74", fontSize: 13, fontWeight: "700" },
});
