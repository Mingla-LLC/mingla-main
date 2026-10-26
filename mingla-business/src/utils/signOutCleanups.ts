/**
 * Sign-out cleanups registered by code that is loaded on demand (Constitution
 * #6, logout clears everything).
 *
 * clearAllStores() runs on every sign-out path, but it cannot import a lazily
 * loaded module (that would pull the module into the boot bundle). Such a
 * module registers its cleanup here when it loads, and clearAllStores() runs
 * whatever has been registered. Nothing registered means nothing to clear.
 */

const cleanups = new Set<() => void>();

/** Run `cleanup` on every sign-out from now on. Returns an unregister function. */
export function registerSignOutCleanup(cleanup: () => void): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/** Called by clearAllStores(). A failing cleanup is logged and never stops the others. */
export function runSignOutCleanups(): void {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      console.warn("[signOutCleanups] a sign-out cleanup failed", error);
    }
  }
}
