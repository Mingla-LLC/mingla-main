import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import { Skeleton } from "../ui/Skeleton";
import { Toast } from "../ui/Toast";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import { useManualGroup, useManualGroupMutations } from "../../hooks/marketing/useManualGroupDetail";
import { randomId } from "../../utils/randomId";
import { accent, canvas, glass, semantic, spacing, text, typography } from "../../constants/designSystem";

// Loading the add/import workflow only when requested keeps its contact-import
// dependency graph out of the eager web chunk shared by People routes.
const loadManualGroupFlow = async () => {
  const module = await import("./ManualGroupFlow");
  return { default: module.ManualGroupFlow };
};
const ManualGroupFlow = createRetryableLazyErrorBoundary(loadManualGroupFlow, {
  accessibilityLiveRegion: "polite",
  loadingLabel: "Opening group members…",
});

const stableManualMutationRequest = (
  current: { key: string; id: string } | null,
  key: string,
  createId: () => string,
): { key: string; id: string } => current?.key === key ? current : { key, id: createId() };
const capturePeople = (event: string, properties: Record<string, unknown>): void => {
  void import("../../features/people/peopleAnalytics").then((analytics) => {
    analytics.capturePeople(event as Parameters<typeof analytics.capturePeople>[0], properties);
  });
};

type Dialog = "none" | "overflow" | "remove" | "rename" | "delete" | "delete_blocked";

export function ManualGroupDetail({
  brandId,
  groupId,
  online,
  authorized,
}: {
  brandId: string;
  groupId: string;
  online: boolean;
  authorized: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<Dialog>("none");
  const [rename, setRename] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [deleteBlockedCount, setDeleteBlockedCount] = React.useState(0);
  const requestIntent = React.useRef<{ key: string; id: string } | null>(null);
  const group = useManualGroup(brandId, groupId, search, authorized);
  const mutations = useManualGroupMutations(brandId);
  const data = group.data;

  React.useEffect(() => {
    if (data) {
      setRename(data.name);
      capturePeople("manual_group_viewed", { surface: "detail", groupId });
    }
  }, [data, groupId]);
  React.useEffect(() => {
    if (!authorized) {
      setAddOpen(false);
      setDialog("none");
      setSelected(new Set());
      requestIntent.current = null;
    }
  }, [authorized]);

  const mutate = async (operation: "remove" | "rename" | "delete"): Promise<void> => {
    if (!data || !online) return;
    setError(null);
    try {
      if (operation === "remove") {
        const personIds = [...selected].sort();
        const request = stableManualMutationRequest(requestIntent.current, JSON.stringify({ operation, groupId, personIds }), randomId);
        requestIntent.current = request;
        await mutations.remove.mutateAsync({ brandId, groupId, personIds, clientRequestId: request.id });
        requestIntent.current = null;
        capturePeople("manual_group_members_removed", { surface: "detail", groupId });
        setSelected(new Set()); setToast("People removed. They’re still in Your Book.");
      } else if (operation === "rename") {
        const request = stableManualMutationRequest(requestIntent.current, JSON.stringify({ operation, groupId, name: rename.trim() }), randomId);
        requestIntent.current = request;
        await mutations.rename.mutateAsync({ brandId, groupId, name: rename, clientRequestId: request.id });
        requestIntent.current = null;
        capturePeople("manual_group_renamed", { surface: "detail", groupId }); setToast("Group renamed.");
      } else {
        const request = stableManualMutationRequest(requestIntent.current, JSON.stringify({ operation, groupId }), randomId);
        requestIntent.current = request;
        const result = await mutations.deleteGroup.mutateAsync({ brandId, groupId, clientRequestId: request.id });
        if ("code" in result && result.code === "manual_group_delete_blocked") {
          requestIntent.current = null;
          setDeleteBlockedCount(result.blockingCampaignCount);
          capturePeople("manual_group_delete_blocked", { surface: "detail", groupId, errorCode: result.code });
          setDialog("delete_blocked");
          return;
        }
        requestIntent.current = null;
        capturePeople("manual_group_deleted", { surface: "detail", groupId });
        router.replace("/(tabs)/marketing/people" as never); return;
      }
      setDialog("none");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't save this change. Nothing changed.");
    }
  };

  if (!authorized) return <EmptyState title="You don’t have access to People." description="A marketing manager or brand admin can open this page." />;
  if (group.isLoading) return <View accessibilityLiveRegion="polite" style={styles.body}>{[0, 1, 2].map((row) => <Skeleton key={row} width="100%" height={64} radius="lg" />)}</View>;
  if (group.isError || !data) return <EmptyState title={!online ? "Connect to load groups." : "Couldn’t load this group."} cta={online ? { label: "Try again", onPress: () => void group.refetch(), variant: "secondary" } : undefined} />;
  const pending = mutations.remove.isPending || mutations.rename.isPending || mutations.deleteGroup.isPending;
  return <View style={styles.host}>
    {!online ? <Text accessibilityLiveRegion="polite" style={styles.offline}>Offline — showing saved data. Connect to make changes.</Text> : null}
    <View style={styles.hero}>
      <View style={styles.titleRow}><Text accessibilityRole="header" style={styles.title}>{data.name}</Text><View accessibilityLabel="Manual group" style={styles.badge}><Icon name="users" size={14} color={accent.warm}/><Text style={styles.badgeText}>Manual</Text></View></View>
      <Text style={styles.count}>{data.totalMembers} {data.totalMembers === 1 ? "person" : "people"}</Text>
      {data.pendingReviewCount > 0 ? <Text style={styles.warning}>{data.pendingReviewCount} need review. They are not members yet and do not increase campaign reach.</Text> : null}
      <View style={styles.actions}><Button label="Add people" leadingIcon="plus" accentColor={accent.warm} disabled={!online} onPress={() => setAddOpen(true)} /><Button label="Start campaign" variant="secondary" disabled={!online} onPress={() => { capturePeople("manual_group_campaign_started", { surface: "detail", groupId }); router.push(`/(tabs)/marketing/campaigns/compose?audience=manual:${groupId}` as never); }} /><Pressable accessibilityRole="button" accessibilityLabel="Group actions" hitSlop={8} disabled={!online} onPress={() => setDialog("overflow")} style={({ pressed }) => [styles.overflowButton, pressed ? styles.pressed : null]}><Icon name="moreH" size={20} color={text.primary} /></Pressable></View>
    </View>
    <GlassCard variant="base" style={styles.listCard}>
      <Input variant="search" value={search} onChangeText={(value) => { setSearch(value); if (value.trim()) capturePeople("manual_group_search_used", { surface: "detail", groupId }); }} placeholder="Search name, email or phone" clearable accessibilityLabel="Search group members" />
      {selected.size > 0 ? <View style={styles.selectionBar}><Text accessibilityLiveRegion="polite" style={styles.count}>{selected.size} selected</Text><Button label="Remove" variant="destructive" onPress={() => setDialog("remove")} /></View> : null}
      {data.members.length === 0 ? <EmptyState title={search ? "No people match this search." : "No people in this group yet."} description={search ? "Your selections are still saved." : "Add people from Your Book or upload contacts."} cta={search ? { label: "Clear search", onPress: () => setSearch(""), variant: "secondary" } : { label: "Add people", onPress: () => setAddOpen(true), variant: "secondary" }} />
            : <FlatList data={data.members} keyExtractor={(member) => member.personId} onEndReached={() => { if (group.hasNextPage && !group.isFetchingNextPage) void group.fetchNextPage(); }} onEndReachedThreshold={0.4} ListFooterComponent={group.isFetchingNextPage ? <Skeleton width="100%" height={58} radius="lg" /> : null} renderItem={({ item }) => {
          const checked = selected.has(item.personId); const contact = item.contacts.find((entry) => entry.isPrimary)?.value ?? item.contacts[0]?.value ?? "Contact details unavailable";
          return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`${item.displayName}, ${contact}`} onPress={() => setSelected((current) => { const next = new Set(current); if (next.has(item.personId)) next.delete(item.personId); else next.add(item.personId); return next; })} style={styles.memberRow}>
            <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>{checked ? <Text style={styles.checkmark}>✓</Text> : null}</View><View style={styles.memberCopy}><Text style={styles.memberName}>{item.displayName}</Text><Text style={styles.contact} numberOfLines={1}>{contact}</Text></View>{item.suppressions.length > 0 ? <Text style={styles.suppressed}>Suppressed</Text> : null}
          </Pressable>;
        }} />}
    </GlassCard>
    {addOpen ? <ManualGroupFlow visible brandId={brandId} online={online} group={data} onAddPerson={() => undefined} onClose={() => setAddOpen(false)} onCompleted={() => { setAddOpen(false); setToast("People added."); }} /> : null}
    <Sheet visible={dialog !== "none"} onClose={pending ? () => undefined : () => { setDialog("none"); setError(null); }} snapPoint="half" testID="manual-group-confirm-sheet"><View style={styles.dialog}>
      {dialog === "overflow" ? <><Text accessibilityRole="header" style={styles.dialogTitle}>Group actions</Text><Button label="Rename group" variant="secondary" leadingIcon="edit" disabled={!online} fullWidth onPress={() => setDialog("rename")} /><Button label="Delete group" variant="destructive" leadingIcon="trash" disabled={!online} fullWidth onPress={() => setDialog("delete")} /><Button label="Cancel" variant="ghost" fullWidth onPress={() => setDialog("none")} /></>
      : dialog === "delete_blocked" ? <><Text accessibilityRole="header" style={styles.dialogTitle}>This group is in use</Text><Text accessibilityLiveRegion="assertive" style={styles.contact}>{deleteBlockedCount} {deleteBlockedCount === 1 ? "campaign is" : "campaigns are"} still using “{data.name}”. Choose another audience or cancel {deleteBlockedCount === 1 ? "it" : "them"} before deleting this group.</Text><Button label="Open campaigns" variant="secondary" fullWidth onPress={() => { setDialog("none"); router.push("/(tabs)/marketing/campaigns" as never); }} /><Button label="Close" variant="ghost" fullWidth onPress={() => setDialog("none")} /></>
      : <><Text accessibilityRole="header" style={styles.dialogTitle}>{dialog === "rename" ? "Rename group" : dialog === "delete" ? `Delete “${data.name}”?` : `Remove ${selected.size} ${selected.size === 1 ? "person" : "people"}?`}</Text>
      {dialog === "rename" ? <View style={styles.renameField}><Text style={styles.fieldLabel}>Group name</Text><Input value={rename} onChangeText={setRename} accessibilityLabel="New group name" /></View> : <Text style={styles.contact}>{dialog === "delete" ? `This removes the group from People and future campaign pickers. All ${data.totalMembers} people stay in Your Book, and sent campaign history stays intact.` : `They’ll be removed from “${data.name}”, but they’ll stay in Your Book.`}</Text>}
      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}{error.includes("selected by") ? " Choose a different audience or cancel that campaign before deleting this group." : ""}</Text> : null}
      <Button label={pending ? "Saving…" : dialog === "rename" ? "Save name" : dialog === "delete" ? "Delete group" : "Remove from group"} variant={dialog === "delete" || dialog === "remove" ? "destructive" : "primary"} accentColor={dialog === "rename" ? accent.warm : undefined} loading={pending} disabled={pending || !online || (dialog === "rename" && !rename.trim())} fullWidth onPress={() => void mutate(dialog === "rename" ? "rename" : dialog === "delete" ? "delete" : "remove")} />
      <Button label="Cancel" variant="ghost" disabled={pending} fullWidth onPress={() => setDialog("none")} />
      </>}</View></Sheet>
    <View style={styles.toast}><Toast visible={toast !== null} kind="success" message={toast ?? ""} onDismiss={() => setToast(null)} /></View>
  </View>;
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover, padding: spacing.md, gap: spacing.md }, body: { padding: spacing.md, gap: spacing.sm }, offline: { ...typography.bodySm, color: semantic.warning }, hero: { gap: spacing.sm }, titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }, title: { ...typography.h1, color: text.primary, flexShrink: 1 }, badge: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: accent.border, backgroundColor: accent.tint }, badgeText: { ...typography.caption, fontWeight: "600", color: "#ffb47d" }, count: { ...typography.bodySm, color: text.secondary }, warning: { ...typography.bodySm, color: semantic.warning }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, listCard: { flex: 1, padding: spacing.md, gap: spacing.sm }, selectionBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, memberRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.border.profileBase }, checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: text.tertiary, alignItems: "center", justifyContent: "center" }, checkboxOn: { backgroundColor: accent.warm, borderColor: accent.warm }, checkmark: { color: canvas.discover, fontWeight: "700" }, memberCopy: { flex: 1 }, memberName: { ...typography.body, fontWeight: "600", color: text.primary }, contact: { ...typography.bodySm, color: text.secondary }, suppressed: { ...typography.caption, color: semantic.warning }, dialog: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md }, dialogTitle: { ...typography.h3, color: text.primary }, error: { ...typography.bodySm, color: "#ff8e96" }, toast: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.lg },
  renameField: { gap: spacing.xs }, fieldLabel: { ...typography.caption, fontWeight: "600", color: text.secondary }, overflowButton: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileBase }, pressed: { opacity: 0.72 },
});
