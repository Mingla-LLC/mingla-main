/**
 * #3429 CI pass — two defects CI caught that my local subset did not, both
 * proven here by EXECUTING the behaviour rather than reading the source.
 *
 * ORCH-1296 — SPLASH BRICK ON OTA. `ariAttachmentFileReader.native.ts`
 * imported `expo-file-system`'s new `File` API at MODULE SCOPE. A top-level
 * import of a native module is evaluated at boot, so when the native side is
 * missing or version-mismatched it throws before the first frame and the app
 * bricks on the splash screen. This branch ships over OTA, which is how that
 * reaches every installed app at once. T-1 reproduces exactly that: with the
 * native module unavailable, merely LOADING the reader must still succeed.
 *
 * ORCH-1381 — DOUBLE NAVIGATION. `openAriAttachment` re-rolled
 * `window.open(dest, "_blank", "noopener,noreferrer")` inline instead of
 * calling this package's `openExternal` owner. Either token makes `open()`
 * return null EVEN WHEN IT SUCCEEDED, so the owner's popup-block fallback
 * fires on every tap and the page navigates twice. T-3/T-4 drive the real
 * function against a fake Window and assert the tab is opened once, bare.
 *
 * WHY NOT A SOURCE PIN. An earlier draft of this file asserted source text and
 * was correctly rejected by I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN: such pins
 * rot on refactors and caught none of the #1047 regressions. Both defects turn
 * out to be observable after all — one as a module that must load without its
 * native dependency, the other as the argument list a real click produces.
 *
 * fails-on-revert (real mutation, never a comment-out):
 *   - restore the top-level `import { File } from "expo-file-system"` -> T-1 fails
 *   - restore the inline `window.open(..., "noopener,noreferrer")`    -> T-3/T-4 fail
 */

// The native module is UNAVAILABLE — evaluating it throws, exactly as it does
// on a device whose native side does not match the JS bundle.
jest.mock(
  "expo-file-system",
  () => {
    throw new Error("native module unavailable (simulated version mismatch)");
  },
  { virtual: true },
);

const SIGNED_URL = "https://example.test/signed/attachment.pdf";

const invoke = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
jest.mock("react-native", () => ({
  Platform: { OS: "web" },
  Linking: { openURL: jest.fn() },
}));

describe("#3429 · ORCH-1296 — the reader loads even when its native module does not", () => {
  it("T-1 importing the native reader does NOT evaluate expo-file-system (no boot throw)", () => {
    // With a top-level import this throws HERE — which on a device is a throw
    // before the first frame, i.e. the splash brick.
    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../ariAttachmentFileReader.native");
      });
    }).not.toThrow();
  });

  it("T-2 the failure surfaces at CALL time instead, where it can be handled", async () => {
    let mod: typeof import("../ariAttachmentFileReader.native") | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("../ariAttachmentFileReader.native");
    });
    // The lazy import is what defers it — the module is usable, and only the
    // call that actually needs the native side rejects.
    await expect(mod!.readAriAttachmentBytes({ uri: "file:///x.pdf" })).rejects.toThrow();
    // ...and the guarded probes swallow it rather than propagating a boot-shaped
    // crash into the attachment flow.
    await expect(mod!.ariAttachmentSourceExists({ uri: "file:///x.pdf" })).resolves.toBe(false);
    await expect(mod!.readAriAttachmentSize({ uri: "file:///x.pdf" })).resolves.toBeNull();
  });
});

describe("#3429 · ORCH-1381 — opening an attachment opens ONE tab, bare", () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  let open: jest.Mock;
  let assign: jest.Mock;

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { signed_url: SIGNED_URL }, error: null });
    assign = jest.fn();
    // A Window that SUCCEEDS. The trap is that `open()` returns null anyway
    // when noopener/noreferrer is passed, so the caller thinks it failed.
    open = jest.fn((_dest: string, _target?: string, features?: string) =>
      features ? null : ({ opener: {} as unknown } as Window),
    );
    (globalThis as { window?: unknown }).window = { open, location: { assign } };
  });

  afterEach(() => {
    if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = realWindow;
  });

  async function openAttachment(): Promise<void> {
    let mod: typeof import("../ariAttachmentService") | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("../ariAttachmentService");
    });
    await mod!.openAriAttachment("att_1");
  }

  it("T-3 opens the tab with NO feature string, so a success is not read as a failure", async () => {
    await openAttachment();
    expect(open).toHaveBeenCalledTimes(1);
    const [dest, target, features] = open.mock.calls[0];
    expect(dest).toBe(SIGNED_URL);
    expect(target).toBe("_blank");
    // Either token nulls the return value even on success. Neither may be here.
    expect(features).toBeUndefined();
  });

  it("T-4 does not ALSO navigate the current page (the double-navigation bug)", async () => {
    await openAttachment();
    // The inline re-roll passed a feature string, got null back from a
    // SUCCESSFUL open, and fell through to location.assign — two navigations
    // for one tap.
    expect(assign).not.toHaveBeenCalled();
  });

  it("T-5 a genuinely blocked popup still falls back, so the tap is never dead", async () => {
    open.mockImplementation(() => null);
    await openAttachment();
    expect(open).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(SIGNED_URL);
  });
});
