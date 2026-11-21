/* eslint-disable import/first */
/**
 * #4420 — Help & Support's Support column, rendered.
 *
 *   1. The switch's Ari mark IS the Ari orb: the real Icon renders HomeAriOrb
 *      inside the Ari segment (no new drawing).
 *   2. "Talk to a person" with nothing asked yet just switches to A person.
 *   3. With a question and a photo, it hands both over, selects A person on
 *      the conversation it wrote into, and shows a refused photo's plain line.
 *   4. A total failure stays on Ari with the message and a Retry that reuses
 *      the progress (nothing sent twice).
 *
 * FAILS-ON-REVERT: draw the Ari segment with anything but Icon name="ari"
 * and block 1 fails; drop the hand-over call or its notices and block 3
 * fails; stop keeping the failed attempt's progress and block 4 fails.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Record<string, unknown>;
const mockAriChatProps: Props[] = [];
const mockPersonProps: Props[] = [];
const mockHandOver = jest.fn<(input: Props) => Promise<unknown>>();
class MockHandoverError extends Error {
  constructor(readonly progress: unknown) {
    super("failed");
  }
}

jest.mock("../../home/HomeAriOrb", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  HomeAriOrb: (props: Props) => require("react").createElement("HomeAriOrbProbe", props),
}));
jest.mock("../LazySupportScreens", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const handover = require("../supportHandover");
  return {
    LazySupportAriChat: (props: Props) => {
      mockAriChatProps.push(props);
      return createElement("AriChatProbe", props);
    },
    LazySupportPersonPane: (props: Props) => {
      mockPersonProps.push(props);
      return createElement("PersonPaneProbe", props);
    },
    loadSupportScreens: async () => ({
      handOverPayloadFromMessages: handover.handOverPayloadFromMessages,
      handOverToSupport: (input: Props) => mockHandOver(input),
      handoverNotices: (outcome: { photoFailures: unknown[]; skippedFiles: number }) =>
        outcome.photoFailures.length > 0 ? ["One photo could not be sent. Add it again here."] : [],
      handoverFailureMessage: () => "We couldn't hand this over to the team. Nothing was sent. Try again.",
      HandoverError: MockHandoverError,
    }),
  };
});
jest.mock("../helpCentreLauncher", () => ({ openHelpCentre: jest.fn(async () => undefined) }), { virtual: true });
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, isAuthReady: true }) }));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (select: (state: { currentBrandId: string | null }) => unknown) => select({ currentBrandId: "brand-1" }),
}));
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));

import { SupportColumn } from "../SupportColumn";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
interface Node {
  type: unknown;
  props: Props;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer {
  root: Node;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}

function Harness({ initial = "ari" as "ari" | "person" }): React.ReactElement {
  const [mode, setMode] = React.useState(initial);
  return (
    <SupportColumn mode={mode} onModeChange={setMode} showTitle={false} startNew={false} onToast={jest.fn()} bottomInset={0} />
  );
}

async function mount(): Promise<Renderer> {
  let renderer!: Renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(<Harness />);
  });
  return renderer;
}

const byTestId = (renderer: Renderer, id: string): Node[] =>
  renderer.root.findAll((node) => node.props.testID === id && typeof node.type !== "string");

async function press(renderer: Renderer, id: string): Promise<void> {
  const [target] = renderer.root.findAll((node) => node.props.testID === id && typeof node.props.onPress === "function");
  await TestRenderer.act(async () => {
    (target.props.onPress as () => void)();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function selectedMode(renderer: Renderer): string | undefined {
  const [ari] = renderer.root.findAll((node) => node.props.testID === "support-mode-ari" && node.props.accessibilityState !== undefined);
  return (ari.props.accessibilityState as { selected: boolean }).selected ? "ari" : "person";
}

function lastAriChat(): Props {
  return mockAriChatProps[mockAriChatProps.length - 1];
}

async function seedConversation(messages: unknown[]): Promise<void> {
  await TestRenderer.act(async () => {
    (lastAriChat().onConversationChange as (s: unknown) => void)({ conversationId: "c-1", messages });
  });
}

describe("#4420 Support column", () => {
  test("1. the Ari segment's mark is the Ari orb", async () => {
    const renderer = await mount();
    const [segment] = byTestId(renderer, "support-mode-ari");
    const orbs = segment.findAll((node) => node.type === "HomeAriOrbProbe");
    expect(orbs).toHaveLength(1);
    expect(orbs[0].props.still).toBe(true);
    // The embedded chat is the ordinary Ari chat, with no tab bar under it.
    expect(lastAriChat()).toMatchObject({ embedded: true, withoutTabBar: true });
    expect(Object.keys(lastAriChat()).sort()).toEqual(["embedded", "onConversationChange", "withoutTabBar"]);
    await TestRenderer.act(async () => renderer.unmount());
  });

  test("2. nothing asked yet: Talk to a person just switches", async () => {
    mockHandOver.mockClear();
    const renderer = await mount();
    await press(renderer, "support-talk-to-person");
    expect(mockHandOver).not.toHaveBeenCalled();
    expect(selectedMode(renderer)).toBe("person");
    await TestRenderer.act(async () => renderer.unmount());
  });

  test("3. a question and a photo are handed over; a refused photo is said plainly", async () => {
    mockHandOver.mockReset();
    mockPersonProps.length = 0;
    mockHandOver.mockResolvedValue({
      ticketId: "t-9",
      createdConversation: true,
      photosSent: 0,
      photoFailures: [{ ariAttachmentId: "a1", code: "FILE_TOO_LARGE" }],
      skippedFiles: 0,
      progress: { clientRequestId: "r", ticketId: "t-9", textDelivered: true, copied: {}, sentPhotoIds: [] },
    });
    const renderer = await mount();
    await seedConversation([
      { role: "user", content: { text: "My payout is late", attachments: [{ id: "a1", file_type: "image" }] } },
      { role: "assistant", content: { text: "Let me check." } },
    ]);
    await press(renderer, "support-talk-to-person");
    expect(mockHandOver).toHaveBeenCalledWith({
      userId: "user-1",
      brandId: "brand-1",
      payload: { text: "My payout is late", ariImageIds: ["a1"], skippedFiles: 0 },
      previous: null,
    });
    expect(selectedMode(renderer)).toBe("person");
    const person = mockPersonProps[mockPersonProps.length - 1];
    expect(person.focusTicketId).toBe("t-9");
    expect(person.notices).toEqual(["One photo could not be sent. Add it again here."]);
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["support", "tickets", "user-1"] });
    await TestRenderer.act(async () => renderer.unmount());
  });

  test("4. total failure stays on Ari with a Retry that reuses the progress", async () => {
    mockHandOver.mockReset();
    const progress = { clientRequestId: "r-1", ticketId: "t-1", textDelivered: true, copied: {}, sentPhotoIds: [] };
    mockHandOver.mockRejectedValueOnce(new MockHandoverError(progress));
    const renderer = await mount();
    await seedConversation([{ role: "user", content: { text: "Help" } }]);
    await press(renderer, "support-talk-to-person");
    expect(selectedMode(renderer)).toBe("ari");
    const lines = renderer.root.findAll(
      (node) => typeof node.props.children === "string" && (node.props.children as string).includes("Nothing was sent"),
    );
    expect(lines.length).toBeGreaterThan(0);
    mockHandOver.mockResolvedValueOnce({ ticketId: "t-1", createdConversation: true, photosSent: 0, photoFailures: [], skippedFiles: 0, progress });
    await press(renderer, "support-talk-to-person");
    expect(mockHandOver).toHaveBeenLastCalledWith(expect.objectContaining({ previous: progress }));
    expect(selectedMode(renderer)).toBe("person");
    await TestRenderer.act(async () => renderer.unmount());
  });
});
