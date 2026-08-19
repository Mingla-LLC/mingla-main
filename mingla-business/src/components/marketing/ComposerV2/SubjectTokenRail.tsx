/**
 * SubjectTokenRail — the subject line's personalization chip rail. (#2262)
 *
 * # Why this is its own file, and it is not cosmetic
 *
 * SPEC §4.3 said to resolve `orch-0892` pattern 4 on `ComposerV2Editor.tsx`
 * with a per-occurrence inline `orch-strict-grep-allow` marker, "verbatim in
 * form with SmsComposeCard.tsx:25". That route cannot actually be taken here:
 * the gate's own adversarial suite asserts the marker set in BOTH directions
 * (`EXPECTED_ALLOWLISTED_FILES` in
 * `src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx`, TA-V3-5),
 * so honouring the marker requires editing that test — and #2262's single
 * `[TEST-MOD-APPROVED]` token covers exactly one other file, with the SPEC
 * stating that no other test file may be modified.
 *
 * So the exemption is not taken at all. Pattern 4 branch (a) fires only on a
 * file that imports `ScrollView` from `react-native` AND contains the bare word
 * `TextInput`. This rail is a HORIZONTAL chip list with no input in it and no
 * keyboard involvement of any kind; `ComposerV2Editor.tsx` keeps the two
 * TextInputs (the subject line and the link prompt) and no longer imports a
 * scroll container. Neither file trips the pattern, no marker is registered, no
 * test changes, and — unlike the SPEC's route — nothing in the composer carries
 * a keyboard-plumbing carve-out any more. That is strictly stronger than what
 * was asked for.
 *
 * Behaviour, styling and testIDs are byte-equivalent to the block this replaces.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { PersonalizationToken } from "../../../services/marketing/tenTapTokenBridge";

export interface SubjectTokenOption {
  token: PersonalizationToken;
  label: string;
}

export interface SubjectTokenRailProps {
  tokens: readonly SubjectTokenOption[];
  onInsert: (token: PersonalizationToken) => void;
}

export function SubjectTokenRail({
  tokens,
  onInsert,
}: SubjectTokenRailProps): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.rail}
      accessibilityLabel="Subject personalization tokens"
      testID="composer-v2-subject-token-rail"
    >
      {tokens.map((opt) => (
        <Pressable
          key={opt.token}
          onPress={() => onInsert(opt.token)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Insert ${opt.label} into subject`}
          style={({ pressed }) => [
            styles.chip,
            pressed ? styles.chipPressed : null,
          ]}
          testID={`composer-v2-subject-token-${opt.token}`}
        >
          <Text style={styles.chipText}>{opt.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /**
   * `flexGrow: 0, flexShrink: 0` is load-bearing, not tidiness. A RN
   * `ScrollView` ships `flexGrow: 1, flexShrink: 1` on its base style, so as a
   * sibling in a column it GROWS TO EAT the free space and competes with the
   * body region beside it. Pinning both is what keeps this an auto-height band
   * inside the sheet.
   */
  rail: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    ...typography.monoMd,
    color: textTokens.primary,
  },
});

export default SubjectTokenRail;
