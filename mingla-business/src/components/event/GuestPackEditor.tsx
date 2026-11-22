/**
 * #4548 — Guest pack editor (Host, iOS / Android / web).
 *
 * A collapsible block under the address on the Where step, in create and in
 * live edit: an optional note (1,000 characters) and up to 5 labelled https
 * links the host orders with up / down buttons. Guests read it in the Mingla
 * app with their ticket; nothing here reaches a public page or an email.
 *
 * The working copy lives in `guestPackSession` so the wizard's Continue /
 * Publish and the live editor's Save changes can save a changed pack first.
 * This block has its own Save and its own error toast. It is loaded with the
 * Where step (never from the boot path).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  color,
  radius as radiusTokens,
  space,
  type,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Input } from "../ui/Input";
import { subscribeGuestPack } from "../../utils/guestPackGate";
import {
  addGuestPackItem,
  askRemoveGuestPackItem,
  askRemoveWholeGuestPack,
  blurGuestPackItemUrl,
  clearGuestPackFields,
  ensureGuestPackLoaded,
  getGuestPackSession,
  isGuestPackDirty,
  moveGuestPackItem,
  restoreGuestPackFromBaseline,
  removeGuestPackItem,
  saveGuestPack,
  setGuestPackItemLabel,
  setGuestPackItemUrl,
  setGuestPackNote,
  setGuestPackOpen,
  type GuestPackEditorItem,
  type GuestPackSession,
} from "../../utils/guestPackSession";
import {
  GUEST_PACK_COPY,
  GUEST_PACK_LABEL_MAX,
  GUEST_PACK_MAX_ITEMS,
  GUEST_PACK_NOTE_MAX,
  guestPackSummary,
} from "../../utils/guestPackValidation";

export const GUEST_PACK_HELPER_COPY =
  "Guests open this in the Mingla app with their ticket. Your note is only shown there. Anyone who has one of your links can open it, so put door codes in the note, not in a shared document.";

export interface GuestPackEditorProps {
  /** The event's server id; null while a new draft has not reached the server yet. */
  eventId: string | null;
  /** True in live edit, where "Saved." also says when guests see the change. */
  liveEdit?: boolean;
  onShowToast: (message: string) => void;
}

const formatCount = (n: number): string => n.toLocaleString("en-US");

function useSession(eventId: string | null): GuestPackSession | undefined {
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeGuestPack(listener),
    [],
  );
  const getSnapshot = React.useCallback(
    () => (eventId === null ? undefined : getGuestPackSession(eventId)),
    [eventId],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const GuestPackEditor: React.FC<GuestPackEditorProps> = ({
  eventId,
  liveEdit = false,
  onShowToast,
}) => {
  const session = useSession(eventId);

  React.useEffect(() => {
    if (eventId !== null) void ensureGuestPackLoaded(eventId);
  }, [eventId]);

  if (eventId === null) {
    return (
      <View style={styles.block}>
        <View style={styles.headerRow}>
          <HeaderIcon name="ticket" />
          <View style={styles.headerText}>
            <Text style={styles.title}>Guest pack</Text>
            <Text style={styles.sub}>
              Your draft is still saving. This opens in a moment.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (session === undefined || session.load === "loading") {
    return (
      <View style={styles.block}>
        <View style={styles.headerRow}>
          <HeaderIcon name="ticket" />
          <View style={styles.headerText}>
            <Text style={styles.title}>Guest pack</Text>
            <Text style={styles.sub}>Loading</Text>
          </View>
        </View>
      </View>
    );
  }

  if (session.load === "error") {
    return (
      <View style={styles.block}>
        <View style={styles.headerRow}>
          <HeaderIcon name="ticket" />
          <View style={styles.headerText}>
            <Text style={styles.title}>Guest pack</Text>
            <Text style={styles.subError}>
              Couldn't load the guest pack. Nothing was changed.
            </Text>
          </View>
          <Pressable
            onPress={() => void ensureGuestPackLoaded(eventId)}
            accessibilityRole="button"
            accessibilityLabel="Try loading the guest pack again"
            style={styles.smallBtn}
          >
            <Text style={styles.smallBtnText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ReadyEditor
      eventId={eventId}
      session={session}
      liveEdit={liveEdit}
      onShowToast={onShowToast}
    />
  );
};

const HeaderIcon: React.FC<{ name: IconName }> = ({ name }) => (
  <View style={styles.headerIcon}>
    <Icon name={name} size={16} color={color.text1} />
  </View>
);

interface ReadyProps {
  eventId: string;
  session: GuestPackSession;
  liveEdit: boolean;
  onShowToast: (message: string) => void;
}

const ReadyEditor: React.FC<ReadyProps> = ({
  eventId,
  session,
  liveEdit,
  onShowToast,
}) => {
  // Design v2: on wide desktop web the links sit in two columns (phone: one).
  const { isWideDesktop } = useResponsiveLayout();
  const dirty = isGuestPackDirty(session);
  const summary = guestPackSummary(session.baseline);
  const noteLength = session.note.length;
  const badItems = session.items.filter(
    (i) => i.labelError !== null || i.urlError !== null,
  ).length;
  const hasPack = session.baseline !== null;

  const onSave = async (restoreOnFail = false): Promise<void> => {
    const result = await saveGuestPack(eventId);
    if (!result.ok) {
      if (restoreOnFail) restoreGuestPackFromBaseline(eventId);
      onShowToast(result.message);
    }
  };

  const toggle = (): void => setGuestPackOpen(eventId, !session.open);

  const statusText = ((): { text: string; tone: "ok" | "bad" | "plain" } | null => {
    if (session.saving) return null;
    if (badItems > 0) {
      return {
        text: badItems === 1 ? "Fix 1 link before saving." : `Fix ${badItems} links before saving.`,
        tone: "bad",
      };
    }
    if (session.result === "saved") {
      return {
        text: liveEdit
          ? "Saved. Guests see it next time they open their ticket."
          : "Saved.",
        tone: "ok",
      };
    }
    if (session.result === "removed") return { text: "Guest pack removed.", tone: "ok" };
    if (dirty && hasPack) return { text: "Unsaved changes", tone: "plain" };
    return null;
  })();

  return (
    <View style={styles.block}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: session.open }}
        accessibilityLabel="Guest pack, ticket holders only"
        style={styles.headerRow}
      >
        <HeaderIcon name="ticket" />
        <View style={styles.headerText}>
          <Text style={styles.title}>Guest pack</Text>
          {session.open ? (
            <Text style={styles.sub}>Ticket holders only</Text>
          ) : summary !== null ? (
            <Text style={styles.subOk}>{summary} · Ticket holders only</Text>
          ) : (
            <Text style={styles.sub}>
              Ticket holders only. Directions, parking, a menu, what to bring.
            </Text>
          )}
        </View>
        <Icon name={session.open ? "chevU" : "chevD"} size={18} color={color.text2} />
      </Pressable>

      {session.open ? (
        <View style={styles.body}>
          <View style={styles.helper}>
            <Icon name="shield" size={14} color={color.text2} />
            <Text style={styles.helperText}>{GUEST_PACK_HELPER_COPY}</Text>
          </View>

          <Text style={styles.fieldLabel}>Note for guests</Text>
          <Input
            value={session.note}
            onChangeText={(v) => setGuestPackNote(eventId, v)}
            placeholder="e.g. Use the garage entrance on the side street. Message GARAGE in the group chat and we'll open the gate."
            placeholderTextColor={color.text4}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            variant="text"
            style={styles.textarea}
            accessibilityLabel="Note for guests"
            error={session.noteError}
          />
          <View style={styles.metaRow}>
            <Text style={styles.hint}>
              {noteLength >= 900 && session.noteError === null
                ? "Getting close to the limit."
                : "Line breaks are kept. Optional."}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.count,
                noteLength > GUEST_PACK_NOTE_MAX
                  ? styles.countOver
                  : noteLength >= 900
                    ? styles.countNear
                    : null,
              ]}
            >
              {formatCount(noteLength)} / {formatCount(GUEST_PACK_NOTE_MAX)}
            </Text>
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Links</Text>
            <Text style={styles.sectionCount}>
              {session.items.length} of {GUEST_PACK_MAX_ITEMS}
            </Text>
          </View>

          <View style={isWideDesktop ? styles.itemsGrid : undefined}>
            {session.items.map((item, index) => (
              <ItemCard
                key={item.key}
                eventId={eventId}
                item={item}
                index={index}
                total={session.items.length}
                half={isWideDesktop}
              />
            ))}
          </View>

          {session.items.length < GUEST_PACK_MAX_ITEMS ? (
            <>
              <Pressable
                onPress={() => addGuestPackItem(eventId)}
                accessibilityRole="button"
                accessibilityLabel="Add a link"
                style={styles.addBtn}
              >
                <Icon name="plus" size={16} color={color.text1} />
                <Text style={styles.addBtnText}>Add a link</Text>
              </Pressable>
              <Text style={styles.cap}>
                A map, a PDF, a menu, what to bring. Up to 5.
              </Text>
            </>
          ) : (
            <Text style={styles.cap} accessibilityLiveRegion="polite">
              That's the limit: 5 links. Remove one to add another.
            </Text>
          )}

          {session.confirmRemoveAll ? (
            <View style={styles.confirm} accessibilityRole="alert">
              <Text style={styles.confirmText}>
                Remove the whole guest pack? Guests stop seeing it next time they open
                their ticket.
              </Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={() => askRemoveWholeGuestPack(eventId, false)}
                  accessibilityRole="button"
                  accessibilityLabel="Keep the guest pack"
                  style={styles.smallBtn}
                >
                  <Text style={styles.smallBtnText}>Keep</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    clearGuestPackFields(eventId);
                    void onSave(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Remove the guest pack"
                  style={styles.smallBtnDanger}
                >
                  <Text style={styles.smallBtnDangerText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              {hasPack ? (
                <Pressable
                  onPress={() => askRemoveWholeGuestPack(eventId, true)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove pack"
                  style={styles.smallBtn}
                >
                  <Text style={styles.smallBtnText}>Remove pack</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void onSave()}
                disabled={!dirty || session.saving || session.noteError !== null}
                accessibilityRole="button"
                accessibilityLabel="Save pack"
                accessibilityState={{
                  disabled: !dirty || session.saving || session.noteError !== null,
                  busy: session.saving,
                }}
                style={[
                  styles.saveBtn,
                  (!dirty || session.saving || session.noteError !== null) &&
                    styles.saveBtnDisabled,
                ]}
              >
                <Text style={styles.saveBtnText}>
                  {session.saving ? "Saving" : "Save pack"}
                </Text>
              </Pressable>
            </View>
          )}

          {statusText !== null ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.status,
                statusText.tone === "ok" && styles.statusOk,
                statusText.tone === "bad" && styles.statusBad,
              ]}
            >
              {statusText.text}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const ItemCard: React.FC<{
  eventId: string;
  item: GuestPackEditorItem;
  index: number;
  total: number;
  half?: boolean;
}> = ({ eventId, item, index, total, half = false }) => {
  const name = item.label.trim() === "" ? "item" : item.label;
  return (
    <View
      style={[
        styles.item,
        half && styles.itemHalf,
        (item.labelError || item.urlError) && styles.itemBad,
      ]}
      accessibilityLabel={`Link ${index + 1} of ${total}`}
    >
      <View style={styles.itemHead}>
        <View style={styles.num}>
          <Text style={styles.numText}>{index + 1}</Text>
        </View>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.label.trim() === "" ? "New link" : item.label}
        </Text>
        <IconBtn
          icon="chevU"
          label={`Move ${name} up`}
          disabled={index === 0}
          onPress={() => moveGuestPackItem(eventId, item.key, -1)}
        />
        <IconBtn
          icon="chevD"
          label={`Move ${name} down`}
          disabled={index === total - 1}
          onPress={() => moveGuestPackItem(eventId, item.key, 1)}
        />
        <IconBtn
          icon="trash"
          label={`Remove ${name}`}
          onPress={() => askRemoveGuestPackItem(eventId, item.key, true)}
        />
      </View>

      {item.confirmRemove ? (
        <View style={styles.confirm} accessibilityRole="alert">
          <Text style={styles.confirmText}>Remove this link?</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => askRemoveGuestPackItem(eventId, item.key, false)}
              accessibilityRole="button"
              accessibilityLabel="Keep this link"
              style={styles.smallBtn}
            >
              <Text style={styles.smallBtnText}>Keep</Text>
            </Pressable>
            <Pressable
              onPress={() => removeGuestPackItem(eventId, item.key)}
              accessibilityRole="button"
              accessibilityLabel="Remove this link"
              style={styles.smallBtnDanger}
            >
              <Text style={styles.smallBtnDangerText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.fieldLabel}>Label</Text>
        <Text style={styles.count}>
          {item.label.length} / {GUEST_PACK_LABEL_MAX}
        </Text>
      </View>
      <Input
        value={item.label}
        onChangeText={(v) => setGuestPackItemLabel(eventId, item.key, v)}
        placeholder="e.g. Parking map"
        placeholderTextColor={color.text4}
        variant="text"
        maxLength={GUEST_PACK_LABEL_MAX}
        accessibilityLabel={`Label for link ${index + 1}`}
        error={item.labelError}
      />
      <Text style={[styles.fieldLabel, styles.linkLabel]}>Link</Text>
      <Input
        value={item.url}
        onChangeText={(v) => setGuestPackItemUrl(eventId, item.key, v)}
        onBlur={() => blurGuestPackItemUrl(eventId, item.key)}
        placeholder="https://"
        placeholderTextColor={color.text4}
        variant="text"
        inputMode="url"
        accessibilityLabel={`Link address for link ${index + 1}`}
        error={item.urlError}
      />
      {item.fixed && item.urlError === null ? (
        <Text style={styles.hint}>{GUEST_PACK_COPY.httpsAdded}</Text>
      ) : null}
    </View>
  );
};

const IconBtn: React.FC<{
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}> = ({ icon, label, onPress, disabled = false }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled }}
    style={[styles.iconBtn, disabled && styles.iconBtnDisabled]}
  >
    <Icon name={icon} size={16} color={color.text1} />
  </Pressable>
);

const styles = StyleSheet.create({
  block: {
    backgroundColor: color.card2,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[4],
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    gap: space[3],
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: radiusTokens.full,
    backgroundColor: color.fill.tabOn,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  title: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  sub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  subOk: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginTop: 2,
  },
  subError: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
    marginTop: 2,
  },
  body: {
    paddingHorizontal: space[4],
    paddingBottom: space[4],
  },
  helper: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-start",
    backgroundColor: color.fill.inset,
    borderRadius: radiusTokens.sm,
    padding: space[3],
    marginBottom: space[4],
  },
  helperText: {
    flex: 1,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight * 1.4,
    color: color.text2,
  },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "500",
    color: color.text2,
    marginBottom: space[1],
  },
  linkLabel: { marginTop: space[3] },
  textarea: { minHeight: 96, paddingTop: space[3] },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: space[1],
    marginBottom: space[1],
    gap: space[2],
  },
  hint: {
    flex: 1,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: space[1],
  },
  count: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  countNear: { color: color.warningText },
  countOver: { color: color.errorText },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: space[4],
    marginBottom: space[2],
  },
  sectionTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  sectionCount: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  item: {
    backgroundColor: color.fill.inset,
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: color.line,
    padding: space[3],
    marginBottom: space[3],
  },
  itemBad: { borderColor: color.danger },
  itemsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  itemHalf: { width: "48.5%" },
  itemHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    marginBottom: space[2],
  },
  num: {
    width: 24,
    height: 24,
    borderRadius: radiusTokens.full,
    backgroundColor: color.fill.step,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space[1],
  },
  numText: {
    fontSize: type.caption.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  itemName: {
    flex: 1,
    fontSize: type.small.fontSize,
    color: color.text1,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnDisabled: { opacity: 0.35 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    minHeight: 44,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
  },
  addBtnText: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  cap: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    textAlign: "center",
    marginTop: space[2],
  },
  confirm: {
    backgroundColor: color.fill.inset,
    borderRadius: radiusTokens.sm,
    padding: space[3],
    marginTop: space[3],
    marginBottom: space[2],
  },
  confirmText: {
    fontSize: type.small.fontSize,
    color: color.text1,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space[2],
    marginTop: space[3],
  },
  smallBtn: {
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  smallBtnDanger: {
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnDangerText: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.errorText,
  },
  saveBtn: {
    minHeight: 44,
    paddingHorizontal: space[5],
    borderRadius: radiusTokens.full,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.ink,
  },
  status: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    textAlign: "right",
    marginTop: space[2],
  },
  statusOk: { color: color.text2 },
  statusBad: { color: color.errorText },
});
