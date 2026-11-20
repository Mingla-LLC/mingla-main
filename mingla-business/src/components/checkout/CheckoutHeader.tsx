/**
 * CheckoutHeader — shared header for every checkout step (event, experience,
 * trip): back, the step's title, and where the guest is in the flow.
 *
 * #4420 (§4.1) — the header wears the host's colours (checkoutTheme) as a
 * glass band over the page with a hairline under it:
 *   phone   [back]  Title                 [2 of 3]
 *           ▬▬▬▬▬▬ ▬▬▬▬▬▬ ──────  (segmented step bar, done + current filled)
 *   desktop [back]  Title       (✓) Tickets  (2) Details  ( 3 ) Payment
 * The step count stays spoken as "Step 2 of 3" on both.
 *
 * Per Cycle 8 spec §4.11; restyled by #4420.
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { glassBarFill } from "@mingla/offering-rendering/OfferingGlassBar";

import { radius, space } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { activeCheckoutPalette, checkoutStyles, color } from "./checkoutTheme";
import { BUYER_CONNECTION_COPY } from "../buyer/buyerConnectionCopy";

/** #4518 P3 — the Pay-step connection message leads with its cause, semibold. */
const CONNECTION_LEAD = `${BUYER_CONNECTION_COPY.CONNECTION_TITLE}.`;

export interface CheckoutHeaderProps {
  /**
   * 0-indexed step. Event-side: 0=Tickets, 1=Buyer, 2=Payment. ORCH-1178 trip
   * funnel ALWAYS shows the cart step (index=0) so the trip sequence is
   * index(0) → buyer(1) → [intake] → payment(2 without intake, 3 with intake);
   * the intake step itself renders its own inline "3 OF N" header.
   */
  stepIndex: 0 | 1 | 2 | 3;
  /**
   * Total visible steps. Event checkouts are 3. ORCH-1178 trips ALWAYS keep the
   * cart/quantity step, so the trip funnel is 3 (no intake) or 4 (intake
   * present). (Legacy 2 retained for source-compat; the trip funnel no longer
   * collapses to 2 — ORCH-1178 supersedes the ORCH-1130 single-tier auto-skip.)
   */
  totalSteps: 2 | 3 | 4;
  title: string;
  onBack: () => void;
  /**
   * #4420 — the desktop step names, one per step. Absent: the event names
   * for 3 steps ("Tickets · Details · Payment"), the trip names for 4.
   */
  stepNames?: readonly string[];
}

const DEFAULT_STEP_NAMES: Record<2 | 3 | 4, readonly string[]> = {
  2: ["Details", "Payment"],
  3: ["Tickets", "Details", "Payment"],
  4: ["Tier", "Details", "Questions", "Review & pay"],
};

/** "done" before the current step, "current", then "next". Pure. */
export type CheckoutStepState = "done" | "current" | "next";
export function checkoutStepStates(
  stepIndex: number,
  totalSteps: number,
): CheckoutStepState[] {
  return Array.from({ length: totalSteps }, (_, i) =>
    i < stepIndex ? "done" : i === stepIndex ? "current" : "next",
  );
}

export const CheckoutHeader: React.FC<CheckoutHeaderProps> = ({
  stepIndex,
  totalSteps,
  title,
  onBack,
  stepNames,
}) => {
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
  const palette = activeCheckoutPalette();
  const states = checkoutStepStates(stepIndex, totalSteps);
  const names =
    stepNames !== undefined && stepNames.length === totalSteps
      ? stepNames
      : DEFAULT_STEP_NAMES[totalSteps];
  const band =
    palette === null
      ? color.canvas
      : glassBarFill(palette, { blurred: Platform.OS === "web", desktopWeb: isWideDesktop });
  const stepLabel = `Step ${stepIndex + 1} of ${totalSteps}`;
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top + space[2], backgroundColor: band },
      ]}
    >
      <View style={styles.row}>
        <IconChrome
          icon="arrowL"
          size={40}
          onPress={onBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {isWideDesktop ? (
          <View
            style={styles.namedSteps}
            accessible
            accessibilityLabel={stepLabel}
            testID="checkout-step-names"
          >
            {names.map((name, i) => {
              const state = states[i] ?? "next";
              return (
                <View key={name} style={styles.namedStep}>
                  <View
                    style={[
                      styles.disc,
                      state === "done"
                        ? styles.discDone
                        : state === "current"
                          ? styles.discCurrent
                          : styles.discNext,
                    ]}
                  >
                    {state === "done" ? (
                      <Icon name="check" size={13} color={color.text1} />
                    ) : (
                      <Text
                        style={[
                          styles.discNumber,
                          state === "current" ? styles.discNumberCurrent : null,
                        ]}
                      >
                        {i + 1}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.stepName,
                      state === "next" ? styles.stepNameNext : null,
                    ]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.countPill} accessible accessibilityLabel={stepLabel}>
            <Text style={styles.countText}>
              {stepIndex + 1} of {totalSteps}
            </Text>
          </View>
        )}
      </View>
      {isWideDesktop ? null : (
        <View
          style={styles.segments}
          testID="checkout-step-bar"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {states.map((state, i) => (
            <View
              key={i}
              testID={`checkout-step-segment-${state}`}
              style={[
                styles.segment,
                state === "next" ? styles.segmentNext : styles.segmentOn,
              ]}
            />
          ))}
        </View>
      )}
      <View style={styles.divider} />
    </View>
  );
};

/**
 * #4420 §4.2 — a checkout step's status banner ("Payment not completed",
 * "Your total changed"): an alert, in the host's status colours, with the
 * step's own message as the body (copy unchanged; the banner only frames it).
 */
export const CheckoutStatusBanner: React.FC<{
  tone: "error" | "warning";
  title: string;
  body: string;
  testID?: string;
}> = ({ tone, title, body, testID }) => (
  <View
    accessibilityRole="alert"
    accessibilityLiveRegion="assertive"
    style={[styles.banner, tone === "error" ? styles.bannerError : styles.bannerWarning]}
    testID={testID ?? `checkout-status-banner-${tone}`}
  >
    <Text
      style={[styles.bannerTitle, tone === "error" ? styles.bannerTitleError : styles.bannerTitleWarning]}
    >
      {title}
    </Text>
    <Text style={styles.bannerBody}>
      {body === BUYER_CONNECTION_COPY.PAYMENT_CONNECTION_ERROR ? (
        <>
          <Text style={styles.bannerLead}>{CONNECTION_LEAD}</Text>
          {body.slice(CONNECTION_LEAD.length)}
        </>
      ) : (
        body
      )}
    </Text>
  </View>
);

const styles = checkoutStyles(() => StyleSheet.create({
  host: {
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    ...(Platform.OS === "web"
      ? {
          position: "sticky" as unknown as "absolute",
          top: 0,
          zIndex: 10,
        }
      : null),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: color.text1,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  countPill: {
    minWidth: 56,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
  },
  countText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: color.text2,
    fontVariant: ["tabular-nums"],
  },
  segments: {
    flexDirection: "row",
    gap: 6,
    marginTop: space[2],
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  segmentOn: { backgroundColor: color.accent },
  segmentNext: { backgroundColor: color.line },
  namedSteps: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
  },
  namedStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  disc: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  discDone: { backgroundColor: color.accentTint },
  discCurrent: { backgroundColor: color.accent },
  discNext: { borderWidth: 1.5, borderColor: color.lineStrong },
  discNumber: { fontSize: 12, fontWeight: "700", color: color.text2 },
  discNumberCurrent: { color: color.onAccent },
  stepName: { fontSize: 13.5, fontWeight: "700", color: color.text1 },
  stepNameNext: { color: color.text3 },
  divider: {
    marginTop: space[2],
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
  },
  banner: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space[4],
    gap: 4,
  },
  bannerError: { backgroundColor: color.errorTint, borderColor: color.errorLine },
  bannerWarning: { backgroundColor: color.warningTint, borderColor: color.warning },
  bannerTitle: { fontSize: 15, fontWeight: "700" },
  bannerTitleError: { color: color.errorText },
  bannerTitleWarning: { color: color.warningText },
  bannerBody: { fontSize: 13.5, lineHeight: 19, color: color.text2 },
  bannerLead: { fontWeight: "600" },
}));

export default CheckoutHeader;
