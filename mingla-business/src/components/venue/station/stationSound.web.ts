/**
 * #4490 spec 08 O3 — the web station chime: one HTMLAudioElement, unlocked by a
 * tap ("Start service" or "Turn sound on"). A browser that refuses to play
 * without a tap (autoplay rule) makes the player "locked"; the board then shows
 * "Tap to turn sound on" (spec 08 §11 T17). Same interface as the native file.
 */
import { STATION_CHIME_DATA_URL } from "./stationChime.web";
import type { StationSoundPlayer, StationSoundSupport } from "./stationSound";

export type { StationSoundPlayer, StationSoundSupport } from "./stationSound";

interface AudioLike {
  play: () => Promise<void> | void;
  pause: () => void;
  currentTime: number;
  muted: boolean;
  volume: number;
  preload: string;
}

type AudioFactory = (src: string) => AudioLike | null;

const defaultAudio: AudioFactory = (src) => {
  const Ctor = (globalThis as { Audio?: new (src: string) => AudioLike }).Audio;
  return Ctor === undefined ? null : new Ctor(src);
};

const blockedByBrowser = (error: unknown): boolean =>
  error instanceof Error && (error.name === "NotAllowedError" || /user (gesture|interaction|didn't interact)/i.test(error.message));

export function createStationSoundPlayer(makeAudio: AudioFactory = defaultAudio): StationSoundPlayer {
  let audio: AudioLike | null = null;
  let state: StationSoundSupport = "locked";
  const element = (): AudioLike | null => {
    if (audio === null) {
      audio = makeAudio(STATION_CHIME_DATA_URL);
      if (audio === null) state = "unsupported";
      else {
        audio.preload = "auto";
        audio.volume = 1;
      }
    }
    return audio;
  };
  const tryPlay = async (silent: boolean): Promise<boolean> => {
    const a = element();
    if (a === null) return false;
    try {
      a.muted = silent;
      a.currentTime = 0;
      await a.play();
      if (silent) {
        a.pause();
        a.currentTime = 0;
      }
      a.muted = false;
      state = "ready";
      return true;
    } catch (error) {
      a.muted = false;
      if (blockedByBrowser(error)) state = "locked";
      else console.warn("[station] chime could not play", error instanceof Error ? error.name : "unknown");
      return false;
    }
  };
  return {
    support: () => (element() === null ? "unsupported" : state),
    unlock: async () => {
      // A silent play inside the tap is what lets later plays ring.
      await tryPlay(true);
      return element() === null ? "unsupported" : state;
    },
    play: () => tryPlay(false),
    dispose: () => {
      audio?.pause();
      audio = null;
    },
  };
}
