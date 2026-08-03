/**
 * #890 — happy-path: the web Sentry shim (`src/diagnostics/sentry.ts`) lazy-loads
 * the REAL @sentry/browser and delegates init/captureException when a DSN is
 * present in a browser context.
 *
 * Environment note: this runs under the repo's DEFAULT node/ts-jest config
 * (mingla-business/jest.config.cjs — `jest-environment-jsdom` is intentionally
 * NOT a dependency, so the package-lock.json change stays limited to the single
 * @sentry/browser promotion, per the #890 build contract). We therefore stub
 * `global.window` so `isBrowser()` is true, instead of using an `@jest-environment
 * jsdom` pragma. The assertions are identical either way.
 *
 * Fails-on-revert: reverting sentry.ts to the no-op stub makes `init` a no-op and
 * `captureException` return "" → the delegation + event-id assertions go RED.
 */
import { init, captureException } from "../sentry";

const mockInit = jest.fn();
const mockCaptureException = jest.fn((): string => "evt_890");
const mockAddBreadcrumb = jest.fn();

jest.mock("@sentry/browser", () => ({
  __esModule: true,
  init: mockInit,
  captureException: mockCaptureException,
  addBreadcrumb: mockAddBreadcrumb,
}));

// Flush the dynamic-import().then() chain (two microtask/macrotask turns).
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const DSN = "https://x@o1.ingest.sentry.io/2";

describe("#890 web Sentry shim (lazy @sentry/browser)", () => {
  const originalWindow = (global as unknown as { window?: unknown }).window;

  beforeAll(() => {
    (global as unknown as { window?: unknown }).window =
      (global as unknown as { window?: unknown }).window ?? {};
  });
  afterAll(() => {
    (global as unknown as { window?: unknown }).window = originalWindow;
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("init() delegates to the real @sentry/browser when a DSN is present", async () => {
    init({ dsn: DSN });
    await flush();
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ dsn: DSN }));
  });

  it("captureException() returns the real SDK event-id string once loaded", async () => {
    init({ dsn: DSN });
    await flush();
    expect(captureException(new Error("boom"))).toBe("evt_890");
  });

  it("init({}) with no DSN never loads the SDK (safe no-op)", async () => {
    init({});
    await flush();
    expect(mockInit).not.toHaveBeenCalled();
  });
});
