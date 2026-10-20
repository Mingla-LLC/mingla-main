// #2107 (U1) — this app's wiring for the pure launch guard (updateLaunchGuard.ts).
//
// Byte-identical in app-mobile and mingla-business (parity-gated by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs).
//
// RULES THIS FILE HOLDS:
// - Static imports are sibling pure modules only. expo-updates (through
//   otaUpdateRuntime), expo-file-system and the restart path are required
//   LAZILY, inside the function that needs them, and every one of them is
//   wrapped so a failure only switches the guard off. Booting does one small
//   native read: the guard consumes the in-app reload marker at install, so a
//   marker can never outlive the launch it describes.
// - In __DEV__ nothing is installed, so development keeps React Native's red
//   box exactly as before.
// - It never raises or changes an error. The global handler wrapper only
//   reports a non-fatal error and then passes every error, fatal or not, to the
//   handler it replaced, unchanged: a module-load throw is still fatal and
//   expo-updates still rolls it back natively.

import {
  UpdateLaunchGuard,
  parseUpdateLaunchRecord,
  serializeUpdateLaunchRecord,
  withInAppReloadMarked,
  type UpdateLaunchFacts,
  type UpdateLaunchStore,
} from "./updateLaunchGuard";
import { reportUpdateGateEvent, resetUpdateGateTelemetryForTests } from "./updateGateTelemetry";

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};
type FileLike = {
  exists: boolean;
  textSync: () => string;
  write: (content: string) => void;
};
type FileSystemLike = {
  File: new (...parts: unknown[]) => FileLike;
  Paths: { document: unknown };
};

export const UPDATE_LAUNCH_STORE_FILE = "mingla-update-launch-guard.json";

export type UpdateLaunchRuntimeEnvironment = {
  isDev: boolean;
  errorUtils: ErrorUtilsLike | null;
  store: UpdateLaunchStore;
  readFacts: () => UpdateLaunchFacts | null;
  now: () => number;
};

function storeFile(): FileLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require("expo-file-system") as FileSystemLike;
  return new File(Paths.document, UPDATE_LAUNCH_STORE_FILE);
}

/** Synchronous on purpose: the record must be on disk before a fatal error. */
const fileStore: UpdateLaunchStore = {
  read: () => {
    const file = storeFile();
    return file.exists ? file.textSync() : null;
  },
  write: (value) => storeFile().write(value),
};

function readFactsFromUpdatesRuntime(): UpdateLaunchFacts | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readUpdateLaunchFacts } = require("./otaUpdateRuntime") as {
    readUpdateLaunchFacts: () => UpdateLaunchFacts;
  };
  return readUpdateLaunchFacts();
}

function defaultEnvironment(): UpdateLaunchRuntimeEnvironment {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  return {
    isDev: typeof __DEV__ !== "undefined" && __DEV__,
    errorUtils: errorUtils ?? null,
    store: fileStore,
    readFacts: readFactsFromUpdatesRuntime,
    now: () => Date.now(),
  };
}

let guard: UpdateLaunchGuard | null = null;
let installed = false;
let activeStore: UpdateLaunchStore = fileStore;
let windowTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Installs the guard once per JS runtime. Never throws: if anything is missing,
 * the app starts exactly as it did without it.
 */
export function installUpdateLaunchGuard(
  environment: UpdateLaunchRuntimeEnvironment = defaultEnvironment(),
): void {
  if (installed) return;
  installed = true;
  try {
    if (environment.isDev) return;
    const errorUtils = environment.errorUtils;
    const original = errorUtils?.getGlobalHandler() ?? null;
    if (errorUtils === null || typeof original !== "function") return;
    activeStore = environment.store;
    const created = new UpdateLaunchGuard({
      now: environment.now,
      readFacts: environment.readFacts,
      store: environment.store,
      report: (event, properties) =>
        reportUpdateGateEvent("update-launch-guard", event, properties),
      setTimer: (callback, ms) => {
        if (windowTimer !== null) clearTimeout(windowTimer);
        windowTimer = setTimeout(() => {
          windowTimer = null;
          callback();
        }, ms);
        (windowTimer as { unref?: () => void }).unref?.();
      },
    });
    created.start();
    guard = created;
    errorUtils.setGlobalHandler((error, isFatal) => {
      try {
        if (isFatal === true) created.noteFatalError();
        else created.handleError(error, "global_handler");
      } catch (guardError) {
        console.warn("[update-launch-guard] global handler report failed", guardError);
      }
      // Unchanged: a fatal stays fatal (native recovery handles it on its own),
      // a non-fatal stays non-fatal.
      original(error, isFatal);
    });
  } catch (error) {
    guard = null;
    console.warn("[update-launch-guard] not installed", error);
  }
}

export function getUpdateLaunchGuard(): UpdateLaunchGuard | null {
  return guard;
}

/**
 * Written by safeReloadRuntime right before the native restart, so the launch
 * it starts is reported as an in-app reload rather than a fresh process.
 */
export function markInAppReloadForLaunchGuard(now: number = Date.now()): void {
  try {
    const store = installed && guard !== null ? activeStore : fileStore;
    const record = parseUpdateLaunchRecord(store.read());
    store.write(serializeUpdateLaunchRecord(withInAppReloadMarked(record, now)));
  } catch (error) {
    console.warn("[update-launch-guard] could not mark the in-app reload", error);
  }
}

/**
 * Called by safeReloadRuntime when a restart did not happen (the native reload
 * rejected, or resolved and this process lived on). The marker describes a
 * restart that never started a new runtime, so it must not make the next cold
 * start look like one.
 */
export function clearInAppReloadForLaunchGuard(): void {
  try {
    const store = installed && guard !== null ? activeStore : fileStore;
    const record = parseUpdateLaunchRecord(store.read());
    if (record === null || record.inAppReloadAt === null) return;
    store.write(serializeUpdateLaunchRecord({ ...record, inAppReloadAt: null }));
  } catch (error) {
    console.warn("[update-launch-guard] could not clear the in-app reload marker", error);
  }
}

/** The restart screen's button: the app's one restart path, through safeReload. */
export async function requestLaunchErrorRestart(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createOtaUpdateBridge } = require("./otaUpdateRuntime") as {
    createOtaUpdateBridge: () => { reload: () => Promise<void> };
  };
  await createOtaUpdateBridge().reload();
}

/** Hides the native splash so the restart screen is visible. Never throws. */
export function hideSplashForLaunchError(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SplashScreen = require("expo-splash-screen") as { hideAsync?: () => Promise<unknown> };
    void SplashScreen.hideAsync?.()?.catch?.((error: unknown) => {
      console.warn("[update-launch-guard] splash hide failed", error);
    });
  } catch (error) {
    console.warn("[update-launch-guard] splash unavailable", error);
  }
}

export function resetUpdateLaunchGuardForTests(): void {
  // A window timer or telemetry retry left running would confirm, report and
  // require the analytics wrapper after the test environment is gone.
  resetUpdateGateTelemetryForTests();
  if (windowTimer !== null) clearTimeout(windowTimer);
  windowTimer = null;
  guard = null;
  installed = false;
  activeStore = fileStore;
}
