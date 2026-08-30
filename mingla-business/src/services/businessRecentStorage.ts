import type { StateStorage } from "zustand/middleware";
import { enqueueBusinessRecentCacheMutation } from "./businessRecentCacheQueue";

const recentStorage =
  (): typeof import("@react-native-async-storage/async-storage").default => {
    // Detail routes register the Recent writer before any Recent persistence is
    // needed. Resolve native storage only when hydration/cache work begins.
    const storageModule =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@react-native-async-storage/async-storage") as
        | typeof import("@react-native-async-storage/async-storage")
        | typeof import("@react-native-async-storage/async-storage").default;
    return "default" in storageModule ? storageModule.default : storageModule;
  };

export const businessRecentStateStorage: StateStorage = {
  getItem: (name) => recentStorage().getItem(name),
  setItem: (name, value) => recentStorage().setItem(name, value),
  removeItem: (name) => recentStorage().removeItem(name),
};

export function clearBusinessRecentCachedUser(
  userId: string,
): Promise<void> {
  return enqueueBusinessRecentCacheMutation(async () => {
    const storage = recentStorage();
    const manifestKey = "business-recent-cache-manifest-v1";
    const raw = await storage.getItem(manifestKey);
    if (raw === null) return;
    const manifest: string[] = JSON.parse(raw);
    const prefix = `${userId}:`;
    const cacheKey = (scope: string): string =>
      `business-recent-cache-v1:${scope}`;
    await storage.multiRemove(
      manifest.filter((scope) => scope.startsWith(prefix)).map(cacheKey),
    );
    await storage.setItem(
      manifestKey,
      JSON.stringify(manifest.filter((scope) => !scope.startsWith(prefix))),
    );
  });
}

export default recentStorage;
