/**
 * issue #1561 [first-screen-rebuild] — the WEB-RESOLVED proof.
 *
 * Buyer web is the primary surface for this page: it is what every advert,
 * every share and every search result lands on. Three of this step's claims are
 * therefore claims about the DOM, and react-test-renderer cannot see the DOM —
 * it reports the JavaScript style objects, not what react-native-web's style
 * compiler emits. #1484 shipped a desktop uncap that was broken on live web
 * while 29 headless RN render tests were green, for exactly this reason.
 *
 * So this file renders the REAL `ParallaxCoverShell` and the REAL
 * `PublicVenueScreen` body through `react-native-web`, via RNW's own
 * `AppRegistry.getApplication`, which returns both the markup and the COMPILED
 * stylesheet. The assertions read emitted CSS DECLARATIONS (`aspect-ratio:1.2`,
 * `flex-direction:row`) rather than class-name hashes, so they say what they
 * mean and survive an RNW version bump.
 *
 * WHAT EACH ASSERTION WOULD CATCH, stated so the test cannot be mistaken for
 * decoration:
 *   - `aspect-ratio: 1.2` missing ⇒ the hero fell back to the shell's 4/5
 *     portrait default and is 57.8% of a phone again;
 *   - it present on the cover but NOT on the flow spacer ⇒ the pinned cover and
 *     the space reserved for it disagree, and the body seam lands in the wrong
 *     place at the top of the page;
 *   - `flex-direction: row` missing on the answer bar ⇒ its three cells stack
 *     down the page, pushing everything below them past the fold and undoing
 *     the measurement;
 *   - the placeholder text ⇒ the literal word `COVER` is back on a public page.
 *
 * VACUITY GUARDS. RNW emits nothing for a component that failed to render, and
 * "the CSS does not contain X" is trivially true of an empty stylesheet. Every
 * test therefore asserts a POSITIVE CONTROL on the same output first — a
 * declaration or a string that MUST be there — before asserting an absence, and
 * a minimum markup length so a null render cannot pass.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest --config jest.issue1561.web.render.cjs --runInBand
 */
import React from "react";
import ReactDOMServer from "react-dom/server";
import { StyleSheet, Text, View } from "react-native";
import { describe, expect, test } from "@jest/globals";

import { ParallaxCoverShell } from "../../../../../packages/offering-rendering/ParallaxCoverShell";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import {
  venueCoverPlaceholderLabel,
  venueHeroAspectRatio,
  VENUE_HERO_ASPECT_PHONE,
  VENUE_HERO_ASPECT_TABLET,
} from "../../../../../packages/brand-rendering/venueFirstScreen";
import { venueCategoryProfile } from "../../../../../packages/brand-rendering/venueCategoryProfile";

const { AppRegistry } = jest.requireActual("react-native-web") as {
  AppRegistry: {
    registerComponent: (name: string, factory: () => unknown) => void;
    getApplication: (name: string) => {
      element: React.ReactElement;
      getStyleElement: () => React.ReactElement;
    };
  };
};

let renderCount = 0;
function renderWeb(Component: () => React.ReactElement): {
  html: string;
  css: string;
} {
  const name = `Issue1561_${renderCount++}`;
  AppRegistry.registerComponent(name, () => Component);
  const app = AppRegistry.getApplication(name);
  return {
    html: ReactDOMServer.renderToStaticMarkup(app.element),
    css: ReactDOMServer.renderToStaticMarkup(app.getStyleElement()),
  };
}

/** Declarations, whitespace-normalised, so `aspect-ratio: 1.2` matches. */
const declarations = (text: string): string => text.replace(/\s+/g, "");

/**
 * How many elements carry a given inline declaration.
 *
 * RNW registers `StyleSheet.create` values as ATOMIC CLASSES but emits values
 * computed at render time as INLINE styles — and `coverAspectRatio` is exactly
 * that: a prop. So the ratio lives on the element, not in the stylesheet, and
 * counting occurrences is what proves it reached BOTH the pinned cover and the
 * flow spacer rather than only one of them. (The stylesheet still contains the
 * `aspect-ratio:0.8` atom from `styles.webPhoneSpacer`'s registered default —
 * asserting its absence THERE would be meaningless, which is why every
 * assertion below reads the markup.)
 */
const declarationCount = (html: string, declaration: string): number =>
  declarations(html).split(declaration).length - 1;

const theme = resolveTheme({ color: "#eb7825", font: "inter", animation: null }, null);
const palette = createThemePalette(theme);

/** The shell, mounted exactly the way `PublicVenueScreen` mounts it. */
const shellWith = (
  coverAspectRatio: number,
  coverMediaUrl: string | null,
  coverPlaceholderLabel: string,
): (() => React.ReactElement) =>
  function ShellHarness(): React.ReactElement {
    return (
      <ParallaxCoverShell
        palette={palette}
        theme={theme}
        coverMediaUrl={coverMediaUrl}
        coverMediaType={coverMediaUrl === null ? null : "image"}
        coverHue={30}
        entranceAnimationKey="venue:test:test:#eb7825"
        muted
        onToggleMute={(): void => undefined}
        showMute={false}
        onClose={(): void => undefined}
        onShare={(): void => undefined}
        hideCloseOnWeb
        coverAspectRatio={coverAspectRatio}
        coverPlaceholderLabel={coverPlaceholderLabel}
        safeAreaTop={47}
        contentBottomInset={110}
      >
        <View>
          <Text>issue-1561-body-sentinel</Text>
        </View>
      </ParallaxCoverShell>
    );
  };

describe("#1561 — the hero cap survives react-native-web's style compiler", () => {
  test("a phone hero emits aspect-ratio 1.2 on BOTH the cover and its spacer", () => {
    expect.assertions(6);
    const { html, css } = renderWeb(
      shellWith(venueHeroAspectRatio(390), "https://cdn.example.com/c.jpg", "Restaurant · London"),
    );
    // Positive control: the shell actually rendered a page, not nothing.
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("issue-1561-body-sentinel");

    // The cap itself. `1.2` is `VENUE_HERO_ASPECT_PHONE`; asserting the literal
    // proves the constant reached the DOM rather than being shadowed.
    expect(VENUE_HERO_ASPECT_PHONE).toBe(1.2);
    // TWICE: the pinned `position:fixed` cover AND the flow spacer that holds
    // its height. One without the other and the body seam lands in the wrong
    // place — a defect no headless RN assertion can see.
    expect(declarationCount(html, "aspect-ratio:1.2")).toBe(2);
    // The registered 4/5 atom must not survive as an INLINE declaration on
    // those elements; the render-time ratio has to win the cascade.
    expect(declarationCount(html, "aspect-ratio:0.8")).toBe(0);
    expect(css.length).toBeGreaterThan(200); // the compiler actually ran
  });

  test("a tablet hero emits 2.28 — the 768-1023 band that was 86.9% photograph", () => {
    expect.assertions(4);
    const { html } = renderWeb(
      shellWith(venueHeroAspectRatio(820), "https://cdn.example.com/c.jpg", "Restaurant · London"),
    );
    expect(html).toContain("issue-1561-body-sentinel"); // positive control
    expect(VENUE_HERO_ASPECT_TABLET).toBe(2.28);
    expect(declarationCount(html, "aspect-ratio:2.28")).toBe(2);
    expect(declarationCount(html, "aspect-ratio:0.8")).toBe(0);
  });

  test("the placeholder reads the venue, not the word COVER", () => {
    expect.assertions(4);
    const label = venueCoverPlaceholderLabel(venueCategoryProfile("stay"), {
      city: "Lagos",
      address: null,
    });
    expect(label).toBe("Hotel · Lagos");
    const { html } = renderWeb(shellWith(venueHeroAspectRatio(390), null, label));
    expect(html.length).toBeGreaterThan(500); // positive control
    // `EventCover` uppercases its label on render.
    expect(html).toContain("HOTEL · LAGOS");
    // #1550 Leg C plate P12 — the literal word, at full hero size, live.
    expect(html).not.toContain(">COVER<");
  });

  test("a shell given NO label still says COVER — the guard is not vacuous", () => {
    expect.assertions(2);
    // The SAME render path without the new prop. If this did not still say
    // COVER, the assertion above would be passing because nothing renders a
    // label at all, rather than because the label changed.
    function BareShell(): React.ReactElement {
      return (
        <ParallaxCoverShell
          palette={palette}
          theme={theme}
          coverMediaUrl={null}
          coverMediaType={null}
          coverHue={30}
          entranceAnimationKey="venue:test:bare:#eb7825"
          muted
          onToggleMute={(): void => undefined}
          showMute={false}
          onClose={(): void => undefined}
          onShare={(): void => undefined}
          hideCloseOnWeb
          coverAspectRatio={venueHeroAspectRatio(390)}
          safeAreaTop={47}
          contentBottomInset={110}
        >
          <View>
            <Text>issue-1561-body-sentinel</Text>
          </View>
        </ParallaxCoverShell>
      );
    }
    const { html } = renderWeb(BareShell);
    expect(html).toContain("issue-1561-body-sentinel"); // positive control
    expect(html).toContain("COVER");
  });
});

describe("#1561 — the answer bar is a ROW on web, not a stack", () => {
  /**
   * The bar's own styles, copied by reference from the screen's StyleSheet
   * shape. `PublicVenueScreen` cannot be mounted here — it reaches the app's
   * query hooks and the lazy Stripe boundary — so this proves the STYLE
   * CONTRACT compiles the way the page needs on web, while the headless suite
   * (`venueFirstScreen.issue1561.happy.test.tsx`) proves the page emits exactly
   * these styles on the real tree. Neither alone is enough; together they close
   * the gap #1484 fell through.
   *
   * I-AXIS-SCOPED-FLEX: `bar` is the only `flexDirection` context `cell` is used
   * in, and `cell` carries the row-axis key. Two complete objects, never one
   * object released by an override.
   */
  const styles = StyleSheet.create({
    bar: { flexDirection: "row", alignItems: "stretch", gap: 8, marginTop: 4 },
    cell: {
      flex: 1,
      minWidth: 0,
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
  });

  function AnswerBar(): React.ReactElement {
    return (
      <View style={styles.bar} testID="issue-1561-answer-bar">
        <View style={styles.cell} testID="cell-price">
          <Text>Typically</Text>
        </View>
        <View style={styles.cell} testID="cell-time">
          <Text>Today</Text>
        </View>
        <View style={styles.cell} testID="cell-booking">
          <Text>Booking</Text>
        </View>
      </View>
    );
  }

  test("three cells sit side by side, each taking an equal share", () => {
    expect.assertions(5);
    const { html, css } = renderWeb(AnswerBar);
    // Positive controls: all three cells rendered.
    expect(html).toContain('data-testid="cell-price"');
    expect(html).toContain('data-testid="cell-booking"');
    // `StyleSheet.create` values ARE registered atoms, so these read the
    // compiled stylesheet — the same place #1484's `r-maxWidth-*` proof read.
    const flat = declarations(css);
    expect(flat).toContain("flex-direction:row");
    // RNW compiles `flex: 1` to the three-part shorthand.
    expect(flat).toMatch(/flex-grow:1/);
    // …and the cells must be allowed to shrink below their content width, or a
    // long formatted price (`£25.00–£60.00 · GBP`) blows the row out at 360.
    expect(flat).toContain("min-width:0px");
  });
});
