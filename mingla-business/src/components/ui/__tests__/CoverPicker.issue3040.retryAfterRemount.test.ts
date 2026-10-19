/**
 * #3040 T-A6 [A-6] / design T5 — "Try again" always does something. With no
 * retained file (after a remount) it opens the picker with the notice
 * "Choose the video again to retry."; it never returns silently.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { retryVideoPlan, RETRY_PICK_NOTICE } from "../coverPickerRetryRule";

const picker = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");

describe("#3040 T-A6 — retry after remount", () => {
  test("no retained file: open the picker with the notice", () => {
    expect(retryVideoPlan({ retainedFile: false, busy: false })).toEqual({ kind: "pick_again", notice: RETRY_PICK_NOTICE });
    expect(RETRY_PICK_NOTICE).toBe("Choose the video again to retry.");
  });

  test("a retained file restarts with it; a busy sheet says why instead of doing nothing", () => {
    expect(retryVideoPlan({ retainedFile: true, busy: false })).toEqual({ kind: "start_retained" });
    expect(retryVideoPlan({ retainedFile: true, busy: true }).kind).toBe("busy");
  });

  test("the handler opens the picker on the null-file path (the old silent return is gone)", () => {
    const start = picker.indexOf("const retryVideoCoverUpload = useCallback(");
    const body = picker.slice(start, picker.indexOf("}, [", start));
    expect(body).toContain("void pickVideoCover(lockedVideoOperation, null, { tone: \"info\", text: RETRY_PICK_NOTICE });");
    expect(body).not.toMatch(/uploadFile === null[^;]*\) return;/);
  });
});
