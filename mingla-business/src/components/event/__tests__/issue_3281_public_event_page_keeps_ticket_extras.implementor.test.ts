/**
 * issue #3281 S-21 — the public event page must hand each ticket's add-ons
 * (`buyerExtras`) to the shared body, whose "Add at checkout:" list reads them.
 * mapTicket dropped them, so /e/{brand}/{event} showed none although the page
 * data had them with "show on public page" on. Source-level guard; the screen
 * itself was checked in a browser.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.join(__dirname, "..", "PublicEventPage.tsx"), "utf-8");

describe("issue #3281 S-21 — /e keeps the ticket add-ons", () => {
  test("mapTicket carries buyerExtras through", () => {
    const start = src.indexOf("const mapTicket = (t: TicketStub)");
    const end = src.indexOf("});", start);
    expect(start).toBeGreaterThan(0);
    expect(src.slice(start, end)).toMatch(/buyerExtras: t\.buyerExtras/);
  });
  test("the ticketed page hands the add-ons slot down", () => {
    const preview = readFileSync(path.join(__dirname, "..", "FoundationEventPreview.tsx"), "utf-8");
    expect(preview).toMatch(/addOns=\{publicAddOnsSlot\}/);
  });
});
