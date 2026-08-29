import React, { useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureCompetitorIntelligenceEvent } from "../../../analytics/competitorIntelligenceAnalytics";
import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  useCompetitorWatch,
  useRefreshCompetitor,
  useRemoveCompetitor,
} from "../../../hooks/useCompetitorIntelligence";
import { useVenueListing } from "../../../hooks/useVenueListings";
import type {
  CompetitorSourceState,
  CompetitorWatchRow,
} from "../../../types/growthTools";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { GlassCard } from "../../ui/GlassCard";
import { CompetitorAddSheet } from "./CompetitorAddSheet";
import {
  CompetitorBriefSheet,
  openCompetitorPublicUrl,
} from "./CompetitorBriefSheet";

export const COMPETITOR_WATCH_CAP = 5;
const CompetitionEmptyIconAsset = React.lazy(async () => {
  const module = await import("../../ui/Icon");
  return { default: module.Icon };
});
export interface CompetitorWatchSectionProps {
  brandId: string | null;
  venueListingId: string | null;
  venueCity?: string | null;
  offline: boolean;
  onRequestAdd?: (atCap: boolean) => void;
  onOpenReport?: (row: CompetitorWatchRow) => void;
  testID?: string;
}

export function CompetitorWatchSection({
  brandId,
  venueListingId,
  venueCity = null,
  offline,
  testID = "competitor-watch",
}: CompetitorWatchSectionProps): React.ReactElement {
  const watch = useCompetitorWatch(brandId, venueListingId);
  const rows = watch.data ?? [];
  const venue = useVenueListing(venueListingId);
  const remove = useRemoveCompetitor(brandId, venueListingId);
  const [briefRow, setBriefRow] = useState<CompetitorWatchRow | null>(null);
  const [editRow, setEditRow] = useState<CompetitorWatchRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [removeRow, setRemoveRow] = useState<CompetitorWatchRow | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const atCap = rows.length >= COMPETITOR_WATCH_CAP;
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.cap}>COMPETITION</Text>
          <Text accessibilityRole="header" style={styles.pageTitle}>
            Keep an eye on nearby venues
          </Text>
          <Text style={styles.support}>
            Sourced weekly public observations and one useful next move.
          </Text>
        </View>
        <Text style={styles.count}>{`Watching ${rows.length} of 5`}</Text>
      </View>
      {offline ? (
        <Text style={styles.banner} testID={`${testID}-banner-offline`}>
          {rows.length
            ? "You're offline — showing the last update."
            : "Connect to load competitor insights."}
        </Text>
      ) : null}
      {feedback ? (
        <Text accessibilityLiveRegion="polite" style={styles.banner}>
          {feedback}
        </Text>
      ) : null}
      {watch.isLoading ? (
        <View
          testID={`${testID}-loading`}
          accessibilityLabel="Loading competitor watch"
          accessibilityLiveRegion="polite"
        >
          {[0, 1, 2].map((v) => (
            <GlassCard key={v} variant="base" contentStyle={styles.skeleton}>
              <ActivityIndicator color={textTokens.tertiary} />
            </GlassCard>
          ))}
        </View>
      ) : null}
      {watch.isError ? (
        <GlassCard variant="base">
          <Text style={styles.error}>
            {rows.length
              ? "Couldn't refresh competitor status. Try again."
              : "Couldn't load competitor insights."}
          </Text>
          <Button
            label="Try again"
            variant="primary"
            size="md"
            disabled={offline}
            onPress={() => void watch.refetch()}
          />
        </GlassCard>
      ) : null}
      {!watch.isLoading && !watch.isError && rows.length === 0 ? (
        <GlassCard variant="base" testID={`${testID}-empty`}>
          <CompetitionEmptyIcon />
          <Text style={styles.rowName}>Your competitor watch starts here</Text>
          <Text style={styles.support}>
            Add a nearby venue and we&apos;ll turn its public activity into a
            source-backed weekly brief.
          </Text>
          <Button
            label="Watch a competitor"
            variant="primary"
            size="md"
            fullWidth
            disabled={offline}
            onPress={() => setAddOpen(true)}
            testID={`${testID}-empty-add`}
          />
          {offline ? (
            <Text style={styles.support}>Reconnect to add a competitor.</Text>
          ) : null}
        </GlassCard>
      ) : null}
      {rows.map((row) => (
        <CompetitorRow
          key={row.id}
          row={row}
          brandId={brandId}
          venueListingId={venueListingId}
          menuOpen={menuId === row.id}
          offline={offline}
          onOpen={() => {
            setBriefRow(row);
            captureCompetitorIntelligenceEvent("competitor_brief_opened", {
              watch_id: row.id,
              schema_version: 2,
            });
          }}
          onMenu={() => setMenuId(menuId === row.id ? null : row.id)}
          onEdit={() => {
            setMenuId(null);
            setEditRow(row);
          }}
          onRemove={() => {
            setMenuId(null);
            setRemoveRow(row);
          }}
          onFeedback={setFeedback}
          testID={`${testID}-row-${row.id}`}
        />
      ))}
      {!watch.isLoading && !watch.isError && rows.length > 0 ? (
        <View style={styles.add}>
          {atCap ? (
            <Text style={styles.count} testID={`${testID}-cap`}>
              Watching 5 of 5. Stop watching one to add another.
            </Text>
          ) : (
            <Button
              label="Watch a competitor"
              variant="secondary"
              size="md"
              fullWidth
              disabled={offline}
              onPress={() => setAddOpen(true)}
              testID={`${testID}-add`}
            />
          )}
        </View>
      ) : null}
      {briefRow ? (
        <CompetitorBriefSheet
          visible
          onClose={() => setBriefRow(null)}
          brandId={brandId}
          venueName={venue.data?.name ?? null}
          row={briefRow}
        />
      ) : null}
      {editRow ? (
        <CompetitorAddSheet
          visible
          onClose={() => setEditRow(null)}
          brandId={brandId}
          venueListingId={venueListingId}
          venueCity={editRow.city ?? null}
          initialRow={editRow}
          offline={offline}
        />
      ) : null}
      {addOpen ? (
        <CompetitorAddSheet
          visible
          onClose={() => setAddOpen(false)}
          brandId={brandId}
          venueListingId={venueListingId}
          venueCity={venueCity}
          offline={offline}
        />
      ) : null}
      <ConfirmDialog
        visible={removeRow !== null}
        onClose={() => setRemoveRow(null)}
        title={`Stop watching ${removeRow?.name ?? "this competitor"}?`}
        description="This removes saved sources and live competitor briefs. Any check in progress will stop. Re-adding starts fresh."
        confirmLabel="Stop watching"
        destructive
        confirmLoading={remove.isPending}
        errorMessage={
          remove.isError ? "Couldn't stop watching — try again." : null
        }
        onConfirm={() => {
          if (!removeRow) return;
          if (offline) {
            const copy =
              "You're offline. Reconnect to stop watching this competitor.";
            setFeedback(copy);
            setRemoveRow(null);
            AccessibilityInfo.announceForAccessibility(copy);
            return;
          }
          remove.mutate(
            {
              competitorId: removeRow.id,
              expectedUpdatedAt: removeRow.updatedAt ?? "",
            },
            {
              onSuccess: () => {
                const copy = `Stopped watching ${removeRow.name}.`;
                setRemoveRow(null);
                AccessibilityInfo.announceForAccessibility(copy);
              },
            },
          );
        }}
        testID="competitor-remove-confirm"
      />
    </View>
  );
}

function CompetitionEmptyIcon(): React.ReactElement {
  return (
    <View style={styles.emptyIcon}>
      <React.Suspense fallback={null}>
        <CompetitionEmptyIconAsset
          name="eye"
          size={20}
          color={textTokens.primary}
        />
      </React.Suspense>
    </View>
  );
}

function CompetitorRow({
  row,
  brandId,
  venueListingId,
  menuOpen,
  offline,
  onOpen,
  onMenu,
  onEdit,
  onRemove,
  onFeedback,
  testID,
}: {
  row: CompetitorWatchRow;
  brandId: string | null;
  venueListingId: string | null;
  menuOpen: boolean;
  offline: boolean;
  onOpen: () => void;
  onMenu: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onFeedback: (copy: string) => void;
  testID: string;
}): React.ReactElement {
  const label = freshnessLabel(row);
  const reason = row.sources?.find((s) => s.safeReason)?.safeReason;
  const actionLabel =
    row.manualRefreshState === "available"
      ? row.freshness === "stale"
        ? "Refresh now"
        : row.freshness === "needs_attention"
          ? "Try again"
          : null
      : null;
  const tiktok = row.sources?.find((source) => source.kind === "tiktok");
  const accessible = `${row.name}${row.city ? `, ${row.city}` : ""}. ${label}. This week: ${row.summary?.whatChanged ?? stateCopy(row)}. Worth doing next: ${row.summary?.primaryAction ?? "No action yet"}. ${row.lastBriefUpdatedAt ? `Updated ${formatTime(row.lastBriefUpdatedAt)}.` : ""} Open weekly brief.`;
  return (
    <GlassCard variant="base" contentStyle={styles.card} testID={testID}>
      <View style={styles.rowHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {row.name.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.rowName}>{row.name}</Text>
          {row.city ? <Text style={styles.count}>{row.city}</Text> : null}
        </View>
        <Text style={styles.badge} testID={`${testID}-status`}>
          {label}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More options for ${row.name}`}
          onPress={onMenu}
          style={styles.menuButton}
          testID={`${testID}-menu`}
        >
          <Text style={styles.menuText}>•••</Text>
        </Pressable>
      </View>
      <View
        accessibilityElementsHidden={!menuOpen}
        importantForAccessibility={menuOpen ? "auto" : "no-hide-descendants"}
        style={[styles.menu, !menuOpen ? styles.menuHidden : null]}
      >
        <Button
          label="Edit sources"
          variant="ghost"
          size="md"
          disabled={offline}
          onPress={onEdit}
          testID={`${testID}-edit`}
        />
        {row.sources?.find((source) => source.kind === "tiktok") ? (
          <Button
            label="Open TikTok"
            variant="secondary"
            size="md"
            accessibilityLabel={`Open ${row.name} on TikTok, opens outside Mingla`}
            onPress={() =>
              openCompetitorPublicUrl(
                row.sources?.find((source) => source.kind === "tiktok")?.url ??
                  "",
              )
            }
            testID={`${testID}-open-tiktok`}
          />
        ) : null}
        <Button
          label="Stop watching"
          variant="ghost"
          size="md"
          disabled={offline}
          onPress={onRemove}
          testID={`${testID}-stop`}
        />
      </View>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={accessible}
        style={styles.summary}
        testID={`${testID}-open`}
      >
        <Text style={styles.cap}>THIS WEEK</Text>
        <Text style={styles.changed}>
          {row.summary?.whatChanged ?? stateCopy(row)}
        </Text>
        {row.summary?.primaryAction ? (
          <>
            <Text style={styles.cap}>WORTH DOING NEXT</Text>
            <Text style={styles.support}>{row.summary.primaryAction}</Text>
          </>
        ) : null}
      </Pressable>
      <View style={styles.sources}>
        {(row.sources ?? []).map((source) => (
          <SourceChip
            key={source.kind}
            source={source}
            testID={`${testID}-source-${source.kind}`}
          />
        ))}
      </View>
      {reason ? <Text style={styles.support}>{safeReason(reason)}</Text> : null}
      <Text style={styles.count}>
        {[
          row.lastBriefUpdatedAt
            ? `${row.noMeaningfulChange ? "Last meaningful update" : "Updated"} ${formatTime(row.lastBriefUpdatedAt)}`
            : null,
          row.checkedAt ? `Checked ${formatTime(row.checkedAt)}` : null,
          row.nextRefreshAt
            ? `Next refresh ${formatCalendarTime(row.nextRefreshAt)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <View style={styles.actions}>
        {row.freshness === "link_only" && tiktok ? (
          <Button
            label="Open TikTok"
            accessibilityLabel={`Open ${row.name} on TikTok, opens outside Mingla`}
            variant="secondary"
            size="md"
            fullWidth
            onPress={() => openCompetitorPublicUrl(tiktok.url)}
          />
        ) : actionLabel ? (
          <ManualRefreshButton
            brandId={brandId}
            venueListingId={venueListingId}
            row={row}
            label={actionLabel}
            offline={offline}
            onFeedback={onFeedback}
            testID={testID}
          />
        ) : (
          <Button
            label="Open weekly brief"
            accessibilityLabel={`Open weekly brief for ${row.name}, ${label.toLowerCase()}`}
            variant="secondary"
            size="md"
            fullWidth
            onPress={onOpen}
          />
        )}
        {row.manualRefreshState === "joined" ? (
          <Text style={styles.support}>Refresh already in progress.</Text>
        ) : null}
        {row.manualRefreshState === "edit_required" ? (
          <Text style={styles.support}>Edit links to resume checking.</Text>
        ) : null}
        {row.manualRefreshState === "exhausted" ? (
          <Text style={styles.support}>
            We couldn&apos;t refresh this source again. Edit the link or wait
            for the next automatic check.
          </Text>
        ) : null}
      </View>
    </GlassCard>
  );
}
function ManualRefreshButton({
  brandId,
  venueListingId,
  row,
  label,
  offline,
  onFeedback,
  testID,
}: {
  brandId: string | null;
  venueListingId: string | null;
  row: CompetitorWatchRow;
  label: string;
  offline: boolean;
  onFeedback: (copy: string) => void;
  testID: string;
}): React.ReactElement {
  const refresh = useRefreshCompetitor(brandId, venueListingId);
  return (
    <Button
      label={label}
      variant="secondary"
      size="md"
      disabled={offline || refresh.isPending}
      loading={refresh.isPending}
      onPress={() =>
        refresh.mutate(
          { competitorId: row.id },
          {
            onSuccess: (result) => {
              const copy =
                result === "cached"
                  ? "You're already up to date."
                  : result === "joined"
                    ? "Refresh already in progress."
                    : "Checking public sources…";
              onFeedback(copy);
              AccessibilityInfo.announceForAccessibility(copy);
            },
            onError: (error) =>
              onFeedback(
                error.code === "rate_limited"
                  ? "Manual refresh limit reached. Automatic checking will continue."
                  : "Couldn't start the refresh — try again.",
              ),
          },
        )
      }
      testID={`${testID}-${label === "Refresh now" ? "refresh" : "retry"}`}
    />
  );
}
function SourceChip({
  source,
  testID,
}: {
  source: CompetitorSourceState;
  testID: string;
}): React.ReactElement {
  const text =
    source.kind === "tiktok"
      ? "TikTok · Link only"
      : source.availability === "paused"
        ? `${title(source.kind)} · Paused`
        : `${title(source.kind)} · ${source.health === "current" ? "Current" : title(source.health)}`;
  return (
    <View style={styles.chip} testID={testID}>
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}
function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
function freshnessLabel(row: CompetitorWatchRow): string {
  if (!row.lastBriefUpdatedAt && row.freshness === "refreshing")
    return "Preparing";
  return row.freshness === "budget_delayed"
    ? "Refresh delayed"
    : title(row.freshness ?? "stale");
}
function stateCopy(row: CompetitorWatchRow): string {
  if (row.noMeaningfulChange) return "No meaningful public change this week";
  if (row.freshness === "link_only")
    return "TikTok is saved as a link; it is not analyzed weekly.";
  if (row.freshness === "budget_delayed")
    return "Your next automatic check is delayed; no action needed.";
  if (row.freshness === "refreshing")
    return row.lastBriefUpdatedAt
      ? "Checking public sources…"
      : "Preparing your first sourced brief";
  return "We couldn't verify a new public change yet.";
}
function safeReason(code: string): string {
  return (
    (
      {
        private: "This profile isn't publicly available.",
        removed: "This profile or page is no longer available.",
        invalid: "This link no longer points to a supported profile.",
        unsupported: "Mingla can't analyze this source.",
        rate_limited: "The source asked us to wait before checking again.",
        unreachable: "We couldn't reach this source.",
        disabled: "Automatic checking is temporarily paused.",
        automatic_checking_paused: "Automatic checking is temporarily paused.",
      } as Record<string, string>
    )[code] ?? "We couldn't verify this."
  );
}
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 8) return `${days} days ago`;
  return date.toLocaleDateString();
}
export function formatCalendarTime(iso: string, nowMs = Date.now()): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const now = new Date(nowMs);
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const days = Math.round((day - today) / 86_400_000);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days >= 2 && days <= 6)
    return `${date.toLocaleDateString([], { weekday: "long" })}, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
const styles = StyleSheet.create({
  section: { gap: spacing.md, maxWidth: 760 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerCopy: { flex: 1, gap: spacing.sm },
  pageTitle: { ...typography.h2, color: textTokens.primary },
  cap: { ...typography.labelCap, color: textTokens.tertiary },
  support: { ...typography.bodySm, color: textTokens.secondary },
  count: { ...typography.caption, color: textTokens.tertiary },
  banner: { ...typography.bodySm, color: semantic.info },
  error: { ...typography.bodySm, color: semantic.error },
  skeleton: { height: 176, justifyContent: "center", alignItems: "center" },
  emptyIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: glass.tint.badge.idle,
  },
  card: { gap: spacing.md, padding: spacing.md + spacing.xs },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + spacing.xs,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.badge.idle,
  },
  avatarText: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  rowName: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  badge: {
    ...typography.caption,
    color: textTokens.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.badge,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  menuButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  menuText: { ...typography.body, color: textTokens.primary },
  menu: { alignSelf: "flex-end", gap: spacing.xs },
  menuHidden: { display: "none" },
  summary: { gap: spacing.sm, minHeight: 44 },
  changed: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  sources: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.badge,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipText: { ...typography.caption, color: textTokens.secondary },
  actions: { gap: spacing.sm, alignItems: "stretch" },
  add: { gap: spacing.xs, marginTop: spacing.sm },
});
export default CompetitorWatchSection;
