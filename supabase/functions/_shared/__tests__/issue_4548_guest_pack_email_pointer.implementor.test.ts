// Issue #4548 — guest pack emails carry a pointer line only, never the pack.
//
// Second enforcer of I-4548-GUEST-PACK-APP-ONLY (the first is the adversarial
// pg17 suite): no file under supabase/functions names the pack table, the
// email check is a yes/no RPC, and the ticket, experience and RSVP-going
// emails render the fixed pointer line above their button only when a pack
// exists, with no note, label or link from the pack in any email or text.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderTransactionalEmail } from "../email/index.ts";
import {
  GUEST_PACK_POINTER_LINE,
  guestPackExists,
  type GuestPackRpcClient,
} from "../guestPackPointer.ts";
import {
  buildOrderConfirmationMessage,
  type OrderConfirmationKind,
} from "../orderConfirmationMessage.ts";
import { buildRsvpPassMessage } from "../rsvpPassMessage.ts";

Deno.env.set("DENO_TESTING", "1");

const MARKER = "QX4548MARKER";
// The table name, assembled so this file never matches its own scan.
const PACK_TABLE = ["event", "guest", "packs"].join("_");

const EVENT_ID = "45480000-0000-4000-8000-0000000000e1";

// A stand-in database holding a pack full of marker text. Only the yes/no RPC
// is answerable; any attempt to read rows records itself and returns the pack.
function fakeDatabase() {
  const calls: Array<{ kind: string; name: string; args?: unknown }> = [];
  const pack = {
    note: `Door code ${MARKER}`,
    items: [{
      label: `Access ${MARKER}`,
      url: `https://example.test/${MARKER}.pdf`,
    }],
  };
  const client = {
    rpc(fn: string, args: { p_event_id: string }) {
      calls.push({ kind: "rpc", name: fn, args });
      if (fn === "event_guest_pack_exists") {
        return Promise.resolve({
          data: args.p_event_id === EVENT_ID,
          error: null,
        });
      }
      return Promise.resolve({ data: pack, error: null });
    },
    from(table: string) {
      calls.push({ kind: "from", name: table });
      return { select: () => Promise.resolve({ data: [pack], error: null }) };
    },
  };
  return { client, calls };
}

function orderMessage(kind: OrderConfirmationKind, guestPack: boolean) {
  return buildOrderConfirmationMessage({
    kind,
    title: "Bachata Takeover",
    brandName: "Bachata Lagos",
    buyerName: "Amara Okafor",
    buyerEmail: "amara@example.test",
    buyerPhoneLast4: "0123",
    claimed: false,
    quantity: 2,
    buttonUrl: "https://usemingla.com/c/AB12CD34EF",
    date: "Sat 25 Oct",
    time: "7:30 PM",
    when: "Sat 25 Oct, 7:30 PM",
    place: "The Waterside",
    guestPack,
    receipt: {
      currency: "USD",
      items: [{ label: "General", quantity: 2, amountCents: 5000 }],
      discountRows: [],
      feesAndTaxCents: 0,
      paidCents: 5000,
      orderId: "45480000-0000-4000-8000-0000000000f1",
    },
  });
}

function rsvpMessage(guestPack: boolean, guest = false) {
  return buildRsvpPassMessage({
    reason: "going",
    guest,
    title: "Bachata Takeover",
    brandName: "Bachata Lagos",
    recipientName: "Amara Okafor",
    recipientEmail: "amara@example.test",
    recipientPhoneLast4: "0123",
    leadName: guest ? "Tobi" : null,
    claimed: false,
    buttonUrl: "https://usemingla.com/c/AB12CD34EF",
    smsLink: "usemingla.com/c/AB12CD34EF",
    date: "Sat 25 Oct",
    time: "7:30 PM",
    when: "Sat 25 Oct, 7:30 PM",
    place: "The Waterside",
    guestPack,
  });
}

function render(body: ReturnType<typeof rsvpMessage>["body"]) {
  return renderTransactionalEmail({
    variant: "purchase_message",
    recipient: { name: "Amara Okafor", email: "amara@example.test" },
    body,
  });
}

Deno.test("#4548 the email check is one yes/no RPC and never reads the pack", async () => {
  const { client, calls } = fakeDatabase();
  assertEquals(
    await guestPackExists(client as GuestPackRpcClient, EVENT_ID, "[t]"),
    true,
  );
  assertEquals(
    await guestPackExists(
      client as GuestPackRpcClient,
      "45480000-0000-4000-8000-0000000000e2",
      "[t]",
    ),
    false,
  );
  assertEquals(
    await guestPackExists(client as GuestPackRpcClient, null, "[t]"),
    false,
  );
  assertEquals(calls, [
    {
      kind: "rpc",
      name: "event_guest_pack_exists",
      args: { p_event_id: EVENT_ID },
    },
    {
      kind: "rpc",
      name: "event_guest_pack_exists",
      args: { p_event_id: "45480000-0000-4000-8000-0000000000e2" },
    },
  ]);
});

Deno.test("#4548 a failed check means no pointer line, never a failed email", async () => {
  const failing: GuestPackRpcClient = {
    rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
  };
  const throwing: GuestPackRpcClient = {
    rpc: () => Promise.reject(new Error("network")),
  };
  assertEquals(await guestPackExists(failing, EVENT_ID, "[t]"), false);
  assertEquals(await guestPackExists(throwing, EVENT_ID, "[t]"), false);
  // A truthy non-boolean answer is not a yes.
  const odd: GuestPackRpcClient = {
    rpc: () => Promise.resolve({ data: "true", error: null }),
  };
  assertEquals(await guestPackExists(odd, EVENT_ID, "[t]"), false);
});

Deno.test("#4548 ticket, experience and RSVP-going emails show the pointer above the button only with a pack", async () => {
  const { client } = fakeDatabase();
  const hasPack = await guestPackExists(
    client as GuestPackRpcClient,
    EVENT_ID,
    "[t]",
  );
  const cases = [
    {
      name: "ticket",
      button: "Get my tickets",
      make: (p: boolean) => orderMessage("ticket", p),
    },
    {
      name: "experience",
      button: "Get my booking",
      make: (p: boolean) => orderMessage("experience", p),
    },
    {
      name: "rsvp going",
      button: "Get my pass",
      make: (p: boolean) => rsvpMessage(p),
    },
    {
      name: "rsvp plus-one",
      button: "Get my pass",
      make: (p: boolean) => rsvpMessage(p, true),
    },
  ];
  for (const c of cases) {
    const withPack = c.make(hasPack);
    const email = render(withPack.body);
    assertStringIncludes(
      email.html,
      GUEST_PACK_POINTER_LINE,
      `${c.name} html has the pointer`,
    );
    assertStringIncludes(
      email.text,
      GUEST_PACK_POINTER_LINE,
      `${c.name} text has the pointer`,
    );
    assert(
      email.html.indexOf(GUEST_PACK_POINTER_LINE) <
        email.html.indexOf(c.button),
      `${c.name} pointer sits above the button`,
    );
    assert(
      email.text.indexOf(GUEST_PACK_POINTER_LINE) <
        email.text.indexOf(`${c.button}:`),
      `${c.name} text pointer sits above the button line`,
    );
    assertEquals(
      email.html.split(GUEST_PACK_POINTER_LINE).length - 1,
      1,
      `${c.name} pointer appears once`,
    );
    for (
      const out of [
        email.html,
        email.text,
        email.subject,
        email.preheader ?? "",
        withPack.sms,
      ]
    ) {
      assert(!out.includes(MARKER), `${c.name} carries no pack content`);
    }
    assert(
      !withPack.sms.includes(GUEST_PACK_POINTER_LINE),
      `${c.name} text message has no pointer`,
    );
    assert(
      !withPack.sms.toLowerCase().includes("guest pack"),
      `${c.name} SMS never mentions the pack`,
    );

    const without = c.make(false);
    const plain = render(without.body);
    assert(
      !plain.html.includes(GUEST_PACK_POINTER_LINE),
      `${c.name} html has no pointer without a pack`,
    );
    assert(
      !plain.text.includes(GUEST_PACK_POINTER_LINE),
      `${c.name} text has no pointer without a pack`,
    );
    assert(
      !("guestPack" in without.body),
      `${c.name} body is unchanged without a pack`,
    );
  }
});

Deno.test("#4548 a trip confirmation never gets the pointer (trips have no pack)", () => {
  const trip = render(orderMessage("trip", false).body);
  assert(!trip.html.includes(GUEST_PACK_POINTER_LINE));
});

async function* walk(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) yield* walk(child);
    else if (entry.isFile) yield child;
  }
}

Deno.test("#4548 I-4548-GUEST-PACK-APP-ONLY: no edge function names the pack table", async () => {
  const root = new URL("../../", import.meta.url); // supabase/functions/
  const offenders: string[] = [];
  let scanned = 0;
  for await (const file of walk(root)) {
    if (!/\.(ts|tsx|js|mjs|json|sql)$/.test(file.pathname)) continue;
    scanned++;
    const text = await Deno.readTextFile(file);
    if (text.includes(PACK_TABLE)) offenders.push(file.pathname);
  }
  assert(
    scanned > 500,
    `the scan covered the functions tree (${scanned} files)`,
  );
  assertEquals(
    offenders,
    [],
    "no file under supabase/functions names the pack table",
  );
});

Deno.test("#4548 both dispatchers ask the yes/no check and pass only a boolean", async () => {
  const ticket = await Deno.readTextFile(
    new URL("../../ticket-confirmation-dispatch/index.ts", import.meta.url),
  );
  const rsvp = await Deno.readTextFile(
    new URL("../../rsvp-notify/index.ts", import.meta.url),
  );
  assertStringIncludes(ticket, "await guestPackExists(");
  assertStringIncludes(ticket, "        guestPack,\n");
  assertStringIncludes(
    rsvp,
    'await guestPackExists(admin, eventId, "[rsvp-notify]")',
  );
  assertStringIncludes(rsvp, "      guestPack,\n");
  assertStringIncludes(rsvp, 'claim.channel === "email" &&');
});
