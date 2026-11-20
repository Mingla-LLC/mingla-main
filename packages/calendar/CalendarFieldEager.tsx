/**
 * @mingla/calendar fields with the surface imported STATICALLY (#4523). For a
 * host that owns the single lazy boundary itself (Host `DateField` loads its
 * whole body with one React.lazy), so the package adds no second lazy and no
 * calendar module is imported eagerly by that host's consumers.
 */
import React from "react";

import CalendarSurface from "./CalendarSurface";
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
import type { CalendarSurfaceProps } from "./CalendarSurface";

const IMPL: SurfaceImpl = { Surface: CalendarSurface };

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
