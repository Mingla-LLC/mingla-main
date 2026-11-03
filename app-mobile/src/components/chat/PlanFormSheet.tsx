/**
 * Issue #4261 — "New plan" (spec 5.5 #2; prototype Main.dc.html plan form).
 *
 * What / Where (Place · Link · Skip) / When (Set a time · Let the group vote) /
 * Note. Post stays disabled until `canPostPlan(form)`; a tap while disabled
 * says what is missing. Post spins, sends `plan_create` with a client id
 * minted when the form opened (a retry never doubles the plan), closes on
 * success with "Posted to {chat}. Everyone gets a notification." and keeps the
 * form (with the mapped error toast) on failure.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";
import { chatTokens } from "../../constants/chatTokens";
import { createClientMessageId } from "../../utils/mergeMessages";
import { useCreatePlan } from "../../hooks/useChatPlans";
import { usePlanPlaceSearch } from "../../hooks/usePlanPlaceSearch";
import { retrieveMapbox } from "../../services/planPlaceSearchService";
import {
  blankPlanForm,
  canPostPlan,
  formatPlanTime,
  isFutureSlot,
  linkDomainOf,
  normalisedLinkUrl,
  PLAN_FORM_MAX_TIMES,
  PLAN_NOTE_MAX,
  PLAN_TITLE_MAX,
  quickDays,
  slotToDate,
  suggestRandomSlot,
  type PlaceResultRow,
  type PlanFormDraft,
  type PlanFormPlace,
  type PlanFormSlot,
} from "./planModel";
import { PlanDateTimeFields } from "./PlanTimePickerSheet";
import type { PlanCreateInput, PlanPlaceInput, PlanWhereKind } from "../../types/chatPlans";

const SNAP_POINTS = ["92%"];

interface PlanFormSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  senderId: string | null | undefined;
  chatName: string;
}

function buildCreateInput(form: PlanFormDraft, conversationId: string, clientId: string): PlanCreateInput {
  let whereKind: PlanWhereKind = "none";
  let place: PlanPlaceInput | null = null;
  let linkUrl: string | null = null;
  if (form.where === "place" && form.place) {
    if (form.place.source === "pool" && form.place.poolId) {
      whereKind = "place";
      place = { poolId: form.place.poolId };
    } else if (form.place.source === "mapbox" && form.place.mapboxId) {
      whereKind = "place";
      place = {
        mapboxId: form.place.mapboxId,
        name: form.place.name,
        ...(form.place.area ? { address: form.place.area } : {}),
        ...(typeof form.place.lat === "number" ? { lat: form.place.lat } : {}),
        ...(typeof form.place.lng === "number" ? { lng: form.place.lng } : {}),
      };
    } else {
      whereKind = "address";
      place = { name: form.place.name };
    }
  } else if (form.where === "link" && linkDomainOf(form.link)) {
    whereKind = "link";
    linkUrl = normalisedLinkUrl(form.link);
  }
  const setAt = form.when === "set" ? slotToDate({ date: form.date, time: form.time }) : null;
  const options = form.when === "poll"
    ? form.options
        .filter((slot) => slot.date !== "")
        .map((slot) => slotToDate(slot))
        .filter((value): value is Date => value !== null)
        .map((value) => value.toISOString())
    : [];
  return {
    conversationId,
    clientId,
    title: form.title.trim(),
    whereKind,
    place,
    linkUrl,
    whenMode: form.when,
    scheduledAt: setAt ? setAt.toISOString() : null,
    options: Array.from(new Set(options)),
    openTimes: form.when === "poll" ? form.openTimes : false,
    note: form.note.trim() ? form.note.trim() : null,
  };
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.segmented} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.segment, selected && styles.segmentOn]}
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 3, bottom: 3, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            testID={`${testID}-${option.value}`}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function PlanFormSheet({ visible, onClose, conversationId, senderId, chatName }: PlanFormSheetProps): React.ReactElement {
  const { t, i18n } = useTranslation(["chat"]);
  const [form, setForm] = useState<PlanFormDraft>(blankPlanForm);
  const [clientId, setClientId] = useState<string>(() => createClientMessageId());
  const [sessionToken, setSessionToken] = useState<string>(() => createClientMessageId());
  const [query, setQuery] = useState("");
  const [retrievingKey, setRetrievingKey] = useState<string | null>(null);
  const createPlan = useCreatePlan(conversationId, senderId);
  const search = usePlanPlaceSearch(query, sessionToken, visible && form.where === "place" && form.place === null);

  // A fresh form, client id and Mapbox session every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setForm(blankPlanForm());
    setClientId(createClientMessageId());
    setSessionToken(createClientMessageId());
    setQuery("");
    setRetrievingKey(null);
  }, [visible]);

  const patch = (next: Partial<PlanFormDraft>) => setForm((current) => ({ ...current, ...next }));
  const canPost = canPostPlan(form);
  const posting = createPlan.isPending;
  const days = useMemo(() => quickDays(new Date()), [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekday = (date: string) => {
    const at = slotToDate({ date, time: "12:00" });
    return at ? new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(at) : date;
  };

  const pickResult = async (row: PlaceResultRow) => {
    if (row.kind === "pool") {
      patch({ place: { source: "pool", name: row.name, area: row.area, poolId: row.poolId, lat: row.lat, lng: row.lng } });
      setQuery("");
      return;
    }
    if (row.kind === "typed") {
      patch({ place: { source: "typed", name: row.name.slice(0, 120), area: null } });
      setQuery("");
      return;
    }
    if (retrievingKey) return;
    setRetrievingKey(row.key);
    try {
      const details = await retrieveMapbox(row.mapboxId, sessionToken, row.name);
      const picked: PlanFormPlace = {
        source: "mapbox",
        name: details.name,
        area: details.address ?? row.area,
        mapboxId: details.mapboxId,
        lat: details.lat,
        lng: details.lng,
      };
      patch({ place: picked });
      setQuery("");
    } catch (error) {
      console.warn("[PlanFormSheet] Mapbox retrieve failed", error);
      toastManager.error(t("chat:plan_place_load_failed"));
    } finally {
      setRetrievingKey(null);
    }
  };

  const setOption = (index: number, slot: PlanFormSlot) =>
    patch({ options: form.options.map((current, i) => (i === index ? slot : current)) });
  const addOption = (slot: PlanFormSlot) => {
    if (form.options.length >= PLAN_FORM_MAX_TIMES) {
      toastManager.info(t("chat:plan_too_many_form_times"));
      return;
    }
    patch({ options: [...form.options, slot] });
  };

  const post = () => {
    if (posting) return;
    if (!canPost) {
      toastManager.info(form.when === "poll" ? t("chat:plan_invalid_vote") : t("chat:plan_invalid_set"));
      return;
    }
    const now = new Date();
    const times = form.when === "set" ? [{ date: form.date, time: form.time }] : form.options.filter((slot) => slot.date);
    if (times.some((slot) => !isFutureSlot(slot, now))) {
      toastManager.info(t("chat:plan_past_time"));
      return;
    }
    const input = buildCreateInput(form, conversationId, clientId);
    const previewTitle = input.title || form.place?.name || linkDomainOf(form.link) || t("chat:plan_form_title");
    createPlan.mutate(
      { input, previewTitle },
      {
        onSuccess: () => {
          toastManager.success(t("chat:plan_posted_toast", { chatName }));
          onClose();
        },
      },
    );
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.headerSide}
        onPress={onClose}
        disabled={posting}
        accessibilityRole="button"
        accessibilityLabel={t("chat:plan_form_cancel")}
        testID="plan-form-cancel"
      >
        <Text style={styles.cancelText}>{t("chat:plan_form_cancel")}</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle} accessibilityRole="header">{t("chat:plan_form_title")}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>
        <TouchableOpacity
          style={[styles.post, canPost ? styles.postOn : styles.postOff]}
          onPress={post}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_form_post")}
          accessibilityState={{ disabled: !canPost, busy: posting }}
          testID="plan-form-post"
        >
          {posting ? (
            <ActivityIndicator size="small" color={chatTokens.textPrimary} />
          ) : (
            <Text style={[styles.postText, !canPost && styles.postTextOff]}>{t("chat:plan_form_post")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const linkDomain = linkDomainOf(form.link);
  const setPreview = form.when === "set" && form.date
    ? (() => {
        const at = slotToDate({ date: form.date, time: form.time });
        return at ? formatPlanTime(at.toISOString(), i18n.language) : null;
      })()
    : null;

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={posting ? () => undefined : onClose}
      theme="dark"
      snapPoints={SNAP_POINTS}
      scrollMode="scroll"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={styles.sheetBackground}
      header={header}
      scrollProps={{ keyboardShouldPersistTaps: "handled", contentContainerStyle: styles.body }}
      accessibilityLabel={t("chat:plan_form_title")}
    >
      <View style={styles.section}>
        <Text style={styles.label}>{t("chat:plan_what_label")}</Text>
        <BottomSheetTextInput
          value={form.title}
          onChangeText={(title) => patch({ title })}
          maxLength={PLAN_TITLE_MAX}
          placeholder={t("chat:plan_what_placeholder")}
          placeholderTextColor={chatTokens.textMuted}
          style={styles.input}
          accessibilityLabel={t("chat:plan_what_label")}
          testID="plan-form-title"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t("chat:plan_where_label")}</Text>
        <Segmented
          testID="plan-form-where"
          value={form.where}
          onChange={(where) => patch({ where })}
          options={[
            { value: "place", label: t("chat:plan_where_place") },
            { value: "link", label: t("chat:plan_where_link") },
            { value: "none", label: t("chat:plan_where_skip") },
          ]}
        />
        {form.where === "place" && form.place ? (
          <View style={styles.picked} testID="plan-form-picked">
            <Icon name="location" size={18} color={chatTokens.accent} />
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>{form.place.name}</Text>
              {form.place.area ? <Text style={styles.rowArea} numberOfLines={1}>{form.place.area}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={() => patch({ place: null })}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t("chat:plan_change")}
              testID="plan-form-change-place"
            >
              <Text style={styles.change}>{t("chat:plan_change")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {form.where === "place" && !form.place ? (
          <View style={styles.searchBlock}>
            <View style={styles.searchField}>
              <Icon name="search" size={16} color={chatTokens.textMuted} />
              <BottomSheetTextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("chat:plan_search_placeholder")}
                placeholderTextColor={chatTokens.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
                accessibilityLabel={t("chat:plan_search_placeholder")}
                testID="plan-form-search"
              />
              {search.isSearching ? <ActivityIndicator size="small" color={chatTokens.textSoft} /> : null}
            </View>
            <Text style={styles.subLabel}>
              {query.trim().length < 2 ? t("chat:plan_search_empty_label") : t("chat:plan_search_results")}
            </Text>
            {search.rows.map((row) => (
              <TouchableOpacity
                key={row.key}
                style={styles.resultRow}
                onPress={() => void pickResult(row)}
                disabled={retrievingKey !== null}
                accessibilityRole="button"
                accessibilityLabel={row.kind === "typed" ? t("chat:plan_search_use_typed", { query: row.name }) : [row.name, row.area].filter(Boolean).join(", ")}
                testID={`plan-place-${row.kind}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {row.kind === "typed" ? t("chat:plan_search_use_typed", { query: row.name }) : row.name}
                  </Text>
                  <Text style={styles.rowArea} numberOfLines={1}>
                    {row.kind === "typed" ? t("chat:plan_search_use_typed_sub") : row.area ?? ""}
                  </Text>
                </View>
                {retrievingKey === row.key ? <ActivityIndicator size="small" color={chatTokens.textSoft} /> : null}
                {row.onMingla ? (
                  <View style={styles.onMingla}>
                    <Text style={styles.onMinglaText}>{t("chat:plan_search_on_mingla")}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
            {search.partialFailure ? (
              // [TRANSITIONAL] `plan_search_partial_failure` is not in the B0 copy yet
              // (reported); the defaultValue is the spec's en copy until it lands.
              <Text style={styles.subLabel}>{t("chat:plan_search_partial_failure", { defaultValue: "Some results couldn't load." })}</Text>
            ) : null}
            {search.hasQuery ? <Text style={styles.attribution}>{t("chat:plan_search_attribution")}</Text> : null}
          </View>
        ) : null}
        {form.where === "link" ? (
          <View style={styles.searchBlock}>
            <BottomSheetTextInput
              value={form.link}
              onChangeText={(link) => patch({ link })}
              placeholder={t("chat:plan_link_placeholder")}
              placeholderTextColor={chatTokens.textMuted}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel={t("chat:plan_where_link")}
              testID="plan-form-link"
            />
            {linkDomain ? (
              <View style={styles.picked}>
                <Icon name="link" size={18} color={chatTokens.tagChat} />
                <View style={styles.rowText}>
                  <Text style={styles.linkDomain} numberOfLines={1}>{linkDomain}</Text>
                  <Text style={styles.rowArea} numberOfLines={1}>{normalisedLinkUrl(form.link)}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.subLabel}>{t("chat:plan_link_helper")}</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t("chat:plan_when_label")}</Text>
        <Segmented
          testID="plan-form-when"
          value={form.when}
          onChange={(when) => patch({ when })}
          options={[
            { value: "set", label: t("chat:plan_when_set") },
            { value: "poll", label: t("chat:plan_when_vote") },
          ]}
        />
        {form.when === "set" ? (
          <View style={styles.searchBlock}>
            <View style={styles.chips}>
              {days.map((day) => {
                const selected = form.date === day.date;
                const label = day.kind === "tonight"
                  ? t("chat:plan_quick_tonight")
                  : day.kind === "tomorrow"
                    ? t("chat:plan_quick_tomorrow")
                    : weekday(day.date);
                return (
                  <TouchableOpacity
                    key={day.kind}
                    style={[styles.chip, selected && styles.chipOn]}
                    onPress={() => patch({ date: day.date })}
                    hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                    testID={`plan-form-quick-${day.kind}`}
                  >
                    <Text style={styles.chipText}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <PlanDateTimeFields
              value={{ date: form.date, time: form.time }}
              onChange={(slot) => patch({ date: slot.date, time: slot.time })}
              testIDPrefix="plan-form-set"
            />
            {setPreview ? <Text style={styles.preview}>{setPreview}</Text> : null}
          </View>
        ) : (
          <View style={styles.searchBlock}>
            {form.options.map((slot, index) => (
              <View key={`option-${index}`} style={styles.optionRow}>
                <Text style={styles.optionIndex}>{index + 1}</Text>
                <View style={styles.optionFields}>
                  <PlanDateTimeFields value={slot} onChange={(next) => setOption(index, next)} testIDPrefix={`plan-form-option-${index}`} />
                </View>
                <TouchableOpacity
                  style={styles.removeOption}
                  onPress={() => patch({ options: form.options.filter((_, i) => i !== index) })}
                  accessibilityRole="button"
                  accessibilityLabel={t("chat:plan_remove_time_a11y")}
                  testID={`plan-form-remove-${index}`}
                >
                  <Icon name="close" size={16} color={chatTokens.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.optionButtons}>
              <TouchableOpacity
                style={styles.outlineButton}
                onPress={() => addOption({ date: "", time: "19:00" })}
                accessibilityRole="button"
                accessibilityLabel={t("chat:plan_add_time")}
                testID="plan-form-add-time"
              >
                <Text style={styles.outlineButtonText}>{t("chat:plan_add_time")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.outlineButton, styles.accentOutline]}
                onPress={() => {
                  const slot = suggestRandomSlot(form.options, new Date(), Math.random);
                  if (slot) addOption(slot);
                  else toastManager.info(t("chat:plan_too_many_form_times"));
                }}
                accessibilityRole="button"
                accessibilityLabel={t("chat:plan_suggest_time")}
                testID="plan-form-suggest-time"
              >
                <Icon name="sparkles" size={14} color={chatTokens.tagDeck} />
                <Text style={[styles.outlineButtonText, styles.accentOutlineText]}>{t("chat:plan_suggest_time")}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.switchRow}>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{t("chat:plan_open_times_title")}</Text>
                <Text style={styles.rowArea}>{t("chat:plan_open_times_sub")}</Text>
              </View>
              <Switch
                value={form.openTimes}
                onValueChange={(openTimes) => patch({ openTimes })}
                trackColor={{ false: chatTokens.hairline, true: chatTokens.accent }}
                thumbColor={chatTokens.textPrimary}
                accessibilityLabel={t("chat:plan_open_times_title")}
                testID="plan-form-open-times"
              />
            </View>
            <Text style={styles.subLabel}>{t("chat:plan_vote_helper")}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{t("chat:plan_note_label")}</Text>
        <BottomSheetTextInput
          value={form.note}
          onChangeText={(note) => patch({ note })}
          maxLength={PLAN_NOTE_MAX}
          multiline
          placeholderTextColor={chatTokens.textMuted}
          style={[styles.input, styles.noteInput]}
          accessibilityLabel={t("chat:plan_note_label")}
          testID="plan-form-note"
        />
      </View>

      <Text style={styles.footer}>{t("chat:plan_footer_helper", { chatName })}</Text>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: chatTokens.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  headerSide: { width: 88, minHeight: 44, justifyContent: "center" },
  headerRight: { alignItems: "flex-end" },
  headerTitle: { flex: 1, textAlign: "center", color: chatTokens.textPrimary, fontSize: 17, fontWeight: "700" },
  cancelText: { color: chatTokens.textSecondary, fontSize: 15 },
  post: { minWidth: 64, height: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  postOn: { backgroundColor: chatTokens.accent },
  postOff: { backgroundColor: chatTokens.strip },
  postText: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: "700" },
  postTextOff: { color: chatTokens.textMuted },
  body: { padding: 16, gap: 20, paddingBottom: 32 },
  section: { gap: 8 },
  label: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "700" },
  subLabel: { color: chatTokens.textSoft, fontSize: 12 },
  input: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    color: chatTokens.textPrimary,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  noteInput: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  segmented: { flexDirection: "row", gap: 4, padding: 3, borderRadius: 12, backgroundColor: chatTokens.inputBg },
  segment: { flex: 1, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: chatTokens.accent },
  segmentText: { color: chatTokens.textSecondary, fontSize: 14, fontWeight: "600" },
  segmentTextOn: { color: chatTokens.textPrimary },
  searchBlock: { gap: 8 },
  searchField: {
    height: 46,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, color: chatTokens.textPrimary, fontSize: 15, height: 46 },
  resultRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  rowArea: { color: chatTokens.textSecondary, fontSize: 12 },
  onMingla: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: chatTokens.accentSoft },
  onMinglaText: { color: chatTokens.tagDeck, fontSize: 11, fontWeight: "700" },
  attribution: { color: chatTokens.textMuted, fontSize: 11 },
  picked: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  change: { color: chatTokens.accent, fontSize: 14, fontWeight: "700" },
  linkDomain: { color: chatTokens.tagChat, fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.16)", paddingHorizontal: 14, justifyContent: "center" },
  chipOn: { borderColor: chatTokens.accent, backgroundColor: "rgba(235, 120, 37, 0.18)" },
  chipText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  preview: { color: chatTokens.textSecondary, fontSize: 13 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionIndex: { width: 18, color: chatTokens.textSoft, fontSize: 13, fontWeight: "700", textAlign: "center" },
  optionFields: { flex: 1 },
  removeOption: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  optionButtons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  outlineButton: {
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  outlineButtonText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  accentOutline: { borderColor: "rgba(235, 120, 37, 0.5)", backgroundColor: "rgba(235, 120, 37, 0.12)" },
  accentOutlineText: { color: chatTokens.tagDeck },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 },
  footer: { color: chatTokens.textSoft, fontSize: 12, lineHeight: 17 },
});
