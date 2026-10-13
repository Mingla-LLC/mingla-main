/**
 * issue #3645 — "Accept and continue" on the Organiser Terms sheet CONTINUES.
 *
 * Before: the gate only closed itself (`handlePassed` set gateOpen false) and a
 * toast told the host to tap Publish again. Live test, 2026-10-13: a paid event
 * publish opened the sheet, the host accepted, and landed back on Preview with
 * Publish to press a second time.
 *
 * After: the caller hands the gate the publish it interrupted; once the terms
 * are accepted the gate closes and that publish runs — once, after the sheet
 * has finished dismissing — and is not blocked a second time by its own stale
 * view of "not accepted".
 *
 * The real hook runs here. Only its three imports are replaced: the signed-in
 * user, the acceptance query, and the gate sheet (so its `onPassed` can be
 * fired the way the real sheet fires it).
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  ORGANISER_TERMS_PUBLISH_RETRY_TOAST,
  ORGANISER_TERMS_RESUME_SETTLE_MS,
  useOrganiserTermsPublishGate,
  type OrganiserTermsPublishGate,
} from "../useOrganiserTermsPublishGate";

let acceptanceData: { version: string | null; acceptedAt: string | null } | null = null;
let currentUserId: string | null = "user-3645";
const gateProps: { brandId: string; userId: string; onPassed: () => void }[] = [];

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: currentUserId === null ? null : { id: currentUserId } }),
}));
jest.mock("../useMinglaToSAcceptance", () => ({
  useMinglaToSAcceptance: () => ({ data: acceptanceData, isLoading: false }),
  isCurrentMinglaToSAccepted: (data: { version: string | null } | null) =>
    data !== null && data.version === "1.0",
}));
jest.mock("../../components/onboarding/MinglaToSAcceptanceGate", () => ({
  MinglaToSAcceptanceGate: (props: {
    brandId: string;
    userId: string;
    onPassed: () => void;
  }): null => {
    gateProps.push(props);
    return null;
  },
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
type Tree = { unmount: () => void; update: (element: React.ReactElement) => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (action: () => void | Promise<void>) => Promise<void>;
};

let gate: OrganiserTermsPublishGate | null = null;
const roots: Tree[] = [];

function Harness({ brandId }: { brandId: string | null }): React.ReactElement | null {
  gate = useOrganiserTermsPublishGate(brandId);
  return gate.gateElement;
}

async function mount(brandId: string | null = "brand-3645"): Promise<Tree> {
  let tree: Tree | null = null;
  await renderer.act(async () => {
    tree = renderer.create(<Harness brandId={brandId} />);
  });
  roots.push(tree as unknown as Tree);
  return tree as unknown as Tree;
}

const latestGate = (): { onPassed: () => void } => {
  const last = gateProps[gateProps.length - 1];
  if (last === undefined) throw new Error("the terms sheet never mounted");
  return last;
};

beforeEach(() => {
  jest.useFakeTimers();
  acceptanceData = null;
  currentUserId = "user-3645";
  gateProps.length = 0;
  gate = null;
});
afterEach(async () => {
  await renderer.act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  jest.useRealTimers();
});

describe("#3645 — accepting the Organiser Terms resumes the publish", () => {
  test("a free listing is never stopped and never opens the sheet", async () => {
    await mount();
    const resume = jest.fn();
    let blocked = true;
    await renderer.act(async () => {
      blocked = (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(false, resume);
    });
    expect(blocked).toBe(false);
    expect(gateProps).toHaveLength(0);
    expect(resume).not.toHaveBeenCalled();
  });

  test("already accepted: a paid listing passes straight through", async () => {
    acceptanceData = { version: "1.0", acceptedAt: "2026-10-01T00:00:00Z" };
    await mount();
    const resume = jest.fn();
    let blocked = true;
    await renderer.act(async () => {
      blocked = (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true, resume);
    });
    expect(blocked).toBe(false);
    expect(gateProps).toHaveLength(0);
    expect(resume).not.toHaveBeenCalled();
  });

  test("not accepted: publish stops, the sheet opens, and nothing resumes yet", async () => {
    await mount();
    const resume = jest.fn();
    let blocked = false;
    await renderer.act(async () => {
      blocked = (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true, resume);
    });
    expect(blocked).toBe(true);
    expect(gateProps.length).toBeGreaterThan(0);
    expect(latestGate()).toMatchObject({ brandId: "brand-3645", userId: "user-3645" });
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS * 3);
    });
    expect(resume).not.toHaveBeenCalled();
  });

  test("Accept and continue: the sheet closes and the interrupted publish runs once", async () => {
    await mount();
    const resume = jest.fn();
    await renderer.act(async () => {
      (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true, resume);
    });
    await renderer.act(async () => {
      latestGate().onPassed();
    });
    // The sheet is gone straight away…
    expect((gate as OrganiserTermsPublishGate).gateElement).toBeNull();
    // …and the publish waits for it to finish dismissing (#1360: iOS drops a
    // dialog raised while another is still leaving).
    expect(resume).not.toHaveBeenCalled();
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS - 1);
    });
    expect(resume).not.toHaveBeenCalled();
    await renderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(resume).toHaveBeenCalledTimes(1);
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS * 5);
    });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  test("the sheet reports success twice (mutation, then the query): still one resume", async () => {
    await mount();
    const resume = jest.fn();
    await renderer.act(async () => {
      (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true, resume);
    });
    const { onPassed } = latestGate();
    await renderer.act(async () => {
      onPassed();
    });
    await renderer.act(async () => {
      onPassed();
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS * 2);
    });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  test("the resumed publish is not blocked again by its own stale 'not accepted'", async () => {
    await mount();
    // The handler a wizard captured BEFORE acceptance.
    const staleGate = gate as OrganiserTermsPublishGate;
    const outcomes: boolean[] = [];
    const interruptedPublish = (): void => {
      outcomes.push(
        staleGate.blockPaidPublishUntilAccepted(true, interruptedPublish),
      );
    };
    await renderer.act(async () => {
      interruptedPublish();
    });
    expect(outcomes).toEqual([true]);
    const sheetsBefore = gateProps.length;
    // The acceptance query has NOT caught up (acceptanceData is still null):
    // the gate's own success is what must let the publish through.
    await renderer.act(async () => {
      latestGate().onPassed();
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS);
    });
    expect(outcomes).toEqual([true, false]);
    // And it did not reopen the sheet in a loop.
    expect(gateProps.length).toBe(sheetsBefore);
    expect((gate as OrganiserTermsPublishGate).gateElement).toBeNull();
  });

  test("a caller that hands over nothing to resume is closed and left alone (old behaviour)", async () => {
    await mount();
    await renderer.act(async () => {
      (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true);
    });
    await renderer.act(async () => {
      latestGate().onPassed();
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS * 2);
    });
    expect((gate as OrganiserTermsPublishGate).gateElement).toBeNull();
  });

  test("unmounting before the sheet has settled cancels the resume", async () => {
    const tree = await mount();
    const resume = jest.fn();
    await renderer.act(async () => {
      (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true, resume);
    });
    await renderer.act(async () => {
      latestGate().onPassed();
    });
    await renderer.act(async () => {
      roots.splice(roots.indexOf(tree), 1);
      tree.unmount();
    });
    jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS * 2);
    expect(resume).not.toHaveBeenCalled();
  });

  test("acceptance on one brand does not carry over to another", async () => {
    const tree = await mount("brand-A");
    await renderer.act(async () => {
      (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true, () => undefined);
    });
    await renderer.act(async () => {
      latestGate().onPassed();
    });
    await renderer.act(async () => {
      jest.advanceTimersByTime(ORGANISER_TERMS_RESUME_SETTLE_MS);
    });
    await renderer.act(async () => {
      tree.update(<Harness brandId="brand-B" />);
    });
    let blocked = false;
    await renderer.act(async () => {
      blocked = (gate as OrganiserTermsPublishGate).blockPaidPublishUntilAccepted(true);
    });
    expect(blocked).toBe(true);
  });
});

describe("#3645 — the settle delay and the wording", () => {
  test("the resume waits exactly as long as deferAfterDismiss does", () => {
    // Read from source rather than imported: deferAfterDismiss pulls the sheet
    // primitives, which is why the hook writes the number out.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const read = (...parts: string[]): string =>
      fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");
    const sheet = /export const UNMOUNT_DELAY_MS\s*=\s*(\d+)/.exec(
      read("components", "ui", "SheetMobile.tsx"),
    );
    const modal = /export const UNMOUNT_DELAY_MS\s*=\s*(\d+)/.exec(
      read("components", "ui", "Modal.tsx"),
    );
    const margin = /const SETTLE_MARGIN_MS\s*=\s*(\d+)/.exec(
      read("utils", "deferAfterDismiss.ts"),
    );
    expect(sheet).not.toBeNull();
    expect(modal).not.toBeNull();
    expect(margin).not.toBeNull();
    const expected =
      Math.max(Number((sheet as RegExpExecArray)[1]), Number((modal as RegExpExecArray)[1])) +
      Number((margin as RegExpExecArray)[1]);
    expect(ORGANISER_TERMS_RESUME_SETTLE_MS).toBe(expected);
  });

  test("no wording tells the host to tap Publish again", () => {
    expect(ORGANISER_TERMS_PUBLISH_RETRY_TOAST).not.toMatch(/again/i);
    expect(ORGANISER_TERMS_PUBLISH_RETRY_TOAST).toBe(
      "Accept the Organiser Terms to publish.",
    );
  });
});
