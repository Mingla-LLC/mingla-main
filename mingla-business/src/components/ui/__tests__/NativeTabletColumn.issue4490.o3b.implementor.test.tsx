/**
 * #4490 spec 08 O3 part B — the root column, rendered: on a native tablet every
 * Host screen except the floor keeps the phone layout in a centred
 * suiteFormMaxWidth column; floor screens and phones get the whole window; web
 * resolves a passthrough file. Also: the station board hook passes the height,
 * and web never loads the two native modules.
 *
 * fails-on-revert: centre a floor screen, centre on a phone, drop the column
 * from the root layout, or let a web file import expo-audio /
 * expo-screen-orientation and a test here fails.
 */
import { createElement } from "react";
import fs from "fs";
import path from "path";

const renderer = require("react-test-renderer") as {
  create: (element: unknown) => { toJSON: () => unknown; update: (element: unknown) => void };
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

let windowSize = { width: 1024, height: 768 };
let pathname = "/events";
let platform = "ios";

jest.mock("react-native", () => ({
  get Platform() {
    return { OS: platform, select: (o: Record<string, unknown>) => o[platform] ?? o.default };
  },
  StyleSheet: { hairlineWidth: 1, create: <T,>(styles: T): T => styles, flatten: (s: unknown) => s },
  View: "View",
  useWindowDimensions: () => windowSize,
}));
jest.mock("expo-router", () => ({ usePathname: () => pathname }));

// eslint-disable-next-line import/first
import { NativeTabletColumn } from "../NativeTabletColumn";
// eslint-disable-next-line import/first
import { suiteFormMaxWidth } from "../../../constants/designSystem";

type Node = { type: string; props: { style?: unknown; testID?: string }; children: unknown[] | null };

const flatStyle = (style: unknown): Record<string, unknown> =>
  (Array.isArray(style) ? style : [style]).filter(Boolean).reduce<Record<string, unknown>>((acc, s) => ({ ...acc, ...(s as object) }), {});

const renderColumn = async (): Promise<Node> => {
  let tree: { toJSON: () => unknown } | undefined;
  await renderer.act(async () => {
    tree = renderer.create(createElement(NativeTabletColumn, null, createElement("Screen")));
  });
  return tree?.toJSON() as Node;
};

describe("08-O3B NativeTabletColumn (rendered)", () => {
  beforeEach(() => {
    platform = "ios";
    pathname = "/events";
  });

  test.each([
    [1024, 768],
    [768, 1024],
  ])("native tablet %i x %i: a non-floor screen sits in a centred %s-wide column", async (width, height) => {
    windowSize = { width, height };
    const node = await renderColumn();
    expect(node.props.testID).toBe("native-tablet-column");
    expect(flatStyle(node.props.style)).toMatchObject({ flex: 1, maxWidth: suiteFormMaxWidth, width: "100%", alignSelf: "center" });
  });

  test.each([
    ["/venue/v1/till", 1024, 768],
    ["/venue/v1/station/kitchen", 768, 1024],
  ])("floor screen %s at %i x %i: whole window", async (route, width, height) => {
    windowSize = { width, height };
    pathname = route;
    const node = await renderColumn();
    expect(flatStyle(node.props.style).maxWidth).toBeUndefined();
  });

  test("a 600-wide tablet in portrait and a phone: whole window, same View slot", async () => {
    for (const size of [{ width: 600, height: 960 }, { width: 390, height: 844 }]) {
      windowSize = size;
      const node = await renderColumn();
      expect(node.type).toBe("View");
      expect(flatStyle(node.props.style).maxWidth).toBeUndefined();
    }
  });
});

describe("08-O3B wiring and the web split (source)", () => {
  const appRoot = path.join(__dirname, "../../../..");
  const read = (rel: string): string => fs.readFileSync(path.join(appRoot, rel), "utf8");

  test("the root Stack sits inside the column; web resolves passthrough files", () => {
    expect(read("app/_layout.tsx")).toContain("<NativeTabletColumn><Stack screenOptions={{ headerShown: false }} /></NativeTabletColumn>");
    const webColumn = read("src/components/ui/NativeTabletColumn.web.tsx");
    expect(webColumn).toContain("({ children }) => <>{children}</>");
    expect(webColumn).not.toMatch(/deviceOrientation|useWindowDimensions/);
    expect(read("src/hooks/usePhonePortraitLock.web.ts")).not.toMatch(/require|import/);
    expect(read("src/hooks/useFloorLayout.ts")).toContain("stationBoardColumns(layout, width, height)");
  });

  test("only stationSound.ts (native; web resolves stationSound.web.ts) loads expo-audio; nothing imports expo-screen-orientation", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const files = [...walk(path.join(appRoot, "src")), ...walk(path.join(appRoot, "app"))];
    const importing = (pkg: string): string[] =>
      files
        .filter((f) => new RegExp(`from ["']${pkg}["']|require\\(["']${pkg}["']\\)|import\\(["']${pkg}["']\\)`).test(fs.readFileSync(f, "utf8")))
        .map((f) => path.relative(appRoot, f));
    expect(importing("expo-audio")).toEqual(["src/components/venue/station/stationSound.ts"]);
    expect(importing("expo-screen-orientation")).toEqual([]);
    expect(read("src/components/venue/station/stationSound.web.ts")).not.toMatch(/expo-audio["']/);
  });
});
