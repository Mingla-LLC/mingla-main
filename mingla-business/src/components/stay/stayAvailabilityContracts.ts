export type StayPlaceScheduleMode =
  "fixed_slots" | "repeating_windows" | "full_day";

interface BuildStayPlaceScheduleInput {
  mode: StayPlaceScheduleMode;
  timezone: string;
  fromDate: string;
  toDate: string;
  startTime: string;
  endTime: string;
  stopSell: boolean;
}

export function buildStayPlaceSchedule({
  mode,
  timezone,
  fromDate,
  toDate,
  startTime,
  endTime,
  stopSell,
}: BuildStayPlaceScheduleInput): Record<string, unknown> {
  return {
    mode,
    timezone,
    localStartDate: fromDate,
    ...(mode === "fixed_slots" ? {} : { localEndDate: toDate }),
    weekdays: mode === "fixed_slots" ? [] : [0, 1, 2, 3, 4, 5, 6],
    localStartTime: mode === "full_day" ? undefined : startTime,
    localEndTime: mode === "full_day" ? undefined : endTime,
    fullDayStartTime: mode === "full_day" ? startTime : undefined,
    fullDayEndTime: mode === "full_day" ? endTime : undefined,
    slotDurationMinutes: mode === "repeating_windows" ? 60 : undefined,
    slotIntervalMinutes: mode === "repeating_windows" ? 60 : undefined,
    dstFoldPolicy: "reject",
    active: !stopSell,
  };
}

export function stayRoomNightCalendarKey(
  offeringId: string,
  localDate: string,
): string {
  return `${offeringId}:${localDate}`;
}
