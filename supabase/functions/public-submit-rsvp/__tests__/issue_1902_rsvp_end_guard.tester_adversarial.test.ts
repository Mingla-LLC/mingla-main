import { assert, assertEquals } from "jsr:@std/assert@1";

const handlerUrl = new URL("../index.ts", import.meta.url);

async function waitForHandler(url: string, child: Deno.ChildProcess) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "OPTIONS" });
      if (response.status === 200) return;
    } catch {
      // The real handler is still importing or binding its disposable port.
    }
    const status = await Promise.race([
      child.status,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    if (status !== null) {
      throw new Error(`real handler exited before readiness: ${status.code}`);
    }
  }
  throw new Error("real handler did not become ready within 45 seconds");
}

Deno.test({
  name:
    "actual public-submit-rsvp HTTP handler maps both SQLSTATEs for anon and authenticated callers",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const upstreamCalls: Array<Record<string, unknown>> = [];
    const upstream = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/auth/v1/user") {
          return Response.json({
            id: "19020000-0000-4000-8000-000000000001",
            email: "signed-in@example.test",
          });
        }
        if (url.pathname === "/rest/v1/profiles") {
          return Response.json({
            display_name: "Signed In Tester",
            email: "signed-in@example.test",
            phone: "+15551902002",
          });
        }
        if (
          url.pathname ===
            "/rest/v1/rpc/submit_event_rsvp_with_delivery"
        ) {
          const body = await request.json() as Record<string, unknown>;
          upstreamCalls.push({
            authorization: request.headers.get("authorization"),
            body,
          });
          const unavailable = body.p_event_id ===
            "19020000-0000-4000-8000-000000000409";
          return Response.json(
            unavailable
              ? {
                code: "P1902",
                message: "rsvp_date_unavailable",
                details: null,
                hint: null,
              }
              : {
                code: "P1901",
                message: "rsvp_event_ended",
                details: null,
                hint: null,
              },
            { status: 400 },
          );
        }
        return Response.json(
          { message: `unexpected upstream ${url.pathname}` },
          {
            status: 404,
          },
        );
      },
    );

    const upstreamPort = (upstream.addr as Deno.NetAddr).port;
    // std/http@0.190.0 `serve(handler)` binds 8000 when the production source
    // supplies no options. The dedicated CI job runs this file alone, and this
    // preflight prevents a stray local process from being mistaken for it.
    try {
      const occupied = Deno.listen({ hostname: "127.0.0.1", port: 8000 });
      occupied.close();
    } catch {
      throw new Error(
        "port 8000 is occupied; refusing to test the wrong handler",
      );
    }
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        handlerUrl.pathname,
      ],
      env: {
        SUPABASE_URL: `http://127.0.0.1:${upstreamPort}`,
        SUPABASE_SERVICE_ROLE_KEY: "issue-1902-disposable-service-key",
        "app.qr_token_pepper": "issue-1902-disposable-pepper-000000000000",
      },
      stdout: "null",
      stderr: "inherit",
    }).spawn();

    const endpoint = "http://127.0.0.1:8000";
    try {
      await waitForHandler(endpoint, child);
      const anon = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.190",
        },
        body: JSON.stringify({
          eventId: "19020000-0000-4000-8000-000000000410",
          guestName: "Anonymous Tester",
          guestEmail: "anon@example.test",
          guestPhone: "+15551902001",
          rsvpStatus: "going",
          plusCount: 0,
          guests: [],
        }),
      });
      assertEquals(anon.status, 410);
      const anonText = await anon.text();
      assertEquals(anonText, '{"error":"rsvp_event_ended"}');
      assert(!anonText.includes("Anonymous Tester"));
      assert(!anonText.includes("P1901"));

      const authenticated = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer issue-1902-auth-token",
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.191",
        },
        body: JSON.stringify({
          eventId: "19020000-0000-4000-8000-000000000409",
          rsvpStatus: "going",
          plusCount: 0,
          guests: [],
        }),
      });
      assertEquals(authenticated.status, 409);
      const authenticatedText = await authenticated.text();
      assertEquals(authenticatedText, '{"error":"rsvp_date_unavailable"}');
      assert(!authenticatedText.includes("signed-in@example.test"));
      assert(!authenticatedText.includes("P1902"));

      assertEquals(upstreamCalls.length, 2);
      assertEquals(
        (upstreamCalls[0].body as Record<string, unknown>).p_user_id,
        null,
      );
      assertEquals(
        (upstreamCalls[1].body as Record<string, unknown>).p_user_id,
        "19020000-0000-4000-8000-000000000001",
      );
      for (const call of upstreamCalls) {
        assertEquals(
          call.authorization,
          "Bearer issue-1902-disposable-service-key",
          "the real handler must call the service-only wrapper",
        );
      }
    } finally {
      child.kill("SIGTERM");
      await child.status;
      await upstream.shutdown();
    }
  },
});
