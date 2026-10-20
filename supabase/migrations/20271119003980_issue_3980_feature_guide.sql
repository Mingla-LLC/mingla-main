-- Issue #3980 — Feature Guide entries for the Work board, the Agent log, To
-- review and the Calendar.
-- Renames and rewrites five staff entries from the current production text
-- (written by 20271110003720_issue_3720_feature_guide_content_truth.sql):
-- "Drafts to send" becomes To review, "Content calendar" becomes Calendar,
-- and the host and creator pipelines, My agent and team roles entries gain
-- what Waves 1 to 3 of #3980 added. Adds two planned entries, Work board and
-- Agent log. Each saved entry's revision goes up by one with an audit row.
-- No status changes, no evidence rows: nothing here can make an entry Live,
-- and the new entries stay planned until their release record is added.
-- The apply stops if any of the five entries changed since this text was
-- written, so a newer edit is never overwritten.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation3980$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3980_feature_guide_foundation_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_truth_audit WHERE metadata->>'source' = 'issue_3720_feature_guide_content_truth') THEN
    RAISE EXCEPTION 'issue3980_feature_guide_needs_3982_first';
  END IF;
END;
$foundation3980$;

CREATE TEMP TABLE issue_3980_guide ON COMMIT DROP AS
SELECT *
  FROM jsonb_to_recordset($guide3980$
[
  {
    "capability_key": "staff-work-board",
    "is_new": true,
    "title": "Work board: plan, assign and close team work with agents",
    "outcome_summary": "The team plans and tracks operations work as cards on the Work board in Mingla Admin. Each card has instructions, a done-means line, one or more owners and watchers from the team, a due date, a weekly sprint and links to real hosts, creators, brands, events and content. People and their connected agents add cards straight to the board after server checks, start them, close them with proof or push them back with a reason. Search words: work board, tasks, to-do, sprint, assign work, cards, launch kit.",
    "how_to": "1. In Mingla Admin, open Pipeline > Work board. Cards are grouped by status: To do, Doing, Needs a person and Done this week. Switch the grouping to Person or Event, and the filter to Everyone, Mine or Watching.\n2. The sprint strip shows this week's sprint (Monday to Sunday), its goal and progress. Use the arrows to see other weeks.\n3. Press \"Add card\". Fill in Title, Instructions, Done means, Owners and Watchers (picked from current teammates) and a Due date, or link an event and the due date is counted back from its start. Press \"Add card\". If something is missing, Mingla lists what to fix and adds nothing.\n4. Click a card to open it on the right. Changes save as you make them. Press \"+ Link\" to link hosts, creators, brands, events, content or expected events. Owners and watchers get a notice when they are added.\n5. Press \"Start\" to begin, \"Close with proof\" to finish (write what shows it is done), or \"Push back\" to mark it not needed or already done, with a reason. A done card can be reopened. Most changes offer Undo for a few seconds.\n6. A giveaway and ads card that is held shows why. The owner or an admin can press \"Override\" and give a reason to let it start.\n7. Copy the agent prompt on the card to have your own agent do it, or press \"Plan this launch\" on an event in the Calendar to add the launch kit cards.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. Every card needs a title, instructions, a done-means line, at least one current teammate as owner and a due date, and every link must point to a record that exists; a card that repeats an open card is refused with a link to it. A card closes only with proof. Steps that send a message, spend money or publish an event wait in To review for a person; agents cannot do them. Giveaway and ads cards stay blocked until the event is public with at least 21 days left, unless the owner or an admin overrides with a reason. A go-live gate card closes itself when its event is public on Mingla. Removing a card is Owner and Admin only. Changes need a connection.",
    "support_wording": "Mingla's team tracks its own operations work, such as getting a host's event ready to go live, as cards on an internal Work board. Nothing on the board is sent to hosts or guests automatically; a team member sends every message.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "Claude Code or Codex on the person's own computer"
    ]
  },
  {
    "capability_key": "staff-agent-log",
    "is_new": true,
    "title": "Agent log: what every connected agent is doing",
    "outcome_summary": "A shared feed in Mingla Admin of what each teammate's connected agent did and is doing: cards added or refused, records claimed and released, steps posted, cards closed with proof, and messages that were stopped. It also lists which records are claimed right now, so no two agents do or send the same thing. Entries cannot be edited or removed. Search words: agent log, activity feed, claims, who is working on this, agent history.",
    "how_to": "1. In Mingla Admin, open Pipeline > Agent log.\n2. The feed on the left lists every entry, newest first: the person, their agent, what happened and the card it belongs to. Switch between \"All agents\" and \"Mine\", and press \"Show more\" for older entries.\n3. Click a card name to open it on the Work board.\n4. \"Claimed right now\" on the right lists each claim, who holds it, since when and when it ends. The owner and admins can press \"Release\" to free a claim an agent left behind.\n5. \"The rules every agent follows\" explains how agents read the log, claim, post updates and release.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. A claim ends by itself 30 minutes after its last update. While a record is claimed, another agent's change to it is refused and that agent is told who holds it; people can still make changes, and the log notes that they did. An agent cannot write a message for someone Mingla messaged in the last 3 days unless a person allows one more from the host or creator card. Refused messages, refused new cards and refused claims appear in the feed. Other refused changes, such as an agent's update to a host, creator, content or work card another agent has claimed, are told only to the agent that tried them and do not appear in the feed.",
    "support_wording": "The agent log is an internal Mingla Admin record of what the team's own AI agents did. Hosts and guests cannot see it.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-drafts",
    "is_new": false,
    "title": "To review: messages to send, spend and publish approvals",
    "outcome_summary": "Everything that needs a person lands in To review in Mingla Admin. On Messages, outreach your connected agent wrote for hosts and creators (follow-ups and replies) waits for you to review, copy and send yourself, and Mingla then records the touch on the host or creator card. On Spend or publish, work cards wait for someone to approve money or confirm an event is published. Search words: to review, drafts, approvals, mark sent, approve spend, publish, outreach drafts, follow-up.",
    "how_to": "1. In Mingla Admin, open Pipeline > To review. The menu count shows your waiting messages plus your cards that need a person.\n2. Messages: switch between \"Waiting\", \"Sent\" and \"Discarded\". On a draft, press \"Edit\" to change it, or \"Open host\" / \"Open creator\" to see the record.\n3. Press \"Copy and mark sent\" to copy the text, then send it yourself by email, WhatsApp, DM or phone. Mingla logs it as sent.\n4. Press \"Discard\" to drop a draft. Both actions offer Undo for a short time; Undo changes Mingla only and does not recall a message you already sent.\n5. Spend or publish: click a card to see its plan and result. Press \"Approve spend\" with a short note, \"Mark published\" once the event is public on Mingla, or \"Send back\" with a note for the owner. Each choice is logged under your name.\n6. If nothing is waiting, press \"Open My agent\" to connect an agent that can write drafts.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. Each person sees only their own message drafts; spend and publish cards show for their owners and watchers, and for the owner and admins. Mingla never sends a draft; the person sends it outside Mingla. Drafts are written by a connected agent (My agent), not created on this page. Approving spend records the decision and spends nothing, and Mark published only works once the event is public on Mingla. Agents cannot mark a message sent, approve spend or publish. Saving, marking and discarding need a connection.",
    "support_wording": "Mingla's team reviews every outreach message and every spend or publish decision by hand in an internal review queue. Mingla does not send these messages, spend money or publish events automatically.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-content-calendar",
    "is_new": false,
    "title": "Calendar: events, go-live deadlines, promotions and content",
    "outcome_summary": "The team sees every upcoming event, trip, experience and RSVP on Mingla next to planned social content on one calendar in Mingla Admin. Events are coloured by runway (how many days they were public before they start), events hosts have promised show dashed, and go-live deadlines and promotion start dates are marked. Content is still planned, approved and scheduled from Idea to Published in Calendar, Board and List views. Search words: calendar, content calendar, event runway, go-live deadline, promotions, social posts, schedule post, launch kit.",
    "how_to": "1. In Mingla Admin, open Pipeline > Calendar.\n2. Turn layers on and off: On Mingla, Expected, Go-live deadlines, Promotions and Content. Colours: green, public 28 days or more before it starts (full launch); amber, 21 to 27 days (tight); red, under 21 days (organic only, no giveaway or ads); dashed, promised on a host card and not public yet.\n3. Click an event to see, on the right, its runway bar, its launch kit steps and their cards, and its host. If it has no launch kit cards yet, press \"Plan this launch\" to see the proposed cards and the steps skipped, then press \"Add\" to put them on the Work board; their owners are told. With nothing selected, the right side lists upcoming events by runway.\n4. Content: press \"Add content\", type a title and press \"Add content\" again. The card starts in Idea and is assigned to you; Mingla warns if a similar title already exists.\n5. Click a content card to open it and fill in Title, Owners, Channels, Publish date and time, Copy, Notes, Drive link, Live link, Audience, City and Format. Changes can be commented on, and a card can be removed with \"Delete card\".\n6. Switch views with \"Calendar\", \"Board\" or \"List\". On the Board, move a card one stage at a time: Idea, Writing, Design, Review, Scheduled, Published. On the Calendar, drag a card to a new day to reschedule it.\n7. Moving to Scheduled needs a publish date and time and at least one channel. Moving to Published asks for the live link, or you can choose \"Publish without link\". Most changes offer Undo for a few seconds.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner (people who work the pipelines). The calendar shows events that are public on Mingla plus draft listings of brands linked to a host card; private and hidden events never show. Runway is worked out from when an event went public and its first date and cannot be typed. Promotions show the date giveaway and ads can start (21 days before the event) and content linked to the event through a work card. Moving to Published only records the card as published; the calendar does not post to any social network. Assets are shared as a Drive link, not uploaded. Cards can move forward only one stage at a time. Editing needs a connection; offline you can only read.",
    "support_wording": "Mingla's team plans its promotion of upcoming events and its social posts on an internal calendar. Posts are published by the team on each channel; the calendar itself does not post anything. Events listed at least four weeks before they start give the team time for giveaways, creators and ads.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-crm",
    "is_new": false,
    "title": "Host and creator pipelines",
    "outcome_summary": "The team tracks outreach to hosts (venues, restaurants, event organisers) and creators (ambassadors, UGC) on two boards in Mingla Admin: add a record, set owner, region and ICP, log activity, and move it through the stages. Each host card shows its events on Mingla with their runway, or the next event the host has promised and the date it must go public by. Beta leads can be added to Hosts, and owners and admins get a Team dashboard. Search words: CRM, pipeline, hosts board, creators board, outreach, leads, prospects, do not contact, expected event.",
    "how_to": "1. In Mingla Admin, open Pipeline > Hosts or Pipeline > Creators.\n2. Use the toolbar to search, filter by ICP, Region and \"Whose records\" (\"Everyone\" or \"Mine\"), and switch the View between \"Board\", \"List\" and \"By region\".\n3. Press \"Add host\" or \"Add creator\" to create a record; Mingla warns about possible duplicates.\n4. Click a card to open it. Changes save as you make them: Stage, ICP, Region, Channel, Source, Next action, Due, plus Followers, Agreement and Rate for creators. Mark a record Warm intro only or Do not contact with a one-line reason.\n5. Host stages: Prospect, Contacted, Replied, Meeting, Onboarded, Live, Lost. Creator stages: Identified, Contacted, Replied, Negotiating, Booked, Posted, Passed. Lost and Passed need a reason. Moves offer Undo.\n6. On a host card, \"On Mingla\" lists the linked brand's events with their runway; press one to see it on the Calendar. Under \"Expected next event\" add the event the host has promised (title, type and date) and press \"Save\": it shows dashed on the Calendar with its go-live deadline. Open work cards for the host are listed there too.\n7. If Mingla messaged someone in the last 3 days, their card says so; press \"Allow one more message\" with a reason if their agent really must write again sooner.\n8. Pipeline > Beta Leads: press \"Add to Hosts\" to turn a beta lead into a host record (once per lead).\n9. Owners and admins: Pipeline > Team dashboard shows hosts and creators by stage, everything due or overdue, monthly host targets, the Runway and Sprint panels, and how many host cards have no owner. The owner can also preview free-text next steps and turn the chosen ones into work cards, once per record.",
    "limitations": "Hosts, Creators and Beta Leads open for Owner, Admin, Sales and marketing and Founding partner. Team dashboard and Tool Leads are Owner and Admin only. A host moves to Live by itself when its brand's first listing goes live and cannot be dragged there by hand. Nothing here sends messages; outreach is sent by the person outside Mingla and logged. Records marked Do not contact or Warm intro only cannot have outreach logged. Expected events are for hosts only. Allowing one more message lasts 24 hours. Turning next steps into cards is Owner only, needs a confirm, and does not change the host or creator card.",
    "support_wording": "Mingla's team keeps track of hosts and creators it is talking to in an internal pipeline. If someone asks us to stop contacting them, the team marks their record Do not contact.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-my-agent",
    "is_new": false,
    "title": "My agent: connect your own Claude or Codex",
    "outcome_summary": "Team members connect their own Claude Code or Codex agent to Mingla. The agent works under the person's name and role: it can read and update their host and creator pipelines, log what happened, work the content calendar, write outreach drafts for review, and plan, claim, do and close work cards on the Work board with proof after reading the shared agent log. It never sends messages, spends money or publishes. Search words: my agent, AI agent, Claude, Codex, connect agent, agent key, MCP, work board.",
    "how_to": "1. In Mingla Admin, open System > My agent.\n2. Step 1, \"Copy your setup message\": choose your computer (\"macOS or Linux\" or \"Windows\") and copy the setup message for Claude or Codex. It works once, for 10 minutes.\n3. Step 2, \"Paste it into your agent\": paste it into Claude Code or Codex on your own computer and let it run the one command it contains.\n4. Step 3, \"Restart your agent, then just ask\": reopen the agent and ask \"What is on my plate in Mingla?\". If it fails, open \"Not working?\".\n5. Advanced lets you create a key by hand; it is shown once and hidden after 10 minutes.\n6. The page also lists \"What it can do now\", \"Work and calendar\", \"Not yet\", \"Guardrails\", suggested routines and \"What my agent did\". Try \"Plan the launch of [event] with the launch kit.\" or \"Do my cards for today.\" Use Disconnect to turn an agent off. Owners also see \"Agents on the team\" and can disconnect anyone's agent.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. One active key per person for each agent (one for Claude, one for Codex). The agent sees only what the person's role sees, cannot delete, manage keys or manage the team, never sends an email, DM or WhatsApp, may log only a cold first message, and cannot contact or unmark records set to Do not contact or Warm intro only. It must claim a record before changing it: a record another agent has claimed is refused until that claim is released or ends 30 minutes after its last update. It cannot close a work card without proof, mark a message sent, approve spend, publish, override a giveaway or ads block, or remove a card. Undoing a move, adding beta leads to Hosts and setting targets are not available to the agent yet. Claude in the browser or on a phone is not supported yet. A key unused for a set number of days (90 by default) is turned off. Windows setup is untested.",
    "support_wording": "Mingla team members can connect their own Claude Code or Codex agent to help with pipeline and operations work. The agent acts under their own name and permissions, and it never sends messages, spends money or publishes for them.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "Claude Code or Codex on the person's own computer"
    ]
  },
  {
    "capability_key": "staff-team-roles",
    "is_new": false,
    "title": "Invite teammates and set roles",
    "outcome_summary": "The owner invites people into Mingla Admin and sets their role: Admin, Sales and marketing, or Founding partner. Invitees get an email with a one-time link that expires in 7 days. Separately, admins give existing teammates a Community role (Moderator or Agent) under Community & Support, Team, People and roles, and grant support access from the Support desk.",
    "how_to": "Company access (owner): 1. In Mingla Admin open \"Team and roles\" under Company. 2. In \"Invite someone\", enter the \"Email address\", choose a role and send. 3. In \"People\", change a role from the row dropdown, \"Resend invite\", \"Invite again\" with a chosen role, or remove access (confirm \"Remove\"). Changes can be undone from the notice.\n\nCommunity roles (Owner or Admin): 1. Open \"Community & Support\", then \"Team\", then \"People and roles\". 2. Click \"Invite teammate\", enter their Email and Display name, pick \"Moderator\" or \"Agent\" and \"Save\". 3. Use \"Manage\" on a row to change or \"Remove role\". The table shows each person's Community role, Support, Available now and Last active.",
    "support_wording": "Only the account owner can invite people to Mingla Admin and set their role. Community and Support roles are given by an admin to people who are already on the team.",
    "limitations": "Team and roles is Owner only; nobody can change the owner's access. Invite links last 7 days, and changing a role or resending makes the old link stop working. An address that already has a Mingla account signing in another way (phone, Google or Apple) cannot be invited. In People and roles, \"Invite teammate\" does not send an invite: it assigns a role to someone who already has a Mingla profile with that email, and active Admins cannot be given a Community role. A Community role only opens the Community tabs for someone who is also an active Mingla Admin teammate. Removing access also turns off that person's agent keys. Every active teammate role can use the Work board, Agent log, To review and Calendar. The Team dashboard with its Runway and Sprint panels is Owner and Admin only, and turning free-text next steps into cards is Owner only.",
    "who_can_use": [
      "Owner",
      "Admin (Community roles only)"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  }
]
$guide3980$::jsonb) AS g(capability_key text, title text, outcome_summary text, how_to text, limitations text,
                       support_wording text, who_can_use jsonb, surfaces jsonb, is_new boolean);

-- The text each existing entry had when this was written.
CREATE TEMP TABLE issue_3980_guide_base ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('staff-content-calendar', 'af88495b7567a972ad3e012850c21064'),
    ('staff-crm', 'a3c26f9e8b9dc30b84cc5226f6ec8668'),
    ('staff-drafts', '4ba131260ca90c12412bfae6b01c7dc2'),
    ('staff-my-agent', 'e65bec6bf0abf506914e0aa9d9e84f26'),
    ('staff-team-roles', 'dfd12af9895e2a4bd1a51a9964b17e4e')
  ) AS b(capability_key, content_md5);

CREATE TEMP TABLE issue_3980_guide_live_before ON COMMIT DROP AS
SELECT count(*)::integer AS live_rows
  FROM public.product_capabilities c
 WHERE c.claimed_status = 'live'
   AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live';

DO $preflight3980$
DECLARE v_bad text;
BEGIN
  IF (SELECT count(*) FROM issue_3980_guide) <> 7
     OR (SELECT count(DISTINCT capability_key) FROM issue_3980_guide) <> 7
     OR (SELECT count(*) FROM issue_3980_guide WHERE is_new) <> 2 THEN
    RAISE EXCEPTION 'issue3980_feature_guide_payload_shape';
  END IF;
  IF EXISTS (SELECT 1 FROM issue_3980_guide
              WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')) THEN
    RAISE EXCEPTION 'issue3980_feature_guide_protected_live_entry';
  END IF;
  SELECT string_agg(g.capability_key, ', ' ORDER BY g.capability_key) INTO v_bad
    FROM issue_3980_guide g
   WHERE NOT g.is_new AND NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue3980_feature_guide_missing_capability: %', v_bad;
  END IF;
  SELECT string_agg(g.capability_key, ', ' ORDER BY g.capability_key) INTO v_bad
    FROM issue_3980_guide g
   WHERE g.is_new AND EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue3980_feature_guide_new_entry_exists: %', v_bad;
  END IF;
  SELECT string_agg(b.capability_key, ', ' ORDER BY b.capability_key) INTO v_bad
    FROM issue_3980_guide_base b
    JOIN public.product_capabilities c USING (capability_key)
   WHERE md5(concat_ws('|', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording)) <> b.content_md5;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue3980_feature_guide_entry_changed_since_written: %', v_bad;
  END IF;
  IF (SELECT count(*) FROM issue_3980_guide_base) <> 5
     OR EXISTS (SELECT 1 FROM issue_3980_guide g WHERE NOT g.is_new
                 AND NOT EXISTS (SELECT 1 FROM issue_3980_guide_base b WHERE b.capability_key = g.capability_key)) THEN
    RAISE EXCEPTION 'issue3980_feature_guide_base_shape';
  END IF;
END;
$preflight3980$;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET title = g.title,
         outcome_summary = g.outcome_summary,
         how_to = g.how_to,
         limitations = g.limitations,
         support_wording = g.support_wording,
         who_can_use = ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         surfaces = ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_3980_guide g
   WHERE c.capability_key = g.capability_key
     AND NOT g.is_new
     AND (c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording, c.who_can_use, c.surfaces)
         IS DISTINCT FROM
         (g.title, g.outcome_summary, g.how_to, g.limitations, g.support_wording,
          ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
          ARRAY(SELECT jsonb_array_elements_text(g.surfaces)))
  RETURNING c.id, c.revision, c.claimed_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', saved.id,
       jsonb_build_object('source', 'issue_3980_ops_board_feature_guide', 'issue', 3980,
                          'revision', saved.revision, 'claimed_status', saved.claimed_status, 'status_corrected', false)
  FROM saved;

WITH added AS (
  INSERT INTO public.product_capabilities(
    capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
    limitations, support_wording, claimed_status, required_evidence_kinds, verification_due_at
  )
  SELECT g.capability_key, g.title, g.outcome_summary,
         ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         g.how_to, g.limitations, g.support_wording, 'planned',
         ARRAY['source', 'test', 'live_check', 'release_record'], NULL
    FROM issue_3980_guide g
   WHERE g.is_new
  RETURNING id, revision, claimed_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', added.id,
       jsonb_build_object('source', 'issue_3980_ops_board_feature_guide', 'issue', 3980,
                          'revision', added.revision, 'claimed_status', added.claimed_status, 'status_corrected', false)
  FROM added;

DO $postcheck3980$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(c.capability_key, ', ' ORDER BY c.capability_key) INTO v_bad
    FROM public.product_capabilities c
    JOIN issue_3980_guide g USING (capability_key)
   WHERE concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording)
         ILIKE ANY (ARRAY['%follow the on-screen%', '%complete this job through%',
                          '%Support must use the current evidence status%', '%brand groups%', '%verified test%']);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue3980_feature_guide_wording: %', v_bad;
  END IF;
  IF (SELECT count(*)::integer FROM public.product_capabilities c
       WHERE c.claimed_status = 'live' AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live')
     <> (SELECT live_rows FROM issue_3980_guide_live_before) THEN
    RAISE EXCEPTION 'issue3980_feature_guide_live_count_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM issue_3980_guide g
               LEFT JOIN public.product_capabilities c USING (capability_key)
              WHERE c.id IS NULL OR c.title <> g.title OR c.how_to <> g.how_to OR c.limitations <> g.limitations
                 OR (g.is_new AND c.claimed_status <> 'planned')) THEN
    RAISE EXCEPTION 'issue3980_feature_guide_row_not_saved';
  END IF;
  IF (SELECT count(*) FROM public.product_truth_audit WHERE metadata->>'source' = 'issue_3980_ops_board_feature_guide') <> 7 THEN
    RAISE EXCEPTION 'issue3980_feature_guide_audit_missing';
  END IF;
END;
$postcheck3980$;

COMMIT;
