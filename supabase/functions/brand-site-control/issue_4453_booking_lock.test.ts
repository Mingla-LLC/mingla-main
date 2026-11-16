/*
 * #4453 PR 2 (booking lock) — Core's half: Studio's OUTBOUND_ACTION_LINK and
 * BOOKING_THROUGH_ENQUIRY refusals reach the owner as a fixable
 * VALIDATION_FAILED (409) with a reason and a plain instruction, never as
 * SERVICE_TEMPORARILY_UNAVAILABLE; the publish carries Core's own brand
 * (slug, contact email, phone) as `action_scope`; and Ari's evidence carries
 * the same brand facts.
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA (declared in
 * packages/site-contracts/src/safety.ts).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BOOKING_LOCK_REASONS, bookingLockRefusal, publicationActionScope } from "./bookingLock.ts";
import { ARI_FAILURE_MESSAGES, ariFailureFrom, siteEvidence } from "./siteAri.ts";

const OP = "44530000-0000-4000-8000-000000000001";

Deno.test("#4453 OUTBOUND_ACTION_LINK is owner-fixable, naming the buttons but never the link", async () => {
  const response = bookingLockRefusal({
    code: "OUTBOUND_ACTION_LINK",
    links: [{ page_path: "", block_index: 0, block_type: "cta", field: "href", problem: "outside_mingla", href: "https://www.opentable.com/r/x" }],
  }, OP);
  assert(response);
  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.error.code, "VALIDATION_FAILED");
  assertEquals(body.error.reason_code, "OUTBOUND_ACTION_LINK");
  assertEquals(body.error.retryable, false);
  assertEquals(body.error.operation_id, OP);
  assertEquals(body.error.message, BOOKING_LOCK_REASONS.OUTBOUND_ACTION_LINK);
  assertEquals(body.error.links, [{ page_path: "", block_index: 0, block_type: "cta", field: "href", problem: "outside_mingla" }]);
  assert(!JSON.stringify(body).includes("opentable"));
});

Deno.test("#4453 BOOKING_THROUGH_ENQUIRY is owner-fixable; other codes are not this map's", async () => {
  const response = bookingLockRefusal({ code: "BOOKING_THROUGH_ENQUIRY" });
  assert(response);
  assertEquals((await response.json()).error.reason_code, "BOOKING_THROUGH_ENQUIRY");
  assertEquals(bookingLockRefusal({ code: "VALIDATION_FAILED" }), null);
  assertEquals(bookingLockRefusal({ code: "SERVICE_TEMPORARILY_UNAVAILABLE" }), null);
  assertEquals(bookingLockRefusal(null), null);
});

Deno.test("#4453 the publish carries Core's brand as action_scope", async () => {
  assertEquals(
    publicationActionScope({ slug: "young-and-stamped", contact_email: " hello@ys.test ", contact_phone: "+234 801 234 5678" }),
    { brand_slug: "young-and-stamped", contact_email: "hello@ys.test", contact_phone: "+234 801 234 5678" },
  );
  assertEquals(publicationActionScope({ slug: "young-and-stamped", contact_email: null, contact_phone: "" }), { brand_slug: "young-and-stamped" });
  assertEquals(publicationActionScope({ slug: "../evil" }), null);
  assertEquals(publicationActionScope(null), null);
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // Core's own row, read for publications only, and written over anything the caller sent.
  assert(source.includes('.select("slug,contact_email,contact_phone")'));
  assert(source.includes("action_scope: actionScope,"));
  assert(source.indexOf("...input,") < source.indexOf("action_scope: actionScope,"));
  // The booking lock is checked before the outage fallback.
  assert(source.indexOf("bookingLockRefusal(payload?.error") < source.indexOf("sitesOwnerFixableRefusal(reportedCode"));
});

Deno.test("#4453 Ari's evidence carries the brand slug and contact details; its refusal map knows BOOKING_THROUGH_ENQUIRY", async () => {
  const evidence = await siteEvidence(
    () => Promise.resolve({ data: { offerings: [] }, error: null }),
    () => Promise.resolve({ id: "b", name: "Y&S", description: null, city: null, slug: "young-and-stamped", contact_email: "hello@ys.test", contact_phone: "+2348012345678" }),
    "s",
    "b",
  );
  assertEquals(evidence?.brand.slug, "young-and-stamped");
  assertEquals(evidence?.brand.contact_email, "hello@ys.test");
  assertEquals(evidence?.brand.contact_phone, "+2348012345678");
  const refused = await ariFailureFrom({ ok: false, error: { code: "BOOKING_THROUGH_ENQUIRY", problems: ["blocks[0].heading"] } }, 409).json();
  assertEquals(refused.error.code, "BOOKING_THROUGH_ENQUIRY");
  assertEquals(refused.error.message, ARI_FAILURE_MESSAGES.BOOKING_THROUGH_ENQUIRY);
  assertEquals(refused.error.problems, ["blocks[0].heading"]);
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes('.select("id,name,description,city,slug,contact_email,contact_phone")'));
});
