// #2107 (U1) — this app's wiring for the pure launch guard (updateLaunchGuard.ts).
//
// Byte-identical in app-mobile and mingla-business (parity-gated by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs).
//
// RULES THIS FILE HOLDS:
// - Static imports are sibling pure modules only. expo-updates (through
//   otaUpdateRuntime), expo-file-system and the restart path are required
//   LAZILY, inside the function that needs them, and every one of them is
//   wrapped so a failure only switches the guard off. Booting does no native
//   work at all: the store is first touched on an error, a confirmation or a
//   restart.
// - In __DEV__ nothing is installed, so development keeps React Native's red
//   box exactly as before.
// - Escalation calls the global error handler captured at install time, which
//   is React Native's own (installed before Sentry.init wraps it). Sentry's
//   wrapper flushes before passing a fatal on, and that delay would let native
//   content appear first, which is the one thing that stops a rollback.

import {
  UpdateLaunchGuard,
  parseUpdateLaunchRecord,
  serializeUpdateLaunchRecord,
  withInAppReloadMarked,
  type UpdateLaunchFacts,
  type UpdateLaunchStore,
} from "./updateLaunchGuard";
import { reportUpdateGateEvent } from "./updateGateTelemetry";

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
      escalate: (error) => original(error, true),
      report: (event, properties) =>
        reportUpdateGateEvent("update-launch-guard", event, properties),
      setTimer: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        (timer as { unref?: () => void }).unref?.();
      },
    });
    created.start();
    guard = created;
    errorUtils.setGlobalHandler((error, isFatal) => {
      if (isFatal === true) {
        // Already fatal: native recovery sees it on its own.
        created.noteFatalError();
        original(error, true);
        return;
      }
      let outcome: ReturnType<UpdateLaunchGuard["handleError"]> | null = null;
      try {
        outcome = created.handleError(error, "global_handler");
      } catch (guardError) {
        console.warn("[update-launch-guard] global handler check failed", guardError);
      }
      // An escalated error already went to the original handler as a fatal.
      if (outcome?.kind === "escalated") return;
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
 * Written by safeReloadRuntime right before the native restart. The process it
 * starts is not a fresh one: Android does not re-arm expo-updates' recovery
 * after an in-app reload, so that launch must never escalate.
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
  guard = null;
  installed = false;
  activeStore = fileStore;
}
