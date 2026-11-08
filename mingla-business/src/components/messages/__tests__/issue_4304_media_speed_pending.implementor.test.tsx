/**
 * #4304 media speed (B) — the sender's own photo shows in the Brand-group
 * thread the moment it is picked, from the local file, with its progress;
 * the server message replaces it exactly once (never both, never neither);
 * a failure stays visible with Retry and Remove.
 *
 * Mounts the REAL upload queue hook and the REAL pending row in a harness that
 * mirrors the thread: server messages + visibleBrandGroupPendingUploads.
 *
 * fails-on-revert (true line deletion): delete the `delivered` filter in
 * visibleBrandGroupPendingUploads → the "exactly once" case sees both bubbles;
 * delete the `state: "failed"` update in useBrandGroupUploadQueue → the failure
 * case never shows Retry.
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUpload = jest.fn();
const mockFinalize = jest.fn();

jest.mock("react-native", () => jest.requireActual("react-native"));
jest.mock("../../../services/brandGroupFilesService", () => ({
  uploadPreparedBrandGroupFile: (...args: unknown[]) => mockUpload(...args),
  finalizeBrandGroupFile: (...args: unknown[]) => mockFinalize(...args),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (work: () => void | Promise<void>) => Promise<void>;
};
/* eslint-disable @typescript-eslint/no-require-imports */
const { useBrandGroupUploadQueue } = require("../../../hooks/useBrandGroupUploadQueue") as typeof import("../../../hooks/useBrandGroupUploadQueue");
const { BrandGroupPendingUploadRow } = require("../BrandGroupPendingUploadRow") as typeof import("../BrandGroupPendingUploadRow");
const { visibleBrandGroupPendingUploads } = require("../../../utils/brandGroupPendingUploads") as typeof import("../../../utils/brandGroupPendingUploads");
const { getBrandGroupLocalPreview, clearBrandGroupLocalPreviews } = require("../brandGroupLocalPreviews") as typeof import("../brandGroupLocalPreviews");
const { runSignOutCleanups } = require("../../../utils/signOutCleanups") as typeof import("../../../utils/signOutCleanups");
/* eslint-enable @typescript-eslint/no-require-imports */

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  children: (Node | string)[];
  findAll: (predicate: (node: Node) => boolean) => Node[];
}
interface Renderer { root: Node; update: (node: React.ReactElement) => void; unmount: () => void }

interface ServerMessage { id: string; file_id: string | null }

const prepared = {
  fileId: "file-1",
  storagePath: "conv/file-1",
  name: "IMG_1.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 600_000,
  local: { uri: "file:///cache/shrunk.jpg", name: "IMG_1.jpg", mimeType: "image/jpeg", size: 600_000 },
};

let queueHandle: ReturnType<typeof useBrandGroupUploadQueue> | null = null;
const frames: { pending: string[]; server: string[] }[] = [];

function Harness({ messages, onUploaded }: { messages: ServerMessage[]; onUploaded: () => void }): React.ReactElement {
  const queue = useBrandGroupUploadQueue({ messages, onUploaded });
  queueHandle = queue;
  const pending = visibleBrandGroupPendingUploads(queue.uploads, messages);
  frames.push({ pending: pending.map((item) => item.fileId), server: messages.flatMap((m) => m.file_id ? [m.file_id] : []) });
  return (
    <>
      {messages.map((message) => React.createElement("ServerBubble", { key: message.id, fileId: message.file_id }))}
      {pending.map((upload) => (
        <BrandGroupPendingUploadRow key={upload.fileId} upload={upload} onRetry={queue.retry} onDismiss={queue.dismiss} />
      ))}
    </>
  );
}

function textOf(node: Node | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

const byTestId = (renderer: Renderer, id: string): Node[] =>
  renderer.root.findAll((node) => node.props.testID === id && typeof node.type !== "string");

describe("#4304 media speed — instant local preview in the thread", () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockFinalize.mockReset();
    frames.length = 0;
    queueHandle = null;
    clearBrandGroupLocalPreviews();
  });

  it("shows the local photo at once, then the server message replaces it exactly once", async () => {
    let finishUpload: () => void = () => undefined;
    mockUpload.mockImplementation((_file: unknown, onProgress: (n: number) => void) => new Promise<void>((resolve) => {
      onProgress(0.4);
      finishUpload = resolve;
    }));
    let finishFinalize: (id: string) => void = () => undefined;
    mockFinalize.mockImplementation(() => new Promise<string>((resolve) => { finishFinalize = resolve; }));

    let messages: ServerMessage[] = [{ id: "m-0", file_id: null }];
    let renderer: Renderer | null = null;
    const onUploaded = jest.fn(() => {
      messages = [...messages, { id: "m-1", file_id: "file-1" }];
      renderer!.update(<Harness messages={messages} onUploaded={onUploaded} />);
    });
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Harness messages={messages} onUploaded={onUploaded} />);
    });
    await TestRenderer.act(async () => {
      void queueHandle!.enqueue([prepared]);
      await Promise.resolve();
    });

    // Instant: the local file, with its progress, before any byte reached the server.
    const [row] = byTestId(renderer!, "brand-group-pending-upload");
    expect(row).toBeDefined();
    const [preview] = byTestId(renderer!, "brand-group-pending-upload-preview");
    expect(preview.props.source).toEqual({ uri: "file:///cache/shrunk.jpg" });
    expect(textOf(byTestId(renderer!, "brand-group-pending-upload-status")[0])).toBe("40% uploaded");
    expect(getBrandGroupLocalPreview("file-1")).toMatchObject({ kind: "image", uri: "file:///cache/shrunk.jpg" });

    await TestRenderer.act(async () => {
      finishUpload();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textOf(byTestId(renderer!, "brand-group-pending-upload-status")[0])).toBe("Saving to the shared Drive folder…");

    await TestRenderer.act(async () => {
      finishFinalize("m-1");
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(byTestId(renderer!, "brand-group-pending-upload")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.type === "ServerBubble" && node.props.fileId === "file-1")).toHaveLength(1);
    // Never both, never neither: every frame shows file-1 exactly once.
    for (const frame of frames.filter((f) => f.pending.length || f.server.includes("file-1"))) {
      const count = frame.pending.filter((id) => id === "file-1").length + frame.server.filter((id) => id === "file-1").length;
      expect(count).toBe(1);
    }
    // The queue forgot the delivered item.
    expect(queueHandle!.uploads).toHaveLength(0);
    // The local photo stays under the server thumbnail, and sign-out clears it.
    expect(getBrandGroupLocalPreview("file-1")).not.toBeNull();
    runSignOutCleanups();
    expect(getBrandGroupLocalPreview("file-1")).toBeNull();
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("a failed upload stays in the thread with Retry, and Retry sends it again", async () => {
    mockUpload.mockRejectedValueOnce(new Error("Upload interrupted. Try again.")).mockResolvedValueOnce(undefined);
    mockFinalize.mockResolvedValue("m-1");
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Harness messages={[]} onUploaded={() => undefined} />);
    });
    await TestRenderer.act(async () => {
      await queueHandle!.enqueue([prepared]);
    });

    expect(byTestId(renderer!, "brand-group-pending-upload")).toHaveLength(1);
    expect(textOf(byTestId(renderer!, "brand-group-pending-upload-status")[0])).toBe("Upload interrupted. Try again.");
    const [retry] = byTestId(renderer!, "brand-group-pending-upload-retry");
    expect(retry).toBeDefined();
    expect(byTestId(renderer!, "brand-group-pending-upload-remove")).toHaveLength(1);

    await TestRenderer.act(async () => {
      (retry.props.onPress as () => void)();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    // Saved, waiting for the server message: still visible, never dropped.
    expect(textOf(byTestId(renderer!, "brand-group-pending-upload-status")[0])).toBe("Sending…");
    await TestRenderer.act(async () => renderer!.unmount());
  });

  it("Remove takes a failed item out of the thread", async () => {
    mockUpload.mockRejectedValue(new Error("Upload failed. Try again."));
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Harness messages={[]} onUploaded={() => undefined} />);
    });
    await TestRenderer.act(async () => {
      await queueHandle!.enqueue([prepared]);
    });
    const [remove] = byTestId(renderer!, "brand-group-pending-upload-remove");
    await TestRenderer.act(async () => {
      (remove.props.onPress as () => void)();
    });
    expect(byTestId(renderer!, "brand-group-pending-upload")).toHaveLength(0);
    await TestRenderer.act(async () => renderer!.unmount());
  });
});
