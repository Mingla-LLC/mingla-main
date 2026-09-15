/**
 * #3280 (defect 1) — the cover sheet side of "continue in a fresh sheet after
 * the native trim editor".
 *
 * When the picker hands its outcome over, the sheet must:
 *   1. hide, so its native modal (the one the editor was stacked on) goes away;
 *   2. present again only after its content has unmounted and a settle has
 *      passed (presenting while the old modal is still up is refused on iOS);
 *   3. mount a FRESH picker with the hand-off, and clear it once taken;
 *   4. drop the hand-off if the host closes the sheet meanwhile, freeing any
 *      failed photos' files, so nothing starts on the next open.
 *
 * The REAL CoverPickerSheet is mounted. `Sheet` is mocked to render its children
 * only while visible (the real one unmounts them after closing); CoverPicker is
 * mocked to record its props and mounts.
 *
 * Fails on revert of CoverPickerSheet.tsx: the sheet never hides, never mounts a
 * second picker, and the picker never receives the hand-off.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sheet: { visibleHistory: boolean[]; keepChildrenWhenHidden: boolean } = {
  visibleHistory: [],
  keepChildrenWhenHidden: false,
};
type PickerProps = Record<string, unknown>;
const picker: { mounts: number; unmounts: number; latest: PickerProps | null; instances: object[] } = {
  mounts: 0,
  unmounts: 0,
  latest: null,
  instances: [],
};

jest.mock("../Sheet", () => {
  const ReactActual = require("react");
  return {
    Sheet: ({ visible, children }: { visible: boolean; children?: unknown }) => {
      sheet.visibleHistory.push(visible);
      return visible || sheet.keepChildrenWhenHidden
        ? ReactActual.createElement("MockSheet", { visible }, children)
        : null;
    },
  };
});
jest.mock("../CoverPicker", () => {
  const ReactActual = require("react");
  return {
    CoverPicker: (props: PickerProps) => {
      const instance = ReactActual.useRef({}).current;
      picker.latest = props;
      ReactActual.useEffect(() => {
        picker.mounts += 1;
        picker.instances.push(instance);
        return () => {
          picker.unmounts += 1;
        };
      }, []);
      return ReactActual.createElement("MockPicker", null);
    },
  };
});
jest.mock("../Toast", () => ({ Toast: (): null => null }));
jest.mock("../Button", () => ({ Button: (): null => null }));
jest.mock("../Icon", () => ({ Icon: (): null => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactActual = require("react");
  return {
    ScrollView: ({ children }: { children?: unknown }) =>
      ReactActual.createElement("MockScroll", null, children),
  };
});
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../SheetMobile", () => ({ UNMOUNT_DELAY_MS: 280 }));
jest.mock("../Modal", () => ({ UNMOUNT_DELAY_MS: 200 }));

// eslint-disable-next-line import/first
import { CoverPickerSheet, NATIVE_EDITOR_RETURN_FALLBACK_MS } from "../CoverPickerSheet";
// eslint-disable-next-line import/first
import {
  canContinueAfterNativeEditor,
  NATIVE_EDITOR_RETURN_SETTLE_MS,
  returnsThroughFreshSheet,
  type NativeEditorCarry,
} from "../coverPickerNativeEditorReturn";
// eslint-disable-next-line import/first
import { DEFER_SETTLE_MS } from "../../../utils/deferAfterDismiss";

type Tree = { update: (element: React.ReactElement) => void; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const INITIAL = {
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
};
const TARGET = {
  kind: "event" as const,
  brandId: "brand-1",
  eventRowId: "7b0b6f0e-0000-4000-8000-000000000001",
  coverMediaApplyMode: "draft_auto" as const,
};

const element = (visible: boolean): React.ReactElement => (
  <CoverPickerSheet
    visible={visible}
    onClose={() => undefined}
    target={TARGET}
    initial={INITIAL}
    onCoverChange={() => undefined}
    onShowToast={() => undefined}
  />
);

const settleLazy = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

const mount = async (): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element(true));
  });
  await settleLazy();
  return tree as Tree;
};

const advance = async (ms: number): Promise<void> => {
  await TestRenderer.act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settleLazy();
};

const carry = (release: () => void = () => undefined): NativeEditorCarry => ({
  id: 4242,
  handedOffBy: picker.instances[0] ?? {},
  notice: null,
  upload: {
    file: {
      uri: "file:///Documents/trimmedVideo_1.mp4",
      bytes: 1_097_262,
      durationMs: 15_000,
      trimStartMs: 0,
      trimEndMs: 15_000,
    },
    replacing: false,
  },
  failedGalleryPhotos: [
    { key: "photo-1", asset: { uri: "file:///photo.jpg", release }, message: "Couldn't upload this photo.", stage: "upload", attempts: 1 },
  ],
});

beforeEach(() => {
  jest.useFakeTimers();
  sheet.visibleHistory = [];
  sheet.keepChildrenWhenHidden = false;
  picker.mounts = 0;
  picker.unmounts = 0;
  picker.latest = null;
  picker.instances = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe("#3280 — CoverPickerSheet comes back fresh after the trim editor", () => {
  test("it hides, waits for the old sheet to be gone, then mounts a fresh picker with the hand-off", async () => {
    const tree = await mount();
    expect(picker.mounts).toBe(1);
    expect(picker.latest?.resumeAfterNativeEditor).toBeNull();
    expect(typeof picker.latest?.onNativeEditorClosed).toBe("function");

    const handOff = carry();
    await TestRenderer.act(async () => {
      (picker.latest?.onNativeEditorClosed as (c: NativeEditorCarry) => void)(handOff);
    });
    await settleLazy();

    // 1. The sheet hides; the picker the editor was stacked on unmounts.
    expect(sheet.visibleHistory[sheet.visibleHistory.length - 1]).toBe(false);
    expect(picker.unmounts).toBe(1);

    // 2. It does not present again before the settle has passed.
    await advance(NATIVE_EDITOR_RETURN_SETTLE_MS - 1);
    expect(sheet.visibleHistory[sheet.visibleHistory.length - 1]).toBe(false);
    expect(picker.mounts).toBe(1);

    // 3. After it, a FRESH picker mounts with the hand-off.
    await advance(1);
    expect(sheet.visibleHistory[sheet.visibleHistory.length - 1]).toBe(true);
    expect(picker.mounts).toBe(2);
    expect(picker.latest?.resumeAfterNativeEditor).toBe(handOff);

    // The fresh picker takes it; the sheet clears it.
    await TestRenderer.act(async () => {
      (picker.latest?.onResumeAfterNativeEditorConsumed as (id: number) => void)(4242);
    });
    expect(picker.latest?.resumeAfterNativeEditor).toBeNull();

    // The fallback timer that fires later changes nothing.
    await advance(NATIVE_EDITOR_RETURN_FALLBACK_MS);
    expect(picker.mounts).toBe(2);
    expect(picker.latest?.resumeAfterNativeEditor).toBeNull();
    await TestRenderer.act(() => tree.unmount());
  });

  test("if the host closes the sheet meanwhile, the hand-off is dropped and never resumed", async () => {
    const release = jest.fn();
    const tree = await mount();
    await TestRenderer.act(async () => {
      (picker.latest?.onNativeEditorClosed as (c: NativeEditorCarry) => void)(carry(release));
    });
    await settleLazy();

    await TestRenderer.act(() => tree.update(element(false)));
    expect(release).toHaveBeenCalledTimes(1);
    await advance(NATIVE_EDITOR_RETURN_FALLBACK_MS + NATIVE_EDITOR_RETURN_SETTLE_MS);
    expect(picker.mounts).toBe(1);

    // The host opens the sheet again later: a normal sheet, no hand-off.
    await TestRenderer.act(() => tree.update(element(true)));
    await settleLazy();
    expect(picker.mounts).toBe(2);
    expect(picker.latest?.resumeAfterNativeEditor).toBeNull();
    await TestRenderer.act(() => tree.unmount());
  });

  test("if the old content never unmounts, it comes back anyway and lets that picker continue", async () => {
    sheet.keepChildrenWhenHidden = true;
    const tree = await mount();
    const handOff = carry();
    await TestRenderer.act(async () => {
      (picker.latest?.onNativeEditorClosed as (c: NativeEditorCarry) => void)(handOff);
    });
    await settleLazy();
    expect(picker.unmounts).toBe(0);

    await advance(NATIVE_EDITOR_RETURN_FALLBACK_MS);
    const resumed = picker.latest?.resumeAfterNativeEditor as NativeEditorCarry | null;
    expect(resumed?.id).toBe(4242);
    // Owner released: the still-mounted picker is allowed to continue.
    expect(resumed?.handedOffBy).toBeNull();
    expect(sheet.visibleHistory[sheet.visibleHistory.length - 1]).toBe(true);
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3280 — the hand-off rules", () => {
  test("only iOS pickers whose sheet can present again hand off", () => {
    expect(returnsThroughFreshSheet("ios", true)).toBe(true);
    expect(returnsThroughFreshSheet("ios", false)).toBe(false);
    expect(returnsThroughFreshSheet("android", true)).toBe(false);
    expect(returnsThroughFreshSheet("web", true)).toBe(false);
  });

  test("an upload waits for the fresh picker's reconnect; a message does not", () => {
    expect(canContinueAfterNativeEditor({ armed: false, videoPhase: "idle", hasUpload: true })).toBe(false);
    expect(canContinueAfterNativeEditor({ armed: true, videoPhase: "reattaching", hasUpload: true })).toBe(false);
    expect(canContinueAfterNativeEditor({ armed: true, videoPhase: "idle", hasUpload: true })).toBe(true);
    expect(canContinueAfterNativeEditor({ armed: true, videoPhase: "processing", hasUpload: true })).toBe(true);
    expect(canContinueAfterNativeEditor({ armed: true, videoPhase: "reattaching", hasUpload: false })).toBe(true);
    expect(canContinueAfterNativeEditor({ armed: false, videoPhase: "idle", hasUpload: false })).toBe(false);
  });

  test("the settle before presenting again is #1360's settle", () => {
    expect(NATIVE_EDITOR_RETURN_SETTLE_MS).toBe(DEFER_SETTLE_MS);
  });
});
