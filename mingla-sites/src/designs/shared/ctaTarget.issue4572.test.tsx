// MINGLA-INVARIANT: I-4572-CTA-NO-DEAD-PLACEHOLDER | issue #4572 | targetless and legacy "/" CTA bands keep their words but render no button; a real safe target renders the button.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CtaDarkPanelGlow } from "../voyage/blocks/CtaDarkPanelGlow";
import { CalloutBasic } from "./blocks/Basics";

const render = (href?: string) =>
  renderToStaticMarkup(
    <CalloutBasic
      block={{
        type: "cta",
        heading: "Come along",
        body: "There is room.",
        label: "Find out more",
        ...(href === undefined ? {} : { href }),
      }}
      index={2}
      ctx={{} as never}
    />,
  );

describe("#4572 shared CTA target", () => {
  it.each([undefined, "/"])(
    "keeps the band but hides the button for %s",
    (href) => {
      const html = render(href);
      expect(html).toContain("Come along");
      expect(html).toContain("There is room.");
      expect(html).not.toContain("<a");
    },
  );

  it("renders a button for a real target", () => {
    const html = render(
      "https://host.usemingla.com/e/young-and-stamped/friday-night",
    );
    expect(html).toContain(
      'href="https://host.usemingla.com/e/young-and-stamped/friday-night"',
    );
    expect(html).toContain("Find out more");
  });

  it.each([undefined, "/"])(
    "keeps the Voyage panel but hides its button for %s",
    (href) => {
      const html = renderToStaticMarkup(
        <CtaDarkPanelGlow
          block={{
            type: "cta",
            heading: "Come along",
            body: "There is room.",
            label: "Find out more",
            ...(href === undefined ? {} : { href }),
          }}
          index={2}
          ctx={{} as never}
        />,
      );
      expect(html).toContain("Come along");
      expect(html).toContain("There is room.");
      expect(html).not.toContain("<a");
    },
  );
});
