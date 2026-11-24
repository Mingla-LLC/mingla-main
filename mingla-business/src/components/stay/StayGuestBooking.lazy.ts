import React from "react";
import {
  StayGuestBooking,
  type StayGuestBookingProps,
} from "@mingla/brand-rendering/StayGuestBooking";

import { renderHostStayCalendar } from "./hostStayCalendar";

/** #4523 — the stay booking with the Host's Mingla calendar for its dates. */
export default function HostStayGuestBooking(
  props: Omit<StayGuestBookingProps, "renderStayCalendar">,
): React.ReactElement {
  return React.createElement(StayGuestBooking, { ...props, renderStayCalendar: renderHostStayCalendar });
}
