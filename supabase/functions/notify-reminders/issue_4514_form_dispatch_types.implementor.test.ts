// #4514 wave 4 — notify-reminders names its dispatch shapes from a module with
// no imports, so the secret-contract audit (which walks `import type` edges)
// does not pull the delivery adapters and their secrets into its closure. This
// keeps those local shapes assignable to notifyV2's, and pins the import graph.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type {
  FormDispatchInput,
  FormDispatchResult,
} from "../_shared/brandFormDispatchTypes.ts";
import type { DispatchV2Input, DispatchV2Result } from "../_shared/notifyV2.ts";

// Compile-time: what the reminder path builds is a valid notifyV2 input, and
// what notify-dispatch returns is readable as the local result.
const asNotifyInput = (i: FormDispatchInput): DispatchV2Input => i;
const asLocalResult = (r: DispatchV2Result): FormDispatchResult => r;

Deno.test("local dispatch shapes stay assignable to notifyV2", () => {
  const input = asNotifyInput({
    category_key: "k",
    payload: {},
    idempotency_key: "i",
    email_cta: { label: "l", url: "u", note: "n" },
  });
  assertEquals(input.category_key, "k");
  assertEquals(asLocalResult({ success: true }).success, true);
});

Deno.test("notify-reminders and brandFormRequests do not import notifyV2", async () => {
  for (const f of ["./index.ts", "../_shared/brandFormRequests.ts"]) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    assert(!/notifyV2/.test(src), `${f} must not reference notifyV2`);
  }
});
