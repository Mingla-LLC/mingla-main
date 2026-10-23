import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = Deno.readTextFileSync(
  new URL("../venueOrdering/VenueOrderReviewPane.tsx", import.meta.url),
);

Deno.test("#3872 venue review renders server list, net, and discount lines", () => {
  assertStringIncludes(source, "pricedLine.discountCents > 0");
  assertStringIncludes(source, "money(pricedLine.lineTotalCents)");
  assertStringIncludes(source, "money(pricedLine.netLineTotalCents)");
  assertStringIncludes(source, "preview.discounts");
  assertStringIncludes(source, "discount.name");
  assertStringIncludes(source, "money(discount.amountCents)");
});

Deno.test("#3872 a free venue preview drops tip without client total math", () => {
  assertStringIncludes(
    source,
    'notice as { type?: unknown }).type === "tip_dropped_free_order"',
  );
  assertStringIncludes(source, "!tipDropped");
  assert(!/subtotalCents\s*\+/.test(source));
  assert(!/tipCents\s*\+/.test(source));
});
