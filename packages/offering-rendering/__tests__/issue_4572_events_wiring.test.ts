// MINGLA-INVARIANT: I-4572-PRICE-FROM-ONE-OWNER | issue #4572 | Every "From <price>" / "Free" label on the brand page (upcoming cards, next-up bar, experience, event and trip cards) and the Host brand teaser comes from packages/offering-rendering/priceFromLabel.ts: free first, then "From <formatMoney>" (₦ glyph), and nothing when the price is unknown. No other `From ${` template may appear in those files.
// issue #4572 items 7b and 7e — the source rules (Deno, deno2-discovered lane).
// Behaviour is proven by the mingla-business jest suites issue_4572_price_from_label
// and issue_4572_brand_zone_first; this file holds the "one owner" wiring.
//
// FAILS-ON-REVERT (true line deletion):
//   - restore the brand page's own `offeringPriceLabel` with a `From ${` template,
//     or NextEventTeaser's inline price → W-1 fails;
//   - delete the brandZoneForNewDraft effect from EventCreatorWizard or
//     RsvpCreatorWizard, or `brandZone:` from the experience wizard → W-2 fails.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const code = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

Deno.test("W-1 the brand page and the Host teaser build no 'From' label themselves", () => {
  for (const rel of [
    "../../brand-rendering/PublicBrandPage.tsx",
    "../../../mingla-business/src/components/brand/NextEventTeaser.tsx",
  ]) {
    const src = code(rel);
    assert(!src.includes("From ${"), `${rel} builds its own "From" template`);
    assert(!/\bofferingPriceLabel\b/.test(src), `${rel} still has offeringPriceLabel`);
    assert(src.includes("priceFromLabel("), `${rel} does not use priceFromLabel`);
  }
  const teaser = code("../../../mingla-business/src/components/brand/NextEventTeaser.tsx");
  assert(!/\?\s*"Free"/.test(teaser), "NextEventTeaser fabricates Free for an unknown price");
});

Deno.test("W-2 every wizard reads the one brand-zone rule", () => {
  for (const rel of [
    "../../../mingla-business/src/components/event/EventCreatorWizard.tsx",
    "../../../mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx",
  ]) {
    const src = code(rel);
    assert(/brandZoneForNewDraft\(\{\s*brand,\s*draftDate: liveDraft\.date,/.test(src), `${rel} lacks the brand-zone effect`);
    assert(src.includes("updateDraft(liveDraft.id, { timezone: zone })"), `${rel} never applies the zone`);
  }
  assert(code("../../../mingla-business/src/components/experience/ExperienceCreatorWizard.tsx")
    .includes("brandZone: brand?.defaultTimezone ?? null"), "experience wizard lacks brandZone");
  assert(code("../../../mingla-business/src/hooks/useExperienceDraftAdapter.ts")
    .includes("brandZone: brandTzHints?.brandZone"), "experience adapter lacks brandZone");
});
