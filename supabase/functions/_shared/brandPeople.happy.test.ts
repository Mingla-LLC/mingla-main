import { safeBrandPersonResolution } from "./brandPeople.ts";

Deno.test("issue #1770 shared owner validates resolver shape", () => {
  const result = safeBrandPersonResolution({
    personId: "person",
    sourceLinkId: "link",
    linkOutcome: "already_linked",
    conflictId: null,
  });
  if (result.linkOutcome !== "already_linked") {
    throw new Error("outcome drifted");
  }
});
