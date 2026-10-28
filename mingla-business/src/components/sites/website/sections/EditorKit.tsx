import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Banner, Body, Hint, Row, RowText, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import {
  blocksToDoc,
  docToBlocks,
  linkSelection,
  newBlockId,
  RICH_BLOCK_LABELS,
  wrapSelection,
  type RichBlock,
  type RichBlockType,
} from "../../../../sites/richTextBlocks";
import type { RichTextDoc } from "../../../../../../packages/site-contracts/src/richText.ts";
import { BrandSiteContentConflict, useMinglaOfferings, type MinglaOffering } from "../../../../sites/contentApi";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { formatTripDates } from "../../../../sites/websiteCopy";
import type { CollectionSection } from "../../../../sites/websiteNav";

/*
 * #2829 W9r — what every collection editor shares: the breadcrumb, Save /
 * Cancel (a sticky bar on desktop, Save in the top bar on phones), the "saved
 * a newer version" choice, the rich-text editor, the Mingla trip picker and
 * the delete confirm.
 */

export function EditorCrumb({ section, label, current }: { section: CollectionSection; label: string; current: string }): React.ReactElement | null {
  const { phone, go } = useWebsite();
  if (phone) return null;
  return (
    <View style={styles.crumb} role="navigation" accessibilityLabel="Breadcrumb">
      <Pressable onPress={() => go({ kind: "section", section })} role="link" accessibilityRole="link" accessibilityLabel={`Back to ${label}`} hitSlop={8}>
        <Text style={styles.crumbLink}>{label}</Text>
      </Pressable>
      <Text style={styles.crumbSep}>›</Text>
      <Text style={styles.crumbCurrent} numberOfLines={1}>{current}</Text>
    </View>
  );
}

/** Save / Cancel in the right place for the screen size. */
export function useEditorChrome(input: {
  isNew: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  onCancel: () => void;
}): void {
  const { phone, setStickyBar, setTopbarSave } = useWebsite();
  const save = useRef(input.onSave);
  save.current = input.onSave;
  const cancel = useRef(input.onCancel);
  cancel.current = input.onCancel;
  useEffect(() => {
    if (input.disabled) {
      setStickyBar(null);
      setTopbarSave(null);
      return;
    }
    if (phone) {
      setStickyBar(null);
      setTopbarSave({ label: "Save", onPress: () => save.current(), loading: input.saving, testID: "editor-save" });
    } else {
      setTopbarSave(null);
      setStickyBar({
        text: input.isNew ? "New · not saved yet" : "Editing · saves to your draft",
        actions: [
          { label: "Cancel", variant: "ghost", onPress: () => cancel.current(), testID: "editor-cancel" },
          { label: "Save", variant: "primary", onPress: () => save.current(), loading: input.saving, testID: "editor-save" },
        ],
      });
    }
  }, [input.disabled, input.isNew, input.saving, phone, setStickyBar, setTopbarSave]);
  useEffect(() => () => {
    setStickyBar(null);
    setTopbarSave(null);
  }, [setStickyBar, setTopbarSave]);
}

function minutesAgo(iso: string | null): string {
  const time = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(time)) return "just now";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  return minutes < 1 ? "just now" : `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
}

/** "<Name> saved a newer version 2 minutes ago" · View theirs · Keep mine. */
export function ConflictBanner({ conflict, onViewTheirs, onKeepMine }: {
  conflict: BrandSiteContentConflict;
  onViewTheirs: () => void;
  onKeepMine: () => void;
}): React.ReactElement {
  return (
    <Banner
      tone="warn"
      icon="history"
      title={`${conflict.latest.updatedByName ?? "Someone"} saved a newer version ${minutesAgo(conflict.latest.updatedAt)}`}
      body="Nothing was overwritten. Look at their version, or keep yours and save it over theirs."
      alert
      testID="editor-conflict"
    >
      <WButton label="View theirs" size="sm" onPress={onViewTheirs} testID="conflict-view-theirs" />
      <WButton label="Keep mine" size="sm" variant="primary" onPress={onKeepMine} testID="conflict-keep-mine" />
    </Banner>
  );
}

export function saveErrorMessage(error: unknown): string {
  return error instanceof BrandSitesError ? error.message : "That didn’t save. Check your connection and try again.";
}

/** Delete with a plain confirm (restorable from an earlier published version). */
export function DeleteEntry({ label, onDelete, deleting, disabled }: { label: string; onDelete: () => void; deleting: boolean; disabled: boolean }): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={styles.delete}>
      <WButton label={label} icon="trash" variant="danger" onPress={() => setConfirming(true)} disabled={disabled} loading={deleting} testID="editor-delete" />
      <ConfirmDialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onDelete();
        }}
        title="Delete this?"
        description="It's removed from your draft now and from your website when you next publish. Earlier published versions keep it, so you can restore it from History."
        confirmLabel="Delete"
        destructive
        testID="editor-delete-confirm"
      />
    </View>
  );
}

const TOOL: readonly { key: string; label: string; text: string; block?: RichBlockType; mark?: "bold" | "italic"; link?: true }[] = [
  { key: "bold", label: "Bold", text: "B", mark: "bold" },
  { key: "italic", label: "Italic", text: "I", mark: "italic" },
  { key: "h2", label: "Heading", text: "H2", block: "h2" },
  { key: "h3", label: "Subheading", text: "H3", block: "h3" },
  { key: "bullet", label: "Bulleted list", text: "•", block: "bullet" },
  { key: "number", label: "Numbered list", text: "1.", block: "number" },
  { key: "quote", label: "Quote", text: "”", block: "quote" },
  { key: "link", label: "Link", text: "Link", link: true },
];

/**
 * The story editor: blocks you type in, a toolbar that maps 1:1 to what the
 * site can show (bold, italic, headings, lists, quotes, links). Bold and
 * italic wrap the selected words; a block button turns the current block
 * into that kind (press again for a paragraph).
 */
export function RichTextEditor({ value, onChange, label, disabled }: {
  value: RichTextDoc | null;
  onChange: (doc: RichTextDoc | null) => void;
  label: string;
  disabled: boolean;
}): React.ReactElement {
  const [blocks, setBlocks] = useState<RichBlock[]>(() => {
    const initial = docToBlocks(value);
    return initial.length ? initial : [{ id: newBlockId(), type: "paragraph", text: "" }];
  });
  const [focus, setFocus] = useState(0);
  const selection = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("https://");

  const commit = (next: RichBlock[]) => {
    setBlocks(next);
    onChange(blocksToDoc(next));
  };
  const update = (index: number, patch: Partial<RichBlock>) => commit(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));

  const press = (tool: (typeof TOOL)[number]) => {
    const block = blocks[focus];
    if (!block) return;
    if (tool.mark) {
      const next = wrapSelection(block.text, selection.current, tool.mark);
      update(focus, { text: next.text });
    } else if (tool.block) {
      update(focus, { type: block.type === tool.block ? "paragraph" : tool.block });
    } else if (tool.link) {
      setLinking(true);
    }
  };

  return (
    <View>
      <View style={styles.toolbar} role="toolbar" accessibilityLabel="Formatting">
        {TOOL.map((tool) => (
          <Pressable
            key={tool.key}
            onPress={disabled ? undefined : () => press(tool)}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={tool.label}
            accessibilityState={{ disabled, selected: tool.block ? blocks[focus]?.type === tool.block : false }}
            style={[styles.tool, tool.block && blocks[focus]?.type === tool.block ? styles.toolOn : null]}
            testID={`rte-${tool.key}`}
          >
            {tool.link ? <WebsiteIcon name="ext" size={16} color={ui.t2} /> : <Text style={[styles.toolText, tool.key === "italic" ? styles.italic : null]}>{tool.text}</Text>}
          </Pressable>
        ))}
      </View>
      <View style={styles.editor} accessibilityLabel={label}>
        {blocks.map((block, index) => (
          <View key={block.id} style={styles.blockRow}>
            {block.type === "bullet" ? <Text style={styles.bullet}>•</Text> : block.type === "number" ? <Text style={styles.bullet}>{`${numberOf(blocks, index)}.`}</Text> : null}
            <TextInput
              value={block.text}
              multiline
              editable={!disabled}
              onFocus={() => setFocus(index)}
              onSelectionChange={(event) => {
                selection.current = event.nativeEvent.selection;
              }}
              onChangeText={(text) => update(index, { text })}
              onKeyPress={(event) => {
                if (event.nativeEvent.key === "Backspace" && block.text === "" && blocks.length > 1) {
                  commit(blocks.filter((_, i) => i !== index));
                  setFocus(Math.max(0, index - 1));
                }
              }}
              placeholder={index === 0 ? "Start writing…" : RICH_BLOCK_LABELS[block.type]}
              placeholderTextColor={ui.t4}
              accessibilityLabel={`${label}, ${RICH_BLOCK_LABELS[block.type].toLowerCase()} ${index + 1}`}
              style={[styles.blockInput, blockStyle(block.type)]}
              testID={`rte-block-${index}`}
            />
          </View>
        ))}
        <WButton label="Add a paragraph" icon="plus" variant="ghost" size="sm" onPress={() => {
          commit([...blocks, { id: newBlockId(), type: blocks[blocks.length - 1]?.type === "bullet" || blocks[blocks.length - 1]?.type === "number" ? blocks[blocks.length - 1]!.type : "paragraph", text: "" }]);
          setFocus(blocks.length);
        }} disabled={disabled} style={styles.addBlock} testID="rte-add-block" />
      </View>
      <Hint style={styles.rteHint}>Select words, then press B or I. **Bold** and *italic* marks you type work too.</Hint>
      <Modal visible={linking} transparent animationType="fade" onRequestClose={() => setLinking(false)}>
        <View style={styles.scrim}>
          <View style={styles.dialog} role="dialog" aria-modal accessibilityLabel="Add a link">
            <Text style={styles.dialogTitle}>Add a link</Text>
            <Body>The selected words link to this address.</Body>
            <TextInput value={href} onChangeText={setHref} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Link address" style={styles.linkInput} autoFocus />
            <View style={styles.dialogActions}>
              <WButton label="Cancel" onPress={() => setLinking(false)} />
              <WButton label="Add link" variant="primary" onPress={() => {
                const block = blocks[focus];
                const next = block ? linkSelection(block.text, selection.current, href) : null;
                if (next && block) update(focus, { text: next.text });
                setLinking(false);
              }} testID="rte-link-add" />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function numberOf(blocks: readonly RichBlock[], index: number): number {
  let n = 1;
  for (let i = index - 1; i >= 0 && blocks[i]!.type === "number"; i -= 1) n += 1;
  return n;
}

function blockStyle(type: RichBlockType) {
  if (type === "h2") return styles.h2;
  if (type === "h3") return styles.h3;
  if (type === "quote") return styles.quote;
  return null;
}

/** "Trips here": pick from the brand's Mingla trips (dates and spots come from the trip). */
export function OfferingPicker({ selected, onChange, disabled, kind = "trip", single }: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  kind?: string;
  single?: boolean;
}): React.ReactElement {
  const { controller } = useWebsite();
  const offerings = useMinglaOfferings(controller.siteId);
  const [open, setOpen] = useState(false);
  const all = (offerings.data ?? []).filter((row) => row.kind === kind);
  const chosen = selected.map((id) => all.find((row) => row.id === id)).filter((row): row is MinglaOffering => Boolean(row));
  return (
    <View>
      {chosen.length ? (
        <View style={styles.offerList}>
          {chosen.map((row) => (
            <Row key={row.id}>
              <RowText title={row.title} lines={[[formatTripDates(row.start_at, row.end_at, row.timezone), row.ended ? "Ended" : row.spots_left === 0 ? "Sold out" : row.spots_left ? `${row.spots_left} spots left` : null].filter(Boolean).join(" · ")]} />
              {row.public_url ? <WButton label="Open trip" icon="ext" size="sm" onPress={() => controller.actions.openUrl(row.public_url!)} /> : null}
              <WButton label="Remove" variant="ghost" size="sm" onPress={() => onChange(selected.filter((id) => id !== row.id))} disabled={disabled} />
            </Row>
          ))}
        </View>
      ) : <Hint>{single ? "No trip chosen." : "No trips linked yet."}</Hint>}
      <WButton label={single ? "Choose a Mingla trip" : "Link a Mingla trip"} icon="plus" variant="ghost" size="sm" onPress={() => setOpen(true)} disabled={disabled} style={styles.offerAdd} testID="offering-picker-open" />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} role="button" accessibilityLabel="Close">
          <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel="Your Mingla trips" onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Your Mingla trips</Text>
            {offerings.isLoading ? <Hint>Loading your trips…</Hint> : all.length === 0 ? <Hint>You have no public Mingla trips yet.</Hint> : (
              <View style={styles.offerList}>
                {all.map((row) => {
                  const on = selected.includes(row.id);
                  return (
                    <Pressable
                      key={row.id}
                      onPress={() => {
                        onChange(single ? [row.id] : on ? selected.filter((id) => id !== row.id) : [...selected, row.id]);
                        if (single) setOpen(false);
                      }}
                      role="checkbox"
                      aria-checked={on}
                      accessibilityLabel={row.title}
                      style={styles.offerRow}
                      testID={`offering-option-${row.id}`}
                    >
                      <RowText title={row.title} lines={[formatTripDates(row.start_at, row.end_at, row.timezone) + (row.ended ? " · Ended" : "")]} />
                      {on ? <WebsiteIcon name="check" color={ui.accent} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={styles.dialogActions}><WButton label="Done" onPress={() => setOpen(false)} testID="offering-picker-done" /></View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

const styles = StyleSheet.create({
  crumb: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  crumbLink: { color: ui.accent, fontWeight: "600", fontSize: 13, lineHeight: 32 },
  crumbSep: { color: ui.t3, fontSize: 13 },
  crumbCurrent: { color: ui.t3, fontSize: 13, flexShrink: 1 },
  delete: { flexDirection: "row", marginTop: 4, marginBottom: 24 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 6, borderWidth: 1, borderColor: ui.border2, borderBottomWidth: 0, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: "rgba(255,255,255,0.03)" },
  tool: { minWidth: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  toolOn: { backgroundColor: "rgba(255,255,255,0.09)" },
  toolText: { color: ui.t2, fontWeight: "700", fontSize: 14 },
  italic: { fontStyle: "italic" },
  editor: { minHeight: 220, borderWidth: 1, borderColor: ui.border2, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.02)" },
  blockRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  bullet: { color: ui.t2, fontSize: 15, lineHeight: 24, paddingTop: 6, minWidth: 16 },
  blockInput: { flex: 1, color: ui.t1, fontSize: 15, lineHeight: 24, paddingVertical: 6, minHeight: 36, textAlignVertical: "top" },
  h2: { fontSize: 20, lineHeight: 28, fontWeight: "700" },
  h3: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  quote: { borderLeftWidth: 3, borderLeftColor: ui.accent, paddingLeft: 12, color: ui.t2 },
  addBlock: { alignSelf: "flex-start", marginTop: 6 },
  rteHint: { marginTop: 6 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog: { width: "100%", maxWidth: 520, maxHeight: "90%", backgroundColor: "#16181c", borderWidth: 1, borderColor: ui.border2, borderRadius: 24, padding: 20 },
  dialogTitle: { fontSize: 18, lineHeight: 24, fontWeight: "700", color: ui.t1, marginBottom: 6 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  linkInput: { marginTop: 12, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: ui.border2, paddingHorizontal: 12, color: ui.t1, fontFamily: mono },
  offerList: { borderWidth: 1, borderColor: ui.cardBorder, borderRadius: 12, overflow: "hidden", marginTop: 10 },
  offerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 56, borderTopWidth: 1, borderTopColor: ui.cardBorder },
  offerAdd: { alignSelf: "flex-start", marginTop: 8 },
});
