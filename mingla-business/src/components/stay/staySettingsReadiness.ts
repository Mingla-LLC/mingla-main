import type { StaySettingsRecord } from "../../types/stayInventory";

export function isStaySettingsComplete(
  settings: StaySettingsRecord | null,
): boolean {
  return (
    settings !== null &&
    (settings.summary ?? "").trim().length >= 20 &&
    settings.timezone.trim().length > 0 &&
    settings.check_in_time.length > 0 &&
    settings.check_out_time.length > 0
  );
}

export function isStaySettingsFormValid(input: {
  summary: string;
  timezone: string;
  checkIn: string;
  checkOut: string;
}): boolean {
  return (
    input.summary.trim().length >= 20 &&
    input.timezone.trim().length > 0 &&
    /^\d{2}:\d{2}$/.test(input.checkIn) &&
    /^\d{2}:\d{2}$/.test(input.checkOut) &&
    input.checkIn !== input.checkOut
  );
}
