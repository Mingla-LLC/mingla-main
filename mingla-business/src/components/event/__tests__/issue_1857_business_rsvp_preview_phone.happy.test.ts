import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const previewSource = readFileSync(
  join(__dirname, "../../../../app/rsvp/[id]/preview.tsx"),
  "utf8",
);
const foundationSource = readFileSync(
  join(__dirname, "../FoundationRsvpPreview.tsx"),
  "utf8",
);

describe("#1857 business RSVP preview phone contract", () => {
  test("the preview injects and the foundation forwards the country-aware renderer", () => {
    expect(previewSource).toContain("BusinessRsvpPhoneField");
    expect(previewSource).toContain("renderPhoneField={(args) => (");
    expect(previewSource).toContain(
      "defaultPhoneCountry={resolvePrimaryRsvpPhoneCountry(draft.currency)}",
    );
    expect(foundationSource).toContain("renderPhoneField={renderPhoneField}");
    expect(foundationSource).toContain(
      "defaultPhoneCountry={defaultPhoneCountry}",
    );
  });
});
