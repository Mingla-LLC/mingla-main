import { normalizedPhoneForIngest } from "./index.ts";

function clientFor(data: Record<string, unknown> | null, error: unknown = null) {
  return {
    from: (_table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, _value: string) => ({ maybeSingle: () => Promise.resolve({ data, error }) }),
      }),
    }),
  };
}

Deno.test("issue #1773 worker refuses national phone guesses without valid uppercase ISO", async () => {
  for (const country of [null, "us", "ZZ"]) {
    const value = await normalizedPhoneForIngest(
      clientFor({ phone: "(919) 419-9222", phoneCountryIso: country }),
      { source_kind: "reservation", source_id: crypto.randomUUID(), operation: "upsert" },
    );
    if (value !== null) throw new Error(`guessed phone for country=${country}`);
  }
});

Deno.test("issue #1773 worker tolerates missing Stay keys and masks fetch detail", async () => {
  const missing = await normalizedPhoneForIngest(
    clientFor({ phone: null, phoneCountryIso: null }),
    { source_kind: "stay_reservation", source_id: crypto.randomUUID(), operation: "upsert" },
  );
  if (missing !== null) throw new Error(`missing keys yielded ${missing}`);
  let failed = "";
  try {
    await normalizedPhoneForIngest(
      clientFor(null, { message: "PII-bearing database detail" }),
      { source_kind: "reservation", source_id: crypto.randomUUID(), operation: "upsert" },
    );
  } catch (error) {
    failed = error instanceof Error ? error.message : "";
  }
  if (failed !== "source_fetch_failed") throw new Error(`unsafe fetch code=${failed}`);
});
