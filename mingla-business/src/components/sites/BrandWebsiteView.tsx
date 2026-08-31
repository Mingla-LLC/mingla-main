import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import {
  accent,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  BrandSiteAnalytics,
  BrandSiteDraftValidation,
  BrandSiteOperation,
  BrandSiteOverview,
  BrandSiteVersion,
  WebsiteJourneyState,
} from "../../sites/contracts";
import { primarySiteHost } from "../../sites/contracts";
import type {
  WebsiteWorkspacePanel,
  WorkspaceNotice,
} from "../../sites/websiteJourney";
import { WEBSITE_JOURNEY } from "../../sites/websiteJourney";

interface BrandWebsiteViewProps {
  brandName: string;
  site: BrandSiteOverview | null;
  rank: number;
  journeyState: WebsiteJourneyState;
  panel: WebsiteWorkspacePanel;
  notice: WorkspaceNotice;
  isLoading: boolean;
  isError: boolean;
  isProvisioning: boolean;
  isOpeningStudio: boolean;
  isPreviewing: boolean;
  isPublishing: boolean;
  isRollingBack: boolean;
  isValidating: boolean;
  versions: BrandSiteVersion[];
  analytics: BrandSiteAnalytics | null;
  validation: BrandSiteDraftValidation | null;
  validationFailure: string | null;
  selectedVersion: BrandSiteVersion | null;
  provisionOperationId: string | null;
  provisionOperation: BrandSiteOperation | null;
  provisionPollingTimedOut: boolean;
  publicationOperationId: string | null;
  publicationOperation: BrandSiteOperation | null;
  publicationPollingTimedOut: boolean;
  isReconciling: boolean;
  onRetry: () => void;
  onSetPanel: (panel: WebsiteWorkspacePanel) => void;
  onProvision: () => void;
  onReconcileProvision: () => void;
  onOpenStudio: () => void;
  onPreview: () => void;
  onViewLive: (hostname: string) => void;
  onOpenAri: () => void;
  onValidatePublish: () => void;
  onPublish: () => void;
  onSelectRollback: (version: BrandSiteVersion) => void;
  onRollback: () => void;
  onReconcilePublication: () => void;
  onResetFailedPublication: () => void;
}

const siteStatusCopy: Record<BrandSiteOverview["status"], string> = {
  provisioning: "Mingla is creating the private editing workspace.",
  draft: "Your private draft is ready to edit and preview.",
  publishing:
    "Mingla is verifying the exact revision before changing the public website.",
  published: "Your last verified website is live.",
  suspended:
    "Public delivery is paused. Your verified publication is preserved.",
  error:
    "Publishing needs attention. Your last verified website remains safe.",
};

const PanelCard: React.FC<{
  title: string;
  children: React.ReactNode;
  testID?: string;
}> = ({ title, children, testID }) => (
  <GlassCard
    variant="elevated"
    contentStyle={styles.cardContent}
    testID={testID}
  >
    <Text style={styles.cardTitle}>{title}</Text>
    {children}
  </GlassCard>
);

export const BrandWebsiteView: React.FC<BrandWebsiteViewProps> = (props) => {
  const [showFailureDetails, setShowFailureDetails] = useState(false);
  const host = useMemo(
    () => (props.site === null ? null : primarySiteHost(props.site)),
    [props.site],
  );
  const canProvision = props.rank >= 50;

  if (props.rank < 20) return null;
  if (props.isLoading) {
    return (
      <View style={styles.centered} testID="website-loading">
        <ActivityIndicator
          color={accent.warm}
          accessibilityLabel="Loading Website"
        />
        <Text style={styles.body}>Checking your website status…</Text>
      </View>
    );
  }
  if (props.notice === "unauthorized") {
    return (
      <View style={styles.centered} testID="website-unauthorized">
        <Text style={styles.title}>Website access changed</Text>
        <Text style={styles.body}>
          Your role no longer has access to this brand website.
        </Text>
        <Button
          label="Return to Brand Profile"
          onPress={props.onRetry}
          variant="secondary"
        />
      </View>
    );
  }
  if (props.notice === "offline") {
    return (
      <View style={styles.centered} testID="website-offline">
        <Text style={styles.title}>You’re offline</Text>
        <Text style={styles.body}>
          Your live website is unaffected. Reconnect to check the durable
          operation receipt.
        </Text>
        <Button label="Try again" onPress={props.onRetry} variant="secondary" />
      </View>
    );
  }
  if (props.isError) {
    return (
      <View style={styles.centered} testID="website-error">
        <Text style={styles.title}>Couldn’t load Website</Text>
        <Text style={styles.body}>Your public website is unaffected.</Text>
        <Button label="Try again" onPress={props.onRetry} variant="secondary" />
      </View>
    );
  }

  const definition = WEBSITE_JOURNEY[props.journeyState];
  const actionLocked =
    props.publicationOperationId !== null &&
    props.publicationOperation?.status !== "succeeded" &&
    props.publicationOperation?.status !== "failed";

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.headingRow}>
        <View style={styles.headingIcon}>
          <Icon name="globe" size={22} color={accent.warm} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>RESTAURANT WEBSITE V1</Text>
          <Text style={styles.title}>{props.brandName} Website</Text>
          <Text style={styles.body}>{definition.title}</Text>
        </View>
      </View>

      {props.notice === "expired" || props.journeyState === 30 ? (
        <PanelCard
          title="Your secure Studio session ended"
          testID="website-session-expired"
        >
          <Text style={styles.body}>
            No draft or live website was changed. Open Studio again from this
            workspace to continue.
          </Text>
          <Button
            label="Open Mingla Studio again"
            onPress={props.onOpenStudio}
            loading={props.isOpeningStudio}
            fullWidth
          />
        </PanelCard>
      ) : null}

      {props.journeyState === 2 ? (
        <PanelCard
          title="Your own website, edited in Mingla"
          testID="website-not-setup"
        >
          <Text style={styles.body}>
            Start with the fixed Restaurant Website v1 layout. Setup creates a
            private draft; nothing becomes public.
          </Text>
          {canProvision ? (
            <Button
              label="Review website setup"
              onPress={() => props.onSetPanel("setup_review")}
              fullWidth
            />
          ) : (
            <Text style={styles.helper}>
              A brand admin can set up the website.
            </Text>
          )}
        </PanelCard>
      ) : null}

      {props.journeyState === 3 ? (
        <PanelCard title="Review your website setup" testID="website-setup-review">
          <Text style={styles.body}>
            Mingla will create a private Studio workspace and draft for {props.brandName}.
            Nothing will be published.
          </Text>
          <View style={styles.reviewList}>
            <Text style={styles.reviewItem}>Layout · Restaurant Website v1</Text>
            <Text style={styles.reviewItem}>
              Address · Permanent Mingla address after setup
            </Text>
            <Text style={styles.reviewItem}>
              Publishing · Separate preview and confirmation required
            </Text>
          </View>
          <Button
            label="Create website draft"
            loading={props.isProvisioning}
            onPress={props.onProvision}
            fullWidth
          />
          <Button
            label="Back"
            onPress={() => props.onSetPanel("overview")}
            variant="ghost"
            fullWidth
          />
        </PanelCard>
      ) : null}

      {props.journeyState === 4 ? (
        <PanelCard title="Creating your website draft" testID="website-provisioning">
          <Text style={styles.body}>
            Nothing is live, and you can leave safely. This screen follows the
            authoritative setup receipt.
          </Text>
          <ProgressRows
            labels={[
              "Setup request accepted",
              "Website authority created",
              "Studio workspace creating",
              "Draft checking",
              "Draft ready",
            ]}
            complete={2}
          />
          <OperationReceipt
            operationId={props.provisionOperationId}
            operation={props.provisionOperation}
            timedOut={props.provisionPollingTimedOut}
          />
          {canProvision &&
          (props.provisionPollingTimedOut ||
            props.provisionOperation?.status === "ambiguous") ? (
            <Button
              label="Check setup status"
              loading={props.isReconciling}
              onPress={props.onReconcileProvision}
              variant="secondary"
              fullWidth
            />
          ) : null}
        </PanelCard>
      ) : null}

      {props.journeyState === 6 ? (
        <PanelCard title="Opening Mingla Studio…" testID="website-opening-studio">
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.body}>
            Creating a short-lived, one-time secure handoff.
          </Text>
        </PanelCard>
      ) : null}

      {props.journeyState === 12 ? (
        <PanelCard title="Creating a private preview…" testID="website-previewing">
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.body}>
            This preview is short-lived and is not your live website.
          </Text>
        </PanelCard>
      ) : null}

      {props.journeyState === 13 ? (
        <PanelCard title="Ready to publish?" testID="website-publish-review">
          <Text style={styles.body}>
            Mingla validates and verifies one exact revision before changing
            the public website.
          </Text>
          {props.validation === null ? (
            <>
              {props.validationFailure ? (
                <View style={styles.validationFailure}>
                  <Text style={styles.failureTitle}>Draft needs review</Text>
                  <Text style={styles.body}>{props.validationFailure}</Text>
                </View>
              ) : null}
              <Button
                label={props.validationFailure ? "Check draft again" : "Check draft"}
                loading={props.isValidating}
                onPress={props.onValidatePublish}
                fullWidth
              />
            </>
          ) : (
            <View style={styles.reviewList}>
              <Text style={styles.reviewItem}>
                Layout · {props.validation.renderer}
              </Text>
              <Text style={styles.reviewItem}>
                Pages checked · {props.validation.checked_pages}
              </Text>
              <Text style={styles.reviewItem}>
                Revision · {props.validation.home_revision}
              </Text>
              <Button
                label="Publish website"
                loading={props.isPublishing}
                onPress={props.onPublish}
                fullWidth
              />
            </View>
          )}
          <Button
            label="Preview again"
            onPress={props.onPreview}
            variant="secondary"
            fullWidth
          />
          <Button
            label="Cancel"
            onPress={() => props.onSetPanel("overview")}
            variant="ghost"
            fullWidth
          />
        </PanelCard>
      ) : null}

      {props.journeyState === 14 ? (
        <PanelCard
          title={
            props.publicationOperationId
              ? "Publishing your website"
              : "Verifying publication status"
          }
          testID="website-publication-running"
        >
          <Text style={styles.body}>
            You can leave safely. Mingla will not start another publish or
            rollback while this outcome is unproven.
          </Text>
          <ProgressRows
            labels={[
              "Request accepted",
              "Revision validated",
              "Artifact materialized",
              "Public probe verified",
              "Live pointer changed",
            ]}
            complete={props.publicationOperation?.status === "succeeded" ? 5 : 2}
          />
          <OperationReceipt
            operationId={props.publicationOperationId}
            operation={props.publicationOperation}
            timedOut={props.publicationPollingTimedOut}
          />
          {props.publicationPollingTimedOut ||
          props.publicationOperation?.status === "ambiguous" ? (
            <Button
              label="Check the same operation"
              loading={props.isReconciling}
              onPress={props.onReconcilePublication}
              variant="secondary"
              fullWidth
            />
          ) : null}
        </PanelCard>
      ) : null}

      {props.journeyState === 25 && props.selectedVersion ? (
        <PanelCard title="Publish this earlier version?" testID="website-rollback-review">
          <Text style={styles.body}>
            Mingla will validate revision {props.selectedVersion.source_revision_id} again
            and publish it as a new immutable version. History is preserved.
          </Text>
          <Button
            label="Publish this earlier version"
            loading={props.isRollingBack}
            onPress={props.onRollback}
            fullWidth
          />
          <Button
            label="Cancel"
            onPress={() => props.onSetPanel("versions")}
            variant="ghost"
            fullWidth
          />
        </PanelCard>
      ) : null}

      {props.journeyState === 28 ? (
        <PanelCard title="That publish didn’t make it live" testID="website-publication-failed">
          <Text style={styles.failureTitle}>Last good preserved</Text>
          <Text style={styles.body}>
            Nothing unverified replaced the public website. Review the draft or
            earlier version before trying again.
          </Text>
          {props.publicationOperation?.error_code ? (
            <Text style={styles.meta}>
              Reference · {props.publicationOperation.error_code}
            </Text>
          ) : null}
          <Button
            label={
              props.publicationOperation?.result_summary?.retryable === true
                ? "Try again"
                : "Review fixes"
            }
            onPress={props.onResetFailedPublication}
            fullWidth
          />
          <Button
            label="Open Mingla Studio"
            onPress={props.onOpenStudio}
            variant="secondary"
            fullWidth
          />
          {host && props.site?.active_publication_id && host.status === "active" ? (
            <Button
              label="View live website"
              onPress={() => props.onViewLive(host.hostname)}
              variant="secondary"
              fullWidth
            />
          ) : null}
          <Button
            label={showFailureDetails ? "Hide operation details" : "View operation details"}
            onPress={() => setShowFailureDetails((visible) => !visible)}
            variant="ghost"
            fullWidth
          />
          {showFailureDetails ? (
            <OperationReceipt
              operationId={props.publicationOperationId}
              operation={props.publicationOperation}
              timedOut={props.publicationPollingTimedOut}
            />
          ) : null}
        </PanelCard>
      ) : null}

      {(props.journeyState === 5 || props.journeyState === 15) && props.site ? (
        <>
          <PanelCard
            title={
              props.site.status === "published"
                ? "Your website is live"
                : "Your website draft is ready"
            }
            testID="website-overview"
          >
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  props.site.status === "published"
                    ? styles.statusDotLive
                    : undefined,
                ]}
              />
              <Text style={styles.body}>{siteStatusCopy[props.site.status]}</Text>
            </View>
            <Text style={styles.meta}>
              Last checked {new Date(props.site.updated_at).toLocaleString()}
            </Text>
            <View style={styles.actionStack}>
              <Button
                label="Open Mingla Studio"
                loading={props.isOpeningStudio}
                disabled={actionLocked}
                onPress={props.onOpenStudio}
                leadingIcon="edit"
                fullWidth
              />
              <Button
                label="Preview draft"
                loading={props.isPreviewing}
                disabled={actionLocked}
                onPress={props.onPreview}
                variant="secondary"
                leadingIcon="eye"
                fullWidth
              />
              <Button
                label="Review and publish"
                disabled={actionLocked}
                onPress={() => props.onSetPanel("publish_review")}
                variant="secondary"
                fullWidth
              />
              <Button
                label="Edit with Ari"
                disabled={actionLocked}
                onPress={props.onOpenAri}
                variant="ghost"
                fullWidth
              />
            </View>
          </PanelCard>
          <WorkspaceNavigation props={props} />
        </>
      ) : null}

      {props.journeyState === 23 ? (
        <PanelCard title="Website analytics" testID="website-analytics">
          {props.analytics === null ? (
            <Text style={styles.body}>
              Analytics are unavailable. Your website remains live.
            </Text>
          ) : (
            <View style={styles.metricRow}>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{props.analytics.events_30d}</Text>
                <Text style={styles.helper}>Privacy-safe events · 30 days</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricValue}>
                  {props.analytics.consumed_handoffs}
                </Text>
                <Text style={styles.helper}>Attributed checkouts</Text>
              </View>
            </View>
          )}
          <Button
            label="Back to website"
            onPress={() => props.onSetPanel("overview")}
            variant="ghost"
            fullWidth
          />
        </PanelCard>
      ) : null}

      {props.journeyState === 24 ? (
        <PanelCard title="Version history" testID="website-versions">
          {props.versions.length === 0 ? (
            <Text style={styles.body}>No verified publication versions yet.</Text>
          ) : (
            props.versions.map((version) => (
              <View key={version.id} style={styles.versionRow}>
                <View style={styles.versionCopy}>
                  <Text style={styles.versionTitle}>
                    Revision {version.source_revision_id}
                  </Text>
                  <Text style={styles.helper}>
                    {version.status} · {new Date(version.requested_at).toLocaleString()}
                  </Text>
                </View>
                {version.status === "published" &&
                version.id !== props.site?.active_publication_id ? (
                  <Button
                    label="Review"
                    disabled={actionLocked}
                    onPress={() => props.onSelectRollback(version)}
                    variant="ghost"
                  />
                ) : null}
              </View>
            ))
          )}
          <Button
            label="Back to website"
            onPress={() => props.onSetPanel("overview")}
            variant="ghost"
            fullWidth
          />
        </PanelCard>
      ) : null}

      {props.journeyState === 17 ? (
        <PanelCard title="Permanent website address" testID="website-address">
          {host === null ? (
            <Text style={styles.body}>
              Your permanent address will appear after setup completes.
            </Text>
          ) : (
            <>
              <Text style={styles.address}>{host.hostname}</Text>
              <Text style={styles.helper}>Managed securely by Mingla.</Text>
              {props.site?.active_publication_id && host.status === "active" ? (
                <Button
                  label="View website"
                  onPress={() => props.onViewLive(host.hostname)}
                  variant="secondary"
                />
              ) : null}
            </>
          )}
          <Button
            label="Back to website"
            onPress={() => props.onSetPanel("overview")}
            variant="ghost"
            fullWidth
          />
        </PanelCard>
      ) : null}
    </ScrollView>
  );
};

const OperationReceipt: React.FC<{
  operationId: string | null;
  operation: BrandSiteOperation | null;
  timedOut: boolean;
}> = ({ operationId, operation, timedOut }) => (
  <View style={styles.receipt}>
    <Text style={styles.meta} selectable>
      {operationId
        ? `Operation ${operationId}`
        : "Recovering the authoritative operation…"}
    </Text>
    <Text style={styles.body}>
      {operation?.status === "ambiguous"
        ? "Mingla cannot yet prove the final state. The same operation is preserved for reconciliation."
        : timedOut
          ? "Automatic checks stopped after the bounded window. The operation remains preserved."
          : operation?.status === "failed"
            ? "The operation reached a verified failure."
            : "Checking the durable receipt…"}
    </Text>
    {operation ? (
      <Text style={styles.meta} selectable>
        Status · {operation.status} · Updated {new Date(operation.updated_at).toLocaleString()}
      </Text>
    ) : null}
  </View>
);

const ProgressRows: React.FC<{ labels: string[]; complete: number }> = ({
  labels,
  complete,
}) => (
  <View style={styles.progressList}>
    {labels.map((label, index) => (
      <View key={label} style={styles.progressRow}>
        <View
          style={[
            styles.progressDot,
            index < complete ? styles.progressDotComplete : undefined,
          ]}
        />
        <Text style={index < complete ? styles.progressComplete : styles.helper}>
          {label}
        </Text>
      </View>
    ))}
  </View>
);

const WorkspaceNavigation: React.FC<{ props: BrandWebsiteViewProps }> = ({
  props,
}) => {
  const host = props.site ? primarySiteHost(props.site) : null;
  return (
    <GlassCard variant="base" contentStyle={styles.cardContent}>
      <Text style={styles.cardTitle}>Website workspace</Text>
      <Button
        label="Analytics"
        onPress={() => props.onSetPanel("analytics")}
        variant="ghost"
        fullWidth
      />
      <Button
        label="Version history"
        onPress={() => props.onSetPanel("versions")}
        variant="ghost"
        fullWidth
      />
      <Button
        label="Permanent address"
        onPress={() => props.onSetPanel("address")}
        variant="ghost"
        fullWidth
      />
      {host && props.site?.active_publication_id && host.status === "active" ? (
        <Button
          label="View live website"
          onPress={() => props.onViewLive(host.hostname)}
          variant="secondary"
          leadingIcon="eye"
          fullWidth
        />
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  headingRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  headingIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    borderColor: accent.border,
    borderWidth: 1,
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    color: accent.warm,
    fontSize: typography.labelCap.fontSize,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
  },
  body: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  cardContent: { gap: spacing.md },
  cardTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  helper: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  meta: { color: textTokens.tertiary, fontSize: typography.caption.fontSize },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: accent.warm,
  },
  statusDotLive: { backgroundColor: semantic.success },
  actionStack: { gap: spacing.sm },
  reviewList: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: glass.tint.profileBase,
  },
  reviewItem: { color: textTokens.primary, fontSize: typography.bodySm.fontSize },
  receipt: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: glass.tint.profileBase,
  },
  validationFailure: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: semantic.error,
  },
  progressList: { gap: spacing.sm },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: glass.border.profileBase,
  },
  progressDotComplete: { backgroundColor: semantic.success },
  progressComplete: {
    color: textTokens.primary,
    fontSize: typography.caption.fontSize,
  },
  failureTitle: {
    color: semantic.error,
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
  },
  address: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: glass.tint.profileBase,
  },
  metricRow: { flexDirection: "row", gap: spacing.sm },
  metric: { flex: 1, gap: spacing.xs },
  metricValue: {
    color: textTokens.primary,
    fontSize: typography.h2.fontSize,
    fontWeight: "700",
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  versionCopy: { flex: 1, gap: spacing.xs },
  versionTitle: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
  },
});
