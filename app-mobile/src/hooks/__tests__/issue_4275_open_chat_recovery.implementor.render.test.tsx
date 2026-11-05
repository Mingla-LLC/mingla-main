// Issue #4275 SC-A4 / T-A13 — the hook wiring around the recovery controller.
//
// FAILS-ON-REVERT: remove `controller.dispose()` from the effect cleanup and the
// "leaving" test fails (a timer still rebuilds). Remove the key check on the bus and
// the "another chat" test fails. Treat inactive as a resume and the iOS test fails.

import React from "react";
import { AppState } from "react-native";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const { useOpenChatRecovery } = require("../useOpenChatRecovery") as typeof import("../useOpenChatRecovery");
const { chatChannelBus } = require("../../utils/chatChannelRecovery") as typeof import("../../utils/chatChannelRecovery");

type Props = {
  channelKey: string | null;
  conversationId: string | null;
  catchUp: jest.Mock;
  rebuildChanges: jest.Mock;
  getChangesChannelState: jest.Mock;
};

function Harness(props: Props): null {
  useOpenChatRecovery({ ...props, isOffline: false });
  return null;
}

async function tick(ms = 0): Promise<void> {
  await TestRenderer.act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("#4275 useOpenChatRecovery", () => {
  let appStateListener: ((state: string) => void) | null;
  let props: Props;
  let renderer: ReturnType<typeof TestRenderer.create>;

  const mount = async (overrides: Partial<Props> = {}) => {
    props = { ...props, ...overrides };
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Harness {...props} />);
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => {});
    appStateListener = null;
    Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: () => undefined };
    }) as never);
    props = {
      channelKey: "chat-1",
      conversationId: "chat-1",
      catchUp: jest.fn(() => Promise.resolve()),
      rebuildChanges: jest.fn(),
      getChangesChannelState: jest.fn(() => "joined"),
    };
  });

  afterEach(() => {
    TestRenderer.act(() => renderer.unmount());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("reads on SUBSCRIBED for this chat, and ignores another chat's status", async () => {
    await mount();
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "another-chat", status: "SUBSCRIBED" });
    await tick();
    expect(props.catchUp).not.toHaveBeenCalled();
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "chat-1", status: "SUBSCRIBED" });
    await tick();
    expect(props.catchUp).toHaveBeenCalledTimes(1);
  });

  it("a server close rebuilds changes through the caller; a broadcast close sends a command naming the chat", async () => {
    await mount();
    const commands: unknown[] = [];
    const leave = chatChannelBus.subscribe((event) => {
      if (event.kind === "rebuild") commands.push(event);
    });
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "chat-1", status: "CLOSED" });
    chatChannelBus.emit({ kind: "status", source: "broadcast", conversationId: "chat-1", status: "CLOSED" });
    await tick(1300);
    leave();
    expect(props.rebuildChanges).toHaveBeenCalledTimes(1);
    expect(commands).toEqual([{ kind: "rebuild", source: "broadcast", conversationId: "chat-1" }]);
  });

  it("SC-A4 leaving a chat: no recovery, no timers and no reads afterwards", async () => {
    await mount();
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "chat-1", status: "CLOSED" });
    await TestRenderer.act(async () => {
      renderer.update(<Harness {...props} channelKey={null} />);
    });
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "chat-1", status: "SUBSCRIBED" });
    await tick(600_000);
    expect(props.catchUp).not.toHaveBeenCalled();
    expect(props.rebuildChanges).not.toHaveBeenCalled();
  });

  it("only background to active resumes, debounced; iOS inactive to active does nothing", async () => {
    await mount();
    appStateListener?.("inactive");
    appStateListener?.("active");
    await tick(1000);
    expect(props.catchUp).not.toHaveBeenCalled();

    appStateListener?.("background");
    appStateListener?.("active");
    await tick(500);
    expect(props.catchUp).not.toHaveBeenCalled();
    await tick(200);
    expect(props.catchUp).toHaveBeenCalledTimes(1);
  });

  it("a later timer calls the latest callbacks, not the ones from when the chat opened", async () => {
    await mount();
    const newer = jest.fn(() => Promise.resolve());
    await TestRenderer.act(async () => {
      renderer.update(<Harness {...props} catchUp={newer} />);
    });
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "chat-1", status: "SUBSCRIBED" });
    await tick();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(props.catchUp).not.toHaveBeenCalled();
  });

  it("no chat open: no controller, so events do nothing", async () => {
    await mount({ channelKey: null, conversationId: null });
    chatChannelBus.emit({ kind: "status", source: "changes", conversationId: "chat-1", status: "SUBSCRIBED" });
    await tick(600_000);
    expect(props.catchUp).not.toHaveBeenCalled();
  });
});
