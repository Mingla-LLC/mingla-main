/**
 * #4523 — the Explorer's stay dates calendar for `@mingla/brand-rendering`
 * StayGuestBooking: the Mingla range calendar inline under the stay rows, in
 * the page palette, with i18n labels. Done commits; Escape closes and keeps
 * the committed dates.
 */
import React from "react";
import { CalendarEmbed } from "@mingla/calendar/CalendarField";
import type { StayRangeCalendarArgs } from "@mingla/brand-rendering/StayDateRangeRows";

import { renderCalendarIcon, useExplorerCalendarLabels } from "../calendar/explorerInlineCalendar";

function ExplorerStayRangeCalendar(args: StayRangeCalendarArgs): React.ReactElement {
  const labels = useExplorerCalendarLabels();
  return (
    <CalendarEmbed
      mode="range"
      unit="nights"
      label={args.label}
      value={args.value}
      onChange={args.onCommit}
      onDone={args.onClose}
      onCancel={args.onClose}
      min={args.min}
      max={args.max}
      maxLength={args.maxLength}
      maxStart={args.maxStart}
      timeZone={args.timeZone}
      testID={args.testID}
      labels={labels}
      config={{ tokens: args.tokens, primitives: { Sheet: () => null, renderIcon: renderCalendarIcon } }}
    />
  );
}

export function renderExplorerStayCalendar(args: StayRangeCalendarArgs): React.ReactElement {
  return <ExplorerStayRangeCalendar {...args} />;
}
