/**
 * issue #3645 — "Publish without chip-ins for now" must not race its own save.
 *
 * The RSVP publish call sends only the event id, so the server publishes what
 * is STORED. The first version switched chip-ins off locally, left the save to
 * the 700 ms background autosave and reopened the publish flow after 340 ms.
 * A slow or failed save then either sent the host to bank setup (the opposite
 * of their choice) or let the RSVP go live with chip-ins still on.
 *
 * The real orchestration runs here against a model of the wizard and the
 * server: a local flag, a stored flag, a save that can be held open or made to
 * fail, and a publish that reads the STORED flag exactly as the server does.
 */

import { describe, expect, test } from "@jest/globals";

import {
  RSVP_CHIP_INS_OFF_FAILED_COPY,
  switchChipInsOffThenProceed,
} from "../rsvpPublishWithoutChipIns";

interface Draft {
  id: string;
  rsvpContributionEnabled: boolean;
  revision: number;
}

interface World {
  local: Draft;
  stored: Draft;
  events: string[];
  working: boolean;
  error: string | null;
  queuedSave: boolean;
  navigations: string[];
  published: Draft[];
  /** Set by a test to hold the save open, fail it, or make it lie. */
  save: (draft: Draft) => Promise<Partial<Draft> | null | undefined>;
  releaseSave: () => void;
  run: () => Promise<boolean>;
  /** What the publish confirmation does: the server reads the STORED draft. */
  publish: () => void;
}

function makeWorld(initiallyOn = true): World {
  const world = {
    local: { id: "rsvp-1", rsvpContributionEnabled: initiallyOn, revision: 1 },
    stored: { id: "rsvp-1", rsvpContributionEnabled: true, revision: 1 },
    events: [] as string[],
    working: false,
    error: null as string | null,
    queuedSave: false,
    navigations: [] as string[],
    published: [] as Draft[],
    releaseSave: (): void => undefined,
  } as World;

  // Default save: lands on the server and answers with what was stored.
  world.save = async (draft: Draft): Promise<Draft> => {
    world.events.push(`save:${draft.rsvpContributionEnabled ? "on" : "off"}`);
    world.stored = { ...draft };
    return { ...world.stored };
  };
  world.publish = (): void => {
    world.events.push("publish");
    world.published.push({ ...world.stored });
  };
  world.run = (): Promise<boolean> =>
    switchChipInsOffThenProceed<Draft>({
      getLocalChipIns: () => world.local.rsvpContributionEnabled,
      setLocalChipIns: (enabled) => {
        world.local = {
          ...world.local,
          rsvpContributionEnabled: enabled,
          revision: world.local.revision + 1,
        };
        world.queuedSave = true; // the wizard's handleUpdate queues an autosave
        world.events.push(`local:${enabled ? "on" : "off"}`);
        return world.local;
      },
      cancelQueuedSave: () => {
        world.queuedSave = false;
        world.events.push("cancel-queued-save");
      },
      saveNow: (draft) => world.save(draft),
      setWorking: (working) => {
        world.working = working;
        world.events.push(`working:${working}`);
      },
      setError: (message) => {
        world.error = message;
      },
      proceed: () => {
        world.events.push("proceed");
        world.publish();
      },
    });
  return world;
}

const holdSaveOpen = (world: World, outcome: "land" | "fail"): void => {
  world.save = (draft: Draft): Promise<Draft> =>
    new Promise<Draft>((resolve, reject) => {
      world.events.push(`save-started:${draft.rsvpContributionEnabled ? "on" : "off"}`);
      world.releaseSave = (): void => {
        if (outcome === "fail") {
          reject(new Error("Network request failed"));
          return;
        }
        world.stored = { ...draft };
        resolve({ ...world.stored });
      };
    });
};

describe("#3645 — the save succeeds", () => {
  test("publish proceeds, and what is published has chip-ins OFF in the saved payload", async () => {
    const world = makeWorld();
    const proceeded = await world.run();

    expect(proceeded).toBe(true);
    expect(world.events).toEqual([
      "working:true",
      "local:off",
      "cancel-queued-save",
      "save:off",
      "working:false",
      "proceed",
      "publish",
    ]);
    expect(world.published).toHaveLength(1);
    expect(world.published[0].rsvpContributionEnabled).toBe(false);
    expect(world.stored.rsvpContributionEnabled).toBe(false);
    expect(world.local.rsvpContributionEnabled).toBe(false);
    expect(world.error).toBeNull();
    expect(world.working).toBe(false);
  });

  test("the background autosave queued by the local change is dropped: one save, not two", async () => {
    const world = makeWorld();
    await world.run();
    expect(world.queuedSave).toBe(false);
    expect(world.events.filter((e) => e.startsWith("save")).length).toBe(1);
  });
});

describe("#3645 — publish is never called before the save resolves", () => {
  test("while the save is in flight: working, nothing published, nothing continued", async () => {
    const world = makeWorld();
    holdSaveOpen(world, "land");
    const running = world.run();
    await Promise.resolve();
    await Promise.resolve();

    expect(world.events).toEqual([
      "working:true",
      "local:off",
      "cancel-queued-save",
      "save-started:off",
    ]);
    expect(world.working).toBe(true);
    expect(world.published).toHaveLength(0);
    // The server still has chip-ins ON at this point: publishing now is the bug.
    expect(world.stored.rsvpContributionEnabled).toBe(true);

    world.releaseSave();
    expect(await running).toBe(true);
    expect(world.events.indexOf("publish")).toBeGreaterThan(
      world.events.indexOf("save-started:off"),
    );
    expect(world.published[0].rsvpContributionEnabled).toBe(false);
  });

  test("however long the save takes, the order never changes", async () => {
    const world = makeWorld();
    holdSaveOpen(world, "land");
    const running = world.run();
    for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();
    expect(world.published).toHaveLength(0);
    expect(world.events).not.toContain("proceed");
    world.releaseSave();
    await running;
    expect(world.published).toHaveLength(1);
  });
});

describe("#3645 — the save fails", () => {
  test("no publish, no navigation, the error is shown, the flag is restored", async () => {
    const world = makeWorld();
    holdSaveOpen(world, "fail");
    const running = world.run();
    await Promise.resolve();
    world.releaseSave();
    const proceeded = await running;

    expect(proceeded).toBe(false);
    expect(world.published).toHaveLength(0);
    expect(world.events).not.toContain("proceed");
    expect(world.events).not.toContain("publish");
    expect(world.navigations).toEqual([]);
    expect(world.error).toBe(
      "We couldn't switch chip-ins off. Check your connection and try again.",
    );
    expect(world.error).toBe(RSVP_CHIP_INS_OFF_FAILED_COPY);
    // The screen matches the server again: both still have chip-ins on.
    expect(world.local.rsvpContributionEnabled).toBe(true);
    expect(world.stored.rsvpContributionEnabled).toBe(true);
    expect(world.working).toBe(false);
    expect(world.events.slice(-2)).toEqual(["local:on", "working:false"]);
  });

  test("the host can try again from the same dialog, and the second try publishes off", async () => {
    const world = makeWorld();
    const landing = world.save;
    world.save = async (): Promise<Draft> => {
      throw new Error("Network request failed");
    };
    expect(await world.run()).toBe(false);
    expect(world.error).toBe(RSVP_CHIP_INS_OFF_FAILED_COPY);

    world.save = landing;
    expect(await world.run()).toBe(true);
    expect(world.error).toBeNull();
    expect(world.published).toHaveLength(1);
    expect(world.published[0].rsvpContributionEnabled).toBe(false);
  });

  test.each([
    ["answers with chip-ins still on", async (): Promise<Partial<Draft>> => ({ rsvpContributionEnabled: true })],
    ["answers with nothing", async (): Promise<undefined> => undefined],
    ["answers with null", async (): Promise<null> => null],
    ["answers without the flag", async (): Promise<Partial<Draft>> => ({ id: "rsvp-1" })],
  ])("a save that %s is not a stored 'off': nothing is published", async (_label, save) => {
    const world = makeWorld();
    world.save = save;
    expect(await world.run()).toBe(false);
    expect(world.published).toHaveLength(0);
    expect(world.error).toBe(RSVP_CHIP_INS_OFF_FAILED_COPY);
    expect(world.local.rsvpContributionEnabled).toBe(true);
  });

  test("a surface with no awaited save attempts nothing and publishes nothing", async () => {
    const world = makeWorld();
    const proceeded = await switchChipInsOffThenProceed<Draft>({
      getLocalChipIns: () => world.local.rsvpContributionEnabled,
      setLocalChipIns: () => {
        world.events.push("local-touched");
        return world.local;
      },
      cancelQueuedSave: () => world.events.push("cancel-queued-save"),
      saveNow: undefined,
      setWorking: (working) => world.events.push(`working:${working}`),
      setError: (message) => {
        world.error = message;
      },
      proceed: () => world.publish(),
    });
    expect(proceeded).toBe(false);
    expect(world.events).toEqual([]);
    expect(world.published).toHaveLength(0);
    expect(world.local.rsvpContributionEnabled).toBe(true);
    expect(world.error).toBe(RSVP_CHIP_INS_OFF_FAILED_COPY);
  });
});

describe("#3645 — the belt: the server refused although the screen said chip-ins were off", () => {
  test("the choice is shown again; its secondary saves 'off' for real, then publishes", async () => {
    // Local already off (an earlier attempt), stored still on.
    const world = makeWorld(false);
    expect(world.stored.rsvpContributionEnabled).toBe(true);

    expect(await world.run()).toBe(true);
    expect(world.events).toContain("save:off");
    expect(world.published[0].rsvpContributionEnabled).toBe(false);
  });

  test("if that save fails too, the screen goes back to what it showed, and nothing is published", async () => {
    const world = makeWorld(false);
    world.save = async (): Promise<Draft> => {
      throw new Error("Network request failed");
    };
    expect(await world.run()).toBe(false);
    expect(world.local.rsvpContributionEnabled).toBe(false);
    expect(world.published).toHaveLength(0);
    expect(world.error).toBe(RSVP_CHIP_INS_OFF_FAILED_COPY);
  });
});

describe("#3645 — the wording", () => {
  test("says what failed and what to do, and names no payment provider", () => {
    expect(RSVP_CHIP_INS_OFF_FAILED_COPY).not.toMatch(/stripe|paystack/i);
    expect(RSVP_CHIP_INS_OFF_FAILED_COPY).not.toContain("[object");
  });
});
