// MINGLA-INVARIANT: I-4238-EVENT-CATALOG-PARITY | issue #4238 | the host web pixel event names (mingla-business adPixelRuntime.web.ts HOST_FUNNEL_PIXEL_EVENTS) and the usemingla.com ones (mingla-marketing lib/ad-event-catalog.ts MARKETING_HOST_FUNNEL_PIXEL_EVENTS) equal the server catalogue rows (adEventCatalog.ts) for every host-funnel kind each browser fires, so each browser/server pair deduplicates.
/**
 * T-CAT (#4238 spec 5.1): host web (sign-up started, sign-up) and usemingla.com
 * (host lead: book a call, tools email gate) against the server catalogue.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { HOST_FUNNEL_EVENT_NAMES } from "../adEventCatalog.ts";

const BROWSER = new URL(
  "../../../../mingla-business/src/analytics/adPixelRuntime.web.ts",
  import.meta.url,
);
const MARKETING = new URL(
  "../../../../mingla-marketing/lib/ad-event-catalog.ts",
  import.meta.url,
);

function browserRows(
  src: string,
  name = "HOST_FUNNEL_PIXEL_EVENTS",
  end = "\n};",
): Record<string, Record<string, string | null>> {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const body = src.slice(start, src.indexOf(end, start));
  const rows: Record<string, Record<string, string | null>> = {};
  for (const m of body.matchAll(/(\w+): \{([^}]*)\}/g)) {
    const row: Record<string, string | null> = {};
    for (
      const f of m[2].matchAll(
        /(meta|tiktok|snap|reddit): (null|"[^"]*"|'[^']*')/g,
      )
    ) {
      row[f[1]] = f[2] === "null" ? null : f[2].slice(1, -1);
    }
    if (Object.keys(row).length === 4) rows[m[1]] = row;
  }
  return rows;
}

Deno.test("#4238 T-CAT the browser host-funnel rows equal the server catalogue", async () => {
  const rows = browserRows(await Deno.readTextFile(BROWSER));
  assertEquals(Object.keys(rows).sort(), [
    "host_signup",
    "host_signup_started",
  ]);
  for (const [kind, row] of Object.entries(rows)) {
    assertEquals(
      row,
      HOST_FUNNEL_EVENT_NAMES[kind as keyof typeof HOST_FUNNEL_EVENT_NAMES],
      `${kind} differs between browser and server`,
    );
  }
});

Deno.test("#4238 T-CAT the usemingla.com host-lead row equals the server catalogue", async () => {
  const rows = browserRows(
    await Deno.readTextFile(MARKETING),
    "MARKETING_HOST_FUNNEL_PIXEL_EVENTS",
    "} as const",
  );
  assertEquals(Object.keys(rows), ["host_lead"]);
  assertEquals(rows.host_lead, HOST_FUNNEL_EVENT_NAMES.host_lead);
});
