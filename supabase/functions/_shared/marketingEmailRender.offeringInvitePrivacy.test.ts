import { renderMarketingEmail } from "./marketingEmailRender.ts";

const MARKER = "__MINGLA_OFFERING_INVITE_URL_V1__";
const base = {
  variables: {
    first_name: "Ada",
    event_name: "Dinner",
    event_date: null,
    event_time: null,
    doors_open: null,
    ends_at: null,
    brand_name: "Mingla",
    event_url: null,
    spots_left: null,
    previous_event_name: null,
    next_event_name: null,
    event_id: null,
  },
  embedded_events: [],
  unsubscribe_url: "https://example.test/unsubscribe",
  subject: "Invitation",
  brand_name: "Mingla",
};

Deno.test("issue #1770 volatile email marker bypasses click persistence", () => {
  const rendered = renderMarketingEmail({
    ...base,
    body_html: `<a href="${MARKER}">Open event</a>`,
    offering_invite_url_marker: MARKER,
  });
  if (rendered.links.some((link) => link.destination_url.includes(MARKER))) {
    throw new Error("volatile marker entered tracked links");
  }
  if (!rendered.html.includes(MARKER) || !rendered.text.includes(MARKER)) {
    throw new Error("volatile marker was lost before provider substitution");
  }
});

Deno.test("issue #1770 volatile email marker count fails closed", () => {
  for (const body_html of ["No marker", `${MARKER}${MARKER}`]) {
    let failed = false;
    try {
      renderMarketingEmail({
        ...base,
        body_html,
        offering_invite_url_marker: MARKER,
      });
    } catch (error) {
      failed = error instanceof Error &&
        error.message === "offering_invite_volatile_link_invalid";
    }
    if (!failed) throw new Error("bad volatile marker count was accepted");
  }
});
