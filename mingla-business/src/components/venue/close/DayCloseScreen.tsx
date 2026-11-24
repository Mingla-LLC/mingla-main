/**
 * #4490 spec 08 O5 part B — Close the day (`/venue/[venueId]/close`, full
 * screen): the venue's business day (its service day, from opening hours,
 * the same day "Paid in today" uses), its totals, the open checks that block
 * the close, the cash drawer, counting the cash, and the closed day with its
 * late list, Export, Print and Reopen.
 *
 * Money rules: every number is the server's; the client sends only the
 * counted total, a float or paid out, a reason. A close is a snapshot.
 * One sheet at a time (iOS rule, 08-O3 fix 3): count, drawer and reopen are
 * modes of ONE Sheet; the reopen PIN shows inside that sheet; the export PIN
 * shows in place of the screen body (no sheet is open then).
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, space, suiteFormMaxWidth, type } from "../../../constants/designSystem";
import { useCashDrawer, useDayCloseActions, useDaySummary } from "../../../hooks/useVenueDayClose";
import { fetchDayExport, type DayOpenCheck } from "../../../services/venueDayCloseService";
import { StationError } from "../../../services/venueStationService";
import { TillError, type TillPinPerson } from "../../../services/venueTillService";
import { exportDayCloseCsv } from "../../../utils/dayCloseCsv";
import { openFloorPdf } from "../../../utils/floorPdf";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { DayDateField } from "../../ui/DayDateField";
import { Sheet } from "../../ui/Sheet";
import { Skeleton } from "../../ui/Skeleton";
import { Toast } from "../../ui/Toast";
import { stationErrorCopy } from "../station/stationCopy";
import { TillStepUpHost, useStepUpSheet } from "../till/TillStepUp";
import { newTillRequestId } from "../till/tillPayModel";
import { tillHref } from "../till/tillRoute";
import { CLOSE_COPY, closeErrorCopy } from "./dayCloseCopy";
import { DayCloseChecks } from "./DayCloseChecks";
import { DayCloseCount } from "./DayCloseCount";
import { DayCloseDone } from "./DayCloseDone";
import { DayCloseDrawer, type DrawerStep } from "./DayCloseDrawer";
import { DayCloseReopen } from "./DayCloseReopen";
import { DayCloseTotals } from "./DayCloseTotals";
import { dateProblem, dayLabel, dayView } from "./dayCloseModel";

type ToastState = { kind: "success" | "error" | "info"; message: string } | null;
type SheetMode = { kind: "count" } | { kind: "drawer"; step: DrawerStep } | { kind: "reopen" } | null;

export interface DayCloseScreenProps {
  venueId: string;
  /** On a Till device login (someone switched in): who may approve with a PIN. Null on an own phone. */
  approvers: readonly TillPinPerson[] | null;
  /** "{name} is selling · Switch" on a Till device. */
  sellerSlot?: React.ReactNode;
}

function codeOf(err: unknown): string {
  return err instanceof TillError || err instanceof StationError ? err.code : "till_failed";
}

export function DayCloseScreen({ venueId, approvers, sellerSlot = null }: DayCloseScreenProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 600;
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const summaryQuery = useDaySummary(venueId, pickedDate);
  const summary = summaryQuery.data ?? null;
  const day = pickedDate ?? summary?.businessDate ?? null;
  const [sheet, setSheet] = useState<SheetMode>(null);
  const drawerQuery = useCashDrawer(venueId, day, sheet?.kind === "drawer");
  const actions = useDayCloseActions(venueId);
  const [toast, setToast] = useState<ToastState>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [movingSaleId, setMovingSaleId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  // The close's request id is kept while the same count is retried.
  const closeAttempt = useRef<{ key: string; id: string } | null>(null);

  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/venue/${venueId}` as never);
  }, [router, venueId]);

  const openSheet = (mode: SheetMode): void => {
    setSheetError(null);
    setSheet(mode);
  };
  const closeSheet = (): void => {
    setSheet(null);
    setSheetError(null);
  };

  const pickDate = (value: string): void => {
    if (summary === null) return;
    const problem = dateProblem(value, summary.today);
    if (problem !== null) {
      setDateError(problem === "future" ? CLOSE_COPY.futureDay : CLOSE_COPY.tooOld);
      return;
    }
    setDateError(null);
    setPickedDate(value === summary.today ? null : value);
  };

  const moveCheck = async (check: DayOpenCheck): Promise<void> => {
    if (day === null) return;
    setMovingSaleId(check.saleId);
    try {
      await actions.carryOver.mutateAsync({ saleId: check.saleId, date: day });
      setToast({ kind: "success", message: CLOSE_COPY.moved });
    } catch (err) {
      setToast({ kind: "error", message: closeErrorCopy(codeOf(err)) });
    } finally {
      setMovingSaleId(null);
    }
  };

  const closeTheDay = async (countedMinor: number): Promise<void> => {
    if (day === null) return;
    const key = `${day}:${countedMinor}`;
    if (closeAttempt.current === null || closeAttempt.current.key !== key) {
      closeAttempt.current = { key, id: newTillRequestId() };
    }
    setSheetError(null);
    try {
      await actions.close.mutateAsync({ date: day, countedMinor, clientRequestId: closeAttempt.current.id });
      closeAttempt.current = null;
      closeSheet();
      setToast({ kind: "success", message: CLOSE_COPY.dayClosedToast });
    } catch (err) {
      const code = codeOf(err);
      if (code === "day_already_closed") {
        closeSheet();
        setToast({ kind: "info", message: closeErrorCopy(code) });
        return;
      }
      setSheetError(closeErrorCopy(code));
    }
  };

  const saveMovement = async (input: { kind: "float" | "paid_out"; amountMinor: number; note: string | null; clientRequestId: string }): Promise<void> => {
    if (day === null) return;
    setSheetError(null);
    try {
      await actions.cashMovement.mutateAsync({ date: day, ...input });
      setToast({ kind: "success", message: input.kind === "float" ? CLOSE_COPY.floatSaved : CLOSE_COPY.paidOutSaved });
      setSheet({ kind: "drawer", step: "list" });
    } catch (err) {
      setSheetError(closeErrorCopy(codeOf(err)));
    }
  };

  const reopen = async (reason: string): Promise<void> => {
    if (day === null) return;
    setSheetError(null);
    try {
      await actions.reopen.mutateAsync({ date: day, reason });
      closeSheet();
      setToast({ kind: "success", message: CLOSE_COPY.reopened });
    } catch (err) {
      setSheetError(closeErrorCopy(codeOf(err)));
    }
  };

  const exportDay = async (): Promise<void> => {
    if (day === null || exporting) return;
    setExporting(true);
    try {
      const data = await fetchDayExport(venueId, day);
      const result = await exportDayCloseCsv(data);
      if (result.method !== "dismissed") {
        setToast({ kind: "success", message: result.method === "downloaded" ? CLOSE_COPY.exported : CLOSE_COPY.exportShared });
      }
    } catch (err) {
      setToast({ kind: "error", message: closeErrorCopy(codeOf(err)) });
    } finally {
      setExporting(false);
    }
  };

  const printDay = async (): Promise<void> => {
    if (day === null || printing) return;
    setPrinting(true);
    try {
      await openFloorPdf({ kind: "day_close", venueId, date: day });
    } catch (err) {
      const code = codeOf(err);
      setToast({ kind: "error", message: code.startsWith("floor_pdf") ? stationErrorCopy(code) : closeErrorCopy(code) });
    } finally {
      setPrinting(false);
    }
  };

  const errorCode = summaryQuery.error instanceof TillError ? summaryQuery.error.code : null;
  const content = useMemo(() => {
    if (summaryQuery.isLoading) {
      return (
        <View style={styles.loading} testID="day-close-loading">
          <Skeleton height={88} />
          <Skeleton height={88} />
          <Skeleton height={220} />
        </View>
      );
    }
    if (summary === null) {
      return (
        <CenteredState tone="error" testID="day-close-error"
          title={errorCode === "not_authorized" ? CLOSE_COPY.noPermission : CLOSE_COPY.loadFailed}
          body={errorCode !== null && errorCode !== "not_authorized" ? closeErrorCopy(errorCode) : CLOSE_COPY.loadFailedBody}>
          <Button label={CLOSE_COPY.retry} variant="secondary" onPress={() => void summaryQuery.refetch()} testID="day-close-retry" />
        </CenteredState>
      );
    }
    return null;
  }, [errorCode, summary, summaryQuery]);

  const view = summary !== null ? dayView(summary) : null;
  const body = summary === null ? content : (
    <View style={styles.column}>
      {view === "closed" ? (
        <DayCloseDone summary={summary} exporting={exporting} printing={printing}
          onExport={() => void exportDay()} onPrint={() => void printDay()} onReopen={() => openSheet({ kind: "reopen" })} />
      ) : (
        <>
          <DayCloseChecks stacked={!wide} checks={summary.openChecks} currency={summary.currency} busySaleId={movingSaleId}
            onOpenInTill={() => router.push(`${tillHref(venueId)}?checks=1` as never)} onMove={(c) => void moveCheck(c)} />
          <View style={styles.actions}>
            <Button label={CLOSE_COPY.cashDrawer} variant="secondary" leadingIcon="cash" style={styles.grow}
              onPress={() => openSheet({ kind: "drawer", step: "list" })} testID="day-close-drawer-open" />
            <Button label={CLOSE_COPY.countCash} variant="primary" style={styles.grow} disabled={!summary.canClose}
              onPress={() => openSheet({ kind: "count" })} testID="day-close-count-open" />
          </View>
        </>
      )}
      <DayCloseTotals summary={summary} wide={wide} />
      <Text style={styles.hint}>{CLOSE_COPY.dayRule}</Text>
    </View>
  );

  const sheetTitle = sheet === null ? "" : sheet.kind === "count" ? CLOSE_COPY.countCash
    : sheet.kind === "reopen" ? CLOSE_COPY.reopenTitle
    : sheet.step === "float" ? CLOSE_COPY.floatTitle : sheet.step === "paid_out" ? CLOSE_COPY.paidOutTitle : CLOSE_COPY.drawerTitle;
  const sheetBusy = actions.close.isPending || actions.cashMovement.isPending || actions.reopen.isPending;
  // #4490 08-O5 fix 6: the reopen PIN pad takes the tallest sheet (OK in view
  // on Android), and while it shows swipe, back and Close cancel it like Cancel.
  const daySheet = useStepUpSheet(venueId, 0.88, sheetBusy, closeSheet);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="day-close-screen">
      {/* #4490 08-O5 fix 6: on a phone the seller pill takes its own row under
          the title, so "Close the day" and the venue and day are never cut. */}
      <View style={styles.header} testID="day-close-header">
        <Button label={CLOSE_COPY.back} variant="ghost" size="sm" onPress={back} testID="day-close-back" />
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={wide ? 1 : 2} accessibilityRole="header">{CLOSE_COPY.title}</Text>
          {summary !== null ? <Text style={styles.sub} numberOfLines={wide ? 1 : 2}>{`${summary.venueName} · ${dayLabel(summary.businessDate)}`}</Text> : null}
        </View>
        {wide ? sellerSlot : null}
      </View>
      {!wide && sellerSlot !== null ? <View style={styles.sellerRow} testID="day-close-seller-row">{sellerSlot}</View> : null}
      <ScrollView style={styles.grow} contentContainerStyle={styles.scroll} testID="day-close-scroll">
        <View style={styles.column}>
          {summary !== null ? (
            <DayDateField label={CLOSE_COPY.day} value={day ?? ""} onChangeValue={pickDate} today={summary.today}
              accessibilityLabel={CLOSE_COPY.pickDay} error={dateError} testID="day-close-date" />
          ) : null}
          {approvers !== null && sheet === null
            ? <TillStepUpHost venueId={venueId} approvers={approvers}>{body}</TillStepUpHost>
            : body}
        </View>
      </ScrollView>

      <Sheet visible={sheet !== null} onClose={closeSheet} {...daySheet.sheet} testID="day-close-sheet">
        <View style={styles.sheetRoot}>
          <View style={styles.sheetHead}>
            <Text style={styles.h2} accessibilityRole="header" numberOfLines={2}>{sheetTitle}</Text>
            <Button label={CLOSE_COPY.back} variant="ghost" size="sm" disabled={daySheet.closeDisabled} onPress={daySheet.close} testID="day-close-sheet-close" />
          </View>
          {summary !== null && sheet?.kind === "count" ? (
            <DayCloseCount summary={summary} busy={actions.close.isPending} error={sheetError}
              onAddPaidOut={() => openSheet({ kind: "drawer", step: "paid_out" })} onClose={(c) => void closeTheDay(c)} />
          ) : null}
          {sheet?.kind === "drawer" ? (
            <DayCloseDrawer drawer={drawerQuery.data ?? null} loading={drawerQuery.isLoading}
              loadError={drawerQuery.isError ? closeErrorCopy(codeOf(drawerQuery.error)) : null}
              onRetry={() => void drawerQuery.refetch()} step={sheet.step} onStep={(step) => setSheet({ kind: "drawer", step })}
              busy={actions.cashMovement.isPending} error={sheetError} onSave={(i) => void saveMovement(i)} />
          ) : null}
          {sheet?.kind === "reopen" ? (
            <DayCloseReopen venueId={venueId} approvers={approvers} busy={actions.reopen.isPending} error={sheetError}
              onReopen={(r) => void reopen(r)} />
          ) : null}
        </View>
      </Sheet>
      <Toast visible={toast !== null} kind={toast?.kind ?? "info"} message={toast?.message ?? ""}
        onDismiss={() => setToast(null)} testID="day-close-toast" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] },
  titleBlock: { flex: 1, minWidth: 0 },
  sellerRow: { flexDirection: "row", paddingHorizontal: space[4], paddingBottom: space[2] },
  title: { ...type.h2, color: color.text1 },
  sub: { ...type.caption, color: color.text2 },
  grow: { flexGrow: 1 },
  scroll: { paddingHorizontal: space[4], paddingBottom: space[8], alignItems: "center" },
  column: { width: "100%", maxWidth: suiteFormMaxWidth + space[10] * 4, gap: space[4] },
  loading: { gap: space[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  hint: { ...type.caption, color: color.text3 },
  sheetRoot: { flex: 1, paddingHorizontal: space[4] },
  sheetHead: { flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingBottom: space[2] },
  h2: { ...type.h2, color: color.text1, flex: 1 },
});
