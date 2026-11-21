"use client";

/*
 * #4523 — a date a visitor PICKS (the Mingla calendar), never types or reads off
 * a browser date box. It writes a hidden `<input name>` carrying `YYYY-MM-DD`, so
 * the surrounding GET form (`?from=&to=`) and the booking bar's FormData still
 * submit it. The calendar needs JavaScript; the page is already hydrated (the
 * #4523 decision on OD-6: the filter works with JS, it no longer works without).
 */
import { CalendarInput } from "@mingla/calendar-web";
import "@mingla/calendar-web/calendar.css";

export function SiteDateInput({
  id,
  name,
  defaultValue,
  min,
  ariaLabel,
  className,
}: {
  id?: string;
  name: string;
  defaultValue?: string | null;
  min?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <CalendarInput
      mode="date"
      id={id}
      name={name}
      defaultValue={defaultValue ?? ""}
      min={min}
      aria-label={ariaLabel}
      className={className}
      clearable
    />
  );
}
