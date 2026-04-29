/**
 * EmptyState — helpful "nothing here yet" panel for any list / surface
 * that has no rows to show.
 *
 * Composition: optional illustration (Icon name OR custom node) + h3
 * title + bodySm description + optional CTA `Button`.
 *
 * Mingla domain rule (I-5): default copy must use organiser language.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Button } from "./Button";
import type { ButtonVariant } from "./Button";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface EmptyStateCta {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: ButtonVariant;
}

export interface EmptyStateProps {
  /** Either an icon name (renders 48px) or a custom React node. */
  illustration?: IconName | React.ReactNode;
  title: string;
  description?: string;
  cta?: EmptyStateCta;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const ILLUSTRATION_SIZE = 48;

const isIconName = (value: IconName | React.ReactNode): value is IconName =>
  typeof value === "string";

export const EmptyState: React.FC<EmptyStateProps> = ({
  illustration,
  title,
  description,
  cta,
  testID,
  style,
}) => {
  return (
    <View testID={testID} style={[styles.container, style]}>
      {illustration !== undefined ? (
        <View style={styles.illustration}>
          {isIconName(illustration) ? (
            <Icon
              name={illustration}
              size={ILLUSTRATION_SIZE}
              color={textTokens.quaternary}
            />
          ) : (
            illustration
          )}
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {description !== undefined ? (
        <Text style={styles.description}>{description}</Text>
      ) : null}
      {cta !== undefined ? (
        <View style={styles.ctaWrap}>
          <Button
            label={cta.label}
            onPress={cta.onPress}
            variant={cta.variant ?? "primary"}
            size="md"
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  illustration: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  description: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.bodySm.fontWeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  ctaWrap: {
    marginTop: spacing.lg - spacing.xs,
  },
});

export default EmptyState;
