/**
 * issue #3645 — the SERVER refused a paid publish for want of the Organiser
 * Terms: the acceptance sheet opens and the refused publish resumes once the
 * terms are accepted.
 *
 * The app normally asks before it publishes. This is the case where it did not
 * know to: its own copy of "accepted" was wrong or out of date (it is cached
 * for the session), or it judged the listing free and the server did not. The
 * server is the authority, so the hook reads acceptance again and:
 *   - not accepted           -> opens the sheet, resumes the publish on accept;
 *   - still reads accepted   -> does NOT open a sheet that has nothing to
 *                               offer and does NOT retry; the caller is told,
 *                               which is what stops a refusal looping;
 *   - the read fails         -> opens the sheet (it shows its own retry).
 *
 * The real hook runs. Its three imports are replaced, as in the sibling
 * resume test: the signed-in user, the acceptance query, and the sheet.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  ORGANISER_TERMS_RESUME_SETTLE_MS,
  useOrganiserTermsPublishGate,
  type OrganiserTermsPublishGate,
} from "../useOrganiserTermsPublishGate";

type Acceptance = { version: string | null; acceptedAt: string | null } | null;

/** What the app has cached. */
let cached: Acceptance = null;
/** What the server answers when acceptance is read again. */
let serverAnswer: () => Promise<{ data?: Acceptance; isError?: boolean }> = () =>
  Promise.resolve({ data: null });
let refetchCalls = 0;
let currentUserId: string | null = "user-3645";
const gateProps: { brandId: string; userId: string; onPassed: () => void }[] = [];

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: currentUserId === null ? null : { id: currentUserId } }),
}));
jest.mock("../useMinglaToSAcceptance", () => ({
  useMinglaToSAcceptance: () => ({
    data: cached,
    isLoading: false,
    refetch: () => {
      refetchCalls += 1;
      return serverAnswer().then((result) => {
        if (result.isError !== true) cached = result.data ?? null;
        return result;
      });
    },
  }),
  isCurrentMinglaToSAccepted: (data: Acceptance) =>
    data != null && data.version === "1.0" && data.acceptedAt != null,
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

const theGate = (): OrganiserTermsPublishGate => gate as OrganiserTermsPublishGate;
const ACCEPTED: Acceptance = { version: "1.0", acceptedAt: "2026-10-01T00:00:00Z" };

async function refuse(
  onAccepted?: () => void,
  onUnresolved?: () => void,
): Promise<void> {
  await renderer.act(async () => {
    theGate().acceptTermsAfterServerRefusal(onAccepted, onUnresolved);
  });
  // Let the acceptance read settle.
  await renderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settle(ms: number = ORGANISER_TERMS_RESUME_SETTLE_MS): Promise<void> {
  await renderer.act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  cached = null;
  serverAnswer = () => Promise.resolve({ data: null });
  refetchCalls = 0;
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

describe("#3645 — a server terms refusal offers the acceptance sheet", () => {
  test("the app thought the terms were accepted; the server says no: the sheet opens", async () => {
    // Cached for the session as accepted, so the app's own check let the publish through.
    cached = ACCEPTED;
    serverAnswer = () => Promise.resolve({ data: null });
    await mount();
    expect(theGate().blockPaidPublishUntilAccepted(true)).toBe(false);
    const resume = jest.fn();
    const unresolved = jest.fn();
    await refuse(resume, unresolved);
    expect(refetchCalls).toBe(1);
    expect(gateProps.length).toBeGreaterThan(0);
    expect(gateProps[gateProps.length - 1]).toMatchObject({ brandId: "brand-3645", userId: "user-3645" });
    expect(theGate().gateElement).not.toBeNull();
    expect(resume).not.toHaveBeenCalled();
    expect(unresolved).not.toHaveBeenCalled();
  });

  test("accepting resumes the refused publish once, after the sheet has closed", async () => {
    await mount();
    const resume = jest.fn();
    await refuse(resume);
    await renderer.act(async () => {
      gateProps[gateProps.length - 1].onPassed();
    });
    expect(theGate().gateElement).toBeNull();
    expect(resume).not.toHaveBeenCalled();
    await settle(ORGANISER_TERMS_RESUME_SETTLE_MS - 1);
    expect(resume).not.toHaveBeenCalled();
    await settle(1);
    expect(resume).toHaveBeenCalledTimes(1);
    await settle(ORGANISER_TERMS_RESUME_SETTLE_MS * 5);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  test("the resumed publish is not stopped again by the app's own check", async () => {
    await mount();
    const outcomes: boolean[] = [];
    const publish = (): void => {
      outcomes.push(theGate().blockPaidPublishUntilAccepted(true, publish));
    };
    await refuse(publish);
    await renderer.act(async () => {
      gateProps[gateProps.length - 1].onPassed();
    });
    await settle();
    expect(outcomes).toEqual([false]);
  });

  test("a free-looking listing the server counts as paid still gets the sheet", async () => {
    // The app judged it free, so it never asked; the server refused.
    await mount();
    expect(theGate().blockPaidPublishUntilAccepted(false)).toBe(false);
    expect(gateProps).toHaveLength(0);
    await refuse(jest.fn());
    expect(gateProps.length).toBeGreaterThan(0);
  });

  test("the server keeps refusing although acceptance reads as current: no sheet, no retry, the caller is told", async () => {
    cached = ACCEPTED;
    serverAnswer = () => Promise.resolve({ data: ACCEPTED });
    await mount();
    const resume = jest.fn();
    const unresolved = jest.fn();
    await refuse(resume, unresolved);
    expect(unresolved).toHaveBeenCalledTimes(1);
    expect(gateProps).toHaveLength(0);
    expect(theGate().gateElement).toBeNull();
    await settle(ORGANISER_TERMS_RESUME_SETTLE_MS * 5);
    expect(resume).not.toHaveBeenCalled();
  });

  test("accept, resume, refused again: the second refusal ends in plain words, not a loop", async () => {
    await mount();
    let publishes = 0;
    const unresolved = jest.fn();
    const publish = (): void => {
      publishes += 1;
      // The server refuses every time, whatever was accepted.
      theGate().acceptTermsAfterServerRefusal(publish, unresolved);
    };
    await renderer.act(async () => {
      publish();
    });
    await renderer.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gateProps.length).toBeGreaterThan(0);
    // The host accepts; from now on the server-side read says accepted.
    serverAnswer = () => Promise.resolve({ data: ACCEPTED });
    await renderer.act(async () => {
      gateProps[gateProps.length - 1].onPassed();
    });
    await settle();
    await renderer.act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle(ORGANISER_TERMS_RESUME_SETTLE_MS * 10);
    expect(publishes).toBe(2);
    expect(unresolved).toHaveBeenCalledTimes(1);
    expect(theGate().gateElement).toBeNull();
  });

  test("acceptance cannot be read: the sheet opens (it carries its own retry)", async () => {
    serverAnswer = () => Promise.resolve({ isError: true });
    await mount();
    const unresolved = jest.fn();
    await refuse(jest.fn(), unresolved);
    expect(gateProps.length).toBeGreaterThan(0);
    expect(unresolved).not.toHaveBeenCalled();

    gateProps.length = 0;
    serverAnswer = () => Promise.reject(new Error("offline"));
    await refuse(jest.fn(), unresolved);
    expect(theGate().gateElement).not.toBeNull();
    expect(unresolved).not.toHaveBeenCalled();
  });

  test("no brand or no signed-in member: nothing to open, the caller is told", async () => {
    await mount(null);
    const unresolved = jest.fn();
    await refuse(jest.fn(), unresolved);
    expect(unresolved).toHaveBeenCalledTimes(1);
    expect(refetchCalls).toBe(0);
    expect(theGate().gateElement).toBeNull();
  });

  test("an answer that arrives after the screen has gone does nothing", async () => {
    let answer: (value: { data?: Acceptance }) => void = () => undefined;
    serverAnswer = () => new Promise((resolve) => { answer = resolve; });
    const tree = await mount();
    const resume = jest.fn();
    const unresolved = jest.fn();
    await renderer.act(async () => {
      theGate().acceptTermsAfterServerRefusal(resume, unresolved);
    });
    await renderer.act(async () => {
      tree.unmount();
    });
    roots.length = 0;
    await renderer.act(async () => {
      answer({ data: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gateProps).toHaveLength(0);
    expect(resume).not.toHaveBeenCalled();
    expect(unresolved).not.toHaveBeenCalled();
  });

  test("an answer for another brand is not applied to this one", async () => {
    let answer: (value: { data?: Acceptance }) => void = () => undefined;
    serverAnswer = () => new Promise((resolve) => { answer = resolve; });
    const tree = await mount("brand-A");
    const unresolved = jest.fn();
    await renderer.act(async () => {
      theGate().acceptTermsAfterServerRefusal(jest.fn(), unresolved);
    });
    await renderer.act(async () => {
      tree.update(<Harness brandId="brand-B" />);
    });
    await renderer.act(async () => {
      answer({ data: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gateProps).toHaveLength(0);
    expect(theGate().gateElement).toBeNull();
    expect(unresolved).not.toHaveBeenCalled();
  });
});
