import fs from "node:fs";
import path from "node:path";

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");

describe("#2830 Ari owns Website setup without trapping the owner", () => {
  const screen = read("../../../screens/ari/AriChatScreen.tsx");
  const setupScreen = read("../../sites/setup/WebsiteSetupScreen.tsx");
  const route = read("../../../../app/brand/[id]/website/ari.tsx");
  const agentHook = read("../../../hooks/useAgentChat.ts");
  const agentService = read("../../../services/agentChatService.ts");

  // #2830 — setup with Ari is one screen now: old addresses land there, and the
  // chat beside the form takes its brand and step from the screen.
  it("sends old setup addresses to the one setup screen and keeps edit mode intact", () => {
    expect(route).toContain('requestedIntent === "setup"');
    expect(route).toContain("/website/setup?ari=1");
    expect(route).toContain("sitesIntent=edit");
    expect(screen).toContain("const websiteSetup = setup !== undefined");
    expect(screen).toContain('sitesIntent === "edit" || websiteSetup');
    expect(screen).toContain("legacySetupRoute");
    expect(screen).toContain("setCurrentBrandId(sitesBrandId)");
    expect(screen).toContain("ariWebsiteSetupConversationScopeKey");
    expect(screen).toContain(
      'chat.setWorkflowContext(websiteSetup ? "website_setup" : null)',
    );
    expect(agentHook).toContain("workflow_context: workflowContextRef.current");
    expect(agentService).toContain('workflow_context?: "website_setup"');
  });

  it("opens Ari beside the form and starts with the server's kickoff, before any draft", () => {
    expect(setupScreen).toContain('import("../../../screens/ari/AriChatScreen")');
    expect(screen).not.toContain("AriWebsiteSetupPane");
    expect(screen).toContain(".startWebsiteSetup(setupPart ?? null)");
    expect(screen).not.toContain("Check the live setup plan");
    expect(agentHook).toContain("website_setup_kickoff");
  });

  // [TEST-MOD-APPROVED #3355] P3 (3(b).5, I-ARI-NO-CLIENT-AUTHORED-CONTINUATION):
  // the chain still continues after each confirmed Website write, but the
  // server now owns it — the confirm response carries the next gap, already
  // saved as Ari's message — instead of the Host typing "Continue Website
  // setup: …" as the owner. The server side is pinned by
  // supabase/functions/_shared/__tests__/issue_3355_flow_engine.implementor.test.ts.
  it("continues the durable gap chain after each confirmed Website write", () => {
    expect(screen).toContain('result.kind === "executed"');
    expect(screen).not.toContain(
      "Continue Website setup: resume Fix all Website gaps",
    );
    expect(agentService).toContain('continuation: "server"');
  });

  it("never shows tool names or part keys in messages sent as the owner", () => {
    // These messages render as the owner's own chat bubble, so internal tool
    // names (get_site_plan) and part keys ("plan part is brand") must not leak.
    const sent = [
      ...screen.matchAll(
        /(?:sendMessage|handleSend)\(\s*([`"][\s\S]*?[`"])\s*[,)]/g,
      ),
    ].map((match) => match[1]);
    // [TEST-MOD-APPROVED #3355] one fewer: the client-authored continuation
    // after a confirm is gone (P3); the rest are still checked.
    // [TEST-MOD-APPROVED #2830] one fewer again (P4 D8): the setup kickoff is
    // a structured request now, not a message sent as the owner.
    // #2830: the pane's two scripted messages went with the pane.
    for (const message of sent) {
      expect(message).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(message).not.toMatch(/plan part is/);
      // #3355 bug 19 — no engine words either.
      expect(message).not.toMatch(
        /re-audit|checkpoint|fingerprint|part key|gap chain|durable job|brand[- ]context/i,
      );
    }
    expect(agentHook).toContain('WEBSITE_SETUP_KICKOFF_DISPLAY = "Set up my Website"');
  });

  it("never re-sends the automatic setup audit after it fails", () => {
    // Clearing the claimed key on failure re-armed the effect the moment
    // isSending flipped back, so one failed send became an endless resend
    // loop that kept the owner rate-limited (observed locally: hundreds of
    // RATE_LIMITED turns in minutes).
    // #2830 P0 — the claim now lives at module scope (survives remounts) and
    // the module exposes no release outside its test seam.
    const start = screen.indexOf("if (!claimWebsiteSetupAutoAudit(auditKey)) return;");
    const end = screen.indexOf("}, [", start);
    const effect = screen.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(effect).not.toMatch(/resetWebsiteSetupAutoAudits/);
    expect(effect).toContain("Use Retry on the message");
  });
});

describe("#2830 Ari asks brand details in the Host form's own shape", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const protocol =
    require("../renditions/ariRenditionProtocol") as typeof import("../renditions/ariRenditionProtocol");
  const { BRAND_CONTACT_EMAIL_RE } =
    require("../../../utils/brandContactEmail") as typeof import("../../../utils/brandContactEmail");
  const { COUNTRIES } =
    require("../../../../../packages/phone-input/countries") as typeof import("../../../../../packages/phone-input/countries");
  const { COUNTRY_DIRECTORY } =
    require("../../../../../packages/phone-input/countryDirectory") as typeof import("../../../../../packages/phone-input/countryDirectory");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const server = read(
    "../../../../../supabase/functions/_shared/agentWebsiteSetup.ts",
  );
  const phoneRules = read("../../brand/brandContactPhoneRules.ts");
  const preview = read("../renditions/AriRenditionPreview.tsx");
  const editRoute = read("../../../../app/brand/[id]/edit.tsx");
  const websiteNav = read("../../../sites/websiteNav.ts");

  const serverConstant = (name: string): string =>
    server.match(new RegExp(`${name} =\\s*\\n?\\s*("[^"]+"|/[^\\n]+/);`))?.[1] ??
    "";

  it("uses the form's exact phone and email rules on the server", () => {
    const formChooseCountry = phoneRules.match(
      /BRAND_PHONE_CHOOSE_COUNTRY_MESSAGE =\s*\n?\s*("[^"]+")/,
    )?.[1];
    expect(formChooseCountry).toBe('"Choose the country for this number."');
    expect(serverConstant("WEBSITE_SETUP_PHONE_CHOOSE_COUNTRY")).toBe(
      formChooseCountry,
    );
    expect(serverConstant("WEBSITE_SETUP_EMAIL_RE")).toBe(
      String(BRAND_CONTACT_EMAIL_RE),
    );
    // One phone parser: the server imports the shared owner, never its own.
    expect(server).toContain(
      'from "../../../packages/phone-input/phoneNumber.ts"',
    );
    for (const helper of [
      "parsePhoneEntry",
      "composePhoneE164",
      "phoneDialCodeForCountry",
      "resolvePhoneStartCountry",
    ]) {
      expect(server).toContain(helper);
    }
  });

  it("judges phone countries against the same directory the picker shows", () => {
    expect(COUNTRIES.map((country) => country.code)).toEqual(
      COUNTRY_DIRECTORY.map((country) => country.code),
    );
    expect(COUNTRIES.find((country) => country.code === "US")?.dialCode).toBe(
      "+1",
    );
  });

  it("renders a phone field as the Brand details country chip and sends its country", () => {
    const rendition = protocol.parseAriRendition({
      schema_version: 2,
      rendition_id: "website-setup:field-contact_phone",
      kind: "website-setup",
      title: "Contact phone",
      body: "What public contact phone number should the Website show?",
      blocks: [
        {
          type: "input",
          version: 1,
          id: "field-answer",
          field: {
            id: "contact_phone",
            label: "Contact phone — United States (+1)",
            value: "",
            placeholder: "Phone number",
            kind: "phone",
            countryIso: "US",
          },
        },
      ],
      actions: [
        {
          id: "continue-with-ari",
          label: "Continue with Ari",
          style: "primary",
          behavior: {
            type: "submit",
            message:
              "Use my answer for Contact phone, confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap.",
          },
        },
      ],
    });
    expect(rendition?.schema_version).toBe(2);
    if (rendition?.schema_version !== 2) return;
    const block = rendition.blocks[0];
    expect(block.type === "input" && block.field.kind).toBe("phone");
    expect(block.type === "input" && block.field.countryIso).toBe("US");
    const message = protocol.buildAriRenditionSubmission({
      rendition,
      action: rendition.actions![0],
      selectedOptionIds: [],
      fieldValue: "212 555 0134",
      fieldCountryIso: "US",
    });
    expect(message).toContain("\nCountry: US\nResponse: 212 555 0134");
    // No chosen country: nothing is invented on the client either.
    expect(
      protocol.buildAriRenditionSubmission({
        rendition,
        action: rendition.actions![0],
        selectedOptionIds: [],
        fieldValue: "212 555 0134",
        fieldCountryIso: null,
      }),
    ).not.toContain("Country:");
    expect(preview).toContain('variant="phone"');
    expect(preview).toContain("countryIso={block.field.countryIso}");
    expect(preview).toContain("defaultCountryIso={props.countryIso}");
    expect(preview).toContain("fieldCountryIso,");
  });

  it("hands uploads and approval to routes that really exist", () => {
    expect(server).toContain("/brand/${brandId}/edit?section=${handoff.section}");
    expect(server).toContain('section: "photo"');
    expect(server).toContain('section: "cover"');
    expect(editRoute).toContain('value === "photo"');
    expect(editRoute).toContain('value === "cover"');
    expect(server).toContain("/brand/${brandId}/website/plan?part=approve");
    // #2830 — the old plan address lands on that step of the setup screen.
    expect(websiteNav).toContain('first === "plan" && !second');
    expect(websiteNav).toContain("validStep(search.part)");
  });
});
