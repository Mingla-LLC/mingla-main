/**
 * #4572 regression: a draft guard must name the exact setup action that clears
 * it, and Discard must preserve the server/transport reason. Reverting the
 * checklist-derived line or restoring the catch-all error makes these fail.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import {
  DraftInProgress,
  allText,
  byLabel,
  checklistAt,
  draftDiscardFailureMessage,
  harness,
  mount,
  press,
  resetHarness,
  unmountAll,
} from "./issue4389FlowHarness";

beforeEach(resetHarness);
afterEach(unmountAll);

describe("#4572 draft guard escape and honest discard failures", () => {
  test("country is named as the next blocker, including the exact free-only escape", async () => {
    harness.checklist = checklistAt("country");
    const tree = await mount(
      <DraftInProgress draftId="draft-4572" draftName="alin" onContinue={() => undefined} onDiscarded={() => undefined} />,
    );

    expect(allText(tree)).toContain("Next: choose a bank country.");
    expect(allText(tree)).toContain("Save and finish later → Free events only for now");
  });

  test("pay is named as the next blocker, without telling the host to repeat country", async () => {
    harness.checklist = checklistAt("pay");
    const tree = await mount(
      <DraftInProgress draftId="draft-4572" draftName="alin" onContinue={() => undefined} onDiscarded={() => undefined} />,
    );

    expect(allText(tree)).toContain("Next: finish Get paid");
    expect(allText(tree)).not.toContain("choose a bank country");
  });

  test("an owner refusal remains an owner refusal instead of a generic retry", async () => {
    harness.checklist = checklistAt("country");
    harness.discardDraft.mockResolvedValue({ ok: false, error: "forbidden" });
    const tree = await mount(
      <DraftInProgress
        draftId="draft-4572"
        draftName="alin"
        onContinue={() => undefined}
        onDiscarded={() => undefined}
        startConfirming
      />,
    );

    await press(byLabel(tree, "Discard")[0]);
    expect(allText(tree)).toContain("Only the account owner can discard this draft.");
    expect(allText(tree)).not.toContain("We couldn't discard alin. Try again.");
  });

  test("transport, auth-lock and no-longer-draft failures have distinct remedies", () => {
    expect(draftDiscardFailureMessage(
      Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }),
      "alin",
    ))
      .toContain("Check your connection");
    expect(draftDiscardFailureMessage(
      Object.assign(new Error("Finishing sign-in"), { name: "BusinessAuthNotReadyError" }),
      "alin",
    )).toContain("no delete request was sent");
    expect(draftDiscardFailureMessage(Object.assign(new Error("jwt expired"), { status: 401 }), "alin"))
      .toContain("Sign in again");
    expect(draftDiscardFailureMessage({ ok: false, error: "not_a_draft" }, "alin"))
      .toContain("alin is no longer a draft");
  });
});
