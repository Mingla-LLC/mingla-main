// issue #1023 — the device's "motion paused" choice, native: AsyncStorage.
// Imported on first read or write, not at module load: render suites (and any
// host without the native module) import this file through the motion shell,
// and a module-scope AsyncStorage import throws there before anything renders.
import { MOTION_PAUSED_STORAGE_KEY, createMotionPauseStore } from "./themeMotion";

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const storage = async (): Promise<AsyncStorageLike> => {
  const mod = await import("@react-native-async-storage/async-storage");
  return (mod.default ?? mod) as unknown as AsyncStorageLike;
};

export const motionPauseStore = createMotionPauseStore(
  {
    read: async () => (await storage()).getItem(MOTION_PAUSED_STORAGE_KEY),
    write: async (value) => (await storage()).setItem(MOTION_PAUSED_STORAGE_KEY, value),
  },
  (error) => {
    // Playback still pauses for this session; only the memory is lost.
    console.warn("[theme-motion] could not read or save the paused choice", error);
  },
);
