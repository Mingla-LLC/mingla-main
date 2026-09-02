import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useGuestRoster } from "../../hooks/useGuestRoster";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import type {
  GuestRosterFilter,
  GuestRosterPrimaryStatus,
  GuestRosterRow,
  GuestRosterSort,
} from "../../types/guestRoster";
import {
  GUEST_ROSTER_INVITATION_LABELS,
  GUEST_ROSTER_PRIMARY_LABELS,
} from "../../types/guestRoster";
import type { GuestRosterActionPreview } from "../../types/guestRoster";
import {
  createGuestRosterRequestId,
  executeGuestRosterAction,
  previewGuestRosterAction,
  setGuestRosterRsvpApproval,
} from "../../services/guestRosterService";
import {
  isRetryableRsvpRpcFailure,
  rsvpRpcFailureCopy,
} from "../../services/rsvpRpcFailure";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { IconChrome } from "../ui/IconChrome";
import { Input } from "../ui/Input";
import { Pill, type PillVariant } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";

const FILTERS: ReadonlyArray<{ key: GuestRosterFilter; label: string }> = [
  { key: "all", label: "All guests" },
  { key: "no_response", label: "Not responded" },
  { key: "confirmed", label: "Confirmed" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "delivery_failed", label: "Invite failed" },
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "maybe", label: "Maybe" },
  { key: "checked_in", label: "Checked in" },
  { key: "removed", label: "Removed" },
];

const SORTS: ReadonlyArray<{ key: GuestRosterSort; label: string }> = [
  { key: "action_priority", label: "Action priority" },
  { key: "recent_first", label: "Recent activity" },
  { key: "name_asc", label: "Name A–Z" },
  { key: "name_desc", label: "Name Z–A" },
];

const statusVariant = (status: GuestRosterPrimaryStatus): PillVariant => {
  if (status === "bought_ticket" || status === "going") return "live";
  if (status === "not_responded" || status === "awaiting_approval" || status === "waitlisted") return "warn";
  if (status === "invite_failed" || status === "denied" || status === "declined") return "error";
  if (status === "sending") return "info";
  if (status === "not_sent" || status === "suppressed_or_skipped") return "draft";
  return "accent";
};

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const relativeTime = (iso: string): string => {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const SummaryCard: React.FC<{
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}> = ({ label, count, selected, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={`${label}, ${count}`}
    onPress={onPress}
    style={({ pressed }) => [styles.summaryPressable, pressed && styles.pressed]}
  >
    <GlassCard
      padding={spacing.md}
      style={[styles.summaryCard, selected && styles.summaryCardSelected]}
      contentStyle={styles.summaryContent}
    >
      <Text style={styles.summaryCount}>{count}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </GlassCard>
  </Pressable>
);

const Avatar: React.FC<{ row: GuestRosterRow }> = ({ row }) => {
  if (row.avatarUrl !== null) {
    return <Image source={{ uri: row.avatarUrl }} style={styles.avatar} accessibilityLabel={`${row.displayName} avatar`} />;
  }
  return (
    <View style={styles.avatarFallback} accessibilityElementsHidden>
      <Text style={styles.avatarText}>{initials(row.displayName)}</Text>
    </View>
  );
};

const RosterRow: React.FC<{ row: GuestRosterRow; onPress: () => void; selectionMode: boolean; selected: boolean }> = ({ row, onPress, selectionMode, selected }) => {
  const invitationLabel = GUEST_ROSTER_INVITATION_LABELS[row.invitationStatus];
  const partyText = row.party.size > 1 ? `${row.party.size} people` : "1 person";
  const checkedText = row.party.checkedIn > 0 ? ` · ${row.party.checkedIn} checked in` : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selectionMode ? selected : undefined, disabled: selectionMode && !row.canRemind && !row.canRetry }}
      accessibilityLabel={`${row.displayName}, ${GUEST_ROSTER_PRIMARY_LABELS[row.primaryStatus]}${invitationLabel !== null ? `, ${invitationLabel}` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [styles.rowPressable, pressed && styles.pressed]}
    >
      <GlassCard padding={0} style={styles.rowCard} contentStyle={styles.rowContent}>
        {selectionMode ? <Text style={styles.selectionMark} accessibilityElementsHidden>{selected ? "●" : "○"}</Text> : null}
        <Avatar row={row} />
        <View style={styles.rowMain}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowName} numberOfLines={1}>{row.displayName}</Text>
            <Text style={styles.rowTime}>{relativeTime(row.latestActivityAt)}</Text>
          </View>
          {row.contactLabel !== null ? <Text style={styles.rowContact} numberOfLines={1}>{row.contactLabel}</Text> : null}
          <View style={styles.pillLine}>
            <Pill variant={statusVariant(row.primaryStatus)}>{GUEST_ROSTER_PRIMARY_LABELS[row.primaryStatus]}</Pill>
            {invitationLabel !== null && row.primaryStatus !== "not_sent" && row.primaryStatus !== "sending" && row.primaryStatus !== "invite_failed" ? (
              <Pill variant={row.invitationStatus === "invited" ? "info" : "draft"}>{invitationLabel}</Pill>
            ) : null}
          </View>
          <Text style={styles.rowMeta}>{partyText}{checkedText}</Text>
        </View>
        <Text style={styles.chevron} accessibilityElementsHidden>›</Text>
      </GlassCard>
    </Pressable>
  );
};

const GuestDetailSheet: React.FC<{
  row: GuestRosterRow | null;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
  actionsDisabled: boolean;
  actionPending: boolean;
  onPreviewAction: (action: "reminder" | "retry_delivery") => void;
  onApproval: (decision: "approve" | "deny") => void;
}> = ({ row, onClose, onOpenOrder, actionsDisabled, actionPending, onPreviewAction, onApproval }) => (
  <Sheet visible={row !== null} onClose={onClose} snapPoint="full">
    {row !== null ? (
      <ScrollView contentContainerStyle={styles.detailContent}>
        <View style={styles.detailHero}>
          <Avatar row={row} />
          <View style={styles.detailIdentity}>
            <Text style={styles.detailName}>{row.displayName}</Text>
            {row.contactLabel !== null ? <Text style={styles.detailContact}>{row.contactLabel}</Text> : null}
          </View>
        </View>
        <View style={styles.detailPills}>
          <Pill variant={statusVariant(row.primaryStatus)}>{GUEST_ROSTER_PRIMARY_LABELS[row.primaryStatus]}</Pill>
          {GUEST_ROSTER_INVITATION_LABELS[row.invitationStatus] !== null ? (
            <Pill variant={row.invitationStatus === "invited" ? "info" : "draft"}>
              {GUEST_ROSTER_INVITATION_LABELS[row.invitationStatus]}
            </Pill>
          ) : null}
        </View>
        {row.invitationStatus === "invited" ? (
          <Text style={styles.truthNote}>Sent to provider. This does not claim delivery, display, opening, or reading.</Text>
        ) : null}
        <Text style={styles.sectionTitle}>Invitation history</Text>
        {row.attempts.length === 0 ? (
          <Text style={styles.detailMuted}>No send attempt recorded.</Text>
        ) : row.attempts.map((attempt, index) => (
          <View key={`${attempt.channel}-${index}`} style={styles.attemptRow}>
            <Text style={styles.attemptChannel}>{attempt.channel.toUpperCase()}</Text>
            <Text style={styles.attemptStatus}>
              {attempt.providerAccepted ? "Sent to provider" : attempt.status.replaceAll("_", " ")}
              {attempt.reason !== null ? ` · ${attempt.reason.replaceAll("_", " ")}` : ""}
            </Text>
          </View>
        ))}
        <Text style={styles.sectionTitle}>Party and admission</Text>
        {row.rsvpStatus !== null ? (
          <Text style={styles.detailBody}>
            RSVP: {row.rsvpStatus.replaceAll("_", " ")}
            {row.rsvpApprovalStatus !== null ? ` · ${row.rsvpApprovalStatus.replaceAll("_", " ")}` : ""}
          </Text>
        ) : null}
        <Text style={styles.detailBody}>
          {row.party.size} {row.party.size === 1 ? "person" : "people"} · {row.party.activeTickets} active tickets · {row.party.checkedIn} checked in
        </Text>
        {row.canRemind || row.canRetry || row.canApprove || row.canDeny ? (
          <View style={styles.actionButtons}>
            {row.canRemind ? <Button variant="primary" label={actionPending ? "Checking reminder…" : "Preview reminder"} disabled={actionsDisabled || actionPending} onPress={() => onPreviewAction("reminder")} /> : null}
            {row.canRetry ? <Button variant="secondary" label={actionPending ? "Checking retry…" : "Preview delivery retry"} disabled={actionsDisabled || actionPending} onPress={() => onPreviewAction("retry_delivery")} /> : null}
            {row.canApprove ? <Button variant="primary" label={actionPending ? "Saving…" : "Approve RSVP"} disabled={actionsDisabled || actionPending} onPress={() => onApproval("approve")} /> : null}
            {row.canDeny ? <Button variant="secondary" label="Deny RSVP" disabled={actionsDisabled || actionPending} onPress={() => onApproval("deny")} /> : null}
            {actionsDisabled ? <Text style={styles.detailMuted}>Refresh the guest list before taking action.</Text> : null}
          </View>
        ) : null}
        {row.orderIds.length > 0 ? (
          <View style={styles.orderLinks}>
            <Text style={styles.sectionTitle}>Orders</Text>
            {row.orderIds.map((orderId, index) => (
              <Button key={orderId} variant="secondary" label={`Open order ${index + 1}`} onPress={() => onOpenOrder(orderId)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    ) : null}
  </Sheet>
);

export interface GuestRosterExperienceProps {
  eventId: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
  onExport: (input: { filter: GuestRosterFilter; search: string; sort: GuestRosterSort }) => void;
}

export const GuestRosterExperience: React.FC<GuestRosterExperienceProps> = ({
  eventId,
  onBack,
  onOpenOrder,
  onExport,
}) => {
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
  const [filter, setFilter] = useState<GuestRosterFilter>("all");
  const [sort, setSort] = useState<GuestRosterSort>("action_priority");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<GuestRosterRow | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<"reminder" | "retry_delivery" | null>(null);
  const [actionPreview, setActionPreview] = useState<GuestRosterActionPreview | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const executeRequest = useRef<{ previewId: string; clientRequestId: string } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim().length > 0 ? search : ""), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useGuestRoster({ eventId, enabled: true, filter, search: debouncedSearch, sort });
  const data = query.data;
  const summary = data?.summary;

  useEffect(() => {
    if (data === undefined) return;
    if (selected !== null) {
      const current = data.rows.find((row) => row.rosterKey === selected.rosterKey) ?? null;
      if (current !== selected) setSelected(current);
    }
    setSelectedKeys((current) => {
      const allowed = new Set(data.rows.filter((row) => row.canRemind || row.canRetry).map((row) => row.rosterKey));
      const next = new Set(Array.from(current).filter((key) => allowed.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [data, selected]);
  useEffect(() => {
    if (selectedKeys.size === 0) setBulkAction(null);
  }, [selectedKeys]);

  const cards = useMemo(() => [
    { key: "all" as const, label: "All guests", count: summary?.all ?? 0 },
    { key: "no_response" as const, label: "Not responded", count: summary?.notResponded ?? 0 },
    { key: "confirmed" as const, label: "Confirmed", count: summary?.confirmed ?? 0 },
    { key: "needs_attention" as const, label: "Needs attention", count: summary?.needsAttention ?? 0 },
  ], [summary]);

  const refresh = useCallback(() => { query.refreshFromFirstPage(); }, [query]);
  const loadMore = useCallback(() => { void query.fetchNextPage(); }, [query]);
  const previewAction = useCallback(async (action: "reminder" | "retry_delivery", rows?: GuestRosterRow[]) => {
    const targets = rows ?? (selected === null ? [] : [selected]);
    if (targets.length === 0 || query.isStaleTruth || query.isOffline) return;
    setActionPending(true); setActionMessage(null);
    const channels = Array.from(new Set(targets.flatMap((target) => target.attempts)
      .filter((attempt) => action === "reminder" || (attempt.status === "failed" && attempt.retryable))
      .map((attempt) => attempt.channel)));
    try {
      const preview = await previewGuestRosterAction({ eventId, action, rosterKeys: targets.map((target) => target.rosterKey), channels: channels.length > 0 ? channels : ["email"] });
      executeRequest.current = { previewId: preview.previewId, clientRequestId: createGuestRosterRequestId() };
      setActionPreview(preview);
    } catch {
      setActionMessage("This guest's status changed or the action is no longer available. Refresh and try again.");
      query.refreshFromFirstPage();
    } finally { setActionPending(false); }
  }, [eventId, query, selected]);

  const toggleSelected = useCallback((row: GuestRosterRow) => {
    const action = row.canRemind ? "reminder" : row.canRetry ? "retry_delivery" : null;
    if (action === null || (bulkAction !== null && bulkAction !== action)) return;
    setBulkAction((current) => current ?? action);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(row.rosterKey)) next.delete(row.rosterKey); else next.add(row.rosterKey);
      if (next.size === 0) setBulkAction(null);
      return next;
    });
  }, [bulkAction]);

  const executeAction = useCallback(async () => {
    if (actionPreview === null || query.isStaleTruth || query.isOffline) return;
    setActionPending(true); setActionMessage(null);
    const request = executeRequest.current?.previewId === actionPreview.previewId
      ? executeRequest.current
      : { previewId: actionPreview.previewId, clientRequestId: createGuestRosterRequestId() };
    executeRequest.current = request;
    try {
      await executeGuestRosterAction(request);
      setActionMessage("Queued. The guest's status will update when provider evidence arrives.");
      executeRequest.current = null;
      setActionPreview(null);
      setSelectedKeys(new Set()); setBulkAction(null); setSelectionMode(false);
      query.refreshFromFirstPage();
    } catch { setActionMessage("We couldn't confirm the queue result. Retry to check safely without creating a second send."); }
    finally { setActionPending(false); }
  }, [actionPreview, query]);

  const closePreview = useCallback(() => {
    executeRequest.current = null;
    setActionPreview(null);
  }, []);

  useEffect(() => {
    if (!query.isStaleTruth && !query.isOffline) return;
    executeRequest.current = null;
    setActionPreview(null);
  }, [query.isOffline, query.isStaleTruth]);

  const setApproval = useCallback(async (decision: "approve" | "deny") => {
    if (selected === null || query.isStaleTruth || query.isOffline) return;
    setActionPending(true); setActionMessage(null);
    try {
      await setGuestRosterRsvpApproval({ eventId, rosterKey: selected.rosterKey, decision, clientRequestId: createGuestRosterRequestId() });
      setActionMessage(decision === "approve" ? "RSVP approved." : "RSVP denied.");
      setSelected(null); query.refreshFromFirstPage();
    } catch (error) {
      // issue #3047 — this catch discarded the error entirely and asserted a
      // cause it had not checked: "The RSVP changed before this action." For the
      // TERMINAL 404 business_set_rsvp_guest_status returns in production today
      // that is simply false, and it invited an unbounded retry against a
      // function the server does not have. Read the real failure; only refetch
      // when a refetch could actually change the outcome.
      setActionMessage(
        rsvpRpcFailureCopy(error, decision === "approve" ? "approve this RSVP" : "decline this RSVP"),
      );
      if (isRetryableRsvpRpcFailure(error)) query.refreshFromFirstPage();
    }
    finally { setActionPending(false); }
  }, [eventId, query, selected]);

  return (
    <View style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}>
      <View style={styles.chromeRow}>
        <IconChrome icon="close" size={36} onPress={onBack} accessibilityLabel="Back" />
        <View style={styles.chromeTitleWrap}>
          <Text style={styles.chromeTitle}>Guests</Text>
          <Text style={styles.liveLabel}>{query.isFetching ? "Refreshing…" : "Live guest status"}</Text>
        </View>
        <View style={styles.chromeRight}>
          {data?.canBulkActions === true ? <Pressable accessibilityRole="button" accessibilityLabel={selectionMode ? "Finish selecting guests" : "Select guests"}
            onPress={() => { setSelectionMode((value) => !value); setSelectedKeys(new Set()); setBulkAction(null); }} style={styles.selectControl}>
            <Text style={styles.selectControlText}>{selectionMode ? "Done" : "Select"}</Text>
          </Pressable> : null}
          <IconChrome icon="search" size={36} onPress={() => setSearchOpen((value) => !value)} accessibilityLabel="Search guests" />
          <IconChrome icon="filter" size={36} onPress={() => setFiltersOpen(true)} accessibilityLabel="Filter and sort guests" />
          {data?.canExport === true && !query.isStaleTruth ? (
            <IconChrome icon="download" size={36} onPress={() => onExport({ filter, search: debouncedSearch, sort })} accessibilityLabel="Export current guest roster" />
          ) : null}
        </View>
      </View>

      {searchOpen ? (
        <View style={styles.searchWrap}>
          <Input value={search} onChangeText={setSearch} placeholder="Name, permitted contact, or order reference" variant="text" />
        </View>
      ) : null}

      {data !== undefined && (query.isStaleTruth || query.isOffline || query.isRefetchError) ? (
        <View style={styles.freshnessBanner} accessibilityRole="alert">
          <Text style={styles.freshnessTitle}>{query.isOffline ? "You're offline" : "Guest list may be out of date"}</Text>
          <Text style={styles.freshnessBody}>
            {query.isOffline ? "Last-known guests are shown. Reconnect, then refresh before taking action." : "Last-known guests are shown. Refresh before taking action."}
          </Text>
          <Button variant="secondary" label="Refresh" onPress={refresh} />
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, isWideDesktop && styles.contentDesktop, { paddingBottom: insets.bottom + 80 }]}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={accent.warm} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.summaryGrid, isWideDesktop && styles.summaryGridDesktop]}>
          {cards.map((card) => (
            <SummaryCard key={card.key} label={card.label} count={card.count} selected={filter === card.key} onPress={() => setFilter(card.key)} />
          ))}
        </View>

        {query.isLoading ? (
          <View style={styles.stateCard} accessibilityRole="progressbar">
            <Text style={styles.stateTitle}>Loading guest status…</Text>
            <Text style={styles.stateBody}>Matching invitations, RSVPs, tickets, and outcomes.</Text>
          </View>
        ) : query.isError ? (
          <View style={styles.stateCard}>
            <EmptyState illustration="ticket" title="Couldn't load guests" description="Nothing has been changed. Check your connection and try again." cta={{ label: "Try again", onPress: refresh, variant: "primary" }} />
          </View>
        ) : data === undefined || data.rows.length === 0 ? (
          <View style={styles.stateCard}>
            <EmptyState
              illustration={search.trim().length > 0 || filter !== "all" ? "search" : "ticket"}
              title={search.trim().length > 0 || filter !== "all" ? "No matching guests" : "No guests yet"}
              description={search.trim().length > 0 || filter !== "all" ? "Try a different search or filter." : "Invited people, RSVPs, and ticket buyers will appear here as real evidence arrives."}
              cta={search.trim().length > 0 || filter !== "all" ? { label: "Clear filters", onPress: () => { setSearch(""); setFilter("all"); }, variant: "secondary" } : undefined}
            />
          </View>
        ) : (
          <View style={[styles.list, isWideDesktop && styles.listDesktop]}>
            {data.rows.map((row) => <RosterRow key={row.rosterKey} row={row} selectionMode={selectionMode} selected={selectedKeys.has(row.rosterKey)}
              onPress={() => { if (selectionMode) toggleSelected(row); else setSelected(row); }} />)}
            {query.isFetchNextPageError ? (
              <View style={styles.loadMoreState} accessibilityRole="alert">
                <Text style={styles.detailMuted}>Couldn't load more guests.</Text>
                <Button variant="secondary" label="Refresh list" onPress={refresh} />
              </View>
            ) : query.hasNextPage ? (
              <View style={styles.loadMoreState}>
                <Button variant="secondary" label={query.isFetchingNextPage ? "Loading more guests" : "Load more guests"}
                  disabled={query.isFetchingNextPage} onPress={loadMore} />
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} snapPoint="half">
        <View style={styles.filterSheet}>
          <Text style={styles.sheetTitle}>Filter guests</Text>
          <View style={styles.optionWrap}>
            {FILTERS.map((item) => (
              <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`Filter guests by ${item.label}`} accessibilityState={{ selected: filter === item.key }} onPress={() => { setFilter(item.key); setFiltersOpen(false); }} style={[styles.option, filter === item.key && styles.optionSelected]}>
                <Text style={styles.optionText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sheetTitle}>Sort</Text>
          <View style={styles.optionWrap}>
            {SORTS.map((item) => (
              <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`Sort guests by ${item.label}`} accessibilityState={{ selected: sort === item.key }} onPress={() => { setSort(item.key); setFiltersOpen(false); }} style={[styles.option, sort === item.key && styles.optionSelected]}>
                <Text style={styles.optionText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Sheet>

      <GuestDetailSheet row={selected} onClose={() => { setSelected(null); setActionPreview(null); setActionMessage(null); }} onOpenOrder={onOpenOrder}
        actionsDisabled={query.isStaleTruth || query.isOffline} actionPending={actionPending}
        onPreviewAction={(action) => { void previewAction(action); }} onApproval={(decision) => { void setApproval(decision); }} />
      {selectionMode && selectedKeys.size > 0 && bulkAction !== null ? (
        <View style={[styles.bulkBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]} accessibilityRole="toolbar">
          <Text style={styles.bulkCount}>{selectedKeys.size} selected</Text>
          <Button variant="primary" label={bulkAction === "reminder" ? "Preview reminders" : "Preview retries"}
            disabled={query.isStaleTruth || query.isOffline || actionPending}
            onPress={() => { const rows = data?.rows.filter((row) => selectedKeys.has(row.rosterKey)) ?? []; void previewAction(bulkAction, rows); }} />
        </View>
      ) : null}
      <Sheet visible={actionPreview !== null} onClose={closePreview} snapPoint="half">
        {actionPreview !== null ? <View style={styles.filterSheet}>
          <Text style={styles.sheetTitle}>Confirm guest action</Text>
          <Text style={styles.detailBody}>{actionPreview.reachableCount} reachable · {actionPreview.suppressedCount} suppressed · {actionPreview.skippedCount} skipped</Text>
          <Text style={styles.detailBody}>Estimated cost: {actionPreview.currency === null ? "No paid channel cost" : `${actionPreview.currency} ${(actionPreview.estimatedCostMinor/100).toFixed(2)}`}</Text>
          <Button variant="primary" label={actionPending ? "Queueing…" : "Queue action"} disabled={actionPending || query.isStaleTruth || query.isOffline} onPress={() => { void executeAction(); }} />
          <Button variant="secondary" label="Cancel" disabled={actionPending} onPress={closePreview} />
        </View> : null}
      </Sheet>
      {actionMessage !== null ? <View style={styles.actionNotice} accessibilityRole="alert"><Text style={styles.detailBody}>{actionMessage}</Text></View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  chromeRow: { minHeight: 64, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chromeTitleWrap: { flex: 1 },
  chromeTitle: { color: textTokens.primary, fontSize: 24, lineHeight: 29, fontWeight: "800" },
  liveLabel: { color: textTokens.tertiary, fontSize: 12, marginTop: 1 },
  chromeRight: { flexDirection: "row", gap: spacing.xs },
  selectControl: { minHeight: 44, minWidth: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs },
  selectControlText: { color: accent.warm, fontSize: 13, fontWeight: "800" },
  searchWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  freshnessBanner: { marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radiusTokens.md, borderWidth: StyleSheet.hairlineWidth, borderColor: semantic.warning, backgroundColor: semantic.warningTint, gap: spacing.xs },
  freshnessTitle: { color: textTokens.primary, fontSize: 14, fontWeight: "800" },
  freshnessBody: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
  contentDesktop: { width: "100%", maxWidth: 1180, alignSelf: "center", paddingHorizontal: spacing.xl },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryGridDesktop: { flexWrap: "nowrap" },
  summaryPressable: { minWidth: 150, flexGrow: 1, flexBasis: "46%" },
  summaryCard: { height: 92 },
  summaryCardSelected: { borderColor: accent.warm, borderWidth: 1 },
  summaryContent: { gap: spacing.xs },
  summaryCount: { color: textTokens.primary, fontSize: 27, lineHeight: 31, fontWeight: "800" },
  summaryLabel: { color: textTokens.secondary, fontSize: 13, fontWeight: "700" },
  list: { gap: spacing.sm },
  listDesktop: { gap: spacing.sm },
  loadMoreState: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  rowPressable: { width: "100%" },
  rowCard: { minHeight: 104 },
  rowContent: { padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: glass.tint.profileBase },
  avatarFallback: { width: 48, height: 48, borderRadius: 24, backgroundColor: accent.tint, borderWidth: StyleSheet.hairlineWidth, borderColor: accent.border, alignItems: "center", justifyContent: "center" },
  avatarText: { color: textTokens.primary, fontSize: 15, fontWeight: "800" },
  selectionMark: { color: accent.warm, fontSize: 22, width: 24, textAlign: "center" },
  rowMain: { flex: 1, minWidth: 0, gap: 5 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowName: { color: textTokens.primary, fontSize: 16, lineHeight: 21, fontWeight: "800", flex: 1 },
  rowTime: { color: textTokens.tertiary, fontSize: 11 },
  rowContact: { color: textTokens.secondary, fontSize: 13 },
  pillLine: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  rowMeta: { color: textTokens.tertiary, fontSize: 12 },
  chevron: { color: textTokens.tertiary, fontSize: 28, marginLeft: spacing.xs },
  pressed: { opacity: 0.72 },
  stateCard: { minHeight: 250, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  stateTitle: { color: textTokens.primary, fontSize: 17, fontWeight: "800", textAlign: "center" },
  stateBody: { color: textTokens.secondary, fontSize: 14, textAlign: "center", marginTop: spacing.xs },
  filterSheet: { padding: spacing.lg, gap: spacing.md },
  sheetTitle: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: { borderRadius: radiusTokens.full, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: glass.tint.profileBase },
  optionSelected: { borderColor: accent.warm, backgroundColor: accent.tint },
  optionText: { color: textTokens.primary, fontSize: 13, fontWeight: "700" },
  detailContent: { padding: spacing.lg, paddingBottom: 80, gap: spacing.md },
  detailHero: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  detailIdentity: { flex: 1, gap: 3 },
  detailName: { color: textTokens.primary, fontSize: 24, lineHeight: 29, fontWeight: "800" },
  detailContact: { color: textTokens.secondary, fontSize: 14 },
  detailPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  truthNote: { color: textTokens.secondary, fontSize: 13, lineHeight: 19, padding: spacing.md, borderRadius: radiusTokens.md, backgroundColor: semantic.infoTint },
  sectionTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "800", marginTop: spacing.sm },
  detailMuted: { color: textTokens.tertiary, fontSize: 14 },
  detailBody: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
  attemptRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.border.profileBase, paddingVertical: spacing.sm, gap: 3 },
  attemptChannel: { color: textTokens.tertiary, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  attemptStatus: { color: textTokens.secondary, fontSize: 14, textTransform: "capitalize" },
  orderLinks: { gap: spacing.sm },
  actionButtons: { gap: spacing.sm, marginTop: spacing.sm },
  actionNotice: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.xl, padding: spacing.md, borderRadius: radiusTokens.md, backgroundColor: glass.tint.profileElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase },
  bulkBar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 72, paddingHorizontal: spacing.md, paddingTop: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: canvas.profile, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase },
  bulkCount: { flex: 1, color: textTokens.primary, fontSize: 14, fontWeight: "800" },
});

export default GuestRosterExperience;
