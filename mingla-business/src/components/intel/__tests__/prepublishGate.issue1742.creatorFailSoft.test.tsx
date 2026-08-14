import React from "react";
import fs from "node:fs";
import path from "node:path";
import { Pressable, Text, View } from "react-native";

import { createDeferredTurnoutIntelProvider } from "../createDeferredTurnoutIntelProvider";
import type { TurnoutIntelContextValue } from "../TurnoutIntelContext";

type TestInstance = {
  props: Record<string, unknown>;
  findByProps: (props: Record<string, unknown>) => TestInstance;
};
type TestTree = { root: TestInstance; unmount: () => void };
// react-test-renderer has no declaration in this workspace's test dependency set.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => TestTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = TestRenderer;
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RuntimeProps = { wizard: "event" | "rsvp" | "experience" };
type RuntimeModule = {
  default: React.ComponentType<
    RuntimeProps & {
      onValue: (value: TurnoutIntelContextValue | null) => void;
    }
  >;
};

const CreatorControls = ({
  wizard,
  onSave,
  onPublish,
}: RuntimeProps & { onSave: () => void; onPublish: () => void }) => (
  <View accessibilityLabel={`${wizard} creator`}>
    <Pressable accessibilityLabel={`${wizard} Save draft`} onPress={onSave}>
      <Text>Save draft</Text>
    </Pressable>
    <Pressable accessibilityLabel={`${wizard} Publish`} onPress={onPublish}>
      <Text>Publish</Text>
    </Pressable>
  </View>
);

const assertControlsRemainActionable = (
  tree: TestTree,
  wizard: RuntimeProps["wizard"],
  actions: { saves: number; publishes: number },
) => {
  const save = tree.root.findByProps({
    accessibilityLabel: `${wizard} Save draft`,
  });
  const publish = tree.root.findByProps({
    accessibilityLabel: `${wizard} Publish`,
  });
  act(() => (save.props.onPress as () => void)());
  act(() => (publish.props.onPress as () => void)());
  expect(actions).toEqual({ saves: 1, publishes: 1 });
};

describe("#1742 creator intelligence fails soft", () => {
  it("routes all three real creators through the pass-through boundary", () => {
    const root = path.resolve(__dirname, "../../../..");
    for (const relative of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
    ]) {
      const source = fs.readFileSync(path.join(root, relative), "utf8");
      expect(source).toContain("createDeferredTurnoutIntelProvider");
      expect(source).toContain("default: module.TurnoutIntelRuntime");
      expect(source).not.toMatch(
        /return\s*\(\s*<React\.Suspense fallback=\{null\}>\s*<LazyTurnoutIntelProvider/,
      );
    }
  });

  it.each(["event", "rsvp", "experience"] as const)(
    "keeps %s Save and Publish mounted while the intelligence chunk is pending",
    (wizard) => {
      const never = new Promise<RuntimeModule>(() => undefined);
      const DeferredProvider = createDeferredTurnoutIntelProvider<RuntimeProps>(
        () => never,
      );
      const actions = { saves: 0, publishes: 0 };
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      let tree!: TestTree;

      act(() => {
        tree = TestRenderer.create(
          <DeferredProvider wizard={wizard}>
            <CreatorControls
              wizard={wizard}
              onSave={() => actions.saves++}
              onPublish={() => actions.publishes++}
            />
          </DeferredProvider>,
        );
      });

      assertControlsRemainActionable(tree, wizard, actions);
      act(() => tree.unmount());
      consoleError.mockRestore();
    },
  );

  it.each(["event", "rsvp", "experience"] as const)(
    "keeps %s Save and Publish mounted when the intelligence chunk rejects",
    async (wizard) => {
      const DeferredProvider = createDeferredTurnoutIntelProvider<RuntimeProps>(
        async () => {
          throw new Error("synthetic_intelligence_chunk_failure");
        },
      );
      const actions = { saves: 0, publishes: 0 };
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      let tree!: TestTree;

      await act(async () => {
        tree = TestRenderer.create(
          <DeferredProvider wizard={wizard}>
            <CreatorControls
              wizard={wizard}
              onSave={() => actions.saves++}
              onPublish={() => actions.publishes++}
            />
          </DeferredProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      assertControlsRemainActionable(tree, wizard, actions);
      expect(consoleError).toHaveBeenCalled();
      act(() => tree.unmount());
      consoleError.mockRestore();
    },
  );
});
