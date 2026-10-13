/**
 * issue #3237 — the "Published. It's live." banner.
 *
 * Shown once at the top of an item's manage screen straight after the host
 * publishes it (event, RSVP, trip or experience). It confirms the publish and
 * puts the two next steps in reach.
 *
 * This component owns NO share or navigation logic. The manage screen passes
 * its own existing handlers, so "Share" opens the same share sheet as the
 * screen's Share control and "View public page" goes where the screen's Public
 * page control goes. A handler that is not passed hides its button — a private
 * RSVP has no public page, so it gets the confirmation and nothing that would
 * open "not found".
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import {
  PUBLISHED_BANNER_TITLE,
  publishedBannerSupportingLine,
  type PublishedBannerKind,
} from "./publishedBannerCopy";

export interface PublishedBannerProps {
  kind: PublishedBannerKind;
  /** The screen's existing Share handler. Omit when the item cannot be shared. */
  onShare?: () => void;
  /** The screen's existing Public page handler. Omit when there is no page. */
  onViewPublic?: () => void;
  onDismiss: () => void;
  testID?: string;
}

export const PublishedBanner: React.FC<PublishedBannerProps> = ({
  kind,
  onShare,
  onViewPublic,
  onDismiss,
  testID = "published-banner",
}) => {
  const hasActions = onShare !== undefined || onViewPublic !== undefined;
  return (
    <GlassCard
      variant="elevated"
      radius="md"
      padding={spacing.md}
      testID={testID}
      contentStyle={styles.content}
    >
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Icon name="check" size={18} color={semantic.success} />
        </View>
        <View
          style={styles.copy}
          accessible
          accessibilityRole="alert"
          accessibilityLabel={
            onShare !== undefined
              ? `${PUBLISHED_BANNER_TITLE} ${publishedBannerSupportingLine(kind)}`
              : PUBLISHED_BANNER_TITLE
          }
        >
          <Text style={styles.title}>{PUBLISHED_BANNER_TITLE}</Text>
          {/* The supporting line invites a share, so it only shows with Share. */}
          {onShare !== undefined ? (
            <Text style={styles.line}>
              {publishedBannerSupportingLine(kind)}
            </Text>
          ) : null}
        </View>
        <IconChrome
          icon="close"
          size={36}
          onPress={onDismiss}
          accessibilityLabel="Dismiss"
          testID={`${testID}-dismiss`}
        />
      </View>
      {hasActions ? (
        <View style={styles.actions}>
          {onShare !== undefined ? (
            <Button
              label="Share"
              variant="primary"
              size="md"
              leadingIcon="share"
              onPress={onShare}
              accessibilityLabel="Share"
              testID={`${testID}-share`}
              style={styles.action}
            />
          ) : null}
          {onViewPublic !== undefined ? (
            <Button
              label="View public page"
              variant="secondary"
              size="md"
              leadingIcon="eye"
              onPress={onViewPublic}
              accessibilityLabel="View public page"
              testID={`${testID}-view-public`}
              style={styles.action}
            />
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semantic.successTint,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  line: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
});

export default PublishedBanner;
