import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

const migration = read("../supabase/migrations/20270711001780_issue_1780_wizard_invite_plans.sql"); // [TEST-MOD-APPROVED #1780] renumbered above the merge train
const service = read("src/services/offeringInvitePlanService.ts");
const hook = read("src/hooks/useOfferingInvitePlan.ts");
const picker = read("src/components/invites/InvitePeopleStep.tsx");
const worker = read("../supabase/functions/offering-invite-dispatch/index.ts");

describe("issue #1780 — wizard invite plan implementation", () => {
  test("private plan owns selection while outbox alone owns delivery state", () => {
    expect(migration).toContain("CREATE TABLE private.brand_offering_invite_plans");
    // [TEST-MOD-APPROVED #1780] The binding metadata-only contract names the
    // canonical table without the superseded publish_outbox suffix.
    expect(migration).toContain("CREATE TABLE private.brand_offering_invite_plan_members");
    expect(migration).toContain("CREATE TABLE private.brand_offering_invite_outbox");
    expect(migration).not.toContain("CREATE TABLE private.brand_offering_invite_publish_outbox");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("state text NOT NULL DEFAULT 'pending'");
    const planTable = migration.slice(
      migration.indexOf("CREATE TABLE private.brand_offering_invite_plans"),
      migration.indexOf("CREATE TABLE private.brand_offering_invite_mutation_receipts"),
    );
    expect(planTable).not.toMatch(/queued|sent|failed|provider|channel/);
  });

  test("manual groups expand to a sorted explicit active snapshot with a hard 500 cap", () => {
    expect(migration).toContain("public.marketing_manual_group_memberships");
    expect(migration).toContain("public.marketing_audiences");
    expect(migration).toContain("gm.state='active'");
    expect(migration).toContain("bp.record_status='active'");
    expect(migration).toContain("array_agg(id ORDER BY id)");
    expect(migration).toContain("cardinality(v_ids)>500");
    expect(migration).not.toMatch(/LIMIT\s+500/i);
  });

  test("client sends exact revision receipts, never channels, and uses the shared key factory", () => {
    expect(service).toContain("p_expected_revision");
    expect(service).toContain("p_client_request_id");
    expect(service).not.toMatch(/p_channels|inviteChannels|invitationChannels/);
    expect(hook).toContain("marketingKeys.offeringInvites.plan");
    expect(hook).toContain("marketingKeys.offeringInvites.quote");
    expect(hook).not.toMatch(/queryKey:\s*\[/);
  });

  test("shared picker covers every approved source and publication trust copy", () => {
    expect(picker).toContain("Everyone in Your Book");
    expect(picker).toContain("Saved groups");
    expect(picker).toContain("Choose people");
    expect(picker).toContain("Nothing sends yet");
    expect(picker).toContain("Nothing sends until this");
    expect(picker).toContain("You can invite up to 500 people");
    expect(picker).toContain('snapPoint="full"');
    expect(picker).toContain("Search by name, email, or phone");
    expect(picker).toContain("Done · ${props.selectedCount} selected");
    expect(picker).toContain("Your Book is empty");
    expect(picker).toContain("No people match this search");
    expect(picker).toContain("minHeight: 64");
    expect(picker).toContain('label={props.loadingMore ? "Loading…" : "Load more"}');
    expect(hook).toContain("useInfiniteQuery");
    expect(hook).toContain("getNextPageParam: (page) => page.nextCursor");
  });

  test.each([
    ["event", "src/components/event/EventCreatorWizard.tsx", "Settings", "Invite people", "Preview"],
    ["RSVP", "src/components/rsvp/RsvpCreatorWizard.tsx", "RSVP", "Invite people", "Preview"],
    ["experience", "src/components/experience/ExperienceCreatorWizard.tsx", "Cover", "Invite people", "Review"],
    ["trip", "src/components/trip/TripCreatorWizard.tsx", "Traveler info", "Invite people", "Review"],
  ])("%s step map places Invite immediately before review", (_kind, file, before, invite, after) => {
    const source = read(file);
    expect(source.indexOf(before)).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(invite)).toBeGreaterThan(source.indexOf(before));
    expect(source.indexOf(after, source.indexOf(invite))).toBeGreaterThan(source.indexOf(invite));
    expect(source).toContain('useFeatureFlag("business_wizard_invite_selection_v1")');
    expect(source).toContain("InvitePlanReviewSummary");
  });

  test("all four authoritative publish calls carry receipt only when a plan is confirmed", () => {
    const owners = [
      read("src/services/businessEvents.ts"),
      read("src/services/rsvpEvents.ts"),
      read("src/components/experience/ExperienceCreatorWizard.tsx"),
      read("src/services/tripsService.ts"),
    ];
    for (const owner of owners) {
      expect(owner).toContain("invite_selection_revision");
      expect(owner).toContain("invite_selection_confirmed");
    }
    expect(migration).toContain("wizard_invite_publish_confirmation_required");
    expect(migration).toContain("'status','not_requested'");
    expect(migration).toContain("'status','empty'");
    for (const functionName of [
      "issue_1719_publish_event_with_poster",
      "issue_1719_publish_experience_with_poster",
      "business_publish_rsvp_graph",
      "biz_publish_trip_command",
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
      const end = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 30);
      const owner = migration.slice(start, end < 0 ? migration.length : end);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(owner).toContain("private.enqueue_wizard_invites_on_publish_v1");
    }
  });

  test("all four wizards block navigation and revalidate plan plus quote before publish", () => {
    for (const file of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
      "src/components/trip/TripCreatorWizard.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain('inviteNavigation?.phase !== "ready"');
      expect(source).toContain("inviteNavigation?.primaryLabel ?? \"Checking…\"");
      expect(source).toContain("refreshAuthoritative()");
      expect(source).toContain("inviteQuote.selectionHash === invitePlan.selectionHash");
      expect(source).toContain("checkingInvitePublish");
    }
    expect(hook.match(/AppState\.addEventListener\("change"/g)).toHaveLength(2);
    expect(hook.match(/void refreshAuthoritative\(\)\.catch/g)).toHaveLength(2);
  });

  test("dirty retry receipts, unique-person counts, and canonical currency remain explicit", () => {
    expect(picker).toContain("pendingReceipt.current");
    expect(picker).toContain("We couldn’t save that selection. It is still here and has not been discarded.");
    expect(picker).toContain('primaryLabel: "Saving…"');
    expect(picker).toContain('primaryLabel: "Try again"');
    expect(picker).toContain('Metric label="Can receive" value={q.canReceiveCount}');
    expect(picker).toContain('Metric label="Skipped" value={q.skippedCount}');
    expect(worker).toContain("new Set(");
    expect(worker).toContain("resolveWizardQuoteCurrency(");
    expect(worker).toContain("wizard_invite_currency_mismatch");
  });

  test("receipt replay precedes mutable draft, feature, group, and person validation", () => {
    const replace = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.biz_replace_offering_invite_plan_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.biz_clear_offering_invite_plan_v1"),
    );
    const replay = replace.indexOf("IF FOUND THEN");
    expect(replay).toBeGreaterThan(0);
    for (const mutableGuard of [
      "v_scope.event_status<>'draft'",
      "business_wizard_invite_selection_v1",
      "marketing_audiences",
      "marketing_manual_group_memberships",
    ]) {
      expect(replace.indexOf(mutableGuard)).toBeGreaterThan(replay);
    }
    expect(replace).toContain("array_agg(DISTINCT x::uuid ORDER BY x::uuid)");
    expect(replace).toContain("DETAIL=jsonb_build_object('currentRevision'");
    expect(replace).not.toMatch(/DETAIL=.*brand_person|DETAIL=.*personIds/i);
  });

  test("worker resumes a sealed group and zero-reachable jobs before crypto/provider work", () => {
    // [TEST-MOD-APPROVED #1780] Resume truth is derived from #1770 by the
    // stable outbox client_request_id; no group/snapshot lives on the outbox.
    const resume = worker.indexOf("job.committedGroupId !== null");
    const quote = worker.indexOf('"biz_offering_send_quote_candidates"', resume);
    const zero = worker.indexOf('"issue_1780_complete_wizard_invite_outbox_no_recipients_v1"', quote);
    const pepper = worker.indexOf("await resolveOfferingInviteTokenPepper()", zero);
    const execution = worker.indexOf('"issue_1780_execute_wizard_invite_outbox_v1"', pepper);
    const handoff = worker.indexOf("dispatchCommittedWizardGroup", execution);
    expect(resume).toBeGreaterThan(0);
    expect(quote).toBeGreaterThan(resume);
    expect(zero).toBeGreaterThan(quote);
    expect(pepper).toBeGreaterThan(zero);
    expect(execution).toBeGreaterThan(pepper);
    expect(handoff).toBeGreaterThan(execution);
  });

  test("database execution cannot mark durable intent successful before provider handoff", () => {
    const execute = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION private.execute_brand_offering_invite_wizard_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION private.issue_1780_stamp_new_wizard_invite_origin"),
    );
    // [TEST-MOD-APPROVED #1780] The metadata-only outbox may not persist a
    // group id; #1770 owns it under client_request_id=v_job.id.
    expect(execute).toContain("public.biz_execute_offering_send_group(");
    expect(execute).toContain("v_job.id,v_seal.execution_snapshot");
    expect(execute).not.toMatch(/UPDATE private\.brand_offering_invite_outbox/);
    expect(execute).not.toContain("send_group_id");
    expect(execute).not.toContain("state='succeeded'");
    expect(migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_outbox_v1"))
      .toBeGreaterThan(migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1780_execute_wizard_invite_outbox_v1"));
  });

  test("binding actor audit columns retain canonical auth-user foreign keys", () => {
    const privateSchema = migration.slice(
      migration.indexOf("CREATE TABLE private.brand_offering_invite_plans"),
      migration.indexOf("CREATE OR REPLACE FUNCTION private.issue_1780_selection_hash"),
    );
    // [TEST-MOD-APPROVED #1780] The binding SPEC requires these three actor
    // columns to retain canonical auth.users references; the old assertion
    // directly contradicted that approved retention contract.
    expect(privateSchema).toMatch(/created_by uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
    expect(privateSchema).toMatch(/updated_by uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
    expect(privateSchema).toMatch(/added_by uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
  });

  test("non-target surfaces do not import selection or outbox truth", () => {
    for (const area of ["../mingla/app", "../mingla-web", "../mingla-admin"]) {
      const absolute = path.join(root, area);
      if (!fs.existsSync(absolute)) continue;
      const stack = [absolute];
      while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const target = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(target);
          else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
            expect(fs.readFileSync(target, "utf8")).not.toMatch(/biz_(?:get|replace|clear)_wizard_invite_plan_v1|brand_offering_invite_wizard_/);
          }
        }
      }
    }
  });

  test("flag rollback skips empty-plan Edge quotes but preserves selected-plan recovery", () => {
    const summaryHook = hook.slice(hook.indexOf("export function useOfferingInvitePlanSummary"));
    const emptyGuard = summaryHook.indexOf(
      "input.quoteWhenEmpty === false && nextPlan.selectedCount === 0",
    );
    const quoteCall = summaryHook.indexOf("quoteWizardInvitePlan", emptyGuard);
    expect(summaryHook).toContain("input.quoteWhenEmpty !== false || plan.data.selectedCount > 0");
    expect(emptyGuard).toBeGreaterThan(0);
    expect(quoteCall).toBeGreaterThan(emptyGuard);

    for (const file of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
      "src/components/trip/TripCreatorWizard.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("quoteWhenEmpty: inviteFlag.data === true");
      expect(source).toContain("const inviteRollbackReady =");
      expect(source).toContain("inviteFlag.data === false");
      expect(source).toContain("selectedCount === 0");
    }
  });

  test("experience legacy publish cannot serialize a stale invite receipt", () => {
    const experience = read("src/components/experience/ExperienceCreatorWizard.tsx");
    const publishPayload = experience.slice(
      experience.indexOf('supabase.rpc("issue_1719_publish_experience_with_poster"'),
      experience.indexOf("if (error !== null)", experience.indexOf(
        'supabase.rpc("issue_1719_publish_experience_with_poster"',
      )),
    );
    expect(publishPayload).toContain("publish && inviteEnabled && invitePlan?.selectionRevision");
    expect(publishPayload).toContain("invite_selection_confirmed: invitePlan.selectedCount > 0");
  });

  test("experience Cover copy follows live-edit, invite-enabled, and rollback navigation", () => {
    // [TEST-MOD-APPROVED #1780] Invite-enabled creation continues through
    // Invite and Review; flag-off creation retains its legacy Cover-final copy;
    // live edit saves an already-published offering from the Cover step.
    const cover = read("src/components/experience/ExperienceCoverStep.tsx");
    const experience = read("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(experience).toContain("isLiveEdit={isLiveEdit}");
    expect(experience).toContain("hasInviteStep={inviteEnabled}");
    expect(cover).toContain("isLiveEdit = false");
    expect(cover).toContain("hasInviteStep = false");
    expect(cover).toContain("hasInviteStep?: boolean;");
    expect(cover).toContain("then save your changes.");
    expect(cover).toContain("Next, invite people or skip invites, then review and publish.");
    expect(cover).toContain("You can publish now to make this experience bookable");
    expect(cover.indexOf(": hasInviteStep")).toBeGreaterThan(
      cover.indexOf("{isLiveEdit"),
    );
    expect(cover.indexOf("You can publish now")).toBeGreaterThan(
      cover.indexOf(": hasInviteStep"),
    );
  });

  test("each Invite step has one viewport-owned header with complete safety copy", () => {
    // [TEST-MOD-APPROVED #1780] Parent-owned wizard headers suppress the
    // shared visual header; Trip delegates header ownership to the shared step
    // only on wide web, where its mobile header is absent. Compact rail copy
    // remains short while each active header carries the full safety promise.
    const event = read("src/components/event/EventCreatorWizard.tsx");
    const rsvp = read("src/components/rsvp/RsvpCreatorWizard.tsx");
    const trip = read("src/components/trip/TripCreatorWizard.tsx");
    const experience = read("src/components/experience/ExperienceCreatorWizard.tsx");

    expect(picker).toContain("showHeader?: boolean;");
    expect(picker).toContain("showHeader = true");
    expect(picker).toContain("{showHeader ? <>");
    expect(picker).toContain('accessibilityRole="header" style={styles.title}');

    expect(event).toContain("showHeader={false}");
    expect(event).toContain(
      "Choose people from Your Book. Nothing sends until this event is published.",
    );
    expect(event).toContain('{ title: "Invite people", subtitle: "Choose people from Your Book" }');
    expect(event).toContain('accessibilityRole={currentStep === 6 ? "header" : undefined}');

    expect(rsvp).toContain("showHeader={false}");
    expect(rsvp).toContain(
      "Choose people from Your Book. Nothing sends until this RSVP is published.",
    );
    expect(rsvp).toContain('{ title: "Invite people", subtitle: "Choose people from Your Book" }');
    expect(rsvp).toContain('accessibilityRole={currentStep === 5 ? "header" : undefined}');

    expect(trip).toContain("showHeader={isWideDesktop}");
    expect(trip).toContain(
      "Choose people from Your Book. Nothing sends until this trip is published.",
    );
    expect(trip).toContain('7: "Choose people from Your Book"');
    expect(trip).toContain('accessibilityRole={step === 7 ? "header" : undefined}');

    expect(experience).not.toMatch(/<InvitePeopleStep[\s\S]*?showHeader=/);
  });
});
