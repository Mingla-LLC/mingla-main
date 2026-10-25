import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { checkVerification, startVerification } from "../twilioVerify.ts";

const ENV = {
  TWILIO_ACCOUNT_SID: "AC_test",
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_VERIFY_SERVICE_SID: "VA_test",
} as const;

function withTwilioEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(ENV).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(ENV)) Deno.env.set(key, value);
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

Deno.test("#4063 Twilio start is SMS-only and calls the Verify endpoint", async () => {
  await withTwilioEnv(async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await startVerification("+12015550199", {
      fetchImpl: (input, init) => {
        requests.push({ url: String(input), init });
        return Promise.resolve(Response.json({ status: "pending" }));
      },
    });

    assertEquals(result, { ok: true, status: "pending" });
    assertEquals(requests.length, 1);
    const request = requests[0];
    assert(request);
    assertEquals(
      request.url,
      "https://verify.twilio.com/v2/Services/VA_test/Verifications",
    );
    assertEquals(request.init?.method, "POST");
    assertEquals(
      new Headers(request.init?.headers).get("Authorization"),
      `Basic ${btoa("AC_test:test-token")}`,
    );
    const body = request.init?.body as URLSearchParams;
    assertEquals(body.get("To"), "+12015550199");
    assertEquals(body.get("Channel"), "sms");
  });
});

Deno.test("#4063 Twilio check returns approval without writing identity", async () => {
  await withTwilioEnv(async () => {
    const bodies: URLSearchParams[] = [];
    const result = await checkVerification("+447700900123", "123456", {
      fetchImpl: (_input, init) => {
        bodies.push(init?.body as URLSearchParams);
        return Promise.resolve(Response.json({ status: "approved" }));
      },
    });

    assertEquals(result, { ok: true, approved: true, status: "approved" });
    assertEquals(bodies[0]?.get("To"), "+447700900123");
    assertEquals(bodies[0]?.get("Code"), "123456");
  });
});

Deno.test("#4063 Twilio errors map to stable claim-flow outcomes", async () => {
  await withTwilioEnv(async () => {
    const rateLimited = await startVerification("+12025550123", {
      fetchImpl: () =>
        Promise.resolve(Response.json({ code: 60203 }, { status: 400 })),
    });
    const expired = await checkVerification("+12025550123", "654321", {
      fetchImpl: () =>
        Promise.resolve(Response.json({ code: 60200 }, { status: 400 })),
    });
    const unavailable = await checkVerification("+12025550123", "654321", {
      fetchImpl: () => Promise.reject(new Error("network unavailable")),
    });

    assertEquals(rateLimited, { ok: false, error: "rate_limited" });
    assertEquals(expired, { ok: false, error: "expired" });
    assertEquals(unavailable, { ok: false, error: "unavailable" });
  });
});

Deno.test("#4063 Twilio helper fails closed before an invalid request", async () => {
  await withTwilioEnv(async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls += 1;
      return Promise.resolve(Response.json({ status: "approved" }));
    };

    assertEquals(
      await startVerification("12025550123", { fetchImpl }),
      { ok: false, error: "invalid" },
    );
    assertEquals(
      await checkVerification("+12025550123", "12345", { fetchImpl }),
      { ok: false, error: "invalid" },
    );
    assertEquals(calls, 0);
  });
});

Deno.test("#4063 Twilio helper refuses to call without configured credentials", async () => {
  const previous = Object.fromEntries(
    Object.keys(ENV).map((key) => [key, Deno.env.get(key)]),
  );
  for (const key of Object.keys(ENV)) Deno.env.delete(key);
  try {
    let calls = 0;
    const result = await startVerification("+12025550123", {
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(Response.json({ status: "pending" }));
      },
    });
    assertEquals(result, { ok: false, error: "unavailable" });
    assertEquals(calls, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
