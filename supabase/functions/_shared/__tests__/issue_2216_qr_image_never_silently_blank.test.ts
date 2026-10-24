/**
 * #2216 is superseded by I-4063-NO-TICKET-QR-OFF-EXPLORER. A future caller
 * must not resurrect the helper that put rendered credentials in anonymous
 * checkout responses.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FUNCTIONS_ROOT = new URL("../../", import.meta.url);
const PUBLIC_PRODUCERS = [
  "ticket-checkout-create/index.ts",
  "ticket-checkout-confirm/index.ts",
  "ticket-checkout-status/index.ts",
];

Deno.test("#2216/#4063 public checkout producers cannot import or emit QR credentials", async () => {
  for (const relative of PUBLIC_PRODUCERS) {
    const source = await Deno.readTextFile(new URL(relative, FUNCTIONS_ROOT));
    for (
      const forbidden of [
        "ticketQrImage",
        "attachQrImageDataUrls",
        "qrImageDataUrl",
        "qrPayload",
        'select("id, ticket_type_id, qr_code',
      ]
    ) {
      assert(!source.includes(forbidden), `${relative} contains ${forbidden}`);
    }
  }
});
