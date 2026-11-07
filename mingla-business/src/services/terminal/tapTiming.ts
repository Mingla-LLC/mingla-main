/**
 * #4271 — how long from the host's press to Apple's tap screen being asked for.
 * The press time lives here rather than in the URL. It stops just before
 * collectPaymentMethod, so it does not include Apple's sheet drawing: the
 * one-second requirement itself needs a device and a stopwatch.
 */
let press: { atMs: number; warm: boolean } | null = null;

export const markDoorTapPress = (warm: boolean, atMs: number = Date.now()): void => {
  press = { atMs, warm };
};

/** Once per press: a "try another card" is not a new press. */
export const consumeDoorTapPress = (nowMs: number = Date.now()): { ms: number; warm: boolean } | null => {
  if (press === null) return null;
  const result = { ms: Math.max(0, nowMs - press.atMs), warm: press.warm };
  press = null;
  return result;
};
