import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 Local payout freezes the server FX quote into the shared ledger", () => {
  assertStringIncludes(source, 'db.rpc(\n    "local_payout_prepare"');
  assertStringIncludes(source, 'db.rpc(\n    "local_payout_record"');
  assertStringIncludes(source, "p_fx_snapshot_id: quote.fx_snapshot_id");
});
Deno.test("#3872 Local payout is machine-only and leaves transfer to the shared sweep", () => {
  assertStringIncludes(source, "isAuthorizedCronCaller");
  if (
    source.includes("transfers.create") ||
    source.includes("paystackInitiateTransfer")
  ) {
    throw new Error("Local payout must not create a second provider rail");
  }
});
