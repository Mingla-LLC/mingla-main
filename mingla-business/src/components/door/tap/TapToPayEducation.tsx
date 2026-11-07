/**
 * #4271 — how to take a tap, findable any time from Settings. Text only: on iOS 18
 * and later Apple's own How to Tap is one button away; every version gets the rows.
 * Door polish: the rows are one grouped list (TapFactList), not a card each.
 */
import React, { useCallback, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { semantic, spacing, typography } from "../../../constants/designSystem";
import { TAP_HOW_TO_TAP_BUTTON, TAP_HOW_TO_TAP_FAILED, tapEducationRows } from "../../../constants/tapToPayCopy";
import { showHowToTapEducation } from "../../../services/terminal/howToTap";
import { Button } from "../../ui/Button";
import { TapFactList } from "./TapFactList";

export interface TapToPayEducationProps {
  /** GB brands: Apple asks for PIN guidance by region. */
  pinRow: boolean;
}

const iosMajor = (): number =>
  Platform.OS === "ios" ? Number.parseInt(String(Platform.Version).split(".")[0] ?? "", 10) || 0 : 0;

export const TapToPayEducation = ({ pinRow }: TapToPayEducationProps): React.ReactElement => {
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState<boolean>(false);
  const showHowToTap = useCallback(async (): Promise<void> => {
    setError(null);
    setShowing(true);
    try {
      await showHowToTapEducation();
    } catch {
      setError(TAP_HOW_TO_TAP_FAILED);
    } finally {
      setShowing(false);
    }
  }, []);
  return (
    <View style={styles.host} testID="tap-education">
      {iosMajor() >= 18 ? (
        <Button
          label={TAP_HOW_TO_TAP_BUTTON}
          onPress={() => void showHowToTap()}
          loading={showing}
          variant="secondary"
          size="md"
          fullWidth
          accessibilityLabel={TAP_HOW_TO_TAP_BUTTON}
          testID="tap-show-how-to-tap"
        />
      ) : null}
      {error !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <TapFactList facts={tapEducationRows(Platform.OS, { pinRow })} testID="tap-education-facts" />
    </View>
  );
};

const styles = StyleSheet.create({
  host: { gap: spacing.sm },
  error: { ...typography.bodySm, color: semantic.errorText, textAlign: "center" },
});
