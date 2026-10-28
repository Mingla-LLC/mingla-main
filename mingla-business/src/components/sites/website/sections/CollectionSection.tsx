import React, { useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { Body, Card, CardTitle, Chip, Hint, ListBox, MiniButton, SectionHead, Segmented, Skeleton, WButton, ui } from "../ui";
import { WebsiteIcon, type WebsiteIconName } from "../WebsiteIcon";
import {
  BrandSiteContentConflict,
  COLLECTION_OF_SECTION,
  useCategoryActions,
  useContentList,
  useContentRowActions,
  useSitePages,
  useStoryCategories,
  type DestinationSummary,
  type EntrySummary,
  type ReviewSummary,
  type StorySummary,
} from "../../../../sites/contentApi";
import { COLLECTION_COPY, formatWebsiteDay } from "../../../../sites/websiteCopy";
import type { CollectionSection as CollectionKind } from "../../../../sites/websiteNav";
import { BrandSitesError } from "../../../../services/brandSitesService";

const EMPTY_ICON: Record<CollectionKind, WebsiteIconName> = { destinations: "pin", stories: "book", reviews: "quote" };

/** The site page that lists this collection ("Stamped destinations"), when there is one. */
export function useCollectionPageTitle(section: CollectionKind): string | null {
  const { controller } = useWebsite();
  const pages = useSitePages(controller.siteId);
  const kind = section === "reviews" ? null : section;
  return kind ? pages.data?.pages.find((page) => page.collection_kind === kind)?.title ?? null : null;
}

/**
 * #2829 W9r (DESIGN_SPEC §1.6) — destinations, stories and reviews share one
 * list: site order, move up/down (saved straight to the draft,
 * revision-checked), show/hide (an unconfirmed review can't be shown), the
 * row opens the editor. Phones show thumb, name and status; "Reorder" reveals
 * the controls.
 */
export function CollectionSection({ section }: { section: CollectionKind }): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, lock, toast } = ctx;
  const router = useRouter();
  const collection = COLLECTION_OF_SECTION[section];
  const list = useContentList(controller.siteId, collection);
  const actions = useContentRowActions(controller.siteId, collection);
  const categories = useStoryCategories(controller.siteId, section === "stories");
  const [reorder, setReorder] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [managing, setManaging] = useState(false);
  const pageTitle = useCollectionPageTitle(section);
  const copy = COLLECTION_COPY[section];
  const readOnly = lock.heldByOther;
  const entries = list.data?.entries ?? [];
  const shownEntries = useMemo(() => (section === "stories" && category !== "all"
    ? entries.filter((entry) => (entry as StorySummary).category === category)
    : entries), [category, entries, section]);

  const open = (id: string | "new") => ctx.go({ kind: "editor", section, entryId: id });

  const fail = (error: unknown, fallback: string) => toast(error instanceof BrandSiteContentConflict
    ? `${error.latest.updatedByName ?? "Someone"} changed this list just now. Here is the latest.`
    : error instanceof BrandSitesError ? error.message : fallback, "error");

  const move = (entry: EntrySummary, delta: -1 | 1) => {
    const ids = entries.map((row) => row.id);
    const index = ids.indexOf(entry.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length || !list.data) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    actions.reorder.mutate({ ids, listRevision: list.data.revision }, {
      onSuccess: () => toast(`${nameOf(section, entry)} moved to position ${target + 1}`, "success"),
      onError: (error) => fail(error, "The new order didn’t save. Try again."),
    });
  };

  const toggle = (entry: EntrySummary) => {
    if (section === "reviews" && !(entry as ReviewSummary).confirmed && !entry.enabled) {
      toast("Confirm this review is real before showing it");
      return;
    }
    actions.visibility.mutate({ id: entry.id, revision: entry.revision, enabled: !entry.enabled }, {
      onError: (error) => fail(error, "That didn’t save. Try again."),
    });
  };

  const header = (
    <SectionHead
      ref={headingRef}
      phone={phone}
      title={copy.title}
      subtitle={copy.subtitle(pageTitle)}
      right={(
        <>
          {phone && entries.length > 1 ? <WButton label={reorder ? "Done" : "Reorder"} size="sm" onPress={() => setReorder((value) => !value)} testID={`${section}-reorder`} /> : null}
          <WButton label={copy.add} icon="plus" variant="primary" onPress={() => open("new")} disabled={readOnly} testID={`${section}-add`} />
        </>
      )}
    />
  );

  if (list.isLoading) {
    return <View>{header}<View role="status" accessibilityLabel={`Loading ${copy.title.toLowerCase()}`}><Skeleton height={64} style={{ marginBottom: 2 }} /><Skeleton height={64} style={{ marginBottom: 2 }} /><Skeleton height={64} /></View></View>;
  }
  if (list.isError) {
    return (
      <View>
        {header}
        <Card>
          <CardTitle>{`Your ${copy.title.toLowerCase()} couldn't be loaded`}</CardTitle>
          <Hint>{list.error instanceof BrandSitesError ? list.error.message : "Check your connection and try again."}</Hint>
          <WButton label="Try again" size="sm" onPress={() => { void list.refetch(); }} style={{ alignSelf: "flex-start", marginTop: 12 }} />
        </Card>
      </View>
    );
  }
  if (entries.length === 0) {
    return (
      <View testID={`website-${section}`}>
        {header}
        <Card style={styles.empty} testID={`${section}-empty`}>
          <WebsiteIcon name={EMPTY_ICON[section]} size={32} color={ui.accent} />
          <CardTitle style={styles.center}>{copy.emptyTitle}</CardTitle>
          <Body style={styles.emptyBody}>{copy.emptyBody(pageTitle)}</Body>
          <View style={styles.emptyActions}>
            <WButton label={copy.emptyAction} variant="primary" onPress={() => open("new")} disabled={readOnly} testID={`${section}-add-first`} />
            <WButton label="Draft with Ari" icon="spark" onPress={() => router.push(`/brand/${ctx.brandId}/website/ari` as never)} testID={`${section}-ari`} />
          </View>
        </Card>
      </View>
    );
  }
  return (
    <View testID={`website-${section}`}>
      {header}
      {section === "stories" ? (
        <View style={styles.filters}>
          <Segmented
            label="Category"
            compact
            options={[{ value: "all", label: "All" }, ...(categories.data?.categories ?? []).map((row) => ({ value: row.id, label: row.title }))]}
            value={category}
            onChange={setCategory}
            testIDPrefix="story-category"
          />
          <WButton label="Manage categories" size="sm" onPress={() => setManaging(true)} disabled={readOnly} testID="stories-manage-categories" />
        </View>
      ) : null}
      <ListBox>
        {shownEntries.map((entry) => {
          const index = entries.indexOf(entry);
          const showControls = !phone || reorder;
          return (
            // The row opens the editor; the move/show buttons are siblings
            // (a pressable inside a pressable flattens what screen readers see).
            <View key={entry.id} style={styles.row}>
              <Pressable
                onPress={() => open(entry.id)}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={`${nameOf(section, entry)}, ${statusOf(section, entry).label}. Open to edit`}
                testID={`${section}-row-${entry.id}`}
                style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.rowMain, hovered ? styles.rowHover : null]}
              >
                {!phone ? <WebsiteIcon name="drag" size={16} color={ui.t4} /> : null}
                {section !== "reviews" ? (
                  entry.thumb_url ? <Image source={{ uri: entry.thumb_url }} style={styles.thumb} accessibilityIgnoresInvertColors /> : <View style={styles.thumb} />
                ) : null}
                <View style={styles.grow}>
                  <Text style={[styles.title, section === "reviews" ? styles.quote : null]} numberOfLines={section === "reviews" ? 3 : 2}>
                    {section === "reviews" ? `\u201c${(entry as ReviewSummary).quote}\u201d` : nameOf(section, entry)}
                  </Text>
                  {subLines(section, entry, categories.data?.categories ?? []).map((line) => (
                    <Text key={line.text} style={[styles.sub, line.warn ? styles.subWarn : null]} numberOfLines={2}>{line.text}</Text>
                  ))}
                </View>
                <Chip label={statusOf(section, entry).label} tone={statusOf(section, entry).tone} />
              </Pressable>
              {showControls ? (
                <View style={styles.minis}>
                  <MiniButton icon="up" label={`Move ${nameOf(section, entry)} up`} onPress={() => move(entry, -1)} disabled={index <= 0 || readOnly || actions.reorder.isPending || category !== "all"} testID={`${section}-up-${entry.id}`} />
                  <MiniButton icon="down" label={`Move ${nameOf(section, entry)} down`} onPress={() => move(entry, 1)} disabled={index >= entries.length - 1 || readOnly || actions.reorder.isPending || category !== "all"} testID={`${section}-down-${entry.id}`} />
                  <MiniButton
                    icon={entry.enabled ? "eye" : "eyeoff"}
                    label={`${entry.enabled ? "Hide" : "Show"} ${section === "reviews" ? `review by ${(entry as ReviewSummary).reviewer}` : nameOf(section, entry)}`}
                    onPress={() => toggle(entry)}
                    disabled={readOnly || actions.visibility.isPending}
                    testID={`${section}-toggle-${entry.id}`}
                  />
                </View>
              ) : null}
              <Pressable onPress={() => open(entry.id)} role="button" accessibilityLabel={`Open ${nameOf(section, entry)}`} hitSlop={10} style={styles.chevron}>
                <WebsiteIcon name="right" color={ui.t3} />
              </Pressable>
            </View>
          );
        })}
      </ListBox>
      {section === "destinations" ? <Text style={styles.help}>Hidden destinations keep their page address but aren&apos;t linked or listed. Reorder with the arrows{phone ? "" : ", or drag the handle"}.</Text> : null}
      {section === "stories" ? <CategoriesDialog visible={managing} onClose={() => setManaging(false)} /> : null}
    </View>
  );
}

export function nameOf(section: CollectionKind, entry: EntrySummary): string {
  if (section === "reviews") return `Review by ${(entry as ReviewSummary).reviewer || "a traveller"}`;
  return (entry as DestinationSummary | StorySummary).title || "Untitled";
}

export function statusOf(section: CollectionKind, entry: EntrySummary): { label: string; tone: "ok" | "neutral" | "warn" } {
  if (section === "reviews" && !(entry as ReviewSummary).confirmed) return { label: "Needs your confirmation", tone: "warn" };
  if (entry.enabled) return { label: "Shown", tone: "ok" };
  return { label: section === "stories" ? "Draft" : "Hidden", tone: "neutral" };
}

function subLines(section: CollectionKind, entry: EntrySummary, categories: readonly { id: string; title: string }[]): { text: string; warn?: boolean }[] {
  if (section === "destinations") {
    const row = entry as DestinationSummary;
    const facts = [
      row.trip_count ? `${row.trip_count} Mingla ${row.trip_count === 1 ? "trip" : "trips"}` : null,
      `${row.photo_count} ${row.photo_count === 1 ? "photo" : "photos"}`,
    ].filter(Boolean).join(" · ");
    return [
      ...(row.tagline ? [{ text: row.tagline }] : []),
      { text: facts },
      ...(row.photos_missing_alt ? [{ text: `${row.photos_missing_alt} need a description`, warn: true }] : []),
    ];
  }
  if (section === "stories") {
    const row = entry as StorySummary;
    const categoryName = categories.find((item) => item.id === row.category)?.title;
    return [{ text: [categoryName, formatWebsiteDay(row.published_at)].filter(Boolean).join(" · ") }];
  }
  const row = entry as ReviewSummary;
  return [{ text: [row.reviewer, row.trip_name].filter(Boolean).join(" · ") }];
}

function CategoriesDialog({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const ctx = useWebsite();
  const categories = useStoryCategories(ctx.controller.siteId, visible);
  const actions = useCategoryActions(ctx.controller.siteId);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const rows = categories.data?.categories ?? [];
  const fail = (error: unknown) => ctx.toast(error instanceof BrandSitesError ? error.message : "That didn’t save. Try again.", "error");
  const move = (index: number, delta: -1 | 1) => {
    const ids = rows.map((row) => row.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length || !categories.data) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    actions.reorder.mutate({ ids, listRevision: categories.data.revision }, { onError: fail });
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} role="button" accessibilityLabel="Close">
        <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel="Story categories" onPress={() => undefined}>
          <Text style={styles.dialogTitle} role="heading">Story categories</Text>
          <Body>Add, rename and reorder. A category can be deleted once no story uses it.</Body>
          <View style={styles.categoryList}>
            {rows.map((row, index) => (
              <View key={row.id} style={styles.categoryRow}>
                {renaming?.id === row.id ? (
                  <TextInput
                    value={renaming.title}
                    onChangeText={(title) => setRenaming({ id: row.id, title })}
                    onSubmitEditing={() => actions.rename.mutate({ id: row.id, revision: row.revision, title: renaming.title }, { onSuccess: () => setRenaming(null), onError: fail })}
                    accessibilityLabel={`New name for ${row.title}`}
                    style={styles.input}
                    autoFocus
                  />
                ) : (
                  <View style={styles.grow}>
                    <Text style={styles.title}>{row.title}</Text>
                    <Hint>{`${row.story_count} ${row.story_count === 1 ? "story" : "stories"}`}</Hint>
                  </View>
                )}
                <MiniButton icon="up" label={`Move ${row.title} up`} onPress={() => move(index, -1)} disabled={index === 0} />
                <MiniButton icon="down" label={`Move ${row.title} down`} onPress={() => move(index, 1)} disabled={index === rows.length - 1} />
                {renaming?.id === row.id ? (
                  <WButton label="Save" size="sm" onPress={() => actions.rename.mutate({ id: row.id, revision: row.revision, title: renaming.title }, { onSuccess: () => setRenaming(null), onError: fail })} />
                ) : (
                  <WButton label="Rename" size="sm" onPress={() => setRenaming({ id: row.id, title: row.title })} />
                )}
                <MiniButton
                  icon="trash"
                  label={row.story_count > 0 ? `${row.title} is in use` : `Delete ${row.title}`}
                  onPress={() => actions.remove.mutate({ id: row.id, revision: row.revision }, { onError: fail })}
                  disabled={row.story_count > 0}
                />
              </View>
            ))}
          </View>
          <View style={styles.addRow}>
            <TextInput value={name} onChangeText={setName} placeholder="New category" placeholderTextColor={ui.t4} accessibilityLabel="New category name" style={[styles.input, styles.grow]} maxLength={80} />
            <WButton label="Add" size="sm" onPress={() => actions.create.mutate(name.trim(), { onSuccess: () => setName(""), onError: fail })} disabled={!name.trim()} loading={actions.create.isPending} testID="category-add" />
          </View>
          <View style={styles.dialogActions}><WButton label="Done" onPress={onClose} /></View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 140 },
  center: { textAlign: "center" },
  empty: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, gap: 10 },
  emptyBody: { textAlign: "center", maxWidth: 440 },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 6 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 10, minHeight: 64 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 4, minHeight: 64 },
  rowHover: { backgroundColor: ui.card2 },
  chevron: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
  thumb: { width: 56, height: 42, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" },
  title: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: ui.t1 },
  quote: { fontWeight: "500" },
  sub: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  subWarn: { color: "#fcd27a" },
  minis: { flexDirection: "row", gap: 4 },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 10 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 520, backgroundColor: "#16181c", borderWidth: 1, borderColor: ui.border2, borderRadius: 24, padding: 20 },
  dialogTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: ui.t1, marginBottom: 6 },
  categoryList: { marginTop: 12, gap: 8 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: ui.border2, backgroundColor: "rgba(255,255,255,0.03)", paddingHorizontal: 12, color: ui.t1, fontSize: 14 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 12 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 16 },
});
