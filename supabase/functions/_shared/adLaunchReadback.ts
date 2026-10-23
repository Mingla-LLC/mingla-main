/** Issue #3697 — Snap can acknowledge activation before delivery status settles. */

export const SNAP_LAUNCH_READBACK_DELAY_MS = 3_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function providerLaunchReadback<T>(input: {
  platform: string;
  action: "launch" | "pause";
  read: () => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  if (input.platform === "snapchat" && input.action === "launch") {
    await (input.sleep ?? defaultSleep)(SNAP_LAUNCH_READBACK_DELAY_MS);
  }
  return await input.read();
}
