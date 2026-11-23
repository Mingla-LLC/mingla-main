/**
 * #4490 spec 08 O3 — the station chime behind ONE small interface, so a native
 * player can be added later without touching the screens.
 *
 * This file is the iOS/Android player. [TRANSITIONAL] native station sound:
 * Host apps have no audio module yet, so the station shows "Sound needs the
 * latest app" and still flashes. Exit condition: the Host store build that
 * carries `expo-audio` (Seth's named approval; spec 08 §9 decision 4); then
 * implement this file with expo-audio loaded through requireOptionalNativeModule
 * (an older binary keeps answering "unsupported" instead of crashing). The web
 * player is stationSound.web.ts.
 */
export type StationSoundSupport = "ready" | "locked" | "unsupported";

export interface StationSoundPlayer {
  /** ready: plays; locked: the browser needs a tap first; unsupported: no player here. */
  support(): StationSoundSupport;
  /** Call from a user tap (Start service, Turn sound on, Play test sound). */
  unlock(): Promise<StationSoundSupport>;
  /** Play the chime once; false when it could not play. */
  play(): Promise<boolean>;
  dispose(): void;
}

export function createStationSoundPlayer(): StationSoundPlayer {
  return {
    support: () => "unsupported",
    unlock: () => Promise.resolve("unsupported"),
    play: () => Promise.resolve(false),
    dispose: () => undefined,
  };
}
