import React from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  accent,
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
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
        <Icon name="star" size={16} color={accent.warm} />
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
  onPromote,
}: {
  channel: BrandPersonContactChannel;
  contacts: BrandPersonContact[];
  canPromote: boolean;
  promotingContactId: string | null;
  mutationDisabled: boolean;
  onPromote: (contact: BrandPersonContact) => void;
}) {
  return (
    <View style={styles.channel}>
      <Text style={styles.channelLabel}>{channel === "email" ? "Email" : "Phone"}</Text>
      {contacts.map((contact) => (
        <View key={contact.id} style={styles.contactRow}>
          <Icon
            name={channel === "email" ? "mail" : "phone"}
            size={20}
            color={text.secondary}
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
        <ChannelRows
          channel="email"
          contacts={email}
          canPromote={canPromote}
          promotingContactId={promotingContactId}
          mutationDisabled={mutationDisabled}
          onPromote={onPromote}
        />
      ) : null}
      {phone.length > 0 ? (
        <View style={email.length > 0 ? styles.dividedChannel : null}>
          <ChannelRows
            channel="phone"
            contacts={phone}
            canPromote={canPromote}
            promotingContactId={promotingContactId}
            mutationDisabled={mutationDisabled}
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
}: {
  row: MergeHistoryRowDto;
  onSplit: (row: MergeHistoryRowDto) => void;
}): React.ReactElement {
  const reversed = row.status === "reversed";
  return (
    <View style={styles.historyRow}>
      <Icon
        name={reversed ? "branch" : "users"}
        size={20}
        color={reversed ? semantic.success : semantic.warning}
      />
      <View style={styles.historyCopy}>
        <Text style={styles.historyTitle}>
          {reversed ? "Split from" : "Merged with"} {row.counterpartLabel}
        </Text>
        <Text style={styles.timestamp}>{safeDate(row.reversedAt ?? row.createdAt)}</Text>
      </View>
      <View style={styles.historyActions}>
        <View style={[styles.statusPill, reversed ? styles.splitPill : styles.mergePill]}>
          <Text style={[styles.statusText, { color: reversed ? semantic.success : semantic.warning }]}>
            {reversed ? "Split" : "Merged"}
          </Text>
        </View>
        {row.canSplit ? (
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
  onSplit,
}: {
  rows: MergeHistoryRowDto[];
  loading: boolean;
  onSplit: (row: MergeHistoryRowDto) => void;
}): React.ReactElement | null {
  if (!loading && rows.length === 0) return null;
  return (
    <GlassCard contentStyle={styles.historyCard}>
      <Text style={styles.heading}>Merge history</Text>
      {loading && rows.length === 0
        ? <Text accessibilityLiveRegion="polite" style={styles.helper}>Loading merge history…</Text>
        : rows.map((row, index) => (
          <View key={row.mergeEventId} style={index > 0 ? styles.historyDivider : null}>
            <MergeHistoryRow row={row} onSplit={onSplit} />
          </View>
        ))}
    </GlassCard>
  );
}

const rowSurface = Platform.OS === "android"
  ? androidOpaque.rowFill
  : glass.tint.profileBase;
const rowBorder = Platform.OS === "android"
  ? androidOpaque.rowBorder
  : glass.border.profileBase;

const styles = StyleSheet.create({
  aliases: { alignItems: "center", gap: spacing.xs, maxWidth: 560 },
  aliasLabel: { ...typography.caption, color: text.secondary },
  aliasValues: { ...typography.bodySm, color: text.primary, textAlign: "center" },
  card: { gap: spacing.md },
  heading: { ...typography.h3, color: text.primary },
  helper: { ...typography.caption, color: text.secondary },
  error: { ...typography.bodySm, color: semantic.error },
  channel: { gap: spacing.xs },
  channelLabel: { ...typography.labelCap, color: text.secondary, textTransform: "uppercase" },
  dividedChannel: {
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    paddingTop: spacing.md,
  },
  contactRow: {
    minHeight: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: rowSurface,
    borderWidth: 1,
    borderColor: rowBorder,
    paddingHorizontal: spacing.sm,
  },
  contactValue: {
    ...typography.monoMd,
    color: text.primary,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 160,
  },
  primaryState: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  primaryLabel: { ...typography.caption, color: accent.warm },
  primaryAction: { minWidth: 112 },
  historyCard: { gap: 0 },
  historyDivider: { borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  historyRow: {
    minHeight: 64,
    paddingVertical: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  historyCopy: { flex: 1, minWidth: 160 },
  historyTitle: { ...typography.bodySm, fontWeight: "600", color: text.primary },
  timestamp: { ...typography.caption, color: text.secondary },
  historyActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  mergePill: { backgroundColor: Platform.OS === "android" ? androidOpaque.warningFill : semantic.warningTint },
  splitPill: { backgroundColor: Platform.OS === "android" ? androidOpaque.successFill : semantic.successTint },
  statusText: { ...typography.caption },
});
