import React, { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space } from "../../../../constants/designSystem";
import { Sheet } from "../../../ui/Sheet";
import { Banner, Chip, Field, MiniButton, Skeleton, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { PhotoChooser } from "../PhotoField";
import { offeredSections, useSectionCatalog, type SectionField, type WorkspacePage, type WorkspaceSection } from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { markByOf, markLabel } from "../../../../sites/previewBridge";
import { addRowBlocked, feedNote, moveBlocked, removeBlocked, removeRowBlocked, splitRows } from "../../../../sites/sectionEdits";
import type { Workspace } from "./useWorkspace";
import { GroupLabel, PanelNote, parts } from "./parts";

/*
 * #4453 — Edit mode: the page picker, then this page's sections from top to
 * bottom. A row opens in place to its plain fields (saved as you type), its
 * layouts, its photos, "Looks good" while it is still a draft, move and
 * remove. Nothing here has a Save button; Undo puts any change back.
 */
export function EditPanel({ ws, onAskAri, onManagePages, onRenameInMenu }: {
  ws: Workspace;
  onAskAri: (section: WorkspaceSection) => void;
  onManagePages: () => void;
  /** Menu names are changed by Ari: this puts the request in Ari's box, ready to finish. */
  onRenameInMenu: (pageTitle: string) => void;
}): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const blocked = ws.readOnlyReason;
  return (
    <View style={parts.panelPad} testID="edit-panel">
      <PagePicker ws={ws} onManagePages={onManagePages} onRenameInMenu={onRenameInMenu} />
      <View style={parts.row}>
        <Text style={[styles.listTitle, parts.grow]} role="heading" aria-level={2}>Sections, top to bottom</Text>
        <WButton
          label="Add section"
          icon="plus"
          size="sm"
          onPress={() => (blocked ? ws.notify({ message: blocked, kind: "info" }) : setAdding(true))}
          accessibilityLabel={blocked ? `Add section. ${blocked}` : "Add section"}
          testID="edit-add-section"
        />
      </View>
      {ws.sectionsState === "loading" ? (
        <View role="status" accessibilityLabel="Loading this page's sections" testID="edit-loading">
          <Skeleton height={52} style={styles.skeleton} /><Skeleton height={52} style={styles.skeleton} /><Skeleton height={52} />
        </View>
      ) : ws.sectionsState === "error" ? (
        <Banner tone="err" icon="alert" title="This page’s sections couldn’t be loaded" body={ws.sectionsError instanceof BrandSitesError ? ws.sectionsError.message : "Your website isn’t affected. Check your connection and try again."} testID="edit-error">
          <WButton label="Try again" size="sm" onPress={ws.retry} testID="edit-retry" />
        </Banner>
      ) : ws.sections.length === 0 ? (
        <View style={[parts.box, styles.empty]} testID="edit-empty">
          <Text style={parts.title}>This page has no sections yet</Text>
          <Text style={parts.body}>Add the first one, or ask Ari to lay the page out for you.</Text>
          <WButton label="Add the first section" icon="plus" variant="primary" size="sm" onPress={() => (blocked ? ws.notify({ message: blocked, kind: "info" }) : setAdding(true))} style={styles.start} testID="edit-empty-add" />
        </View>
      ) : (
        ws.sections.map((section) => (
          <SectionRow key={section.id} ws={ws} section={section} open={ws.expandedId === section.id} onAskAri={() => onAskAri(section)} />
        ))
      )}
      <AddSectionSheet ws={ws} visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

function pageNote(page: WorkspacePage): string | null {
  if (page.ari_draft) return "Draft by Ari";
  if (!page.enabled) return "Off";
  if (!page.in_menu && page.path) return "Not in menu";
  return null;
}

/** Why this page cannot be turned off (null: it can). */
export function pageOffBlocked(page: WorkspacePage): string | null {
  if (!page.path) return "Your home page is always on.";
  if (page.ari_draft) return "This is a draft page from Ari. Publish or remove it under Manage pages and menu.";
  return null;
}

function PagePicker({ ws, onManagePages, onRenameInMenu }: { ws: Workspace; onManagePages: () => void; onRenameInMenu: (pageTitle: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  if (ws.pagesState === "loading") return <Skeleton height={44} />;
  if (ws.pagesState === "error" || !ws.page) {
    return (
      <Banner tone="err" icon="alert" title="Your pages couldn’t be loaded" body="Your website isn’t affected. Check your connection and try again." testID="pages-error">
        <WButton label="Try again" size="sm" onPress={ws.retry} />
      </Banner>
    );
  }
  const current = ws.page;
  const offBlocked = pageOffBlocked(current);
  return (
    <View testID="page-picker">
      <Text style={styles.label} nativeID="page-picker-label">Page</Text>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        role="button"
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Page: ${current.title}. ${open ? "Close the list" : "Choose another page"}`}
        testID="page-picker-toggle"
        style={styles.picker}
      >
        <Text style={[styles.pickerText, parts.grow]} numberOfLines={1}>{current.title}</Text>
        {current.unreviewed > 0 ? <Chip label={`${current.unreviewed} to read`} tone="warn" /> : null}
        <WebsiteIcon name={open ? "up" : "down"} size={16} color={ui.t2} />
      </Pressable>
      {open ? (
        <View style={styles.pageList} role="radiogroup" accessibilityRole="radiogroup" accessibilityLabel="Page">
          {ws.pages.map((entry) => {
            const on = entry.id === current.id;
            const note = pageNote(entry);
            return (
              <Pressable
                key={entry.id}
                onPress={() => { ws.selectPage(entry.id); setOpen(false); }}
                role="radio"
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityState={{ checked: on }}
                accessibilityLabel={[entry.title, note, entry.unreviewed > 0 ? `${entry.unreviewed} to read` : null].filter(Boolean).join(", ")}
                testID={`page-option-${entry.path || "home"}`}
                style={[styles.pageRow, on ? styles.pageRowOn : null]}
              >
                <Text style={[styles.pageTitle, parts.grow]} numberOfLines={1}>{entry.title}</Text>
                {note ? <Text style={parts.small}>{note}</Text> : null}
                {entry.unreviewed > 0 ? <Chip label={`${entry.unreviewed} to read`} tone="warn" /> : null}
              </Pressable>
            );
          })}
          <View style={styles.pageActions}>
            <WButton
              label={current.enabled ? `Turn ${current.title} off` : `Turn ${current.title} on`}
              size="sm"
              accessibilityLabel={offBlocked && current.enabled ? `Turn ${current.title} off. ${offBlocked}` : undefined}
              onPress={() => {
                if (ws.readOnlyReason) ws.notify({ message: ws.readOnlyReason, kind: "info" });
                else if (current.enabled && offBlocked) ws.notify({ message: offBlocked, kind: "info" });
                else void ws.togglePage(current, !current.enabled);
              }}
              testID="page-toggle-enabled"
            />
            {current.path ? <WButton label="Rename in menu" icon="spark" size="sm" onPress={() => { setOpen(false); onRenameInMenu(current.title); }} testID="page-rename-menu" /> : null}
            <WButton label="Manage pages and menu" icon="pages" size="sm" onPress={() => { setOpen(false); onManagePages(); }} testID="page-picker-manage" />
          </View>
          <Text style={[parts.small, styles.pageHelp]}>Manage pages and menu is where you add a page, change the menu’s order and take a page out of the menu.</Text>
        </View>
      ) : null}
    </View>
  );
}

function SectionRow({ ws, section, open, onAskAri }: { ws: Workspace; section: WorkspaceSection; open: boolean; onAskAri: () => void }): React.ReactElement {
  const by = markByOf(section);
  const ariWorking = ws.ariSectionId === section.id;
  const chip = markLabel(by, ariWorking);
  const selected = ws.selectedId === section.id;
  const upBlocked = ws.readOnlyReason ?? moveBlocked(ws.sections, section.id, -1);
  const downBlocked = ws.readOnlyReason ?? moveBlocked(ws.sections, section.id, 1);
  const say = (reason: string) => ws.notify({ message: reason, kind: "info" });
  return (
    <View style={[styles.sectionCard, selected ? styles.sectionCardOn : null]} testID={`section-row-${section.id}`}>
      <View style={styles.sectionHead}>
        <Pressable
          onPress={() => ws.select(open ? null : section.id, { expand: !open, scroll: !open })}
          role="button"
          accessibilityRole="button"
          aria-expanded={open}
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Edit section: ${section.label}${chip ? `. ${chip}` : ""}`}
          testID={`section-toggle-${section.id}`}
          style={styles.sectionToggle}
        >
          <WebsiteIcon name={open ? "down" : "right"} size={16} color={ui.t2} />
          <Text style={[styles.sectionTitle, parts.grow]} numberOfLines={1}>{section.label}</Text>
          {chip ? <Chip label={ariWorking ? "Ari is changing this" : "Read me"} tone={ariWorking ? "info" : "warn"} /> : null}
        </Pressable>
        <MoveButton icon="up" label={`Move ${section.label} up`} blocked={upBlocked} onPress={() => ws.move(section, -1)} onBlocked={say} testID={`section-up-${section.id}`} />
        <MoveButton icon="down" label={`Move ${section.label} down`} blocked={downBlocked} onPress={() => ws.move(section, 1)} onBlocked={say} testID={`section-down-${section.id}`} />
      </View>
      {open ? <SectionEditor ws={ws} section={section} onAskAri={onAskAri} madeByTeam={by === "team"} /> : null}
    </View>
  );
}

function MoveButton({ icon, label, blocked, onPress, onBlocked, testID }: {
  icon: "up" | "down"; label: string; blocked: string | null; onPress: () => void; onBlocked: (reason: string) => void; testID: string;
}): React.ReactElement {
  // Stays pressable when it cannot move, so the press says why.
  return (
    <View style={blocked ? styles.dim : null}>
      <MiniButton icon={icon} label={blocked ? `${label}. ${blocked}` : label} onPress={() => (blocked ? onBlocked(blocked) : onPress())} testID={testID} />
    </View>
  );
}

function SectionEditor({ ws, section, onAskAri, madeByTeam }: { ws: Workspace; section: WorkspaceSection; onAskAri: () => void; madeByTeam: boolean }): React.ReactElement {
  const [choosing, setChoosing] = useState<string | null>(null);
  const firstField = useRef<React.ElementRef<typeof Field> | null>(null);
  const readOnly = ws.readOnly;
  // Focus moves into the section that was just opened (keyboard and screen readers).
  // (Web only: on a phone this would throw the keyboard up over the page.)
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const timer = setTimeout(() => firstField.current?.focus?.(), 80);
    return () => clearTimeout(timer);
  }, [section.id]);
  const note = feedNote(section);
  const split = splitRows(section);
  const fieldInput = (field: SectionField, first: boolean) => {
    // #4572 item 11 — words a refused save kept are shown first, never wiped.
    const kept = ws.unsavedValue(section.id, field.key);
    const reason = kept === null ? null : ws.unsavedMessage(section.id, field.key);
    return (
      <View key={field.key}>
        <Field
          ref={first ? firstField : undefined}
          label={field.label}
          value={kept ?? field.value}
          onChangeText={(value) => ws.typeField(section, field.key, value)}
          multiline={
            field.kind === "multiline" || field.kind === "richtext"
          }
          max={field.max ?? undefined}
          editable={!readOnly}
          autoCapitalize={field.kind === "mingla_link" ? "none" : undefined}
          autoCorrect={field.kind === "mingla_link" ? false : undefined}
          keyboardType={field.kind === "mingla_link" ? "url" : undefined}
          placeholder={
            field.kind === "mingla_link"
              ? "https://host.usemingla.com/e/..."
              : undefined
          }
          help={
            field.kind === "richtext"
              ? "Plain paragraphs. Leave a blank line between them."
              : field.kind === "mingla_link"
                ? "Use another page on this site, or a Mingla brand or event link. The button stays hidden until this is set."
                : null
          }
          testID={`field-${section.id}-${field.key}`}
        />
        {kept !== null ? (
          <View style={styles.unsaved} role="alert" testID={`field-${section.id}-${field.key}-unsaved`}>
            <Text style={styles.unsavedText}>{`Not saved. ${reason ?? ""}`.trim()}</Text>
            <WButton label="Try again" size="sm" onPress={() => ws.retryField(section, field.key)} testID={`field-${section.id}-${field.key}-retry`} />
          </View>
        ) : null}
      </View>
    );
  };
  const cannotRemove = ws.readOnlyReason ?? removeBlocked(section);
  const draft = section.review?.state === "draft";
  return (
    <View style={styles.editor} testID={`section-editor-${section.id}`}>
      {madeByTeam ? <PanelNote tone="warn">Made by the Mingla team for your request. Read it, then choose Looks good.</PanelNote> : null}
      {split.own.map((field, index) => fieldInput(field, index === 0))}
      {split.lists.map(({ list, rows }) => {
        const cannotAdd = ws.readOnlyReason ?? addRowBlocked(list);
        const cannotRemove = ws.readOnlyReason ?? removeRowBlocked(list);
        return (
          <View key={list.name} style={styles.rows} testID={`rows-${section.id}-${list.name}`}>
            <GroupLabel>{list.label}</GroupLabel>
            {rows.map((row) => (
              <View key={row.index} style={styles.row} role="group" accessibilityLabel={`${list.item_label} ${row.index + 1}`}>
                <View style={parts.row}>
                  <Text style={[parts.small, parts.grow]}>{`${list.item_label} ${row.index + 1}`}</Text>
                  <MoveButton icon="up" label={`Move ${list.item_label} ${row.index + 1} up`} blocked={ws.readOnlyReason ?? (row.index === 0 ? "Already first." : null)} onPress={() => ws.listOp(section, { list: list.name, op: "move", index: row.index, to_index: row.index - 1 }, `Moved ${list.item_label} ${row.index + 1} up.`)} onBlocked={(reason) => ws.notify({ message: reason, kind: "info" })} testID={`row-up-${section.id}-${list.name}-${row.index}`} />
                  <MoveButton icon="down" label={`Move ${list.item_label} ${row.index + 1} down`} blocked={ws.readOnlyReason ?? (row.index === rows.length - 1 ? "Already last." : null)} onPress={() => ws.listOp(section, { list: list.name, op: "move", index: row.index, to_index: row.index + 1 }, `Moved ${list.item_label} ${row.index + 1} down.`)} onBlocked={(reason) => ws.notify({ message: reason, kind: "info" })} testID={`row-down-${section.id}-${list.name}-${row.index}`} />
                  <View style={cannotRemove ? styles.dim : null}>
                    <MiniButton
                      icon="trash"
                      label={cannotRemove ? `Remove ${list.item_label} ${row.index + 1}. ${cannotRemove}` : `Remove ${list.item_label} ${row.index + 1}. You can undo this.`}
                      onPress={() => (cannotRemove
                        ? ws.notify({ message: cannotRemove, kind: "info" })
                        : ws.listOp(section, { list: list.name, op: "remove", index: row.index }, `Removed ${list.item_label} ${row.index + 1}.`))}
                      testID={`row-remove-${section.id}-${list.name}-${row.index}`}
                    />
                  </View>
                </View>
                {row.fields.map((field) => fieldInput(field, false))}
              </View>
            ))}
            <WButton
              label={`Add ${list.item_label}`}
              icon="plus"
              size="sm"
              accessibilityLabel={cannotAdd ? `Add ${list.item_label}. ${cannotAdd}` : `Add ${list.item_label}`}
              onPress={() => (cannotAdd
                ? ws.notify({ message: cannotAdd, kind: "info" })
                : ws.listOp(section, { list: list.name, op: "add", after_index: rows.length ? rows.length - 1 : null }, `Added ${list.item_label} with starter words. Make it yours.`))}
              style={styles.start}
              testID={`row-add-${section.id}-${list.name}`}
            />
          </View>
        );
      })}
      {note ? <PanelNote testID={`section-feed-${section.id}`}>{note}</PanelNote> : null}
      {section.fields.length === 0 && !note ? <PanelNote>This section has no words of its own to edit.</PanelNote> : null}
      {section.layouts.length > 1 ? (
        <View>
          <GroupLabel>Layout</GroupLabel>
          <View style={[parts.wrap, styles.layouts]} role="radiogroup" accessibilityRole="radiogroup" accessibilityLabel={`Layout of ${section.label}`}>
            {section.layouts.map((layout) => {
              const on = layout.key === section.layout;
              return (
                <Pressable
                  key={layout.key}
                  onPress={() => ws.setLayout(section, layout.key)}
                  role="radio"
                  accessibilityRole="radio"
                  aria-checked={on}
                  accessibilityState={{ checked: on, disabled: readOnly }}
                  accessibilityLabel={layout.label}
                  testID={`layout-${section.id}-${layout.key}`}
                  style={[styles.layoutChip, on ? styles.layoutChipOn : null]}
                >
                  <Text style={styles.layoutText}>{layout.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {section.media.map((slot) => (
        <View key={slot.slot} style={styles.photoRow} testID={`photo-${section.id}-${slot.slot}`}>
          <View style={styles.photoThumb}>
            {slot.thumb_url
              ? <Image source={{ uri: slot.thumb_url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`${slot.label} photo`} />
              : <WebsiteIcon name="image" size={20} color={ui.t3} />}
          </View>
          <View style={parts.grow}>
            <Text style={styles.photoLabel}>{slot.label}</Text>
            <Text style={parts.small}>{slot.media_id ? "From your website’s files" : "Nothing chosen yet"}</Text>
          </View>
          {slot.media_id ? (
            <MiniButton icon="trash" label={`Take out ${slot.label}`} onPress={() => (ws.readOnlyReason ? ws.notify({ message: ws.readOnlyReason, kind: "info" }) : ws.setMedia(section, slot.slot, null))} testID={`photo-remove-${section.id}-${slot.slot}`} />
          ) : null}
          <WButton
            label={slot.media_id ? "Change" : "Choose"}
            size="sm"
            accessibilityLabel={`${slot.media_id ? "Change" : "Choose"}: ${slot.label}`}
            onPress={() => (ws.readOnlyReason ? ws.notify({ message: ws.readOnlyReason, kind: "info" }) : setChoosing(slot.slot))}
            testID={`photo-change-${section.id}-${slot.slot}`}
          />
        </View>
      ))}
      <View style={styles.editorActions}>
        {draft ? <WButton label="Looks good" icon="check" variant="primary" size="sm" onPress={() => ws.page && ws.looksGood(ws.page.id, [section.id])} testID={`section-ok-${section.id}`} /> : null}
        <WButton label="Ask Ari about this" icon="spark" size="sm" onPress={onAskAri} testID={`section-ask-${section.id}`} />
        <WButton
          label="Remove"
          icon="trash"
          variant="ghost"
          size="sm"
          accessibilityLabel={cannotRemove ? `Remove ${section.label}. ${cannotRemove}` : `Remove ${section.label}. You can undo this.`}
          onPress={() => (cannotRemove ? ws.notify({ message: cannotRemove, kind: "info" }) : ws.remove(section))}
          testID={`section-remove-${section.id}`}
        />
      </View>
      <PhotoChooser
        visible={choosing !== null}
        kind={choosing === "video" ? "video" : "image"}
        onClose={() => setChoosing(null)}
        onPick={(picked) => {
          const slot = choosing;
          setChoosing(null);
          if (slot) ws.setMedia(section, slot, picked);
        }}
      />
    </View>
  );
}

function AddSectionSheet({ ws, visible, onClose }: { ws: Workspace; visible: boolean; onClose: () => void }): React.ReactElement {
  const catalog = useSectionCatalog(ws.siteId, ws.page?.id ?? null, visible);
  const offered = catalog.data ? offeredSections(catalog.data, ws.sections) : null;
  const after = ws.selected ?? ws.sections[ws.sections.length - 1] ?? null;
  // A section that starts from a photo: choose the photo, then it is added.
  const [photoFor, setPhotoFor] = useState<{ type: string; label: string } | null>(null);
  return (
    <>
      <Sheet visible={visible} onClose={onClose} presentation="modal" snapPoint="full" testID="add-section-sheet">
        <View style={styles.sheet} accessibilityLabel="Add a section">
          <Text style={styles.sheetTitle} role="heading" aria-level={2}>Add a section</Text>
          <Text style={parts.body}>{after ? `It goes below “${after.label}” with starter words. You can move it afterwards.` : "It goes at the top of the page with starter words."}</Text>
          {catalog.isLoading ? <View role="status" accessibilityLabel="Loading sections"><Skeleton height={56} style={styles.skeleton} /><Skeleton height={56} /></View> : null}
          {catalog.isError ? (
            <Banner tone="err" icon="alert" title="The list of sections couldn’t be loaded" body="Check your connection and try again." testID="add-section-error">
              <WButton label="Try again" size="sm" onPress={() => { void catalog.refetch(); }} />
            </Banner>
          ) : null}
          {offered && offered.types.length === 0 ? <Text style={parts.body}>This design has no more sections to add. Ask Ari or the Mingla team for something custom.</Text> : null}
          {(offered?.types ?? []).map((entry) => (
            <Pressable
              key={entry.type}
              onPress={() => {
                onClose();
                if (entry.needs_photo) setPhotoFor({ type: entry.type, label: entry.label });
                else ws.add(entry.type, entry.label, after?.id ?? null);
              }}
              role="button"
              accessibilityRole="button"
              accessibilityLabel={`Add ${entry.label}. ${entry.description}${entry.needs_photo ? " You choose a photo first." : ""}`}
              testID={`add-section-${entry.type}`}
              style={styles.catalogRow}
            >
              <View style={parts.grow}>
                <Text style={parts.title}>{entry.label}</Text>
                <Text style={parts.small}>{entry.needs_photo ? `${entry.description} Starts from one of your photos.` : entry.description}</Text>
              </View>
              <WebsiteIcon name={entry.needs_photo ? "image" : "plus"} size={18} color={ui.t1} />
            </Pressable>
          ))}
          {offered?.coverNote ? <Text style={parts.small} testID="add-section-cover-note">{offered.coverNote}</Text> : null}
          <WButton label="Cancel" variant="ghost" onPress={onClose} testID="add-section-cancel" />
        </View>
      </Sheet>
      <PhotoChooser
        visible={photoFor !== null}
        onClose={() => setPhotoFor(null)}
        onPick={(picked) => {
          const wanted = photoFor;
          setPhotoFor(null);
          // #4575: a cover always goes first on its page (it replaces a page title there).
          if (wanted) ws.add(wanted.type, wanted.label, wanted.type === "hero" ? null : after?.id ?? null, picked.id);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // #4572 item 11 — the "Not saved" row under a field (error tint, a 44 px Try again).
  unsaved: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], marginTop: space[2], paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.sm, backgroundColor: color.errorTint, borderWidth: 1, borderColor: color.errorLine },
  unsavedText: { flex: 1, minWidth: 160, color: color.text1, fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: ui.t3, marginBottom: 6 },
  picker: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card },
  pickerText: { fontSize: 16, fontWeight: "600", color: ui.t1 },
  pageList: { marginTop: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.cardBorder, backgroundColor: ui.card, padding: 4, gap: 2 },
  pageRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: 10, borderRadius: radius.xs },
  pageRowOn: { backgroundColor: color.fill.railOn },
  pageTitle: { fontSize: 15, color: ui.t1 },
  pageActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, margin: 6 },
  pageHelp: { marginHorizontal: 6, marginBottom: 6 },
  listTitle: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: ui.t2 },
  skeleton: { marginBottom: 8 },
  empty: { gap: space[2] },
  start: { alignSelf: "flex-start" },
  sectionCard: { borderRadius: radius.sm, borderWidth: 1, borderColor: ui.cardBorder, backgroundColor: ui.card },
  sectionCardOn: { borderColor: color.infoText },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 6 },
  sectionToggle: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: 12, paddingRight: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: ui.t1 },
  dim: { opacity: 0.45 },
  editor: { paddingHorizontal: 12, paddingBottom: 12, gap: space[2], borderTopWidth: 1, borderTopColor: ui.cardBorder, paddingTop: space[3] },
  layouts: { marginTop: 6 },
  layoutChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1, borderColor: ui.border2 },
  layoutChipOn: { backgroundColor: color.fill.railOn, borderColor: ui.t2 },
  layoutText: { fontSize: 14, color: ui.t1 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 4 },
  photoThumb: { width: 56, height: 56, borderRadius: radius.xs, overflow: "hidden", backgroundColor: ui.card2, alignItems: "center", justifyContent: "center" },
  photoLabel: { fontSize: 14, fontWeight: "600", color: ui.t1 },
  rows: { gap: space[2] },
  row: { gap: 6, padding: space[2], borderRadius: radius.xs, borderWidth: 1, borderColor: ui.cardBorder },
  editorActions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[2] },
  sheet: { gap: space[3] },
  sheetTitle: { fontSize: 20, lineHeight: 28, fontWeight: "700", color: ui.t1 },
  catalogRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.cardBorder, backgroundColor: ui.card },
});
