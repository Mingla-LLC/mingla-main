import React from "react";
import { TextInput, View } from "react-native";

import {
  AriRenditionCard,
  buildAriRenditionExample,
  type AriRenditionInteraction,
} from "../renditions/AriRenditionPreview";
import { ARI_RENDITION_FIXTURES } from "../renditions/ariRenditionCatalog";
import {
  ARI_RENDITION_BLOCK_TYPES,
  parseAriRendition,
} from "../renditions/ariRenditionProtocol";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type JsonNode = { children?: (string | JsonNode)[] };
type RenderNode = {
  props: Record<string, unknown>;
  type: unknown;
};
type Renderer = {
  toJSON: () => JsonNode | JsonNode[] | null;
  root: {
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
    findByType: (type: unknown) => RenderNode;
  };
  unmount: () => void;
};

// The repository intentionally omits declarations for this deprecated test-only renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactNative = require("react-native") as { View: typeof View };
  const identity = <T,>(value: T): T => value;
  return {
    __esModule: true,
    default: { View: ReactNative.View },
    Easing: {
      ease: identity,
      cubic: identity,
      inOut: identity,
      out: identity,
    },
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (factory: () => object): object => factory(),
    useReducedMotion: (): boolean => true,
    useSharedValue: <T,>(value: T): { value: T } => ({ value }),
    withRepeat: identity,
    withSpring: identity,
    withTiming: identity,
  };
});

jest.mock("../AriOrb", () => ({
  AriOrb: (): React.ReactElement => <View testID="ari-orb" />,
}));

// The shared Button owns native haptics and motion. This suite exercises the
// rendition contract, so keep the same public press/accessibility surface
// without importing Expo's native haptics module into the renderer harness.
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react") as typeof React;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactNative = require("react-native") as typeof import("react-native");
  return {
    Button: ({
      label,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }): React.ReactElement =>
      ReactModule.createElement(
        ReactNative.Pressable,
        {
          onPress,
          disabled,
          accessibilityRole: "button",
          accessibilityLabel,
        },
        label,
      ),
  };
});

// Rendition graphics use the platform gradient primitive; the action controls
// deliberately do not. This keeps the renderer test focused on interaction.
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({
    children,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    accessibilityLabel?: string;
  }): React.ReactElement => (
    <View accessibilityLabel={accessibilityLabel}>{children}</View>
  ),
}));

const allText = (node: JsonNode | JsonNode[] | null): string => {
  if (node === null) return "";
  if (Array.isArray(node)) return node.map(allText).join(" ");
  return (node.children ?? [])
    .map((child: string | JsonNode) =>
      typeof child === "string" ? child : allText(child),
    )
    .join(" ");
};

describe("#3355 Ari production rendition runtime", () => {
  const consoleError = console.error;

  beforeAll(() => {
    jest
      .spyOn(console, "error")
      .mockImplementation((message: unknown, ...details: unknown[]) => {
        if (
          typeof message === "string" &&
          message.includes("react-test-renderer is deprecated")
        )
          return;
        consoleError(message, ...details);
      });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("round-trips and renders all 65 server-shaped payloads", () => {
    for (const fixture of ARI_RENDITION_FIXTURES) {
      const example = buildAriRenditionExample(fixture);
      const parsed = parseAriRendition(example.rendition);
      expect(parsed).toEqual(example.rendition);

      let renderer: Renderer;
      act(() => {
        renderer = create(<AriRenditionCard rendition={parsed!} />);
      });
      const labelled = renderer!.root.findAll(
        (node) =>
          typeof node.props.accessibilityLabel === "string" &&
          node.props.accessibilityLabel.includes(parsed!.title),
      );
      expect(labelled.length).toBeGreaterThan(0);
      act(() => renderer!.unmount());
    }
  });

  it("covers every premium lifecycle state", () => {
    const states = new Set(
      ARI_RENDITION_FIXTURES.map(
        (fixture) => buildAriRenditionExample(fixture).rendition.state,
      ),
    );
    expect(states).toEqual(
      new Set([
        "loading",
        "transitioning",
        "ready",
        "submitted",
        "error",
        "disabled",
      ]),
    );
  });

  it("renders cited research evidence without an unsupported success claim", () => {
    const source = ARI_RENDITION_FIXTURES.find(
      (fixture) => fixture.id === "research-source",
    );
    expect(source).toBeDefined();
    const rendition = buildAriRenditionExample(source!).rendition;
    let renderer: Renderer;
    act(() => {
      renderer = create(<AriRenditionCard rendition={rendition} />);
    });
    const text = allText(renderer!.toJSON());
    expect(text).toContain("Publisher");
    expect(text).toContain("Accessed");
    expect(text).toContain("Evidence");
    expect(text).toContain("Ari is assembling verified details");
    act(() => renderer!.unmount());
  });

  it("fails closed for unknown versions and unsafe action targets", () => {
    const safe = buildAriRenditionExample(ARI_RENDITION_FIXTURES[0]).rendition;
    expect(parseAriRendition({ ...safe, schema_version: 3 })).toBeNull();
    expect(
      parseAriRendition({
        ...safe,
        actions: [
          {
            id: "unsafe-route",
            label: "Leave",
            style: "primary",
            behavior: { type: "route", route: "//attacker.example" },
          },
        ],
      })?.actions,
    ).toBeUndefined();
    expect(
      parseAriRendition({
        ...safe,
        actions: [
          {
            id: "unsafe-link",
            label: "Open",
            style: "primary",
            behavior: { type: "external", url: "http://attacker.example" },
          },
        ],
      })?.actions,
    ).toBeUndefined();
  });

  it("keeps schema v1 messages compatible while v2 skips unknown display blocks", () => {
    expect(
      parseAriRendition({
        schema_version: 1,
        rendition_id: "legacy:proposal",
        kind: "legacy-proposal",
        title: "Legacy proposal",
        body: "Older app payloads still render safely.",
        rows: [{ label: "Status", value: "Ready" }],
        actions: [
          {
            id: "continue",
            label: "Continue",
            style: "primary",
            behavior: { type: "reply", message: "Continue" },
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        schema_version: 1,
        rendition_id: "legacy:proposal",
        kind: "legacy-proposal",
      }),
    );

    const safe = buildAriRenditionExample(ARI_RENDITION_FIXTURES[0]).rendition;
    const withFutureBlock = {
      ...safe,
      blocks: [
        ...safe.blocks,
        {
          type: "future_visual",
          version: 1,
          id: "future-block",
          payload: "ignored",
        },
      ],
    };
    const parsed = parseAriRendition(withFutureBlock);
    expect(parsed?.schema_version).toBe(2);
    if (!parsed || parsed.schema_version !== 2) throw new Error("v2 rendition missing");
    expect(parsed.blocks).toEqual(safe.blocks);
    expect(parsed.body).toBe(safe.body);
  });

  it("renders the complete generic block vocabulary without fixture allowlisting", () => {
    const renderedTypes = new Set(
      ARI_RENDITION_FIXTURES.flatMap((fixture) =>
        buildAriRenditionExample(fixture).rendition.blocks.map((block) => block.type)),
    );
    expect(renderedTypes).toEqual(new Set(ARI_RENDITION_BLOCK_TYPES));

    const future = buildAriRenditionExample(ARI_RENDITION_FIXTURES[0]).rendition;
    expect(parseAriRendition({
      ...future,
      rendition_id: "server:future-capability-2040",
      kind: "future-capability",
    })).not.toBeNull();
  });

  it("keeps typed destructive confirmation locked until the exact phrase", () => {
    const fixture = ARI_RENDITION_FIXTURES.find(
      (item) => item.id === "high-risk",
    )!;
    const rendition = buildAriRenditionExample(fixture).rendition;
    const inputIndex = rendition.blocks.findIndex((block) => block.type === "input");
    const inputBlock = rendition.blocks[inputIndex];
    expect(inputBlock?.type).toBe("input");
    if (!inputBlock || inputBlock.type !== "input") throw new Error("input block missing");
    const field = { ...inputBlock.field, value: "" };
    const confirmationPhrase = field.confirmationPhrase!;
    const interactiveRendition = {
      ...rendition,
      blocks: rendition.blocks.map((block, index) =>
        index === inputIndex ? { ...inputBlock, field } : block),
    };
    const interactions: AriRenditionInteraction[] = [];
    let renderer: Renderer;
    act(() => {
      renderer = create(
        <AriRenditionCard
          rendition={interactiveRendition}
          onAction={(interaction) => interactions.push(interaction)}
        />,
      );
    });
    const primary = (): RenderNode =>
      renderer!.root.findAll(
        (node) =>
          node.props.accessibilityRole === "button" &&
          node.props.accessibilityLabel === rendition.actions?.[0].label,
      )[0];
    expect(primary().props.disabled).toBe(true);

    act(() => {
      (
        renderer!.root.findByType(TextInput).props.onChangeText as (
          value: string,
        ) => void
      )(confirmationPhrase);
    });
    expect(primary().props.disabled).toBe(false);
    act(() => {
      (primary().props.onPress as () => void)();
    });
    expect(interactions).toHaveLength(1);
    expect(interactions[0].fieldValue).toBe(confirmationPhrase);
    act(() => renderer!.unmount());
  });
});
