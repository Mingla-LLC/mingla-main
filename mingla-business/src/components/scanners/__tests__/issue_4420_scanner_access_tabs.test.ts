/**
 * #4420 round-3 item 5 — scanner access is a two-tab switcher, "This event" |
 * "Brand events", and the consequence line under it keeps both facts.
 * Fails when the radio rows come back, a label drifts, the brand-only open
 * shows the event tab, or a consequence line is dropped.
 */
import fs from "node:fs";
import path from "node:path";

const sheet = fs.readFileSync(path.join(__dirname, "../InviteScannerSheet.tsx"), "utf8");

describe("#4420 scanner access tabs", () => {
  it("uses the Segmented switcher with the two short labels", () => {
    expect(sheet).toContain('import { Segmented } from "../ui/Pill";');
    expect(sheet).toMatch(/\{ key: "event", label: "This event"/);
    expect(sheet).toMatch(/\{ key: "brand", label: "Brand events"/);
    expect(sheet).not.toContain('accessibilityRole="radio"');
  });

  it("shows the switcher only when an event scope is allowed", () => {
    expect(sheet).toMatch(/\{eventScopeAllowed \? \(\s*<Segmented/);
  });

  it("keeps the consequence for each scope, and never changes scope mid-submit", () => {
    expect(sheet).toContain("`They can scan ${event?.name ?? \"this event\"}.`");
    expect(sheet).toContain('"They can scan tickets at any of your events — now and later."');
    expect(sheet).toMatch(/if \(!submitting\) setScope\(next\);/);
  });
});
