// ===========================================================================
// #2218 T-6 — THE TERMII WEBHOOK MUST RECONCILE THE BUYER'S OWN ROW.
// ===========================================================================
// The asymmetry this pins: `twilio-message-status` writes to BOTH
// `notification_deliveries` AND `ticket_order_notifications`;
// `termii-delivery-status` wrote only the first. So on the American rail the
// buyer's own confirmation row gained a `delivered_at` two seconds after the
// send — observable in production — and on the Nigerian rail it structurally
// could not, no matter what Termii reported. A support agent looking up a
// Nigerian buyer would see `sent` forever.
//
// These tests drive the REAL handler with a real HMAC-SHA512 signature and
// capture the patches, so they fail if the reconcile is dropped, keyed wrongly,
// or ever starts nulling a delivered_at that is already set.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  __setServiceClientFactory,
  handleTermiiStatus,
} from "./index.ts";

const SECRET = "whsec_2218";

interface Patch {
  table: string;
  patch: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

function makeClient(patches: Patch[]) {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => ({
    update: (patch: Record<string, unknown>) => {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          patches.push({ table, patch, filters: [...filters] });
          return Object.assign(Promise.resolve({ error: null }), chain);
        },
      };
      return chain;
    },
    select: () => {
      const chain = {
        eq: () => chain,
        is: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    },
    insert: () => Promise.resolve({ error: null }),
  });
  return { from };
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callback(
  body: Record<string, unknown>,
): Promise<{ res: Response; patches: Patch[] }> {
  const patches: Patch[] = [];
  const snapWebhook = Deno.env.get("TERMII_WEBHOOK_SECRET");
  Deno.env.set("TERMII_WEBHOOK_SECRET", SECRET);
  __setServiceClientFactory(
    () => makeClient(patches) as unknown as ReturnType<
      typeof import("../_shared/ticketCheckout.ts").serviceClient
    >,
  );
  try {
    const raw = JSON.stringify(body);
    const res = await handleTermiiStatus(
      new Request("https://edge.local/termii-delivery-status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-termii-signature": await sign(SECRET, raw),
        },
        body: raw,
      }),
    );
    return { res, patches };
  } finally {
    __setServiceClientFactory(null);
    if (snapWebhook === undefined) Deno.env.delete("TERMII_WEBHOOK_SECRET");
    else Deno.env.set("TERMII_WEBHOOK_SECRET", snapWebhook);
  }
}

// PostgREST's builder is chainable AND awaitable, so the stub records once per
// `.eq()`. The LAST record for a table therefore carries the COMPLETE filter
// set — which is the one worth asserting on, since a partial predicate is what
// an accidentally-dropped `.eq("channel", "sms")` would look like.
const lastFor = (patches: Patch[], table: string): Patch[] => {
  const all = patches.filter((p) => p.table === table);
  return all.length === 0 ? [] : [all[all.length - 1]];
};
const ticketPatch = (patches: Patch[]) =>
  lastFor(patches, "ticket_order_notifications");
const ledgerPatch = (patches: Patch[]) =>
  lastFor(patches, "notification_deliveries");

Deno.test("#2218 T-6a: a Delivered report reaches BOTH ledgers", async () => {
  const { res, patches } = await callback({
    message_id: "3017858407816658717238173",
    status: "Delivered",
    receiver: "+2348162646567",
  });
  assertEquals(res.status, 200);

  const ledger = ledgerPatch(patches);
  assert(ledger.length > 0, "the shared ledger was already reconciled");
  assertEquals(ledger[0].patch.status, "delivered");
  assert(ledger[0].patch.delivered_at !== null);

  const ticket = ticketPatch(patches);
  assert(
    ticket.length > 0,
    "THE #2218 GAP: the buyer's own row must be reconciled too, exactly as " +
      "twilio-message-status does. Before this, a Nigerian confirmation could " +
      "never leave `sent`.",
  );
  assertEquals(ticket[0].patch.status, "delivered");
  assert(
    typeof ticket[0].patch.delivered_at === "string",
    "delivered_at must be stamped on the row a person actually reads",
  );
  // Keyed by the same pair the shared ledger uses, and provider-blind.
  const cols = ticket[0].filters.map(([c]) => c).sort();
  assertEquals(cols, ["channel", "provider_message_id"]);
  assert(!cols.includes("provider"), "provider-blind, like the Twilio webhook");
});

Deno.test("#2218 T-6b: a terminal failure is terminal on the buyer's row too", async () => {
  const { patches } = await callback({
    message_id: "3017858407816658717238173",
    status: "DND Active on Phone Number",
    receiver: "+2348162646567",
  });
  const ticket = ticketPatch(patches);
  assert(ticket.length > 0);
  assertEquals(
    ticket[0].patch.status,
    "failed_terminal",
    "the vocabulary of THIS table, not the shared ledger's `failed`",
  );
  assertEquals(
    ticket[0].patch.last_error,
    "termii_DND Active on Phone Number",
    "the provider's own words, so the reason is not lost in translation",
  );
});

Deno.test("#2218 T-6c: a non-delivered report never un-delivers a delivered row", async () => {
  // Reports arrive out of order. A late "Message Sent" following a "Delivered"
  // must not wipe the delivered_at off a text the handset already has —
  // exactly the mistake the shared-ledger block's unconditional
  // `delivered_at: delivered ? now : null` would make on this table.
  const { patches } = await callback({
    message_id: "3017858407816658717238173",
    status: "Message Sent",
    receiver: "+2348162646567",
  });
  const ticket = ticketPatch(patches);
  assert(ticket.length > 0);
  assertEquals(ticket[0].patch.status, "delivered");
  assert(
    !Object.hasOwn(ticket[0].patch, "delivered_at") ||
      typeof ticket[0].patch.delivered_at === "string",
    "the patch must never carry an explicit null delivered_at",
  );
});
