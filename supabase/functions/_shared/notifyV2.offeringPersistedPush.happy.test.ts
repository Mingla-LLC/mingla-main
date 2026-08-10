const source = await Deno.readTextFile(
  new URL("./notifyV2.ts", import.meta.url),
);

Deno.test("issue #1770 persisted push seam is offering-only and byte-preserving", () => {
  for (
    const required of [
      'input.category_key === "offering_invitation"',
      'input.requested_channel === "push"',
      "validatePersistedOfferingPushV1(",
      "title: persisted.title",
      "body: persisted.body",
      "event_id: persisted.eventId",
      'category_key: "offering_invitation"',
      '"biz_claim_offering_push_provider_io"',
      '"biz_record_offering_push_dispatch_result"',
    ]
  ) {
    if (!source.includes(required)) {
      throw new Error(`persisted offering push contract drifted: ${required}`);
    }
  }
});
