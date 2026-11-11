/**
 * #4389 U-9 — the two top bars are pinned.
 *
 * Home: brand chip, Messages, [Mingla team "M" for staff, #4255 W5], bell,
 * "+" (TopBar unchanged by the BrandChip extraction). Ari: brand chip, Chats, Settings; first run adds Messages and
 * the bell before Chats. Ari never mounts a brand TopBar with rightSlot= (I-37).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll(
    predicate: (node: TestInstance) => boolean,
    options?: { deep?: boolean },
  ): TestInstance[];
}
interface RendererInstance {
  root: TestInstance;
  toJSON(): unknown;
  unmount(): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void): void;
};
const act = TestRenderer.act;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner-4389" }, isAuthReady: true }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ id: "b-4389", displayName: "Lantern Room" }),
}));
jest.mock("../../../hooks/useBusinessNotifications", () => ({
  useBusinessNotificationsInbox: () => ({ unreadCount: 3 }),
}));
jest.mock("../../../hooks/useBrandGroups", () => ({
  useBrandGroups: () => ({ unreadCount: 2 }),
}));
jest.mock("../../../hooks/useBrandEnquiries", () => ({
  useBrandEnquiries: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../brand/BrandMark", () => ({
  BrandMark: () => null,
  brandMarkPhotoUrl: () => null,
}));
jest.mock("../Icon", () => ({ Icon: () => null }));
// #4255 W5 — the staff "M" chunk, stood in by one labelled node.
jest.mock("../../minglaTeam/teamBadge", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: () => R.createElement(RN.View, { accessibilityLabel: "Mingla team" }),
  };
});
jest.mock("../Toast", () => ({ Toast: () => null }));
jest.mock("../GlassChrome", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    GlassChrome: (p: { children?: React.ReactNode }) =>
      R.createElement(RN.View, null, p.children),
  };
});
jest.mock("../IconChrome", () => {
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  const R = jest.requireActual("react") as typeof React;
  return {
    IconChrome: (p: { icon: string; accessibilityLabel?: string; testID?: string }) =>
      R.createElement(RN.View, {
        testID: p.testID ?? `icon-${p.icon}`,
        accessibilityLabel: p.accessibilityLabel,
      }),
  };
});

/* eslint-disable import/first */
import { TopBar } from "../TopBar";
import { IconChrome } from "../IconChrome";
/* eslint-enable import/first */

const mounted: RendererInstance[] = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount();
});
beforeEach(() => undefined);

function mount(el: React.ReactElement): RendererInstance {
  let r!: RendererInstance;
  act(() => {
    r = TestRenderer.create(el);
  });
  mounted.push(r);
  return r;
}

/** Labels of every labelled node, in tree order. */
function labels(r: RendererInstance): string[] {
  return r.root
    .findAll((n) => typeof n.props.accessibilityLabel === "string" && typeof n.type === "string", {
      deep: true,
    })
    .map((n) => n.props.accessibilityLabel as string);
}

describe("#4389 U-9 Home top bar", () => {
  test("brand chip, Messages, bell, + — in that order", () => {
    const r = mount(
      <TopBar
        leftKind="brand"
        onBrandTap={() => undefined}
        extraRightSlot={
          <IconChrome icon="plus" size={36} accessibilityLabel="Create event, experience, or trip" />
        }
      />,
    );
    const l = labels(r);
    const iBrand = l.indexOf("Brand: Lantern Room");
    const iMsg = l.indexOf("Messages, 2 unread");
    const iBell = l.indexOf("Notifications, 3 unread");
    const iPlus = l.indexOf("Create event, experience, or trip");
    expect(iBrand).toBeGreaterThanOrEqual(0);
    expect(iMsg).toBeGreaterThan(iBrand);
    expect(iBell).toBeGreaterThan(iMsg);
    expect(iPlus).toBeGreaterThan(iBell);
    expect(JSON.stringify(r.toJSON())).toContain("Lantern Room");
  });

  test("with the app's query client: brand chip, Messages, Mingla team, bell, + (#4255 W5)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
    const client = new QueryClient();
    let r!: RendererInstance;
    await (TestRenderer.act as unknown as (cb: () => Promise<void>) => Promise<void>)(async () => {
      r = TestRenderer.create(
        <QueryClientProvider client={client}>
          <TopBar
            leftKind="brand"
            onBrandTap={() => undefined}
            extraRightSlot={
              <IconChrome icon="plus" size={36} accessibilityLabel="Create event, experience, or trip" />
            }
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    mounted.push(r);
    const l = labels(r);
    const order = ["Brand: Lantern Room", "Messages, 2 unread", "Mingla team", "Notifications, 3 unread", "Create event, experience, or trip"]
      .map((x) => l.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    client.clear();
  });

  test("Home still mounts TopBar leftKind=brand with + as extraRightSlot and no rightSlot", () => {
    const home = fs.readFileSync(path.join(__dirname, "../../../../app/(tabs)/home.tsx"), "utf8");
    const at = home.indexOf("<TopBar");
    const block = home.slice(at, home.indexOf("/>\n", home.indexOf("extraRightSlot", at)) + 3);
    expect(block).toContain('leftKind="brand"');
    expect(block).toContain("extraRightSlot=");
    expect(block).toContain('icon="plus"');
    expect(block).not.toContain("rightSlot={");
  });

  test("TopBar's brand slot is the shared BrandChip; the 18-character label stays", () => {
    const src = fs.readFileSync(path.join(__dirname, "../TopBar.tsx"), "utf8");
    expect(src).toContain("<BrandChip onPress={handleBrandTap} brandLoading={brandLoading} />");
    const chip = fs.readFileSync(path.join(__dirname, "../BrandChip.tsx"), "utf8");
    expect(chip).toContain("export const BRAND_LABEL_MAX_CHARS = 18;");
    expect(chip).toContain('accessibilityLabel="Brand: loading"');
  });
});

describe("#4389 U-9 Ari top bar", () => {
  const ari = fs.readFileSync(
    path.join(__dirname, "../../../screens/ari/AriChatScreen.tsx"),
    "utf8",
  );
  const barAt = ari.indexOf('testID="ari-top-bar"');
  const bar = ari.slice(barAt, ari.indexOf(") : null}", ari.indexOf('testID="ari-bar-settings"')));

  test("brand chip on the left, then (first run) Messages + bell, then Chats, then Settings", () => {
    expect(barAt).toBeGreaterThan(0);
    const iChip = bar.indexOf("<BrandChip");
    const iFirst = bar.indexOf("firstRunStage !== null ? (");
    const iBell = bar.indexOf("<LazyMessagesAndBell />");
    const iChats = bar.indexOf('testID="ari-bar-chats"');
    const iSettings = bar.indexOf('testID="ari-bar-settings"');
    expect(iChip).toBeGreaterThan(0);
    expect(iFirst).toBeGreaterThan(iChip);
    expect(iBell).toBeGreaterThan(iFirst);
    expect(iChats).toBeGreaterThan(iBell);
    expect(iSettings).toBeGreaterThan(iChats);
    expect(bar).toContain("fullNameLabel");
  });

  test("Ari never mounts a brand TopBar (I-37) and the centred title is gone from the tab", () => {
    expect(ari).not.toMatch(/<(Lazy)?TopBar\b/);
    expect(ari).not.toContain("ari-first-run-create");
    // The old header is kept only for the Website setup / embedded surfaces.
    expect(ari).toContain("{setup || embedded ? (");
  });

  test("the switcher is titled Talk to Ari about and holds a pick while Ari answers", () => {
    expect(ari).toContain("title={ARI_BRAND_BAR_COPY.switcherTitle}");
    expect(ari).toContain("onBeforePick={handleBeforeBrandPick}");
    expect(ari).toContain("useConfirmPendingAction(chat.conversationId, selectedBrandId)");
  });
});
