/**
 * #3429 REWORK-1 SC-R1-HEIC-METRIC implementor proof.
 * A browser that cannot open a HEIC photo refuses it with the locked copy and
 * records exactly one categorical `ari_attachment_outcome` (failed, image,
 * HEIC_NOT_SUPPORTED_IN_BROWSER) per refused file — and none for a HEIC the
 * browser could decode.
 */

import React from "react";

const { create, act } = require("react-test-renderer") as {
  create: (node: React.ReactElement) => unknown;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPick = jest.fn();
const mockPrepareImage = jest.fn();
const mockCapture = jest.fn();
const mockPrepareServer = jest.fn();
let mockNextId = 0;

jest.mock("react-native", () => ({ Linking: { openSettings: jest.fn() } }));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => undefined) }));
jest.mock("../../components/ari/ariAttachmentPicker", () => ({
  pickAriAttachmentFiles: (source: unknown, remaining: unknown) => mockPick(source, remaining),
}));
jest.mock("../../services/ariPrepareImage", () => ({
  prepareAriImage: (input: unknown) => mockPrepareImage(input),
}));
jest.mock("../../services/ariAttachmentFileReader", () => ({
  ariAttachmentSourceExists: jest.fn(async () => true),
  readAriAttachmentSize: jest.fn(async () => 10),
}));
jest.mock("../../services/ariPolishAnalytics", () => ({
  captureAriAttachmentOutcome: (event: unknown) => mockCapture(event),
}));
jest.mock("../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../services/ariAttachmentService", () => {
  const actual = jest.requireActual("../../services/ariAttachmentService");
  return {
    ...actual,
    discardAriAttachment: jest.fn(async () => undefined),
    prepareAriAttachments: (args: unknown) => mockPrepareServer(args),
  };
});
jest.mock("../../utils/randomId", () => ({ randomId: () => `local-${++mockNextId}` }));

import { useAriAttachments, type UseAriAttachmentsResult } from "../useAriAttachments";
import { AriImagePreparationError } from "../../services/ariImagePreparation";

let latest: UseAriAttachmentsResult | null = null;

function Probe(): null {
  latest = useAriAttachments({ brandId: "brand-3429", conversationId: null, surface: "main" });
  return null;
}

function heicFile(name: string) {
  return { uri: `blob:${name}`, name, mimeType: "image/heic", size: 1_700_000, webFile: new File(["heic"], name, { type: "image/heic" }) };
}

describe("#3429 SC-R1-HEIC-METRIC", () => {
  beforeEach(() => {
    latest = null;
    mockNextId = 0;
    mockPick.mockReset();
    mockPrepareImage.mockReset();
    mockCapture.mockReset();
    mockPrepareServer.mockReset();
    mockPrepareServer.mockImplementation(async (args: { drafts: { localId: string }[]; onUpdate: (id: string, patch: Record<string, unknown>) => void }) => {
      args.drafts.forEach((draft) => args.onUpdate(draft.localId, { state: "ready", attachmentId: `server-${draft.localId}` }));
    });
  });

  it("records one refusal per browser-refused HEIC and nothing for a decodable HEIC", async () => {
    mockPick.mockResolvedValue([heicFile("refused.heic"), heicFile("decoded.heic"), heicFile("also-refused.HEIC")]);
    mockPrepareImage.mockImplementation(async (input: { name: string }) => {
      if (input.name !== "decoded.heic") throw new AriImagePreparationError("HEIC_NOT_SUPPORTED_IN_BROWSER");
      return { uri: "blob:decoded.jpg", name: "decoded.jpg", mimeType: "image/jpeg", sizeBytes: 420_000, width: 1600, height: 1200 };
    });
    await act(async () => { create(<Probe />); });
    await act(async () => { await latest!.addFiles("all"); });

    const refusals = mockCapture.mock.calls
      .map(([event]) => event as Record<string, unknown>)
      .filter((event) => event.errorCode === "HEIC_NOT_SUPPORTED_IN_BROWSER");
    expect(refusals).toEqual([
      { surface: "main", outcome: "failed", fileType: "image", errorCode: "HEIC_NOT_SUPPORTED_IN_BROWSER" },
      { surface: "main", outcome: "failed", fileType: "image", errorCode: "HEIC_NOT_SUPPORTED_IN_BROWSER" },
    ]);
    const cards = latest!.attachments;
    expect(cards.map((card) => [card.name, card.state])).toEqual([
      ["refused.heic", "failed"],
      ["decoded.jpg", "ready"],
      ["also-refused.HEIC", "failed"],
    ]);
    expect(cards[0].errorMessage).toBe(
      "This browser can’t open HEIC photos. Save refused.heic as a JPG, or attach it from the Mingla Business app on your phone.",
    );
    // The refused files never reach the server.
    expect(mockPrepareServer).toHaveBeenCalledTimes(1);
    expect((mockPrepareServer.mock.calls[0][0] as { drafts: { name: string }[] }).drafts.map((d) => d.name)).toEqual(["decoded.jpg"]);
  });
});
