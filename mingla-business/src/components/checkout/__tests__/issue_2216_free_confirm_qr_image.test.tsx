// issue #2216 [ticket QR renders as a blank white square] — the buyer-side half.
//
// WHAT A PERSON SAW. A guest reserved a free ticket, landed on the
// confirmation screen, and the pass was a blank white square. The chrome was
// right — "Ticket 1 of 2 — Free Entry", the dots, "Swipe to see next ticket" —
// so the carousel had mounted; only the image was absent.
//
// WHY. `TicketQrCarousel` draws a plain white <View> whenever `qrImageDataUrl`
// is missing or empty. That placeholder guard is CORRECT and is deliberately
// left byte-for-byte as it is — the fix makes the DATA right rather than
// weakening the guard to make pixels appear. The defect was upstream: the
// `free_completed` envelope from `ticket-checkout-create` carried `qrPayload`
// but no rendered image, so the placeholder was the honest thing to draw.
//
// WHAT THIS PINS, by MOUNTING the REAL carousel (react-test-renderer under the
// stock mingla-business jest config, the #976 harness):
//   HP-1  the post-fix free-order ticket shape renders one real <Image> per
//         seat, each carrying the server PNG — zero placeholders left.
//   HP-2  the two seats never share one image (a shared code would turn the
//         second guest away at the door).
//   HP-3  the single-seat layout (a 1-ticket paid order) renders its image.
//   REPRO the PRE-fix shape (qrPayload only) renders NO image and one 200x200
//         white box per seat — the reported symptom, reproduced. This is what
//         makes HP-1 falsifiable: the ONLY difference between the two fixtures
//         is `qrImageDataUrl`.
//
// FAILS-ON-REVERT: reverting the edge fix strips `qrImageDataUrl` from the real
// response, which is exactly the REPRO fixture — HP-1/HP-2/HP-3 then fail.

import React from "react";

import { TicketQrCarousel } from "../TicketQrCarousel";

// react-test-renderer ships no bundled types; CJS-require it the way the #976
// suites do (proven under this stock config), against this local shape.
interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

// react-test-renderer 19 warns unless the environment opts into act().
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => {
    root: TestNode;
    toJSON: () => unknown;
    unmount: () => void;
  };
  act: (cb: () => void | Promise<void>) => void;
};

type Tree = ReturnType<typeof TestRenderer.create>;

const PNG_PREFIX = "data:image/png;base64,";

/** Stand-in for a real 400x400 server-rendered QR PNG data URI. */
const pngDataUri = (seed: string): string => PNG_PREFIX + seed.repeat(200);

const ORDER_ID = "40000000-0000-4000-8000-000000002216";
const T1 = "50000000-0000-4000-8000-000000002216";
const T2 = "60000000-0000-4000-8000-000000002216";

/** The 122-char `tickets.qr_code` shape the door scanner reads. */
const qrPayload = (ticketId: string, seed: string): string =>
  `mingla:v1:ticket:${ticketId}:sig:${seed.repeat(64).slice(0, 64)}`;

/** Post-fix: what `ticket-checkout-create` now returns for a free order. */
const fixedFreeTickets = [
  {
    ticketId: T1,
    ticketName: "Free Entry",
    qrPayload: qrPayload(T1, "1a"),
    qrImageDataUrl: pngDataUri("Aa"),
  },
  {
    ticketId: T2,
    ticketName: "Free Entry",
    qrPayload: qrPayload(T2, "2b"),
    qrImageDataUrl: pngDataUri("Bb"),
  },
];

/** Pre-fix: the exact shape the reported blank-pass order arrived in. */
const brokenFreeTickets = fixedFreeTickets.map(
  ({ ticketId, ticketName, qrPayload: p }) => ({
    ticketId,
    ticketName,
    qrPayload: p,
  }),
);

type Tickets = React.ComponentProps<typeof TicketQrCarousel>["tickets"];

/**
 * Mount the real carousel and give it a measured width, because the multi-seat
 * layout renders nothing but its host until `onLayout` reports one (ORCH-0852).
 * Without this step the suite would be green against a carousel that draws
 * nothing at all — a check that carries no information.
 */
function mountCarousel(tickets: Tickets): Tree {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(TicketQrCarousel, { orderId: ORDER_ID, tickets }),
    );
  });
  if (tree === null) throw new Error("render produced no tree");
  const mounted: Tree = tree;
  const hosts = mounted.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.onLayout === "function",
  );
  if (hosts.length > 0) {
    const onLayout = hosts[0].props.onLayout as (
      e: { nativeEvent: { layout: { width: number } } },
    ) => void;
    TestRenderer.act(() => {
      onLayout({ nativeEvent: { layout: { width: 390 } } });
    });
  }
  return mounted;
}

/** Host <Image> nodes only — findAll matches the composite AND the host. */
const imagesIn = (tree: Tree): TestNode[] =>
  tree.root.findAll((node) => node.type === "Image");

/** The placeholder the guest actually saw: a 200x200 solid-white View. */
const whiteBoxesIn = (tree: Tree): TestNode[] =>
  tree.root.findAll((node) => {
    if (node.type !== "View") return false;
    const style = node.props.style as Record<string, unknown> | undefined;
    if (style == null || Array.isArray(style)) return false;
    return (
      style.backgroundColor === "#ffffff" &&
      style.width === 200 &&
      style.height === 200
    );
  });

const uriOf = (node: TestNode): string =>
  String((node.props.source as { uri?: unknown } | undefined)?.uri ?? "");

describe("issue #2216 — a free order's confirmation carousel draws a real pass", () => {
  it("HP-1: every seat renders an <Image> carrying the server PNG, and no placeholder remains", () => {
    const tree = mountCarousel(fixedFreeTickets);

    const images = imagesIn(tree);
    expect(images).toHaveLength(2);
    expect(uriOf(images[0])).toBe(fixedFreeTickets[0].qrImageDataUrl);
    expect(uriOf(images[1])).toBe(fixedFreeTickets[1].qrImageDataUrl);
    expect(uriOf(images[0]).startsWith(PNG_PREFIX)).toBe(true);
    expect(uriOf(images[1]).startsWith(PNG_PREFIX)).toBe(true);
    expect(images[0].props.accessibilityLabel).toBe("Ticket 1 of 2 QR code");
    expect(images[1].props.accessibilityLabel).toBe("Ticket 2 of 2 QR code");

    expect(whiteBoxesIn(tree)).toHaveLength(0);
  });

  it("HP-2: the two seats carry DIFFERENT images (one shared code turns a guest away)", () => {
    const images = imagesIn(mountCarousel(fixedFreeTickets));
    expect(uriOf(images[0])).not.toBe(uriOf(images[1]));
  });

  it("HP-3: a single-seat (paid) order renders its image too", () => {
    const tree = mountCarousel([fixedFreeTickets[0]]);
    const images = imagesIn(tree);

    expect(images).toHaveLength(1);
    expect(uriOf(images[0])).toBe(fixedFreeTickets[0].qrImageDataUrl);
    expect(images[0].props.accessibilityLabel).toBe("Ticket QR code");
    expect(whiteBoxesIn(tree)).toHaveLength(0);
  });

  it("REPRO: the pre-fix shape (qrPayload only) renders NO image — a blank white square per seat", () => {
    const tree = mountCarousel(brokenFreeTickets);

    expect(imagesIn(tree)).toHaveLength(0);
    expect(whiteBoxesIn(tree)).toHaveLength(2);

    // …while the chrome still renders, exactly as the guest described it.
    // (RN splits interpolated Text into child fragments, so join before asserting.)
    const captions = tree.root
      .findAll((node) => node.type === "Text")
      .map((node) => {
        const kids = node.props.children;
        return (Array.isArray(kids) ? kids : [kids]).join("");
      });
    expect(captions).toContain("Ticket 1 of 2 — Free Entry");
    expect(captions).toContain("Ticket 2 of 2 — Free Entry");
    expect(captions).toContain("Swipe to see next ticket");
  });
});
