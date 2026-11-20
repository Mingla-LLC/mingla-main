/**
 * issue #4518 follow-up — the checkout offering strip looks exactly as before.
 *
 * Seth: "do not regress the strip". The only allowed change is the picture's
 * SOURCE after a failure (one fallback through our own site) and the two
 * image handlers. MAIN_TREE below is the strip rendered from origin/main
 * (b27bd74af0) with the same props, captured before this change.
 *
 * FAILS ON REVERT: remove the hook from the strip and S-2 fails (the url stays
 * direct after an error); any style, testID, layout or accessibility drift
 * fails S-1 against the captured tree.
 */
import React from "react";

import { CheckoutOfferingStrip, type CheckoutOfferingStripProps } from "../CheckoutOfferingStrip";
import { OfferingMediaRouteContext } from "../../../../../packages/offering-rendering/offeringMediaRoute";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Rendered;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: (JsonNode | string)[] | null;
}
interface Rendered {
  toJSON: () => JsonNode | null;
  root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CASES: Record<string, CheckoutOfferingStripProps> = {
  withCover: {
    title: "Graphite Rooftop Night",
    eyebrow: "Sat 12 Dec · 8 PM",
    byline: "Graphite Journey Co",
    coverUrl: "https://proj.supabase.co/storage/v1/object/public/event-covers/c.jpg",
    wide: false,
  },
  noCover: { title: "Graphite Rooftop Night", eyebrow: null, byline: "2 travellers", coverUrl: null, wide: false },
  wide: { title: "T", eyebrow: null, byline: null, coverUrl: "https://x/y.jpg", wide: true },
};

// Captured from origin/main (b27bd74af0) — do not regenerate from this branch.
const MAIN_TREE: Record<string, unknown> = {
  "withCover": {
    "type": "View",
    "props": {
      "style": {
        "flexDirection": "row",
        "alignItems": "center",
        "gap": 14,
        "marginBottom": 20
      },
      "testID": "checkout-offering-strip",
      "accessible": true,
      "accessibilityLabel": "Graphite Rooftop Night, Sat 12 Dec · 8 PM, Graphite Journey Co",
      "ref": null
    },
    "children": [
      {
        "type": "Image",
        "props": {
          "source": {
            "uri": "https://proj.supabase.co/storage/v1/object/public/event-covers/c.jpg"
          },
          "style": {
            "width": 56,
            "height": 70,
            "borderRadius": 12,
            "overflow": "hidden"
          },
          "resizeMode": "cover",
          "accessibilityIgnoresInvertColors": true,
          "ref": null
        },
        "children": null
      },
      {
        "type": "View",
        "props": {
          "style": {
            "flex": 1,
            "minWidth": 0,
            "gap": 2
          },
          "ref": null
        },
        "children": [
          {
            "type": "Text",
            "props": {
              "style": {
                "fontSize": 11.5,
                "fontWeight": "700",
                "letterSpacing": 1,
                "textTransform": "uppercase",
                "color": "#f39a55"
              },
              "numberOfLines": 1,
              "ref": null
            },
            "children": [
              "Sat 12 Dec · 8 PM"
            ]
          },
          {
            "type": "Text",
            "props": {
              "style": [
                {
                  "fontSize": 20,
                  "fontWeight": "700",
                  "color": "#f5f5f7"
                },
                {}
              ],
              "numberOfLines": 2,
              "ref": null
            },
            "children": [
              "Graphite Rooftop Night"
            ]
          },
          {
            "type": "Text",
            "props": {
              "style": {
                "fontSize": 13.5,
                "color": "#a8a8ad"
              },
              "numberOfLines": 1,
              "ref": null
            },
            "children": [
              "Graphite Journey Co"
            ]
          }
        ]
      }
    ]
  },
  "noCover": {
    "type": "View",
    "props": {
      "style": {
        "flexDirection": "row",
        "alignItems": "center",
        "gap": 14,
        "marginBottom": 20
      },
      "testID": "checkout-offering-strip",
      "accessible": true,
      "accessibilityLabel": "Graphite Rooftop Night, 2 travellers",
      "ref": null
    },
    "children": [
      {
        "type": "View",
        "props": {
          "style": [
            {
              "width": 56,
              "height": 70,
              "borderRadius": 12,
              "overflow": "hidden"
            },
            {
              "backgroundColor": "rgba(235, 120, 37, 0.14)",
              "borderWidth": 1,
              "borderColor": "rgba(255, 255, 255, 0.075)"
            }
          ],
          "testID": "checkout-offering-strip-thumb-fallback",
          "ref": null
        },
        "children": null
      },
      {
        "type": "View",
        "props": {
          "style": {
            "flex": 1,
            "minWidth": 0,
            "gap": 2
          },
          "ref": null
        },
        "children": [
          {
            "type": "Text",
            "props": {
              "style": [
                {
                  "fontSize": 20,
                  "fontWeight": "700",
                  "color": "#f5f5f7"
                },
                {}
              ],
              "numberOfLines": 2,
              "ref": null
            },
            "children": [
              "Graphite Rooftop Night"
            ]
          },
          {
            "type": "Text",
            "props": {
              "style": {
                "fontSize": 13.5,
                "color": "#a8a8ad"
              },
              "numberOfLines": 1,
              "ref": null
            },
            "children": [
              "2 travellers"
            ]
          }
        ]
      }
    ]
  },
  "wide": null
};

/** The tree minus the two image handlers this change is allowed to add. */
const withoutImageHandlers = (node: JsonNode | string | null): unknown => {
  if (node === null || typeof node === "string") return node;
  const props: Record<string, unknown> = { ...node.props };
  if (node.type === "Image") {
    expect(typeof props.onLoad).toBe("function");
    expect(typeof props.onError).toBe("function");
    delete props.onLoad;
    delete props.onError;
  }
  return {
    type: node.type,
    props,
    children: node.children === null ? null : node.children.map(withoutImageHandlers),
  };
};

const render = async (element: React.ReactElement): Promise<Rendered> => {
  let r: Rendered | null = null;
  await TestRenderer.act(() => {
    r = TestRenderer.create(element);
  });
  return r as unknown as Rendered;
};

describe("#4518 — CheckoutOfferingStrip is unchanged but for the picture source", () => {
  test.each(Object.keys(CASES))("S-1 %s renders the same tree as main", async (key) => {
    const r = await render(<CheckoutOfferingStrip {...CASES[key]} />);
    expect(JSON.parse(JSON.stringify(withoutImageHandlers(r.toJSON())))).toEqual(MAIN_TREE[key]);
  });

  test("S-2 an image error swaps only source.uri (through the provided road)", async () => {
    const route = {
      resolve: (url: string) => url,
      fallback: (url: string) => (url.startsWith("https://proj.supabase.co/") ? `/_sb${url.slice(24)}` : null),
      timeLimitMs: null,
    };
    const r = await render(
      <OfferingMediaRouteContext.Provider value={route}>
        <CheckoutOfferingStrip {...CASES.withCover} />
      </OfferingMediaRouteContext.Provider>,
    );
    const image = (): { props: Record<string, unknown> } =>
      r.root.findAll((n) => n.type === "Image")[0];
    await TestRenderer.act(() => {
      (image().props.onError as () => void)();
    });
    expect(image().props.source).toEqual({
      uri: "/_sb/storage/v1/object/public/event-covers/c.jpg",
    });
    const tree = JSON.parse(JSON.stringify(withoutImageHandlers(r.toJSON()))) as JsonNode;
    const expected = JSON.parse(JSON.stringify(MAIN_TREE.withCover)) as JsonNode;
    (expected.children as JsonNode[])[0].props.source = {
      uri: "/_sb/storage/v1/object/public/event-covers/c.jpg",
    };
    expect(tree).toEqual(expected);
  });
});
