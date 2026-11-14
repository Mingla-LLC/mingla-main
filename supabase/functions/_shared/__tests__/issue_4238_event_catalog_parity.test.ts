// MINGLA-INVARIANT: I-4238-EVENT-CATALOG-PARITY | issue #4238 | the host web pixel event names (mingla-business adPixelRuntime.web.ts HOST_FUNNEL_PIXEL_EVENTS) equal the server catalogue rows (adEventCatalog.ts) for every host-funnel kind the browser fires, so each browser/server pair deduplicates.
/**
 * T-CAT (#4238 spec 5.1), host-web half. The usemingla.com copy
 * (mingla-marketing/lib/ad-event-catalog.ts) is added with the marketing
 * sender side (W3-1 / W3-2 marketing half, after #4339) and joins this test then.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { HOST_FUNNEL_EVENT_NAMES } from "../adEventCatalog.ts";

const BROWSER = new URL(
  "../../../../mingla-business/src/analytics/adPixelRuntime.web.ts",
  import.meta.url,
);

function browserRows(src: string): Record<string, Record<string, string | null>> {
  const start = src.indexOf("export const HOST_FUNNEL_PIXEL_EVENTS");
  if (start < 0) throw new Error("HOST_FUNNEL_PIXEL_EVENTS not found");
  const body = src.slice(start, src.indexOf("\n};", start));
  const rows: Record<string, Record<string, string | null>> = {};
  for (const m of body.matchAll(/(\w+): \{([^}]*)\}/g)) {
    const row: Record<string, string | null> = {};
    for (const f of m[2].matchAll(/(meta|tiktok|snap|reddit): (null|"[^"]*")/g)) {
      row[f[1]] = f[2] === "null" ? null : f[2].slice(1, -1);
    }
    if (Object.keys(row).length === 4) rows[m[1]] = row;
  }
  return rows;
}

Deno.test("#4238 T-CAT the browser host-funnel rows equal the server catalogue", async () => {
  const rows = browserRows(await Deno.readTextFile(BROWSER));
  assertEquals(Object.keys(rows).sort(), ["host_signup", "host_signup_started"]);
  for (const [kind, row] of Object.entries(rows)) {
    assertEquals(
      row,
      HOST_FUNNEL_EVENT_NAMES[kind as keyof typeof HOST_FUNNEL_EVENT_NAMES],
      `${kind} differs between browser and server`,
    );
  }
});
