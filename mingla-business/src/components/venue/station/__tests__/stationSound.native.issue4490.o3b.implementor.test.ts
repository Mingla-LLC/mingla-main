/**
 * #4490 spec 08 O3 part B — the native station chime (expo-audio behind the
 * one StationSoundPlayer interface).
 *
 * fails-on-revert: put stationSound.ts back to the part A stub (always
 * "unsupported") and every "module present" test fails; load expo-audio at
 * module scope or without asking for the native module first and the "module
 * absent" tests fail (the mocked package throws on import, as the real one
 * does on a binary without ExpoAudio).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

let nativeModules: Record<string, unknown> = {};
let expoAudioImports = 0;
const setAudioModeAsync = jest.fn((_mode: unknown) => Promise.resolve());
const playerInstances: { play: jest.Mock; seekTo: jest.Mock; remove: jest.Mock; volume: number }[] = [];
const createAudioPlayer = jest.fn((_source: unknown) => {
  const p = { play: jest.fn(), seekTo: jest.fn(() => Promise.resolve()), remove: jest.fn(), volume: 0 };
  playerInstances.push(p);
  return p;
});

jest.mock(
  "expo",
  () => ({ requireOptionalNativeModule: (name: string) => nativeModules[name] ?? null }),
  { virtual: true },
);
jest.mock(
  "expo-audio",
  () => {
    expoAudioImports += 1;
    if (nativeModules.ExpoAudio == null) throw new Error("Cannot find native module 'ExpoAudio'");
    return { createAudioPlayer, setAudioModeAsync };
  },
);
jest.mock("../../../../../assets/sounds/new-order.mp3", () => 7, { virtual: true });

// eslint-disable-next-line import/first
import { createStationSoundPlayer } from "../stationSound";
// eslint-disable-next-line import/first
import { muteUntil, shouldChime, STATION_REPEAT_MS } from "../stationModel";

const ROOT = path.join(__dirname, "..");

/** The StationScreen chime effect, tick by tick (same inputs as the screen). */
const runBoard = async (
  player: ReturnType<typeof createStationSoundPlayer>,
  timeline: { at: number; ringing: string[]; mutedUntil?: number | null }[],
): Promise<number[]> => {
  const heard = new Set<string>();
  let lastChimeAt: number | null = null;
  const rang: number[] = [];
  for (const step of timeline) {
    const input = { ringing: step.ringing, heard, lastChimeAt, now: step.at, mutedUntil: step.mutedUntil ?? null };
    if (!shouldChime(input)) {
      if (step.ringing.length === 0) lastChimeAt = null;
      continue;
    }
    lastChimeAt = step.at;
    step.ringing.forEach((k) => heard.add(k));
    if (await player.play()) rang.push(step.at);
  }
  return rang;
};

const seconds = (from: number, to: number, ringing: (t: number) => string[], mutedUntil?: (t: number) => number | null) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const at = (from + i) * 1000;
    return { at, ringing: ringing(at), mutedUntil: mutedUntil?.(at) ?? null };
  });

describe("08-O3B native chime: module present", () => {
  beforeEach(() => {
    nativeModules = { ExpoAudio: {} };
    expoAudioImports = 0;
    playerInstances.length = 0;
    jest.clearAllMocks();
  });

  test("ready; unlock sets silent-mode playback for the station screen only", async () => {
    const player = createStationSoundPlayer();
    expect(player.support()).toBe("ready");
    await expect(player.unlock()).resolves.toBe("ready");
    expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(setAudioModeAsync).toHaveBeenLastCalledWith({ playsInSilentMode: true, interruptionMode: "mixWithOthers" });
    expect(createAudioPlayer).toHaveBeenCalledWith(7);
    player.dispose();
    expect(playerInstances[0]?.remove).toHaveBeenCalled();
    expect(setAudioModeAsync).toHaveBeenLastCalledWith({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
  });

  test("plays once at once, then every 20 s while a ticket is New, and stops when none is", async () => {
    const player = createStationSoundPlayer();
    // New ticket from t=0 to t=45 s, accepted at 46 s; quiet to 90 s.
    const rang = await runBoard(player, seconds(0, 90, (t) => (t <= 45_000 ? ["a"] : [])));
    expect(rang).toEqual([0, STATION_REPEAT_MS, 2 * STATION_REPEAT_MS]);
    expect(STATION_REPEAT_MS).toBe(20_000);
    const p = playerInstances[0];
    expect(p?.play).toHaveBeenCalledTimes(3);
    expect(p?.seekTo).toHaveBeenCalledWith(0);
    expect(createAudioPlayer).toHaveBeenCalledTimes(1); // one player, rewound each time
  });

  test("a second order rings at once; mute stops the sound and ends by itself", async () => {
    const player = createStationSoundPlayer();
    const until = muteUntil(5_000, 15);
    const rang = await runBoard(player, [
      { at: 0, ringing: ["a"] },
      { at: 5_000, ringing: ["a", "b"] },
      ...seconds(6, 15 * 60 + 30, () => ["a", "b"], () => until),
    ]);
    // a at 0, b arrives at 5 s; muted from 6 s until 15 min after 5 s; rings again when the mute runs out.
    expect(rang.slice(0, 2)).toEqual([0, 5_000]);
    expect(rang[2]).toBe(until);
    expect(rang.filter((t) => t > 5_000 && t < until)).toEqual([]);
  });

  test("a failed play reports false and never throws", async () => {
    const player = createStationSoundPlayer();
    await player.unlock();
    playerInstances[0]?.play.mockImplementation(() => {
      throw new Error("route lost");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(player.play()).resolves.toBe(false);
    expect(player.support()).toBe("ready");
    warn.mockRestore();
  });
});

describe("08-O3B native chime: module ABSENT (older binary given this JS over the air)", () => {
  beforeEach(() => {
    nativeModules = {};
    expoAudioImports = 0;
    jest.clearAllMocks();
  });
  afterEach(() => {
    nativeModules = {};
  });

  test("unsupported, silent, no throw, and expo-audio is never imported", async () => {
    const player = createStationSoundPlayer();
    expect(() => player.support()).not.toThrow();
    expect(player.support()).toBe("unsupported");
    await expect(player.unlock()).resolves.toBe("unsupported");
    await expect(player.play()).resolves.toBe(false);
    expect(() => player.dispose()).not.toThrow();
    expect(expoAudioImports).toBe(0);
    expect(setAudioModeAsync).not.toHaveBeenCalled();
  });

  test("the board then shows the 'Sound needs the latest app' banner and keeps flashing", () => {
    const screen = fs.readFileSync(path.join(ROOT, "StationScreen.tsx"), "utf8");
    expect(screen).toMatch(/support === "unsupported"\s*\?\s*\{ tone: "warning", title: STATION_COPY\.needsAppTitle/);
    const copy = fs.readFileSync(path.join(ROOT, "stationCopy.ts"), "utf8");
    expect(copy).toContain("Sound needs the latest app");
  });

  test("source: expo-audio only ever loaded on use, after the native module is found", () => {
    const src = fs.readFileSync(path.join(ROOT, "stationSound.ts"), "utf8");
    expect(src).not.toMatch(/^import [^;]*["']expo-audio["']/m);
    const ask = src.indexOf('requireOptionalNativeModule("ExpoAudio")');
    const load = src.indexOf('require("expo-audio")');
    expect(ask).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(ask);
    expect(src).not.toContain("[TRANSITIONAL]");
  });
});
