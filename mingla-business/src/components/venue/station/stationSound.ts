/**
 * #4490 spec 08 O3 — the station chime behind ONE small interface, so the
 * screens never know which player runs. This file is the iOS/Android player;
 * the web player is stationSound.web.ts.
 *
 * O3 part B (native): plays assets/sounds/new-order.mp3 with `expo-audio`. The
 * module is asked for by name first (`requireOptionalNativeModule("ExpoAudio")`,
 * as useDoorScreenAwake does), and only then is the `expo-audio` package loaded
 * — on use, never at module scope, because its JS calls requireNativeModule on
 * import and would throw on a binary without it. An older Host binary that
 * receives this code over the air therefore answers "unsupported": the station
 * stays silent, shows "Sound needs the latest app" and still flashes.
 *
 * Silent-mode playback is set on this screen only: the first unlock or play
 * sets `setAudioModeAsync({ playsInSilentMode: true, interruptionMode:
 * "mixWithOthers" })` (option names from expo-audio 1.1.1's own
 * build/Audio.types.d.ts `AudioMode`; `playsInSilentMode` is iOS-only there and
 * Android ignores it), and dispose (leaving the station screen) puts back the
 * module's defaults `{ playsInSilentMode: false, interruptionMode:
 * "mixWithOthers" }` (ios/AudioRecords.swift `AudioMode` field defaults).
 * The repeat rule (once at once, then every 20 s while any ticket is New) and
 * the in-memory mute live in stationModel.shouldChime / StationScreen.
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

/** The slice of expo-audio this player uses (expo-audio 1.1.1 names). */
export interface NativeAudioPlayerLike {
  play: () => void;
  seekTo: (seconds: number) => Promise<void>;
  remove: () => void;
  volume: number;
}
export interface NativeAudioApi {
  createAudioPlayer: (source: number) => NativeAudioPlayerLike;
  setAudioModeAsync: (mode: { playsInSilentMode: boolean; interruptionMode: "mixWithOthers" }) => Promise<void>;
}
export type NativeAudioLoader = () => NativeAudioApi | null;
export type NativeChimeSource = () => number;

/** Station screen only: ring with the iPhone's silent switch on. */
const STATION_AUDIO_MODE = { playsInSilentMode: true, interruptionMode: "mixWithOthers" } as const;
/** expo-audio's own defaults, put back when the station screen closes. */
const DEFAULT_AUDIO_MODE = { playsInSilentMode: false, interruptionMode: "mixWithOthers" } as const;

const loadExpoAudio: NativeAudioLoader = () => {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (moduleName: string) => unknown;
    };
    if (requireOptionalNativeModule("ExpoAudio") == null) return null;
    return require("expo-audio") as NativeAudioApi;
  } catch {
    return null;
  }
};

const chimeAsset: NativeChimeSource = () => require("../../../../assets/sounds/new-order.mp3") as number;

const warn = (what: string, error: unknown): void => {
  console.warn(`[station] ${what}`, error instanceof Error ? error.message : "unknown");
};

export function createStationSoundPlayer(
  load: NativeAudioLoader = loadExpoAudio,
  source: NativeChimeSource = chimeAsset,
): StationSoundPlayer {
  let api: NativeAudioApi | null | undefined;
  let player: NativeAudioPlayerLike | null = null;
  let modeSet = false;
  const audio = (): NativeAudioApi | null => {
    if (api === undefined) api = load();
    return api;
  };
  const prepare = async (a: NativeAudioApi): Promise<NativeAudioPlayerLike> => {
    if (!modeSet) {
      await a.setAudioModeAsync(STATION_AUDIO_MODE);
      modeSet = true;
    }
    if (player === null) {
      player = a.createAudioPlayer(source());
      player.volume = 1;
    }
    return player;
  };
  return {
    support: () => (audio() === null ? "unsupported" : "ready"),
    unlock: async () => {
      const a = audio();
      if (a === null) return "unsupported";
      try {
        await prepare(a);
      } catch (error) {
        warn("audio mode could not be set", error);
      }
      return "ready";
    },
    play: async () => {
      const a = audio();
      if (a === null) return false;
      try {
        const p = await prepare(a);
        await p.seekTo(0);
        p.play();
        return true;
      } catch (error) {
        warn("chime could not play", error);
        return false;
      }
    },
    // Releases the player and puts the audio mode back. Not final: a later
    // play (React's development double effect) prepares again.
    dispose: () => {
      try {
        player?.remove();
      } catch (error) {
        warn("player release failed", error);
      }
      player = null;
      if (modeSet && api) {
        modeSet = false;
        api.setAudioModeAsync(DEFAULT_AUDIO_MODE).catch((error: unknown) => warn("audio mode restore failed", error));
      }
    },
  };
}
