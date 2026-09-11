import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// #3214 — the first-party relay for the public-page boot outcome. The browser
// side (consent-gated sendBeacon) is pinned in
// server/__tests__/publicSearchBootHandoff.issue3214.implementor.test.ts.

type Handler = (req: unknown, res: unknown) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const relay = require("../public-boot-outcome") as Handler & {
  createPublicBootOutcomeHandler: (send: unknown) => Handler;
  EVENT_NAME: string;
};

const harness = () => {
  const result = { statusCode: 0, headers: {} as Record<string, string>, ended: false };
  const response = {
    get statusCode() { return result.statusCode; },
    set statusCode(value: number) { result.statusCode = value; },
    setHeader(key: string, value: string) { result.headers[key.toLowerCase()] = String(value); },
    end() { result.ended = true; },
  };
  return { response, result };
};

const beacon = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  outcome: "failure",
  reason: "chunk_load_error",
  elapsed_ms: 1840,
  path: "/b/lanternroom",
  load_id: "mtx4u0fdosel0kboebk",
  ...overrides,
});

const post = (body: unknown, origin = "https://host.usemingla.com") => ({
  method: "POST",
  headers: { origin },
  body,
});

const ORIGINAL_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
beforeEach(() => { process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_issue3214"; });
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  else process.env.EXPO_PUBLIC_POSTHOG_KEY = ORIGINAL_KEY;
});

describe("#3214 public boot outcome relay", () => {
  it("forwards a consented beacon (text/plain string body) to PostHog as an anonymous event", async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const { response, result } = harness();
    await relay.createPublicBootOutcomeHandler(send)(post(beacon()), response);

    expect(result.statusCode).toBe(204);
    expect(result.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, { method: string; body: string; redirect: string }];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({
      api_key: "phc_issue3214",
      event: "public_page_boot_outcome",
      properties: {
        distinct_id: "public-boot:mtx4u0fdosel0kboebk",
        $process_person_profile: false,
        outcome: "failure",
        reason: "chunk_load_error",
        elapsed_ms: 1840,
        page_type: "brand",
        path: "/b/lanternroom",
      },
    });
  });

  it.each([
    ["/b/lanternroom", "brand"],
    ["/b/lanternroom/v/main-room", "venue"],
    ["/e/lanternroom/summer-night", "event"],
    ["/t/lanternroom/coast-run", "trip"],
    ["/exp/lanternroom/pasta-class", "experience"],
  ])("classifies %s as a %s page", async (path, pageType) => {
    const send = jest.fn(async () => ({ ok: true }));
    const { response, result } = harness();
    await relay.createPublicBootOutcomeHandler(send)(post({ ...JSON.parse(beacon({ path })) }), response);
    expect(result.statusCode).toBe(204);
    const [, init] = send.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).properties.page_type).toBe(pageType);
  });

  it.each([
    ["success", "mounted"],
    ["success", "late_mount"],
    ["failure", "mount_timeout"],
    ["failure", "app_unmounted"],
    ["failure", "bootstrap_network"],
  ])("accepts %s:%s", async (outcome, reason) => {
    const send = jest.fn(async () => ({ ok: true }));
    const { response, result } = harness();
    await relay.createPublicBootOutcomeHandler(send)(post(beacon({ outcome, reason })), response);
    expect(result.statusCode).toBe(204);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a reason from the other outcome", beacon({ outcome: "success", reason: "chunk_load_error" })],
    ["an unknown reason", beacon({ reason: "anything" })],
    ["an extra key", beacon({ email: "person@example.com" })],
    ["a non-public path", beacon({ path: "/checkout/abc" })],
    ["a path with a query", beacon({ path: "/b/lanternroom?x=1" })],
    ["a negative duration", beacon({ elapsed_ms: -1 })],
    ["a fractional duration", beacon({ elapsed_ms: 1.5 })],
    ["a malformed load id", beacon({ load_id: "NOT-OK" })],
    ["an oversized body", beacon({ path: `/b/${"a".repeat(2000)}` })],
    ["malformed JSON", "{"],
  ])("rejects %s with 400 and forwards nothing", async (_case, body) => {
    const send = jest.fn(async () => ({ ok: true }));
    const { response, result } = harness();
    await relay.createPublicBootOutcomeHandler(send)(post(body), response);
    expect(result.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 404 to other origins and 405 to other methods", async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const handler = relay.createPublicBootOutcomeHandler(send);
    const foreign = harness();
    await handler(post(beacon(), "https://evil.example"), foreign.response);
    expect(foreign.result.statusCode).toBe(404);
    const get = harness();
    await handler({ method: "GET", headers: { origin: "https://host.usemingla.com" } }, get.response);
    expect(get.result.statusCode).toBe(405);
    expect(get.result.headers.allow).toBe("POST");
    expect(send).not.toHaveBeenCalled();
  });

  it("reads an unparsed stream body", async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const { response, result } = harness();
    const req = Object.assign((async function* () { yield Buffer.from(beacon({ outcome: "success", reason: "mounted" })); })(), {
      method: "POST",
      headers: { origin: "https://host.usemingla.com" },
    });
    await relay.createPublicBootOutcomeHandler(send)(req, response);
    expect(result.statusCode).toBe(204);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("still answers 204, visibly logged, when the key is missing or PostHog is down", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
      const send = jest.fn(async () => ({ ok: true }));
      const missing = harness();
      await relay.createPublicBootOutcomeHandler(send)(post(beacon()), missing.response);
      expect(missing.result.statusCode).toBe(204);
      expect(send).not.toHaveBeenCalled();

      process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_issue3214";
      const down = harness();
      await relay.createPublicBootOutcomeHandler(jest.fn(async () => { throw new Error("posthog down"); }))(post(beacon()), down.response);
      expect(down.result.statusCode).toBe(204);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
