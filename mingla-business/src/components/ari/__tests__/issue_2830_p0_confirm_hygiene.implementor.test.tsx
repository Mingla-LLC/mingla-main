/**
 * #2830 P0 — Ari confirm and kickoff hygiene (implementor happy paths).
 *
 * 1. An expired Ari approval is an explicit, owner-visible expiry — never the
 *    success path (D-3). Both the new 409 PROPOSAL_EXPIRED and an older
 *    server's 200 `expired_regenerate` are recognised.
 * 2. Only the newest answerable rendition card in a thread accepts taps;
 *    earlier ones render "Answered" with no answer buttons (D-4 interim).
 * 3. The automatic Website setup kickoff is claimed once per brand + part per
 *    session at module scope, so a remount cannot re-send it (D-1 interim).
 */
import * as fs from "fs";
import * as path from "path";
import React from "react";
import { View } from "react-native";

import {
  AriRenditionCard,
  buildAriRenditionExample,
  type AriRenditionInteraction,
} from "../renditions/AriRenditionPreview";
import { ARI_RENDITION_FIXTURES } from "../renditions/ariRenditionCatalog";
import {
  isAnswerableAriRendition,
  isSupersededRenditionTapAllowed,
  newestAnswerableRenditionKey,
  type AriRendition,
} from "../renditions/ariRenditionProtocol";
import { isAriProposalExpired } from "../../../screens/ari/ariProposalExpiry";
import {
  ARI_PROPOSAL_EXPIRED_COPY,
  ariChatErrorCopy,
} from "../../../screens/ari/ariChatErrorCopy";
import {
  claimWebsiteSetupAutoAudit,
  resetWebsiteSetupAutoAuditsForTests,
  websiteSetupAutoAuditKey,
} from "../../../screens/ari/websiteSetupAutoAudit";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type JsonNode = { children?: (string | JsonNode)[] };
type RenderNode = { props: Record<string, unknown>; type: unknown };
type Renderer = {
  toJSON: () => JsonNode | JsonNode[] | null;
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  unmount: () => void;
};
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
    Easing: { ease: identity, cubic: identity, inOut: identity, out: identity },
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
        { onPress, disabled, accessibilityRole: "button", accessibilityLabel },
        label,
      ),
  };
});
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => (
    <View>{children}</View>
  ),
}));

const allText = (node: JsonNode | JsonNode[] | null): string => {
  if (node === null) return "";
  if (Array.isArray(node)) return node.map(allText).join(" ");
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : allText(child)))
    .join(" ");
};

const repoRoot = path.resolve(__dirname, "../../../../..");
const screen = fs.readFileSync(
  path.join(repoRoot, "mingla-business/src/screens/ari/AriChatScreen.tsx"),
  "utf8",
);

function answerableFixture(): AriRendition {
  for (const fixture of ARI_RENDITION_FIXTURES) {
    const rendition = buildAriRenditionExample(fixture).rendition;
    if (
      (rendition.state ?? "ready") === "ready" &&
      isAnswerableAriRendition(rendition)
    ) {
      return rendition;
    }
  }
  throw new Error("no answerable rendition fixture");
}

describe("#2830 P0 expired Ari approval is never a success", () => {
  it("recognises the typed 409 and an older server's expired_regenerate", () => {
    expect(
      isAriProposalExpired({
        kind: "error",
        code: "PROPOSAL_EXPIRED",
        message: ARI_PROPOSAL_EXPIRED_COPY,
      }),
    ).toBe(true);
    expect(isAriProposalExpired({ kind: "expired_regenerate" })).toBe(true);
    expect(isAriProposalExpired({ kind: "executed" })).toBe(false);
    expect(
      isAriProposalExpired({
        kind: "error",
        code: "CONFLICT",
        message: "Something changed.",
      }),
    ).toBe(false);
  });

  it("tells the owner nothing was saved, in the server's own words", () => {
    expect(ariChatErrorCopy("PROPOSAL_EXPIRED")).toBe(ARI_PROPOSAL_EXPIRED_COPY);
    expect(ARI_PROPOSAL_EXPIRED_COPY).toBe(
      "That approval timed out, so nothing was saved. Ask me again and I'll redo it.",
    );
    const edgeRegistry = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/_shared/agentReliability.ts"),
      "utf8",
    );
    expect(edgeRegistry).toContain(`"${ARI_PROPOSAL_EXPIRED_COPY}"`);
  });

  it("checks expiry before any success path in handleConfirm", () => {
    const start = screen.indexOf("const handleConfirm = async (");
    const end = screen.indexOf("const handleCancelProposal", start);
    const body = screen.slice(start, end);
    const expiry = body.indexOf("if (isAriProposalExpired(result))");
    const success = body.indexOf("return { ok: true, brandId }");
    expect(expiry).toBeGreaterThan(-1);
    expect(success).toBeGreaterThan(expiry);
    expect(body.slice(expiry, body.indexOf("}", expiry))).toContain(
      "ARI_PROPOSAL_EXPIRED_COPY",
    );
  });
});

describe("#2830 P0 only the newest answer card is live", () => {
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
  afterAll(() => jest.restoreAllMocks());

  it("picks the newest answerable rendition and skips non-answer cards", () => {
    const question = answerableFixture();
    const receipt: AriRendition = { ...question, state: "submitted" };
    expect(
      newestAnswerableRenditionKey([
        ["m1", question],
        ["m2", question],
        ["m3", receipt],
      ] as const),
    ).toBe("m2");
    expect(newestAnswerableRenditionKey([["m1", receipt]] as const)).toBeNull();
  });

  it("renders an older card as Answered with no answer buttons", () => {
    const rendition = answerableFixture();
    const onAction = jest.fn<void, [AriRenditionInteraction]>();
    let live: Renderer;
    act(() => {
      live = create(<AriRenditionCard rendition={rendition} onAction={onAction} />);
    });
    const liveButtons = live!.root.findAll(
      (node) => node.props.accessibilityRole === "button" && !!node.props.onPress,
    );
    expect(liveButtons.length).toBeGreaterThan(0);
    act(() => live!.unmount());

    let old: Renderer;
    act(() => {
      old = create(
        <AriRenditionCard rendition={rendition} superseded onAction={onAction} />,
      );
    });
    expect(allText(old!.toJSON())).toContain("Answered");
    const oldButtons = old!.root.findAll(
      (node) => node.props.accessibilityRole === "button" && !!node.props.onPress,
    );
    expect(oldButtons).toHaveLength(0);
    const host = old!.root.findAll(
      (node) => node.props.testID === "ari-rendition-superseded",
    );
    expect(host.length).toBeGreaterThan(0);
    expect(host[0].props.accessibilityState).toEqual({ disabled: true });
    expect(onAction).not.toHaveBeenCalled();
    act(() => old!.unmount());
  });

  it("drops answer taps from a superseded card even if one arrives", () => {
    const submit = answerableFixture().actions!.find(
      (a) => a.behavior.type !== "local" && a.behavior.type !== "route" &&
        a.behavior.type !== "external",
    )!;
    expect(isSupersededRenditionTapAllowed(submit)).toBe(false);
    expect(
      isSupersededRenditionTapAllowed({
        id: "dismiss",
        label: "Dismiss",
        style: "secondary",
        behavior: { type: "local", command: "dismiss" },
      }),
    ).toBe(true);
    const list = fs.readFileSync(
      path.join(repoRoot, "mingla-business/src/components/ari/MessageList.tsx"),
      "utf8",
    );
    expect(list).toContain("superseded={");
    expect(list).toContain("!isSupersededRenditionTapAllowed(interaction.action)");
  });
});

describe("#2830 P0 the Website setup kickoff survives remounts", () => {
  beforeEach(() => resetWebsiteSetupAutoAuditsForTests());

  it("claims each brand + part once per session", () => {
    const key = websiteSetupAutoAuditKey("brand-1", "brand");
    expect(claimWebsiteSetupAutoAudit(key)).toBe(true);
    // A remount re-runs the effect: the module-scope claim refuses it.
    expect(claimWebsiteSetupAutoAudit(key)).toBe(false);
    expect(claimWebsiteSetupAutoAudit(key)).toBe(false);
    expect(
      claimWebsiteSetupAutoAudit(websiteSetupAutoAuditKey("brand-1", null)),
    ).toBe(true);
    expect(websiteSetupAutoAuditKey("brand-1", undefined)).toBe(
      "brand-1:overview",
    );
  });

  it("guards the kickoff with the module claim, not a component ref", () => {
    expect(screen).toContain("if (!claimWebsiteSetupAutoAudit(auditKey)) return;");
    expect(screen).not.toMatch(/automaticSetupAudit\s*=\s*useRef/);
  });
});
