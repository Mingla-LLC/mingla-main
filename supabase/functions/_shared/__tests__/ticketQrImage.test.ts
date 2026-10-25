/**
 * ORCH-0932's web QR-image helper was retired by #4063. The scannable pass is
 * now Explorer-only; buyer-web producers return a claim pointer and display
 * metadata instead of rendering credentials server-side.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("ORCH-0932/#4063 has no shared server QR-image module", async () => {
  let missing = false;
  try {
    await Deno.stat(new URL("../ticketQrImage.ts", import.meta.url));
  } catch (error) {
    missing = error instanceof Deno.errors.NotFound;
  }
  assert(missing, "ticketQrImage.ts must stay retired");
});
