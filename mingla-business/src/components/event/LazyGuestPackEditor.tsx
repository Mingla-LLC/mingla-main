/**
 * #4548 — the one lazy owner of GuestPackEditor.
 *
 * The event Where step rides the eager `__common` chunk (it is shared by the
 * create wizards and the live editor), so a static import of the editor would
 * put its ~14 KB, its working copy and its service on every visitor's boot
 * path. The editor loads with its own chunk when a host opens the Where step.
 * Do not add a static `import { GuestPackEditor }` outside tests.
 */
import React from "react";

export const LazyGuestPackEditor = React.lazy(async () => {
  const mod = await import("./GuestPackEditor");
  return { default: mod.GuestPackEditor };
});
