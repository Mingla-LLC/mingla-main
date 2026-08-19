const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

const coverAttestation = await read(
  "../../event-cover-attest-selection/index.ts",
);
const liveEditor = await read(
  "../../../../mingla-business/src/components/event/EditPublishedScreen.tsx",
);
const workflow = await read(
  "../../../../.github/workflows/issue-1972-ari-event-lifecycle.yml",
);

Deno.test("#1972 provider cover metadata is never copied from caller-authored fields", () => {
  for (
    const unsafeBinding of [
      "p_credit: asString(body.credit)",
      "p_credit_url: asString(body.credit_url)",
      "p_alt: asString(body.alt)",
    ]
  ) {
    if (coverAttestation.includes(unsafeBinding)) {
      throw new Error(
        `cover attestation persists unverified caller metadata: ${unsafeBinding}`,
      );
    }
  }
});

Deno.test("#1972 Business live save uses one durable mutation owner", () => {
  const start = liveEditor.indexOf("const handleConfirmSave = useCallback(");
  const end = liveEditor.indexOf("const handleModalClose", start);
  if (start < 0 || end < 0) {
    throw new Error("unable to locate live save handler");
  }
  const saveHandler = liveEditor.slice(start, end);
  const mutationCalls = [
    "patchPublishedEventCore(",
    "setEventCover(",
    "clearEventCover(",
    "patchPublishedEventTaxonomy(",
    "patchPublishedEventWhen(",
    "patchPublishedEventTheme(",
    "patchPublishedEventPricingSwitches(",
  ].filter((call) => saveHandler.includes(call));
  if (mutationCalls.length > 1) {
    throw new Error(
      `one save handler can commit through multiple durable owners: ${
        mutationCalls.join(", ")
      }`,
    );
  }
});

Deno.test("#1972 dedicated workflow runs when any lifecycle runtime owner changes", () => {
  for (
    const requiredPath of [
      "supabase/functions/agent-chat/**",
      "supabase/functions/_shared/agentToolAuthorization.ts",
      "supabase/functions/_shared/agentToolHelpers.ts",
      "supabase/functions/_shared/agentSystemPrompt.ts",
    ]
  ) {
    if (!workflow.includes(`- \"${requiredPath}\"`)) {
      throw new Error(
        `dedicated #1972 workflow omits lifecycle runtime path: ${requiredPath}`,
      );
    }
  }
});
