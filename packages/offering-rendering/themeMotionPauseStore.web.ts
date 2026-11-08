// issue #1023 — the device's "motion paused" choice, web: localStorage.
// Every access is wrapped: Safari private mode, blocked storage and embedded
// previews can throw, and the page must still play (or stay paused) normally.
import { MOTION_PAUSED_STORAGE_KEY, createMotionPauseStore } from "./themeMotion";

export const motionPauseStore = createMotionPauseStore(
  {
    read: async () => {
      try {
        return typeof window === "undefined"
          ? null
          : window.localStorage.getItem(MOTION_PAUSED_STORAGE_KEY);
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
    write: async (value) => {
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(MOTION_PAUSED_STORAGE_KEY, value);
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  },
  (error) => {
    console.warn("[theme-motion] could not read or save the paused choice", error);
  },
);
