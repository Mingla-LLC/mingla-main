/**
 * #1532 [stay-manager-ux] — the Stay manager's horizontal chip / tab row.
 *
 * DEFECT 4, AND WHY THIS IS ITS OWN FILE.
 *
 * Every horizontal scroller in the Stay manager used the `SmartScrollView`
 * wrapper, because `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` requires it in
 * any file that also holds a text field. On native that wrapper IS
 * `KeyboardAwareScrollView`, which appends a spacer sibling after its children
 * whose padding animates to the KEYBOARD HEIGHT
 * (`react-native-keyboard-controller/.../KeyboardAwareScrollView/index.tsx:415`).
 *
 * In a VERTICAL scroller that spacer is bottom padding — correct, that is the
 * whole point of the wrapper. In a HORIZONTAL one it is a ROW ITEM, so
 * `paddingBottom: ~324` made it 324pt TALL; and because the content container
 * declared no cross-axis alignment, RN's default `stretch` dragged every chip
 * up to match it. Measured on an iPhone 17 Pro Max: the active module pill went
 * 36.7pt -> 323.7pt on a single keystroke, an 8.8x inflation that squeezed the
 * whole workspace to ~0pt. The field being typed into and the Save button were
 * both off screen.
 *
 * THE GATE NEEDS NO AMENDMENT, AND THIS FILE IS THE PROOF.
 * `orch-0892-no-bespoke-keyboard-plumbing.mjs:146-148` is FILE-scoped: it fires
 * only when a file holds BOTH a bare `react-native` `ScrollView` import AND a
 * text-input element. This file holds ZERO text inputs — it is chrome, it
 * renders whatever chips its caller passes — so the bare import is legal
 * exactly as the gate is written today. No allowlist entry, no inline
 * exemption, no invariant change. `VenueModulePillRow.tsx:17` already ships
 * this exact shape, which is precisely why the restaurant suite never had this
 * bug and the Stay suite did.
 *
 * `alignItems: "center"` on the content container is LOAD-BEARING. It is the
 * second half of the fix: even with the spacer gone, RN's default `stretch`
 * means any one tall child re-inflates the whole row. Centre-aligning makes a
 * chip's height its OWN business.
 *
 * `keyboardShouldPersistTaps="handled"` is the third: without it the FIRST tap
 * on a chip while a keyboard is open only dismisses the keyboard, and the
 * operator has to tap twice. That is a Constitution #1 dead tap, and it was
 * missing from every Stay scroller.
 */

import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { spacing } from "../../constants/designSystem";

export interface StayChipRowProps {
  children: React.ReactNode;
  /** Host style — outer band padding/borders. NEVER a cross-axis rule. */
  style?: StyleProp<ViewStyle>;
  /**
   * Extra CONTENT-container style. Merged AFTER the base, so a caller may add
   * padding or change the gap — but `alignItems` is deliberately re-applied
   * below the merge so no caller can accidentally restore `stretch` and bring
   * the inflation back.
   */
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityRole?: "tablist";
  testID?: string;
}

export function StayChipRow({
  children,
  style,
  contentStyle,
  accessibilityRole,
  testID,
}: StayChipRowProps): React.ReactElement {
  return (
    <View style={style} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityRole={accessibilityRole}
        contentContainerStyle={[styles.content, contentStyle, styles.crossAxis]}
        testID={testID !== undefined ? `${testID}-scroll` : undefined}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // ROW-ONLY (I-AXIS-SCOPED-FLEX): this object declares its own
  // `flexDirection`, so every other key in it is read against that one axis and
  // can never resolve against a column.
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  /**
   * Applied LAST, after any caller override. `alignItems: "center"` is the
   * anti-inflation rule; letting a caller merge it away would re-open the exact
   * defect this component exists to close.
   */
  crossAxis: { alignItems: "center" },
});

export default StayChipRow;
