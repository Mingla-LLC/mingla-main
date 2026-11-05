// Issue #4270 (Wave 4): the brand's plan in its Brand group. Timeline by week or
// a month grid. Hosts see Mingla as "Mingla", never a staff name (D19). Titles
// wrap and are never cut. Links open only when they pass the same check the
// server applies.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { useBrandPlan, useBrandPlanWrites } from "../../hooks/useBrandPlan";
import { useBusinessMediaTranslation } from "../../i18n";
import {
  addIsoDays,
  addMonths,
  BrandPlanError,
  brandPlanErrorKey,
  brandPlanMonthGrid,
  brandPlanWeeks,
  isBrandPlanLink,
  localIsoDay,
  mapBrandPlanError,
  type BrandPlanItem,
} from "../../services/brandPlanService";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";
import { BrandPlanAddSheet, type BrandPlanEdit } from "./BrandPlanAddSheet";

interface Props {
  brandId: string;
  /** In the wide web rail: no back button, and the form sits in the rail. */
  compact?: boolean;
  onBack?: () => void;
}

const MAX_DOTS = 3;
const KNOWN_STATES = new Set(["planned", "being_made", "in_review", "scheduled", "posted", "todo", "doing", "done", "live", "draft", "happened", "on_mingla"]);

export function BrandPlanPanel({ brandId, compact = false, onBack }: Props): React.ReactElement {
  const { t, language } = useBusinessMediaTranslation();
  const insets = useSafeAreaInsets();
  const deviceToday = localIsoDay();
  const [segment, setSegment] = useState<"timeline" | "calendar">("timeline");
  const [month, setMonth] = useState(deviceToday.slice(0, 7));
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit: BrandPlanEdit | null; initialDate: string | null } | null>(null);
  const [menuItem, setMenuItem] = useState<BrandPlanItem | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "warn" | "error"; message: string } | null>(null);
  const grid = useMemo(() => brandPlanMonthGrid(month), [month]);
  const windowFrom = segment === "timeline" ? addIsoDays(deviceToday, -7) : grid[0];
  const windowTo = segment === "timeline" ? addIsoDays(deviceToday, 90) : grid[grid.length - 1];
  const query = useBrandPlan(brandId, windowFrom, windowTo);
  const { remove } = useBrandPlanWrites(brandId);
  const plan = query.data;
  const today = plan?.today ?? deviceToday;
  const items = useMemo(() => plan?.items ?? [], [plan]);
  const weeks = useMemo(() => brandPlanWeeks(items, today), [items, today]);
  const byDay = useMemo(() => {
    const map = new Map<string, BrandPlanItem[]>();
    for (const item of items) map.set(item.on, [...(map.get(item.on) ?? []), item]);
    return map;
  }, [items]);
  const notAvailable = query.error instanceof BrandPlanError && query.error.code === "not_found";

  const dayWords = (iso: string, options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  const itemDay = (iso: string): string => dayWords(iso, { weekday: "short", day: "numeric", month: "short" });

  const openLink = (url: string): void => {
    if (!isBrandPlanLink(url)) return;
    void Linking.openURL(url).catch(() => setToast({ kind: "error", message: t("plan.link_failed") }));
  };
  const closeMenu = (): void => { setMenuItem(null); setConfirmRemove(false); };
  const openEdit = (field: BrandPlanEdit["field"], item: BrandPlanItem): void => {
    closeMenu();
    setForm({ edit: { field, item }, initialDate: null });
  };
  async function confirmRemoval(item: BrandPlanItem): Promise<void> {
    try {
      await remove.mutateAsync(item);
      closeMenu();
      setToast({ kind: "success", message: t("plan.removed") });
    } catch (cause) {
      closeMenu();
      setToast({ kind: "error", message: t(`plan.${brandPlanErrorKey(mapBrandPlanError(cause), "save_failed")}`) });
    }
  }

  const row = (item: BrandPlanItem): React.ReactElement => {
    const stateWords = KNOWN_STATES.has(item.state) ? t(`plan.state_${item.state}`) : item.state_words;
    const byWords = item.mine ? t("plan.by_you") : item.by === "host" ? t("plan.by_team") : t("plan.by_mingla");
    const liveUrl = item.live_url && isBrandPlanLink(item.live_url) ? item.live_url : null;
    return (
      <Pressable
        key={`${item.kind}-${item.id}`}
        onLongPress={item.can_edit ? () => setMenuItem(item) : undefined}
        style={styles.row}
        testID={`brand-plan-item-${item.id}`}
      >
        <View style={styles.rowTop}>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowMeta}>{`${t(`plan.kind_${item.kind}`)} · ${itemDay(item.on)} · ${byWords}`}</Text>
          </View>
          <View style={styles.chip}><Text style={styles.chipText}>{stateWords}</Text></View>
          {item.can_edit ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("plan.menu_a11y", { title: item.title })} hitSlop={4} onPress={() => setMenuItem(item)} style={styles.menuButton} testID={`brand-plan-menu-${item.id}`}>
              <Icon name="moreH" size={18} color={textTokens.secondary} />
            </Pressable>
          ) : null}
        </View>
        {item.link || liveUrl || item.can_edit ? (
          <View style={styles.rowLinks}>
            {item.link ? (
              <Pressable accessibilityRole="link" accessibilityLabel={t("plan.open_link_a11y", { title: item.title })} onPress={() => { if (item.link) openLink(item.link.url); }} style={styles.linkButton} testID={`brand-plan-open-${item.id}`}>
                <Text style={styles.linkText}>{`↗ ${item.link.site}`}</Text>
              </Pressable>
            ) : null}
            {liveUrl ? (
              <Pressable accessibilityRole="link" accessibilityLabel={t("plan.view_post")} onPress={() => openLink(liveUrl)} style={styles.linkButton}>
                <Text style={styles.linkText}>{`↗ ${t("plan.view_post")}`}</Text>
              </Pressable>
            ) : null}
            {item.can_edit ? (
              <Pressable accessibilityRole="button" accessibilityLabel={item.link ? t("plan.change_link") : t("plan.add_link")} onPress={() => openEdit("link", item)} style={styles.linkEdit} testID={`brand-plan-link-edit-${item.id}`}>
                <Text style={styles.linkEditText}>{item.link ? t("plan.change_link") : t("plan.add_link")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    );
  };

  const todayLine = (
    <View style={styles.todayLine} testID="brand-plan-today">
      <View style={styles.todayRule} />
      <Text style={styles.todayText}>{t("plan.today")}</Text>
      <View style={styles.todayRule} />
    </View>
  );

  const timeline = items.length === 0 ? (
    <View style={styles.state}><Icon name="calendar" size={42} color={textTokens.tertiary} /><Text style={styles.stateText} testID="brand-plan-empty">{t("plan.empty")}</Text></View>
  ) : (
    <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} testID="brand-plan-timeline">
      {weeks.map((week) => (
        <View key={week.key} style={styles.week}>
          <Text style={styles.weekLabel}>{week.label === "this" ? t("plan.this_week") : week.label === "next" ? t("plan.next_week") : t("plan.week_of", { date: dayWords(week.key, { day: "numeric", month: "short" }) })}</Text>
          {week.items.map((item, index) => (
            <React.Fragment key={`${item.kind}-${item.id}`}>
              {index === week.todayIndex ? todayLine : null}
              {row(item)}
            </React.Fragment>
          ))}
          {week.todayIndex >= week.items.length ? todayLine : null}
        </View>
      ))}
    </ScrollView>
  );

  const dayItems = pickedDay ? byDay.get(pickedDay) ?? [] : [];
  const calendar = (
    <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} testID="brand-plan-calendar">
      <View style={styles.monthBar}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("plan.prev_month_a11y")} onPress={() => { setMonth(addMonths(month, -1)); setPickedDay(null); }} style={styles.menuButton}><Icon name="arrowL" size={18} color={textTokens.primary} /></Pressable>
        <Text style={styles.monthTitle} accessibilityRole="header">{dayWords(`${month}-15`, { month: "long", year: "numeric" })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("plan.next_month_a11y")} onPress={() => { setMonth(addMonths(month, 1)); setPickedDay(null); }} style={styles.menuButton}><Icon name="chevR" size={18} color={textTokens.primary} /></Pressable>
      </View>
      <View style={styles.gridRow}>
        {grid.slice(0, 7).map((day) => <Text key={day} style={styles.weekday}>{dayWords(day, { weekday: "narrow" })}</Text>)}
      </View>
      <View style={styles.grid}>
        {grid.map((day) => {
          const list = byDay.get(day) ?? [];
          const extra = list.length - MAX_DOTS;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={t("plan.day_a11y", { date: dayWords(day, { weekday: "long", day: "numeric", month: "long" }), n: list.length })}
              accessibilityState={{ selected: pickedDay === day }}
              onPress={() => setPickedDay(day)}
              style={[styles.dayCell, pickedDay === day && styles.dayCellPicked]}
              testID={`brand-plan-day-${day}`}
            >
              <Text style={[styles.dayNumber, !day.startsWith(month) && styles.dayNumberOther, day === today && styles.dayNumberToday]}>{Number(day.slice(8))}</Text>
              <View style={styles.dots}>
                {list.slice(0, MAX_DOTS).map((item) => <View key={`${item.kind}-${item.id}`} style={styles.dot} />)}
                {extra > 0 ? <Text style={styles.dotMore}>{t("plan.more", { n: extra })}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {pickedDay ? (
        dayItems.length ? <View style={styles.week}>{dayItems.map(row)}</View> : <Text style={styles.stateText} testID="brand-plan-day-empty">{t("plan.day_empty")}</Text>
      ) : null}
    </ScrollView>
  );

  const body = query.isLoading ? (
    <View style={styles.list} accessibilityLabel={t("plan.loading")} testID="brand-plan-loading">
      {Array.from({ length: 4 }, (_, index) => <View key={index} style={styles.skeleton} />)}
      <ActivityIndicator color={accent.warm} />
    </View>
  ) : notAvailable ? (
    <View style={styles.state}><Text style={styles.stateText} testID="brand-plan-not-available">{t("plan.not_available")}</Text></View>
  ) : query.isError && !plan ? (
    <View style={styles.state}>
      <Text style={styles.stateText} testID="brand-plan-error">{t("plan.load_error")}</Text>
      <Button label={t("plan.try_again")} variant="secondary" onPress={() => void query.refetch()} testID="brand-plan-retry" />
    </View>
  ) : segment === "timeline" ? timeline : calendar;

  const inlineForm = compact && form !== null;
  const canAdd = plan?.can_add === true && !notAvailable;
  const addDate = pickedDay && pickedDay >= today ? pickedDay : null;

  return (
    <View style={styles.root} testID="brand-plan-panel">
      {!inlineForm ? (
        <>
          {!compact ? (
            <View style={styles.header}>
              {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={t("plan.back")} onPress={onBack} style={styles.iconButton} testID="brand-plan-back"><Icon name="arrowL" size={18} color={textTokens.primary} /></Pressable> : null}
              <View style={styles.headerCopy}>
                <Text style={styles.title} accessibilityRole="header">{t("plan.pill")}</Text>
                {plan?.brand.name ? <Text style={styles.subtitle}>{plan.brand.name}</Text> : null}
              </View>
            </View>
          ) : null}
          <View accessibilityRole="tablist" style={styles.tabs}>
            {(["timeline", "calendar"] as const).map((value) => (
              <Pressable key={value} accessibilityRole="tab" accessibilityLabel={t(`plan.seg_${value}`)} accessibilityState={{ selected: segment === value }} onPress={() => setSegment(value)} style={[styles.tab, segment === value && styles.tabActive]} testID={`brand-plan-seg-${value}`}>
                <Text style={[styles.tabText, segment === value && styles.tabTextActive]}>{t(`plan.seg_${value}`)}</Text>
              </Pressable>
            ))}
          </View>
          {body}
          {canAdd && form === null && menuItem === null ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("plan.submit")} onPress={() => setForm({ edit: null, initialDate: addDate })} style={[styles.fab, { bottom: insets.bottom + spacing.md }]} testID="brand-plan-add">
              <Icon name="plus" size={18} color="#101216" />
              <Text style={styles.fabText}>{t("plan.add_fab")}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <BrandPlanAddSheet
        visible={form !== null}
        inline={compact}
        brandId={brandId}
        today={today}
        initialDate={form?.initialDate ?? null}
        edit={form?.edit ?? null}
        onClose={() => setForm(null)}
        onDone={(key) => { setForm(null); setToast({ kind: "success", message: t(`plan.${key}`) }); }}
        onStale={(key) => { setForm(null); setToast({ kind: "warn", message: t(`plan.${key}`) }); }}
      />

      <Sheet visible={menuItem !== null} onClose={closeMenu} snapPoint="half" dismissDisabled={remove.isPending} testID="brand-plan-menu-sheet">
        {menuItem ? (
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>{menuItem.title}</Text>
            {confirmRemove ? (
              <>
                <Text style={styles.stateText}>{t("plan.remove_confirm")}</Text>
                <Button label={t("plan.remove")} variant="destructive" fullWidth loading={remove.isPending} disabled={remove.isPending} onPress={() => void confirmRemoval(menuItem)} testID="brand-plan-remove-confirm" />
                <Button label={t("plan.cancel")} variant="ghost" fullWidth disabled={remove.isPending} onPress={() => setConfirmRemove(false)} />
              </>
            ) : (
              <>
                <Button label={t("plan.change_date")} variant="secondary" fullWidth onPress={() => openEdit("date", menuItem)} testID="brand-plan-change-date" />
                <Button label={t("plan.change_link")} variant="secondary" fullWidth onPress={() => openEdit("link", menuItem)} testID="brand-plan-change-link" />
                <Button label={t("plan.remove")} variant="destructiveOutline" fullWidth onPress={() => setConfirmRemove(true)} testID="brand-plan-remove" />
              </>
            )}
          </View>
        ) : <View />}
      </Sheet>

      <Toast visible={toast !== null} kind={toast?.kind ?? "success"} message={toast?.message ?? ""} onDismiss={() => setToast(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  scrollFlex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  subtitle: { color: textTokens.tertiary, fontSize: 12, marginTop: 2 },
  tabs: { minHeight: 56, flexDirection: "row", gap: 4, alignItems: "center", paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  tab: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  tabActive: { borderWidth: 1, borderColor: "rgba(235,120,37,0.38)", backgroundColor: "rgba(235,120,37,0.10)" },
  tabText: { color: textTokens.tertiary, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: textTokens.primary, fontWeight: "800" },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20 },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: 96 },
  skeleton: { height: 72, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase },
  week: { gap: spacing.sm },
  weekLabel: { color: textTokens.tertiary, fontSize: 12, fontWeight: "800" },
  row: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileElevated, backgroundColor: glass.tint.profileElevated },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { color: textTokens.primary, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  rowMeta: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.08)" },
  chipText: { color: textTokens.secondary, fontSize: 11, fontWeight: "700" },
  menuButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  rowLinks: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  linkButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: "rgba(235,120,37,0.10)" },
  linkText: { color: textTokens.primary, fontSize: 13, fontWeight: "700" },
  linkEdit: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  linkEditText: { color: accent.warm, fontSize: 13, fontWeight: "700" },
  todayLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  todayRule: { flex: 1, height: 1, backgroundColor: accent.warm },
  todayText: { color: accent.warm, fontSize: 11, fontWeight: "800" },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitle: { color: textTokens.primary, fontSize: 15, fontWeight: "800" },
  gridRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", color: textTokens.tertiary, fontSize: 11, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, minHeight: 52, alignItems: "center", paddingVertical: 4, gap: 3, borderRadius: radius.md },
  dayCellPicked: { backgroundColor: "rgba(235,120,37,0.14)" },
  dayNumber: { color: textTokens.primary, fontSize: 13, fontWeight: "600" },
  dayNumberOther: { color: textTokens.tertiary },
  dayNumberToday: { color: accent.warm, fontWeight: "800" },
  dots: { minHeight: 10, flexDirection: "row", alignItems: "center", gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: accent.warm },
  dotMore: { color: textTokens.tertiary, fontSize: 9, fontWeight: "700" },
  fab: { position: "absolute", right: spacing.md, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: accent.warm },
  fabText: { color: "#101216", fontSize: 14, fontWeight: "800" },
  menu: { padding: spacing.md, gap: spacing.sm },
  menuTitle: { color: textTokens.primary, fontSize: 16, lineHeight: 22, fontWeight: "800" },
});
