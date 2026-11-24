/**
 * BlastCustomersCta — the sticky "Send blast (N)" bar under a Blasts list
 * (ORCH-0815-A2-ui; #4420 Graphite Glass).
 *
 * Used by:
 *   - Brand Blasts tab
 *   - Event Blasts tab
 *   - Audience detail
 *
 * #4420: a chrome bar (`<Material kind="chrome">`, the one glass owner, so
 * Android and phone web get the solid chrome fill) holding the one Paper
 * primary button of the view. The old inline BlurView, the hand-rolled orange
 * capsule and its per-file opaque fallback are gone.
 *
 * Safe-area awareness: the bar adds the bottom inset to its own padding so the
 * button never sits in the home-indicator zone. Callers mount it absolutely at
 * `bottom: 0`.
 *
 * Disabled when reachableCount === 0 OR the `disabled` prop is true.
 *
 * #4596: an optional one-line caption under the button says why it is off
 * (the only layout addition Seth accepted on #4596 A2).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, space, type } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Material } from "../ui/Material";

export type BlastAudienceKind = "brand" | "event" | "audience";

export interface BlastCustomersCtaProps {
  audienceKind: BlastAudienceKind;
  audienceTargetId: string;
  reachableCount: number;
  /** Disabled when reachableCount = 0 or caller lacks event_manager rank. */
  disabled?: boolean;
  onPress?: (audienceKind: BlastAudienceKind, audienceTargetId: string) => void;
  testID?: string;
  /** #4596 — one line under the button, e.g. why it is disabled. */
  caption?: string | null;
}

export const BlastCustomersCta: React.FC<BlastCustomersCtaProps> = ({
  audienceKind,
  audienceTargetId,
  reachableCount,
  disabled,
  onPress,
  testID,
  caption,
}) => {
  const insets = useSafeAreaInsets();
  const isDisabled = disabled === true || reachableCount === 0;
  const label = `Send blast (${reachableCount})`;

  const handlePress = (): void => {
    if (isDisabled) return;
    if (onPress !== undefined) onPress(audienceKind, audienceTargetId);
  };

  return (
    <Material
      kind="chrome"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[4]) }]}
      pointerEvents="box-none"
    >
      <View style={styles.row}>
        <Button
          label={label}
          onPress={handlePress}
          variant="primary"
          size="lg"
          leadingIcon="send"
          disabled={isDisabled}
          fullWidth
          accessibilityLabel={label}
          testID={testID}
        />
        {caption !== undefined && caption !== null && caption.length > 0 ? (
          <Text style={styles.caption} testID={testID === undefined ? undefined : `${testID}-caption`}>
            {caption}
          </Text>
        ) : null}
      </View>
    </Material>
  );
};

const styles = StyleSheet.create({
  bar: {
    width: "100%",
    paddingHorizontal: space[4],
    paddingTop: space[3],
  },
  row: {
    width: "100%",
  },
  caption: {
    ...type.small,
    color: color.text2,
    textAlign: "center",
    marginTop: space[2],
  },
});
