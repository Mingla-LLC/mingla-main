import { createContext, useContext } from "react";

import type { CalendarConfig } from "./types";

export const CalendarConfigContext = createContext<CalendarConfig | null>(null);

/**
 * The host injects tokens and presentation primitives, either through
 * <CalendarConfigContext.Provider> or the `config` prop. There is no silent
 * default: a missing config is a wiring bug and says so (Constitution #3).
 */
export function useCalendarConfig(explicit: CalendarConfig | undefined): CalendarConfig {
  const fromContext = useContext(CalendarConfigContext);
  const config = explicit ?? fromContext;
  if (config === null) {
    throw new Error(
      "@mingla/calendar: no config. Pass `config` or wrap in CalendarConfigContext.Provider.",
    );
  }
  return config;
}
