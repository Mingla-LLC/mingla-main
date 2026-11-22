/**
 * issue #3281 S3 — the one Add-ons editor (Host iOS, Android and web).
 *
 * Opened from every offering (event tickets on a published event, the trip
 * Pricing step, the experience Pricing step and the RSVP Setup step) through
 * `AddOnsEntry`, which loads this file on first tap. One sheet with two views:
 * the list of the offering's add-ons, and the form for one add-on. Every save
 * sends the offering's whole list to `biz_offering_add_ons_save` against the
 * revision this sheet read (design section 4 "Host web · Add-ons").
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  color,
  radius as radiusTokens,
  space,
  type,
} from "../../constants/designSystem";
import { useOfferingAddOns, useSaveOfferingAddOns } from "../../hooks/useOfferingAddOns";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import {
  addOnPhotoPublicUrl,
  OfferingAddOnsError,
  uploadAddOnPhoto,
} from "../../services/offeringAddOnsService";
import { formatCurrency } from "../../utils/currency";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { Switch } from "../ui/Switch";
import { pickAddOnPhoto } from "./addOnPhoto";
import {
  ADD_ON_PHOTO_ERROR_COPY,
  AddOnPhotoError,
  newAddOnPhotoId,
} from "./addOnPhotoRules";
import {
  addOnErrorCopy,
  addOnSummaryLine,
  addOnTargetsLabel,
  buildSaveList,
  datesForTargets,
  emptyAddOnForm,
  formFromAddOn,
  MAX_ADD_ONS_PER_OFFERING,
  targetKey,
  targetNoun,
  validateAddOnForm,
  type AddOnForm,
  type AddOnOfferingKind,
  type OfferingAddOn,
  type OfferingAddOnsPayload,
} from "./addOnsEditorModel";

export interface AddOnsEditorSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The offering (events.id of the event, trip, experience or RSVP). */
  eventId: string;
  offering: AddOnOfferingKind;
  /** Used when the offering has no saved ticket currency yet. */
  currency?: string | null;
  /** Opened from one ticket: show its add-ons and preselect it for new ones. */
  filterTicketTypeId?: string | null;
}

type PhotoState =
  | { phase: "idle" }
  | { phase: "uploading"; previewUri: string }
  | { phase: "failed" };

const dateLabel = (iso: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

export const AddOnsEditorSheet: React.FC<AddOnsEditorSheetProps> = ({
  visible,
  onClose,
  eventId,
  offering,
  currency: fallbackCurrency = null,
  filterTicketTypeId = null,
}) => {
  const query = useOfferingAddOns(eventId);
  const save = useSaveOfferingAddOns(eventId);
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;

  const [form, setForm] = useState<AddOnForm | null>(null);
  const [formSeed, setFormSeed] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [photo, setPhoto] = useState<PhotoState>({ phase: "idle" });
  const [photoError, setPhotoError] = useState<string | null>(null);

  const payload: OfferingAddOnsPayload | undefined = query.data;
  const currency = payload?.currency ?? fallbackCurrency;
  const noun = targetNoun(offering);
  const formatMinor = useCallback(
    (minor: number): string =>
      currency !== null && currency.trim().length > 0
        ? formatCurrency(minor, currency, true)
        : String(minor / 100),
    [currency],
  );
  const context = useMemo(
    () => (payload === undefined ? null : { payload, currency, kind: offering }),
    [payload, currency, offering],
  );

  useEffect(() => {
    if (visible) return;
    setForm(null);
    setSaveError(null);
    setConfirmRemove(false);
    setConfirmDiscard(false);
    setPhoto({ phase: "idle" });
    setPhotoError(null);
  }, [visible]);

  const filterKey = filterTicketTypeId !== null ? `tt:${filterTicketTypeId}` : null;
  const listed: OfferingAddOn[] = useMemo(
    () =>
      payload === undefined
        ? []
        : filterKey === null
          ? payload.addOns
          : payload.addOns.filter((addOn) => addOn.targets.some((t) => targetKey(t) === filterKey)),
    [payload, filterKey],
  );

  const openForm = (next: AddOnForm): void => {
    setForm(next);
    setFormSeed(JSON.stringify(next));
    setSaveError(null);
    setConfirmRemove(false);
    setConfirmDiscard(false);
    setPhoto({ phase: "idle" });
    setPhotoError(null);
  };
  const startNew = (): void => {
    if (payload === undefined) return;
    const defaults =
      filterKey !== null
        ? [filterKey]
        : payload.targets.length === 1 || offering === "rsvp"
          ? payload.targets.slice(0, 1).map((option) => option.key)
          : [];
    openForm(emptyAddOnForm(defaults));
  };
  const dirty = form !== null && JSON.stringify(form) !== formSeed;
  const patch = (next: Partial<AddOnForm>): void => {
    setForm((current) => (current === null ? current : { ...current, ...next }));
    setSaveError(null);
  };

  const problem = form !== null && context !== null ? validateAddOnForm(form, context) : null;
  const busy = save.isPending || photo.phase === "uploading";

  const runSave = async (edit: { form: AddOnForm } | { removeId: string }): Promise<void> => {
    if (payload === undefined || context === null || offline) return;
    try {
      await save.mutateAsync({
        addOns: buildSaveList(payload, context, edit),
        expectedRevision: payload.revision,
      });
      setForm(null);
      setConfirmRemove(false);
    } catch (error) {
      const code = error instanceof OfferingAddOnsError ? error.code : null;
      setSaveError(addOnErrorCopy(code));
      if (code === "add_ons_changed_elsewhere") void query.refetch();
    }
  };

  const choosePhoto = async (): Promise<void> => {
    if (form === null || offline || busy) return;
    setPhotoError(null);
    let prepared;
    try {
      prepared = await pickAddOnPhoto();
    } catch (error) {
      setPhotoError(
        error instanceof AddOnPhotoError
          ? ADD_ON_PHOTO_ERROR_COPY[error.code]
          : ADD_ON_PHOTO_ERROR_COPY.add_on_photo_unreadable,
      );
      return;
    }
    if (prepared === null) return;
    setPhoto({ phase: "uploading", previewUri: prepared.previewUri });
    try {
      const stored = await uploadAddOnPhoto({
        eventId,
        photoId: newAddOnPhotoId(),
        full: prepared.full,
        thumb: prepared.thumb,
      });
      patch(stored);
      setPhoto({ phase: "idle" });
    } catch {
      setPhoto({ phase: "failed" });
    }
  };

  const requestClose = (): void => {
    if (busy) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  // ── Bodies ─────────────────────────────────────────────────────────────────
  const offlineNote = offline ? (
    <Text style={styles.warning} accessibilityLiveRegion="polite">
      You're offline. Changes aren't saved yet.
    </Text>
  ) : null;

  let body: React.ReactNode;
  let footer: React.ReactNode = null;

  if (query.isPending) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator accessibilityLabel="Loading add-ons" />
        <Text style={styles.caption}>Loading add-ons…</Text>
      </View>
    );
  } else if (query.isError || payload === undefined || context === null) {
    body = (
      <View style={styles.center}>
        <Text style={styles.caption}>
          {query.error?.code === "add_ons_forbidden"
            ? addOnErrorCopy("add_ons_forbidden")
            : "Add-ons didn't load, so they can't be changed right now. Saving the rest still works."}
        </Text>
        <Button
          label="Retry"
          variant="secondary"
          size="sm"
          onPress={() => void query.refetch()}
          accessibilityLabel="Load the add-ons again"
        />
      </View>
    );
  } else if (form === null) {
    const canAdd = payload.targets.length > 0 && payload.addOns.length < MAX_ADD_ONS_PER_OFFERING;
    body = (
      <>
        <Text style={styles.caption}>
          {offering === "trip"
            ? "Works with payment plans. "
            : offering === "rsvp"
              ? "Guests choose add-ons when they RSVP. "
              : ""}
          Changes save when you tap Save.
        </Text>
        {offlineNote}
        {payload.targets.length === 0 ? (
          <Text style={styles.caption}>
            {`Save a ${noun} first. Add-ons come with the ${noun}s you've saved.`}
          </Text>
        ) : null}
        {listed.length === 0 && payload.targets.length > 0 ? (
          <Text style={styles.empty}>
            {filterKey !== null
              ? `No add-ons for this ${noun} yet.`
              : "No add-ons yet. Add one for things like dinner, a tote or a transfer."}
          </Text>
        ) : null}
        {listed.map((addOn) => (
          <Pressable
            key={addOn.id}
            onPress={() => openForm(formFromAddOn(addOn, currency))}
            accessibilityRole="button"
            accessibilityLabel={`Edit add-on ${addOn.name}`}
            style={styles.row}
            testID={`add-on-row-${addOn.id}`}
          >
            <Thumb path={addOn.photoThumbPath} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{addOn.name}</Text>
              <Text style={styles.caption} numberOfLines={2}>
                {addOnSummaryLine(addOn, formatMinor, offering)}
              </Text>
            </View>
            <Text style={styles.tag} numberOfLines={1}>
              {addOnTargetsLabel(addOn, payload, offering)}
            </Text>
          </Pressable>
        ))}
      </>
    );
    footer = (
      <>
        <Button
          label="Add-on"
          leadingIcon="plus"
          variant="secondary"
          size="md"
          fullWidth
          disabled={!canAdd || offline}
          onPress={startNew}
          accessibilityLabel="Add an add-on"
          testID="add-ons-new"
        />
        <Button
          label="Done"
          variant="ghost"
          size="md"
          fullWidth
          onPress={onClose}
          accessibilityLabel="Close add-ons"
        />
      </>
    );
  } else {
    const dates = datesForTargets(payload, form.targetKeys);
    const thumbPath = form.photoThumbPath;
    body = (
      <>
        {offlineNote}
        {confirmDiscard ? (
          <View style={styles.confirm}>
            <Text style={styles.body}>Discard your changes to this add-on?</Text>
            <View style={styles.confirmRow}>
              <Button label="Keep editing" variant="secondary" size="sm" onPress={() => setConfirmDiscard(false)} accessibilityLabel="Keep editing this add-on" />
              <Button label="Discard" variant="ghost" size="sm" onPress={() => { setConfirmDiscard(false); setForm(null); onClose(); }} accessibilityLabel="Discard changes and close" />
            </View>
          </View>
        ) : null}
        <View style={styles.photoRow}>
          <Pressable
            onPress={() => void choosePhoto()}
            disabled={busy || offline}
            accessibilityRole="button"
            accessibilityLabel={
              photo.phase === "failed"
                ? "Upload failed. Tap to try again."
                : thumbPath !== null
                  ? "Change the add-on photo"
                  : "Add a photo"
            }
            style={[styles.photoTile, thumbPath === null && photo.phase !== "uploading" ? styles.photoTileEmpty : null]}
            testID="add-on-photo"
          >
            {photo.phase === "uploading" ? (
              <>
                <Image source={{ uri: photo.previewUri }} style={styles.photoImage} />
                <View style={styles.photoOverlay}><ActivityIndicator accessibilityLabel="Uploading photo" /></View>
              </>
            ) : thumbPath !== null ? (
              <Image source={{ uri: addOnPhotoPublicUrl(thumbPath) }} style={styles.photoImage} accessibilityIgnoresInvertColors />
            ) : (
              <Text style={styles.photoText}>{photo.phase === "failed" ? "Try again" : "Add photo"}</Text>
            )}
          </Pressable>
          <View style={styles.photoSide}>
            {photo.phase === "failed" ? (
              <Text style={styles.error}>Upload failed. Tap to try again.</Text>
            ) : null}
            {photoError !== null ? <Text style={styles.error}>{photoError}</Text> : null}
            {thumbPath !== null && photo.phase !== "uploading" ? (
              <Pressable
                onPress={() => patch({ photoPath: null, photoThumbPath: null })}
                accessibilityRole="button"
                accessibilityLabel="Remove the photo"
                style={styles.linkButton}
              >
                <Text style={styles.link}>Remove photo</Text>
              </Pressable>
            ) : (
              <Text style={styles.caption}>Optional. Shown next to the add-on.</Text>
            )}
          </View>
        </View>

        <Field label="Name">
          <TextInput
            value={form.name}
            onChangeText={(name) => patch({ name })}
            placeholder="Friday dinner"
            placeholderTextColor={color.text4}
            maxLength={120}
            style={styles.input}
            accessibilityLabel="Add-on name"
            testID="add-on-name"
          />
        </Field>
        <Field label="Description (optional)">
          <TextInput
            value={form.description}
            onChangeText={(description) => patch({ description })}
            placeholder="Three courses, seated at 20:00"
            placeholderTextColor={color.text4}
            maxLength={280}
            style={styles.input}
            accessibilityLabel="Add-on description"
          />
        </Field>
        <Field
          label={`Price${currency !== null ? ` (${currency.trim().toUpperCase()})` : ""}`}
          hint={
            form.soldCount > 0
              ? "Add-ons people already bought keep their price."
              : "Set 0 for a free add-on. Guests still choose to add it."
          }
        >
          <TextInput
            value={form.priceText}
            onChangeText={(priceText) => patch({ priceText })}
            editable={form.soldCount === 0}
            placeholder="0"
            placeholderTextColor={color.text4}
            keyboardType="decimal-pad"
            selectTextOnFocus
            style={[styles.input, form.soldCount > 0 ? styles.inputLocked : null]}
            accessibilityLabel="Add-on price"
            testID="add-on-price"
          />
        </Field>
        <View style={styles.pair}>
          <View style={styles.pairCell}>
            <Field label={`Limit per ${offering === "rsvp" ? "guest" : noun}`}>
              <TextInput
                value={form.limitText}
                onChangeText={(limitText) => patch({ limitText })}
                keyboardType="number-pad"
                selectTextOnFocus
                style={styles.input}
                accessibilityLabel={`Most of this add-on per ${offering === "rsvp" ? "guest" : noun}`}
                testID="add-on-limit"
              />
            </Field>
          </View>
          <View style={styles.pairCell}>
            <Field label="Stock">
              <TextInput
                value={form.stockText}
                onChangeText={(stockText) => patch({ stockText })}
                placeholder="No limit"
                placeholderTextColor={color.text4}
                keyboardType="number-pad"
                selectTextOnFocus
                style={styles.input}
                accessibilityLabel="Add-on stock, empty for no limit"
                testID="add-on-stock"
              />
            </Field>
          </View>
        </View>

        {offering === "rsvp" ? (
          <View style={styles.toggleRow}>
            <View style={styles.rowText}>
              <Text style={styles.body}>Comes with the RSVP</Text>
              <Text style={styles.caption}>Guests can add it when they RSVP.</Text>
            </View>
            <Switch
              value={form.targetKeys.includes("rsvp")}
              onValueChange={(on) => patch({ targetKeys: on ? ["rsvp"] : [] })}
              accessibilityLabel="Comes with the RSVP"
            />
          </View>
        ) : (
          <Field
            label={`Available with these ${noun}s`}
            hint={
              payload.multiLinkEnabled
                ? `Pick one or more.${payload.freeParentEnabled ? ` Free ${noun}s can carry paid add-ons.` : ""}`
                : `Pick one ${noun}.`
            }
          >
            <View style={styles.pills} accessibilityRole={payload.multiLinkEnabled ? undefined : "radiogroup"}>
              {payload.targets.map((option) => {
                const on = form.targetKeys.includes(option.key);
                return (
                  <Pressable
                    key={option.key}
                    onPress={() =>
                      patch({
                        targetKeys: payload.multiLinkEnabled
                          ? on
                            ? form.targetKeys.filter((key) => key !== option.key)
                            : [...form.targetKeys, option.key]
                          : [option.key],
                        dateKeys: null,
                      })
                    }
                    accessibilityRole={payload.multiLinkEnabled ? "checkbox" : "radio"}
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${option.name}, ${option.isFree ? "free" : formatMinor(option.priceCents)}`}
                    style={[styles.pill, on ? styles.pillOn : null]}
                    testID={`add-on-target-${option.key}`}
                  >
                    <Text style={[styles.pillText, on ? styles.pillTextOn : null]} numberOfLines={1}>
                      {option.name} · {option.isFree ? "Free" : formatMinor(option.priceCents)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        )}

        {dates.length > 1 ? (
          <Field label="Dates" hint="Dates someone bought it for stay on.">
            <View style={styles.pills}>
              <Pressable
                onPress={() => patch({ dateKeys: null })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: form.dateKeys === null }}
                accessibilityLabel="Every date"
                style={[styles.pill, form.dateKeys === null ? styles.pillOn : null]}
              >
                <Text style={[styles.pillText, form.dateKeys === null ? styles.pillTextOn : null]}>Every date</Text>
              </Pressable>
              {dates.map((date) => {
                const on = form.dateKeys !== null && form.dateKeys.includes(date.key);
                const locked = on && form.soldOccurrenceKeys.includes(date.key);
                const label = dateLabel(date.startsAt, date.timezone);
                return (
                  <Pressable
                    key={date.key}
                    disabled={locked}
                    onPress={() => {
                      const current = form.dateKeys ?? [];
                      patch({
                        dateKeys: on ? current.filter((key) => key !== date.key) : [...current, date.key],
                      });
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: locked }}
                    accessibilityLabel={locked ? `${label}, sold, stays on` : label}
                    style={[styles.pill, on ? styles.pillOn : null, locked ? styles.pillLocked : null]}
                  >
                    <Text style={[styles.pillText, on ? styles.pillTextOn : null]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        ) : null}

        <View style={styles.toggleRow}>
          <View style={styles.rowText}>
            <Text style={styles.body}>Show on the public page</Text>
            <Text style={styles.caption}>{`Listed under each ${noun} it comes with.`}</Text>
          </View>
          <Switch
            value={form.showOnPublicPage}
            onValueChange={(showOnPublicPage) => patch({ showOnPublicPage })}
            accessibilityLabel="Show on the public page"
          />
        </View>

        {form.id !== null ? (
          confirmRemove ? (
            <View style={styles.confirm}>
              <Text style={styles.body}>
                {form.soldCount > 0
                  ? "Stop selling this add-on? People who bought it keep it."
                  : "Remove this add-on?"}
              </Text>
              <View style={styles.confirmRow}>
                <Button label="Keep" variant="secondary" size="sm" onPress={() => setConfirmRemove(false)} accessibilityLabel="Keep this add-on" />
                <Button
                  label={form.soldCount > 0 ? "Stop selling" : "Remove"}
                  variant="destructive"
                  size="sm"
                  disabled={busy || offline}
                  onPress={() => void runSave({ removeId: form.id as string })}
                  accessibilityLabel={form.soldCount > 0 ? "Stop selling this add-on" : "Remove this add-on"}
                />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setConfirmRemove(true)}
              accessibilityRole="button"
              accessibilityLabel={form.soldCount > 0 ? "Stop selling this add-on" : "Remove this add-on"}
              style={styles.linkButton}
            >
              <Text style={styles.danger}>{form.soldCount > 0 ? "Stop selling" : "Remove add-on"}</Text>
            </Pressable>
          )
        ) : null}
      </>
    );
    footer = (
      <>
        {saveError !== null || problem !== null ? (
          <Text style={saveError !== null ? styles.error : styles.caption} accessibilityLiveRegion="polite" testID="add-on-problem">
            {saveError ?? problem}
          </Text>
        ) : null}
        <Button
          label="Save"
          variant="primary"
          size="md"
          fullWidth
          loading={save.isPending}
          disabled={problem !== null || busy || offline}
          onPress={() => void runSave({ form })}
          accessibilityLabel="Save this add-on"
          testID="add-on-save"
        />
        <Button
          label="Back"
          variant="ghost"
          size="md"
          fullWidth
          disabled={busy}
          onPress={() => (dirty ? setConfirmDiscard(true) : setForm(null))}
          accessibilityLabel="Back to all add-ons"
        />
      </>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      dismissGuard={() => dirty || busy}
      onRequestClose={requestClose}
      snapPoint="full"
      presentation="panel"
      testID="add-ons-editor"
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {form === null ? "Add-ons" : form.id === null ? "New add-on" : "Edit add-on"}
        </Text>
      </View>
      <SheetScrollLayout keyboardAware footer={footer} testID="add-ons-editor-body">
        {body}
      </SheetScrollLayout>
    </Sheet>
  );
};

const Thumb: React.FC<{ path: string | null }> = ({ path }) =>
  path !== null ? (
    <Image source={{ uri: addOnPhotoPublicUrl(path) }} style={styles.thumb} accessibilityIgnoresInvertColors />
  ) : (
    <View style={[styles.thumb, styles.thumbEmpty]} />
  );

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {children}
    {hint !== undefined ? <Text style={styles.caption}>{hint}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  header: { paddingBottom: space[2] },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: color.text1 },
  center: { alignItems: "center", gap: space[3], paddingVertical: space[6] },
  body: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: color.text1 },
  caption: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.text3 },
  empty: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
    padding: space[4],
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
  },
  warning: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.warningText },
  error: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, color: color.danger },
  danger: { fontSize: type.body.fontSize, color: color.danger, fontWeight: "600" },
  link: { fontSize: type.caption.fontSize, color: color.text1, fontWeight: "600" },
  linkButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    minHeight: 64,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: type.body.fontSize, fontWeight: "600", color: color.text1 },
  tag: {
    maxWidth: 120,
    fontSize: type.caption.fontSize,
    color: color.text2,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.line,
  },
  thumb: { width: 48, height: 48, borderRadius: radiusTokens.sm },
  thumbEmpty: { backgroundColor: color.card2 },
  photoRow: { flexDirection: "row", gap: space[3], alignItems: "center" },
  photoTile: {
    width: 72,
    height: 72,
    borderRadius: radiusTokens.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.card2,
  },
  photoTileEmpty: { borderWidth: 1, borderStyle: "dashed", borderColor: color.lineStrong, backgroundColor: "transparent" },
  photoImage: { width: 72, height: 72 },
  photoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  photoText: { fontSize: type.caption.fontSize, color: color.text2, textAlign: "center" },
  photoSide: { flex: 1, gap: space[1] },
  field: { gap: space[1] },
  label: { fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, fontWeight: "600", color: color.text2 },
  input: {
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  inputLocked: { opacity: 0.5 },
  pair: { flexDirection: "row", gap: space[3] },
  pairCell: { flex: 1 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  pill: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: color.line,
  },
  pillOn: { backgroundColor: color.paper, borderColor: color.paper },
  pillLocked: { opacity: 0.6 },
  pillText: { fontSize: type.caption.fontSize, color: color.text1 },
  pillTextOn: { color: color.ink, fontWeight: "600" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  confirm: {
    gap: space[2],
    padding: space[3],
    borderRadius: radiusTokens.md,
    backgroundColor: color.card2,
  },
  confirmRow: { flexDirection: "row", gap: space[2], justifyContent: "flex-end" },
});

export default AddOnsEditorSheet;
