const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("issue #1770 ingest worker is bounded, aggregate-only, and uses derived resolver", () => {
  for (
    const token of [
      "p_limit: 100",
      'finished.status === "dead"',
      "finishUnknown",
      "biz_resolve_brand_person_source_derived",
      "biz_finish_brand_person_ingest",
      "const counts = {",
    ]
  ) {
    if (!source.includes(token)) {
      throw new Error(`missing worker contract: ${token}`);
    }
  }
  for (
    const forbidden of [
      "guest_email",
      "buyer_email",
      "normalized_value",
      "console.log",
    ]
  ) {
    if (source.includes(forbidden)) {
      throw new Error(`PII/debug token forbidden: ${forbidden}`);
    }
  }
});
