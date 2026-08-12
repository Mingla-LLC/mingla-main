import { normalizedPhoneForIngest } from "./index.ts";

function clientFor(data: Record<string, unknown> | null) {
  return {
    from: (_table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, _value: string) => ({
          maybeSingle: () => Promise.resolve({ data, error: null }),
        }),
      }),
    }),
  };
}

Deno.test("issue #1773 worker resolves reservation and Stay national phones once", async () => {
  const reservation = await normalizedPhoneForIngest(
    clientFor({ phone: "(919) 419-9222", phoneCountryIso: "US" }),
    { source_kind: "reservation", source_id: crypto.randomUUID(), operation: "upsert" },
  );
  if (reservation !== "+19194199222") throw new Error(`reservation=${reservation}`);

  const stay = await normalizedPhoneForIngest(
    clientFor({ phone: "020 7946 0000", phoneCountryIso: "GB" }),
    { source_kind: "stay_reservation", source_id: crypto.randomUUID(), operation: "upsert" },
  );
  if (stay !== "+442079460000") throw new Error(`stay=${stay}`);
});

Deno.test("issue #1773 worker leaves legacy and retire rows on the two-argument rail", async () => {
  const failIfFetched = {
    from: (_table: string) => {
      throw new Error("legacy/retire rows must not fetch source phone truth");
    },
  };
  for (const row of [
    { source_kind: "event_rsvp" as const, source_id: crypto.randomUUID(), operation: "upsert" as const },
    { source_kind: "reservation" as const, source_id: crypto.randomUUID(), operation: "retire" as const },
  ]) {
    if (await normalizedPhoneForIngest(failIfFetched, row) !== null) throw new Error("expected null");
  }
});
