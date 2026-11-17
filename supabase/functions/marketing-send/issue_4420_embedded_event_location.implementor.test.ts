// MINGLA-INVARIANT: I-4420-MARKETING-EVENT-LOCATION-WITHHELD | issue #4420 | a marketing email's embedded event card carries the event's location line only while the host shows the address (theme.business_event.hideAddressUntilTicket === false); hidden or absent, it carries none.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { embeddedEventLocationLabel } from "./index.ts";

const line = "Quay venue · 1 Withheld Quay";

Deno.test("#4420 hidden address: no location line", () => {
  assertEquals(embeddedEventLocationLabel({
    location_text: line,
    theme: { business_event: { hideAddressUntilTicket: true } },
  }), null);
});

Deno.test("#4420 absent setting is withheld (fail closed)", () => {
  assertEquals(embeddedEventLocationLabel({ location_text: line, theme: null }), null);
  assertEquals(embeddedEventLocationLabel({ location_text: line, theme: {} }), null);
  assertEquals(embeddedEventLocationLabel({
    location_text: line,
    theme: { business_event: { hideAddressUntilTicket: "false" } },
  }), null);
});

Deno.test("#4420 visible address: the line is unchanged", () => {
  assertEquals(embeddedEventLocationLabel({
    location_text: line,
    theme: { business_event: { hideAddressUntilTicket: false } },
  }), line);
});
