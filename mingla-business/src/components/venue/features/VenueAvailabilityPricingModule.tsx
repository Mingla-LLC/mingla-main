/**
 * #4490 P1-9 — Availability & pricing (`av`, `av-close`).
 *
 * One place for when the venue is open: weekly hours with several windows a
 * day and past midnight (one home: `brand_hours`, ruling 2), special days,
 * closing a day, and — when table reservations are on — the unchanged Table
 * times module. Busy-time prices, rain plan and "closed by bookings" arrive
 * with offers (P2+), so they are not shown.
 *
 * Leave guard: unsaved hours ask before the host leaves the module; the Table
 * times section keeps its own guard (VenueAvailabilityLeaveHandle).
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "expo-router";

import { color, space, type } from "../../../constants/designSystem";
import { useBrandHours, useUpsertBrandHours } from "../../../hooks/useBrandHours";
import { useVenueEditAccess } from "../../../hooks/useVenueEditAccess";
import {
  localIsoDate,
  useManageVenueSpecialDay,
  useVenueSpecialDays,
} from "../../../hooks/useVenueSpecialDays";
import { VenueFeatureError, type VenueSpecialDay } from "../../../services/venueFeaturesService";
import { useVenueSuiteStore } from "../../../store/venueSuiteStore";
import type { BrandHourEntry } from "../../../types/brand";
import { hoursWeekIssue } from "../../../utils/venueBrandHours";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { GlassCard } from "../../ui/GlassCard";
import { Skeleton } from "../../ui/Skeleton";
import { BrandHoursEditor } from "../BrandHoursEditor";
import {
  VenueAvailabilityModule,
  type VenueAvailabilityLeaveHandle,
} from "../VenueAvailabilityModule";
import { shortDateLabel, windowsSummary } from "./hoursModel";
import { SpecialDaySheet, type SpecialDayDraft } from "./SpecialDaySheet";
import { venueWriteErrorCopy } from "./venueFeaturesCopy";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});
const LazyToast = React.lazy(async () => {
  const mod = await import("../../ui/Toast");
  return { default: mod.Toast };
});

export interface VenueAvailabilityPricingModuleProps {
  brandId: string | null;
  venueId: string | null;
  /** Table reservations are on (and the viewer may manage them). */
  showTableTimes: boolean;
  /** The viewer may edit spaces/special days at this venue (unscoped or venue.manage_offers). */
  canEditHours: boolean;
}

function errorCopy(context: "hours" | "special_day", error: unknown): string {
  const e = error instanceof VenueFeatureError ? error : null;
  const raw =
    e === null && error !== null && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : null;
  return venueWriteErrorCopy(context, e?.code ?? raw ?? "unknown", e?.detail ?? null);
}

type SheetState = { open: false } | { open: true; day: VenueSpecialDay | null; mode: "special" | "close" };

export const VenueAvailabilityPricingModule = forwardRef<
  VenueAvailabilityLeaveHandle,
  VenueAvailabilityPricingModuleProps
>(function VenueAvailabilityPricingModule(
  { brandId, venueId, showTableTimes, canEditHours },
  forwardedRef,
): React.ReactElement {
  const access = useVenueEditAccess(brandId, venueId);
  const canEditWeekly = access.canEditWeeklyHours;
  const canEditSpecial = canEditHours && access.canEditSpaces;
  const hoursQuery = useBrandHours(brandId, venueId);
  const upsertHours = useUpsertBrandHours(brandId, venueId);
  const specialQuery = useVenueSpecialDays(brandId, venueId);
  const manageSpecial = useManageVenueSpecialDay(brandId, venueId);
  const setDirtyModule = useVenueSuiteStore((s) => s.setDirtyModule);
  const tableTimesRef = useRef<VenueAvailabilityLeaveHandle | null>(null);

  const serverHours = hoursQuery.data ?? null;
  const [draft, setDraft] = useState<BrandHourEntry[] | null>(null);
  const [hoursStatus, setHoursStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leave, setLeave] = useState<{ proceed: () => void; restore?: () => void } | null>(null);
  const today = localIsoDate();

  useEffect(() => {
    if (serverHours !== null && draft === null) setDraft(serverHours);
  }, [draft, serverHours]);

  const hoursDirty = draft !== null && serverHours !== null && JSON.stringify(draft) !== JSON.stringify(serverHours);
  const hoursIssue = draft === null ? null : hoursWeekIssue(draft);

  useEffect(() => {
    setDirtyModule("availability", hoursDirty);
    return () => setDirtyModule("availability", false);
  }, [hoursDirty, setDirtyModule]);

  const saveHours = useCallback((): Promise<void> => {
    if (draft === null || hoursIssue !== null || !canEditWeekly) {
      return Promise.reject(new Error("invalid"));
    }
    setHoursError(null);
    return new Promise<void>((resolve, reject) => {
      upsertHours.mutate(draft, {
        onSuccess: () => {
          setDraft(null);
          setHoursStatus("saved");
          setToast("Opening hours saved");
          resolve();
        },
        onError: (error) => {
          setHoursStatus("failed");
          setHoursError(errorCopy("hours", error));
          reject(error);
        },
      });
    });
  }, [canEditWeekly, draft, hoursIssue, upsertHours]);

  // Leave handle (the shell calls requestLeave before switching modules).
  const requestLeave = useCallback(
    (proceed: () => void, restoreFocus?: () => void): void => {
      if (hoursDirty) {
        setLeave({ proceed, restore: restoreFocus });
        return;
      }
      if (tableTimesRef.current !== null) {
        tableTimesRef.current.requestLeave(proceed, restoreFocus);
        return;
      }
      proceed();
    },
    [hoursDirty],
  );
  useImperativeHandle(forwardedRef, () => ({ requestLeave }), [requestLeave]);

  // Route exits and tab closes while hours are unsaved.
  const navigation = useNavigation();
  const sanctioned = useRef(false);
  useEffect(() => {
    if (!hoursDirty) return;
    const unsubscribe = navigation.addListener("beforeRemove" as never, (raw: unknown) => {
      if (sanctioned.current) {
        sanctioned.current = false;
        return;
      }
      const event = raw as { preventDefault: () => void; data: { action: unknown } };
      event.preventDefault();
      setLeave({
        proceed: () => {
          sanctioned.current = true;
          navigation.dispatch(event.data.action as never);
        },
      });
    });
    return unsubscribe;
  }, [hoursDirty, navigation]);
  useEffect(() => {
    if (Platform.OS !== "web" || !hoursDirty) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "Your opening hours have not been saved.";
    };
    globalThis.addEventListener?.("beforeunload", guard);
    return () => globalThis.removeEventListener?.("beforeunload", guard);
  }, [hoursDirty]);

  const specialDays = useMemo(() => specialQuery.data ?? [], [specialQuery.data]);

  const handleSaveSpecial = useCallback(
    (input: SpecialDayDraft): void => {
      setSheetError(null);
      manageSpecial.mutate(
        {
          action: "set",
          localDate: input.localDate,
          isClosed: input.isClosed,
          windows: input.windows,
          label: input.label,
        },
        {
          onSuccess: () => {
            setSheet({ open: false });
            setToast(input.isClosed ? `Closed ${shortDateLabel(input.localDate)}` : "Special day saved");
          },
          onError: (error) => setSheetError(errorCopy("special_day", error)),
        },
      );
    },
    [manageSpecial],
  );
  const handleClearSpecial = useCallback((): void => {
    if (!sheet.open || sheet.day === null) return;
    const date = sheet.day.localDate;
    manageSpecial.mutate(
      { action: "clear", localDate: date },
      {
        onSuccess: () => {
          setSheet({ open: false });
          setToast(`${shortDateLabel(date)} follows your weekly hours again`);
        },
        onError: (error) => setSheetError(errorCopy("special_day", error)),
      },
    );
  }, [manageSpecial, sheet]);

  // ------------------------------------------------------------- sections
  const hoursSection = (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="av-hours">
      <Text style={styles.cardTitle} accessibilityRole="header">Opening hours</Text>
      <Text style={styles.cardBody}>
        The hours guests see on your page and your website. Add a second window for a split day, and close after midnight if you need to.
      </Text>
      {hoursQuery.isError ? (
        <CenteredState title="Couldn't load your hours" body="Check your connection and try again." tone="error" compact>
          <Button label="Try again" variant="secondary" size="sm" onPress={() => void hoursQuery.refetch()} />
        </CenteredState>
      ) : draft === null ? (
        <View style={styles.skeletons} accessibilityLabel="Loading opening hours">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={56} radius="md" />
          ))}
        </View>
      ) : (
        <>
          <View pointerEvents={canEditWeekly && !upsertHours.isPending ? "auto" : "none"} style={!canEditWeekly ? styles.locked : null}>
            <BrandHoursEditor
              hours={draft}
              onChange={(next) => {
                setDraft(next);
                setHoursStatus("idle");
                setHoursError(null);
              }}
              showErrors={hoursDirty}
              disabled={!canEditWeekly || upsertHours.isPending}
              allowWindows
            />
          </View>
          {!canEditWeekly ? (
            <Text style={styles.note}>Only brand owners and admins can change opening hours.</Text>
          ) : null}
          {hoursError !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite" testID="av-hours-error">{hoursError}</Text>
          ) : null}
          {canEditWeekly ? (
            <View style={styles.saveRow}>
              <Text style={styles.status} accessibilityLiveRegion="polite">
                {upsertHours.isPending
                  ? "Saving…"
                  : hoursDirty
                    ? hoursIssue ?? "Unsaved changes"
                    : hoursStatus === "saved"
                      ? "Saved"
                      : ""}
              </Text>
              <View style={styles.saveButtons}>
                {hoursDirty ? (
                  <Button label="Discard" variant="ghost" size="sm" onPress={() => setDraft(serverHours)} disabled={upsertHours.isPending} />
                ) : null}
                <Button
                  label="Save opening hours"
                  variant="primary"
                  size="sm"
                  onPress={() => void saveHours().catch(() => undefined)}
                  loading={upsertHours.isPending}
                  disabled={!hoursDirty || hoursIssue !== null}
                  testID="av-hours-save"
                />
              </View>
            </View>
          ) : null}
        </>
      )}
    </GlassCard>
  );

  const specialSection = (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="av-special-days">
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} accessibilityRole="header">Special days</Text>
        {canEditSpecial ? (
          <View style={styles.saveButtons}>
            <Button
              label="Close a day"
              variant="secondary"
              size="sm"
              onPress={() => {
                setSheetError(null);
                setSheet({ open: true, day: null, mode: "close" });
              }}
              testID="av-close-day"
            />
            <Button
              label="Add a special day"
              variant="secondary"
              size="sm"
              leadingIcon="plus"
              onPress={() => {
                setSheetError(null);
                setSheet({ open: true, day: null, mode: "special" });
              }}
              testID="av-add-special-day"
            />
          </View>
        ) : null}
      </View>
      {specialQuery.isLoading ? (
        <Skeleton height={48} radius="md" />
      ) : specialQuery.isError ? (
        <View style={styles.inlineError}>
          <Text style={styles.error}>Couldn&apos;t load your special days.</Text>
          <Button label="Try again" variant="ghost" size="sm" onPress={() => void specialQuery.refetch()} />
        </View>
      ) : specialDays.length === 0 ? (
        <Text style={styles.cardBody}>No special days. Add one for a holiday, a late night or a day you close.</Text>
      ) : (
        specialDays.map((day) => (
          <Pressable
            key={day.id}
            onPress={() => {
              if (!canEditSpecial) return;
              setSheetError(null);
              setSheet({ open: true, day, mode: "special" });
            }}
            disabled={!canEditSpecial}
            accessibilityRole="button"
            accessibilityLabel={`${shortDateLabel(day.localDate)}${day.label !== null ? `, ${day.label}` : ""}: ${day.isClosed ? "closed" : windowsSummary(day.windows)}${canEditSpecial ? ". Edit" : ""}`}
            style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}
            testID={`av-special-day-${day.localDate}`}
          >
            <View style={styles.dayText}>
              <Text style={styles.dayTitle}>
                {shortDateLabel(day.localDate)}
                {day.label !== null ? ` · ${day.label}` : ""}
              </Text>
              <Text style={styles.cardBody}>{day.isClosed ? "Closed" : windowsSummary(day.windows)}</Text>
            </View>
          </Pressable>
        ))
      )}
    </GlassCard>
  );

  return (
    <View style={styles.host} testID="venue-availability-pricing">
      <Text style={styles.title} accessibilityRole="header">Availability & pricing</Text>
      {hoursSection}
      {specialSection}
      {showTableTimes ? (
        <View style={styles.tableTimes} testID="av-table-times">
          <Text style={styles.sectionLabel}>Table times</Text>
          <VenueAvailabilityModule ref={tableTimesRef} brandId={brandId} venueId={venueId} hideHoursLink />
        </View>
      ) : null}

      <SpecialDaySheet
        visible={sheet.open}
        day={sheet.open ? sheet.day : null}
        mode={sheet.open ? sheet.mode : "special"}
        today={today}
        saving={manageSpecial.isPending}
        error={sheetError}
        onSave={handleSaveSpecial}
        onClear={handleClearSpecial}
        onClose={() => setSheet({ open: false })}
      />
      {leave !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            variant="leave"
            title="Save your opening hours?"
            description="You changed your opening hours. If you leave without saving, those changes are gone."
            onClose={() => {
              const restore = leave.restore;
              setLeave(null);
              restore?.();
            }}
            onConfirm={() => {
              const next = leave.proceed;
              setLeave(null);
              setDraft(serverHours);
              next();
            }}
            onDiscard={() => {
              const next = leave.proceed;
              setLeave(null);
              setDraft(serverHours);
              next();
            }}
            onSave={async () => {
              const next = leave.proceed;
              await saveHours();
              setLeave(null);
              next();
            }}
            saveDisabled={hoursIssue !== null || !canEditWeekly}
            confirmLoading={upsertHours.isPending}
            errorMessage={hoursIssue !== null ? "Fix the hours to save them, or leave without saving." : hoursError}
            testID="av-leave-dialog"
          />
        </React.Suspense>
      ) : null}
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="av-toast" />
        </React.Suspense>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  title: { ...type.h1, color: color.text1 },
  card: { gap: space[3] },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  cardTitle: { ...type.h2, color: color.text1 },
  cardBody: { ...type.small, color: color.text2 },
  skeletons: { gap: space[2] },
  locked: { opacity: 0.6 },
  note: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  saveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  status: { ...type.caption, color: color.text3, flexShrink: 1 },
  saveButtons: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  inlineError: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  dayRow: {
    minHeight: 52,
    paddingVertical: space[2],
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  pressed: { backgroundColor: color.fill.pressed },
  dayText: { gap: 2 },
  dayTitle: { ...type.row, color: color.text1 },
  tableTimes: { gap: space[2], marginHorizontal: -space[4] },
  sectionLabel: { ...type.label, color: color.text3, paddingHorizontal: space[4] },
});
