import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFollowupText } from "../index.ts";

Deno.test("#1973 create follow-up reports only the canonical stored draft lifecycle", () => {
  const canonicalDraft = {
    event: {
      title: "  Sunset pottery walk  ",
      status: "draft",
      visibility: "draft",
      published_at: null,
    },
  };

  const copy = buildFollowupText("create_experience", canonicalDraft);
  assertEquals(copy, 'Created draft experience "Sunset pottery walk".');
  assertEquals(copy?.includes("Published"), false);
});

Deno.test("#1973 create follow-up never fabricates an outcome without matching readback", () => {
  assertEquals(
    buildFollowupText("create_experience", {
      title: "Caller-requested title is not canonical readback",
    }),
    undefined,
  );
  assertEquals(
    buildFollowupText("create_experience", {
      event: {
        title: "Unexpected lifecycle",
        status: "scheduled",
        visibility: "public",
        published_at: "2026-08-20T20:00:00.000Z",
      },
    }),
    undefined,
  );
  assertEquals(
    buildFollowupText("create_experience", {
      event: {
        title: "Incomplete readback",
        status: "draft",
        visibility: "draft",
      },
    }),
    undefined,
  );
});
