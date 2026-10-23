import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  providerLaunchReadback,
  SNAP_LAUNCH_READBACK_DELAY_MS,
} from "../adLaunchReadback.ts";

Deno.test("#3697 Snap launch waits a few seconds before its delivery read-back", async () => {
  const calls: string[] = [];
  const status = await providerLaunchReadback({
    platform: "snapchat",
    action: "launch",
    sleep: (ms) => {
      calls.push(`sleep:${ms}`);
      return Promise.resolve();
    },
    read: () => {
      calls.push("read");
      return Promise.resolve("ACTIVE");
    },
  });
  assertEquals(status, "ACTIVE");
  assertEquals(calls, [`sleep:${SNAP_LAUNCH_READBACK_DELAY_MS}`, "read"]);
});

Deno.test("#3697 pause and non-Snap launch read immediately", async () => {
  for (
    const [platform, action] of [
      ["snapchat", "pause"],
      ["meta", "launch"],
      ["tiktok", "launch"],
    ] as const
  ) {
    let sleeps = 0;
    await providerLaunchReadback({
      platform,
      action,
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
      read: () => Promise.resolve("ok"),
    });
    assertEquals(sleeps, 0);
  }
});
