import React from "react";
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  radius,
  color,
  materials,
  space,
  type,
} from "../../constants/designSystem";
import type {
  BrandPersonContact,
  BrandPersonContactChannel,
  BrandPersonMergeHistoryRow as MergeHistoryRowDto,
} from "../../types/people";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

export function AlternateNames({ names }: { names: string[] }): React.ReactElement | null {
  if (names.length === 0) return null;
  return (
    <View style={styles.aliases} accessibilityLabel={`Also known as ${names.join(", ")}`}>
      <Text style={styles.aliasLabel}>Also known as</Text>
      <Text style={styles.aliasValues}>{names.join(", ")}</Text>
    </View>
  );
}

export function PrimaryContactAction({
  contact,
  canPromote,
  loading,
  disabled,
  onPromote,
}: {
  contact: BrandPersonContact;
  canPromote: boolean;
  loading: boolean;
  disabled: boolean;
  onPromote: (contact: BrandPersonContact) => void;
}): React.ReactElement | null {
  if (contact.isPrimary) {
    return (
      <View style={styles.primaryState} accessibilityLabel={`Primary ${contact.channel}`}>
        <Icon name="star" size={16} color={color.accent} />
        <Text style={styles.primaryLabel}>Primary</Text>
      </View>
    );
  }
  if (!canPromote) return null;
  return (
    <Button
      label={loading ? "Changing primary" : "Make primary"}
      accessibilityLabel={loading
        ? `Changing primary ${contact.channel}`
        : `Make ${contact.value} primary ${contact.channel}`}
      variant="ghost"
      size="md"
      loading={loading}
      disabled={disabled}
      onPress={() => onPromote(contact)}
      testID={`make-primary-${contact.id}`}
      style={styles.primaryAction}
    />
  );
}

function ChannelRows({
  channel,
  contacts,
  canPromote,
  promotingContactId,
  mutationDisabled,
  largeText,
  onPromote,
}: {
  channel: BrandPersonContactChannel;
  contacts: BrandPersonContact[];
  canPromote: boolean;
  promotingContactId: string | null;
  mutationDisabled: boolean;
  largeText: boolean;
  onPromote: (contact: BrandPersonContact) => void;
}) {
  return (
    <View style={styles.channel}>
      <Text style={styles.channelLabel}>{channel === "email" ? "Email" : "Phone"}</Text>
      {contacts.map((contact) => (
        <View key={contact.id} style={[
          styles.contactRow,
          largeText ? styles.largeTextContactRow : null,
        ]}>
          <Icon
            name={channel === "email" ? "mail" : "phone"}
            size={20}
            color={color.text2}
          />
          <Text selectable style={styles.contactValue}>{contact.value}</Text>
          <PrimaryContactAction
            contact={contact}
            canPromote={canPromote}
            loading={promotingContactId === contact.id}
            disabled={mutationDisabled || promotingContactId !== null}
            onPromote={onPromote}
          />
        </View>
      ))}
    </View>
  );
}

export function ContactChannelSection({
  contacts,
  canPromote,
  promotingContactId,
  mutationDisabled,
  error,
  onPromote,
}: {
  contacts: BrandPersonContact[];
  canPromote: boolean;
  promotingContactId: string | null;
  mutationDisabled: boolean;
  error: string | null;
  onPromote: (contact: BrandPersonContact) => void;
}): React.ReactElement {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 2;
  const email = contacts.filter((contact) => contact.channel === "email");
  const phone = contacts.filter((contact) => contact.channel === "phone");
  return (
    <GlassCard contentStyle={styles.card}>
      <Text style={styles.heading}>Contact details</Text>
      <Text style={styles.helper}>
        Primary controls how this person appears in your book. Messages still go to every eligible address.
      </Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {email.length > 0 ? (
        <View style={largeText ? styles.largeTextBlock : null}>
          <ChannelRows
            channel="email"
            contacts={email}
            canPromote={canPromote}
            promotingContactId={promotingContactId}
            mutationDisabled={mutationDisabled}
            largeText={largeText}
            onPromote={onPromote}
          />
        </View>
      ) : null}
      {phone.length > 0 ? (
        <View style={email.length > 0 ? styles.dividedChannel : null}>
          <ChannelRows
            channel="phone"
            contacts={phone}
            canPromote={canPromote}
            promotingContactId={promotingContactId}
            mutationDisabled={mutationDisabled}
            largeText={largeText}
            onPromote={onPromote}
          />
        </View>
      ) : null}
    </GlassCard>
  );
}

function safeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MergeHistoryRow({
  row,
  onSplit,
  largeText,
}: {
  row: MergeHistoryRowDto;
  onSplit?: (row: MergeHistoryRowDto) => void;
  largeText: boolean;
}): React.ReactElement {
  const reversed = row.status === "reversed";
  return (
    <View style={[styles.historyRow, largeText ? styles.largeTextRow : null]}>
      <Icon
        name={reversed ? "branch" : "users"}
        size={20}
        color={reversed ? color.success : color.warning}
      />
      <View style={styles.historyCopy}>
        <Text style={styles.historyTitle}>
          {reversed ? "Split from" : "Merged with"} {row.counterpartLabel}
        </Text>
        <Text style={styles.timestamp}>{safeDate(row.reversedAt ?? row.createdAt)}</Text>
      </View>
      <View style={styles.historyActions}>
        <View style={[styles.statusPill, reversed ? styles.splitPill : styles.mergePill]}>
          <Text style={[styles.statusText, { color: reversed ? color.success : color.warning }]}>
            {reversed ? "Split" : "Merged"}
          </Text>
        </View>
        {row.canSplit && onSplit ? (
          <Button
            label="Split"
            variant="ghost"
            size="md"
            onPress={() => onSplit(row)}
            accessibilityLabel={`Split merge with ${row.counterpartLabel}`}
          />
        ) : null}
      </View>
    </View>
  );
}

export function MergeHistoryCard({
  rows,
  loading,
  initialError = false,
  refreshError = false,
  loadMoreError = false,
  loadingMore = false,
  hasNextPage = false,
  onRetry,
  onLoadMore,
  onSplit,
}: {
  rows: MergeHistoryRowDto[];
  loading: boolean;
  initialError?: boolean;
  refreshError?: boolean;
  loadMoreError?: boolean;
  loadingMore?: boolean;
  hasNextPage?: boolean;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onSplit?: (row: MergeHistoryRowDto) => void;
}): React.ReactElement | null {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 2;
  if (initialError && rows.length === 0) {
    return (
      <GlassCard contentStyle={styles.historyCard}>
        <Text style={styles.heading}>Merge history</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          Merge history couldn’t be loaded.
        </Text>
        {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
      </GlassCard>
    );
  }
  return (
    <GlassCard contentStyle={styles.historyCard}>
      <Text style={styles.heading}>Merge history</Text>
      {loading && rows.length === 0
        ? <Text accessibilityLiveRegion="polite" style={styles.helper}>Loading merge history…</Text>
        : rows.length === 0
        ? <Text style={styles.helper}>No merge history yet.</Text>
        : rows.map((row, index) => (
          <View key={row.mergeEventId} style={index > 0 ? styles.historyDivider : null}>
            <MergeHistoryRow row={row} onSplit={onSplit} largeText={largeText} />
          </View>
        ))}
      {refreshError && rows.length > 0 ? (
        <View style={styles.historyState}>
          <Text accessibilityRole="alert" style={styles.error}>
            Merge history couldn’t be refreshed. Showing saved history.
          </Text>
          {onRetry ? <Button label="Try again" variant="ghost" onPress={onRetry} /> : null}
        </View>
      ) : null}
      {loadingMore ? (
        <Text accessibilityLiveRegion="polite" style={styles.helper}>Loading more history…</Text>
      ) : loadMoreError ? (
        <View style={styles.historyState}>
          <Text accessibilityRole="alert" style={styles.error}>More history couldn’t be loaded.</Text>
          {onLoadMore ? <Button label="Try again" variant="ghost" onPress={onLoadMore} /> : null}
        </View>
      ) : hasNextPage && onLoadMore ? (
        <Button label="Load more" variant="ghost" onPress={onLoadMore} />
      ) : rows.length > 0 ? (
        <Text style={styles.helper}>You’ve reached the end of merge history.</Text>
      ) : null}
    </GlassCard>
  );
}

const rowSurface = Platform.OS === "android"
  ? materials.pane.solidFill
  : color.fill.inset;
const rowBorder = Platform.OS === "android"
  ? color.card2
  : color.line;

const styles = StyleSheet.create({
  aliases: { alignItems: "center", gap: space[1], maxWidth: 560 },
  aliasLabel: { ...type.caption, color: color.text2 },
  aliasValues: { ...type.small, color: color.text1, textAlign: "center" },
  card: { gap: space[4] },
  heading: { ...type.h1, color: color.text1 },
  helper: { ...type.caption, color: color.text2 },
  error: { ...type.small, color: color.danger },
  channel: { gap: space[1] },
  channelLabel: { ...type.label, color: color.text2, textTransform: "uppercase" },
  dividedChannel: {
    borderTopWidth: 1,
    borderTopColor: color.line,
    paddingTop: space[4],
  },
  contactRow: {
    minHeight: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[2],
    borderRadius: radius.sm,
    backgroundColor: rowSurface,
    borderWidth: 1,
    borderColor: rowBorder,
    paddingHorizontal: space[2],
  },
  largeTextBlock: { width: "100%" },
  largeTextContactRow: { flexDirection: "column", alignItems: "stretch" },
  largeTextRow: { flexDirection: "column", alignItems: "stretch" },
  contactValue: {
    ...type.mono,
    color: color.text1,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 160,
  },
  primaryState: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[1] },
  primaryLabel: { ...type.caption, color: color.accent },
  primaryAction: { minWidth: 112 },
  historyCard: { gap: 0 },
  historyDivider: { borderTopWidth: 1, borderTopColor: color.line },
  historyRow: {
    minHeight: 64,
    paddingVertical: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[2],
  },
  historyCopy: { flex: 1, minWidth: 160 },
  historyTitle: { ...type.small, fontWeight: "600", color: color.text1 },
  timestamp: { ...type.caption, color: color.text2 },
  historyActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  historyState: { gap: space[2], paddingTop: space[2] },
  statusPill: { borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: space[1] },
  mergePill: { backgroundColor: Platform.OS === "android" ? color.solidTint.warning : color.warningTint },
  splitPill: { backgroundColor: Platform.OS === "android" ? color.solidTint.success : color.successTint },
  statusText: { ...type.caption },
});
