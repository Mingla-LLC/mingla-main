/**
 * EmailPreviewPane — inline RN preview of the composer body.
 *
 * Renders preview blocks from `marketingRenderingService.previewBlocks()`
 * — paragraph text + simple event-card placeholders. Real email rendering
 * happens server-side (Deno `_shared/marketingEmailRender.ts`) — this pane
 * is honest about being a preview and labels event-card blocks as
 * placeholders so operators don't expect pixel-perfect parity.
 *
 * Layout:
 *   - Mobile: caller mounts this inside a Sheet (sub-sheet inside parent
 *     composer Sheet — see feedback_rn_sub_sheet_must_render_inside_parent.md).
 *   - Tablet+web: caller mounts inline as a side pane (visible at viewport
 *     ≥ 768pt). The composer route does the breakpoint switch.
 */

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  previewBlocks,
  type PreviewVariables,
} from "../../services/marketing/marketingRenderingService";

export interface EmailPreviewPaneProps {
  subject: string;
  bodyHtml: string;
  variables: PreviewVariables;
  brandName: string | null;
}

export const EmailPreviewPane: React.FC<EmailPreviewPaneProps> = ({
  subject,
  bodyHtml,
  variables,
  brandName,
}) => {
  const blocks = previewBlocks(bodyHtml, variables);
  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>SUBJECT</Text>
      <Text style={styles.subjectText}>
        {subject.length > 0 ? subject : "(no subject)"}
      </Text>
      <View style={styles.divider} />
      <Text style={styles.label}>FROM</Text>
      <Text style={styles.metaText}>
        {brandName !== null ? `${brandName} via Mingla` : "Your brand via Mingla"}
      </Text>
      <View style={styles.divider} />
      <View style={styles.bodyHost}>
        {blocks.length === 0 ? (
          <Text style={styles.placeholderText}>
            (start typing in the body field to preview)
          </Text>
        ) : (
          blocks.map((block, idx) => {
            if (block.kind === "paragraph") {
              return (
                <Text key={idx} style={styles.paragraph}>
                  {block.content}
                </Text>
              );
            }
            return (
              <View key={idx} style={styles.eventCard}>
                <Text style={styles.eventCardLabel}>EVENT CARD (preview)</Text>
                <Text style={styles.eventCardId}>
                  ID: {block.content.slice(0, 8)}…
                </Text>
                <Text style={styles.eventCardNote}>
                  The real card with cover + date + tickets-button renders server-side at send time.
                </Text>
              </View>
            );
          })
        )}
      </View>
      <View style={styles.divider} />
      <Text style={styles.footerNote}>
        Unsubscribe link auto-appended to every send.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: glass.tint.profileBase,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.xs,
    paddingBottom: spacing.lg,
  },
  label: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  subjectText: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  metaText: {
    ...typography.body,
    color: textTokens.secondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginVertical: spacing.sm,
  },
  bodyHost: {
    gap: spacing.sm,
  },
  paragraph: {
    ...typography.body,
    color: textTokens.primary,
  },
  placeholderText: {
    ...typography.body,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  eventCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
    gap: 4,
  },
  eventCardLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  eventCardId: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  eventCardNote: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  footerNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
});
