// issue #3281 — extracting scan-ticket's handler for tests must not change any
// answer it gave before: CORS, method, auth, payload, pepper and RPC errors.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHandler, type ScanTicketClient } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";

function handlerWith(opts: {
  user?: { id: string } | null;
  userError?: unknown;
  pepperThrows?: boolean;
  rpc?: () => { data: unknown; error: unknown };
}) {
  const calls: Record<string, unknown>[] = [];
  const client: ScanTicketClient = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: opts.user === undefined ? { id: "actor" } : opts.user },
          error: opts.userError ?? null,
        }),
    },
    rpc: (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return Promise.resolve(opts.rpc ? opts.rpc() : { data: null, error: null });
    },
    from: () => {
      throw new Error("no order read expected");
    },
  };
  const handler = createHandler({
    client: () => client,
    pepper: () => {
      if (opts.pepperThrows) throw new Error("missing");
      return "pepper";
    },
  });
  return { handler, calls };
}

const req = (init: { method?: string; auth?: boolean; body?: unknown } = {}) =>
  new Request("https://x/scan-ticket", {
    method: init.method ?? "POST",
    headers: {
      ...(init.auth === false ? {} : { authorization: "Bearer jwt" }),
      "content-type": "application/json",
    },
    body: init.method === "GET" || init.method === "OPTIONS"
      ? undefined
      : JSON.stringify(init.body ?? { eventId: EVENT, qrPayload: "mingla:v1:ticket:x" }),
  });

const read = async (res: Response) => ({ status: res.status, body: await res.text() });

Deno.test("#3281 scan-ticket contract: OPTIONS answers ok with CORS", async () => {
  const res = await handlerWith({}).handler(req({ method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
  assertEquals(res.headers.get("access-control-allow-origin") !== null, true);
});

Deno.test("#3281 scan-ticket contract: GET is 405", async () => {
  assertEquals(await read(await handlerWith({}).handler(req({ method: "GET" }))), {
    status: 405,
    body: JSON.stringify({ error: "method_not_allowed" }),
  });
});

Deno.test("#3281 scan-ticket contract: no header, a failed lookup or no user is 401", async () => {
  const want = { status: 401, body: JSON.stringify({ error: "auth_required" }) };
  assertEquals(await read(await handlerWith({}).handler(req({ auth: false }))), want);
  assertEquals(await read(await handlerWith({ userError: { message: "x" } }).handler(req())), want);
  assertEquals(await read(await handlerWith({ user: null }).handler(req())), want);
});

Deno.test("#3281 scan-ticket contract: a missing event or payload is 400", async () => {
  for (const body of [{}, { eventId: EVENT }, { qrPayload: "x" }, { eventId: 1, qrPayload: 2 }]) {
    assertEquals(await read(await handlerWith({}).handler(req({ body }))), {
      status: 400,
      body: JSON.stringify({ error: "scan_payload_required" }),
    });
  }
});

Deno.test("#3281 scan-ticket contract: a missing pepper is 500 and never calls the RPC", async () => {
  const h = handlerWith({ pepperThrows: true });
  assertEquals(await read(await h.handler(req())), {
    status: 500,
    body: JSON.stringify({ error: "qr_token_pepper_missing" }),
  });
  assertEquals(h.calls.length, 0);
});

Deno.test("#3281 scan-ticket contract: RPC errors are 403 for an unauthorized scanner, else 400, with detail", async () => {
  assertEquals(
    await read(await handlerWith({ rpc: () => ({ data: null, error: { message: "P0001: scanner_not_authorized" } }) }).handler(req())),
    { status: 403, body: JSON.stringify({ error: "scan_failed", detail: "P0001: scanner_not_authorized" }) },
  );
  assertEquals(
    await read(await handlerWith({ rpc: () => ({ data: null, error: { message: "boom" } }) }).handler(req())),
    { status: 400, body: JSON.stringify({ error: "scan_failed", detail: "boom" }) },
  );
});

Deno.test("#3281 scan-ticket contract: the RPC gets the verified scanner and the pepper; a result without an order passes through", async () => {
  const notFound = { result: "not_found", scanId: null, ticketId: null, orderId: null };
  const h = handlerWith({ rpc: () => ({ data: notFound, error: null }) });
  assertEquals(await read(await h.handler(req())), { status: 200, body: JSON.stringify(notFound) });
  assertEquals(h.calls[0], {
    p_event_id: EVENT,
    p_qr_payload: "mingla:v1:ticket:x",
    p_scanner_user_id: "actor",
    p_qr_token_pepper: "pepper",
  });
  const nullData = handlerWith({ rpc: () => ({ data: null, error: null }) });
  assertEquals(await read(await nullData.handler(req())), { status: 200, body: "null" });
});
