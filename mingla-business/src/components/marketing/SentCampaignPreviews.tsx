/**
 * SentCampaignPreviews — #4273 polish. The campaign screen's use of the
 * composer's own panes (email, SMS, push, the method tabs), fed from the send
 * snapshot.
 *
 * Loaded ONLY on demand (React.lazy in campaigns/[id].tsx). The panes are also
 * imported by the composer route; a second static importer would hoist them,
 * and everything they pull in, into the boot chunk (__common).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ComposerPreviewTabs, type ComposerPreviewTabsProps } from "./ComposerPreviewTabs";
import { EmailPreviewPane } from "./EmailPreviewPane";
import { SmsPreviewPane } from "./SmsPreviewPane";
import { PushPreview } from "./PushComposeCard";
import { canvas, spacing, text as textTokens, typography } from "../../constants/designSystem";
import { smsCostLabel } from "../../features/marketing/blastSendModel";
import type { PreviewResolution } from "../../features/marketing/sentPreviewModel";
import type { CampaignGroupMember } from "../../services/marketing/marketingCampaignGroupViewService";

/** {token} words in the subject, filled the way the send fills them. */
function substituteSubject(subject: string, variables: Record<string, string | null>): string {
  return subject.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    if (!(key in variables)) return match;
    return variables[key] ?? "";
  });
}

/** One tab per method, around the page's body (no fill: the page scrolls). */
export const SentMethodTabs: React.FC<Omit<ComposerPreviewTabsProps, "fill">> = (props) => (
  <ComposerPreviewTabs {...props} fill={false} />
);

/** The composer's own panes, without their scroll, fed from the snapshot. */
export const SentMethodPreview: React.FC<{ resolution: PreviewResolution }> = ({ resolution }) => {
  if (resolution.channel === "email") {
    const p = resolution.props;
    return (
      <EmailPreviewPane
        scrollable={false}
        subject={substituteSubject(p.subject, { ...p.variables })}
        bodyHtml={p.bodyHtml}
        variables={p.variables}
        brandName={p.brandName}
        brandHeaderImageUrl={p.brandHeaderImageUrl}
        embeddedEvents={p.embeddedEvents}
        brandSlug={p.brandSlug}
        fromLabel={p.fromLabel}
      />
    );
  }
  if (resolution.channel === "sms") {
    const p = resolution.props;
    return (
      <SmsPreviewPane
        scrollable={false}
        body={p.body}
        brandName={p.brandName}
        brandSlug={p.brandSlug}
        includeFollowCta={p.includeFollowCta}
        reachableSms={null}
        currencyCode=""
        hasMedia={p.hasMedia}
        mediaUris={p.mediaUris}
        wireOverride={p.wireOverride}
        countLineOverride={p.countLineOverride}
      />
    );
  }
  const p = resolution.props;
  return (
    <View style={styles.pushCanvas}>
      {p.variants !== null
        ? p.variants.map((variant) => (
            <View key={variant.reason} style={styles.pushVariant}>
              <Text style={styles.pushCaption}>{variant.caption}</Text>
              <PushPreview
                body={variant.body}
                brandName={p.brandName}
                reason={variant.reason}
                rendered={{ title: variant.title, body: variant.body }}
              />
            </View>
          ))
        : (
            <PushPreview
              body={p.fallback?.body ?? ""}
              title={p.fallback?.title ?? null}
              brandName={p.brandName}
              reason="follower"
            />
          )}
    </View>
  );
};

/** "Cost: USD 4.12 estimated" from the confirmed send, or that none is on file. */
export const SentSmsCost: React.FC<{ cost: CampaignGroupMember["cost"]; missing: string }> = ({ cost, missing }) => (
  <Text style={styles.costLine} testID="campaign-sms-cost">
    {cost !== null
      ? `Cost: ${smsCostLabel(
          { costKind: cost.costKind, estimatedCostMinor: cost.estimatedCostMinor, currency: cost.currency },
          "row",
        )}`
      : missing}
  </Text>
);

const styles = StyleSheet.create({
  pushCanvas: {
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: canvas.discover,
  },
  pushVariant: {
    gap: spacing.xs,
  },
  pushCaption: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  costLine: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});
