import React from "react";
import { Text, View } from "react-native";
import { jest } from "@jest/globals";

jest.mock("../Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));
jest.mock("../Icon", () => ({
  Icon: () => React.createElement("MockIcon"),
}));

// Jest requires dependency mocks before the component import.
// eslint-disable-next-line import/first
import { RetryableLazyErrorBoundary } from "../RetryableLazyBoundary";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const deferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const textOf = (json: any): string => {
  if (typeof json === "string") return json;
  if (Array.isArray(json)) return json.map(textOf).join(" ");
  if (json !== null && typeof json === "object") return textOf(json.children ?? []);
  return "";
};

describe("#2395 tester — retryable deferred interaction runtime", () => {
  test("a rejected lazy chunk retries with a fresh loader and preserves host-owned draft state", async () => {
    const first = deferred<{ default: React.ComponentType<{ label: string }> }>();
    const second = deferred<{ default: React.ComponentType<{ label: string }> }>();
    const loader = jest
      .fn<() => Promise<{ default: React.ComponentType<{ label: string }> }>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    let setDraft!: React.Dispatch<React.SetStateAction<string>>;

    const Loaded = ({ label }: { label: string }): React.ReactElement => <Text>{label}</Text>;
    const Host = (): React.ReactElement => {
      const [draft, updateDraft] = React.useState("original selection");
      setDraft = updateDraft;
      return (
        <View>
          <Text>{draft}</Text>
          <RetryableLazyErrorBoundary
            loader={loader}
            loadingLabel="Opening group members…"
            componentProps={{ label: "members ready" }}
          />
        </View>
      );
    };

    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    let tree: any;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<Host />);
    });
    expect(textOf(tree.toJSON())).toContain("Opening group members…");
    expect(loader).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      first.reject(new Error("chunk unavailable"));
      await first.promise.catch(() => undefined);
    });
    expect(textOf(tree.toJSON())).toMatch(/Something broke\..*We're on it\./);

    TestRenderer.act(() => setDraft("edited selection"));
    const retry = tree.root
      .findAllByType("MockButton")
      .find((node: any) => node.props.label === "Try again");
    expect(retry).toBeDefined();
    await TestRenderer.act(async () => {
      retry.props.onPress();
    });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(textOf(tree.toJSON())).toContain("Opening group members…");

    await TestRenderer.act(async () => {
      second.resolve({ default: Loaded });
      await second.promise;
    });
    const output = textOf(tree.toJSON());
    expect(output).toContain("edited selection");
    expect(output).toContain("members ready");
    expect(output).not.toContain("Something broke.");
    consoleError.mockRestore();
  });
});
