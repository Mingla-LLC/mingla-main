/**
 * #4339 §5 phase 4b — "Prompt your website into existence" → Ari, the host web
 * half (implementor happy path + refusals).
 *
 * - The resume path: `/auth?next=/ari?draft=<id>` survives sign-in (exact
 *   `/ari` only; `/ari/settings` and lookalikes stay refused).
 * - The route param: only a uuid is accepted as a draft id.
 * - The claim service maps the RPC answer; it throws only on a failed call.
 * - The hook claims once, only when ready, sends the framed description, and
 *   opens Ari normally for an unavailable draft or a failed claim.
 * - AriChatScreen wires the hook to the real send path in a new conversation.
 */
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

// react-test-renderer ships no types in this package; describe the two calls used.
interface ReactTestRenderer {
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => unknown) => Promise<void> & void;
  create: (element: React.ReactElement) => ReactTestRenderer;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = jest.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("../../services/supabase", () => ({
  supabase: { rpc: (fn: string, args: unknown) => rpcMock(fn, args) },
}));

import { claimSitePromptDraft } from "../../services/sitePromptDraftService";
import { sanitizeNextRoute } from "../../utils/nextRoute";
import { parseSitePromptDraftId, sitePromptFirstMessage } from "../../utils/sitePromptDraft";
import {
  resetSitePromptDraftHandoffForTests,
  useSitePromptDraftHandoff,
  type SitePromptDraftHandoffArgs,
} from "../useSitePromptDraftHandoff";

const DRAFT_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const BODY = "A rooftop cafe in Lekki with live acoustic sets on Fridays.";

describe("the sign-in resume path keeps the draft id", () => {
  test("/ari?draft=<id> is an allowed resume target, raw and encoded", () => {
    expect(sanitizeNextRoute(`/ari?draft=${DRAFT_ID}`)).toBe(`/ari?draft=${DRAFT_ID}`);
    expect(sanitizeNextRoute("/ari")).toBe("/ari");
    expect(sanitizeNextRoute(`/ari/?draft=${DRAFT_ID}`)).toBe(`/ari/?draft=${DRAFT_ID}`);
  });

  test("only the exact /ari path: sub-routes, lookalikes and escapes stay refused", () => {
    for (const bad of [
      "/ari/settings",
      "/ari-evil",
      "/arix?draft=1",
      "//ari",
      "/ari/../brand/1/payments",
      "https://evil.test/ari?draft=1",
    ]) {
      expect([bad, sanitizeNextRoute(bad)]).toEqual([bad, null]);
    }
  });
});

describe("the draft route param", () => {
  test("accepts a uuid only, lowercased", () => {
    expect(parseSitePromptDraftId(DRAFT_ID.toUpperCase())).toBe(DRAFT_ID);
    expect(parseSitePromptDraftId(` ${DRAFT_ID} `)).toBe(DRAFT_ID);
    for (const bad of [undefined, "", "abc", [DRAFT_ID], `${DRAFT_ID}x`, "A rooftop cafe"]) {
      expect(parseSitePromptDraftId(bad as string | string[] | undefined)).toBeNull();
    }
  });

  test("the first message is the description, framed as the website request", () => {
    expect(sitePromptFirstMessage(`  ${BODY}  `)).toBe(
      `Build my website from this description:\n\n${BODY}`,
    );
  });
});

describe("claimSitePromptDraft", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test("claimed → the body; calls the claim RPC with the id only", async () => {
    rpcMock.mockResolvedValue({ data: { status: "claimed", body: BODY }, error: null });
    await expect(claimSitePromptDraft(DRAFT_ID)).resolves.toEqual({ status: "claimed", body: BODY });
    expect(rpcMock).toHaveBeenCalledWith("claim_site_prompt_draft", { p_draft_id: DRAFT_ID });
  });

  test("unavailable or malformed answers → unavailable", async () => {
    for (const data of [{ status: "unavailable" }, null, { status: "claimed" }, { status: "claimed", body: "  " }]) {
      rpcMock.mockResolvedValue({ data, error: null });
      await expect(claimSitePromptDraft(DRAFT_ID)).resolves.toEqual({ status: "unavailable" });
    }
  });

  test("a failed call throws", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "network down" } });
    await expect(claimSitePromptDraft(DRAFT_ID)).rejects.toThrow("network down");
  });
});

function Probe(props: SitePromptDraftHandoffArgs): null {
  useSitePromptDraftHandoff(props);
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSitePromptDraftHandoff", () => {
  let renderer: ReactTestRenderer | null = null;
  const onMessage = jest.fn<(message: string) => void>();
  const onSettled = jest.fn<() => void>();
  const claim = jest.fn<(id: string) => Promise<{ status: "claimed"; body: string } | { status: "unavailable" }>>();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeEach(() => {
    resetSitePromptDraftHandoffForTests();
    onMessage.mockReset();
    onSettled.mockReset();
    claim.mockReset();
    warn.mockClear();
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  function render(props: Partial<SitePromptDraftHandoffArgs>): void {
    const full = { draftId: DRAFT_ID, ready: true, onMessage, onSettled, claim, ...props };
    act(() => {
      if (renderer === null) renderer = create(<Probe {...full} />);
      else renderer.update(<Probe {...full} />);
    });
  }

  test("waits until ready, then claims once and sends the framed description", async () => {
    claim.mockResolvedValue({ status: "claimed", body: BODY });
    render({ ready: false });
    await flush();
    expect(claim).not.toHaveBeenCalled();

    render({ ready: true });
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith(DRAFT_ID);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(sitePromptFirstMessage(BODY));
    expect(onSettled).toHaveBeenCalledTimes(1);

    // Re-renders and readiness flicker never claim or send again.
    render({ ready: false });
    render({ ready: true });
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  test("a remount on the same page load does not claim the same draft twice", async () => {
    claim.mockResolvedValue({ status: "claimed", body: BODY });
    render({});
    await flush();
    act(() => renderer?.unmount());
    renderer = null;
    render({});
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  test("no draft id: nothing happens", async () => {
    render({ draftId: null });
    await flush();
    expect(claim).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  test("an unavailable draft opens Ari normally: no message, id dropped", async () => {
    claim.mockResolvedValue({ status: "unavailable" });
    render({});
    await flush();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a failed claim opens Ari normally and is logged", async () => {
    claim.mockRejectedValue(new Error("offline"));
    render({});
    await flush();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[ari] website description claim failed", "offline");
  });
});

describe("AriChatScreen wiring", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../screens/ari/AriChatScreen.tsx"),
    "utf8",
  );

  test("reads ?draft only on the main Ari surface and gates on consent and settled scope", () => {
    expect(source).toMatch(
      /setup === undefined && !websiteSplit \? parseSitePromptDraftId\(sitesParams\.draft\) : null/,
    );
    expect(source).toMatch(/!disclosureNeeded &&\s*brands\.isSuccess &&/);
    expect(source).toMatch(/\(brandCount === 0 \|\| \(selectedBrandId !== null && conversationRestored\)\)/);
  });

  test("sends through the real send path in a new conversation and drops the id", () => {
    expect(source).toMatch(
      /onMessage: \(message\) => \{\s*chat\.setConversationId\(null\);[\s\S]*?if \(!handleSendRef\.current\(message\)\) setDraftText\(message\);/,
    );
    expect(source).toMatch(/onSettled: \(\) => router\.setParams\(\{ draft: undefined \} as never\)/);
  });
});
