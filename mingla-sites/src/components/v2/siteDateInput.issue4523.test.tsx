import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TripSearch } from "../../designs/shared/blocks/Hero";
import { SiteDateInput } from "./SiteDateInput";

describe("#4523 Sites date filters are picked on the Mingla calendar and still submit in a GET form", () => {
  it("SiteDateInput carries the value in a hidden input named for the query string", () => {
    const html = renderToStaticMarkup(<SiteDateInput name="from" defaultValue="2027-03-12" />);
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="from"');
    expect(html).toContain('value="2027-03-12"');
    expect(html).not.toContain('type="date"');
  });

  it("an empty filter submits an empty value and shows a placeholder, never today", () => {
    const html = renderToStaticMarkup(<SiteDateInput name="to" />);
    expect(html).toContain('name="to"');
    expect(html).toContain('value=""');
    expect(html).toContain("Choose a date");
  });

  it("the hero trip search has no browser date box, and from / to are still named inputs of the form", () => {
    const html = renderToStaticMarkup(<TripSearch action="/trips" id="t" />);
    expect(html).not.toContain('type="date"');
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="from"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="to"/);
    expect(html).toContain('action="/trips"');
  });
});
