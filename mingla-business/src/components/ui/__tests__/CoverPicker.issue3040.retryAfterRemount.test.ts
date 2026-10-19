/**
 * #3040 T-A6 [A-6] / design T5 — "Try again" always does something. With no
 * retained file (after a remount) it opens the picker with the notice
 * "Choose the video again to retry."; it never returns silently.
 */
import { describe, expect, test } from "@jest/globals";

import { retryVideoPlan, RETRY_PICK_NOTICE } from "../coverPickerRetryRule";

describe("#3040 T-A6 — retry after remount", () => {
  test("no retained file: open the picker with the notice", () => {
    expect(retryVideoPlan({ retainedFile: false, busy: false })).toEqual({ kind: "pick_again", notice: RETRY_PICK_NOTICE });
    expect(RETRY_PICK_NOTICE).toBe("Choose the video again to retry.");
  });

  test("a retained file restarts with it; a busy sheet says why instead of doing nothing", () => {
    expect(retryVideoPlan({ retainedFile: true, busy: false })).toEqual({ kind: "start_retained" });
    expect(retryVideoPlan({ retainedFile: true, busy: true }).kind).toBe("busy");
  });

});
