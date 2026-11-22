/**
 * #4541 wave 2, buyer web:
 *   R1.14 (N1) the public RSVP page reads its form through the server
 *         (`brand-form-submit` `{op:"page_form"}`), never a database call a guest
 *         may not make. This is the client half of the bug that shipped: the
 *         old read called `rpc("public_brand_form_for_event")`, which only the
 *         server role may run, so every guest got "Questions couldn't load".
 *   R1.3  "After they RSVP": the page parser keeps the mode and its notice; the
 *         RSVP reply's `brandFormHandoff` reaches the page; PurchaseFormHandoff's
 *         pre-minted mode shows the strip with Answer now and Later and opens
 *         `/form/{id}#t={token}` without minting.
 *   R1.1  a buyer who already answered for this event sees the answers
 *         read-only, Continue is on and no answers are sent.
 *
 * FAILS-ON-REVERT: putting `supabase.rpc("public_brand_form_for_event")` back in
 * publicRsvpBrandForm.ts, dropping `answeredHere`, dropping the pre-minted
 * branch, dropping `brandFormHandoff` from the RSVP reply, or dropping the
 * pre-minted Later's `onClose` call (A3) turns a case RED.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invoke = jest.fn<(...a: unknown[]) => Promise<{ data: unknown; error: unknown }>>();
const rpc = jest.fn<(...a: unknown[]) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("../../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
jest.mock("@mingla/form-rendering", () =>
  jest.requireActual("../../../../../../packages/form-rendering/brandFormRules"),
);
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Button: (props: Record<string, unknown>) => R.createElement("Button", props) };
});
jest.mock("../businessFormPrimitives", () => ({ businessFormPrimitives: {} }));
jest.mock("../../../buyer/BuyerConnectionNotice", () => ({ BuyerConnectionNotice: () => null }));

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findAll: (p: (n: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: Node; toJSON: () => unknown; unmount: () => void };
  act: (cb: () => void) => void;
};

import { fetchPublicRsvpBrandForm } from "../../../../services/publicRsvpBrandForm";
import { parseCheckoutForm } from "../../../../services/checkoutBrandFormService";
import {
  answeredHereRows,
  canContinueStep,
  formLinkPath,
  PurchaseFormHandoff,
} from "../CheckoutQuestionsStep";
import { CHECKOUT_FORM_COPY } from "../checkoutFormCopy";
import {
  parseRsvpBrandFormPage,
  parseRsvpBrandFormRead,
  rsvpQuestionsPage,
} from "../../../../../../packages/offering-rendering/rsvpBrandForm";

const FORM = "45410000-0000-4000-8000-000000000001";
const VERSION = "45410000-0000-4000-8000-000000000002";
const DEF = {
  questions: [
    { id: "q1", position: 0, type: "single_choice" as const, label: "Diet", required: true,
      options: [{ id: "veg", label: "Vegan" }, { id: "none", label: "None" }] },
    { id: "q2", position: 1, type: "short_text" as const, label: "Who invited you?", required: false },
  ],
};
const ROOT = path.resolve(__dirname, "../../../../../..");

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
});

describe("#4541 R1.14 the RSVP page reads its form through the server", () => {
  test("signed out: one functions.invoke of page_form, no database call", async () => {
    invoke.mockResolvedValueOnce({
      data: { active: true, mode: "required_step", formId: FORM, versionId: VERSION, name: "Guest questions",
        definition: DEF, doorFullAnswers: false, brand: { displayName: "Sundown" } },
      error: null,
    });
    const read = await fetchPublicRsvpBrandForm("e1");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("brand-form-submit", { body: { op: "page_form", eventId: "e1" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(read?.mode).toBe("required_step");
    expect(rsvpQuestionsPage(read)?.formId).toBe(FORM);
  });

  test("a failed read throws (the page shows Try again), never a silent empty form", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(fetchPublicRsvpBrandForm("e1")).rejects.toThrow("brand_form_load_failed");
  });

  test("no client source calls the server-role-only RSVP form function directly", () => {
    const leaf = fs.readFileSync(path.join(ROOT, "mingla-business/src/services/publicRsvpBrandForm.ts"), "utf8");
    expect(leaf).not.toMatch(/\.rpc\(/);
    expect(leaf).toMatch(/functions\.invoke\("brand-form-submit"/);
    expect(leaf).toMatch(/op: "page_form"/);
  });
});

describe("#4541 R1.3 After they RSVP", () => {
  test("the read keeps after_purchase with its notice; the question parser still refuses it", () => {
    const raw = { active: true, mode: "after_purchase", formId: FORM, brand: { displayName: "Sundown" } };
    expect(parseRsvpBrandFormRead(raw)).toEqual({
      active: true,
      mode: "after_purchase",
      formId: FORM,
      notice: "Sundown will ask a few questions after you sign up",
    });
    expect(rsvpQuestionsPage(parseRsvpBrandFormRead(raw))).toBeNull();
    expect(parseRsvpBrandFormPage(raw)).toBeNull();
    expect(parseRsvpBrandFormRead({ ...raw, formId: "nope" })).toBeNull();
  });

  test("the RSVP service passes the server's hand-off through (null when absent)", () => {
    const src = fs.readFileSync(path.join(ROOT, "mingla-business/src/services/rsvpEvents.ts"), "utf8");
    expect(src).toMatch(/brandFormHandoff:\s*\{\s*formId: string; token: string \}\s*\|\s*null/);
    expect(src).toMatch(/brandFormHandoff:\s*\n?\s*typeof handoff\?\.formId === "string"/);
    const page = fs.readFileSync(path.join(ROOT, "mingla-business/src/components/event/PublicEventPage.tsx"), "utf8");
    expect(page).toMatch(/formHandoff=\{rsvpFormHandoffNode\}/);
    expect(page).toMatch(/result\.approvalStatus === "approved"/);
  });

  test("pre-minted: the strip, Answer now opens the personal link without minting, then the block goes", () => {
    const opened: string[] = [];
    const g = globalThis as { open?: (url: string, target?: string, features?: string) => unknown };
    const prevOpen = g.open;
    g.open = (url: string) => {
      opened.push(url);
      return {};
    };
    let r: { root: Node; toJSON: () => unknown; unmount: () => void } | null = null;
    act(() => {
      r = create(<PurchaseFormHandoff handoff={{ formId: FORM, token: "tok_abc" }} strip="rsvp" brandName="Sundown" />);
    });
    const tree = r as unknown as { root: Node; toJSON: () => unknown; unmount: () => void };
    const strip = tree.root.findAll((n) => n.type === "Text" && n.props.children === "You're in. One more thing from Sundown.");
    expect(strip).toHaveLength(1);
    const answer = tree.root.findAll((n) => n.type === "Button" && n.props.testID === "rsvp-form-handoff-answer")[0];
    const later = tree.root.findAll((n) => n.type === "Button" && n.props.testID === "rsvp-form-handoff-later")[0];
    expect(answer?.props.label).toBe("Answer now");
    expect(later?.props.label).toBe("Later");
    act(() => answer?.props.onPress());
    expect(opened).toEqual([`/form/${FORM}#t=tok_abc`]);
    expect(invoke).not.toHaveBeenCalled();
    expect(tree.toJSON()).toBeNull();
    tree.unmount();
    g.open = prevOpen;
  });

  test("Later keeps the confirmation and removes the block", () => {
    let r: { root: Node; toJSON: () => unknown; unmount: () => void } | null = null;
    act(() => {
      r = create(<PurchaseFormHandoff handoff={{ formId: FORM, token: "t" }} strip="rsvp" brandName={null} />);
    });
    const tree = r as unknown as { root: Node; toJSON: () => unknown; unmount: () => void };
    expect(tree.root.findAll((n) => n.type === "Text" && n.props.children === "You're in. One more thing from the host.")).toHaveLength(1);
    const later = tree.root.findAll((n) => n.type === "Button" && n.props.testID === "rsvp-form-handoff-later")[0];
    act(() => later?.props.onPress());
    expect(tree.toJSON()).toBeNull();
    tree.unmount();
  });

  test("A3: inside the success popup, Later also closes the popup (the popup's own close)", () => {
    const closed: string[] = [];
    let r: { root: Node; toJSON: () => unknown; unmount: () => void } | null = null;
    act(() => {
      r = create(
        <PurchaseFormHandoff
          handoff={{ formId: FORM, token: "t" }}
          strip="rsvp"
          brandName="Sundown"
          onClose={() => closed.push("popup")}
        />,
      );
    });
    const tree = r as unknown as { root: Node; toJSON: () => unknown; unmount: () => void };
    const later = tree.root.findAll((n) => n.type === "Button" && n.props.testID === "rsvp-form-handoff-later")[0];
    act(() => later?.props.onPress());
    expect(closed).toEqual(["popup"]);
    expect(tree.toJSON()).toBeNull();
    tree.unmount();
  });

  test("the token rides in the fragment, never a query string", () => {
    expect(formLinkPath(FORM, "a b")).toBe(`/form/${FORM}#t=a%20b`);
  });

  test("the trip confirm page hands off through the forms owner, like the ticket confirm page", () => {
    const trip = fs.readFileSync(path.join(ROOT, "mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx"), "utf8");
    expect(trip).toContain('import("../../../src/components/checkout/intake/formRenderingPrimitives")');
    expect(trip).toMatch(/<PurchaseFormHandoff\s+checkoutSessionId=\{result\.checkoutSessionId \?\? null\}/);
  });
});

describe("#4541 R1.1 answered for this event: read-only at checkout", () => {
  const base = { active: true, mode: "required_step", formId: FORM, versionId: VERSION, definition: DEF, brand: {} };

  test("answeredHere parses with the buyer's own answers; another event's answer is editable prefill", () => {
    const here = parseCheckoutForm({ ...base, answered: true, answeredHere: true, prefill: { answers: { q1: "veg" } } });
    expect(here?.answeredHere).toBe(true);
    const elsewhere = parseCheckoutForm({ ...base, answered: false, prefill: { answers: { q1: "veg" } } });
    expect(elsewhere?.answeredHere).toBe(false);
    expect(elsewhere?.prefill?.answers).toEqual({ q1: "veg" });
  });

  test("Continue is on with nothing typed; the rows show labels, not option ids", () => {
    const here = parseCheckoutForm({ ...base, answered: true, answeredHere: true, prefill: { answers: { q1: "veg" } } });
    expect(canContinueStep({ submitting: false, loading: false, form: here, missing: true })).toBe(true);
    expect(answeredHereRows(DEF, { q1: "veg" })).toEqual([{ id: "q1", label: "Diet", value: "Vegan" }]);
    expect(CHECKOUT_FORM_COPY.answeredHere).toBe("You've answered these. You can change them from your ticket.");
  });

  test("no answers are sent when answered here (the marker still is)", () => {
    const src = fs.readFileSync(path.join(ROOT, "mingla-business/src/components/checkout/intake/CheckoutQuestionsStep.tsx"), "utf8");
    expect(src).toMatch(/form\.versionId !== null && !form\.answeredHere/);
  });
});
