/**
 * #4114 rework — a host's event chat video that will not open says so inline
 * (Constitution #3, no silent failure) and can be tapped again.
 *
 * fails-on-revert (true line deletion): delete `setOpenFailed(true);` in
 * GroupChatMessageMedia's video onPress → the failure is console-only and the
 * "Couldn't open the video" assertion fails.
 */
import React from "react";
import { Linking } from "react-native";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "0b8b8f0e-3a5c-4b52-9a0b-6a3a1d2c9e11/7d3c2f2a-1b4e-4c9a-8f6b-2e1d0c9b8a77.mp4";

const mockSign = jest.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }));
jest.mock("../../../services/supabase", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (path: string) => mockSign(path) }) } },
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => Promise<void> | void) => Promise<void>;
  create: (node: React.ReactElement) => {
    root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> } };
    toJSON: () => unknown;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GroupChatMessageMedia } = require("../GroupChatMessageMedia") as {
  GroupChatMessageMedia: React.ComponentType<{ message: Record<string, unknown>; mine: boolean }>;
};

function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => texts(child, out));
  else if (node && typeof node === "object") ((node as { children?: unknown[] }).children ?? []).forEach((child) => texts(child, out));
  return out;
}

describe("#4114 host event chat video open", () => {
  it("shows an inline error when the video will not open, and clears it on a working retry", async () => {
    const open = jest.spyOn(Linking, "openURL").mockRejectedValueOnce(new Error("no handler"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(
        React.createElement(GroupChatMessageMedia, {
          message: { message_type: "video", file_url: PATH, file_name: "clip.mp4", view_once: false },
          mine: false,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const rendered = tree as unknown as ReturnType<typeof create>;
    expect(texts(rendered.toJSON())).toContain("Video");

    await act(async () => {
      (rendered.root.findByProps({ testID: "group-chat-video" }).props.onPress as () => void)();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(open).toHaveBeenCalledWith(`https://signed.test/${PATH}`);
    expect(texts(rendered.toJSON())).toContain("Couldn't open the video. Tap to try again.");

    open.mockResolvedValueOnce(true);
    await act(async () => {
      (rendered.root.findByProps({ testID: "group-chat-video" }).props.onPress as () => void)();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(texts(rendered.toJSON())).toContain("Video");
    open.mockRestore();
    warn.mockRestore();
  });
});
