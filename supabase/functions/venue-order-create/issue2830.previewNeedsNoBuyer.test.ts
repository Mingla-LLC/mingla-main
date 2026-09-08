/*
 * #2830 — a PRICE PREVIEW has no buyer yet, and must not demand one.
 *
 * Gate 7 (counter pickup) required a buyer name unconditionally, and it runs
 * BEFORE the `mode === "preview"` return. So every counter-pickup preview
 * failed with `buyer_name_required` — including the website cart, which asks
 * for a price while the guest is still choosing and only collects a name at
 * checkout.
 *
 * On gogi's live menu that surfaced as "We could not price this order just
 * now. Nothing has been charged." on every single add. Verified against
 * production before the fix:
 *
 *   POST /functions/v1/venue-order-create  {mode:"preview", ...}
 *   400  {"error":"buyer_name_required"}
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
// The comments above name this error, so they are stripped before asserting.
const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

/*
 * There are TWO buyer-name checks and they are not the same rule:
 *   - the counter-pickup gate, BEFORE the preview return  -> create only
 *   - the contact triple, AFTER the preview return        -> unconditional
 * Only the first may be relaxed. Split on the preview return and hold each
 * half to its own rule, or a broad assertion here would forbid the correct one.
 */
// The RETURN, not the parse on the way in — `mode === "preview"` appears in
// both, and splitting on the wrong one puts the whole function on one side.
const previewReturn = code.indexOf('if (mode === "preview")');
const beforePreview = code.slice(0, previewReturn);
const afterPreview = code.slice(previewReturn);

Deno.test("a preview does not demand a buyer name", () => {
  assert(previewReturn > -1, "the preview return vanished");
  assert(
    beforePreview.includes('mode === "create" && buyerName.length < 2'),
    "the counter-pickup buyer-name gate must be scoped to create",
  );
  assert(
    !beforePreview.includes("if (buyerName.length < 2)"),
    "the unconditional form is back before the preview return — every preview will fail again",
  );
});

Deno.test("placing a real order still demands a name unconditionally", () => {
  assert(
    afterPreview.includes("if (buyerName.length < 2)"),
    "the contact triple must keep requiring a name for a real order",
  );
});

Deno.test("creating an order still demands one", () => {
  const gate = code.indexOf('buyer_name_required');
  assert(gate > -1, "the requirement must still exist for create");
});

Deno.test("counter pickup being disabled still refuses, preview included", () => {
  // Pricing an order that can never be placed would be a lie, so this one
  // stays unconditional.
  const disabled = code.indexOf('counter_pickup_unavailable');
  const buyer = code.indexOf('buyer_name_required');
  assert(disabled > -1);
  assert(
    disabled < buyer,
    "the availability check must stay ahead of, and independent of, the name",
  );
  assert(
    !/mode === "create"[\s\S]{0,80}counter_pickup_unavailable/.test(code),
    "availability must not become create-only",
  );
});

Deno.test("contact validation still runs after the preview return", () => {
  /*
   * Anchored on the email VALIDATION, not on a variable name and not on a
   * comment. `buyerPhoneE164` is parsed near the top of the function, long
   * before the preview return, so anchoring there tests nothing; comments are
   * stripped above, so anchoring on "Gate 8" tests nothing either. Both were
   * tried and both silently pointed at the wrong place.
   */
  assertEquals(previewReturn > -1, true);
  const emailCheck = code.indexOf("@[^\\s@]+");
  assert(emailCheck > -1, "contact validation must still exist");
  assert(
    emailCheck > previewReturn,
    "contact validation must stay after the preview return, or previews break again",
  );
});
