import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * #2830 -- a browser may never name its own price.
 *
 * The cart runs in the customer's browser. Anyone with dev tools can edit what
 * it posts, so if the server trusted a client-supplied price you could buy a
 * 9,500 naira plate for 1 naira. This is true with a perfectly fresh menu; it
 * is a property of taking money, not a staleness workaround.
 *
 * Mingla's venue-order rail already takes { menuItemId, quantity } and prices
 * the order itself. These tests pin that the website's proxy cannot break that
 * by forwarding anything richer.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

const route = read("src/app/api/order/route.ts");
const cart = read("src/components/MenuCart.tsx");

describe("#2830 the server prices the order", () => {
  it("the proxy forwards ONLY ids and quantities", () => {
    const forwarded = route.slice(route.indexOf("lines: lines.map("));
    const block = forwarded.slice(0, forwarded.indexOf("})),") + 4);
    expect(block).toContain("menuItemId: line.menuItemId");
    expect(block).toContain("quantity: line.quantity");
    expect(block).not.toContain("price");
    expect(block).not.toContain("total");
    expect(block).not.toContain("currency");
  });

  it("the parser reads ONLY an id and a quantity from each row", () => {
    // Assert on what the code actually reads, not on a slice of text: an
    // earlier version of this test sliced to a bad delimiter, ran to the end
    // of the file, and flagged the word "price" in a comment.
    const read = new Set(
      [...route.matchAll(/\brow\.([A-Za-z_]+)/g)].map((match) => match[1]),
    );
    expect([...read].sort()).toEqual(["menuItemId", "quantity"]);
  });

  it("the VENUE comes from the published artifact, never the request", () => {
    expect(route).toContain("async function orderableVenue()");
    expect(route).toContain("loadPublication(host)");
    // The only venueId sent to Mingla is the one resolved from the artifact.
    expect(route).toContain("venueId: venue.venueId");
    expect(route).not.toContain("payload.venueId");
    expect(route).not.toContain("body.venueId");
  });

  it("no orderable venue means the door is closed, not guessed", () => {
    expect(route).toContain('error: "ordering_unavailable"');
  });

  it("bounds the order so one request cannot be enormous", () => {
    expect(route).toContain("MAX_LINES");
    expect(route).toContain("MAX_QTY");
  });

  it("the cart displays Mingla's total and never computes one", () => {
    expect(cart).toContain("priced?.total?.amount_minor");
    // No client-side arithmetic over prices anywhere in the cart.
    expect(cart).not.toMatch(/price_minor\s*\*/);
    expect(cart).not.toMatch(/reduce\([^)]*price/);
  });

  it("the cart re-asks Mingla whenever the order changes", () => {
    expect(cart).toContain("void reprice(");
    expect(cart).toContain('mode: "preview"');
  });

  it("an unavailable item is surfaced rather than silently ordered", () => {
    expect(cart).toContain("unavailable");
    expect(cart).toContain("is no longer available");
  });

  it("a pricing failure says nothing was charged", () => {
    expect(cart).toContain("Nothing has been charged");
  });
});
