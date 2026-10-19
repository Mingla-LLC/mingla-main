// @ts-nocheck
/**
 * #3978 — every Explorer ticket checkout failed with "Payment could not start
 * safely" because the recovery pointer was written under a SecureStore key
 * containing ":" ("mingla:checkout-recovery:v1"). expo-secure-store rejects any
 * key that does not match /^[\w.-]+$/, persistNativeCheckoutRecovery caught the
 * throw and returned false, and checkout refused to start.
 *
 * Test A runs the REAL secureStoreSafe wrapper against an expo-secure-store mock
 * that applies the library's own key validation.
 * Test B scans every non-test app-mobile source file that imports
 * secureStoreSafe and asserts every key literal is a valid SecureStore key.
 */
import * as fs from "fs";
import * as path from "path";

const VALID_SECURE_STORE_KEY = /^[\w.-]+$/;

const mockSetItemAsync = jest.fn();
const mockGetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();

const assertValidKey = (key: unknown): void => {
  // Mirrors expo-secure-store 15.x build/SecureStore.js isValidKey.
  if (typeof key !== "string" || !VALID_SECURE_STORE_KEY.test(key)) {
    throw new Error(
      'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
    );
  }
};

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock(
  "expo-secure-store",
  () => ({
    setItemAsync: async (key: unknown, value: unknown) => {
      assertValidKey(key);
      return mockSetItemAsync(key, value);
    },
    getItemAsync: async (key: unknown) => {
      assertValidKey(key);
      return mockGetItemAsync(key);
    },
    deleteItemAsync: async (key: unknown) => {
      assertValidKey(key);
      return mockDeleteItemAsync(key);
    },
  }),
  { virtual: true },
);
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import {
  createNativeCheckoutRecoveryPointer,
  persistNativeCheckoutRecovery,
  readNativeCheckoutRecovery,
} from "../nativeCheckoutRecovery";

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItemAsync.mockResolvedValue(undefined);
  mockGetItemAsync.mockResolvedValue(null);
  mockDeleteItemAsync.mockResolvedValue(undefined);
});

test("#3978 recovery pointer persists through SecureStore's real key validation", async () => {
  const pointer = createNativeCheckoutRecoveryPointer({
    checkoutSessionId: "session-3978",
    buyerStatusToken: "buyer-token-3978",
    accountId: "account-3978",
    eventId: "event-3978",
    now: Date.now(),
  });

  await expect(persistNativeCheckoutRecovery(pointer)).resolves.toBe(true);

  expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
  const [key, value] = mockSetItemAsync.mock.calls[0];
  expect(key).toMatch(VALID_SECURE_STORE_KEY);
  expect(JSON.parse(value).checkoutSessionId).toBe("session-3978");

  // The read path uses the same key and must round-trip.
  mockGetItemAsync.mockResolvedValueOnce(value);
  const read = await readNativeCheckoutRecovery();
  expect(read?.checkoutSessionId).toBe("session-3978");
  expect(mockGetItemAsync).toHaveBeenCalledWith(key);
});

const APP_MOBILE_ROOT = path.resolve(__dirname, "../../..");

const listSourceFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(child));
    else if (
      /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) &&
      !/\.test\.|\.spec\./.test(entry.name)
    ) {
      out.push(child);
    }
  }
  return out;
};

test("#3978 every SecureStore key literal in app-mobile source is a valid key", () => {
  const users = [
    ...listSourceFiles(path.join(APP_MOBILE_ROOT, "src")),
    ...listSourceFiles(path.join(APP_MOBILE_ROOT, "app")),
  ].filter((file) =>
    /from\s+["'][^"']*secureStoreSafe["']/.test(fs.readFileSync(file, "utf8")),
  );

  // Guard against the scan silently finding nothing.
  expect(
    users.map((f) => path.relative(APP_MOBILE_ROOT, f).split(path.sep).join("/")),
  ).toEqual(expect.arrayContaining(["src/payments/nativeCheckoutRecovery.ts"]));

  const found: Array<{ file: string; key: string }> = [];
  for (const file of users) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(APP_MOBILE_ROOT, file);
    for (const m of source.matchAll(
      /const\s+(?:[A-Z0-9_]*_)?KEY\s*(?::\s*string\s*)?=\s*["'`]([^"'`]*)["'`]/g,
    )) {
      found.push({ file: rel, key: m[1] });
    }
    for (const m of source.matchAll(
      /secure(?:Set|Get|Delete)Item\(\s*["'`]([^"'`]*)["'`]/g,
    )) {
      found.push({ file: rel, key: m[1] });
    }
  }

  expect(found.length).toBeGreaterThan(0);
  const invalid = found.filter(({ key }) => !VALID_SECURE_STORE_KEY.test(key));
  expect(invalid).toEqual([]);
});
