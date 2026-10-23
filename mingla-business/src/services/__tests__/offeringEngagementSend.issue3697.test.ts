import { afterEach, expect, jest, test } from "@jest/globals";
import { sendOfferingEngagement } from "../offeringEngagementSend";

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<{ error: null }>>();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

const scope = {
  brandId: "22222222-2222-4222-8222-222222222222",
  entityType: "event" as const,
  entityId: "11111111-1111-4111-8111-111111111111",
};

function installBrowser(completed: boolean): Record<string, unknown> {
  const win: Record<string, unknown> = {
    location: { href: "https://business.usemingla.com/e/acme/signal-night" },
    __minglaEarlyEngagementCapture: {
      scope,
      eventId: "33333333-3333-4333-8333-333333333333",
      completed: Promise.resolve(completed),
    },
  };
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { document: unknown }).document = { referrer: "" };
  return win;
}

afterEach(() => {
  mockInvoke.mockReset();
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: unknown }).document;
});

test("#3697 a successful early keepalive owns the page view", async () => {
  const win = installBrowser(true);
  await sendOfferingEngagement(scope, "page_view", null, null);
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(win.__minglaEarlyEngagementCapture).toBeUndefined();
});

test("#3697 a failed early keepalive retries with the same event id", async () => {
  const win = installBrowser(false);
  mockInvoke.mockResolvedValue({ error: null });
  await sendOfferingEngagement(scope, "page_view", null, null);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith("offering-engagement-capture", {
    body: expect.objectContaining({
      eventId: "33333333-3333-4333-8333-333333333333",
      eventType: "page_view",
      brandId: scope.brandId,
      entityId: scope.entityId,
    }),
  });
  expect(win.__minglaEarlyEngagementCapture).toBeUndefined();
});
