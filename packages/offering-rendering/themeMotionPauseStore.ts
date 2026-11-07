// issue #1023 — the device's "motion paused" choice, native: AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { MOTION_PAUSED_STORAGE_KEY, createMotionPauseStore } from "./themeMotion";

export const motionPauseStore = createMotionPauseStore(
  {
    read: () => AsyncStorage.getItem(MOTION_PAUSED_STORAGE_KEY),
    write: (value) => AsyncStorage.setItem(MOTION_PAUSED_STORAGE_KEY, value),
  },
  (error) => {
    // Playback still pauses for this session; only the memory is lost.
    console.warn("[theme-motion] could not read or save the paused choice", error);
  },
);
