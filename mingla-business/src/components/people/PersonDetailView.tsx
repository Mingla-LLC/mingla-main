import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { accent, spacing, text, typography } from "../../constants/designSystem";
import type {
  BrandPersonContact,
  BrandPersonDetail,
  BrandPersonMergeHistoryRow,
  BrandPersonSummary,
} from "../../types/people";
import { Avatar } from "../ui/Avatar";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";

function isMaintenanceDetail(
  person: BrandPersonSummary,
): person is BrandPersonDetail {
  return "identityVersion" in person && "capabilities" in person
    && "alternateNames" in person;
}

export interface PersonDetailViewProps {
  person: BrandPersonSummary | null;
  loading: boolean;
  error: "not_found" | "forbidden" | "offline" | "error" | null;
  status: string | null;
  onRetry: () => void;
  historyRows?: BrandPersonMergeHistoryRow[];
  historyLoading?: boolean;
  historyInitialError?: boolean;
  historyRefreshError?: boolean;
  historyLoadMoreError?: boolean;
  historyLoadingMore?: boolean;
  historyHasNextPage?: boolean;
  onRetryHistory?: () => void;
  onLoadMoreHistory?: () => void;
  mutationDisabled?: boolean;
  promotingContactId?: string | null;
  primaryError?: string | null;
  onMerge?: () => void;
  onPromote?: (contact: BrandPersonContact) => void;
  onSplit?: (row: BrandPersonMergeHistoryRow) => void;
  maintenanceRecoveryState?: "loading" | "ready" | "retry_available" |
    "check_again" | "storage_blocked" | "receipt";
  onCheckRecovery?: () => void;
  onRetryRecovery?: () => void;
  onAbandonRecovery?: () => void;
}

export function PersonDetailView({
  person,
  loading,
  error,
  status,
  onRetry,
  historyRows = [],
  historyLoading = false,
  historyInitialError = false,
  historyRefreshError = false,
  historyLoadMoreError = false,
  historyLoadingMore = false,
  historyHasNextPage = false,
  onRetryHistory,
  onLoadMoreHistory,
  mutationDisabled = false,
  promotingContactId = null,
  primaryError = null,
  onMerge,
  onPromote,
  onSplit,
  maintenanceRecoveryState = "ready",
  onCheckRecovery,
  onRetryRecovery,
  onAbandonRecovery,
}: PersonDetailViewProps): React.ReactElement {
  if (loading) {
    return (
      <View style={styles.loading}>
        <Skeleton width={84} height={84} radius="full" />
        <Skeleton width="48%" height={28} />
        <Skeleton width="100%" height={120} />
      </View>
    );
  }
  if (error === "forbidden") {
    return (
      <EmptyState
        title="You don’t have access to People."
        description="A marketing manager or brand admin can open this page."
      />
    );
  }
  if (error === "not_found") {
    return (
      <EmptyState
        title="This person isn’t in your book."
        description="They may have been merged or removed."
      />
    );
  }
  if (error === "offline") {
    return (
      <EmptyState
        title="You’re offline."
        description="Connect to load this person’s details."
      />
    );
  }
  if (error || !person) {
    return (
      <EmptyState
        title="Couldn’t load this person."
        cta={{ label: "Try again", onPress: onRetry, variant: "secondary" }}
      />
    );
  }
  const detail = isMaintenanceDetail(person) ? person : null;
  if (!detail) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        {status ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
        ) : null}
        <View style={styles.hero}>
          <Avatar
            name={person.displayName}
            photo={person.avatarUrl ?? undefined}
            size="hero"
          />
          <Text accessibilityRole="header" style={styles.name}>{person.displayName}</Text>
        </View>
        <GlassCard contentStyle={styles.card}>
          <Text style={styles.heading}>Contact details</Text>
          {person.contacts.map((contact) => (
            <View key={contact.id} style={styles.legacyContactRow}>
              <Icon
                name={contact.channel === "email" ? "mail" : "phone"}
                size={20}
                color={text.secondary}
              />
              <View style={styles.legacyContactCopy}>
                <Text style={styles.value} numberOfLines={2}>{contact.value}</Text>
                {contact.isPrimary ? <Text style={styles.legacyPrimary}>Primary</Text> : null}
              </View>
            </View>
          ))}
        </GlassCard>
        {person.suppressions.length > 0 ? (
          <GlassCard contentStyle={styles.card}>
            <Text style={styles.heading}>Marketing preferences</Text>
            {person.suppressions.map((suppression) => (
              <View key={`${suppression.channel}:${suppression.scope}`} style={styles.preferenceRow}>
                <Icon name="shield" size={20} color={text.secondary} />
                <Text style={styles.value}>
                  {suppression.channel === "email"
                    ? "Email marketing suppressed"
                    : "Text marketing suppressed"}
                </Text>
              </View>
            ))}
          </GlassCard>
        ) : null}
      </ScrollView>
    );
  }
  // The new action components depend on the app animation runtime. Loading
  // them only for the expanded DTO preserves the existing rolling-deploy
  // fallback while keeping one canonical modern detail surface.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Button } = require("../ui/Button") as typeof import("../ui/Button");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const detailSections = require(
    "./PersonDetailSections"
  ) as typeof import("./PersonDetailSections");
  const {
    AlternateNames,
    ContactChannelSection,
    MergeHistoryCard,
  } = detailSections;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
      ) : null}
      <View style={styles.hero}>
        <Avatar
          name={person.displayName}
          photo={person.avatarUrl ?? undefined}
          size="hero"
        />
        <Text accessibilityRole="header" style={styles.name}>{person.displayName}</Text>
        <AlternateNames names={detail.alternateNames} />
        {detail.capabilities.canMerge && onMerge ? (
          <Button
            label="Merge duplicate"
            variant="secondary"
            size="md"
            disabled={mutationDisabled}
            onPress={onMerge}
            accessibilityLabel="Merge duplicate"
            testID="merge-duplicate"
            style={styles.mergeButton}
          />
        ) : null}
      </View>
      <ContactChannelSection
        contacts={person.contacts}
        canPromote={detail.capabilities.canPromotePrimary}
        promotingContactId={promotingContactId}
        mutationDisabled={mutationDisabled}
        error={primaryError}
        onPromote={(contact) => onPromote?.(contact)}
      />
      {maintenanceRecoveryState === "loading" ? (
        <GlassCard contentStyle={styles.recoveryCard}>
          <Text accessibilityLiveRegion="polite" style={styles.heading}>
            Checking your last People change…
          </Text>
        </GlassCard>
      ) : maintenanceRecoveryState === "check_again" ? (
        <GlassCard contentStyle={styles.recoveryCard}>
          <Text accessibilityRole="alert" style={styles.recoveryTitle}>
            Mingla couldn’t confirm your last People change.
          </Text>
          <Text style={styles.value}>Nothing will be sent again until the result is confirmed.</Text>
          {onCheckRecovery ? <Button label="Check again" onPress={onCheckRecovery} /> : null}
        </GlassCard>
      ) : maintenanceRecoveryState === "storage_blocked" ? (
        <GlassCard contentStyle={styles.recoveryCard}>
          <Text accessibilityRole="alert" style={styles.recoveryTitle}>
            People changes are paused.
          </Text>
          <Text style={styles.value}>
            Mingla can’t safely save recovery details on this device. Free storage or restart, then check again.
          </Text>
          {onCheckRecovery ? <Button label="Check again" onPress={onCheckRecovery} /> : null}
        </GlassCard>
      ) : maintenanceRecoveryState === "retry_available" ? (
        <GlassCard contentStyle={styles.recoveryCard}>
          <Text accessibilityRole="alert" style={styles.recoveryTitle}>
            No completed People change was found.
          </Text>
          <Text style={styles.value}>Review the latest details before retrying the saved change.</Text>
          <View style={styles.recoveryActions}>
            {onRetryRecovery ? <Button label="Retry reviewed change" onPress={onRetryRecovery} /> : null}
            {onAbandonRecovery ? (
              <Button label="Abandon saved change" variant="secondary" onPress={onAbandonRecovery} />
            ) : null}
          </View>
        </GlassCard>
      ) : null}
      {detail.capabilities.canViewMergeHistory ? (
        <MergeHistoryCard
          rows={historyRows}
          loading={historyLoading}
          initialError={historyInitialError}
          refreshError={historyRefreshError}
          loadMoreError={historyLoadMoreError}
          loadingMore={historyLoadingMore}
          hasNextPage={historyHasNextPage}
          onRetry={onRetryHistory}
          onLoadMore={onLoadMoreHistory}
          onSplit={onSplit}
        />
      ) : null}
      {person.suppressions.length > 0 ? (
        <GlassCard contentStyle={styles.card}>
          <Text style={styles.heading}>Marketing preferences</Text>
          {person.suppressions.map((suppression) => (
            <View key={`${suppression.channel}:${suppression.scope}`} style={styles.preferenceRow}>
              <Icon name="shield" size={20} color={text.secondary} />
              <Text style={styles.value}>
                {suppression.channel === "email"
                  ? "Email marketing suppressed"
                  : "Text marketing suppressed"}
              </Text>
            </View>
          ))}
        </GlassCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 120,
    gap: spacing.lg,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  loading: { padding: spacing.lg, gap: spacing.md, alignItems: "center" },
  status: { ...typography.bodySm, color: text.tertiary },
  hero: { alignItems: "center", gap: spacing.sm, maxWidth: 560, width: "100%", alignSelf: "center" },
  name: { ...typography.h1, color: text.primary, textAlign: "center" },
  mergeButton: { marginTop: spacing.sm, minWidth: 176, borderColor: accent.border },
  card: { gap: spacing.sm },
  heading: { ...typography.h3, color: text.primary },
  preferenceRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legacyContactRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legacyContactCopy: { flex: 1 },
  legacyPrimary: { ...typography.caption, color: text.secondary },
  value: { ...typography.body, color: text.primary, flex: 1 },
  recoveryCard: { gap: spacing.md },
  recoveryTitle: { ...typography.h3, color: text.primary },
  recoveryActions: { gap: spacing.sm },
});
