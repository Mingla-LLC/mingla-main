// #4420 sheet audit (shots-bundle 03/04): the event surfaces around the shared
// Sheet keep one design pattern.
//   - The manage menu's Duplicate rows have their own glyph ("copy"), not the
//     Orders row's ticket.
//   - Event detail's Cancel event is a destructive row in the column's card
//     pattern (not a floating ghost label) and is still offered: the menu also
//     needs lifecycle actions, so this row is not a duplicate for every host.
//   - The published Event and Trip editors render Eligible buyers as the same
//     collapsible section card as their other sections, with the shared card
//     embedded (no second border, no second heading).
// FAILS-ON-REVERT: restore the ticket icon, the ghost Button, or the bare
// sectionCard wrapper and the matching test goes red.

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("#4420 sheet audit", () => {
  test("Duplicate rows use the copy glyph, never the Orders ticket", () => {
    const src = read("src/components/event/EventManageMenu.tsx");
    for (const key of ["duplicate", "duplicate-as-new"]) {
      const block = new RegExp(`key: "${key}",[\\s\\S]*?icon: "(\\w+)"`).exec(src);
      expect(block?.[1]).toBe("copy");
    }
    // The ticket glyph stays the Orders row's own.
    expect(src).toMatch(/icon: "ticket",\s*label: "Orders"/);
  });

  test("event detail keeps Cancel event as a destructive row in a card", () => {
    const src = read("app/event/[id]/index.tsx");
    const block = src.slice(src.indexOf("Cancel event CTA"), src.indexOf("Cancel event CTA") + 1400);
    expect(block).toMatch(/<GlassCard[^>]*style=\{styles\.cancelCtaWrap\}/);
    expect(block).toMatch(/<ListRow[\s\S]*title="Cancel event"[\s\S]*danger[\s\S]*onPress=\{handleCancelDialogOpen\}/);
    expect(block).not.toMatch(/variant="ghost"/);
  });

  test.each([
    ["src/components/event/EditPublishedScreen.tsx", "liveEvent.id"],
    ["src/components/trip/EditPublishedTripScreen.tsx", "trip.id"],
  ])("%s renders Eligible buyers as a collapsible section", (file, id) => {
    const src = read(file);
    expect(src).toMatch(/testID="eligible-buyers-section-header"/);
    expect(src).toMatch(/<Text style=\{styles\.sectionLabel\}>Eligible buyers<\/Text>/);
    expect(src).toContain(`<EventTicketCheckoutAccessCard eventId={${id}} embedded />`);
  });

  test("the shared card drops its own frame and heading when embedded, and uses the primitives", () => {
    const src = read("src/components/event/EventTicketCheckoutAccessCard.tsx");
    expect(src).toMatch(/const hostStyle = embedded \? styles\.hostEmbedded : styles\.host;/);
    expect(src).toMatch(/const heading = embedded \? null :/);
    expect(src).not.toMatch(/<Pressable|<TextInput/);
    expect(src).toMatch(/<Input\b/);
    expect(src).toMatch(/<Button\b/);
  });
});
