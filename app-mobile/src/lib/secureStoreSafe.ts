/**
 * #2306 [secure-store-ota-guard] — the SOLE owner of the `expo-secure-store`
 * import in app-mobile.
 *
 * WHY: expo-secure-store was added AFTER the 1.1.2 native build, so that binary
 * carries no native module for it. A bare static import reaches the native
 * module at eval time and throws, breaking whatever screen pulls the module in
 * — the same shape as the netinfo brick in mingla-business (COMMS-0138).
 *
 * That is what blocks #2107's update gate from being delivered to Consumer 1.1.2
 * by OTA. Consumer 1.1.4 has no such gap and is unaffected either way.
 *
 * CONTRACT:
 * - Native module PRESENT (1.1.4 and later): every call is the real
 *   SecureStore call — zero behaviour change, still encrypted at rest.
 * - Native module ABSENT (1.1.2 binaries): reads resolve to null and writes
 *   are no-ops, i.e. "there is no stored value". It deliberately does NOT fall
 *   back to AsyncStorage: the caller chose secure storage on purpose, and
 *   silently relocating a claim token to unencrypted storage would trade a
 *   contained feature degradation for a security regression.
 * - No other app-mobile file may import this package — enforced by
 *   .github/scripts/strict-grep/issue-2306-lazy-native-imports.mjs.
 */

type SecureStoreModule = {
  setItemAsync: (key: string, value: string) => Promise<void>;
  getItemAsync: (key: string) => Promise<string | null>;
  deleteItemAsync: (key: string) => Promise<void>;
};

let resolved = false;
let store: SecureStoreModule | null = null;

function load(): SecureStoreModule | null {
  if (resolved) return store;
  resolved = true;
  try {
    // Dynamic require so a missing native module throws HERE, inside the
    // catch — never at module eval of whatever screen imported us.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-secure-store") as Partial<SecureStoreModule>;
    if (
      typeof mod.setItemAsync === "function" &&
      typeof mod.getItemAsync === "function" &&
      typeof mod.deleteItemAsync === "function"
    ) {
      store = mod as SecureStoreModule;
      return store;
    }
    console.warn(
      "[secureStoreSafe] expo-secure-store loaded without its expected API — treating secure storage as unavailable.",
    );
    return null;
  } catch (err) {
    // Expected on every binary built before expo-secure-store was added. NOT
    // silent: one warn keeps the degrade diagnosable without crashing eval.
    console.warn(
      "[secureStoreSafe] expo-secure-store native module unavailable — treating secure storage as empty until the next native build ships it.",
      err,
    );
    return null;
  }
}

export const isSecureStoreAvailable = (): boolean => load() !== null;

export async function secureSetItem(key: string, value: string): Promise<void> {
  const mod = load();
  if (mod === null) return;
  await mod.setItemAsync(key, value);
}

export async function secureGetItem(key: string): Promise<string | null> {
  const mod = load();
  if (mod === null) return null;
  return mod.getItemAsync(key);
}

export async function secureDeleteItem(key: string): Promise<void> {
  const mod = load();
  if (mod === null) return;
  await mod.deleteItemAsync(key);
}
