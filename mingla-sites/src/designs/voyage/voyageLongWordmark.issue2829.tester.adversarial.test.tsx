/**
 * #2829 R1 E15 — independent long-name boundary.
 *
 * The overflow rule targets a direct span under `.logo-lockup`. Both the
 * desktop header and mobile drawer must therefore put the whole wordmark in
 * that span; styling only the optional ampersand cannot contain a long name.
 *
 * Fails on revert: rendering `wordmark(siteName)` as bare text in the desktop
 * link leaves only one protected wordmark (the drawer) and this test goes red.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { VoyageHeader } from "./VoyageHeader";

describe("#2829 voyage long wordmark containment", () => {
  it("wraps the whole desktop and drawer wordmarks in the overflow target", () => {
    const longName = "NorthumberlandExpeditions".repeat(5);
    const html = renderToStaticMarkup(
      <VoyageHeader items={[]} logo={null} siteName={longName} cta={null} />,
    );

    expect(html.match(/class="logo-lockup"[^>]*><span>/g) ?? []).toHaveLength(2);
    expect(html).toContain(`<span>${longName}</span>`);
  });
});
