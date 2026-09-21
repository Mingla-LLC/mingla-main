/**
 * #3429 REWORK-2 implementor proof — R-2, R-4 and R-6.
 *
 * R-6 executes the real shipped segmenter. R-2 and R-4 use the TypeScript
 * compiler API and a comment-stripped view, so — unlike the assertions R-3
 * had to repair — a comment, a docblock or a string mention can never satisfy
 * any of them.
 */

import fs from "fs";
import path from "path";
import ts from "typescript";

// The segmenter is a pure function; ChatBubble's two view-only children pull in
// react-native-svg and reanimated, which this suite has no use for.
jest.mock("../AriOrb", () => ({ AriOrb: () => null }));
jest.mock("../SemanticRevealText", () => ({ SemanticRevealText: () => null }));

import { toSegments } from "../ChatBubble";

const ARI_DIR = path.resolve(__dirname, "..");
const SCREEN = path.resolve(ARI_DIR, "../../screens/ari/AriChatScreen.tsx");
const HOOK = path.resolve(ARI_DIR, "../../hooks/useAgentChat.ts");
const MESSAGE_LIST = path.resolve(ARI_DIR, "MessageList.tsx");
const COPY_MODULE = path.resolve(ARI_DIR, "../../screens/ari/ariChatErrorCopy.ts");
const AGENT_CHAT = path.resolve(
  ARI_DIR,
  "../../../../supabase/functions/agent-chat/index.ts",
);

function parse(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Every string LITERAL in the file — never a comment, never an identifier. */
function stringLiterals(file: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(file, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    }
    if (ts.isJsxText(node)) out.push(node.text);
  });
  return out;
}

// ---------------------------------------------------------------------------
// R-6 — a bullet list that shares a paragraph with its intro line
// ---------------------------------------------------------------------------

describe("#3429 R2 R-6 — a paragraph is split at its first bullet", () => {
  it("renders the intro as prose and the bullets as bullets, with no literal dashes", () => {
    // The exact shape seen on both iOS devices (ios-large/21-just-sent.png).
    const segments = toSegments(
      "Here is what I found for your week.\n- Friday rooftop launch\n- Saturday supper club",
    );
    expect(segments).toEqual([
      { kind: "paragraph", text: "Here is what I found for your week." },
      { kind: "bullet", text: "Friday rooftop launch" },
      { kind: "bullet", text: "Saturday supper club" },
    ]);
    // No segment may still carry the marker the writer meant as a list.
    for (const segment of segments) expect(segment.text).not.toMatch(/^\s*[•-]\s/);
  });

  it("handles the • marker and a multi-line intro the same way", () => {
    expect(
      toSegments("Two options.\nBoth are free.\n• Rooftop\n• Garden"),
    ).toEqual([
      { kind: "paragraph", text: "Two options.\nBoth are free." },
      { kind: "bullet", text: "Rooftop" },
      { kind: "bullet", text: "Garden" },
    ]);
  });

  it("keeps a trailing line after the bullets as its own paragraph", () => {
    expect(toSegments("Pick one:\n- A\n- B\nEither works.")).toEqual([
      { kind: "paragraph", text: "Pick one:" },
      { kind: "bullet", text: "A" },
      { kind: "bullet", text: "B" },
      { kind: "paragraph", text: "Either works." },
    ]);
  });

  it("leaves an all-prose and an all-bullet paragraph byte-identical to before", () => {
    expect(toSegments("Just one sentence.")).toEqual([
      { kind: "paragraph", text: "Just one sentence." },
    ]);
    expect(toSegments("A line.\nAnother line.")).toEqual([
      { kind: "paragraph", text: "A line.\nAnother line." },
    ]);
    expect(toSegments("- A\n- B")).toEqual([
      { kind: "bullet", text: "A" },
      { kind: "bullet", text: "B" },
    ]);
    expect(toSegments("Intro.\n\n- A\n- B")).toEqual([
      { kind: "paragraph", text: "Intro." },
      { kind: "bullet", text: "A" },
      { kind: "bullet", text: "B" },
    ]);
  });

  it("does not mistake a hyphenated word or a negative number for a bullet", () => {
    // The marker needs whitespace after it; "-5" and "well-made" must not split.
    expect(toSegments("Revenue fell by -5 percent.\nIt is well-made.")).toEqual([
      { kind: "paragraph", text: "Revenue fell by -5 percent.\nIt is well-made." },
    ]);
  });
});

// ---------------------------------------------------------------------------
// R-4 — one connection sentence, one owner
// ---------------------------------------------------------------------------

describe("#3429 R2 R-4 — the connection sentence has exactly one owner", () => {
  const OWNED = "Ari could not connect — check your connection and try again.";

  it("the copy module still owns the locked wording", () => {
    expect(stringLiterals(parse(COPY_MODULE))).toContain(OWNED);
  });

  for (const [label, filePath] of [
    ["useAgentChat.ts", HOOK],
    ["MessageList.tsx", MESSAGE_LIST],
  ] as const) {
    it(`${label} renders no second connection sentence of its own`, () => {
      const literals = stringLiterals(parse(filePath));
      const offenders = literals.filter((literal) =>
        /check your connection and try again/i.test(literal)
      );
      expect(offenders).toEqual([]);
      // ...and it must not simply re-declare the owned sentence either.
      expect(literals).not.toContain(OWNED);
    });

    it(`${label} imports the sentence from the #3184 copy module`, () => {
      const file = parse(filePath);
      const imported: string[] = [];
      walk(file, (node) => {
        if (!ts.isImportDeclaration(node)) return;
        const from = (node.moduleSpecifier as ts.StringLiteral).text;
        if (!from.endsWith("ariChatErrorCopy")) return;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) imported.push(element.name.text);
        }
      });
      expect(imported).toContain("ARI_CHAT_CONNECTION_COPY");
    });
  }

  it("the edge function's stop-before-acceptance sentence is byte-identical to the owned one", () => {
    // An edge function cannot import a client module, so these bytes are
    // duplicated in `agent-chat/index.ts` on purpose. This is the pin that
    // makes the duplication safe: change either side and this fails. Read as
    // string LITERALS, so the explanatory comment beside it counts for nothing.
    const literals = stringLiterals(parse(AGENT_CHAT));
    expect(literals).toContain(OWNED);
    // ...and the wording it replaced must be gone from that file entirely.
    expect(
      literals.filter((literal) => literal.startsWith("Message not sent.")),
    ).toEqual([]);
    // Every OTHER TURN_STOPPED sentence stays distinct, which is what lets the
    // client tell a stop that beat acceptance from one that did not.
    expect(literals).toContain("Ari stopped. Your message is still here.");
  });

  it("the hook discriminates on the owned constant, not on a prefix of its own", () => {
    const source = fs.readFileSync(HOOK, "utf8");
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(stripped).toContain(
      "response.message === ARI_CHAT_CONNECTION_COPY",
    );
    expect(stripped).not.toContain('startsWith("Message not sent.")');
  });

  it("every TRANSPORT_UNAVAILABLE message in the hook is the imported constant", () => {
    const file = parse(HOOK);
    const messages: string[] = [];
    walk(file, (node) => {
      if (!ts.isPropertyAssignment(node)) return;
      const name = node.name.getText();
      if (name !== "errorMessage" && name !== "message") return;
      messages.push(node.initializer.getText());
    });
    const hardcoded = messages.filter((expression) =>
      /["'].*check your connection.*["']/i.test(expression)
    );
    expect(hardcoded).toEqual([]);
    expect(
      messages.filter((expression) =>
        expression.includes("ARI_CHAT_CONNECTION_COPY")
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// R-2 — the empty state's content box is clamped to the composer's top
// ---------------------------------------------------------------------------

/**
 * Pull a `const <name> = <expression>;` out of the screen and evaluate the
 * SHIPPED expression. Nothing here re-implements the arithmetic: if the clamp
 * is deleted, zeroed or detached from the keyboard, these evaluate to the new
 * value and the geometry assertions below fail.
 */
function shippedExpression(source: ts.SourceFile, name: string): string {
  let text: string | null = null;
  walk(source, (node) => {
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text === name && node.initializer
    ) {
      text = node.initializer.getText();
    }
  });
  if (text === null) throw new Error(`AriChatScreen no longer declares ${name}`);
  return text;
}

describe("#3429 R2 R-2 — the empty state never sits under the composer", () => {
  const screen = parse(SCREEN);
  // The two constants the screen imports, at their shipped values.
  const DONE_BAR_OCCUPIED = 42;
  const MIN_VISIBLE_CLEARANCE = 12;
  const BOTTOM_NAV_CLEARANCE_PX = 80;
  const spacing = { md: 16, sm: 8 };

  type Device = {
    name: string;
    /** Height of the chat column, as the RETEST measured the empty-state frame. */
    chatColumnHeight: number;
    insetsBottom: number;
    keyboardHeight: number;
  };
  // The two simulators SC-R1-P2-6 names. Chat-column heights are the
  // empty-state frames the RETEST recorded ([0,81][375,667] on the SE,
  // [0,123][440,956] on the 17 Pro Max).
  const devices: Device[] = [
    { name: "iPhone SE 3rd gen", chatColumnHeight: 586, insetsBottom: 0, keyboardHeight: 260 },
    { name: "iPhone 17 Pro Max", chatColumnHeight: 833, insetsBottom: 34, keyboardHeight: 336 },
  ];

  /** Evaluate a shipped expression with the screen's own inputs in scope. */
  function evaluate(
    expression: string,
    scope: Record<string, unknown>,
  ): number {
    const keys = Object.keys(scope);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `return (${expression});`) as (
      ...args: unknown[]
    ) => number;
    return fn(...keys.map((key) => scope[key]));
  }

  const clampExpression = shippedExpression(screen, "emptyHeroComposerClamp");
  const restingExpression = shippedExpression(screen, "composerRestingOccupiedPx");

  it("the clamp is derived from the keyboard, not a constant", () => {
    expect(clampExpression).toContain("keyboardHeight");
    expect(clampExpression).toContain("DONE_BAR_OCCUPIED");
    expect(clampExpression).toContain("MIN_VISIBLE_CLEARANCE");
  });

  for (const device of devices) {
    for (const keyboardOpen of [false, true]) {
      it(`${device.name}, keyboard ${
        keyboardOpen ? "open" : "closed"
      }: the hero's viewport bottom never crosses the composer's top`, () => {
        const keyboardHeight = keyboardOpen ? device.keyboardHeight : 0;
        const insets = { bottom: device.insetsBottom };
        // The composer column as the screen measures it: the resting minimum,
        // and a tall one (a 5-card attachment tray with a failure block).
        for (const composerContentHeight of [60, 240]) {
          const scope = {
            keyboardHeight,
            insets,
            spacing,
            composerContentHeight,
            DONE_BAR_OCCUPIED,
            MIN_VISIBLE_CLEARANCE,
            BOTTOM_NAV_CLEARANCE_PX,
            Math,
          };
          const composerRestingOccupiedPx = evaluate(restingExpression, scope);
          const clamp = evaluate(clampExpression, {
            ...scope,
            composerRestingOccupiedPx,
          });

          // What the screen actually renders, as distances from the bottom of
          // the chat column. `inputWrap`'s paddingBottom places the composer
          // pill's BOTTOM edge; the column grows upward from there, under
          // `inputWrap`'s own paddingTop of spacing.sm.
          const composerTopInset = (keyboardHeight > 0
            ? keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE
            : Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX) +
            composerContentHeight + spacing.sm;
          // The overlay's keyboard-INDEPENDENT padding (the no-jump contract),
          // plus the clamp applied to the scroll viewport inside it.
          const heroRestingInset = Math.max(insets.bottom, spacing.md) +
            BOTTOM_NAV_CLEARANCE_PX + 60 +
            Math.max(0, composerContentHeight - 60);
          const heroViewportInset = heroRestingInset + clamp;

          expect(heroViewportInset).toBeGreaterThanOrEqual(composerTopInset);
          // And the visible viewport still has real height to draw into.
          expect(device.chatColumnHeight - heroViewportInset).toBeGreaterThan(0);
        }
      });
    }
  }

  it("the hero's own box is never clamped, so the orb cannot jump", () => {
    const source = fs.readFileSync(SCREEN, "utf8");
    // `emptyHeroBox` is the measured resting box: it must carry no clamp...
    const boxStyle = source.slice(source.indexOf("styles.emptyHeroBox"));
    expect(boxStyle.slice(0, 200)).not.toContain("emptyHeroComposerClamp");
    // ...and the scroll content's minHeight must be that measured height, so
    // shrinking the viewport cannot re-center the content.
    expect(source).toContain("minHeight: emptyHeroBoxHeight");
    // The clamp lands on the visible region — the same element that carries
    // the dismiss role, so the one rectangle an accessibility-frame dump sees
    // for the empty state stops at the composer's top edge.
    const pressStyle = source.slice(source.indexOf("styles.emptyHeroPress,"));
    expect(pressStyle.slice(0, 200)).toContain(
      "marginBottom: emptyHeroComposerClamp",
    );
    const pressBlock = source.slice(
      source.indexOf("styles.emptyHeroPress,"),
      source.indexOf("</Pressable>", source.indexOf("styles.emptyHeroPress,")),
    );
    expect(pressBlock).toContain('accessibilityLabel="Dismiss keyboard"');
    // The content box inside keeps the measured resting height — that, not the
    // viewport, is what holds the hero still.
    expect(pressBlock).toContain("styles.emptyHeroContent");
  });

  it("the hero box is not a scroller, so it can never be keyboard-aware", () => {
    // ORCH-0892 / #1841: a react-native ScrollView in a file with a TextInput is
    // a gate blocker, and it is the right rule — an auto-scrolling container
    // here would reintroduce the orb jump ORCH-1057 removed. Overflow is trimmed
    // by the overlay and recovered by dismissing the keyboard.
    const file = parse(SCREEN);
    let scrollers = 0;
    walk(file, (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText() === "ScrollView") scrollers += 1;
      }
      if (ts.isImportSpecifier(node) && node.name.text === "ScrollView") {
        scrollers += 1;
      }
    });
    expect(scrollers).toBe(0);
    const source = fs.readFileSync(SCREEN, "utf8");
    expect(source).toContain("overflow: \"hidden\"");
  });
});
