/**
 * #4541 R4.2 / R4.3 / R4.10 (SC-30 UI, SC-31 UI) — "+ Form" in the Blast composer.
 *
 *   - "+ Form" sits in the email toolbar after "+ Event" and under the SMS and
 *     push bodies; each is a static button that only calls back.
 *   - The picker lists the brand's forms: live ones can be picked; closed and
 *     draft ones say why they cannot be sent; no forms: "No forms yet…".
 *   - The block: "Answer: {form}" for email, the text line, "Opens the form in
 *     the Mingla app" for push, the own-link and Unknown hint with the
 *     name-question tip, Remove, a warning when the form is not live, and the
 *     scheduled note.
 *   - The payload carries `embedded_form: {form_id}`; the contract accepts it
 *     and refuses a malformed one; the SMS estimate counts the form line at its
 *     real length; the confirm refusals read in plain words; a scheduled Blast
 *     whose form closed reads "Not sent: form closed".
 *
 * FAILS-ON-REVERT: dropping the "+ Form" buttons, the picker's disabled rows,
 * the block's lines, the `embedded_form` payload spread or contract check, the
 * SMS appended text, or the form_closed card line turns a named case RED.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findAll: (p: (n: Node) => boolean) => Node[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { root: Node; unmount: () => void };
  act: (cb: () => void) => void;
};

type Item = import("../../../services/brandFormsService").BrandFormListItem;
let pickerData: Item[] | undefined;

jest.mock("../../../hooks/useBrandForms", () => ({
  useBlastFormPicker: () => ({ data: pickerData, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
}));
jest.mock("../useFormsToast", () => ({ errorSentence: (_e: unknown, f: string) => f }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/BrandSwitch", () => ({ BrandSwitch: () => null }));
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Button: (props: Record<string, unknown>) => R.createElement("Button", props) };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return { Sheet: ({ children }: { children?: React.ReactNode }) => R.createElement("Sheet", null, children) };
});
jest.mock("../../ui/SheetScrollLayout", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    SheetScrollLayout: ({ children, footer }: { children?: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement("Layout", null, children, footer),
  };
});

import { BlastFormPicker, pickerRow } from "../BlastFormPicker";
import { BlastFormBlock } from "../BlastFormBlock";
import { InsertionBar } from "../../marketing/ComposerV2/InsertionBar";
import { SmsComposeCard } from "../../marketing/SmsComposeCard";
import { PushComposeCard } from "../../marketing/PushComposeCard";
import { campaignPayloadIssues } from "../../../services/marketing/campaignPayloadContract";
import { siblingErrorMessage } from "../../../services/marketing/campaignChannelGroupService";
import {
  BLAST_FORM_SAMPLE_URL,
  BLAST_FORM_SMS_LINE,
  blastFormErrorCopy,
} from "../../../utils/marketing/blastFormLink";
import { embeddedFormIdOf } from "../../../utils/marketing/blastFormPayload";

const FORM = "45410000-0000-4000-8000-000000000004";
const item = (id: string, name: string, status: "live" | "closed" | "draft", questions = 3): Item => ({
  form: { id, brandId: "b1", name, status } as Item["form"],
  questionCount: questions,
  version: status === "draft" ? null : 1,
  attachments: [],
});

const texts = (root: Node): string[] =>
  root.findAll((n) => n.type === "Text").map((n) =>
    React.Children.toArray(n.props.children as React.ReactNode).filter((c) => typeof c === "string").join(""),
  );
const mount = (el: React.ReactElement): { root: Node; unmount: () => void } => {
  let r: { root: Node; unmount: () => void } | null = null;
  act(() => {
    r = create(el);
  });
  if (r === null) throw new Error("not mounted");
  return r;
};
const byTestID = (root: Node, id: string): Node | undefined =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];

beforeEach(() => {
  pickerData = undefined;
});

describe("#4541 R4.2 the '+ Form' buttons", () => {
  test("the email toolbar: '+ Form' after '+ Event', only when the composer offers it", () => {
    const base = {
      state: "closed" as const, onStateChange: jest.fn(), events: [], onInsertEvent: jest.fn(), onInsertPersonalization: jest.fn(),
      onOpenLink: jest.fn(), onInsertDivider: jest.fn(), onInsertImage: jest.fn(), onOpenTemplateDrawer: jest.fn(),
      onToggleBold: jest.fn(), onToggleItalic: jest.fn(), onToggleUnderline: jest.fn(), onToggleLink: jest.fn(),
    };
    const onAddForm = jest.fn();
    const r = mount(<InsertionBar {...base} onAddForm={onAddForm} />);
    const ids = r.root.findAll((n) => typeof n.props.testID === "string" && typeof n.props.onPress === "function").map((n) => n.props.testID as string);
    const unique = ids.filter((x, i) => ids.indexOf(x) === i);
    expect(unique.indexOf("composer-v2-pill-form")).toBe(unique.indexOf("composer-v2-pill-event") + 1);
    act(() => byTestID(r.root, "composer-v2-pill-form")?.props.onPress());
    expect(onAddForm).toHaveBeenCalledTimes(1);
    r.unmount();
    const none = mount(<InsertionBar {...base} />);
    expect(byTestID(none.root, "composer-v2-pill-form")).toBeUndefined();
    none.unmount();
  });

  test("text and push cards: '+ Form' under the body; the text estimate counts the form line", () => {
    const onAddForm = jest.fn();
    const sms = mount(
      <SmsComposeCard value="Open mic Sat" onChangeText={jest.fn()} reachableSms={10} currencyCode="USD" onAddForm={onAddForm} appendedText={BLAST_FORM_SMS_LINE} />,
    );
    act(() => byTestID(sms.root, "sms-add-form")?.props.onPress());
    expect(onAddForm).toHaveBeenCalledTimes(1);
    const hint = sms.root.findAll((n) => n.props.accessibilityLabel === "SMS message body")[0]?.props.accessibilityHint as string;
    const plain = mount(<SmsComposeCard value="Open mic Sat" onChangeText={jest.fn()} reachableSms={10} currencyCode="USD" />);
    const plainHint = plain.root.findAll((n) => n.props.accessibilityLabel === "SMS message body")[0]?.props.accessibilityHint as string;
    const chars = (h: string): number => Number(/^(\d+) characters/.exec(h)?.[1] ?? "0");
    expect(chars(hint) - chars(plainHint)).toBe(BLAST_FORM_SMS_LINE.length);
    sms.unmount();
    plain.unmount();
    const push = mount(<PushComposeCard body="Doors at 9" onChangeBody={jest.fn()} brandName="Harmattan" reason="follower" onAddForm={onAddForm} />);
    act(() => byTestID(push.root, "push-add-form")?.props.onPress());
    expect(onAddForm).toHaveBeenCalledTimes(2);
    push.unmount();
  });

  test("the form line is the real personal link's length (the server's quote measures the same)", () => {
    expect(BLAST_FORM_SAMPLE_URL).toBe(
      "https://host.usemingla.com/form/00000000-0000-4000-8000-000000000000?c=00000000-0000-4000-8000-000000000000#t=" + "0".repeat(64),
    );
    expect(BLAST_FORM_SMS_LINE).toBe(` Answer: ${BLAST_FORM_SAMPLE_URL}`);
  });
});

describe("#4541 R4.2 the picker", () => {
  test("live forms can be picked; closed and draft forms say why not", () => {
    pickerData = [item(FORM, "Open mic sign-up", "live"), item("f2", "Guest details", "closed"), item("f3", "VIP survey", "draft")];
    const onPick = jest.fn();
    const r = mount(<BlastFormPicker visible brandId="b1" onClose={jest.fn()} onPick={onPick} />);
    const t = texts(r.root);
    expect(t).toEqual(expect.arrayContaining([
      "Add a form", "Only live forms of this brand can be sent.", "Live · 3 questions",
      "Closed. Reopen it in Forms to send it again.", "Draft. Publish it in Forms before you can send it.",
    ]));
    const closed = r.root.findAll((n) => n.props.testID === "blast-form-picker-f2" && n.props.disabled === true);
    expect(closed.length).toBeGreaterThan(0);
    act(() => byTestID(r.root, `blast-form-picker-${FORM}`)?.props.onPress());
    expect(onPick).toHaveBeenCalledWith({ formId: FORM, name: "Open mic sign-up" });
    expect(pickerRow(item("f3", "x", "draft")).selectable).toBe(false);
    r.unmount();
  });

  test("no forms: where to make one", () => {
    pickerData = [];
    const r = mount(<BlastFormPicker visible brandId="b1" onClose={jest.fn()} onPick={jest.fn()} />);
    expect(texts(r.root)).toContain("No forms yet. Make one in Promote › Forms.");
    r.unmount();
  });
});

describe("#4541 R4.2 / R4.3 the block", () => {
  test("a line per channel, the hint, Remove; no warning for a live form", () => {
    pickerData = [item(FORM, "Open mic sign-up", "live")];
    const onRemove = jest.fn();
    const r = mount(
      <BlastFormBlock brandId="b1" formId={FORM} formName={null} channels={{ email: true, sms: true, push: true }} scheduled={false} onRemove={onRemove} />,
    );
    const t = texts(r.root);
    expect(t).toEqual(expect.arrayContaining([
      "Answer: Open mic sign-up",
      "Text adds: Answer: [their own link]",
      "Opens the form in the Mingla app",
      "Each person gets their own link. Replies from people we can't identify show as Unknown. Add a name question if you need to know who answered.",
    ]));
    expect(t).not.toContain("This form isn't live. Publish or reopen it in Forms.");
    act(() => byTestID(r.root, "blast-form-remove")?.props.onPress());
    expect(onRemove).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  test("a closed form warns; a scheduled Blast says what happens if the form closes first", () => {
    pickerData = [item(FORM, "Open mic sign-up", "closed")];
    const closed = mount(
      <BlastFormBlock brandId="b1" formId={FORM} formName="Open mic sign-up" channels={{ email: true, sms: false, push: false }} scheduled onRemove={jest.fn()} />,
    );
    expect(texts(closed.root)).toContain("This form isn't live. Publish or reopen it in Forms.");
    closed.unmount();
    pickerData = [item(FORM, "Open mic sign-up", "live")];
    const sched = mount(
      <BlastFormBlock brandId="b1" formId={FORM} formName={null} channels={{ email: false, sms: true, push: false }} scheduled onRemove={jest.fn()} />,
    );
    expect(texts(sched.root)).toContain("If the form closes before the send time, this Blast isn't sent.");
    sched.unmount();
  });
});

describe("#4541 R4.2 / R4.3 payload, refusals and the campaign card", () => {
  test("embedded_form is part of every channel's payload contract", () => {
    expect(campaignPayloadIssues({ kind: "push", body: "Hi", embedded_form: { form_id: FORM } })).toEqual([]);
    expect(campaignPayloadIssues({ kind: "sms", body: "Hi", embedded_form: { form_id: FORM } })).toEqual([]);
    expect(campaignPayloadIssues({ kind: "email", subject: "s", body_html: "<p>b</p>", embedded_form: { form_id: FORM } })).toEqual([]);
    expect(campaignPayloadIssues({ kind: "sms", body: "Hi", embedded_form: { form_id: "nope" } }))
      .toEqual(["`embedded_form` must name one form by its id."]);
    expect(embeddedFormIdOf({ kind: "sms", embedded_form: { form_id: FORM.toUpperCase() } })).toBe(FORM);
    expect(embeddedFormIdOf({ kind: "sms" })).toBeNull();
  });

  test("the confirm refusals read in plain words", () => {
    expect(blastFormErrorCopy("embedded_form_not_live")).toBe("This form isn't live. Publish or reopen it in Forms.");
    expect(blastFormErrorCopy("embedded_form_other_brand")).toBe("That form belongs to another brand.");
    expect(siblingErrorMessage("sms", new Error("embedded_form_not_live"))).toBe("SMS: This form isn't live. Publish or reopen it in Forms.");
  });

  test("the composer puts the form on every payload and reopens a draft with it; the card names a closed-form hold", () => {
    const root = path.resolve(__dirname, "../../../..");
    const compose = fs.readFileSync(path.join(root, "app/(tabs)/marketing/campaigns/compose.tsx"), "utf8");
    expect(compose.match(/\.\.\.form,/g)?.length).toBe(3);
    expect(compose).toContain("embedded_form: { form_id: embeddedForm.formId }");
    expect(compose).toContain("embeddedFormIdOf(storedPayload)");
    const card = fs.readFileSync(path.join(root, "src/components/marketing/CampaignCard.tsx"), "utf8");
    expect(card).toContain('row.failure_reason === "form_closed"');
    expect(card).toContain("Not sent: form closed");
  });
});
