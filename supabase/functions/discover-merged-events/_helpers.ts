// ORCH-0846 [Consumer event sheet venue/address parity] — pure helpers
// extracted so the regression test suite can import them without booting
// the edge function's `serve()` entrypoint.
//
// Contract: these helpers MUST mirror the brand-side resolution in
// mingla-business/src/services/publicEventsService.ts so that any business
// event row produces the same venueName / address / format on both surfaces
// (META-ORCH-0827 [Platform structure consolidation] Pass 2 Step 10 parity
// contract, restored by ORCH-0846).

export type BusinessEventFormatDraft = "in_person" | "online" | "hybrid";
export type BusinessEventFormatShared = "in-person" | "online" | "hybrid";

export function extractVenueName(theme: unknown): string | null {
  if (theme && typeof theme === "object") {
    const be = (theme as Record<string, unknown>).business_event;
    if (be && typeof be === "object") {
      const v = (be as Record<string, unknown>).venueName;
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
  }
  return null;
}

export function extractBusinessEventFormat(
  theme: unknown,
): BusinessEventFormatDraft | null {
  if (theme && typeof theme === "object") {
    const be = (theme as Record<string, unknown>).business_event;
    if (be && typeof be === "object") {
      const v = (be as Record<string, unknown>).format;
      if (v === "in_person" || v === "online" || v === "hybrid") return v;
    }
  }
  return null;
}

export function deriveSharedFormat(
  themeFormat: BusinessEventFormatDraft | null,
  isOnline: boolean,
): BusinessEventFormatShared {
  if (themeFormat === "in_person") return "in-person";
  if (themeFormat === "online") return "online";
  if (themeFormat === "hybrid") return "hybrid";
  return isOnline ? "online" : "in-person";
}

// Pure-function replica of the venueName + address resolution the
// `BusinessEventCard` builder applies. Tested directly; the production
// builder calls the underlying helpers in the same order.
export function resolveBusinessEventVenueFields(input: {
  theme: unknown;
  locationText: string | null;
  isOnline: boolean;
}): {
  venueName: string | null;
  address: string | null;
  format: BusinessEventFormatShared;
} {
  return {
    venueName: extractVenueName(input.theme) ?? input.locationText ?? null,
    address: input.locationText ?? null,
    format: deriveSharedFormat(
      extractBusinessEventFormat(input.theme),
      input.isOnline === true,
    ),
  };
}
