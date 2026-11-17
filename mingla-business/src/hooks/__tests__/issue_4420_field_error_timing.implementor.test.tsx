/**
 * #4420 — buyer form validation timing (Constitution 12), as behaviour.
 *
 * Drives a form built from the same pieces the checkout buyer steps use
 * (`useRevealedFieldErrors` + `FieldErrorLine`): types character by character,
 * blurs, taps Continue, and reads what a guest would see.
 */
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { FieldErrorLine } from "../../components/checkout/FieldErrorLine";
import { useRevealedFieldErrors } from "../useRevealedFieldErrors";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderNode {
  props: Record<string, unknown> & {
    testID?: string;
    children?: unknown;
    onChangeText?: (next: string) => void;
    onBlur?: () => void;
    onPress?: () => void;
  };
  findAll: (
    predicate: (node: RenderNode) => boolean,
    options?: { deep: boolean },
  ) => RenderNode[];
}

interface RenderTree {
  root: RenderNode;
  unmount: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

const EMAIL_ERROR = "Enter a valid email";
const PHONE_ERROR = "Enter a valid mobile number";

function BuyerForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const emailInvalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneInvalid = phone.replace(/\D/g, "").length < 10;
  const { shows, blur, revealAll } = useRevealedFieldErrors({
    email: emailInvalid,
    phone: phoneInvalid,
  });
  return (
    <View>
      <TextInput
        testID="email"
        value={email}
        onChangeText={setEmail}
        onBlur={() => blur("email")}
      />
      <FieldErrorLine
        testID="email-error"
        message={shows("email") ? EMAIL_ERROR : null}
      />
      <TextInput
        testID="phone"
        value={phone}
        onChangeText={setPhone}
        onBlur={() => blur("phone")}
      />
      <FieldErrorLine
        testID="phone-error"
        message={shows("phone") ? PHONE_ERROR : null}
      />
      <Pressable testID="continue" onPress={revealAll}>
        <Text>Continue</Text>
      </Pressable>
    </View>
  );
}

function byId(tree: RenderTree, id: string): RenderNode {
  const node = tree.root.findAll((n) => n.props.testID === id, {
    deep: true,
  })[0];
  if (node === undefined) throw new Error(`missing ${id}`);
  return node;
}

/** The text the guest reads on the error line (the rendered Text's children). */
function errorText(tree: RenderTree, id: string): string {
  const rendered = tree.root.findAll(
    (n) => n.props.testID === id && typeof n.props.children === "string",
    { deep: true },
  )[0];
  if (rendered === undefined) throw new Error(`no rendered line for ${id}`);
  return String(rendered.props.children);
}

async function mount(): Promise<RenderTree> {
  let tree!: RenderTree;
  await act(async () => {
    tree = TestRenderer.create(<BuyerForm />);
  });
  return tree;
}

async function typeSlowly(
  tree: RenderTree,
  id: string,
  text: string,
  onEachChar?: () => void,
): Promise<void> {
  let value = String(byId(tree, id).props.value ?? "");
  for (const char of text) {
    value += char;
    await act(async () => {
      byId(tree, id).props.onChangeText?.(value);
    });
    onEachChar?.();
  }
}

async function blur(tree: RenderTree, id: string): Promise<void> {
  await act(async () => {
    byId(tree, id).props.onBlur?.();
  });
}

describe("#4420 checkout buyer validation timing", () => {
  test("stays quiet for every keystroke of an unfinished email and phone", async () => {
    const tree = await mount();
    await typeSlowly(tree, "email", "seth@exam", () => {
      expect(errorText(tree, "email-error")).toBe("");
    });
    await typeSlowly(tree, "phone", "07700", () => {
      expect(errorText(tree, "phone-error")).toBe("");
    });
    tree.unmount();
  });

  test("the error line is always mounted, so nothing below it jumps", async () => {
    const tree = await mount();
    expect(byId(tree, "email-error")).toBeDefined();
    await typeSlowly(tree, "email", "x");
    await blur(tree, "email");
    expect(errorText(tree, "email-error")).toBe(EMAIL_ERROR);
    expect(byId(tree, "email-error")).toBeDefined();
    tree.unmount();
  });

  test("shows the error after the field is blurred while invalid", async () => {
    const tree = await mount();
    await typeSlowly(tree, "email", "seth@exam");
    await blur(tree, "email");
    expect(errorText(tree, "email-error")).toBe(EMAIL_ERROR);
    // Blurring the email never reveals the untouched phone field.
    expect(errorText(tree, "phone-error")).toBe("");
    tree.unmount();
  });

  test("Continue reveals every invalid field at once", async () => {
    const tree = await mount();
    await act(async () => {
      byId(tree, "continue").props.onPress?.();
    });
    expect(errorText(tree, "email-error")).toBe(EMAIL_ERROR);
    expect(errorText(tree, "phone-error")).toBe(PHONE_ERROR);
    tree.unmount();
  });

  test("a showing error clears live the moment the value becomes valid", async () => {
    const tree = await mount();
    await typeSlowly(tree, "phone", "0770090");
    await blur(tree, "phone");
    expect(errorText(tree, "phone-error")).toBe(PHONE_ERROR);
    await typeSlowly(tree, "phone", "00");
    expect(errorText(tree, "phone-error")).toBe(PHONE_ERROR);
    await typeSlowly(tree, "phone", "0");
    expect(errorText(tree, "phone-error")).toBe("");
    tree.unmount();
  });

  test("after clearing, the next mistake waits for the next blur", async () => {
    const tree = await mount();
    await typeSlowly(tree, "email", "a@b");
    await blur(tree, "email");
    expect(errorText(tree, "email-error")).toBe(EMAIL_ERROR);
    await typeSlowly(tree, "email", ".co");
    expect(errorText(tree, "email-error")).toBe("");
    // Deleting back to invalid while typing stays quiet...
    await act(async () => {
      byId(tree, "email").props.onChangeText?.("a@b.");
    });
    expect(errorText(tree, "email-error")).toBe("");
    // ...until the guest leaves the field.
    await blur(tree, "email");
    expect(errorText(tree, "email-error")).toBe(EMAIL_ERROR);
    tree.unmount();
  });

  test("a valid field blurred stays quiet", async () => {
    const tree = await mount();
    await typeSlowly(tree, "email", "seth@example.com");
    await blur(tree, "email");
    expect(errorText(tree, "email-error")).toBe("");
    tree.unmount();
  });
});
