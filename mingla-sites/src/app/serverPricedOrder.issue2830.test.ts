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
/*
 * Comments stripped. MenuCart's own comments quote the OLD shape by name to
 * explain the defect, so a negative assertion over the raw file matches the
 * explanation rather than the code. That has now bitten this issue five times.
 */
const cartCode = cart.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

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
    /*
     * Reads `totalCents`, which is what Mingla's venue-order rail actually
     * answers. This previously pinned `priced?.total?.amount_minor` — a shape
     * that never existed on the wire. The cart therefore treated every priced
     * response as a failure and could never show a total on any site, and this
     * assertion passed throughout because it only ever read the source.
     */
    expect(cart).toContain("money(priced?.totalCents, priced?.currency)");
    // No client-side arithmetic over prices anywhere in the cart.
    expect(cart).not.toMatch(/price_minor\s*\*/);
    expect(cart).not.toMatch(/reduce\([^)]*price/);
  });

  it("reads the fields Mingla actually sends, not invented ones", () => {
    // The seam that failed. Each of these appears in a real response body.
    for (const field of ["totalCents", "currency", "feesAndTaxCents", "itemNameAtOrder"]) {
      expect(cart).toContain(field);
    }
    // And none of the shape that never existed.
    expect(cartCode).not.toContain("amount_minor");
    expect(cartCode).not.toMatch(/result\?\.ok/);
  });

  it("shows fees and tax as ONE line, and only when there are any", () => {
    expect(cart).toContain("Fees &amp; tax");
    expect(cart).toContain("priced.feesAndTaxCents > 0");
  });

  it("the cart re-asks Mingla whenever the order changes", () => {
    /*
     * Repricing is now DERIVED from the cart rather than fired from the click
     * handler, which is what makes a cart restored from a previous visit show
     * a real total instead of nothing. So the assertion is that the pricing
     * request is keyed to the order lines, not that a particular function is
     * called.
     */
    expect(cart).toContain('mode: "preview"');
    expect(cart).toContain("}, [lines]);");
    expect(cart).toContain('body: JSON.stringify({ mode: "preview", lines })');
  });

  it("a stale price can never overwrite a newer one", () => {
    // Two quick taps start two requests. Without this, a slow FIRST response
    // can land after the second and show a total for a cart nobody has.
    expect(cart).toContain("AbortController");
    expect(cart).toContain("controller.abort()");
    expect(cart).toContain("if (!live) return;");
  });

  it("an unavailable item is surfaced rather than silently ordered", () => {
    expect(cart).toContain("unavailable");
    expect(cart).toContain("is no longer available");
  });

  it("a pricing failure says nothing was charged", () => {
    expect(cart).toContain("Nothing has been charged");
  });
});
