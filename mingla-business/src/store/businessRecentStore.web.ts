import { businessRecentStateStorage } from "../services/businessRecentStorage";

export type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
  BusinessRecentQueuePointer,
} from "./businessRecentStoreCore";

const reset = (): void => {
  const loaded = (
    globalThis as unknown as Record<symbol, unknown>
  )[Symbol.for("mingla.business-recent.reset")];
  if (typeof loaded === "function") loaded();
  else void businessRecentStateStorage.removeItem("business-recent-v1");
};

export const useBusinessRecentStore = {
  getState: () => ({ reset }),
};
