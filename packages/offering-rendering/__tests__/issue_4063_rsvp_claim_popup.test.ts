import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const popup = await Deno.readTextFile(
  new URL("../RsvpSuccessPopup.tsx", import.meta.url),
);
const body = await Deno.readTextFile(
  new URL("../RsvpOfferingBody.tsx", import.meta.url),
);
const host = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/components/event/FoundationRsvpPreview.tsx",
    import.meta.url,
  ),
);

Deno.test("#4063 preserves QR by default and adds an RSVP claim branch", () => {
  assertStringIncludes(popup, 'passPresentation = "qr"');
  assertStringIncludes(popup, 'passPresentation === "claim"');
  assertStringIncludes(popup, "Your pass is waiting in the Mingla app.");
  assertStringIncludes(popup, "Get my pass");
  assertStringIncludes(popup, 'accessibilityLabel="Close"');
});

Deno.test("#4063 threads the public RSVP claim through shared state", () => {
  assertStringIncludes(body, "shortUrl: result.claim?.shortUrl ?? null");
  assertStringIncludes(body, "renderClaimBody={props.renderClaimBody}");
});

Deno.test("#4063 Business RSVP bodies use claim presentation", () => {
  assertStringIncludes(host, 'passPresentation="claim"');
  assertStringIncludes(host, 'passPresentation: "claim"');
});
