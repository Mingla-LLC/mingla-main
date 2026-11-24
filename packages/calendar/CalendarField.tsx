/**
 * @mingla/calendar field triggers (#4523): CalendarField, DateRangeField,
 * DateTimeField, DobField, CalendarEmbed, with the surface (grid, time list,
 * keyboard) loaded by the ONE React.lazy below, on first open. This file is the
 * only lazy owner in the package: no module the surface imports may add another
 * `import()` or React.lazy (Metro would hoist the shared modules into the eager
 * chunk). A host that already owns the one lazy boundary uses
 * `CalendarFieldEager` instead.
 */
import React from "react";

import type { CalendarSurfaceProps } from "./CalendarSurface";
import {
  BaseCalendarEmbed,
  BaseCalendarField,
  BaseDateRangeField,
  BaseDateTimeField,
  BaseDobField,
  SurfaceImplContext,
  type CalendarFieldProps,
  type DateRangeFieldProps,
  type DateTimeFieldProps,
  type DobFieldProps,
  type SurfaceImpl,
} from "./fields";

const LazySurface = React.lazy(() => import("./CalendarSurface"));

/** Fetch the surface chunk ahead of the first open (web pointer-enter / focus). */
export function preloadCalendarSurface(): void {
  import("./CalendarSurface").catch((error: unknown) => {
    // Only a warm-up: opening the calendar loads it again and fails loudly there.
    if (__DEV__) console.warn("[calendar] preload failed", error);
  });
}

const IMPL: SurfaceImpl = { Surface: LazySurface, preload: preloadCalendarSurface };

export type { CalendarFieldProps, DateRangeFieldProps, DateTimeFieldProps, DobFieldProps };

export function CalendarField(props: CalendarFieldProps): React.ReactElement {
  return (
    <SurfaceImplContext.Provider value={IMPL}>
      <BaseCalendarField {...props} />
    </SurfaceImplContext.Provider>
  );
}
export function DobField(props: DobFieldProps): React.ReactElement {
  return (
    <SurfaceImplContext.Provider value={IMPL}>
      <BaseDobField {...props} />
    </SurfaceImplContext.Provider>
  );
}
export function DateRangeField(props: DateRangeFieldProps): React.ReactElement {
  return (
    <SurfaceImplContext.Provider value={IMPL}>
      <BaseDateRangeField {...props} />
    </SurfaceImplContext.Provider>
  );
}
export function DateTimeField(props: DateTimeFieldProps): React.ReactElement {
  return (
    <SurfaceImplContext.Provider value={IMPL}>
      <BaseDateTimeField {...props} />
    </SurfaceImplContext.Provider>
  );
}
/** The bare surface for embedding inside a screen's own layout. */
export function CalendarEmbed(props: CalendarSurfaceProps): React.ReactElement {
  return (
    <SurfaceImplContext.Provider value={IMPL}>
      <BaseCalendarEmbed {...props} />
    </SurfaceImplContext.Provider>
  );
}
