import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import { Skeleton } from "../ui/Skeleton";
import { useManualGroupBookPicker, useManualGroupMutations, useManualGroups } from "../../hooks/marketing/useManualGroups";
import type { ContactImportCounts, ContactImportResult } from "../../services/contactImportService";
import type { ManualGroupDetail, ManualGroupMember, ManualGroupSummary } from "../../types/marketing";
import { randomId } from "../../utils/randomId";
import { accent, canvas, glass, radius, semantic, spacing, text, typography } from "../../constants/designSystem";

const ContactImportFlow = React.lazy(async () => {
  const module = await import("../../features/contact-import/ContactImportFlow");
  return { default: module.ContactImportFlow };
});
const AddPersonSheet = React.lazy(async () => {
  const module = await import("./AddPersonSheet");
  return { default: module.AddPersonSheet };
});
const capturePeople = (event: string, properties: Record<string, unknown>): void => {
  void import("../../features/people/peopleAnalytics").then((analytics) => {
    analytics.capturePeople(event as Parameters<typeof analytics.capturePeople>[0], properties);
  });
};

type Step = "name" | "sources" | "book" | "upload" | "review";
type ImportCompletion = { batchId: string; counts: ContactImportCounts; personIds: string[]; outcomes: { added: string[]; updated: string[]; unchanged: string[] } };

const countBucket = (count: number): "0" | "1_10" | "11_50" | "51_100" | "101_plus" =>
  count === 0 ? "0" : count <= 10 ? "1_10" : count <= 50 ? "11_50" : count <= 100 ? "51_100" : "101_plus";

const normalizedName = (value: string): string => value.trim().replace(/\s+/g, " ");
const stableManualMutationRequest = (
  current: { key: string; id: string } | null,
  key: string,
  createId: () => string,
): { key: string; id: string } => current?.key === key ? current : { key, id: createId() };
const manualGroupDraftNameError = (name: string, existingNames: string[]): string | null => {
  const normalized = normalizedName(name).toLocaleLowerCase();
  if (!normalized) return "Enter a group name.";
  if ([...name].length > 60) return "Use 60 characters or fewer.";
  if (/\p{Cc}/u.test(name)) return "Remove control characters from the name.";
  if (normalized === "your book") return "Choose a name other than Your Book.";
  return existingNames.some((candidate) => normalizedName(candidate).toLocaleLowerCase() === normalized)
    ? "A Manual group already uses this name."
    : null;
};
const resultingManualMemberCount = (...personIdSets: string[][]): number =>
  new Set(personIdSets.flat()).size;
const manualGroupErrorCode = (caught: unknown): string =>
  caught !== null && typeof caught === "object" && "code" in caught && typeof caught.code === "string"
    ? caught.code
    : "manual_group_unknown";
const memberSummary = (person: ManualGroupMember): string =>
  person.contacts.find((contact) => contact.isPrimary)?.value ??
  person.contacts[0]?.value ??
  "Contact details unavailable";

export function ManualGroupsLoader({
  brandId,
  onState,
}: {
  brandId: string;
  onState: (state: {
    brandId: string;
    data: ManualGroupSummary[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  }) => void;
}): null {
  const groups = useManualGroups(brandId, true);
  React.useEffect(() => {
    onState({
      brandId,
      data: groups.data ?? [],
      isLoading: groups.isLoading,
      isError: groups.isError,
      refetch: groups.refetch,
    });
  }, [brandId, groups.data, groups.isError, groups.isLoading, groups.refetch, onState]);
  return null;
}

export function ManualGroupFlow({
  visible,
  brandId,
  online,
  group = null,
  onClose,
  onCompleted,
  onAddPerson,
}: {
  visible: boolean;
  brandId: string;
  online: boolean;
  group?: ManualGroupDetail | null;
  onClose: () => void;
  onCompleted: (group: ManualGroupSummary) => void;
  onAddPerson?: () => void;
}): React.ReactElement {
  const editing = group !== null;
  const [step, setStep] = React.useState<Step>(editing ? "sources" : "name");
  const [name, setName] = React.useState(group?.name ?? "");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [imports, setImports] = React.useState<ImportCompletion[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [nestedAddPersonOpen, setNestedAddPersonOpen] = React.useState(false);
  const [reviewPreview, setReviewPreview] = React.useState<{ resultingMemberCount: number; newMemberCount: number } | null>(null);
  const [reviewLoading, setReviewLoading] = React.useState(false);
  const [importHydration, setImportHydration] = React.useState<"idle" | "loading" | "error">("idle");
  const importRetry = React.useRef<ContactImportResult | null>(null);
  const hydrationGeneration = React.useRef(0);
  const picker = useManualGroupBookPicker(brandId, group?.groupId ?? null, search, visible && step === "book");
  const existingGroups = useManualGroups(brandId, visible && !editing);
  const mutations = useManualGroupMutations(brandId);
  const nameError = manualGroupDraftNameError(name, editing ? [] : existingGroups.data?.map((entry) => entry.name) ?? []);
  const pending = mutations.create.isPending || mutations.add.isPending;
  const requestIntent = React.useRef<{ key: string; id: string } | null>(null);
  const requestIdFor = (key: string): string => {
    const request = stableManualMutationRequest(requestIntent.current, key, randomId);
    requestIntent.current = request;
    return request.id;
  };

  React.useEffect(() => {
    if (!visible) {
      setStep(editing ? "sources" : "name");
      setName(group?.name ?? "");
      setSearch("");
      setSelected(new Set());
      setImports([]);
      setError(null);
      setDiscardOpen(false);
      setNestedAddPersonOpen(false);
      setReviewPreview(null);
      setReviewLoading(false);
      setImportHydration("idle");
      importRetry.current = null;
      hydrationGeneration.current += 1;
      requestIntent.current = null;
    }
  }, [editing, group?.name, visible]);

  const toggle = (person: ManualGroupMember): void => {
    if (person.isMember) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(person.personId)) next.delete(person.personId);
      else next.add(person.personId);
      return next;
    });
  };
  const hydrateImport = async (result: ContactImportResult): Promise<void> => {
    // ContactImportFlow owns getContactImportStatus pagination so this
    // composition callback always receives the complete opaque person-ID set.
    const generation = ++hydrationGeneration.current;
    setImportHydration("loading");
    importRetry.current = result;
    try {
      if (generation !== hydrationGeneration.current) return;
      const allRows = result.resultRows;
      if (allRows.length < result.resultPage.total) throw new Error("Incomplete import result");
      const outcomeIds = (outcome: "added" | "updated" | "unchanged"): string[] => allRows
      .filter((row) => row.outcome === outcome && typeof row.personId === "string")
      .map((row) => row.personId as string);
      setImports((current) => current.some((item) => item.batchId === result.batchId)
        ? current
        : [...current, { batchId: result.batchId, counts: result.counts, personIds: allRows.filter((row) => ["added", "updated", "unchanged"].includes(row.outcome) && typeof row.personId === "string").map((row) => row.personId as string), outcomes: { added: outcomeIds("added"), updated: outcomeIds("updated"), unchanged: outcomeIds("unchanged") } }]);
      setImportHydration("idle");
      importRetry.current = null;
      capturePeople("manual_group_import_completed", { surface: editing ? "detail" : "groups_sheet", source: "import", batchId: result.batchId, countBucket: countBucket(result.counts.rowCount) });
    } catch {
      if (generation !== hydrationGeneration.current) return;
      setImportHydration("error");
      setError("Your contacts are safe in Your Book, but we couldn’t prepare an exact group review.");
    }
  };
  const importCompleted = (result: ContactImportResult): void => { void hydrateImport(result); };
  const openReview = async (): Promise<void> => {
    if (!editing) { setStep("review"); return; }
    setReviewLoading(true);
    setError(null);
    try {
      const { previewManualGroupResult } = await import("../../services/marketing/manualGroupService");
      const preview = await previewManualGroupResult({ brandId, groupId: group.groupId,
        personIds: [...selected].sort(), importBatchIds: imports.map((item) => item.batchId).sort() });
      setReviewPreview(preview);
      setStep("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t prepare an exact group review.");
    } finally {
      setReviewLoading(false);
    }
  };
  const submit = async (): Promise<void> => {
    if (!online || pending || (!editing && nameError)) return;
    setError(null);
    try {
      const personIds = [...selected].sort(), importBatchIds = imports.map((item) => item.batchId).sort();
      const intentKey = JSON.stringify({ operation: editing ? "add" : "create", groupId: group?.groupId ?? null, name: normalizedName(name), personIds, importBatchIds });
      const result = editing
        ? await mutations.add.mutateAsync({ brandId, groupId: group.groupId, personIds, importBatchIds, clientRequestId: requestIdFor(intentKey) })
        : await mutations.create.mutateAsync({ brandId, name: normalizedName(name), personIds, importBatchIds, clientRequestId: requestIdFor(intentKey) });
      capturePeople(editing ? "manual_group_members_added" : "manual_group_create_completed", {
        surface: editing ? "detail" : "groups_sheet", source: selected.size > 0 ? "book_picker" : imports.length > 0 ? "import" : "empty",
        groupId: result.group.groupId, countBucket: countBucket(result.group.memberCount),
      });
      if (result.pendingReviewCount > 0) {
        capturePeople("manual_group_conflicts_pending", { surface: editing ? "detail" : "groups_sheet", groupId: result.group.groupId, countBucket: countBucket(result.pendingReviewCount) });
      }
      requestIntent.current = null; onCompleted(result.group);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't create this group. Nothing changed.");
      capturePeople("manual_group_create_failed", { surface: editing ? "detail" : "groups_sheet", errorCode: manualGroupErrorCode(caught) });
    }
  };

  const reviewCounts = imports.reduce((total, item) => ({
    added: total.added + item.counts.addedCount,
    updated: total.updated + item.counts.updatedCount,
    unchanged: total.unchanged + item.counts.unchangedCount,
    review: total.review + item.counts.reviewCount,
    rejected: total.rejected + item.counts.invalidCount + item.counts.duplicateCount,
    suppressed: total.suppressed + item.counts.alreadySuppressedCount,
  }), { added: 0, updated: 0, unchanged: 0, review: 0, rejected: 0, suppressed: 0 });
  const stagedIds = new Set([...selected, ...imports.flatMap((item) => item.personIds)]);
  const resultingMemberCount = editing
    ? reviewPreview?.resultingMemberCount ?? group.totalMembers
    : resultingManualMemberCount([], [...selected], imports.flatMap((item) => item.personIds));
  const selectedNewIds = new Set(selected);
  const uniqueImportOutcomeCount = (outcome: keyof ImportCompletion["outcomes"], claimed: Set<string>): number => {
    const ids = new Set(imports.flatMap((item) => item.outcomes[outcome]).filter((id) => !selectedNewIds.has(id) && !claimed.has(id)));
    ids.forEach((id) => claimed.add(id));
    return ids.size;
  };
  const claimedImportIds = new Set<string>();
  const uniqueImportAdded = uniqueImportOutcomeCount("added", claimedImportIds);
  const uniqueImportUpdated = uniqueImportOutcomeCount("updated", claimedImportIds);
  const uniqueImportUnchanged = uniqueImportOutcomeCount("unchanged", claimedImportIds);
  const hasStagedWork = (!editing && normalizedName(name).length > 0) || selected.size > 0 || imports.length > 0;
  const requestClose = (): void => { if (hasStagedWork) setDiscardOpen(true); else onClose(); };

  return (
    <Sheet visible={visible} onClose={pending ? () => undefined : requestClose} snapPoint="full" testID="manual-group-flow">
      <View style={styles.host}>
        <View style={styles.header}>
          {step !== (editing ? "sources" : "name") ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => setStep(step === "review" ? "sources" : step === "upload" || step === "book" ? "sources" : "name")} style={styles.iconButton}>
              <Icon name="chevL" size={20} color={text.primary} />
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{editing ? `Add people to ${group.name}` : step === "name" ? "Name group" : step === "sources" ? "Add people" : step === "book" ? "Select from Book" : step === "upload" ? "Upload contacts" : "Review"}</Text>
            {!editing ? <Text accessibilityLabel={`Step ${step === "name" ? 1 : step === "review" ? 3 : 2} of 3`} style={styles.step}>Step {step === "name" ? 1 : step === "review" ? 3 : 2} of 3</Text> : null}
          </View>
        </View>

        {step === "name" ? <View style={styles.body}>
          <Text style={styles.helper}>Give this group a name you’ll recognize when starting a campaign.</Text>
          <Text style={styles.inputLabel}>Group name</Text>
          <Input value={name} onChangeText={(value) => { setName(value); setError(null); }} maxLength={80} accessibilityLabel="Group name" />
          {(error || (name.length > 0 && nameError)) ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error ?? nameError}</Text> : null}
          <Button label="Continue" size="lg" fullWidth accentColor={accent.warm} disabled={!!nameError || existingGroups.isLoading || !online} onPress={() => { capturePeople("manual_group_source_selected", { surface: "groups_sheet", source: "empty" }); setStep("sources"); }} />
        </View> : null}

        {step === "sources" ? <View style={styles.body}>
          <Text style={styles.helper}>Choose one or both ways. Everyone uploaded is saved to Your Book first.</Text>
          <View style={styles.sourceRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Select from Book" onPress={() => { capturePeople("manual_group_source_selected", { surface: editing ? "detail" : "groups_sheet", source: "book_picker" }); setStep("book"); }} style={styles.sourceCard}>
              <Icon name="users" size={24} color={accent.warm} /><Text style={styles.sourceTitle}>Select from Book</Text><Text style={styles.helper}>Search and choose people already saved.</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Upload contacts" disabled={!online} onPress={() => { capturePeople("manual_group_source_selected", { surface: editing ? "detail" : "groups_sheet", source: "import" }); setStep("upload"); }} style={styles.sourceCard}>
              <Icon name="upload" size={24} color={accent.warm} /><Text style={styles.sourceTitle}>Upload contacts</Text><Text style={styles.helper}>Use the existing CSV import flow.</Text>
            </Pressable>
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.selection}>{selected.size} selected · {imports.length} completed {imports.length === 1 ? "upload" : "uploads"}</Text>
          {importHydration === "loading" ? <Text accessibilityLiveRegion="polite" style={styles.helper}>Preparing exact group counts…</Text> : null}
          {importHydration === "error" ? <Button label="Retry group review" variant="secondary" fullWidth onPress={() => { if (importRetry.current) void hydrateImport(importRetry.current); }} /> : null}
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
          <Button label={reviewLoading ? "Preparing review…" : editing ? "Review additions" : "Review group"} accentColor={accent.warm} loading={reviewLoading} disabled={importHydration !== "idle" || reviewLoading} fullWidth onPress={() => void openReview()} />
          {!editing ? <Button label="Create empty group" variant="ghost" fullWidth disabled={!online || pending} onPress={submit} /> : null}
        </View> : null}

        {step === "book" ? <View style={styles.flex}>
          <Input variant="search" value={search} onChangeText={(value) => { setSearch(value); if (value.trim()) capturePeople("manual_group_search_used", { surface: editing ? "detail" : "groups_sheet" }); }} placeholder="Search name, email or phone" clearable accessibilityLabel="Search name, email or phone" />
          <Text accessibilityLiveRegion="polite" style={styles.selection}>{selected.size} selected</Text>
          {picker.isLoading ? <View style={styles.skeletons}>{[0, 1, 2].map((item) => <Skeleton key={item} width="100%" height={58} radius="lg" />)}</View>
            : picker.isError ? <EmptyState title="Couldn’t load Your Book." cta={{ label: "Try again", onPress: () => void picker.refetch(), variant: "secondary" }} />
            : (picker.data?.rows.length ?? 0) === 0 ? <View style={styles.emptyRecovery}><EmptyState title={search ? "No people match this search." : "No one is in Your Book yet."} description={search ? "Your selections are still saved." : undefined} />{search ? <Button label="Clear search" variant="secondary" fullWidth onPress={() => setSearch("")} /> : <Button label="Upload contacts" accentColor={accent.warm} fullWidth onPress={() => setStep("upload")} />}{!search && (editing || onAddPerson) ? <Button label="Add person" variant="secondary" fullWidth onPress={() => { if (editing) setNestedAddPersonOpen(true); else onAddPerson?.(); }} /> : null}</View>
            : <FlatList data={picker.data?.rows ?? []} keyExtractor={(person) => person.personId} onEndReached={() => { if (picker.hasNextPage && !picker.isFetchingNextPage) void picker.fetchNextPage(); }} onEndReachedThreshold={0.4} ListFooterComponent={picker.isFetchingNextPage ? <Skeleton width="100%" height={58} radius="lg" /> : null} renderItem={({ item }) => {
              const checked = item.isMember === true || selected.has(item.personId);
              return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: item.isMember === true }} accessibilityLabel={`${item.displayName}, ${memberSummary(item)}`} onPress={() => toggle(item)} style={styles.personRow}>
                <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>{checked ? <Text style={styles.checkmark}>✓</Text> : null}</View>
                <View style={styles.personCopy}><Text style={styles.personName}>{item.displayName}</Text><Text style={styles.helper} numberOfLines={1}>{memberSummary(item)}</Text></View>
                {item.isMember ? <Text style={styles.already}>Already added</Text> : null}
              </Pressable>;
            }} />}
          <View style={styles.sticky}><Button label={`Keep ${selected.size} selected`} accentColor={accent.warm} fullWidth onPress={() => setStep("sources")} /></View>
        </View> : null}

        {step === "upload" ? <View style={styles.flex}><React.Suspense fallback={null}><ContactImportFlow brandId={brandId} context="manual_group" onCompleted={importCompleted} onViewBook={() => setStep("sources")} /></React.Suspense></View> : null}

        {step === "review" ? <View style={styles.body}>
          <GlassCard variant="base" style={styles.reviewCard}>
            <Text style={styles.sourceTitle}>{editing ? group.name : normalizedName(name)}</Text>
            <Text style={styles.stat}>{resultingMemberCount} resulting {resultingMemberCount === 1 ? "person" : "people"}</Text>
            <Text style={styles.helper}>{editing && reviewPreview ? `${reviewPreview.newMemberCount} new in this group · ` : ""}{selectedNewIds.size} selected from Book · {uniqueImportAdded} imported new · {uniqueImportUpdated} matched/updated · {uniqueImportUnchanged} already known</Text>
            <Text style={styles.warning}>{reviewCounts.review} need review. They are not members yet and do not increase campaign reach.</Text>
            <Text style={styles.helper}>{reviewCounts.rejected} rejected · {reviewCounts.suppressed} suppressed/ineligible</Text>
          </GlassCard>
          <Text style={styles.helper}>Nothing is sent now. You can change this group anytime.</Text>
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{imports.length > 0 && !editing ? "Your contacts are safe in Your Book, but we couldn’t create this group." : error}</Text> : null}
          {!online ? <Text style={styles.warning}>Offline — showing saved data. Connect to make changes.</Text> : null}
          <Button label={pending ? (editing ? "Adding…" : "Creating…") : editing ? "Add people" : "Create group"} accentColor={accent.warm} loading={pending} disabled={!online || pending || importHydration !== "idle" || (editing && stagedIds.size === 0)} fullWidth size="lg" onPress={submit} />
        </View> : null}
      </View>
      <Sheet visible={discardOpen} onClose={() => setDiscardOpen(false)} snapPoint="half" testID="manual-group-discard-confirm"><View style={styles.discard}><Text accessibilityRole="header" style={styles.title}>Discard this group setup?</Text><Text style={styles.helper}>Your selections will be cleared. Contacts already imported remain in Your Book.</Text><Button label="Keep editing" variant="secondary" fullWidth onPress={() => setDiscardOpen(false)} /><Button label="Discard setup" variant="destructive" fullWidth onPress={() => { requestIntent.current = null; setDiscardOpen(false); onClose(); }} /></View></Sheet>
      {editing && nestedAddPersonOpen ? <React.Suspense fallback={null}><AddPersonSheet visible onClose={() => setNestedAddPersonOpen(false)} brandId={brandId} online={online} authorized onCompleted={(result) => { if (result.person) setSelected((current) => new Set(current).add(result.person!.personId)); void picker.refetch(); }} /></React.Suspense> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover, paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  flex: { flex: 1, gap: spacing.sm }, body: { gap: spacing.md }, header: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, headerCopy: { flex: 1 }, title: { ...typography.h3, color: text.primary }, step: { ...typography.caption, color: text.tertiary },
  helper: { ...typography.bodySm, color: text.secondary }, error: { ...typography.bodySm, color: "#ff8e96" }, warning: { ...typography.bodySm, color: semantic.warning },
  inputLabel: { ...typography.caption, fontWeight: "600", color: text.secondary },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, sourceCard: { flex: 1, flexBasis: 142, minHeight: 142, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileBase, gap: spacing.sm },
  sourceTitle: { ...typography.body, fontWeight: "600", color: text.primary }, selection: { ...typography.bodySm, color: text.primary }, skeletons: { gap: spacing.sm },
  personRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: glass.border.profileBase }, checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: text.tertiary, alignItems: "center", justifyContent: "center" }, checkboxOn: { backgroundColor: accent.warm, borderColor: accent.warm }, checkmark: { color: canvas.discover, fontWeight: "700" }, personCopy: { flex: 1 }, personName: { ...typography.body, fontWeight: "600", color: text.primary }, already: { ...typography.caption, color: text.tertiary },
  sticky: { minHeight: 68, justifyContent: "center", paddingTop: spacing.sm }, reviewCard: { padding: spacing.md, gap: spacing.sm }, stat: { ...typography.statValue, color: text.primary },
  emptyRecovery: { gap: spacing.sm }, discard: { padding: spacing.md, gap: spacing.md },
});
