import type { StateStorage } from "zustand/middleware";

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

export default recentStorage;
