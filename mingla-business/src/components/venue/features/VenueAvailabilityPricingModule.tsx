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
import { DayLimitsSection } from "./offers/DayLimitsSection";
import { fetchDayClosurePreview, toVenueOfferError } from "../../../services/venueOffersService";
import type { DayClosurePreview } from "../../../types/venueOffers";
import { VenueBookingSheet } from "./bookings/VenueBookingSheet";
import { money, offerErrorCopy } from "./offers/offersModel";
import { useBrandCurrency } from "../../../hooks/useBrandCurrency";
import { useVenueSuiteStore } from "../../../store/venueSuiteStore";
import type { BrandHourEntry } from "../../../types/brand";
import {
  hoursWeekIssue,
  normalizeHoursWeek,
  reconcileHoursForm,
  sameHoursWeek,
} from "../../../utils/venueBrandHours";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { GlassCard } from "../../ui/GlassCard";
import { Skeleton } from "../../ui/Skeleton";
import {
  VenueAvailabilityModule,
  type VenueAvailabilityLeaveHandle,
} from "../VenueAvailabilityModule";
import { shortDateLabel, windowsSummary } from "./hoursModel";
import { SpecialDaySheet, type SpecialDayDraft } from "./SpecialDaySheet";
import { venueWriteErrorCopy } from "./venueFeaturesCopy";
import { shortBookingReference } from "../../../utils/venueBookingReference";

// #4490 — the hours editor is its own on-intent chunk (Settings, the add-venue
// hours step and the claim flow load it the same way), so it is never in two
// chunks at once (which would hoist it into the eager web __common chunk).
const BrandHoursEditor = React.lazy(() =>
  import("../BrandHoursEditor").then((module) => ({ default: module.BrandHoursEditor })),
);

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
  /** #4490 D25 — the venue takes table reservations (closed-day wording). */
  tableReservationsOn?: boolean;
  /**
   * #4490 R4J-N23 — where Table times' "Open tables" goes. A host without the
   * venue suite store's module switch (the Stay workspace) passes its own;
   * omitted, the button uses the store as before.
   */
  onOpenTables?: () => void;
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
  { brandId, venueId, showTableTimes, canEditHours, tableReservationsOn = false, onOpenTables },
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
  // #4490 D23/D26 — the form keeps the hours it was last in step with
  // (`base`) beside the host's edits (`draft`). Saving moves both to what was
  // saved; the server's answer then replaces both (see reconcileHoursForm).
  const [form, setForm] = useState<{ base: BrandHourEntry[] | null; draft: BrandHourEntry[] | null }>({
    base: null,
    draft: null,
  });
  const draft = form.draft;
  const setDraft = useCallback((next: BrandHourEntry[] | null): void => {
    setForm((current) => ({ ...current, draft: next === null ? current.base : next }));
  }, []);
  const [hoursStatus, setHoursStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [leave, setLeave] = useState<{ proceed: () => void; restore?: () => void } | null>(null);
  const today = localIsoDate();
  // #4490 P3 (`av-close`) — closing a day with bookings on it says who is booked first.
  const currency = useBrandCurrency(brandId);
  const [closedDay, setClosedDay] = useState<DayClosurePreview | null>(null);
  const [openBooking, setOpenBooking] = useState<string | null>(null);

  useEffect(() => {
    if (serverHours === null) return;
    setForm((current) => reconcileHoursForm(current, serverHours));
  }, [serverHours]);

  const hoursDirty = form.draft !== null && form.base !== null && !sameHoursWeek(form.draft, form.base);
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
      const saved = normalizeHoursWeek(draft);
      upsertHours.mutate(saved, {
        onSuccess: () => {
          // In step with what was saved straight away; the refetch then
          // replaces it with the server's copy (never the stale cache).
          setForm({ base: saved, draft: saved });
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

  const saveSpecialNow = useCallback(
    (input: SpecialDayDraft, preview: DayClosurePreview | null): void => {
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
            if (input.isClosed && preview !== null && preview.count > 0) setClosedDay(preview);
          },
          onError: (error) => setSheetError(errorCopy("special_day", error)),
        },
      );
    },
    [manageSpecial],
  );
  // The close confirm asks who is booked that day first (one dialog, with the count).
  const lastClosePreview = useRef<DayClosurePreview | null>(null);
  const bookingsOnDay = useCallback(
    async (localDate: string): Promise<string | null> => {
      lastClosePreview.current = null;
      if (venueId === null) return null;
      try {
        const preview = await fetchDayClosurePreview(venueId, localDate);
        lastClosePreview.current = preview;
        if (preview.count === 0) return null;
        return `${preview.count} ${preview.count === 1 ? "booking" : "bookings"} (${preview.guests} ${preview.guests === 1 ? "guest" : "guests"}) ${preview.count === 1 ? "is" : "are"} booked that day${preview.paidMinor > 0 ? `, ${money(preview.paidMinor, currency)} paid` : ""}. Closing doesn't cancel them: afterwards, move each to another day or cancel it with their money back.`;
      } catch (error) {
        const err = toVenueOfferError(error);
        return `We couldn't check who is booked that day (${offerErrorCopy(err.code, err.detail).replace(/\.$/, "")}). Look in Today before you close it.`;
      }
    },
    [currency, venueId],
  );
  const handleSaveSpecial = useCallback(
    (input: SpecialDayDraft): void => {
      const preview = lastClosePreview.current;
      saveSpecialNow(input, input.isClosed && preview !== null && preview.localDate === input.localDate ? preview : null);
    },
    [saveSpecialNow],
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
            <React.Suspense fallback={<Skeleton height={56} radius="md" />}>
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
            </React.Suspense>
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
                  <Button label="Discard" variant="ghost" size="sm" onPress={() => setDraft(null)} disabled={upsertHours.isPending} />
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
      {closedDay !== null ? (
        <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="av-closed-bookings">
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle} accessibilityRole="header">Booked on {shortDateLabel(closedDay.localDate)}</Text>
            <Button label="Done" variant="ghost" size="sm" onPress={() => setClosedDay(null)} />
          </View>
          <Text style={styles.cardBody}>
            Closing didn&apos;t cancel these. Open each one to move it to another day or cancel it with a full refund.
          </Text>
          {closedDay.bookings.map((b) => (
            <Pressable
              key={b.groupId}
              onPress={() => setOpenBooking(b.groupId)}
              accessibilityRole="button"
              accessibilityLabel={`${b.guestName}, ${b.guests} guests, ${b.offerName}. Open booking`}
              style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}
              testID={`av-closed-booking-${b.groupId}`}
            >
              <View style={styles.dayText}>
                <Text style={styles.dayTitle}>{b.guestName} · {b.guests} {b.guests === 1 ? "guest" : "guests"}</Text>
                <Text style={styles.cardBody}>
                  {b.offerName} · {shortBookingReference(b.reference)}
                  {b.paidMinor > 0 ? ` · paid ${money(b.paidMinor, currency)}` : ""}
                </Text>
              </View>
            </Pressable>
          ))}
        </GlassCard>
      ) : null}
      {/* #4490 P2-4 — a different limit (or no entry) on one date. */}
      <DayLimitsSection brandId={brandId} venueId={venueId} canEdit={canEditSpecial} today={today} />
      {showTableTimes ? (
        <View style={styles.tableTimes} testID="av-table-times">
          <Text style={styles.sectionLabel}>Table times</Text>
          <VenueAvailabilityModule
            ref={tableTimesRef}
            brandId={brandId}
            venueId={venueId}
            hideHoursLink
            onOpenTables={onOpenTables}
          />
        </View>
      ) : null}

      <SpecialDaySheet
        tableReservationsOn={tableReservationsOn}
        visible={sheet.open}
        day={sheet.open ? sheet.day : null}
        mode={sheet.open ? sheet.mode : "special"}
        today={today}
        saving={manageSpecial.isPending}
        bookingsOnDay={bookingsOnDay}
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
              setDraft(null);
              next();
            }}
            onDiscard={() => {
              const next = leave.proceed;
              setLeave(null);
              setDraft(null);
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
      <VenueBookingSheet brandId={brandId} venueId={venueId} groupId={openBooking} onClose={() => setOpenBooking(null)} />
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
