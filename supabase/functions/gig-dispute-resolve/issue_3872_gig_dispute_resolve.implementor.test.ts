import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 dispute settlement validates the human decision before money moves", () => {
  assertStringIncludes(source, 'userDb.rpc("gig_dispute_admin_decide"');
  assertStringIncludes(source, 'userDb.rpc("gig_dispute_offer_respond"');
  assertStringIncludes(
    source,
    'outcome === "release" ? "gig-release" : "gig-refund"',
  );
});
Deno.test("#3872 dispute settlement uses service-only workers after the decision", () => {
  assertStringIncludes(source, "Authorization: `Bearer ${serviceKey}`");
  assertStringIncludes(source, 'branch: outcome === "full_refund"');
  assertStringIncludes(source, 'return json({ error: "settlement_failed"');
});
