-- Issue #3720 — Feature Guide content truth.
-- Replaces the generated placeholder wording on 149 Feature Guide entries with
-- code-checked customer wording, corrects mis-pinned source and test evidence
-- (pinned at 52cb68950ef3a1c86d23090d9c21dbadae970eef), and records two
-- planned-status corrections (events-invite-people, trips-cancel-booking).
-- The three human-verified Live entries are never touched, and nothing here can
-- make an entry Live: only source/test/migration evidence is recorded.
-- INVARIANT: {"id":"I-3720-FEATURE-GUIDE-CONTENT-TRUTH","rule":"Feature Guide entries carry no generated placeholder wording; a content correction never edits a human-verified Live entry, never adds live_check, release_record or deployment evidence, and never changes how many entries are claimed and effectively Live."}

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3720_content_truth_foundation_missing';
  END IF;
END;
$foundation$;

CREATE TEMP TABLE issue_3720_content_truth ON COMMIT DROP AS
SELECT *
  FROM jsonb_to_recordset($catalog$
[
  {
    "capability_key": "account-delete",
    "title": "Delete your account",
    "outcome_summary": "Explorers and Hosts can permanently delete (close, remove, erase) their Mingla account from inside the app. Explorer deletion removes the profile, boards, friends and activity. Host deletion removes brands, events, team access and public pages and disconnects the payout bank. Mingla checks first and stops a Host deletion while live or upcoming events still have tickets, bookings or money in progress.",
    "how_to": "Mingla Explorer (iOS and Android): open the Profile tab, tap \"Account Settings\", scroll to \"The Red Zone\" and tap \"Delete My Account\". On \"Are you sure?\" tap \"Delete my account\" (or \"Never mind\" to stop). When it finishes the app shows \"Account Deleted\" and signs you out. If the same login also has an active Host account, it shows \"Explorer Profile Deleted\" instead and the login keeps working for Mingla Host.\n\nMingla Host (iOS, Android and web): open the Account tab (on a wide web screen, the account button at the top right), then under Settings tap \"Delete account\" (also reachable from \"Edit profile\"). Step 1 \"Delete your Mingla Host account?\": tap \"Continue\". Step 2 \"Here's what you'll lose\" lists brands, events, ticket sales, door sales, comp guests and team invitations; Mingla checks your account here. If something must be finished first you see \"You can't delete your account yet\" with the reasons, plus \"Go to Home\" and \"Close\". Otherwise tap \"Continue\". Step 3: type your account email (or the word DELETE if no email is on file) and tap \"Delete my account\". Step 4 shows \"Account and login deleted\", or \"Business Account Deleted\" when the login is kept.",
    "limitations": "Host deletion is refused, and nothing is changed, while any of these exist: live or upcoming events with tickets or RSVPs (cancel the event so buyers are refunded, or wait until it ends), a checkout in progress, upcoming table reservations, open stay bookings, open menu orders, a payout or refund still in progress, or a partner payment still in progress. Events with no tickets or RSVPs are taken down automatically.\n\nThe login is not always removed. If the same login still has an active Explorer or Host side, only the side you deleted goes. A Host who ever owned a brand keeps the login so sales and ticket records stay intact; the Host account, brands and public pages are still removed.\n\nFull erasure of a user who created events is blocked by an open defect (#2285): events cannot be hard deleted, so such requests need engineering help.\n\nIf the connection drops during a Host deletion the app says it could not confirm the result; trying again is safe. On Explorer a slow request shows a timeout message and the account may already be deleted. If Apple \"Hide My Email\" was used, the person may also need to remove Mingla from their Apple ID settings. The Explorer retained message still names the Host app by an older name.",
    "support_wording": "You can delete your account in the app: in Mingla Explorer go to Profile, Account Settings, then Delete My Account; in Mingla Host go to Account, then Delete account. If you are a Host with live or upcoming events that have tickets or bookings, or a payout still in progress, the app will tell you what to finish first and nothing is deleted until then. If you used the same login for both apps, deleting one side keeps your login for the other.",
    "who_can_use": [
      "Explorer",
      "Host",
      "Brand owner"
    ],
    "surfaces": [
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "account-explorer-onboarding",
    "title": "Explorer onboarding: phone check, interests, launch-city check",
    "outcome_summary": "New Explorers set up their account step by step after signing in: language, phone number check with a text code, name and details, the vibes they like, location, place categories, how they get around and how far they will travel, friends, group plans and a consent screen. If they are outside a live Mingla city they pick a live city to explore instead. If they quit midway, setup resumes where they left off (sign up, getting started, first run).",
    "how_to": "After signing in for the first time, Mingla Explorer opens onboarding automatically.\n1. Pick your language.\n2. \"What's your number?\": enter your phone and tap \"Send code\". On \"Enter the code\" type the code and tap \"Verify\". If it does not arrive, after the countdown choose \"Resend SMS\" or \"Call me instead\".\n3. \"Tell us about you.\" and \"Almost done.\": add your details.\n4. \"Now the fun part.\": tap every vibe that sounds like you.\n5. Location: \"Better spots start here\", tap \"Continue\" to allow location. Mingla then checks whether you are in a live city (\"Checking your city\"). If you are not, you see \"We're not in your city yet\"; tap \"Choose a city to explore\", pick from the list and tap \"Explore\" with the city name.\n6. \"What kind of places do you love?\", \"How do you get around?\" and \"How far will you go?\".\n7. \"Your inner circle\": add friends and tap \"Pair\" (optional).\n8. \"Plan it together\": start a group or join a chat you are invited to.\n9. \"One quick thing\": the consent screen, then Mingla builds your first set of picks.",
    "limitations": "Mingla Explorer iOS and Android only. Location is required for the main flow; if location is off the app asks you to turn it on in Settings. The phone code is sent by text first; the app offers \"Resend SMS\" and \"Call me instead\". The server also supports WhatsApp, but the app shows no WhatsApp button. A phone number already used by another account is refused. If the city check fails, the person can tap \"Try again\" or \"Continue anyway\" with their current location. If no city is live at all, the screen \"We're almost ready\" shows a \"Notify me\" button, but that button only continues setup with the current location; it does not sign the person up for any alert.",
    "support_wording": "When you first sign in, Mingla Explorer walks you through a short setup: your language, a code sent to your phone, your interests, your location and a few preferences. If you leave partway, it picks up where you stopped. If Mingla is not live where you are yet, you can choose one of the live cities to explore.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "SMS"
    ]
  },
  {
    "capability_key": "account-explorer-sign-in",
    "title": "Sign in to Explorer with Apple, Google or an emailed code",
    "outcome_summary": "Explorers sign in or create an account (log in, sign up, register) in Mingla Explorer with Apple, Google, or a 6-digit code sent to their email. Signing in with a new email creates the account. The email option also lets a ticket buyer sign in with the address they used at checkout so their ticket can be linked.",
    "how_to": "Open Mingla Explorer. On the welcome screen:\n- iPhone: tap \"Continue with Apple\".\n- Any device: tap \"Continue with Google\".\n- Email: tap \"Continue with email\", type your address and tap \"Email me a code\". Enter the 6-digit code and tap \"Sign in\". If it did not arrive, wait for the countdown and tap \"Send a new code\".\nNew accounts then go to setup. If sign-in fails, the app shows \"Couldn't sign you in\"; tap again.",
    "limitations": "\"Continue with Apple\" shows on iPhone only; Android users use Google or email. Mingla Explorer is a mobile app; there is no Explorer web sign-in. A new code can be requested every 30 seconds. Apple users who chose \"Hide My Email\" have a relay address on file, which can matter later when linking a ticket bought with their real email.",
    "support_wording": "You can sign in to Mingla Explorer with Google, with Apple on iPhone, or with a 6-digit code we email you. If you bought a ticket without an account, sign in with the email you used at checkout so the ticket can be linked to you.",
    "who_can_use": [
      "Explorer",
      "Buyer"
    ],
    "surfaces": [
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Email"
    ]
  },
  {
    "capability_key": "account-host-sign-in",
    "title": "Sign in to Mingla Host with Google, Apple or an emailed code",
    "outcome_summary": "Hosts sign in or create an account (log in, sign up, register) in Mingla Host with Google, Apple, or a 6-digit code sent to their email. The same sign-in works on the iPhone app, the Android app and the web app; a new email creates a new Host account.",
    "how_to": "Open Mingla Host (app or web). On the welcome screen:\n- Tap \"Continue with Google\".\n- On iPhone or web, tap \"Continue with Apple\".\n- Or tap \"Continue with Email\", type your address and tap \"Send code\". Enter the 6-digit code from your inbox. Use \"Resend code\" if it did not arrive, or \"Wrong email? Edit\" to change the address; \"Back to sign-in options\" returns to the start.\nOn web, Google and Apple open their own sign-in page and then return you to Mingla Host.",
    "limitations": "\"Continue with Apple\" is shown on iPhone and web, not on Android. Too many code requests in a short time show a wait message. A store-review account uses a separate sign-in path. If a sign-in was meant for a different email (for example a team invite), the app shows a wrong-account screen.",
    "support_wording": "You can sign in to Mingla Host with Google, with Apple on iPhone or web, or with a 6-digit code we email you. The same login works in the app and on the web.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin",
      "Scanner"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "account-launch-cities",
    "title": "Which cities Explorer is open in",
    "outcome_summary": "Mingla Explorer opens city by city. During setup the app checks whether the person's location is inside a live launch city (where Mingla is available, open or launched). Outside one, they can pick a live city to explore instead. Mingla staff decide which cities are live.",
    "how_to": "Explorer: during setup, after allowing location, the app shows \"Checking your city\". Inside a live city, setup continues. Outside, it shows \"We're not in your city yet\"; tap \"Choose a city to explore\", search with \"Search live cities\", pick one and tap \"Explore\" with the city name. Your picks are then based on that city.\n\nMingla staff: in Mingla Admin open \"Launch Cities\" (\"Flip a city live to let people there start onboarding.\"). Use the map pin button to set a city's boundary, then turn on the \"Live\" toggle. The summary shows how many cities are \"Live for consumers\".",
    "limitations": "The live list is set by Mingla staff in Mingla Admin and can change at any time, so check Admin for the current list. No city is live by default; the setting starts off for every city. A city needs a boundary for the location match to work. The check is a simple map rectangle around each city, so edges can be approximate. It runs only during Explorer setup on iOS and Android, not for Hosts or buyers. If the check fails, people can \"Try again\" or \"Continue anyway\" with their own location. If no city is live, setup continues with the person's location.",
    "support_wording": "Mingla is opening city by city, and our team decides which cities are live. If you are outside a live city, you can still choose one of our live cities to explore during setup.",
    "who_can_use": [
      "Explorer",
      "Mingla Support"
    ],
    "surfaces": [
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Mingla Admin"
    ]
  },
  {
    "capability_key": "account-notification-settings",
    "title": "Choose which notifications you get",
    "outcome_summary": "Explorers and Hosts choose which alerts they receive (notification preferences, turn off or mute notifications). Explorers pick per type and per channel: in-app, push, email and text. Hosts turn groups such as order activity, payments, reviews and team updates on or off, with push and in-app choices for each alert.",
    "how_to": "Mingla Explorer: Profile tab, \"Account Settings\", open \"Notification Settings\". \"Push Notifications\" turns push on or off for the whole app. Below, each type (grouped under Purchases, Reservations, Reminders, Marketing and Social) has chips for \"In-app\", \"Push\", \"Email\" and \"Text\" where that channel applies. Under Marketing, \"Brands you follow\" then \"Manage\" sets push, email and text for each brand.\n\nMingla Host: Account tab, under Settings tap \"Notifications\". Turn on or off \"Order activity\", \"Payments & trust\", \"Audience & content\", \"Brand team\", \"Scanner activity\" and \"Marketing\". Expand a group to set \"PUSH\" and \"IN-APP\" for each alert inside it.",
    "limitations": "Some Explorer types are marked \"Always on\" and cannot be turned off. With push off for the whole app, push chips are greyed out but email and text still follow their own settings. Text is offered only for types that support it. On Mingla Host, \"Scanner activity\" is saved on the device only, and Host settings offer push and in-app only (\"Marketing\" covers Mingla newsletter and product updates). If a change fails to save, the app shows an error and puts the setting back.",
    "support_wording": "You can choose which notifications you get. In Mingla Explorer go to Profile, Account Settings, Notification Settings; in Mingla Host go to Account, then Notifications. Some essential messages, such as purchase confirmations, may always be sent.",
    "who_can_use": [
      "Explorer",
      "Host"
    ],
    "surfaces": [
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Push notifications",
      "Email",
      "SMS"
    ]
  },
  {
    "capability_key": "account-settings",
    "title": "Language, currency, privacy and quiet hours",
    "outcome_summary": "Explorers manage their account settings (preferences): app language, country (which sets currency and distance units), birthday, gender, who can see their profile, whether friends see their activity, anonymous analytics sharing, and whether messages can reach them during quiet hours.",
    "how_to": "In Mingla Explorer open the Profile tab and tap \"Account Settings\".\n- \"The Basics\": \"Country\" (\"Affects currency and units across the app\"; confirm on \"Update country?\"), \"Birthday\", \"Gender\" and \"Language\".\n- \"Privacy\": \"Profile Visibility\" (\"Friends Only\", \"Everyone\" or \"Nobody\"), \"Show Activity\", \"Analytics\" and \"Notifications\".\n- \"Quiet Hours\": shows \"10 PM - 8 AM\" as active; turn \"Messages during quiet hours\" on to allow direct messages in that window.\n- \"App Information\": app version and \"Contact Support\".",
    "limitations": "Mingla Explorer only; Mingla Host has its own Account settings. Currency is not chosen directly; it follows the country you pick. The language list has 29 languages. Quiet hours are fixed at 10 PM to 8 AM and cannot be changed or turned off; only the direct-message exception can be toggled. If a save fails the app shows an error.",
    "support_wording": "In Mingla Explorer go to Profile, then Account Settings, to change your language, country (which sets your currency and units), birthday, profile visibility and activity sharing. Quiet hours run from 10 PM to 8 AM, and you can choose whether direct messages still come through then.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "account-switch-explorer-host",
    "title": "Switch between Explorer and Host in one app",
    "outcome_summary": "Switching between the Explorer side and the Host side (toggle accounts, change mode) from inside one app is not available. People use Mingla Explorer and Mingla Host as two separate apps, and the same login can work in both.",
    "how_to": "There is no switch to use. To act as a Host, open or install Mingla Host and sign in with the same login; to explore as a guest, open Mingla Explorer. Record the request if a customer asks for an in-app switch.",
    "limitations": "Not built. A preview row (\"Switch to Business\" in Explorer, \"Switch to Explorer\" in Host) exists only in internal development builds and does nothing beyond a placeholder; it is hidden in store and web releases.",
    "support_wording": "Mingla does not currently offer a way to switch between Explorer and Host inside one app. You can use the same login in both the Mingla Explorer app and the Mingla Host app.",
    "who_can_use": [
      "Explorer",
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "ari-explorer-assistant",
    "title": "An AI assistant inside Explorer",
    "outcome_summary": "Explorer users cannot chat with an AI assistant or chatbot inside the Mingla Explorer app yet. A conversational assistant for Explorer (sometimes called Mingla Brain) is on the long-term roadmap only. Explorer users still get AI-picked plans and recommendations in the swipe deck.",
    "how_to": "There is nothing to open. The Explorer app has no assistant, chatbot or Ari screen. If an Explorer user asks for one, record the request as feedback. Ari, the AI assistant, exists only inside the Mingla Host app for brand teams.",
    "limitations": "Not built. Listed under Later in the product roadmap. No Explorer screen, route or service calls an assistant. Ari is available only to Host users in Mingla Host.",
    "support_wording": "There is no AI assistant or chatbot in the Mingla Explorer app yet. Ari, our AI assistant, is only available to hosts inside the Mingla Host app. We have noted your interest.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "ari-host-assistant",
    "title": "Ari, the Host assistant that can draft and do tasks after you confirm",
    "outcome_summary": "Ari is the AI assistant (AI co-pilot, chatbot) inside Mingla Host. Hosts chat with Ari to answer questions about their brand and to draft and carry out work: create or update brands, events, RSVPs, experiences, trips and venue listings, manage tickets, team and scanners, look up orders, analytics and payouts, refund orders, handle trip instalments, plan and launch ads, and draft or send campaigns. Ari never changes anything until you tap Confirm on its proposal card, and risky or money actions need a typed word such as REFUND.",
    "how_to": "1. Open Mingla Host (iOS, Android or web) and tap the Ari tab in the bottom bar.\n2. The first time, read the Meet Ari screen and tap Got it, let's start.\n3. Type in the Ask Ari box. Tap the plus button to attach context: Photos (JPG, PNG, WebP or HEIC) or Documents (PDF, DOCX, TXT or CSV).\n4. Ari answers questions directly. When it wants to create or change something it shows a proposal card with Cancel, Edit and Confirm. Check the details, then tap Confirm.\n5. For destructive or money actions the card asks you to type a word first, for example REFUND to refund an order, CANCEL to cancel an event or trip booking, CHARGE to charge an instalment now, SEND to send a campaign now, LAUNCH to launch an ad, or DELETE to delete your account. Deleting a brand needs the brand name typed.\n6. Ari works on the brand selected at the top; use the brand switcher to change brand. Past chats are in the conversation drawer, where you can rename or delete them.",
    "limitations": "Visible to brand roles Finance manager, Event manager, Brand admin and Brand owner. Hidden from Scanner and Marketing manager roles. A signed-in user with no brand yet also sees Ari so they can create their first brand. Each action is still checked against the person's role on the server, so Ari cannot do anything the person could not do themselves. Limit of 200 messages per person in 24 hours, and one confirmed action can run at a time. The Ari tab can be switched off for the whole app by a Host app setting (on by default). Website editing through Ari only works for brands in the Mingla Sites pilot. Ari can make mistakes and is not a financial, legal or tax advisor.",
    "support_wording": "Ari is the AI assistant in the Mingla Host app. Open the Ari tab, ask in plain words, and Ari will answer or show a card you must confirm before anything is created or changed; refunds and other risky actions also ask you to type a confirmation word. Ari is available to finance managers, event managers, admins and owners on a brand, not to scanners or marketing managers.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Signed-in host with no brand yet"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "brand-audit-log",
    "title": "Brand audit log",
    "outcome_summary": "Brand owners and brand admins can open an audit log (activity history) of recorded actions on a brand, such as payout account changes, payouts and refunds, orders, legal acceptances and operations, newest first, with a filter by category.",
    "how_to": "1. Go to the Account tab, tap the brand under \"Your brands\" to open its brand page.\n2. In the Operations list, tap \"Audit log\" (subtitle \"Recent actions on this brand\"). This row only appears for brand owners and brand admins.\n3. Use the filter chips at the top (\"All\", \"Payout account\", \"Payouts & refunds\", \"Orders\", \"Legal\", \"Ops\", \"Other\") to narrow the list.\n4. Each entry shows what happened, how long ago, who did it (shown as \"User\" plus the last 6 characters of their account ID, or \"System\") and what it affected.\n5. Tap \"Load more\" at the bottom to see older entries.\nThe screen is the same on iOS, Android and web.",
    "limitations": "Only brand owners and brand admins can open it; other roles see \"Insufficient permissions\". The person who acted is shown as a short account code, not a name or email. Only actions the server records are listed (mostly payout account, payout, refund, order, legal and operations events); ordinary profile or event edits may not appear. The screen banner says you see events tied to your account, but the server rules also let brand admins and owners read all entries recorded for the brand, so the list can include other team members and system actions. Category filtering applies to the entries already loaded, so a filter can look empty until you tap \"Load more\". Read only: entries cannot be edited, deleted or exported.",
    "support_wording": "Brand owners and brand admins can see a brand's audit log in Mingla Host: open the brand from the Account tab and tap Audit log in the Operations list. It lists recorded actions such as payout account changes, payouts, refunds and orders, and you can filter by category. Other team roles cannot open it.",
    "who_can_use": [
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "brand-create",
    "title": "Create one or more brands and switch between them",
    "outcome_summary": "A host can create as many brands (organiser profiles, business pages) as they need from one Mingla Host account and switch between them with the brand switcher. Setup walks through brand name and bio, an optional address, an optional cover, payout setup and what to make first.",
    "how_to": "Create a brand:\n1. Tap the brand chip at the top of the Home, Hub, Blast or Account tab to open \"Switch brand\".\n2. Tap \"Create a new brand\".\n3. Brand step (\"Create brand\"): enter \"Brand name\" and an optional \"Short bio (optional)\", then \"Continue\".\n4. Place step (\"Add an address?\"): pick an address or tap \"Skip for now\".\n5. Look step (\"Add a cover (optional)\"): add a cover or tap \"Skip\".\n6. Payouts step (\"Get paid when people book\"): choose your payout country and tap \"Set up payouts\", or tap \"Set up payouts later\".\n7. Create step (\"What do you want to make first?\"): pick Event, Trip, Experience, RSVP or Venue, or leave and come back later.\nPartners who are enabled for client setup first see \"Who's this brand for?\" and can choose \"I'm setting it up for a client\", which ends with \"Invite the owner\" instead of payouts.\nSwitch brands: tap the brand chip, then tap a brand in the \"Switch brand\" list; the current brand shows \"Current brand\" with a tick. You can also open any brand from Account > \"Your brands\".\nSame flow on iOS, Android and web.",
    "limitations": "The payout country can be skipped during setup and chosen later, but it sets the currency for your prices, and drafts you create lock to the brand's currency, so choose it before building paid listings. Free events, trips, experiences, RSVPs and venue listings can be published without a bank; collecting money needs payouts set up (brands on the Nigerian payout rail can sell before adding a bank, and the money waits). The brand web address (URL) is fixed when the brand is created. Client-setup mode is only shown to accounts enabled as Mingla Partners. Deleting a brand from the switcher (trash icon) is only offered on brands you own.",
    "support_wording": "You can create more than one brand in Mingla Host: tap your brand name at the top of the screen, then Create a new brand, and follow the steps. To move between brands, tap the brand name again and pick another brand. Payout setup can be skipped at first, but pick your payout country before you build paid listings because it sets your currency.",
    "who_can_use": [
      "Host",
      "Brand owner"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "brand-organiser-terms",
    "title": "Accept the Organiser Terms before publishing paid listings or connecting payouts",
    "outcome_summary": "Before a host publishes anything paid (paid event tickets, trips, experiences or stays) or connects payouts, Mingla Host asks them to read and accept the Mingla Organiser Terms (seller agreement, terms of service). Accepting once per brand lets the interrupted publish continue automatically.",
    "how_to": "1. Build a listing with at least one paid ticket or price and tap \"Publish event\" (or the publish button for a trip, experience or stay), or start payout setup.\n2. If you have not accepted the current terms for this brand, the \"Accept Organiser Terms\" sheet opens with a short summary.\n3. Optionally tap \"Read the full Organiser Terms at usemingla.com/organiser-terms\" to open them in your browser.\n4. Tick \"I agree to the Mingla Organiser Terms (Version 1.0)\".\n5. Tap \"Accept and continue\". The sheet closes and the publish you started carries on to the confirmation.\nSame on iOS, Android and web.",
    "limitations": "Free listings are not gated. Acceptance is recorded per team member per brand, so each person who publishes paid listings on a brand accepts for themselves, and a member of two brands accepts on each. When Mingla publishes a new terms version, everyone is asked again. The server also refuses paid publishes from anyone who has not accepted the current version, so older app versions cannot skip it. If the terms cannot load, the sheet shows \"Try again\".",
    "support_wording": "Before you publish a paid listing or connect payouts, Mingla Host asks you to accept the Organiser Terms. Tick the box and tap Accept and continue, and your publish carries on. Each team member accepts once per brand, and you may be asked again if the terms are updated.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "brand-pricing-defaults",
    "title": "Default rules for who covers fees and VAT",
    "outcome_summary": "A brand can set default pricing rules for who pays the VAT, the Mingla fee and the service fee: added to the ticket price for buyers, or covered by the host. Every new event, trip and experience starts from these defaults (fee pass-through, absorb fees, all-in pricing), with a live example of what the buyer pays and what you keep.",
    "how_to": "1. Go to Account > \"Your brands\", open the brand.\n2. In the Operations list tap \"Pricing defaults\" (subtitle \"Who covers VAT and fees by default\").\n3. Under \"Who covers the costs?\" set each row:\n   - \"VAT\": \"Included in price\" or \"I'll cover it\".\n   - \"Mingla fee\": \"Add to price\" or \"I'll cover it\".\n   - \"Service fee\": \"Add to price\" or \"I'll cover it\".\n4. Each change saves straight away. The preview shows \"Buyer pays\" and \"You keep\" for an example order.\n5. If VAT shows \"Set up VAT\", add an active tax registration in Payments first.\nInside the event, trip or experience pricing step the same section shows \"Using your brand defaults\" with an \"Edit defaults\" link, and you can override it for that one listing.\nSame on iOS, Android and web.",
    "limitations": "Only brand owners, brand admins, event managers and finance managers can change defaults; others see the rows as \"Unavailable\". Passing VAT to buyers needs an active tax registration on the brand. Defaults apply to new listings; existing listings keep their own settings. On a listing, pricing locks once the first ticket sells. Until the brand has a payout currency the example is shown as a plain number with no currency symbol.",
    "support_wording": "In Mingla Host, open your brand and tap Pricing defaults to choose whether buyers pay the VAT, Mingla fee and service fee on top of your price or whether you cover them. New events, trips and experiences start from these settings, and you can change them per listing until the first ticket sells.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "brand-profile",
    "title": "Edit your brand profile, cover and logo",
    "outcome_summary": "Hosts can edit their brand's public profile page: brand photo (logo, avatar), display name, tagline, bio, cover photo, GIF or video, public page theme, address, contact email and phone, social links (website, Instagram, TikTok, X, Facebook, YouTube, LinkedIn, Threads) and whether the attendee count shows.",
    "how_to": "1. Go to Account > \"Your brands\" and tap the brand (or open it from the brand chip).\n2. Tap \"Edit brand\" at the bottom of the brand page.\n3. Tap the pencil on the brand photo to pick a logo from your device.\n4. Edit the ABOUT section (name, \"Short tagline\", bio), BRAND COVER (\"Add cover\" or \"Change cover\"), PUBLIC PAGE THEME, ADDRESS, CONTACT and SOCIAL LINKS.\n5. Under DISPLAY, switch \"Show attendee count\" on or off.\n6. Tap \"Save\" at the top. Leaving with unsaved edits asks \"Discard changes?\".\n7. Tap \"View public page\" on the brand page to check how it looks.\nSame on iOS, Android and web.",
    "limitations": "Saving profile changes needs a brand owner or brand admin (the server refuses other roles even though the role description for marketing managers mentions editing the profile). The brand web address (URL) cannot be changed after creation. The brand photo can only come from your device library. Brand cover photos and GIFs must be under 8 MB; covers can also be a video, which uses the same video pipeline as event covers and its open issues (#3040). \"Delete brand\" in the Danger zone hides the brand; it can be recovered for 30 days through support.",
    "support_wording": "To update your brand page, open the brand in Mingla Host and tap Edit brand. You can change the logo, name, tagline, bio, cover, theme, address, contact details and social links, then tap Save. Your brand's web address cannot be changed after the brand is created.",
    "who_can_use": [
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "brand-team-roles",
    "title": "Invite your team with roles: owner, admin, event manager, finance manager, marketing manager, scanner",
    "outcome_summary": "Brand owners and admins can invite teammates (staff, co-hosts, team members) to a brand by email and give each a role: Brand owner, Brand admin, Event manager, Finance manager, Marketing manager or Scanner. They can also revoke pending invitations, remove members and hand over ownership.",
    "how_to": "1. Open the brand (Account > \"Your brands\") and tap \"Team & permissions\".\n2. Tap \"+\" (\"Invite team member\").\n3. Enter \"Name\" and \"Email\", tap the Role field and pick a role. Tap \"Roles explained\" to see what each role does.\n4. If you pick Brand owner, choose under \"After they accept\": \"I leave this brand\" (default) or stay as admin.\n5. Tap \"Send invitation\". They get an email link that expires in 7 days, and appear under \"PENDING INVITATIONS\".\n6. Tap a person to \"Revoke invitation\" or \"Remove from team\"; accepted people are listed under \"ACTIVE MEMBERS\".\nWhat each role can do in the app:\n- Brand owner: everything, and the only role that can connect or change the payout bank account and invite a new owner.\n- Brand admin: brand settings and profile, team invites and removals, audit log, viewing payouts and refunds.\n- Event manager: create and edit events, manage tickets, scanners and comp guests.\n- Finance manager: view payouts and balances, issue refunds, change pricing settings.\n- Marketing manager: the brand Website workspace and marketing tools.\n- Scanner: scan tickets at the door.\nSame on iOS, Android and web.",
    "limitations": "Only brand owners and brand admins can invite or remove people; only the current brand owner can invite a new brand owner. There is no way to change an existing member's role; remove them and invite again. The brand owner cannot be removed. One pending invite per email at a time. Roles are ranked, so higher roles generally can do what lower ones can, with one exception: payout views are limited to owner, admin and finance manager (event managers cannot see payouts). The marketing manager role description mentions editing the brand profile, but saving profile changes needs admin or above. Door scanners for a single event can also be invited from the event's Scanners screen.",
    "support_wording": "Brand owners and admins can invite teammates from the brand's Team & permissions screen in Mingla Host, choosing Brand owner, Brand admin, Event manager, Finance manager, Marketing manager or Scanner. The invite link is emailed and lasts 7 days. To change someone's role, remove them and send a new invite with the right role.",
    "who_can_use": [
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "checkout-claim-ticket",
    "title": "Add a ticket you bought as a guest to your account",
    "outcome_summary": "Bought a ticket or RSVP'd on the web without an account? Connect that ticket (attendance) to your Mingla app account so it shows in your tickets, you join the event group chat and you can see who's going. Search words: claim ticket, connect attendance, guest checkout, ticket missing from app, link ticket to account.",
    "how_to": "1. Open the confirmation email from your web purchase or RSVP and tap its Mingla app button (the attendance link).\n2. On a phone, the web page says \"Open Mingla to connect your attendance\". Tap Open Mingla (or Get Mingla to install it first). On a computer, the page shows a code to scan so you can continue on your phone.\n3. In the Explorer app the \"Connect attendance\" sheet opens. If you are not signed in, tap Sign in and use the same email or phone you used at checkout.\n4. Tap Connect attendance. If the app needs to confirm your inbox it shows \"Email me a code\"; enter the code and tap Confirm and connect.\n5. When it works you see \"You're in\" and can tap Open the chat (or See who's going if the event has no group chat).\nIf the link has expired, just sign in to the app with the email or phone used at checkout and the ticket will be waiting.",
    "limitations": "Works for tickets and RSVPs bought on Mingla's buyer web pages. The ticket can only be connected to an account that uses the same email or phone as the purchase; if you are signed in with a different address the sheet asks you to sign out and sign in with the right one. Links can expire or be refused after too many attempts (\"Try again in a few minutes\"). If the organiser made the guest list private, you are connected but cannot see the guest list. The final step happens in the Explorer app on iOS or Android, not in a desktop browser.",
    "support_wording": "Open your confirmation email on your phone and tap the Mingla button, then sign in to the Mingla app with the same email or phone you used at checkout and tap Connect attendance. If the link has expired, just sign in to the app with that same email or phone and your ticket will be waiting on your account.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Buyer web (email landing page)",
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "checkout-free",
    "title": "Free tickets and RSVPs",
    "outcome_summary": "Get a free ticket or RSVP to a free event without paying anything. Guests reserve free tickets with their name, email and mobile, or answer Going, Maybe or Can't go on an RSVP event. Search words: free ticket, reserve free ticket, RSVP, free event, no payment, guest list sign-up.",
    "how_to": "Free ticketed event, web: open the event page, tap Get tickets, pick a free ticket and tap Reserve free ticket. Enter Full name, Email and Mobile number under Buyer details, agree to the terms and tap Reserve free ticket. The confirmation page says \"You're in\" and shows your QR code.\nFree ticketed event, Explorer app (iOS and Android): open the event, tap Get tickets, choose the free ticket and tap Claim Free Ticket.\nRSVP event: open the event link and choose Going, Maybe or Can't go. Guests without an account give name, email and phone; signed-in app users do not need to retype them. Free trips and experiences use Reserve free spot the same way.",
    "limitations": "No card or payment step is shown for free orders. Free tickets still respect the host's capacity, sale window and per-order limits, and a tier may need host approval. RSVP events can have a guest limit and a waitlist, and a host can approve or deny RSVPs. Hosts can cancel free orders. RSVP events may optionally ask for a voluntary Chip In gift, which is a separate paid step.",
    "support_wording": "Free tickets need no payment: tap Get tickets, choose the free ticket and confirm with your name, email and mobile number, and your QR code appears straight away. For RSVP events just choose Going on the event page; the host may need to approve you or put you on a waitlist if it is full.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "checkout-hidden-link",
    "title": "Unlisted events sold by direct link",
    "outcome_summary": "Sell tickets to an event that is not listed publicly: set the event to Unlisted and only people with the direct link can see it and buy tickets. Search words: hidden event, unlisted event, private link, secret link, direct link tickets, not on discovery.",
    "how_to": "Host app (iOS, Android, web): in the event creator's Settings step, under Visibility choose Unlisted (\"Only people with the direct link can see this event\"). Publish, then share the event's link (mingla web address /e/your-brand/your-event) with the people you want.\nBuyer: open the shared link and tap Get tickets; checkout works the same as for a public event.",
    "limitations": "Unlisted events do not appear in public discovery, but anyone who has the link can open it and buy, so it is not access control. To restrict who can buy, use a password-protected tier or the Eligible buyers setting instead. Separately, a single ticket tier can be set to \"Hidden, direct link only\" in the tier's Visibility picker, but hidden tiers are left off the online ticket list and the checkout refuses them, so they cannot currently be bought online. The Private option is a different setting.",
    "support_wording": "To sell to a closed audience, set the event to Unlisted and share its link: it won't show in discovery, but anyone with the link can buy. Hiding an individual ticket type does not currently make it buyable from a link, so use an Unlisted event or a password-protected ticket instead.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Host app (iOS, Android, web)",
      "Buyer web"
    ]
  },
  {
    "capability_key": "checkout-nigeria",
    "title": "Pay in naira with Paystack",
    "outcome_summary": "Guests buying from a Nigerian host pay in naira (NGN) through Paystack's secure payment page, by card, bank transfer or the other options Paystack shows. Covers tickets, trips, experiences, table deposits and venue orders. Search words: naira, NGN, Paystack, Nigeria payment, pay in Nigeria, Lagos.",
    "how_to": "Web: open the event and tap Get tickets, choose tickets, fill in Your details and continue to Payment. The screen says \"You'll be taken to our secure payment page\". Tap Pay and you are sent to Paystack's page to finish, then brought back to the confirmation page.\nExplorer app (iOS and Android): tap Get tickets, then Continue to Payment. Paystack's page opens in an in-app browser; after paying, the app checks the order and shows \"You're booked\".\nThe same path is used automatically for any brand that is set up to get paid in Nigeria; the guest does not choose the provider.",
    "limitations": "Only for brands whose payout country is Nigeria and who sell in NGN. Guests from anywhere can pay a Nigerian brand, in naira. Apple Pay and Google Pay inside the app apply to card (Stripe) brands, not Paystack brands. Ghana and other African markets are not supported yet. If the guest leaves Paystack's page without paying, no ticket is issued.",
    "support_wording": "Events from Nigerian hosts are paid in naira on Paystack's secure page: tap Pay, finish on the Paystack page, and you'll come back to your confirmation. If you closed the page before paying, no money was taken and you can start the checkout again.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "checkout-order-page",
    "title": "Order page with your QR code",
    "outcome_summary": "See your order, ticket QR code, order status and any refunds after buying. Right after checkout the confirmation page shows \"You're in\" with your QR codes, and the confirmation email carries your tickets as a PDF with a QR code for entry. Search words: receipt, order page, my ticket, QR code, lost ticket, refund status, order confirmation.",
    "how_to": "Right after paying (web): the confirmation page shows \"You're in\", the order summary and a QR code for each ticket.\nBy email: the confirmation email has your tickets attached as a PDF, each with its own QR code.\nOrder page: the web address /o/your-order-id shows the event, order summary, a status banner (for example \"You're in. Show the QR at the door.\"), the QR code while the ticket is valid, and Refund history if there were refunds.\nIn the Explorer app, connect the purchase to your account (Connect attendance) to keep the ticket in the app.",
    "limitations": "The /o/ order page reads the order from data saved in that browser or device. Opened on a different phone or a cleared browser it shows \"Order not found\" and tells the guest to use the confirmation email. The confirmation email links to the Mingla app rather than to this page. Apple Wallet and Google Wallet passes are not offered. Refunded or cancelled orders hide the QR code.",
    "support_wording": "Your tickets are attached as a PDF to your confirmation email, each with its own QR code to show at the door. If the order page says \"Order not found\", use the email instead, or connect the ticket to the Mingla app using the button in that email.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web",
      "Email"
    ]
  },
  {
    "capability_key": "checkout-refund-bank",
    "title": "Enter bank details to finish a refund",
    "outcome_summary": "When a naira (Paystack) refund can't go back to the original payment, the guest gets a secure link to enter their Nigerian bank account so the refund can be paid. Search words: refund bank details, refund needs attention, complete your refund, refund not received, Paystack refund, bank account for refund.",
    "how_to": "1. The guest receives a message with \"Continue securely\" and a link.\n2. The link opens the \"Complete your refund\" web page.\n3. Choose your Bank from the list and type your Account number.\n4. Tap Continue refund. The page then says \"Your refund is processing.\"\nIf banks fail to load, tap Retry loading banks.",
    "limitations": "Only for refunds on the Nigerian (Paystack, NGN) rail when Paystack reports the refund needs the customer's bank details. Nigerian bank accounts only. The link is personal and works from the message the guest received; without it the page shows \"This refund link is unavailable.\" Card refunds through Stripe never need this step.",
    "support_wording": "Your refund needs your bank account to finish. Open the \"Continue securely\" link we sent, choose your bank, enter your account number and tap Continue refund, and the refund will start processing.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Buyer web"
    ]
  },
  {
    "capability_key": "checkout-tickets",
    "title": "Buy tickets on web or in the app, with Apple Pay and Google Pay",
    "outcome_summary": "Buy event tickets by card on the web or in the Mingla Explorer app. In the app you can pay with Apple Pay on iPhone or Google Pay on Android. One all-in price shows fees and tax before you pay. Search words: buy tickets, checkout, pay by card, Apple Pay, Google Pay, payment failed, card declined, fees and tax.",
    "how_to": "Web (any browser): open the event page and tap Get tickets. Under Select your tickets choose quantities and tap Continue. Fill in Your details (Full name, Email, Mobile number), agree to the terms and tap Continue to payment. On Payment tap Pay; you are taken to the secure payment page to finish, then returned to a confirmation page that says \"You're in\" with your QR codes.\nExplorer app (iOS, Android): open the event, tap Get tickets, pick tickets and tap Continue to Payment. The payment sheet offers card, Apple Pay (iPhone) or Google Pay (Android). After payment you see \"You're booked\" and the ticket is in your tickets.",
    "limitations": "Card payments run through Stripe for brands in the 34 Stripe countries (US, UK, Canada, Switzerland and the EEA). Nigerian brands use Paystack instead. Apple Pay and Google Pay are offered in the Explorer app's payment sheet; on the web the options are whatever the secure payment page shows. Busy on-sales may put buyers in a short queue or waitlist. If payment is not completed, no ticket is issued.",
    "support_wording": "Tap Get tickets, choose your tickets, add your details and pay by card on the secure payment page; in the Mingla app you can also use Apple Pay or Google Pay. Once paid you'll see your QR code and get a confirmation email with your tickets attached.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "checkout-trips-experiences",
    "title": "Book trips and experiences",
    "outcome_summary": "Book a spot on a trip or an experience, answer the host's traveller questions, and pay in full or, where the host offers it, pay a deposit and the rest in scheduled instalments. Search words: book trip, reserve spot, experience booking, deposit, instalments, payment plan, pay over time, traveller form.",
    "how_to": "Trip, web: open the trip page and tap Reserve my spot. Pick a tier and tap Continue. If the host asks questions you see \"Tell us about your trip\"; answer and tap Continue to payment. Fill in Buyer details, then on Review & pay you see either \"Payment plan active\" (due today plus scheduled instalments from the same card) or \"Paid in full today\". Tap Pay deposit or Pay to finish on the secure payment page.\nExperience, web: open the experience page, tap Get my spot, choose your date and spot, add your details and pay.\nExplorer app (iOS, Android): open the trip or experience and use Get tickets; payment plans show as \"From ... today · pay over time\".\nFree trips and experiences use Reserve free spot.",
    "limitations": "Instalment plans are for trips only, and only when the host sets one up; later instalments are charged automatically to the same card. Trips can close bookings at a deadline (\"Bookings closed\"). Trip cancellation and refunds follow the host's refund tiers. Card payments use Stripe in the 34 Stripe countries; Nigerian hosts use Paystack in naira.",
    "support_wording": "Open the trip or experience, reserve your spot, answer any questions from the host and pay. If the host offers a payment plan you pay a deposit today and the rest is charged automatically to the same card on the dates shown at checkout.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Buyer web",
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-curated-plans",
    "title": "Curated multi-stop plans, with any stop swappable",
    "outcome_summary": "Mingla builds ready-made outings with several stops in order (for example Romantic, First Date, Group Fun, Adventurous, Picnic Dates or Take a Stroll). You see the plan, travel time between stops and total time, and can replace any stop you don't like with a nearby alternative. Search words: curated plan, itinerary, date plan, multi-stop, swap stop, replace stop, picnic list.",
    "how_to": "1. On the Explore tab, curated plans appear in your swipe deck alongside single places (they show a Curated label and a stop count).\n2. Tap a plan to open it. Under The plan you see each stop, how long you'll spend there and the travel time to the next one, plus Get Directions, photos, website and call buttons per stop.\n3. To change a stop, tap Replace on that stop and pick one of the alternatives shown. The plan shows a Customized label after a change. Optional stops (such as picking up flowers) can be dismissed but not replaced.\n4. Picnic plans include a shopping list for the picnic; stroll plans suggest a spot to eat at each end.\n5. To choose which kinds of plans you get, tap the Preferences button at the top of Explore and pick moods under See curated experiences? (Mingla+ only), then tap Lock It In.\n6. Swipe right or tap Save to keep a plan in Likes, then Schedule it like any saved card.",
    "limitations": "Saving a curated plan (swipe right or Save) needs Mingla+. On the free plan you can still open and look at plans that appear in your deck, but the save is blocked and the upgrade screen opens. Choosing or changing plan moods in Preferences also needs Mingla+. Alternatives for Replace are searched around the stop being replaced; if none are found it says \"No alternatives in this area\". Plans use Mingla's place data for your launch city, so coverage depends on the city. Opening hours are checked when you schedule, and some stops may be flagged as closed at the time you pick. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Curated plans are ready-made outings with several stops. Open one from your Explore deck to see each stop, and tap Replace on any stop to swap it for a nearby alternative. You can view plans on the free plan, but saving them needs Mingla+. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so this only applies if that promotion ends.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-dismissed",
    "title": "See and restore cards you swiped away",
    "outcome_summary": "If you swiped past a place or plan by mistake, you can find it again in Swipe History and save it. Search words: undo swipe, swiped left by accident, lost a card, passed card, swipe history, review cards.",
    "how_to": "1. On the Explore tab, after your first swipe a Swipe History button appears at the top of the deck.\n2. Tap it to see the cards you've viewed, marked Passed or Saved.\n3. Tap Save next to a passed card to add it to Likes, or tap the card to open its details.\n4. When you reach the end of the deck, the Review all cards button opens the same list.\n5. In a group swiping session, the list also shows cards other members passed on.",
    "limitations": "Swipe History keeps up to your last 200 cards and is stored on your phone, so it doesn't carry over to another device. It starts fresh when you change your preferences or switch between solo and a group session. Saving a curated plan from here still needs Mingla+. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Tap Swipe History at the top of the Explore deck to see the cards you've passed on, then tap Save to keep one. The history is stored on your phone and resets when you change your preferences.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-events",
    "title": "Find events near you, including Ticketmaster events",
    "outcome_summary": "Browse what's on in your city: events from Mingla hosts shown first, plus concerts, sports, arts and film events from Ticketmaster. Filter by date and type, and get tickets. Search words: events, concerts, tonight, this weekend, gigs, tickets, Ticketmaster, things to do.",
    "how_to": "1. Open the Discover tab and choose Events at the top.\n2. Tap the city chip to pick a different city; otherwise events are based on your location.\n3. Tap Filter to choose a date (Tonight, Today, Tomorrow, This Weekend, Next Week, This Month or Any Date), a type (Music, Sports, Arts & Theatre or Film) and a genre, then tap Apply Filters. Reset Filters clears them.\n4. Tap an event to open it. For a Mingla host event, the event page lets you get tickets or RSVP in the app. For a Ticketmaster event, tap Get Tickets to open Ticketmaster's ticket page inside the app; a Tickets TBA or Coming Soon label means tickets aren't on sale yet.\n5. Pull down to refresh.",
    "limitations": "Ticketmaster tickets are bought on Ticketmaster's own page, so Mingla can't help with those orders, refunds or seats. Ticketmaster results depend on Ticketmaster having events for that area and may be missing when their service returns nothing. Mingla host events appear only where hosts have published them for that city.",
    "support_wording": "Open Discover, choose Events, and use the city chip and Filter to narrow things down. Events from Mingla hosts are booked in the app, while Ticketmaster events open Ticketmaster's page, so ticket questions for those go to Ticketmaster.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-leaderboard",
    "title": "Leaderboard",
    "outcome_summary": "A leaderboard ranking Explorers used to be part of Mingla. It has been removed and there is no leaderboard screen in the app. Search words: leaderboard, ranking, points, top users.",
    "how_to": "There is no leaderboard in the Explorer app, so there are no steps. Your profile still shows your own level.",
    "limitations": "Removed from the app. A server function for leaderboard presence still exists, but no app screen uses it.",
    "support_wording": "The leaderboard has been removed from Mingla, so there's nowhere in the app to see rankings. Your own level still shows on your profile.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-map-nearby",
    "title": "Map of places and nearby people",
    "outcome_summary": "Mingla used to have a map showing places and nearby friends or people. It has been removed and the current app has no map or nearby-people screen. Search words: map, map view, nearby people, people near me, go dark, location sharing.",
    "how_to": "There is no map or nearby-people screen in the Explorer app, so there are no steps. To get directions to a place, open its card and tap Get Directions or Open in Maps.",
    "limitations": "Removed from the app. The old map and nearby-people code is still in the codebase but no screen uses it.",
    "support_wording": "The map and nearby people features have been removed from Mingla. To get to a place, open its card and tap Get Directions to open your maps app.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-place-details",
    "title": "Place details: photos, hours, weather, busyness, directions",
    "outcome_summary": "Tap any card to see everything about a place: photos, rating, price, opening hours, website and phone, the weather right now and a typical busyness level, and one-tap directions in your maps app. Search words: place details, opening hours, is it open, directions, address, phone number, weather, how busy.",
    "how_to": "1. Tap a card anywhere in the app (Explore deck, Likes, Calendar, a chat, or a friend's profile).\n2. Swipe through photos at the top and scroll for details, including Open Now or Closed and Weekly Hours.\n3. The Right now section shows the weather and a busy level for the place.\n4. Tap Get Directions or Open in Maps to open your phone's maps app at the place's location.\n5. Use the website or call buttons when the place has them, Save to keep it, Schedule to pick a date, or Share to send it.",
    "limitations": "Busyness is an estimate based on typical patterns for that kind of place at that hour, not a live count. Hours, phone numbers and websites come from place data and can be out of date; scheduling warns when it can't verify hours. Weather needs a working connection.",
    "support_wording": "Tap a card to open its full details, including hours, photos, weather and how busy it usually is, then tap Get Directions to open your maps app. The busy level is an estimate of typical crowds, not a live count.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-preferences",
    "title": "Set your vibe: moods, categories, dates, transport, travel time and start point",
    "outcome_summary": "Tell Mingla what you're in the mood for so the Explore deck fits you: plan moods, categories like Drinks & Music or Brunch, when you're going, how you're getting there, how far you'll travel, and where to start from. Search words: preferences, filters, settings for deck, change categories, travel time, distance, location, start point, change city.",
    "how_to": "1. On the Explore tab, tap the Preferences button at the top of the screen to open Your Vibe.\n2. Starting Point: keep Use my current location on, or search for a different starting spot (Mingla+).\n3. When: pick Today, This Weekend or Pick Date(s).\n4. See curated experiences?: choose plan moods such as Romantic, First Date, Group Fun, Adventurous, Picnic Dates or Take a Stroll (Mingla+).\n5. See popular options?: pick categories such as Play, Icebreakers, Nature & Views, Drinks & Music, Creative & Arts, Movies, Theatre, Brunch, Casual, Fine Dining, Romantic, Lively or Scenic.\n6. Getting There: Walk, Bike, Bus or Drive.\n7. How Far?: 15, 30, 45 or 60 minutes, or Set your own (5 to 120 minutes).\n8. Tap Lock It In to save, or Start Over to reset. Your deck refreshes with the new settings.",
    "limitations": "Setting a custom starting point and choosing plan moods need Mingla+; on the free plan tapping them opens the upgrade screen, and a custom start point switches back to your current location if Mingla+ ends. You must keep at least one mood or category selected. There is no budget or price setting. In a group session the sheet sets the group's shared vibe. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Tap the Preferences button at the top of the Explore tab, adjust your categories, dates, transport and travel time, then tap Lock It In. Searching for a different starting point and choosing plan moods need Mingla+. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so this only applies if that promotion ends.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-reviews",
    "title": "Mark \"been here\" and rate a place",
    "outcome_summary": "Tell Mingla you've been to a place and give it a star rating, so your recommendations get better. Mingla can also ask \"Did you go?\" after a scheduled outing. Search words: been here, visited, rate a place, review, star rating, did you go.",
    "how_to": "1. On a card in the Explore deck, or on a place's details, tap Been here.\n2. Choose a star rating under How was [place]? and tap Submit. Your visit and rating are saved together, and the pill changes to You've been here.\n3. To undo, tap You've been here again.\n4. After a scheduled outing, Mingla may ask Did you go to [place]? Tap Yes, I went to rate it, or No, I'll go later to pick a new date.",
    "limitations": "Ratings are stars only; there is no written review. You can leave one rating per place from Been here. Closing the rating prompt without submitting does not record a visit.",
    "support_wording": "Tap Been here on a place, pick a star rating and tap Submit. Ratings are stars only, and tapping You've been here again removes the visit.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-save-and-schedule",
    "title": "Save places and schedule them, including to your phone calendar",
    "outcome_summary": "Keep places and plans you like in Likes, then pick a date and time to go. Scheduled outings show in your Mingla calendar and are added to your phone's calendar with a reminder. Search words: save, saved, likes, favourites, schedule, plan a date, calendar, reschedule, add to calendar, reminder.",
    "how_to": "1. Swipe right on a card in the Explore deck, or tap Save on its details, to add it to Likes.\n2. Open the Likes tab. Saved lists everything you've saved, with search and filters for category, date and sort order.\n3. Tap Schedule on a saved card, pick a day (Now, Today, This Weekend or Pick a Date) and a time. Mingla checks opening hours and warns if the place, or any stop in a plan, looks closed; you can choose another time or Schedule Anyway.\n4. The outing moves to the Calendar tab inside Likes (Active and Archives). Tap Reschedule there to change the time.\n5. Mingla also adds it to your phone's calendar with a reminder before it starts. Allow calendar access when asked.",
    "limitations": "Saving curated plans needs Mingla+. Adding to the phone calendar needs calendar permission; if it's denied or no writable calendar exists, the outing is still scheduled in Mingla. After rescheduling, your phone calendar may not update and the app says so. Hours checks rely on place data and may say hours couldn't be verified. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Swipe right or tap Save to keep a place in Likes, then tap Schedule to pick a date and time. It moves to the Calendar tab in Likes and is added to your phone calendar if you allow calendar access.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-stays",
    "title": "Find and book stays",
    "outcome_summary": "Find hotels, resorts, guest houses, lodges and apartments listed by Mingla hosts, check availability for your dates, and reserve a room in the app. Some stays book instantly with payment, others take a request the host confirms. Search words: stays, hotel, book a room, accommodation, resort, guest house, reservation, check in.",
    "how_to": "1. Open the Discover tab and choose Stays at the top.\n2. Use the filter chips to set a destination, check-in and check-out dates, guests and rooms, property type (Hotel, Resort, Guest house, Lodge, Serviced apartment, Short-stay apartment or Other), amenities, and Instant or Request booking.\n3. Tap a stay to open its page, then use the booking bar at the bottom.\n4. Choose your dates, Adults and Children, and the Rooms (or Places) you want, then enter your guest name, email and phone.\n5. Tap Review and reserve, then Confirm and pay to pay by card in the app, or for request-only stays tap Review request, then Send request.\n6. You land on your stay's status page, where you can follow the booking and see cancellation options.",
    "limitations": "Only stays that hosts have published with live rooms appear; if none match, the tab says \"No stays are live yet\" or suggests clearing filters. Request stays are not confirmed until the host accepts. Stays from Nigerian hosts may open a Paystack page in the browser to pay; other stays use in-app card payment. Card payment needs a device that supports the payment sheet. Cancellation and refunds follow the stay's own policy shown before cancelling. Stays are switched on in production. If Mingla staff ever switch them off, the tab shows \"Stays are opening soon.\"",
    "support_wording": "Open Discover, choose Stays, set your destination and dates, then open a stay and use the booking bar. Instant stays are paid and confirmed in the app, while request stays wait for the host to accept.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-swipe-deck",
    "title": "Swipe a deck of places and plans picked for you",
    "outcome_summary": "The Explore tab shows a deck of places, curated plans and host experiences matched to your preferences and location. Swipe right to save, left to pass, or tap to see more. Search words: swipe, deck, recommendations, explore, cards, what to do, ideas near me, like, pass.",
    "how_to": "1. Open the Explore tab (the first tab).\n2. Swipe right (LIKE) to save a card to Likes, or swipe left (PASS) to skip it.\n3. Tap a card to see full details. Use Been here on the card to rate a place you've visited, or the share icon to send it.\n4. Tap the Preferences button at the top to change what the deck shows.\n5. Tap Swipe History to look back at cards you've seen.\n6. When you run out, the deck suggests Shift preferences or Review all cards.",
    "limitations": "During sign-up the app checks whether you are in a Mingla launch city; if you are not, you pick one of the launch cities. Results depend on Mingla's place data for that area. If everything nearby is closed at the chosen time, the deck says so and suggests This Weekend or a date. Saving curated plans needs Mingla+; on the free plan a right swipe on a plan opens the upgrade screen instead. Swiping itself is unlimited on every plan. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Open the Explore tab and swipe right to save a card or left to pass; tap a card for details. If the deck runs out, tap Shift preferences to widen your categories, travel time or dates.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "discover-trips",
    "title": "Find trips",
    "outcome_summary": "Browse group trips that Mingla hosts have published, filter by where you're going, where you're leaving from, dates, price and group size, and open a trip to see the day-by-day plan and reserve. Search words: trips, group trip, travel, getaway, tour, itinerary, reserve a trip.",
    "how_to": "1. Open the Discover tab and choose Trips at the top.\n2. Use the filter chips: Where to, Leaving from, dates, price, group size, and Sort (Newest, Oldest, Price low to high, Price high to low). Clear filters resets them.\n3. Tap a trip to open its page with the day-by-day plan and price.\n4. Use the Reserve button at the bottom of the trip page to book.",
    "limitations": "Only trips that hosts have published appear, and there may be few or none in your area; when there are none the tab says trips are coming and offers Browse events. Prices, dates and what's included are set by the host.",
    "support_wording": "Open Discover and choose Trips to browse published group trips, then open one and tap Reserve. If the list is empty, no hosts have published trips that match yet.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "events-cancel-refund-all",
    "title": "Cancel an event and refund every buyer",
    "outcome_summary": "Cancel a live or upcoming event. Ticket sales stop at once, every paid online order is queued for a full refund, and Mingla reviews the refund batch before the money goes back to buyers. Covers: cancel event, call off a show, refund all tickets, mass refund, event cancelled refunds.",
    "how_to": "In Mingla Host (iOS, Android or web), open the event and scroll to the bottom of the event page. Tap \"Cancel event\" (also in the event's manage menu on the Events list). The \"Cancel this event?\" dialog explains what happens: \"Sales stop straight away\" and paid orders are \"queued for a full refund, and Mingla reviews the batch before the money is sent\". Type the event name to confirm and tap \"Cancel event\" (or \"Keep event live\" to back out). If tickets were sold, the toast reads \"Event cancelled. Refunds are with Mingla for review.\" Mingla staff then open the event in Mingla Admin under Offerings, check the held batch (\"Cancel refunds are held for review\") and tap \"Release held refunds\", typing RELEASE to confirm. Refunds then go back to each buyer's original payment method (card via Stripe or Paystack). Staff can also cancel an offering from Mingla Admin with \"Cancel offering\".",
    "limitations": "Only live or upcoming events can be cancelled, and only by an event manager or above (brand admin, brand owner). Cancelling cannot be undone. No refund is sent at cancel time: the batch waits until a Mingla admin releases it, so buyers are not refunded until then. Buyers are not emailed when the event is cancelled; they hear when their refund is issued. Only online orders are refunded. Door sales are recorded on the device that took them and are not refunded automatically; any cash refunds for door sales must be handled by the host. Free orders have nothing to refund.",
    "support_wording": "When a host cancels an event, ticket sales stop straight away and every paid online order is queued for a full refund. Mingla reviews the batch first, and once it is released each buyer is refunded to the card they paid with. Money taken at the door is not refunded automatically and needs to be settled by the host.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Mingla Support"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Mingla Admin",
      "Email"
    ]
  },
  {
    "capability_key": "events-check-in",
    "title": "Scan tickets at the door",
    "outcome_summary": "Check guests in at the door by scanning the QR code on their ticket with the phone camera. Each scan is checked by Mingla's server, which shows a green check-in, already checked in, wrong event, ticket not valid, doors not open yet, or event ended. Covers: check-in, door scanning, ticket scanner, QR scan, entry, admit guests.",
    "how_to": "In the Mingla Host app on iOS or Android, open the event and tap \"Scan tickets\". People invited as scanners see their events on the Home screen and tap one to open the camera. Allow camera access when asked (\"Allow camera access\", or \"Open Settings\" if it was blocked). Point the camera at the buyer's ticket QR code. A result shows for about three seconds: \"<name> checked in\", \"Already checked in\", \"Different event\", \"Ticket not valid\", \"Doors aren't open yet\", \"Event ended\" or \"Ticket not found\". Expand the session log at the bottom to see this device's recent scans. On Mingla Host web the Scan tickets page shows \"Scan tickets in the app\" and sends you back to the event: scanning needs the phone app. A host can also tap a guest in Guests and use \"Mark checked in\".",
    "limitations": "Camera scanning works only in the Mingla Host iOS and Android apps, not on Mingla Host web. Scanning needs an internet connection: there is no offline mode or offline queue, and a scan without a connection shows \"Scan failed\". QR scans are recorded on the server, so a ticket scanned on one phone shows as already checked in on another. The \"Mark checked in\" button on a guest's page and the check-in counts in the Guests list and Reconciliation are kept only on that device, so they do not reach the server or other phones. The scanner must be on the brand team or have accepted a scanner invite; otherwise the scan shows \"You're not authorized to scan this event\". Scanning is for events; scanners' Home only lists upcoming events.",
    "support_wording": "Hosts and invited scanners check guests in by scanning the ticket QR code with the camera in the Mingla Host app on iPhone or Android. Scanning needs an internet connection and does not work in a web browser. If a ticket was already used, the scanner will see \"Already checked in\".",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Scanner"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android"
    ]
  },
  {
    "capability_key": "events-comp-guests",
    "title": "Add free (comp) guests",
    "outcome_summary": "Add a free guest (comp, guest list spot, plus-one, VIP, press) to an event without them buying a ticket. The guest appears in the Guests list marked COMP and counts toward the guest total on that device. Covers: comp ticket, complimentary guest, free entry, guest list name, plus-one.",
    "how_to": "In Mingla Host, open the event and tap \"Guests\". Tap \"+\" (\"Add comp guest\"). Fill in Name and Email (required), Phone (optional), choose a Ticket type or leave \"General comp\", add Notes, and give a Reason of 10 to 200 characters. Tap \"Add guest\". The guest shows in the list with a COMP pill. Tap the guest to open their page, where you can tap \"Mark checked in\" at the door or \"Remove guest\" (with a reason).",
    "limitations": "Comp guests are saved only on the phone or browser where they were added. They are not stored on Mingla's server, so other team members, other devices and Mingla Support cannot see them, and they are lost if the app is removed, the browser data is cleared, or the person signs out. The guest gets no ticket, no QR code and no email, so they cannot be scanned at the door; check them in by name with \"Mark checked in\" on the same device. Event manager or above only. When a brand has the newer server guest list switched on, the Add comp guest button is not part of that view.",
    "support_wording": "Hosts can add free comp guests from the Guests page of their event. Comp guests are kept only on the device where they were added and do not receive a ticket or email, so the host should check them in by name from that same device.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-cover-media",
    "title": "Event cover photo, GIF or video",
    "outcome_summary": "Hosts can give an event a cover image: upload their own photo, GIF or short video, or pick a stock photo (Pexels) or GIF (GIPHY). The cover shows at the top of the public event page and in listings. Videos are uploaded and prepared in the background.",
    "how_to": "1. In the event wizard, go to the \"Cover\" step (or on a live event, Manage event > \"Edit details\" > Cover).\n2. Open the cover picker. Choose a tab: \"Library\" (your own photos and videos), \"GIFs\" (GIPHY) or \"Photos\" (Pexels).\n3. Pick an item. For a video, wait for the upload and preparation progress to finish; on iOS and Android a clip longer than 1 minute opens a trimmer, on web you need to choose a clip of 1 minute or less.\n4. Tap \"Use this cover\" to apply it. \"Close, keep working\" lets a video keep uploading in the background.\n5. To remove it, choose \"Remove cover\"; guests then see a plain colour.",
    "limitations": "Photos and GIFs: JPEG, PNG, WebP or GIF under 30 MB. Videos: MP4, MOV, M4V or WebM, up to 1 minute and under 100 MB (on web the original file must be under 100 MB; on phones larger clips are compressed first, then must be under 100 MB). Videos are processed into a version up to 1080p before they show; you cannot save a live event edit while the cover video is still processing. Video covers have an open defect (#3040): uploads or processing can fail or stall, so a photo or GIF is the reliable fallback. Stock photo and GIF tabs can be temporarily unavailable; your own Library still works.",
    "support_wording": "You can set an event cover in Mingla Host from your own photo, GIF or video, or from the stock Photos and GIFs tabs. Videos must be up to 1 minute and under 100 MB, and photos under 30 MB. If a video cover will not finish uploading, try again or use a photo or GIF instead.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "events-create",
    "title": "Create one-off, recurring or multi-date events",
    "outcome_summary": "Hosts can create a ticketed event that happens once (single date), repeats on a schedule (recurring: daily, weekly, every 2 weeks or monthly) or runs on a hand-picked list of 2 to 24 dates (multi-date, series, festival days), then publish it with tickets.",
    "how_to": "1. Tap the create button (\"Create event, experience, or trip\") on Home or Hub, choose \"Create event\", then \"Ticketed event\". You can also use \"Build a new event\" in Hub > Events.\n2. Work through the steps: \"Basics\", \"When\", \"Where\", \"Cover\", \"Tickets\", \"Settings\", \"Preview\". Tap \"Continue\" to move on; drafts save automatically.\n3. On \"When\", pick \"Single\", \"Recurring\" or \"Multi-date\":\n   - Single: date, \"Doors open\" and end time.\n   - Recurring: \"First occurrence\", times, a pattern (\"Daily\", \"Weekly\", \"Every 2 weeks\", \"Monthly (by day)\", \"Monthly (by weekday)\") and an end: \"After N occurrences\" (up to 52) or \"On a date\".\n   - Multi-date: tap \"Add date\" for each date and time (2 to 24 dates); each date can have its own overrides.\n4. On \"Preview\", tap \"Publish event\" and confirm.\nSame on iOS, Android and web.",
    "limitations": "Multi-date events need at least 2 and at most 24 dates. Recurring events must end: up to 52 occurrences or an end date up to about 1 year out (only experiences can repeat forever). Mingla keeps up to 52 upcoming dates of a recurring event on sale; when fewer than 14 upcoming dates remain, a daily job adds more (it is not a 14-day window). On recurring events ticket capacity counts per night and buyers pick a night. Creating events needs the Event manager role or above. Paid tickets need a payout currency and acceptance of the Organiser Terms before publishing.",
    "support_wording": "In Mingla Host you can create an event that happens once, repeats on a schedule, or runs on a list of specific dates. Multi-date events can have 2 to 24 dates, and recurring events can run for up to 52 occurrences or until an end date. Buyers of a recurring event choose which night they are attending.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-discount-codes",
    "title": "Discount codes",
    "outcome_summary": "Hosts cannot create discount codes, promo codes, coupon codes or voucher codes for tickets on Mingla today. Buyers cannot enter a code at checkout to get money off. This entry lets support answer requests for promo codes, coupons, reduced prices or special offers honestly.",
    "how_to": "There is nothing to open. Checkout has no field for a promo or discount code, and the Host app has no screen for creating one. If a host wants a cheaper price for some guests, they can add a separate ticket type at a lower price in the event's ticket settings, and share it as they choose. Record the request so the product team can see demand.",
    "limitations": "Not built. No screen, server function or database table for discount codes exists on main. The order total breakdown has a discount amount column, but it is always zero and nothing writes to it. A lower priced extra ticket type is the only workaround, and it is visible to anyone who can see the event unless the host hides that ticket type.",
    "support_wording": "Mingla does not offer discount or promo codes yet, so there is no code to enter at checkout. If you are a host and want to offer a lower price to some guests, you can add a separate, cheaper ticket type to your event.",
    "who_can_use": [
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "events-door-sales",
    "title": "Sell at the door",
    "outcome_summary": "Record tickets sold in person at the door for cash or another manual payment, with an optional buyer name, email and phone. Each sale checks the buyer in on that device and shows in the door sales totals. Covers: door sales, walk-up tickets, box office, sell tickets in person, cash at the door.",
    "how_to": "Turn on door sales when creating or editing the event: in settings switch on \"In-person payments\" (\"Sell tickets at the door. Adds a Door Sales tile to your event.\"). Then open the event in Mingla Host and tap the \"Door Sales\" tile. Tap \"+\" (\"Record new door sale\"), pick ticket quantities, choose a payment method (\"Cash\" or \"Manual\" for bank transfer or other prepaid), optionally add Name, Email, Phone and Notes, and tap \"Record sale\". The Door Sales page lists sales newest first with totals for Cash, Card reader, NFC tap, Manual and Refunded, a \"View by scanner\" breakdown, and an export button for a CSV. Tap a sale and use \"Refund\" to record a door refund with a reason.",
    "limitations": "Door sales are saved only on the phone or browser that recorded them. They are not stored on Mingla's server, so other devices, team members and Mingla Support cannot see them, and they are lost if app data is cleared or the person signs out. Only Cash and Manual work: \"Card reader\" and \"NFC tap\" are shown but disabled, and the screen shows a \"TESTING MODE\" banner. Mingla does not take or move any money for door sales, and a door refund is only a record; the host returns the money. Door sales are not refunded when an event is cancelled. Door refunds need finance manager or above. The \"Accept payments at the door\" option on scanner invites is saved but does not change what a scanner can do in the app.",
    "support_wording": "Hosts can record cash or manual door sales from the Door Sales tile once In-person payments is switched on for the event. These sales are kept only on the device that recorded them, card and tap-to-pay at the door are not available, and Mingla does not process the money.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-edit-live",
    "title": "Edit a live event after it is published",
    "outcome_summary": "Hosts can change a published (live) event: basics, date and time, venue, cover, tickets and settings. Before saving they review every change and give a reason. Changes that would affect people who already bought are blocked or require refunding them first, and the review screen says whether buyers will be emailed.",
    "how_to": "1. Open the event and tap \"Manage event\", then \"Edit details\".\n2. Expand a section (Basics, When, Where, Cover, Tickets, Settings) and make your changes.\n3. Tap \"Save changes\". The \"Review changes\" sheet lists each change.\n4. If anyone has bought, enter a \"Reason for change\" (10 to 200 characters); with no buyers it is optional.\n5. Tap \"Save changes\" to confirm. You see \"Saved. Live now.\" or a message saying buyers will be emailed.\n6. If the change would affect existing buyers (for example moving the date of a sold event), you get \"Refund first\" with \"Open Orders\", or for schedule changes \"Refund all & change\", which you hold to confirm. It refunds every buyer in full first.\nSame on iOS, Android and web.",
    "limitations": "Needs the Event manager role or above; changing ticket prices needs Finance manager or above. Date and time changes on an event with sold tickets require refunding those buyers first. A ticket that has sold cannot be removed or have its price changed without refunding affected buyers. Refund terms can only become more generous. Ended or cancelled events cannot be edited. Buyer emails about live edits are controlled by a server switch that ships off and, when on, may be limited to pilot brands or test addresses; when it is off the change is saved and logged but buyers are not emailed, and the Review changes sheet says so. When on, one email per event goes out after about 5 quiet minutes and only covers date, time, venue, address, online link and format changes.",
    "support_wording": "You can edit a published event in Mingla Host from Manage event, then Edit details. You will review your changes and, if people have bought, add a short reason. Changes that affect existing buyers, such as moving the date of a sold event, need those buyers refunded first, and the review screen tells you whether buyers will be emailed about the change.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "events-fees-and-tax",
    "title": "Choose who covers the Mingla fee, service fee and VAT",
    "outcome_summary": "Decide whether buyers or you pay the Mingla fee, the service fee and VAT. Buyers always see one all-in price, and a live preview shows what the buyer pays and what you keep. Set brand defaults once, then change them per event or experience until the first ticket sells. Covers: fees, booking fee, absorb fees, pass fees to buyer, VAT, tax, all-in pricing.",
    "how_to": "Brand defaults: in Mingla Host open your brand profile and tap \"Pricing defaults\" (\"Who covers VAT and fees by default\"). Per event: in the Tickets step of creating an event (or the pricing step of an experience) find \"Who covers the costs?\" (\"Buyers always see one all-in price.\"). For \"Mingla fee\" and \"Service fee\" choose \"Add to price\" or \"I'll cover it\". For \"VAT\" choose \"Included in price\" or \"I'll cover it\". Watch \"Buyer pays\" and \"You keep\" update. If the brand has no active tax registration, the VAT row shows \"Set up VAT\", which opens the tax registrations page. Tap \"Edit defaults\" to jump to brand defaults.",
    "limitations": "VAT can only be set to \"Included in price\" once the brand has an active tax registration; otherwise it is unavailable. Pricing locks once the first ticket sells (\"Pricing locks once your first ticket sells, so every buyer pays on the same terms.\"). Changing these needs finance manager or above. Applies to events and experiences, not trips. The \"You keep\" preview is a floor before VAT; the exact amount is worked out at checkout.",
    "support_wording": "Hosts choose whether buyers or the host cover the Mingla fee, the service fee and VAT, and buyers always see one all-in price. These settings can be changed until the first ticket sells, and VAT can only be added once the brand has an active tax registration.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-group-chat",
    "title": "Event group chat for guests",
    "outcome_summary": "Every ticketed event and trip gets its own group chat (event channel) where the host team and ticket holders can talk, share photos and get updates. Hosts can read, reply, delete messages, remove members and switch the chat to broadcast-only announcements. Guests see it in the Chats tab of the Mingla Explorer app.",
    "how_to": "Host (Mingla Host app on iOS, Android or web): open the event, then tap the \"Group chat\" tile (\"Read + reply + moderate\"). The same tile is on trip pages and RSVP event pages. Type in \"Write a reply\" and tap \"Send\"; tap the image button (\"Attach image\") to add a photo with an optional caption. Tap \"Open moderation\" to open \"Group chat moderation\": turn on \"Broadcast-only\" (\"Only your team can post. Buyers can still read.\"), see \"Members\" and remove someone, or delete a single message from the message itself.\nGuest (Mingla Explorer app on iOS or Android): a signed-in buyer is added to the chat when their ticket is confirmed. A guest who bought on the web without an account is added when they install Explorer and claim their ticket; onboarding can show \"Your trip and event chats\" with a \"Join chat\" button. The chat then appears in the \"Chats\" tab, labelled as an event or trip channel with the organiser and attendees. In broadcast-only mode guests can read but not post.",
    "limitations": "Chats are created automatically only for ticketed events and trips. Experiences have no group chat, and RSVP events do not get one created automatically, so the RSVP \"Group chat\" tile may show \"No group chat exists for this event yet.\" Guests use the Explorer app only; there is no guest chat on the buyer web pages. Web buyers without an account must install Explorer and claim their ticket before they join. Known open defect #2324: a new user who joins a chat during Explorer onboarding can be placed in the wrong event's chat, and a chat they belong to can be missing from their list. Photo attachments need photo library permission on the device.",
    "support_wording": "Each ticketed event and trip has a group chat. Hosts open it from the event's Group chat tile in Mingla Host, and guests find it in the Chats tab of the Mingla Explorer app once their ticket is linked to their account. If a guest cannot see the right chat, collect their account email and the event name and pass it to the Mingla team.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin",
      "Explorer",
      "Buyer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "events-guest-list",
    "title": "Guest list with search and CSV export",
    "outcome_summary": "See everyone coming to an event in one list: online buyers, door sales and comp guests, with status pills, search by name, email or phone, filter by day for multi-day events, and export the list as a CSV spreadsheet. Covers: guest list, attendee list, who is coming, download guests, export attendees.",
    "how_to": "In Mingla Host, open the event and tap the \"Guests\" tile (it shows the guest count). Tap the search icon and type in \"Buyer name, email, or phone\". For events with several days, use the day chips (\"All\" or a day) to filter. Tap a row to open the guest: see their tickets, order link, check-in state, and actions. Tap the export icon to export the list: on web the CSV downloads; on iPhone and Android it opens the share sheet. The CSV has columns such as Kind (online, comp or door), Name, Email, Phone, Ticket type, Quantity, Status, Payment method, Gross, Refunded and Net. For brands where Mingla has switched on the newer guest status view, the page shows that view instead, with its own filters and an export that is prepared on the server (\"Preparing the audited guest export\", then \"Guest export ready\").",
    "limitations": "Event manager or above only; lower roles see \"Couldn't load guest status\". Online orders come from Mingla's server, but comp guests, door sales and check-in marks in the standard list come only from the device you are using, so two devices can show different lists. On iPhone and Android the export is shared as text through the share sheet rather than saved as a file. The newer guest status view is switched on per brand by Mingla and is off by default; its server-prepared export is not switched on yet.",
    "support_wording": "Hosts can see their guest list from the Guests tile on the event, search it, and export it as a CSV. Online ticket buyers appear on every device, but comp guests and door sales only appear on the device where they were added.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-invite-people",
    "title": "Invite people while creating an event",
    "outcome_summary": "A planned step in the event, RSVP, experience and trip creation wizards that lets a host pick people to invite (everyone in Your Book, followers, friends of followers) so they are invited when the listing is published. It is switched off, so hosts cannot invite guests from the wizard yet.",
    "how_to": "Not available to hosts yet. When it is switched on, an \"Invite people\" step appears in the creation wizard with the note \"Nothing sends yet\" (\"Your selections stay with this draft.\"). Hosts choose \"Everyone in Your Book\" (\"Select all\"), \"Followers\", or friends of followers, then tap \"Review\" or \"Skip invites\". Invites are meant to go out only after publishing. Today hosts can share the event link, use Blasts to message existing buyers, or add a scanner or teammate from the brand team screens.",
    "limitations": "Switched off in production: both the selection switch and the send switch ship off and stay off until operations turns them on. With the switch off the step does not appear in any wizard, and the server refuses to save or send invite selections. Up to 500 people per selection when enabled. A host who saved a selection before it was turned off keeps seeing the step for that draft.",
    "support_wording": "Inviting people from inside the event creation wizard is not available yet. Hosts can share their event link directly, and can message people who already bought tickets using Blasts.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "claimed_status": "planned"
  },
  {
    "capability_key": "events-named-buyers",
    "title": "Sell only to approved buyers",
    "outcome_summary": "Limit who can buy tickets to specific signed-in Mingla accounts (up to 20). The event page stays public, but only approved accounts can check out; everyone else sees a Restricted sale notice. Covers: private sale, approved buyers, invite-only tickets, restricted checkout, eligible buyers, allowlist.",
    "how_to": "On Mingla Host web, open the published event (or experience) and go to its edit screen. Find the \"Eligible buyers\" card. Tap \"Add my account\" to approve yourself, or type the person's exact Mingla username and tap \"Approve username\". Then tap \"Limit to approved accounts\" and \"Confirm\". To undo, tap \"Let anyone buy\" and confirm; the approved list is kept. Remove someone with \"Remove\". Buyers who are not signed in see \"Restricted sale: Sign in with an approved Mingla account to continue\"; signed-in buyers who are not approved see that the organizer has limited the sale.",
    "limitations": "Set up only on Mingla Host web: the card does not appear in the iOS or Android Host apps. Only the brand owner can change it. Maximum 20 approved accounts. Approve by exact username only; private or unavailable accounts cannot be added and the card will not reveal whether an account exists. A change is blocked while a checkout is in progress. Not available for RSVP events. The rule is enforced by Mingla's server on every checkout, including from the apps, but the explanation notice shows only on the web pages.",
    "support_wording": "A brand owner can limit an event's ticket sales to specific Mingla accounts from the Eligible buyers card on Mingla Host web. The event page stays visible to everyone, but only approved, signed-in accounts can buy.",
    "who_can_use": [
      "Brand owner",
      "Buyer"
    ],
    "surfaces": [
      "Mingla Host web",
      "Buyer web"
    ]
  },
  {
    "capability_key": "events-orders-refunds",
    "title": "See orders and give full or partial refunds",
    "outcome_summary": "See every online order for an event, search and filter it, open an order's details and refund it in full or in part, cancel a free order, or resend the ticket. Refunds go back to the buyer's card through Mingla and the buyer is notified. Covers: orders, refund a ticket, partial refund, money back, resend ticket, cancel order.",
    "how_to": "In Mingla Host, open the event and tap \"Orders\". Use the filters \"All\", \"Paid\", \"Refunded\", \"Cancelled\" and search by \"Buyer name or order ID\". Tap an order to see buyer, lines, Subtotal, Total, Method and \"Refund history\". Tap \"Refund order\" for a full refund or \"Partial refund\" to choose lines and quantities; on a partly refunded order use \"Refund again\". Enter a reason of 10 to 200 characters (it is included in the buyer's message) and tap \"Send refund\" (or \"Refund <amount>\" for partial). For free orders use \"Cancel order\". \"Resend ticket\" sends the ticket again. If the event has published refund terms, the sheet shows what those terms give this order today.",
    "limitations": "Refunding needs finance manager or above; others see no refund buttons. Only online orders appear here; door sales are refunded on the Door Sales page as a record only. The buyer usually sees the money in 3 to 5 business days. Card payment rules from Stripe or Paystack apply (for example minimum refund amounts). Mingla Support can also refund from Mingla Admin.",
    "support_wording": "Hosts with finance access or above can refund an order in full or in part from the Orders tile on their event. The buyer is notified and usually sees the money back on their card within 3 to 5 business days.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Mingla Support"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Mingla Admin",
      "Email",
      "SMS"
    ]
  },
  {
    "capability_key": "events-private",
    "title": "Private, invite-only events",
    "outcome_summary": "Private, invite-only events (hidden from search, only invited guests can see the event or buy tickets) are not available on Mingla. Hosts who want a less public event can publish it as Unlisted, so only people with the direct link can see it.",
    "how_to": "There is no working private flow. In the event wizard's settings step, the visibility choice shows \"Public\", \"Unlisted\" and \"Private\", but Private cannot be published: the host sees \"Private ticket sales are not ready yet. Choose Public or Unlisted to publish.\" Use \"Unlisted\" (\"Only people with the direct link can see this event.\") as the closest option, and share the link only with the intended guests. A password toggle and \"Require approval\" are also in the same settings step.",
    "limitations": "Switched off on purpose. The app constant is hard-set to off and the server's readiness check is frozen so it cannot return yes, so no Private event can be published, viewed or bought even if the app is changed. Unlisted is not invite-only: anyone who gets the link can open the page and buy. Older drafts saved as Private stay selected but are blocked at Publish.",
    "support_wording": "Fully private, invite-only events are not available on Mingla yet. Hosts can publish an event as Unlisted, which hides it from search so only people with the direct link can see it.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "events-reconciliation",
    "title": "Reconcile sales across online, door and comps",
    "outcome_summary": "See one end-of-night report for an event: tickets sold online, at the door and comped, revenue by payment method, refunds, net, processing fees, expected payout, and scan results, with a CSV export. Covers: reconciliation, end of night report, cash up, settlement, sales summary, payout estimate.",
    "how_to": "In Mingla Host, open the event and tap the \"Reconciliation\" tile (or \"View full reconciliation report\" on the Door Sales page). The report shows TICKETS (Online sold, Door sold, Comps, TOTAL LIVE), REVENUE (Card (online), Apple Pay, Google Pay, Free (online), Cash (door), Card reader (door), NFC tap (door), Manual (door), Gross, Refunded, NET, Processing fee (online), EXPECTED PAYOUT) and SCANS (Scanned in, No-shows or Waiting, Duplicate scans, Wrong event, Not-found, Voided, Cancelled), with a by-scanner breakdown. Tap the export icon to download (web) or share (iPhone and Android) the reconciliation CSV.",
    "limitations": "Finance manager or above (also event manager, brand admin, brand owner); scanners and marketing managers see \"Restricted\". Online sales come from Mingla's server, but door sales, comps and scan counts in this report come only from the device you are viewing it on, so the report can differ between devices. Card reader and NFC show \"Not available yet\". The report is advisory; payouts follow Mingla's own records of online payments. No PDF export.",
    "support_wording": "Hosts with finance access or above can open the Reconciliation tile on an event to see online, door and comp totals, refunds, fees and expected payout, and export it as a CSV. Door sales and comps in the report only include what was recorded on the device being used.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-reminders",
    "title": "Event reminders 24 hours and 2 hours before",
    "outcome_summary": "People with a paid ticket get automatic event reminders about 24 hours and about 2 hours before the event starts (\"Tomorrow\" and \"Starting soon\"). Reminders can arrive as an app alert and push notification, plus a text message or an email. Venue reservations get the same reminders.",
    "how_to": "Nothing to set up for hosts: reminders go out automatically for live and scheduled events, trips and experiences. A check runs every 15 minutes and picks up paid orders whose start time is 24 hours or 2 hours away (within about 15 minutes either side). Guests with a Mingla Explorer account get an in-app alert and a push notification. Each order also gets one outside message: a text if the order has a phone number, otherwise an email. Guests can turn reminders off in the Explorer app under notification settings, \"Event reminders\" (\"Reminders before an event you're attending.\").",
    "limitations": "Paid orders only: free tickets and RSVP guests are not reminded by this feature. Each order reaches one contact: if a phone number was given, the reminder goes by text and no reminder email is sent; texts depend on the per-country SMS switch (Nigeria and other markets are switched separately) and Nigerian texts can be held overnight. Guests without an Explorer account get no push. Known defect #1210: until mid October 2026 the reminder job failed every run, so no reminders were sent. The fix is applied and the scheduled runs now succeed, but no reminder has yet been seen being delivered after the fix. Reminder timing cannot be changed per event.",
    "support_wording": "Mingla is set up to send reminders about a day before and about two hours before an event to people who bought paid tickets, by app notification and by text or email. Reminders are not guaranteed to arrive right now, so please keep the event details from your confirmation email. Free and RSVP bookings do not get these reminders.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Push notifications",
      "SMS",
      "Email",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "events-scanner-team",
    "title": "Invite scanners for one event or the whole brand",
    "outcome_summary": "Invite door staff to scan tickets by email, either for one event or for every event the brand runs now and later. Invites are stored on Mingla's server, the person accepts from an email link, and you can revoke a pending invite. Covers: invite scanner, door staff, check-in staff, ticket checker, scanner team.",
    "how_to": "For one event: in Mingla Host open the event, tap \"Scanners\", then \"Invite scanner\". For the whole brand: search for \"Scanners\" (\"Door staff who check tickets\") in Mingla Host search, then tap \"Invite brand scanner\". In the sheet enter the scanner's Name and Email, choose Access: \"This event only\" or \"Every event in this brand\" (\"They can scan tickets at any of your events, now and later\"), optionally switch on \"Accept payments at the door\", and tap \"Send invitation\". The scanner gets an email with a one-tap accept link, and after accepting sees the brand's upcoming events on their Home screen with the scanner camera. Tap a pending invite and choose \"Revoke invitation\" to cancel it.",
    "limitations": "Only event managers and above can invite or revoke scanners. Scanners can only scan tickets (in the iOS and Android app); they do not see sales, orders or settings. Only one pending invite per email. The \"Accept payments at the door\" option is saved, but door sales are not limited by it in the app, and only cash and manual door payments exist. The brand-wide scanner screen is reached through search rather than a menu button.",
    "support_wording": "Hosts can invite door staff from the Scanners tile on an event, either for that event only or for every event in the brand. The scanner accepts from the email link and then scans tickets in the Mingla Host app on their phone.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Scanner"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "events-ticket-delivery",
    "title": "Ticket confirmations by email and SMS, plus a ticket PDF",
    "outcome_summary": "After buying or reserving tickets, the buyer gets a confirmation email with their QR ticket as a PDF attachment and a calendar file, and, if they gave a phone number, a short confirmation text. The ticket PDF can be downloaded again in the Mingla Explorer app, and hosts can resend the ticket email from the order.",
    "how_to": "Buyer: after checkout the confirmation page says \"You're in\" and \"Sent to\" the buyer's email and phone. The email carries the ticket PDF with one QR code per ticket and a calendar file. In the Mingla Explorer app, open the ticket from your plans and tap \"View ticket\", then \"Download PDF\" to save or share it (Save to Files on iOS, choose a destination on Android). The text message is short and has no QR code or link.\nHost: in Mingla Host open the event, go to its orders, open the order and tap \"Resend ticket\"; a toast confirms \"Sent to\" the buyer's email. Resend appears only for paid or partly refunded orders with tickets left. Failed sends are retried automatically every few minutes.",
    "limitations": "The email is the ticket; the text is only a heads-up. Texts depend on a per-country SMS switch (Nigeria is switched separately from other countries) and may be off in a market. Nigerian texts are held between 20:00 and 08:00 Lagos time and sent the next morning. No Apple or Google Wallet pass. Resend goes to the email on the order; changing the buyer's email is not part of this flow. The Explorer download needs the ticket to be linked to the buyer's account.",
    "support_wording": "Every order gets a confirmation email with the tickets attached as a PDF, plus a text if a phone number was given. If the email is missing, ask the buyer to check spam, then the host can resend it from the order in Mingla Host. Buyers using the Explorer app can also open the ticket and tap Download PDF.",
    "who_can_use": [
      "Buyer",
      "Explorer",
      "Host",
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Email",
      "SMS",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-ticket-transfers",
    "title": "Transfer a ticket to someone else",
    "outcome_summary": "Buyers cannot transfer, pass on, send or give a ticket to another person in Mingla, and hosts cannot move a ticket to a new name. The transfer setting was removed from the host apps because the transfer flow was never built.",
    "how_to": "There is no transfer flow to direct anyone to. The \"Allow transfers\" style toggle was removed from the event settings step and the ticket type editor. If a guest cannot attend, the options are: the guest hands their QR ticket (email or PDF) to the other person, since entry is by QR scan, or the guest contacts the host, who can tap \"Refund order\" on the order screen in Mingla Host under the event's refund policy, after which the other person buys their own ticket.",
    "limitations": "Removed. No buyer, host or staff screen can reassign a ticket, and no server function does it. An internal transfer setting is still stored on ticket types but nothing reads it for buyers. Sharing the QR ticket works only because scanning checks the code, not the holder's name; a host can refuse this at the door.",
    "support_wording": "Mingla does not offer ticket transfers; that option was removed. If you cannot attend, contact the event host about a refund under their refund policy.",
    "who_can_use": [
      "Buyer",
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "events-ticket-types",
    "title": "Ticket types: price, capacity, hidden, password, approval, sale window",
    "outcome_summary": "Hosts can add several ticket types (tiers, ticket categories like General Admission or VIP) to an event, each with its own name, description, price or free, capacity or unlimited, visibility (public, hidden link only, paused), where it is sold (online, door, both), approval, password, waitlist, per-buyer limits and a sale window.",
    "how_to": "1. In the event wizard open the \"Tickets\" step (or Manage event > \"Edit details\" > Tickets on a live event).\n2. Tap \"Add ticket type\".\n3. Fill in the ticket name and description, then either a price or switch on \"Free ticket\"; set a capacity or switch on \"Unlimited capacity\".\n4. Choose visibility: \"Public\", \"Hidden, direct link only\" or \"Disabled, sales paused\"; and \"Available at\": \"Online and at the door\", \"Online only\" or \"Door only\".\n5. Under \"Access controls\" switch on \"Approval required\", \"Password protected\" (at least 4 characters) or \"Enable waitlist\" as needed.\n6. Set minimum and maximum tickets per buyer, and an optional \"Sale period (optional)\" with \"Sales open\" and \"Sales close\".\n7. Tap \"Save ticket\" (or \"Save changes\" when editing). Use \"Who covers the costs?\" on the same step for fees and VAT.\nSame on iOS, Android and web.",
    "limitations": "Paid tickets need the brand to have a payout currency; until then the step shows \"Currency not set\". Changing price, free status or capacity on a ticket that has sold is locked until affected buyers are refunded; buyers keep the price they paid. A waitlist needs a limited capacity. Description is limited to 280 characters. On recurring events capacity is per night. Ticket transfers are not available. Changing pricing settings needs Finance manager or above.",
    "support_wording": "Each event in Mingla Host can have several ticket types, each with its own price or free, capacity, visibility, sale dates and per-buyer limits. A ticket can be hidden so only people with the direct link see it, protected with a password, set to need your approval, or given a waitlist when it sells out. Once a ticket has sold, its price and capacity are locked unless you refund those buyers.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web"
    ]
  },
  {
    "capability_key": "events-tier-waitlist",
    "title": "Join the waitlist for a sold-out ticket type",
    "outcome_summary": "When a ticket type sells out and the host has turned its waitlist on, buyers on the public event page can join a waitlist with their email or phone. If a ticket is later refunded or cancelled, or a checkout hold expires, the next person in line is emailed (or texted) a link to claim the spot within 24 hours. Also called a sold-out waitlist or waiting list.",
    "how_to": "Host (Mingla Host, any platform): edit the ticket type, give it a limited capacity, and turn on \"Enable waitlist\" (\"When this ticket sells out, buyers can join a waitlist.\"). The same sheet shows \"Waitlist\" with the number waiting; tap \"See all\" to view \"Waitlist signups\".\nBuyer (public event page or checkout on the web): on a sold-out ticket type, tap \"Join waitlist\". In the \"Join waitlist\" sheet enter \"Email\" and/or \"Phone\", an optional name, the quantity, tick consent, and tap \"Join waitlist\". The page confirms \"You're on the waitlist.\" When a spot frees up, the buyer gets a \"Claim spot\" email (or a text if only a phone was given) and has 24 hours.",
    "limitations": "Buyer web only; the Mingla Explorer app does not offer joining a ticket waitlist. Works only on ticket types with a set capacity and the waitlist switched on. Spots are offered first come, first served, one freed ticket at a time. The \"Claim spot\" link opens the normal checkout; the code does not appear to reserve the freed ticket for the invited person, so someone else may buy it first. Text invites depend on the SMS switch for that country. This is separate from the RSVP event waitlist and the venue table waitlist.",
    "support_wording": "If the host has turned on a waitlist for a sold-out ticket, you can join it from the event page with your email or phone. If a ticket frees up, the next person on the list gets a link to claim it within 24 hours. Joining does not guarantee a ticket.",
    "who_can_use": [
      "Buyer",
      "Host",
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Buyer web",
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email",
      "SMS"
    ]
  },
  {
    "capability_key": "events-turnout-forecast",
    "title": "Turnout forecast",
    "outcome_summary": "While a host creates an event or RSVP, Mingla Host shows a turnout forecast card: an estimated range of how many people will come out of the capacity, with the main drivers behind it. It helps hosts predict attendance, set capacity and price, and see the effect of changes before publishing. Also called attendance prediction or turnout estimate.",
    "how_to": "In Mingla Host (iOS, Android or web), start a new event or RSVP. Once the title, category, city, a valid date and a limited capacity are filled in, a \"TURNOUT FORECAST\" card appears on the When, Where and Tickets steps of the event wizard and on the RSVP setup step. It shows a low to high range \"of\" the capacity and the drivers. Tap \"See full forecast\" for the full report. If you change inputs, the card says \"Inputs changed\"; tap \"Update forecast\". If a check fails, tap \"Try again\".",
    "limitations": "Not shown for online events, unlimited capacity tickets, or before the basic details are filled in. Metered: about 10 checks per brand per day across the AI growth tools; after that the card says \"You've used today's checks.\" and they refresh the next day. Unchanged inputs reuse the last answer without using a check. Needs a connection (\"You're offline\" otherwise). The result is an estimate, not a guarantee. Not offered on trips. Separate from the free Event Turnout Predictor on the marketing website.",
    "support_wording": "Mingla Host shows a turnout forecast while you create an event, estimating how many people are likely to come based on your details. It appears once the title, category, city, date and capacity are set, and there is a daily limit on checks per brand. It is an estimate only.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "events-update-email",
    "title": "Email buyers automatically when a live event changes",
    "outcome_summary": "When a host changes the date, time, venue, address or format of a live event, RSVP or experience, Mingla records the change and the host's reason and is built to email ticket holders and going guests about it. Right now this email is in testing: it only goes to internal test addresses, so buyers are not emailed and the host's screen says so.",
    "how_to": "In Mingla Host, edit a published event, RSVP or experience and tap save. The \"Review changes\" screen lists what changed, asks for a reason (10 to 200 characters, optional when nobody has booked), and its footer says plainly whether buyers will be emailed, for example \"Buyer emails are not switched on yet. This change is saved and logged; buyers are not emailed.\" or \"Buyer emails are being tested. Only test addresses will be emailed about this change; your buyers are not emailed yet.\" Tap \"Save changes\". When it is fully on, one email per event goes out after five quiet minutes, at most fifteen minutes after the first change and never within twenty minutes of the last email; an edit that is put back sends nothing. Going RSVP guests still get the usual \"plans changed\" alert either way.",
    "limitations": "Limited. Three server switches control it: a master switch that ships off, a pilot list of brands until it is opened to all brands, and a test-only mode that ships on and sends only to addresses on an internal allowlist. In production the master switch is on, but the test-only mode is also on and it is not opened to all brands, so only internal test addresses are emailed and no real buyer is emailed. Trips are not covered (\"Travellers are not emailed about edits yet.\"). Email only, no text. Buyers without an email address are not emailed. Hidden addresses and online links are never printed in the email.",
    "support_wording": "When a host changes a live event, the change and the host's reason are recorded, but automatic update emails to buyers are only switched on for a limited test, so most buyers are not emailed yet. Hosts should message their guests directly, for example with Blasts, about important changes.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "events-visibility",
    "title": "Public or unlisted events",
    "outcome_summary": "Hosts choose whether an event is Public (anyone on Mingla can find it, shown on the brand page and in discovery) or Unlisted (hidden, only people with the direct link can see and buy). The same settings step also offers password protection, approval to buy, hiding the remaining count and a private guest list.",
    "how_to": "1. In the event wizard open the \"Settings\" step (or Manage event > \"Edit details\" > Settings on a live event).\n2. Under visibility choose \"Public\" (\"Anyone on Mingla can find this event. The link is shareable.\") or \"Unlisted\" (\"Only people with the direct link can see this event.\").\n3. Optional toggles: \"Require approval to buy\", \"Hide remaining count\", \"Password-protected\", \"Private guest list\", \"In-person payments\".\n4. Publish, or save your changes. Share the link from Manage event > \"Share event\" for an unlisted event.\nSame on iOS, Android and web.",
    "limitations": "\"Private\" (invite-only ticket sales) is shown but disabled: the app says \"Private ticket sales are not ready yet. Choose Public or Unlisted to publish.\" An older draft already set to Private cannot be published until switched. Unlisted is not secret: anyone who has the link can open and buy. Changing visibility on a live event goes through the normal live edit review.",
    "support_wording": "In Mingla Host you can make an event Public, so anyone on Mingla can find it, or Unlisted, so only people you send the link to can see it. Private, invite-only ticket sales are not available yet, so please choose Public or Unlisted.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "events-waiting-room",
    "title": "Waiting room for big on-sales",
    "outcome_summary": "A waiting room (online queue) for very high-demand ticket releases, where buyers hold a place in line and are let into checkout in order. It is not switched on for any event, so buyers do not see it and hosts cannot request it from the app.",
    "how_to": "Hosts have no setting to turn on a waiting room. The web checkout is ready to show a \"Waiting room\" screen (\"Holding your place…\", \"You're next\", or the number ahead of you) only if Mingla staff arm a specific ticket type for queueing, and none are armed. Buyers who see a sold-out or busy message should simply try again or join the ticket type's waitlist if the host has one.",
    "limitations": "Not available. Arming is a staff-only server action with no host or admin screen, and no ticket type is armed. Even when armed it applies only to web checkout with a single ticket type in the cart; the apps never join the queue. Default limits are placeholders: it starts only above about 250 people holding tickets at once and admits about 20 per second.",
    "support_wording": "Mingla does not offer a waiting room for ticket on-sales yet. Hosts expecting very high demand should contact the Mingla team ahead of the sale.",
    "who_can_use": [
      "Buyer",
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "events-wallet-passes",
    "title": "Apple or Google Wallet passes",
    "outcome_summary": "Mingla does not issue Apple Wallet or Google Wallet passes for tickets. The add to wallet buttons were removed from the order confirmation and order pages. Buyers keep their QR tickets in the confirmation email PDF, the order page and the Mingla Explorer app.",
    "how_to": "There is no wallet flow. To keep a ticket handy, the buyer can use the PDF attached to the confirmation email, open the order page on the web, or open the ticket in the Mingla Explorer app and tap \"View ticket\" then \"Download PDF\" to save it to Files or the phone. A screenshot of the QR code also scans at the door.",
    "limitations": "Removed. No .pkpass or Google Wallet pass is generated anywhere, and no button offers one on web, iOS or Android.",
    "support_wording": "Mingla does not offer Apple Wallet or Google Wallet passes; that option was removed. Your ticket is the PDF in your confirmation email, and you can also open it in the Mingla Explorer app and download it.",
    "who_can_use": [
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "experiences-create",
    "title": "Create a multi-stop experience sold as one ticket",
    "outcome_summary": "Hosts build an experience: a 2 to 5 stop itinerary (for example brunch then a tasting, a food crawl, a class and dinner) sold as one booking. Set one price for the whole experience or price each stop, choose one date, several dates or a repeating schedule, then publish. Guests pick a date and time and reserve or buy a spot on the public page, buyer web checkout or the Mingla Explorer app. Also called an itinerary, multi-stop outing, tasting menu experience or package.",
    "how_to": "1. In Mingla Host (iPhone, Android or web) tap the \"+\" button in the top bar, choose \"Create experience\", then \"Build it yourself\". (\"Snap a food menu\" and \"Snap an activities menu\" draft one for you from a photo instead.)\n2. Identity: enter the \"Experience title\", \"What's it about?\" (10 to 500 characters) and pick at least one vibe under \"Which vibes fit this experience?\".\n3. Stops (\"Build the itinerary\"): choose \"One location for all stops\" or \"Each stop has its own location\", then tap \"Add stop\" for each stop. Each stop needs a \"Stop name\", a \"Description\" and an address picked from the suggestions; photos (up to 5 per stop) and a start time are optional. Use the arrows to reorder.\n4. When (\"When does it happen?\"): set a single date, several dates, or a repeating schedule that can run with no end date.\n5. Pricing: choose \"One price for the whole experience\" or \"Price each stop\", or tick \"This experience is free\". Set \"Total spots\" or \"Unlimited spots\", the refund policy, who covers fees and tax, and the guest privacy switches \"Private guest list\" and \"Hide remaining count\".\n6. Cover: add the cover image or video and theme.\n7. Review and tap \"Publish\", or \"Save as draft\" to finish later. A published experience opens its manage screen with Share and the public page.\n8. Find drafts and live experiences later under Hub > Experiences. Editing a live experience uses \"Save changes\".",
    "limitations": "Needs the brand owner, brand admin or event manager role; other team roles cannot create or publish. An experience must have 2 to 5 stops, a description, a vibe and validated addresses. A paid experience needs a connected bank (\"Bank required for paid experiences\") and the host must accept the Organiser Terms before a paid publish; free experiences can publish without a bank. Hosts with no payout country are asked to choose one first. Nigerian brands can sell experiences in naira (NGN) through Paystack. Guests in the Explorer app must be signed in to reserve.",
    "support_wording": "You can create an experience in Mingla Host by tapping +, then Create experience, then Build it yourself. Add 2 to 5 stops, set the dates and a price (one price or per stop, or free), and publish; paid experiences need a connected bank first. Guests then pick a date and reserve on your public page or in the Mingla Explorer app.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "experiences-snap",
    "title": "Snap a menu or list and get a draft experience",
    "outcome_summary": "Hosts take a photo or upload a PDF of a food or drinks menu, or of an activities and rates list (bowling, arcade, escape room, mini-golf), and Mingla's AI reads it and creates draft experiences automatically, one per suggestion. The drafts land in Hub > Experiences where the host adds stops, dates and prices, then publishes or deletes them. Also called menu scan, menu upload, auto-draft or AI experience generator.",
    "how_to": "1. In Mingla Host tap the \"+\" button in the top bar, choose \"Create experience\", then \"Snap a food menu\" or \"Snap an activities menu\".\n2. In the \"Add your menu\" (or \"Add your activities list\") sheet choose \"Take photo\", \"Choose from library\" or \"Upload PDF\". JPG, PNG, WebP and PDF are accepted.\n3. Wait while Mingla shows \"Reading your menu…\" then \"Creating your experiences…\". Do not leave the screen; Back is disabled while drafts are created.\n4. Mingla opens Hub > Experiences with a message saying how many draft experiences were created. Open each draft, add stops, a date and a price, then publish it, or delete the ones you do not want.\n5. If nothing was found you stay on the snap screen with a message such as \"We couldn't find menu items in that file. Try a clearer photo of your menu.\" and can try again.",
    "limitations": "Needs the brand owner, brand admin or event manager role (the server refuses other roles). Files must be images or PDFs, 10 MB at most. Each person can run about 20 reads per day per menu type; after that the app says the daily limit is reached. Results are AI suggestions and can miss items or misread prices; every result is only a draft and nothing publishes until the host finishes and publishes it. Drafts still need stops, dates and a price before publishing, and the publishing rules for experiences apply (bank for paid, Organiser Terms). Camera and photo library permissions are needed on iPhone and Android.",
    "support_wording": "In Mingla Host tap +, then Create experience, then Snap a food menu or Snap an activities menu, and take a photo or upload a PDF. Mingla reads it and creates draft experiences in Hub > Experiences; nothing goes live until you add the details and publish each one. If it finds nothing, try a clearer photo.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "help-announcements-roadmap",
    "title": "Announcements and the public roadmap",
    "outcome_summary": "Hosts read Mingla news and see what Mingla is building. In the Host app, Help & Support has a Community tab with Announcements (service notices and product updates, with an unread dot and count) and a Roadmap grouped into Being delivered now, Next, Later and Recently shipped. Hosts can also turn announcement emails on or off.",
    "how_to": "1. In the Mingla Host app open Account, then \"Help & Support\" (the row shows a count when there are unread announcements).\n2. Tap the \"Community\" tab, then \"Announcements\". Tap a card to read it in full. Opening it marks it read. Some announcements show a \"What you need to do\" box and an \"On the roadmap\" link to the related roadmap item. Tap \"Back to announcements\" to return.\n3. At the bottom of Announcements, use the \"Email me announcements\" switch to stop or restart announcement emails. Push stays on.\n4. Tap \"Roadmap\" to see public roadmap cards grouped as \"Being delivered now\", \"Next\", \"Later\" and \"Recently shipped\". A card may show \"Aiming for\" a target and how many host ideas fed it.\n5. On a wide desktop browser the same sections appear in a left rail under COMMUNITY.",
    "limitations": "Read only for hosts: hosts cannot comment on announcements or roadmap cards. Only Mingla Owners and Admins write and publish announcements and roadmap cards (Admin, Community & Support, Community tab). The roadmap shows only cards staff have published; if none are published hosts see \"Nothing published yet\". The email switch covers announcement emails only; push notices stay on. Requires signing in to Mingla Host.",
    "support_wording": "In the Mingla Host app, go to Account, then Help & Support, then Community. Announcements has Mingla's latest updates, and Roadmap shows what we are working on now, next and later. You can turn announcement emails off with the Email me announcements switch at the bottom of Announcements.",
    "who_can_use": [
      "Host (signed in)"
    ],
    "surfaces": [
      "Mingla Host app (iOS, Android, web)"
    ]
  },
  {
    "capability_key": "help-ideas-and-questions",
    "title": "Suggest ideas, vote, ask and answer questions",
    "outcome_summary": "Hosts share feature ideas, vote on other hosts' ideas, ask questions and answer each other in the Community tab of Help & Support. Ideas show a status (New, Under review, Planned, In progress, Shipped, Not now). Mingla staff replies carry a MINGLA TEAM badge. Hosts can report posts or block an author.",
    "how_to": "1. In the Mingla Host app open Account, then \"Help & Support\", then the \"Community\" tab.\n2. Tap \"Ideas\" to see ideas with their status and vote count. Tap \"Vote\" (it changes to \"Voted\") to back one. Tap \"Suggest an idea\", add a title and details, then \"Suggest idea\". While typing a title, similar ideas appear under \"Vote instead?\" so you can vote on an existing one.\n3. Tap \"Questions\" to browse. Tap \"Ask a question\", add a title and details, then \"Ask question\".\n4. Open any post to read replies, write an answer or comment and tap \"Reply\". On your own question you can tap \"Accept answer\".\n5. On someone else's post tap \"Report\" or \"Block author\". If one of your posts was held back, tap \"Appeal decision\".",
    "limitations": "A host's first three posts are reviewed by Mingla before everyone can see them (shown as \"In review\"). Posts that mention phone numbers, email addresses or bank details are held for a person to review. Staff can lock a conversation, which stops new replies. Staff can pause a host from posting for 7 days, 30 days or permanently. Titles up to 160 characters, details up to 5000, replies up to 3000. Requires signing in to Mingla Host.",
    "support_wording": "Go to Account, then Help & Support, then Community in the Mingla Host app. Under Ideas you can suggest something or vote on other hosts' ideas, and under Questions you can ask or answer. Your first three posts are checked by our team before everyone can see them.",
    "who_can_use": [
      "Host (signed in)"
    ],
    "surfaces": [
      "Mingla Host app (iOS, Android, web)"
    ]
  },
  {
    "capability_key": "help-support",
    "title": "Contact Support inside Mingla Host",
    "outcome_summary": "Hosts start a support chat with Mingla from inside the Host app and get replies in the same thread. Staff replies show the staff member's own name with Mingla Support. The Support tab shows whether Support is online or away and lists past requests with their status (Open, Pending, Resolved, Closed).",
    "how_to": "1. In the Mingla Host app open Account, then \"Help & Support\", then the \"Support\" tab.\n2. A banner shows \"Support is online\" or that Support is away and will reply when back.\n3. Under \"Need a hand?\", type a short subject (for example payouts or a stuck event) and tap \"Start a chat\".\n4. In the chat, type in \"Write a message\" and tap \"Send\". Replies from Mingla appear in the same thread.\n5. Reopen any earlier chat from \"My support requests\"; each one shows its status and last update date.",
    "limitations": "Text chat only: no file or photo attachments in the host support chat. A subject is required to start a chat (up to 200 characters). Replies are not instant; when Support is away the host waits until a teammate is back. Staff replies show the replying teammate's display name with \"Mingla Support\"; if the teammate has no name on file it shows \"Mingla teammate\", and older replies from before named replies show only \"Mingla Support\". A host can see only their own requests. Requires signing in to Mingla Host.",
    "support_wording": "Open the Mingla Host app, go to Account, then Help & Support, then Support. Add a short subject and tap Start a chat, and a real person on the Mingla team will reply in that chat. You can come back to it any time under My support requests.",
    "who_can_use": [
      "Host (signed in)"
    ],
    "surfaces": [
      "Mingla Host app (iOS, Android, web)"
    ]
  },
  {
    "capability_key": "help-video-guides",
    "title": "20 video guides in the Help Centre and in the app",
    "outcome_summary": "Twenty short how-to videos for hosts, in three chapters: Getting started, Creating what you sell, and Selling and running it. They cover getting the apps, creating a brand, connecting a bank, selling event tickets (one-night, multi-day, weekly, online, hybrid, Nigeria), RSVPs, venues and menus, guest lists and campaigns. Watch them on usemingla.com/help or in the Host app under Help & Support, Guides. Each video page lists the steps in writing.",
    "how_to": "Website: go to usemingla.com/help. Use the search box (\"What are you trying to do?\") or the intent chips, or browse by chapter. Open a video to watch it and read \"What happens in this video\" step by step.\n\nHost app: open Account, then \"Help & Support\", then the \"Guides\" tab. Five featured guides show first; tap one to play it in the app. Tap \"View more\" to see all guides by chapter and search with \"Search the full Mingla Host video library\". Tap \"Help Centre videos\" to open the website in your browser.",
    "limitations": "Twenty videos at the pinned commit, all with a video attached. Captions are available only on videos marked as having captions. The in-app Guides tab needs a signed-in host; the website Help Centre is public. Videos show the app at the time they were recorded, so screens may differ slightly after later updates.",
    "support_wording": "We have 20 short video guides at usemingla.com/help, and the same videos are in the Mingla Host app under Account, then Help & Support, then Guides. Each one also lists the steps in writing so you can follow along.",
    "who_can_use": [
      "Host",
      "Everyone (website)"
    ],
    "surfaces": [
      "Mingla website (usemingla.com/help)",
      "Mingla Host app (iOS, Android, web)"
    ]
  },
  {
    "capability_key": "marketing-ad-credit",
    "title": "Ads credit wallet: top up and withdraw",
    "outcome_summary": "A brand keeps a prepaid Ads credit balance in Mingla Host and pays for its paid ads from it. The brand owner adds credit by card or, for naira brands, through Paystack; Mingla keeps 15% of each top-up as its service fee and the rest becomes spendable ad budget. Unused credit can be withdrawn (refunded) to the original payment method, with the matching share of the fee returned. Also known as ad wallet, ad balance, ad budget top-up, ads funds, refund ad credit.",
    "how_to": "1. Open the Blast tab, then the Ads pill at the top (Overview, People, Campaigns, Templates, Ads).\n2. The \"Available credit\" card shows the balance in the brand's settlement currency, with the note that top-ups keep 15% as Mingla's fee.\n3. To add money, tap \"Add credit\". In the \"Add Ads credit\" sheet enter an amount, tap \"Preview\" to see \"You pay\", \"Fee\" and \"Credit\", then tap \"Confirm and pay\". On iOS and Android a card payment sheet opens in the app; on web you go to a card checkout page and return to Ads, where you see \"Ads credit added.\" Naira brands are sent to a Paystack page to pay.\n4. To take unused credit back, tap \"Withdraw\", enter the amount, tap \"Preview\" to see \"Credit out\", \"Fee returned\" and \"Est. refund\", then tap \"Confirm withdraw\". The refund goes back to the original top-up payments, oldest first.\n5. The \"History\" list on the same screen shows each top-up, withdrawal, hold and return.",
    "limitations": "Only the brand owner sees the \"Add credit\" and \"Withdraw\" buttons in the app. Brand admins and finance managers can see the balance and history; other roles see a note that a brand owner or finance manager manages the balance. Ads credit unlocks only after the brand has one verified settlement currency and payout account; until then the card reads \"Finish payout setup\". Credit is held in that one currency: card top-ups are supported for USD, GBP, EUR, CAD, CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON, BGN and ISK through Stripe, and NGN only through Paystack. Each top-up has a minimum and maximum, for example at least $25, £20, €25, CA$35 or ₦25,000, and at most roughly $5,000 in local currency (₦7,500,000 for naira). Mingla's 15% fee is taken at top-up. Withdrawals are estimates until applied and are paid back to the original payment method; very small Paystack refunds below ₦50 are refused. Credit held for a running ad cannot be withdrawn until that ad settles.",
    "support_wording": "Ads credit is a prepaid balance your brand uses to pay for ads in Mingla Host, found under Blast, then Ads. The brand owner can add credit by card (or through Paystack for naira brands) and Mingla keeps 15% of each top-up as its fee; unused credit can be withdrawn back to the original payment method with that share of the fee returned. Your brand needs a verified payout account and settlement currency before Ads credit becomes available.",
    "who_can_use": [
      "Brand owner",
      "Brand admin (view only)",
      "Finance manager (view only)"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "marketing-analytics",
    "title": "Brand analytics and listing insights",
    "outcome_summary": "Hosts see how customers find and choose their brand: how many customers Mingla drove (bookings, RSVPs and paid booking value in the last 30 days and all time), where customers came from (Search / SEO, Mingla discovery, Social, Direct link), repeat customers (Regulars) and patterns such as the days, times and offering types customers choose most. Each event or RSVP listing also has its own Insights page. Also known as stats, reports, dashboard, performance, attribution, repeat customers, traffic sources.",
    "how_to": "Brand analytics:\n1. On the Home tab, tap the \"ANALYTICS\" card to expand it (it shows the last 30 days), then tap it again or tap \"Open\" to go to the Analytics screen.\n2. The screen opens with \"See how customers find and choose\" followed by your brand name, then shows \"Customers Mingla drove\" (LAST 30 DAYS and ALL TIME), \"Where customers came from\", \"Regulars\" with \"Top regulars\", and pattern cards: \"Days customers chose most\", \"Times customers chose most\" and \"Customers by offering type\".\n3. On a wide desktop web window use the \"Refresh\" button; on phones pull down to refresh.\n\nListing insights:\n1. Open an event or RSVP listing from the Hub.\n2. Tap the \"Insights\" tile (\"Customers Mingla drove\").\n3. The \"Insights\" screen shows how many customers Mingla drove for that listing, its paid booking value, and \"Where customers came from\". Use \"Refresh\" to update.",
    "limitations": "Scanner-only team members cannot open Analytics or Insights; they see \"Analytics unavailable\". Any other accepted team member of the brand can view them. Counts only cover bookings, RSVPs and paid orders completed through Mingla; offline door sales are not included. Regulars show masked contact details only (for example a partly hidden email or the last digits of a phone), never full contact details. Pattern cards need enough bookings before they show a pattern (\"More data needed\" / \"No clear pattern yet\"). The Insights tile is shown on event and RSVP listing screens; trip and experience screens do not currently have an Insights button. Money is shown per currency and is not converted.",
    "support_wording": "You can see your brand's analytics in Mingla Host by tapping the Analytics card on the Home tab: it shows how many customers Mingla drove, where they came from, your regulars and the days and times people book most. For a single event or RSVP listing, open it and tap Insights. Scanner-only team members cannot see analytics.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Marketing manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "marketing-buyer-blasts",
    "title": "Message an event's buyers",
    "outcome_summary": "Send an email blast (message, announcement, update or promo) to everyone who bought tickets to one of your events, or to all buyers across your brand. Mingla builds the buyer list for you from paid orders, skips anyone who has unsubscribed, and shows how many buyers it can reach before you send.",
    "how_to": "1. Open the event in Mingla Host and tap the \"Blasts\" tile (\"Message ticket buyers\"). The Blasts screen lists the event's buyers with a count such as \"12 buyers · 10 reachable\".\n2. Tap \"Send Blast (N)\" at the bottom. The campaign composer opens with the audience set to \"Event buyers\".\n3. Write a subject and message (the Email tab is selected by default), then tap \"Preview email\" to check it.\n4. Choose \"Now\" or pick a time with the schedule chip, then tap \"Send now\" or \"Schedule\" and confirm in the review sheet.\n5. To message every buyer of the brand instead, open the brand page, tap \"Blasts\" (\"Message your event buyers about what's next\"), then \"Send Blast (N)\". You can also start from Blast tab > Campaigns > \"New campaign\" and pick an audience under \"Automatic\" (\"Buyers of <event name>\" or \"All buyers of <brand>\").\n6. Track results under Blast tab > Campaigns: tap a sent campaign to see accepted, delivered, opened, clicked, bounced and unsubscribed counts.\nThe same steps work on iOS, Android and web.",
    "limitations": "Who can send: brand owner, brand admin or event manager. Marketing managers can open the Blast tab but the server refuses to save or send a campaign for them; scanners and finance managers cannot create campaigns.\nAudience: buyers with a paid or partly refunded order. People who unsubscribed or opted out are skipped automatically. The send button is disabled when nobody is reachable.\nSMS: the composer also has an SMS tab, but SMS campaigns are not currently confirmed working in production, so treat buyer blasts as email only. In code, marketing texts only go to US and Nigerian numbers and are held until the recipient's local daytime window (8am to 9pm US, 8am to 8pm Nigeria).\nRSVP (free) events: the Blasts screen lists going guests, but the sending code builds event audiences from ticket orders only, so a blast to an RSVP event's guests may reach nobody. Not yet confirmed at runtime.\nNo per-blast attachments other than images inside the email body; the monthly send allowance shown in the composer applies to Your Book, groups and follower audiences, not to buyer audiences.\nThe Blast tab can be hidden in a Host build by a build switch (on by default).",
    "support_wording": "Hosts can email everyone who bought tickets to an event: open the event, tap Blasts, then Send Blast. Mingla only includes buyers who have not unsubscribed, and you can send right away or schedule it. Text message blasts are not something we can confirm for you right now, so please use email.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "marketing-campaigns",
    "title": "Email and SMS campaigns to your people",
    "outcome_summary": "Write and send email campaigns (newsletters, announcements, promos, blasts) to your buyers, your contact book (Your Book), saved groups, or followers. Use the rich editor, start from a template, send now or schedule for later, save drafts, and see a report of who received, opened and clicked each campaign. Unsubscribe links are added for you.",
    "how_to": "1. In Mingla Host, open the \"Blast\" tab. Its sub-tabs are \"Overview\", \"People\", \"Campaigns\", \"Templates\" and \"Ads\".\n2. Tap \"New campaign\" (on Overview or Campaigns).\n3. Tap \"Pick an audience\" and choose who gets it: \"Your Book\", a saved group under \"Groups\", \"Followers\" or \"Friends of followers\" (when available), or an automatic buyer group such as \"Buyers of <event name>\".\n4. Keep the \"Email\" tab selected, write a subject and message. Use the toolbar to add links, images, dividers, or \"From template…\".\n5. Tap \"Preview email\". Choose \"Now\" or pick a send time, then tap \"Send now\" or \"Schedule\" and confirm in the review sheet. For Your Book, groups and followers the review sheet shows reach, cost and how many emails are left this month.\n6. Your work auto-saves; tap \"Save draft\" any time. Under Campaigns, filter by \"All\", \"Scheduled\", \"Sent\", \"Drafts\" or \"Failed\"; tap \"Resume\" on a draft, \"Cancel\" on a scheduled send, or \"Delete\" on a failed one.\n7. Tap a campaign to see its report: total audience, accepted, delivered, opened, clicked, bounced, marked as spam, unsubscribed, link clicks, and every recipient's status. Overview shows totals for the last 30 days.\nWorks the same on iOS, Android and web (web adds keyboard shortcuts in the composer).",
    "limitations": "Roles: the Blast tab shows for marketing manager and above, but saving or sending a campaign needs event manager, brand admin or brand owner. Sending to Your Book needs event manager or above; groups and followers need marketing manager or above.\nSMS: the composer has an SMS tab (texts with up to 10 photos), but SMS campaigns are not currently confirmed working in production. In code, marketing texts go only to US and Nigerian numbers and are held until the recipient's local daytime window (8am to 9pm US, 8am to 8pm Nigeria), then fail if they cannot be sent within 24 hours.\nMonthly limits per brand for Your Book, group and follower sends: 1,000 emails and 100 texts per calendar month (UTC). A warning appears after several blasts in one week.\nYour Book, group and follower audiences are switched on in production. Follower audiences are email campaigns only: follower email and text reach switches are off, and wider follower reach (friends of followers) is not switched on.\nLive delivery is controlled by a server delivery setting that is off in code by default; when off, campaigns run but every recipient shows \"Preview only (no real email sent)\". Email sending is confirmed live in production.\nOpen counts only cover tracked emails; people who unsubscribed or opted out are always skipped.",
    "support_wording": "Hosts can send email campaigns from the Blast tab in Mingla Host: tap New campaign, pick who it goes to, write your email, then send now or schedule it. Each campaign has a report showing deliveries, opens and clicks, and every email includes an unsubscribe link. Text message campaigns are not something we can confirm for you right now, so please use email.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email"
    ]
  },
  {
    "capability_key": "marketing-contact-import",
    "title": "Import contacts from CSV",
    "outcome_summary": "Upload a spreadsheet (CSV file) of your customers or mailing list, for example an Eventbrite or Mailchimp export, into your brand's contact book (Your Book) so you can email or text them from Mingla Host. You map the columns, preview what will be added, and confirm you have permission to contact these people.",
    "how_to": "1. In Mingla Host, open the \"Blast\" tab and go to \"People\".\n2. Tap \"Import\".\n3. Tap \"Choose CSV\" and pick a file with a name, email or phone column (up to 10,000 rows). Tap \"Continue\".\n4. On \"Map columns\", choose what each column means (Full name, First name, Last name, Email, Phone, or Ignore). Eventbrite and Mailchimp exports are recognised automatically.\n5. Check the \"Preview\" (nothing is added until you confirm). Rows already opted out show \"Email suppressed\" or \"Text suppressed\".\n6. Tick the \"PERMISSION TO CONTACT\" box, which confirms the people gave your brand permission to be contacted and that the list was not bought, rented or scraped.\n7. Tap \"Confirm and import N contacts\", then \"View Your Book\" or \"Import another CSV\".\nOn iOS and Android the file comes from the device's file picker; on web from the browser's file chooser.",
    "limitations": "Contact import is switched on in production. Mingla can switch it off again with a server setting; if that happens the Import button is hidden and the server refuses imports.\nRoles: marketing manager and above (brand owner, brand admin, event manager, finance manager, marketing manager). Scanners cannot import.\nCSV only, up to 10,000 rows and 10 MB per file. You must tick the permission statement; Mingla records it with your name, the date and the exact wording.\nYou must be online. Possible duplicates are counted for review, but the conflict review screen is not available from the import result yet (it shows \"Conflict review is coming next\").\nImported people can be sent campaigns through the Your Book audience, which is switched on in production.",
    "support_wording": "Contact import lets a host upload a CSV of their own customers into Your Book from the People section of the Blast tab. Only team members with the marketing manager role or above see the Import button. You will be asked to confirm that everyone on the list agreed to hear from your brand.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Marketing manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "marketing-host-ads",
    "title": "Run paid ads from Mingla Host (Meta, TikTok and other platforms)",
    "outcome_summary": "Hosts create and run paid social ads that send people to their public Mingla page, paid from the brand's Ads credit. A step-by-step builder covers what to promote, audience (countries, cities, interests, ages), budget and dates, video creative and copy, then review and launch. Hosts can follow results, pause, resume, cancel or end ads, and can ask Ari to plan an ad. Also known as advertising, promote my event, boost, Facebook ads, Instagram ads, Meta ads, TikTok ads, Snapchat ads, Google ads, Reddit ads, ad campaign.",
    "how_to": "1. Open the Blast tab, then the Ads pill. Make sure the brand has Ads credit first (see Ads credit).\n2. Under \"Your ads\" tap \"Create ad\". The builder has five steps: \"What are you promoting?\" (pick the Mingla page people land on), \"Who should see it?\" (platforms, country codes, optional city and radius, interests, age range), \"Budget and dates\" (daily budget, hard cap, optional start and end dates), \"Creative and copy\" (\"Add ad video\", confirm you have the rights to use it, campaign name, primary text, headline) and \"Review and launch\". Drafts save automatically (\"Saved to Mingla\").\n3. On the review step tap \"Prepare immutable plan\", check the plan, then tap \"Hold funds\" to reserve the budget from Ads credit.\n4. Type LAUNCH and tap \"Launch approved plan\". For a brand's first three ads, the plan goes to Mingla staff review first; funds stay held and nothing spends until staff approve.\n5. Back on Ads, filter the list by All, Draft, In review, Scheduled, Live, Paused, Needs attention or Ended. Open an ad to see \"Results\" (impressions, clicks, spend), \"Creative\" and \"Timeline\", and use \"Pause\", \"Resume\" (type LAUNCH), \"Cancel ad\" (type CANCEL) or \"End ad\" (type END). \"Ask Ari about this ad\" opens Ari.\n6. In the Ari tab you can also ask Ari to plan an ad; Ari prepares the same plan and asks you to approve it before any money is held.",
    "limitations": "Ads run through Mingla's own connected ad accounts, not the host's. The builder only offers the platforms Mingla currently has connected; the code supports Meta, TikTok, Google, Snapchat and Reddit. Ads must point to the brand's own public Mingla page. Video creative is required. Platform minimum budgets apply (for example TikTok about $50 a day, Snapchat about $20 a day). A brand's first three ads always go to Mingla staff review before anything is created on the ad platform, and the ad platform's own review can still delay delivery. Roles: brand owner can do everything; brand admin and marketing manager can plan; finance manager can view and hold funds; a marketing manager can launch or pause only if given the extra ad spend permission; only the brand owner can end an ad or cancel a funded plan. The Ads area needs a verified settlement currency and Ads credit. When an ad ends or is cancelled, unspent credit returns to Ads credit after final spend settles.",
    "support_wording": "You can run paid ads for your brand from Mingla Host under Blast, then Ads, paid from your prepaid Ads credit. The builder walks you through what to promote, audience, budget, video and copy, and you type LAUNCH to start; your first three ads are checked by the Mingla team before they go out. Which ad platforms you can choose depends on the platforms Mingla has connected at the time.",
    "who_can_use": [
      "Brand owner",
      "Brand admin (plan only)",
      "Marketing manager",
      "Finance manager (view and fund)"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "marketing-people",
    "title": "People: your brand's contact book, groups and duplicate merging",
    "outcome_summary": "Each brand gets a contact book of the people who gave it their details. Mingla adds buyers, ticket holders, RSVP guests and plus-ones, and reservation guests automatically, and the team can add people by hand. Hosts can open a person's contact details and marketing preferences, merge two records for the same person and split a merge again, review possible duplicates, see automatic buyer groups, export the book as a CSV, and start a campaign. Also known as contacts, customer list, CRM, audience, guest list, mailing list, dedupe, duplicate contacts.",
    "how_to": "1. Open the Blast tab, then the People pill.\n2. \"Your book\" lists people who gave your brand their details, with \"Add\", \"Import\", \"Export\" and \"See all\". Tap \"Add\" to add a person by hand.\n3. Tap a person to see \"Contact details\" and \"Marketing preferences\" (for example \"Email marketing suppressed\").\n4. To combine duplicates, tap \"Merge duplicate\" on the person, search by name, email or phone, choose the other record, pick the person to keep, check the \"Merged result\", then tap \"Review merge\" and confirm. To undo, find the merge in the person's history and tap \"Split\".\n5. When Mingla is unsure whether a new customer matches an existing person, a review strip appears; tap \"Review\" and choose \"Same person\", \"Different people\", \"Add to your book\" or \"Dismiss\".\n6. \"Groups\" shows buyer groups that update automatically, and you can tap \"Create group\" to organize people for campaigns.\n7. Tap \"Export\", then \"Prepare CSV\" and \"Download CSV\". The file includes email addresses, phone numbers and opt-out status.\n8. Tap \"New campaign\" to send a Blast to your people.",
    "limitations": "People needs the marketing manager role or higher; scanners cannot open it. Merging, splitting and filing review items need brand admin or brand owner; exporting the book also needs brand admin or owner, and the export link expires after 24 hours and is logged. Mingla-only profile details and circle connections are never included in exports. Manual groups and CSV contact import are switched on in production; Mingla can switch them off with server settings, in which case Groups shows only automatic buyer groups and Import is unavailable. Adding, merging and exporting need a connection; offline the book shows saved contacts only. Door sales recorded only on a device are not added to the book.",
    "support_wording": "Your brand's contact book is under Blast, then People, in Mingla Host. Mingla adds people automatically when they buy, RSVP or book, and you can add people yourself, merge duplicate records (and split them again) and export the list as a CSV. Merging and exporting need a brand admin or owner.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Marketing manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "marketing-templates",
    "title": "Email templates",
    "outcome_summary": "Reuse email designs for your campaigns: start from the Mingla starter pack, duplicate and edit one, or write and save your own email template, then load it into a new campaign in one tap or insert it while writing. Saves time on repeat announcements, newsletters and promos.",
    "how_to": "1. In Mingla Host, open the \"Blast\" tab and tap \"Templates\". You will see \"MINGLA STARTER PACK\" and, once you have some, \"YOUR TEMPLATES\".\n2. Tap a starter template to read it. Tap \"Duplicate\" to make your own editable copy, or \"Use this template\" to open a new campaign with it loaded.\n3. To write your own, tap \"New template\", add a subject (optional) and body (required), then tap \"Save\". The subject becomes the template name (or \"Untitled template\").\n4. Open one of your templates to edit and \"Save\", or tap \"Delete this template\" (campaigns that already used it keep their content).\n5. While writing a campaign, open the toolbar's overflow and pick \"From template…\" to browse templates, then tap \"Insert at cursor\" or \"Apply\" (\"Replace draft\" if you have unsaved edits).\nSame on iOS, Android and web.",
    "limitations": "Email only: templates cannot be used for SMS campaigns.\n\"YOUR TEMPLATES\" lists only templates you created yourself; teammates do not see each other's templates in this list.\nStarter pack templates are read only (duplicate them to edit).\nThe Templates tab shows for marketing manager and above, but saving a template tied to a brand needs event manager or above, and sending a campaign from a template needs event manager, brand admin or brand owner.",
    "support_wording": "In Mingla Host, go to the Blast tab and open Templates to use a Mingla starter email or save your own. Tap Use this template to start a campaign with it, or choose From template while writing an email. Templates are for email campaigns only.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "money-currencies",
    "title": "Supported currencies",
    "outcome_summary": "Hosts sell in the currency of the payout country they choose: GBP, USD, CAD, CHF, EUR, BGN, CZK, DKK, HUF, ISK, NOK, PLN, RON, SEK, or NGN for Nigeria. Guests pay in the host's currency. Search words: currency, sell in euros, dollars, pounds, naira, change currency, multi-currency, wrong currency.",
    "how_to": "Host app (iOS, Android, web): when you create a brand, choose your payout country under Payouts (\"Choose your payout country to set up payouts\"). That country sets the brand's currency, and new events, trips, experiences and RSVP chip-ins are priced in it. To change it, use Choose a different country on the brand's Payments screen before you sell.\nIf the brand's currency changes, open drafts switch to the new currency and their paid prices are cleared, with a notice explaining why.",
    "limitations": "One currency per brand, set by the payout country; there is no default currency. NGN is only for Nigerian brands paid through Paystack; the other 14 currencies are for Stripe brands in the 34 Stripe countries. Guests are charged in the host's currency, not their own. Discovery can show approximate prices in other currencies using daily exchange rates, but the charge is always in the host's currency.",
    "support_wording": "Your brand sells in the currency of the payout country you chose, from GBP, USD, CAD, CHF, EUR, BGN, CZK, DKK, HUF, ISK, NOK, PLN, RON, SEK, or NGN for Nigeria. Guests always pay in your currency.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Host app (iOS, Android, web)",
      "Buyer web",
      "Explorer app (iOS, Android)"
    ]
  },
  {
    "capability_key": "money-disputes",
    "title": "How chargebacks and disputes are handled",
    "outcome_summary": "When a guest disputes a card charge (a chargeback), Mingla records it, alerts the Mingla operations team, notifies the brand owner and finance teammates for card disputes, and deducts lost disputes from the brand's payouts. Search words: chargeback, dispute, disputed charge, evidence, bank reversed payment, fraud claim.",
    "how_to": "Host: you get a notification such as \"A charge was disputed\" or \"Evidence needed to contest a dispute\", which opens the brand's Payments screen. Any lost dispute shows as a \"Chargebacks / disputes\" deduction in the payout breakdown.\nMingla staff (Admin web): Money ledger → Disputes tab lists card disputes with their evidence-due countdown. Nigerian (Paystack) disputes open a detail view with an auto-assembled evidence pack (order, buyer, tickets issued, scans, consent and delivery records), an internal review deadline ahead of Paystack's auto-accept, a review step and an export. Orders filter by Disputed in Business orders.",
    "limitations": "Paystack gives about 16 hours before it auto-accepts a dispute, so staff must act fast; Mingla sets an internal deadline earlier than that. Sending evidence to Paystack from Admin is not wired up yet: the submit button only records what would be sent, so evidence has to be submitted to Paystack outside Mingla. The Host app has no screen to upload dispute evidence. Admin dispute screens are read-and-review only and do not move money.",
    "support_wording": "If a guest disputes a charge with their bank, Mingla is alerted and works the dispute; the brand owner is notified, and if the dispute is lost the amount is taken from future payouts. Please send any proof of attendance or delivery to Mingla support quickly, because disputes have short deadlines.",
    "who_can_use": [
      "Host (brand owner, finance)",
      "Mingla staff"
    ],
    "surfaces": [
      "Admin web",
      "Host app notifications",
      "Email (ops alerts)"
    ]
  },
  {
    "capability_key": "money-mingla-fee",
    "title": "Mingla's fee (1.5%)",
    "outcome_summary": "Mingla's platform fee is 1.5% of each sale by default, plus a separate service fee that covers payment processing. Hosts choose whether guests pay these on top of the price or the host covers them. Search words: Mingla fee, platform fee, commission, take rate, service fee, processing fee, how much does Mingla charge, all-in price.",
    "how_to": "Host app (iOS, Android, web): Account → your brand → Pricing defaults (\"Who covers VAT and fees by default\"). Under \"Who covers the costs?\" set Mingla fee and Service fee to Add to price (guests pay) or I'll cover it (you pay). You can override this per event, trip or experience in the pricing or tickets step. Guests always see one all-in price.\nMingla staff (Admin web): Pricing page sets Mingla's default take-rate and per-brand overrides.",
    "limitations": "The default Mingla fee is 1.5% (150 basis points). Mingla staff can set a different rate for a specific brand, up to a 30% cap. The service fee defaults to 3% of the order and covers card or Paystack processing; if actual processing costs less, Mingla keeps the difference, and if it costs more the host absorbs it. Unless a host changes the setting, the host covers both fees. Nigerian payouts also carry a bank transfer fee and stamp duty. Ads credit has its own separate fee.",
    "support_wording": "Mingla's fee is 1.5% of each sale, plus a service fee that covers payment processing. You can choose in Pricing defaults whether guests pay these on top of your price or you cover them, and guests always see one all-in price.",
    "who_can_use": [
      "Host",
      "Mingla staff"
    ],
    "surfaces": [
      "Host app (iOS, Android, web)",
      "Admin web"
    ]
  },
  {
    "capability_key": "money-provider-refunds",
    "title": "Refunds made directly in Stripe are picked up",
    "outcome_summary": "If a card refund is issued for a ticket order outside the Mingla app (in Stripe), Mingla records it on the order, voids the refunded tickets and tells the guest and the brand. Refunds for venue bookings, RSVP chip-ins and menu orders run through a staff refund operations queue. Search words: refund made in Stripe, dashboard refund, refund not showing, external refund, refund sync, refund operations.",
    "how_to": "No host action is needed. When a card refund on a ticket order is made in Stripe, the refund appears on the order and the guest gets a refund notification.\nMingla staff (Admin web): Refund operations shows refunds for venue reservations, RSVP chip-ins and menu orders that need review, with buyer, fee, financial and ops state, and recovery actions that require a reason.",
    "limitations": "Card (Stripe) refunds on ticket orders are matched automatically. Refunds made directly in the Paystack dashboard without Mingla's reference are not matched to an order, so Nigerian refunds should be made from Mingla. The automatic sending of venue, chip-in and menu-order refunds is controlled by a safety switch that is off unless operations turn it on, and this path has had very little real use. Admin refund screens require a reason for every action.",
    "support_wording": "If a card refund was made for your ticket order, it shows on your order and you'll get a refund notice. For naira payments, please ask the host or Mingla support to issue the refund from Mingla so it is tracked correctly.",
    "who_can_use": [
      "Mingla staff",
      "Host",
      "Buyer"
    ],
    "surfaces": [
      "Admin web",
      "Host app notifications",
      "Buyer notifications"
    ]
  },
  {
    "capability_key": "offerings-refund-policy",
    "title": "Set a refund policy and booking deadline",
    "outcome_summary": "Hosts set the refund terms guests see before they pay for an event, experience or trip: pick Flexible, Standard, Strict, No refunds (events and experiences) or build custom tiers like \"X days before, Y% back\". Trips can also have a booking deadline after which bookings close automatically. Guests see a Cancellation policy section on the page. Also called: cancellation policy, refund rules, no refunds, cutoff date, last day to book.",
    "how_to": "Events: in the event wizard open the \"Settings\" step (Refunds, visibility, approvals). The \"REFUND POLICY\" card is first: pick \"Flexible\", \"Standard\", \"Strict\" or \"No refunds\", or \"Build custom tiers\" (\"If they cancel:\" N \"days before\" to a percent), and \"Add another refund tier\" as needed. \"Clear policy (no refunds)\" removes it.\nExperiences: same card on the \"Pricing\" step of the experience wizard.\nTrips: the \"Cancellation & deadline\" step has the refund policy (\"Flexible\", \"Standard\", \"Strict\" or custom) and \"BOOKING DEADLINE\": tap \"Pick a deadline\", choose date and time in the brand's time zone, then \"Set deadline\".\nEditing after publishing: change it from the live edit screen; a live offering asks for a short reason. Once paid sales exist, terms can only be made more generous.\nGuests see the terms under \"Cancellation policy\" on the public page and in the Mingla Explorer app. Trip buyers can cancel from the \"Manage your booking\" link in their confirmation email and see the refund their tier gives.\nWorks on Host iOS, Android and web.",
    "limitations": "Booking deadlines exist for trips only; events and experiences have no booking deadline setting. RSVP events have no refund policy because they are free. For events and experiences the terms are shown to guests but Mingla does not refund automatically: the host issues refunds from Orders. For trips, buyer self-cancel through the email link calculates and issues the refund from the tiers. Trip bookings close on the hourly check after the deadline passes, so closing can lag by up to an hour. On free events or experiences guests do not see the policy. Once someone has paid, a host cannot make the terms worse. Editing needs event manager role or higher.",
    "support_wording": "Hosts choose the refund terms for paid events, experiences and trips, and guests see them before paying under Cancellation policy. For events and experiences the host handles refunds themselves from their orders; trip buyers can cancel from the Manage your booking link in their email. Only trips have a booking deadline.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Email"
    ]
  },
  {
    "capability_key": "payouts-balances-reports",
    "title": "See balances, payouts and finance reports",
    "outcome_summary": "Brand owners, admins and finance teammates see what the brand has earned, what is on its way and what has been paid to the bank, plus available and pending balances and the last payout. Search words: balance, payouts, earnings, how much have I made, when do I get paid, payout status, finance report, statement.",
    "how_to": "Host app (iOS, Android, web): Account → your brand → Payments & Bank. The Payments screen shows a status card (for example \"Selling, add a bank to get paid\", \"Payouts paused\" or \"You're all set\"), tiles for Earned (\"Total from sales\"), On its way (\"Held, then sent\") and Paid (\"Sent to your bank\"), and tiles for Available, Pending and Last payout. Tap How payouts work for what each deduction means. Export finance report opens the Finance reports screen.",
    "limitations": "Visible to the brand owner, brand admins and finance managers who have accepted their invite; other roles are refused. Live balances need a connected Stripe account, otherwise tiles show \"Balance unavailable\". The Finance reports screen is not yet backed by real payout data: its numbers come from cached event figures, its fee line uses a fixed placeholder rate, legacy figures may show in GBP, and its CSV exports (Payouts CSV, Tax-ready (UK VAT), All transactions) only show a notice that the export is not ready.",
    "support_wording": "Go to Account, open your brand and tap Payments & Bank to see what you've earned, what's on its way and what has been paid to your bank. Finance report exports are not available yet, so please use the Payments screen figures and contact support if you need a statement.",
    "who_can_use": [
      "Host (brand owner)",
      "Host (brand admin)",
      "Host (finance manager)"
    ],
    "surfaces": [
      "Host app (iOS)",
      "Host app (Android)",
      "Host web"
    ]
  },
  {
    "capability_key": "payouts-partner-program",
    "title": "Partner earnings and splits",
    "outcome_summary": "Mingla Partners earn 0.15% of every ticket sold on the brands they manage, paid as a split to their own payout account. Partners can see earnings by currency and the status of each split. Search words: partner, partner earnings, revenue share, referral earnings, partner brands, split payout.",
    "how_to": "Host app: once Mingla turns on Partner for your account, a Mingla Partner card appears on the Account tab with Partner earnings and Partner brands.\n1. Account → Partner earnings → Connect your payout account. Pick the country where you'll get paid (it is locked after setup), then Connect bank. Nigeria uses a Nigerian bank account; other countries use Stripe.\n2. Account → Partner brands to see the brands you are a partner on.\n3. Partner earnings shows Earnings by currency and each split's status (Pending, Transferred, Failed, Reversed, or Blocked with a reason).",
    "limitations": "Invite only: Mingla staff switch Partner on per account. The partner share is 0.15% of ticket sales, equal to 10% of Mingla's 1.5% fee. Partners can only earn from brands selling in the same currency as their payout account, and the payout country cannot be changed after setup. Stripe payout account pages open on the web. Splits can be reversed if the sale is refunded. This is separate from the planned Creators program.",
    "support_wording": "Mingla Partners earn 0.15% of ticket sales on the brands they manage, paid to their own payout account. Partner access is switched on by Mingla, and once it is on you'll find Partner earnings on your Account tab to connect your bank and track your splits.",
    "who_can_use": [
      "Partner (invited by Mingla)"
    ],
    "surfaces": [
      "Host app (iOS)",
      "Host app (Android)",
      "Host web"
    ]
  },
  {
    "capability_key": "payouts-paystack-nigeria",
    "title": "Get paid in Nigeria through Paystack",
    "outcome_summary": "Nigerian hosts add a Nigerian bank account and get paid in naira (NGN) through Paystack. Search words: Nigeria payout, naira payout, Paystack, Nigerian bank, NUBAN, get paid in Nigeria, connect bank Nigeria.",
    "how_to": "Host app (iOS, Android, web), brand owner only: Account → your brand → Payments & Bank (or Connect bank during brand setup) and choose Nigeria as the payout country (\"Continue with Nigeria\"). Accept Mingla's organiser terms when asked (\"A quick read before you connect your Nigerian bank\"). Under Get paid in Nigeria tap Choose your bank, search and select it, type the Bank account number and tap Verify account. Check the Account name shown, then tap Connect bank & get paid. To change it later use Change payout bank.",
    "limitations": "Nigeria and naira only; Ghana and other countries are not supported yet. Only the brand owner can connect or change the bank. Organiser terms must be accepted first. You can start selling before adding a bank, and the money waits until a bank is connected. Each payout has a Nigerian bank transfer fee and stamp duty deducted, and very small amounts below the minimum are carried to the next payout.",
    "support_wording": "Nigerian brands get paid in naira to a Nigerian bank account through Paystack. The brand owner adds it under Payments & Bank by choosing Nigeria, picking the bank, entering the account number and tapping Verify account, then Connect bank & get paid.",
    "who_can_use": [
      "Host (brand owner)"
    ],
    "surfaces": [
      "Host app (iOS)",
      "Host app (Android)",
      "Host web"
    ]
  },
  {
    "capability_key": "payouts-stripe",
    "title": "Get paid through Stripe in 34 countries",
    "outcome_summary": "Hosts in the US, UK, Canada, Switzerland and the EEA connect a bank through Stripe to get paid for card sales. Setup takes about 5 minutes and bank details go straight to Stripe. Search words: connect bank, Stripe, payouts, get paid, bank account, verification, KYC, add bank, payout country.",
    "how_to": "Host app (iOS, Android, web), brand owner only: Account → your brand → Payments & Bank → Connect bank (or Set up payouts during brand creation). Choose your payout country, accept Mingla's terms if asked, then tap Start bank setup. Stripe's secure form opens (on web inside Mingla's page; on iOS and Android in a browser window). Fill it in and finish. You see \"Submitted. Your details are being verified.\" and later \"You're all set\". If Stripe needs more, tap Continue verification. Use Manage payouts & tax to update details, Change bank account to switch accounts, or Disconnect bank in the danger zone.",
    "limitations": "34 countries: US, UK, Canada, Switzerland, Liechtenstein, Iceland, Norway and the EU/EEA. Nigeria is not on Stripe and uses Paystack. Only the brand owner can connect, change or disconnect the bank; admins and finance managers can view status. You can sell before connecting, but money waits until the bank is connected. Stripe may limit an account until identity checks are done, and Mingla sends a daily reminder email while they are stuck.",
    "support_wording": "Go to Account, open your brand, tap Payments & Bank and then Connect bank, and follow Stripe's secure form, which takes about 5 minutes. Only the brand owner can do this, and if Stripe asks for more details you'll see Continue verification on the same screen.",
    "who_can_use": [
      "Host (brand owner)"
    ],
    "surfaces": [
      "Host web",
      "Host app (iOS, opens a browser)",
      "Host app (Android, opens a browser)"
    ]
  },
  {
    "capability_key": "payouts-tax-registrations",
    "title": "Stripe tax registrations",
    "outcome_summary": "Brands paid through Stripe can add and manage their VAT or sales tax registrations and tax settings, so tax is calculated on their sales. Search words: VAT, tax registration, sales tax, Stripe Tax, VAT number, tax settings, merchant of record.",
    "how_to": "Host app, brand owner: Account → your brand → Payments & Bank. When the Stripe account is active, a Tax & registrations card appears. Tap Manage tax registrations. On web it opens Mingla's tax page inside the browser; on iOS and Android it opens in a browser window. Add or edit registrations and tax settings there.",
    "limitations": "Only for brands paid through Stripe with an active account; not available for Nigerian (Paystack) brands. Only the brand owner can open it. Automatic tax calculation adds about 0.5% on top of processing fees. The brand is the merchant of record and responsible for its own tax filings. Showing VAT on ticket prices needs a registration in place.",
    "support_wording": "Open Payments & Bank on your brand and tap Manage tax registrations to add your VAT or sales tax registrations. This is for brands paid through Stripe, and automatic tax calculation adds about 0.5% on top of processing fees.",
    "who_can_use": [
      "Host (brand owner)"
    ],
    "surfaces": [
      "Host web",
      "Host app (iOS, opens a browser)",
      "Host app (Android, opens a browser)"
    ]
  },
  {
    "capability_key": "payouts-timing",
    "title": "When payouts are released",
    "outcome_summary": "When does a host get paid? For ticket sales, a sale becomes due for payout about 3 days after its event or date ends; trip instalment payments are set to be due about a day after each payment. Payouts then take 1 to 2 business days to reach the bank. Search words: when do I get paid, payout date, payout delay, payout schedule, money not arrived, payout timing, how long for payout.",
    "how_to": "Host app (iOS, Android, web): Account → your brand → Payments & Bank. The status card shows the payout state (for example next payout, waiting for a bank, or paused) and the On its way tile shows money held before release. Tap How payouts work for the deductions (Mingla fee, payment processing, partner share, Nigerian transfer fee and stamp duty, held balance).\nMingla checks for payouts that are due every 30 minutes and sends each due amount to the brand's connected bank.",
    "limitations": "Release rule in the code: a ticket sale only enters a payout about 3 days after the event (or the chosen date) ends. Trip instalment payments are due about 24 hours after each payment, but only once operations turn that path on. Nothing is sent until the brand has a connected bank, payouts are not paused by Mingla staff, and the amount after refunds and disputes is above zero; Nigerian amounts below a small minimum roll into the next payout. Bank arrival then depends on the bank, usually 1 to 2 business days. The in-app How payouts work sheet currently says payouts are released about a day after payment, which does not match this rule.",
    "support_wording": "Payouts for ticket sales are released about 3 days after your event ends, then usually take 1 to 2 business days to reach your bank. You need a connected bank and your payouts must not be paused; you can check the status on your brand's Payments & Bank screen.",
    "who_can_use": [
      "Host (brand owner)",
      "Host (brand admin)",
      "Host (finance manager)"
    ],
    "surfaces": [
      "Host app (iOS)",
      "Host app (Android)",
      "Host web"
    ]
  },
  {
    "capability_key": "plans-host-paid",
    "title": "Paid Mingla Host plans",
    "outcome_summary": "Paid subscription plans for hosts (for example to raise messaging limits) are planned but not available yet. Hosts cannot buy a Mingla Host plan today. Search words: host subscription, paid plan, upgrade, pricing plan, host pro, messaging limits.",
    "how_to": "Not available yet. There is no screen to buy or manage a paid Host plan in the Host app or on the web. Hosts use Mingla without a subscription and pay only the per-sale Mingla fee.",
    "limitations": "Not built. No plan purchase, billing or plan limits exist in the Host app, Host web or Admin. Do not quote prices or plan features. Explorer users have a separate Mingla+ subscription in the consumer app, which is unrelated to Host plans.",
    "support_wording": "Paid Host plans aren't available yet, so there is nothing to buy or upgrade today. Hosts use Mingla without a subscription and only pay Mingla's fee on sales.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "plus-subscription",
    "title": "Mingla+ subscription and what it unlocks",
    "outcome_summary": "Mingla+ is the paid Explorer plan. It removes the free limits: unlimited pairings and group swiping sessions, saving curated plans, and setting your own starting point. Buy, restore or cancel through the App Store or Google Play. Search words: Mingla+, Mingla Plus, subscription, upgrade, premium, pro, paywall, cancel subscription, restore purchases, billing, refund.",
    "how_to": "1. Go to the Profile tab and tap Billing (Manage your plan and subscription) to see Your Plan. The upgrade screen also opens when you hit a free limit (not while the current free Mingla+ promotion is on).\n2. Compare the Free and Plus columns, pick a plan (for example Annual or Monthly, as offered), and tap the Start button to pay through the App Store on iPhone or Google Play on Android.\n3. If you already paid on this store account, tap Restore Purchases.\n4. To cancel or change, open Billing and tap Manage Subscription; it opens your App Store or Google Play subscription settings.",
    "limitations": "Free plan: unlimited swipes, 1 pairing, 1 active group session you created, curated plans can be viewed but not saved, and no custom starting point. Prices and plan lengths come from the store and vary by country. Payment, cancellation and refunds are handled by Apple or Google, not Mingla. A purchase can take a moment to unlock features. Mingla+ can also come from a referral bonus, an older trial, a staff-granted override, or a Mingla-wide promotion switch; new free trials are not given. Right now the Mingla-wide promotion is on, so every Explorer gets Mingla+ free and the free-plan limits only apply if that promotion ends.",
    "support_wording": "Mingla+ removes the free limits: unlimited pairings and group sessions, saving curated plans, and a custom starting point. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so nobody hits these limits unless that promotion ends. You can subscribe or restore from Profile, then Billing, and cancel or get refunds through your App Store or Google Play subscription settings.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "programs-app-giveaways",
    "title": "App-download giveaways",
    "outcome_summary": "Giveaways for people who download the Mingla app (for example free tickets or a free meal from a host) are planned but not available yet. There is no giveaway to enter in the app today. Search words: giveaway, free tickets, contest, win, download reward, promo.",
    "how_to": "Not available yet. There is no giveaway entry, reward or prize screen in the Explorer app, the Host app or on the web.",
    "limitations": "Not built. No giveaway entry, eligibility, winner selection or prize delivery exists in the product. Any giveaway a host runs on its own channels is not managed through Mingla.",
    "support_wording": "App-download giveaways aren't available in Mingla yet, so there's nothing to enter in the app right now. If a host is running their own giveaway, please follow that host's instructions.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "programs-creators",
    "title": "Creators program",
    "outcome_summary": "A Creators program for content creators to earn with Mingla is planned but not available yet. Creators cannot sign up for it in the app today. Search words: creator program, influencer, ambassador, UGC, creator earnings, affiliate.",
    "how_to": "Not available yet. There is no creator sign-up, dashboard or creator payout screen in the apps or on the web. The existing Mingla Partner program (Account → Partner earnings) is a separate, invite-only revenue share for people who manage brands.",
    "limitations": "Not built. No creator enrolment, tracking or creator payouts exist in the product. Do not promise rates or rewards. The Partner program is different and is switched on by Mingla staff for specific accounts.",
    "support_wording": "The Creators program isn't available yet, so there's no way to sign up in the app right now. You can let Mingla support know you're interested.",
    "who_can_use": [
      "Creators"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "rsvp-approvals",
    "title": "Approve, decline or remove RSVPs",
    "outcome_summary": "Hosts who turn on approvals review every RSVP before the guest is in. From the RSVP's Guests list they can approve or deny one person, approve everyone waiting at once, or remove a guest who was already confirmed. Approved guests get their RSVP pass (invite QR code); denied or removed guests are told by email or text. Also called: accept or reject RSVP, guest approval, manage guest list, kick a guest off the list.",
    "how_to": "1. Turn approvals on: in the RSVP wizard, go to the \"RSVP\" step (Capacity, plus-ones, approvals). Under \"Approvals\" pick \"Approve each RSVP\" instead of \"Auto-approve\". Guests then see \"Awaiting host approval\" until you act.\n2. After publishing, open the RSVP from Hub (Events) to reach its dashboard, then tap the \"Guests\" tile.\n3. The \"Pending\" section lists people waiting. Tap \"Approve\" or \"Deny\" on a row, or \"Approve all\" to approve everyone pending. If a guest limit is set, approving past it is refused, and \"Approve all\" skips people who no longer fit.\n4. To take a confirmed guest off the list, find them under \"Going\" and tap \"Remove\", then confirm \"Remove\". They are notified, and if you run a waitlist the next person is moved in automatically.\n5. Tap a guest's row to open their details (where they RSVP'd from, status, plus-ones, contact) with the same \"Approve\", \"Deny\" and \"Remove\" buttons.\nThe Guests screen works the same in the Mingla Host app on iOS and Android and on Mingla Host web. \"Maybe\" and \"Waitlist\" groups are shown for reference.",
    "limitations": "Only brand team members with the event manager role or higher (event manager, brand admin, brand owner) can see and act on the guest list; scanner, marketing and finance roles cannot. Approve and deny work on up to 100 selected guests at a time. Approvals apply to RSVP events only; ticketed events use their own order and guest tools. A denied or removed guest is notified, but their reason is not collected or sent. Hosts must publish the RSVP first.",
    "support_wording": "If approvals are turned on for an RSVP, the host approves or declines each guest from the RSVP's Guests list in the Mingla Host app or on the web. Until then the guest sees that their RSVP is awaiting host approval, and they are notified when the host decides. Only the host's team members with event manager access or above can do this.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Explorer",
      "Buyer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Email",
      "SMS"
    ]
  },
  {
    "capability_key": "rsvp-chip-in",
    "title": "Optional chip-in payments on RSVPs",
    "outcome_summary": "A host can let guests on a free RSVP event chip in a voluntary gift of money after they reply Going. The RSVP stays free; the gift is optional, can have a suggested amount and a minimum, and is paid by card (Stripe) or in naira (Paystack). Hosts can refund a gift from the guest list. Also called: contributions, donations, tips, pay what you want, gift the host.",
    "how_to": "Host setup:\n1. In the RSVP wizard, go to the \"RSVP\" step. Under \"Contributions\" switch on \"Let guests chip in\".\n2. Optionally set \"Suggested amount (optional)\" and \"Minimum contribution (optional)\". The minimum cannot be more than the suggested amount.\n3. If the brand has no payout bank, the step shows a \"Connect bank\" action. At publish without a bank, the \"Chip-ins need a bank\" dialog offers to connect a bank or \"Publish without chip-ins for now\".\n4. To change it after publishing, edit the live RSVP; turning chip-ins on still needs a connected bank.\nGuest side:\n5. After a guest replies Going, the \"Chip in for (host)\" panel appears with preset amounts, \"Other\" for a custom amount, and a \"Chip in\" button. On the web the guest is sent to the card or Paystack payment page and returns to the event page; in the Mingla Explorer app the card payment sheet opens in the app.\nRefunds:\n6. Host opens the RSVP, taps \"Guests\", taps the guest, and uses \"Refund contribution\".",
    "limitations": "Needs a connected payout bank on the brand before chip-ins can be published or collected. Turned on per RSVP; off by default. Card payments go through Stripe; naira payments go through Paystack (Nigeria brands, NGN only). Not available on Private RSVPs, only Public or Unlisted ones that are published. The guest pays exactly the amount they choose: no tax is added, the host absorbs processing, and Mingla still takes its fee from the gift. A host-initiated refund returns the gift minus Mingla's fee; only an event cancellation refunds the full amount. Seeing contribution totals needs the finance manager role or higher; refunding needs event manager or higher. A chip-in never changes the free RSVP itself.",
    "support_wording": "Chip-ins let guests send the host an optional gift after RSVPing; the RSVP itself stays free and no one has to pay. The host turns it on per RSVP and needs a connected payout bank first. If a guest wants a gift back, the host can refund it from their guest list.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "rsvp-create",
    "title": "Free RSVP events",
    "outcome_summary": "Hosts create a free RSVP event where guests reply Going, Maybe or Can't go instead of buying tickets. Hosts can set a guest limit, allow plus-ones, start a waitlist, require approval, keep the guest list private, and choose who can find it (Public, Unlisted link-only, or Private). Also called: free event, guest list, invite, RSVP page, free registration.",
    "how_to": "1. In Mingla Host, tap the \"+\" button on Home, Hub, Marketing or Account, choose \"Create event\", then \"RSVP event\". (The brand setup chooser also has an \"RSVP\" option.)\n2. Work through the steps: \"Basics\", \"When\", \"Where\", \"Cover\", \"RSVP\" and \"Preview\". The draft saves as you go.\n3. On the \"RSVP\" step set \"Limit the guest list\" and \"Max guests\", \"Allow guests to bring extras\", \"Start a waitlist when full\" (needs a guest limit), \"Approvals\" (\"Auto-approve\" or \"Approve each RSVP\"), \"Let guests chip in\", \"Keep the guest list private\", \"Hide the spots-left count\", and \"Who can find this\" (\"Public\", \"Unlisted\", \"Private\"). For Public you can also turn on \"Also show this on Mingla's discovery feed\".\n4. Tap \"Publish RSVP\" and confirm \"Publish\". If something is wrong the publish dialog stays open and shows the reason.\n5. After publishing, the RSVP dashboard has \"Guests\", \"Scan guests\", \"Scanners\", \"Edit\", \"Blasts\", \"Group chat\" and \"Public page\", plus \"Return RSVP to draft\" and \"Cancel RSVP\".\nGuests reply on the public page (web) or in the Mingla Explorer app. Works the same on Host iOS, Android and web.",
    "limitations": "Publishing needs the event manager role or higher on the brand. A Public RSVP shown on the discovery feed needs a future date. Unlisted RSVPs are link only; Private RSVPs stay off the brand page and discovery feed. Single date only. The \"Invite people\" step is not available yet, so it does not appear. An earlier publishing fault (#3047) is fixed in production. If publishing still fails, the publish dialog stays open and shows the reason. Chip-ins need a payout bank (see the chip-in entry).",
    "support_wording": "Hosts can create a free RSVP event from the + button in Mingla Host by choosing Create event, then RSVP event. Guests reply Going, Maybe or Can't go, and the host can limit numbers, allow plus-ones, run a waitlist or approve each guest. If the host sees an error when publishing, note the exact message and pass it to the engineering team.",
    "who_can_use": [
      "Host",
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "rsvp-passes",
    "title": "RSVP passes, pass recovery and door scanning",
    "outcome_summary": "Confirmed RSVP guests get an RSVP pass: a QR code invite sent by email (with a PDF attached) and by text, which they can reopen from a secure link without a Mingla account and download as a PDF. At the door, the host or their scanners check guests in by scanning the QR code with the Mingla Host app. Also called: RSVP ticket, QR invite, lost my invite, resend pass, check-in, door list.",
    "how_to": "Guest:\n1. When the RSVP is confirmed (or approved by the host, or moved in from the waitlist), the guest gets an email titled \"You're going to (event)\" with the pass PDF, and a text with a link to \"Open your secure invite\".\n2. The link opens the \"Your RSVP invite\" page showing the QR code and \"Show this QR code at the door.\" Tap \"Download RSVP invite PDF\" to save it. No sign-in is needed.\n3. Guests signed in to the Mingla Explorer app or the public page can tap \"View your pass\" on the event.\nHost at the door:\n4. Open the RSVP dashboard and tap \"Scan guests\". Allow camera access, then scan each QR code. Results include \"Already checked in\", \"RSVP not approved\", \"Doors aren't open yet\", \"Event has ended\" and \"RSVP invite not found\". Plus-ones are shown as \"Plus-one\".\n5. Add door staff from \"Scanners\" on the RSVP dashboard.\n6. The \"Guests\" screen has \"Not checked in\" and \"Checked in\" filters.\nScanning needs the phone app (iOS or Android); on Host web the scanner screen says to use the app.",
    "limitations": "Door scanning works only in the Mingla Host iOS and Android apps, not on the web. Scanning needs an internet connection. A pass scans from 2 hours before the start until 6 hours after the end. Only event managers and above, invited event scanners or the brand's scanner team can scan. Passes are only issued to guests who are going and approved; pending, denied or waitlisted guests have no valid pass. The recovery link is private: anyone with it can open the pass. No Apple or Google Wallet pass.",
    "support_wording": "Confirmed guests get their RSVP pass by email and text, and the link in those messages reopens the QR code and lets them download a PDF without an account. At the door the host scans the QR code with the Mingla Host phone app. If a guest's pass shows as not approved, the host still needs to approve them from the guest list.",
    "who_can_use": [
      "Buyer",
      "Explorer",
      "Host",
      "Event manager",
      "Scanner"
    ],
    "surfaces": [
      "Buyer web",
      "Email",
      "SMS",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Mingla Host iOS",
      "Mingla Host Android"
    ]
  },
  {
    "capability_key": "sites-brand-website",
    "title": "Mingla Sites: a brand website with Ari editing",
    "outcome_summary": "Mingla Sites gives a brand its own website (restaurant style pages with menu, ordering and booking links) hosted by Mingla, edited from the Website screen in Mingla Host or by asking Ari. It is not generally available: it runs as a private pilot with one brand on a sites.usemingla.com address, with no custom domains. Other hosts cannot get a website builder yet.",
    "how_to": "Not available to hosts outside the pilot. For the pilot brand only: in Mingla Host open the brand, then Website. The workspace shows the site, lets the team open the editor (Mingla Studio) to change pages, navigation and media, preview, publish, and go back to an earlier version, and offers Edit with Ari so Ari can draft content changes that the host confirms before publishing. For any other brand the Website screen does not appear or reports the website is not available.",
    "limitations": "Private pilot with one brand. The Host app website setting is off by default, the brand must also be enabled for the pilot on the server, and the person needs Marketing manager role or above. Sites live on a sites.usemingla.com subdomain only; custom domains are not supported. Only a restaurant template exists. Staff manage pilot health from Mingla Admin.",
    "support_wording": "Mingla Sites, a Mingla-hosted brand website, is not available yet. It is being tried privately with a single brand, and custom domains are not supported. Your brand page on Mingla stays your public page for now.",
    "who_can_use": [
      "Host"
    ],
    "surfaces": [
      "Not currently available"
    ]
  },
  {
    "capability_key": "social-chat",
    "title": "1:1 and group chat with reactions, photos and shared cards",
    "outcome_summary": "Message friends one to one or in a group: send text, photos, videos and files, reply to and react to messages, mention people, and share saved places and plans as cards. Search words: chat, message, DM, group chat, send photo, react, reply, typing, share card in chat.",
    "how_to": "1. Open the Friends tab to see your chats. Tap the compose button to start a one-to-one chat with a friend.\n2. To make a group chat, tap the + button, choose Create a group chat, name it, pick friends and tap Create.\n3. In a chat, type and send; use the attachment button for a Photo, Video or Document, or share one of your saved cards.\n4. Long-press a message to react (six emoji), Reply or Copy. Double-tap a message to heart it.\n5. In group chats, type @ to mention someone. You'll see typing indicators and online status.",
    "limitations": "You can only message friends. Messaging stops if either person blocks the other. Messages with text that breaks community guidelines are blocked before sending. Editing and deleting messages are not available in one-to-one chats. Each group chat also starts a group swiping session, so the free plan allows one group chat you created at a time; Mingla+ removes that limit. The New Message picker only starts one-to-one chats. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Chats live on the Friends tab: tap compose for a one-to-one chat or + then Create a group chat. Long-press a message to react, reply or copy it. On the free plan you can have one group chat you created at a time. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so this only applies if that promotion ends.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "social-collab-decide",
    "title": "Decide together: swipe a shared deck in a group chat",
    "outcome_summary": "Can't agree where to go? Start a group swiping session from a group chat: everyone swipes the same deck, and when two or more people like the same place it's a match and lands in the group's saved list. Search words: swipe together, group decision, collab, session, board, vote, match, decide with friends.",
    "how_to": "1. On the Friends tab, tap +, choose Create a group chat, name it, invite friends and tap Create.\n2. Invited friends see \"[name] invited you to swipe together\" and tap Accept.\n3. In the group chat, tap Start swiping together to open the shared deck.\n4. Tap the Preferences button in the deck to set the group's vibe.\n5. Everyone swipes. When two or more members swipe right on the same card you see \"It's a match!\" and it's saved for the group. Cards you liked alone show \"Liked, waiting for others\".\n6. To leave, open the session menu and tap Leave session; the chat stays.",
    "limitations": "On the free plan you can have one active session that you created; joining sessions other people created does not count toward that limit. Mingla+ allows unlimited sessions. There is no member limit. A match needs at least two members to like the same card. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Create a group chat from the + button on the Friends tab, then tap Start swiping together so everyone swipes the same deck. When two or more people like the same card it's a match. Free accounts can run one session they created at a time.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "social-follow-brands",
    "title": "Follow brands, including automatically after a purchase",
    "outcome_summary": "Follow the hosts and venues you like to hear about their new dates and offers first. Buying a ticket, RSVPing or booking while signed in follows that brand automatically, and you choose how each brand can reach you or mute them. Search words: follow, unfollow, following, brands, hosts, venues, mute brand, stop notifications from a brand.",
    "how_to": "1. On an event page or a brand's page, tap Follow next to the brand name.\n2. When you buy, RSVP or book while signed in, you follow that brand automatically.\n3. To manage, go to the Profile tab and open Brands you follow (See all for the full list).\n4. Tap a brand's menu to choose Notification channels, Mute for 1 week, 30 days or until you turn it back on, or Unfollow.\n5. You can also tap Following on an event page and choose Unfollow.",
    "limitations": "Automatic following only happens for signed-in buyers; guest checkouts don't follow anyone. Muting or turning off channels affects that brand only. On the web checkout page an Undo button appears right after an automatic follow; in the app, unfollow from Brands you follow or the event page.",
    "support_wording": "Tap Follow on a brand's event or page to hear about their new dates first. To mute or unfollow, go to Profile, open Brands you follow and use that brand's menu.",
    "who_can_use": [
      "Explorer",
      "Buyer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)",
      "Mingla web event and checkout pages"
    ]
  },
  {
    "capability_key": "social-friends",
    "title": "Add friends by phone number, or invite someone new",
    "outcome_summary": "Find friends on Mingla by their phone number and send a friend request, or invite someone who isn't on Mingla yet. Accept or decline requests and manage your friends list. Search words: add friend, friend request, find friends, invite, phone number, accept request, remove friend, friends list.",
    "how_to": "1. Open the Friends tab and tap the people icon at the top to open Friends (tabs: Friends, Sent, Requests, Blocked).\n2. On the Friends tab of that sheet, enter a phone number. If the person is on Mingla, tap Send request. If not, tap Invite to Mingla to share an invite message and save the invite.\n3. Check Sent to cancel requests or invites, and Requests to Accept or Decline incoming ones.\n4. From your friends list you can Mute, Remove Friend, Block User or Report User.\n5. The + button on the Friends tab also offers Add a friend, which opens Pair with someone.",
    "limitations": "Adding friends is by phone number; there is no username search in the app. You can't add yourself. If an invited person later signs up and verifies the same phone number, they get a friend request from you automatically. Blocking removes the person from your friends.",
    "support_wording": "Open the Friends tab, tap the people icon, and enter your friend's phone number to send a request, or tap Invite to Mingla if they aren't on the app. Incoming requests are under Requests.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "social-pairing",
    "title": "Pair with someone and get birthday and holiday ideas for them",
    "outcome_summary": "Pair with a partner or close friend to plan for each other. Their profile then shows their birthday, upcoming holidays with date ideas picked for them, special days you add, and the places they've saved and visited. Search words: pair, pairing, partner, couple, birthday ideas, gift, holiday ideas, anniversary, special days, unpair.",
    "how_to": "1. On the Friends tab, tap + and choose Add a friend to open Pair with someone.\n2. Tap Pair next to a friend, or use Pair by phone to send a pair request by number (this also sends a friend request if needed).\n3. The other person taps Accept on the pair request.\n4. Open their profile from your friends list or from Your Circle on the Profile tab. You'll see their birthday, Upcoming Holidays with picks for each, Your Special Days, and their saves and visits.\n5. Tap Mark a day that matters to add a custom date such as an anniversary. You can archive holidays you don't need.\n6. To unpair, use Unpair on their profile.",
    "limitations": "The free plan allows 1 pairing, counting pairings on either side; Mingla+ allows unlimited. Unpairing removes the custom days and saved cards for that person. The holiday list follows a fixed set of mostly US dates (for example Thanksgiving and Juneteenth), and some are shown based on the person's gender. Birthday shows only if they've added one. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so these limits only apply if that promotion ends.",
    "support_wording": "Tap + on the Friends tab, choose Add a friend, and tap Pair next to someone; once they accept, their profile shows birthday and holiday ideas for them. The free plan allows one pairing, and Mingla+ allows unlimited. Right now every Explorer gets Mingla+ free through a Mingla-wide promotion, so this only applies if that promotion ends.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "social-referrals",
    "title": "Invite friends and get credit",
    "outcome_summary": "A referral program where you invite friends and earn rewards. There is no referral screen, invite link or rewards page in the Explorer app. Search words: referral, refer a friend, invite reward, credit, free month, referral code.",
    "how_to": "There is no referral program screen in the app. To invite someone, use the Friends tab: tap the people icon, enter their phone number and tap Invite to Mingla.",
    "limitations": "No referral screen, invite button with rewards, or referral code in the app. Behind the scenes, when someone you invited by phone joins Mingla with that number and accepts the automatic friend request, the database adds 30 days of Mingla+ to your account and Billing shows a Referral Bonus badge. This is not explained anywhere in the app.",
    "support_wording": "Mingla doesn't have a referral program you can join in the app yet, so there's no referral code or rewards page. You can still invite friends from the Friends tab using their phone number.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "social-safety",
    "title": "Block, report and mute people",
    "outcome_summary": "Stay in control of who can reach you: mute a friend's notifications, block someone so they can't message or find you, or report someone to Mingla's moderation team. Search words: block, unblock, report user, mute, harassment, spam, abuse, safety, stop messages.",
    "how_to": "1. On the Friends tab, open the people icon and find the person in your friends list, or open your chat with them.\n2. Open their menu and choose Mute (stops notifications from them), Block User, or Report User.\n3. Block: pick an optional reason (Harassment, Spam, Inappropriate content or Other) and tap Block. They're removed from your friends, can't message you, and can't find you in search.\n4. Report: choose a reason, add optional details and tap Submit Report. Reporting also blocks the person.\n5. To unblock, open the Blocked tab in the Friends sheet and tap Unblock.",
    "limitations": "Blocking doesn't remove either of you from group swiping sessions you already share. Reports are reviewed by Mingla's moderation team; the app doesn't show the outcome. Muting only stops notifications; the person can still message you.",
    "support_wording": "Open the person's menu from your friends list or chat and choose Block User or Report User; reporting also blocks them. You can unblock someone later from the Blocked tab in your Friends list.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "social-share",
    "title": "Share places, plans and events by link or in chat",
    "outcome_summary": "Send a place, curated plan, event, trip, experience, venue or brand to friends: pick people or chats in Mingla with an optional note, or share a link to WhatsApp, Messages, Instagram and other apps. Search words: share, send to friend, share link, copy link, share to WhatsApp, send in chat.",
    "how_to": "1. Tap the share icon on a card, or Share on a details page.\n2. The share sheet shows a preview. Under Send in Mingla, search people and chats, tick one or more, add a note if you like (Add a note), and tap Send.\n3. Under Share elsewhere, tap Share to use your phone's share menu, or the copy button to copy the link.\n4. Friends who open the link go to the item in the Mingla app, or to a web page if they don't have the app.",
    "limitations": "Send in Mingla lists your chats and accepted friends only; pending requests appear after they're accepted. Sending in Mingla needs a connection. Notes are short (about 120 characters). Link creation can be switched off by a Mingla production setting, in which case an older share link is used instead.",
    "support_wording": "Tap the share icon on any card to send it to friends or chats in Mingla, or tap Share or copy the link to send it through another app. People without the app can open the link on the web.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)",
      "Mingla web share pages"
    ]
  },
  {
    "capability_key": "social-tag-along",
    "title": "Ask to tag along on someone's plan",
    "outcome_summary": "A feature to ask to join a friend's plan. It has been removed and there is no tag-along screen in the Explorer app. Search words: tag along, join plan, join my friend, request to join.",
    "how_to": "There is no tag-along option in the app, so there are no steps. To plan with friends, create a group chat and tap Start swiping together.",
    "limitations": "Removed from the app. Server functions for sending, accepting and declining tag-along requests still exist, but no app screen calls them.",
    "support_wording": "Tag-along requests have been removed from Mingla. To plan with friends, create a group chat from the Friends tab and swipe together.",
    "who_can_use": [
      "Explorer"
    ],
    "surfaces": [
      "Explorer app (iOS)",
      "Explorer app (Android)"
    ]
  },
  {
    "capability_key": "staff-ads",
    "title": "Ads console and campaigns",
    "outcome_summary": "Owners and admins run Mingla's paid ads from one place in Mingla Admin: connect ad accounts (Meta, TikTok, Snapchat, Google, Reddit), check channel readiness, build a campaign, launch or pause it, review Host ad plans, and watch spend and results. Search words: ads, ad campaign, campaign builder, Meta ads, TikTok ads, ad spend, launch campaign, pause ad.",
    "how_to": "1. In Mingla Admin, open Growth > Ads. The Ads page has four tabs: \"Overview\", \"Campaigns\", \"Creative Library\" and \"Connections\".\n2. Connections tab: connect, reconnect or verify each ad platform.\n3. Overview tab: press \"Run preflight\" under \"Channel preflight\" to check account, billing, identity, market, pixel and provider readiness.\n4. Press \"New campaign\" (top right) to open the Campaign Builder. Its steps are \"What are you promoting?\", \"Who should see it?\", \"Budget and dates\", \"Creative and copy\" and \"Review and create\". Creating needs the typed phrase CREATE PAUSED; the campaign is created paused and nothing spends yet.\n5. Campaigns tab: open the campaign and press Launch. Type LAUNCH and give a reason for the audit log. Use Pause to stop spending, or \"End plan\" to close it out. Host ad plans waiting for staff review can be approved or rejected here with a reason.\n6. Creative Library tab: reuse existing ad media in a new campaign.",
    "limitations": "Owner and Admin only. Campaign Builder and Campaigns are switched by the enable_ads_console setting; it counts as on when the setting is missing or cannot be read, and when it is off both pages show \"Ads console is off\". Parts of the builder are off on purpose: the frequency cap control is hidden because the server cannot take it yet; the budget split preview is a local estimate, not a server preview; real platform ad previews exist only for Meta and TikTok, while Snapchat and Google show a Mingla approximation and Reddit has none. App-download readiness on the Connections tab stays hidden until enable_app_download_readiness is on. The builder never launches; launch happens only on Campaigns. The server pauses delivery at 98% of the provider spend cap.",
    "support_wording": "Mingla's paid ads are run by our owners and admins from the internal Ads console, which covers ad accounts, campaign building, launch, pause and spend tracking. Some builder extras, such as a frequency cap and live previews for every platform, are not available yet.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-careers",
    "title": "Careers postings and applications",
    "outcome_summary": "Owners and admins manage Mingla's job openings and the applications that come in from the public careers site (career.usemingla.com): create and edit roles, open or close them, read applications, download CVs and move each applicant through New, Reviewing, Shortlisted, Rejected or Hired. Search words: careers, jobs, hiring, job posting, applicants, CV, resume.",
    "how_to": "1. In Mingla Admin, open Company > Careers.\n2. Applications tab: filter by status (\"All\", \"New\", \"Reviewing\", \"Shortlisted\", \"Rejected\", \"Hired\") or by role (\"All roles\"). Click an applicant to see their details, press \"Download CV\", and use \"Update status\" to move them on.\n3. Roles tab: press \"New role\" to create a posting (title, slug, department, location, employment type, status, salary, summary and a markdown body). Use \"Edit\" to change it, and \"Open\" or \"Close\" to publish or withdraw it. Only roles marked open show on the public careers site.",
    "limitations": "Owner and Admin only. Roles can be Draft, Open or Closed; there is no delete button. Applicant status changes are recorded in Mingla only; the page does not email the applicant. CVs open through a short-lived download link.",
    "support_wording": "Our job openings are listed on Mingla's careers site, and the team reviews every application in our internal tools. We can't share an application's status through Support.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "Mingla careers site (career.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-community-support",
    "title": "Community and Support console",
    "outcome_summary": "One staff workspace in Mingla Admin to talk to hosts and answer them: post announcements, run the public roadmap, triage host ideas, answer host questions, moderate posts, work support tickets, check the Feature Guide, send email and manage community roles. The Overview shows what needs attention first (reports due, first posts waiting, unanswered tickets and questions, ideas to triage, last announcement delivery).",
    "how_to": "1. In Mingla Admin click \"Community & Support\" in the sidebar.\n2. Top tabs: \"Overview\"; \"Community\" (sub-tabs \"Announcements\", \"Roadmap\", \"Ideas\", \"Questions\", \"Moderation\"); \"Support\" (\"Tickets\" plus the host groups tab); \"Product\" (\"Product Inbox\", \"Feature Guide\"); \"Email\"; \"Team\" (\"People and roles\"). On a phone, pick the section from the dropdown.\n3. Overview cards jump to the matching tab; \"Needs you\" lists the oldest and most urgent items.\n4. Use the \"Available for support\" switch in the header to show hosts that Support is online.\n5. Admins can click \"New announcement\" in the header to start a draft.\n6. Old #/support and #/email links open the matching tab here.",
    "limitations": "Owner and Admin see every tab. Every other active Mingla Admin teammate (Sales and marketing, Founding partner) can work Support: they see Tickets, the host groups tab and Feature Guide (read only). Teammates who also have a Community role (Moderator or Agent) additionally see Overview (a notice), Ideas, Questions and Moderation. Announcements, Roadmap, Product Inbox, Email and Team are Owner and Admin only. Someone with no team membership sees an \"Access needed\" message.",
    "support_wording": "Mingla staff handle host announcements, the roadmap, community posts and support chats from one place in Mingla Admin, under Community & Support. What each teammate can see depends on their role, and publishing announcements, roadmap changes and email is limited to admins.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing (Support tabs)",
      "Founding partner (Support tabs)",
      "Community staff (Moderator or Agent)"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-content-calendar",
    "title": "Content calendar",
    "outcome_summary": "The team plans, approves and schedules Mingla's social content on a shared content calendar: add a content idea, write the copy, attach design and live links, pick channels and a publish time, and move each card from Idea to Published. Calendar, Board and List views. Search words: content calendar, social posts, content plan, schedule post, editorial calendar.",
    "how_to": "1. In Mingla Admin, open Pipeline > Content calendar.\n2. Press \"Add content\", type a title and press \"Add content\" again. The card starts in Idea and is assigned to you; Mingla warns if a similar title already exists.\n3. Click a card to open it and fill in Title, Owners, Channels, Publish date and time, Copy, Notes, Drive link, Live link, Audience, City and Format. Changes can be commented on, and a card can be removed with \"Delete card\".\n4. Switch views with \"Calendar\", \"Board\" or \"List\". On the Board, move a card one stage at a time: Idea, Writing, Design, Review, Scheduled, Published. On the Calendar, drag a card to a new day to reschedule it.\n5. Moving to Scheduled needs a publish date and time and at least one channel. Moving to Published asks for the live link, or you can choose \"Publish without link\". Most changes offer Undo for a few seconds.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner (people who work the pipelines). Moving to Published only records the card as published; the calendar does not post to any social network. Assets are shared as a Drive link, not uploaded. Cards can move forward only one stage at a time. Editing needs a connection; offline you can only read.",
    "support_wording": "Mingla's team plans and schedules its social posts in an internal content calendar. Posts are published by the team on each channel; the calendar itself does not post anything.",
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
    "title": "Host and creator pipelines",
    "outcome_summary": "The team tracks outreach to hosts (venues, restaurants, event organisers) and creators (ambassadors, UGC) on two boards in Mingla Admin: add a record, set owner, region and ICP, log activity, and move it through the stages. Beta leads can be added to Hosts, and owners and admins get a Team dashboard. Search words: CRM, pipeline, hosts board, creators board, outreach, leads, prospects, do not contact.",
    "how_to": "1. In Mingla Admin, open Pipeline > Hosts or Pipeline > Creators.\n2. Use the toolbar to search, filter by ICP, Region and \"Whose records\" (\"Everyone\" or \"Mine\"), and switch the View between \"Board\", \"List\" and \"By region\".\n3. Press \"Add host\" or \"Add creator\" to create a record; Mingla warns about possible duplicates.\n4. Click a card to open it. Changes save as you make them: Stage, ICP, Region, Channel, Source, Next action, Due, plus Followers, Agreement and Rate for creators. Mark a record Warm intro only or Do not contact with a one-line reason.\n5. Host stages: Prospect, Contacted, Replied, Meeting, Onboarded, Live, Lost. Creator stages: Identified, Contacted, Replied, Negotiating, Booked, Posted, Passed. Lost and Passed need a reason. Moves offer Undo.\n6. Pipeline > Beta Leads: press \"Add to Hosts\" to turn a beta lead into a host record (once per lead).\n7. Owners and admins: Pipeline > Team dashboard shows hosts and creators by stage, everything due or overdue, and monthly host targets.",
    "limitations": "Hosts, Creators and Beta Leads open for Owner, Admin, Sales and marketing and Founding partner. Team dashboard and Tool Leads are Owner and Admin only. A host moves to Live by itself when its brand's first listing goes live and cannot be dragged there by hand. Nothing here sends messages; outreach is sent by the person outside Mingla and logged. Records marked Do not contact or Warm intro only cannot have outreach logged.",
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
    "capability_key": "staff-data-room",
    "title": "Investor data room",
    "outcome_summary": "Owners, admins and founding partners open Mingla's private company documents (investor data room) from Mingla Admin. Documents come from a private folder and every open of the room or a document is recorded. Search words: data room, investor documents, due diligence, company documents.",
    "how_to": "1. In Mingla Admin, open Company > Data room.\n2. The Documents list shows each file's name, size and last update.\n3. Press \"Open\" next to a document. PDFs open in a new tab; other files (spreadsheets, Word documents, CSV) download.\n4. If the room cannot load, press \"Try again\".",
    "limitations": "Owner, Admin and Founding partner only; Sales and marketing cannot open it. Read only: documents are added outside Mingla Admin, in the private folder the room reads from. Supported files are PDF, CSV, Excel and Word, up to 20 MB each. Every room open and document open is logged with the person's email and role. If the folder is not configured the page shows an error.",
    "support_wording": "The data room is a private area for Mingla's owners, admins and founding partners. Support cannot share its documents; investors get access through the founders.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Founding partner"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-drafts",
    "title": "Drafts to send",
    "outcome_summary": "Outreach messages your connected AI agent writes (follow-ups and replies to hosts and creators) land in your private Drafts to send queue. You review, edit, copy and send them yourself, then Mingla records the touch on the host or creator card. Search words: drafts, outreach drafts, agent drafts, follow-up, mark sent.",
    "how_to": "1. In Mingla Admin, open Pipeline > Drafts to send. The header shows how many are waiting.\n2. Switch between \"Waiting\", \"Sent\" and \"Discarded\".\n3. On a draft, press \"Edit\" to change it, or \"Open host\" / \"Open creator\" to see the record.\n4. Press \"Copy and mark sent\" to copy the text, then send it yourself by email, WhatsApp, DM or phone. Mingla logs it as sent.\n5. Press \"Discard\" to drop a draft. Both actions offer Undo for a short time; Undo changes Mingla only and does not recall a message you already sent.\n6. If nothing is waiting, press \"Open My agent\" to connect an agent that can write drafts.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. Each person sees only their own drafts. Mingla never sends a draft; the person sends it outside Mingla. Drafts are written by a connected agent (My agent), not created on this page. Saving, marking and discarding need a connection.",
    "support_wording": "Mingla's team uses an internal drafts queue so every outreach message is reviewed and sent by a real person. Mingla does not send these messages automatically.",
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
    "capability_key": "staff-email",
    "title": "Email campaigns to hosts",
    "outcome_summary": "Admins send email from Mingla Admin to hosts, explorer users, everyone, a filtered segment or one person. The composer has rich text, links, images, GIFs, dividers, a {first_name} merge field, saved templates, a live desktop and mobile preview, a recipient count that skips unsubscribed and invalid addresses, and send now or schedule. History and Unsubscribes tabs show past sends and opt-outs.",
    "how_to": "1. In Mingla Admin open \"Community & Support\", then \"Email\".\n2. Sub-tabs: \"History\", \"Send\", \"Templates\", \"Unsubscribes\".\n3. On \"Send\", choose the audience: \"Hosts\" (default), \"One person\", \"Segment\", \"Explorer users\" or \"Everyone\". Segment filters include User type, Country, Onboarding, Account status, Email status, Language, Beta tester and join dates. The count shows matched, will receive, unsubscribed, no valid email and duplicate.\n4. Write the Subject and body, optionally load a saved template, and check the \"Live preview\".\n5. Under \"Delivery\" pick \"Send now\" or \"Schedule\" with a date and time, then click \"Review send\" (or \"Review schedule\") and confirm.\n6. Use \"Templates\" to save, edit or delete templates.",
    "limitations": "Owner and Admin only: the Email tab is hidden from other roles and the server rejects non-admins. Sends from Mingla <hello@usemingla.com> with replies to noreply@usemingla.com, so hosts cannot reply to these emails. Unsubscribed addresses are skipped and each email carries an unsubscribe link and header. No file attachments; images and GIFs are embedded. Explorer sends need an explicit choice. If the email provider is not configured the page shows a setup notice instead of sending.",
    "support_wording": "Mingla's team can send email updates to hosts from our admin tools. If you no longer want these emails, use the unsubscribe link at the bottom of any of them. Replies to these emails are not monitored, so please contact us through Help & Support in the Mingla Host app.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-explorer-users",
    "title": "Manage Explorer users",
    "outcome_summary": "Owners and Admins can search and filter all Mingla app users, see stats (total, active, banned, onboarded, new this week), open a full user record (profile, preferences, saves, friends, messages, boards, calendar, reviews, reports, activity, sessions, location history), edit profile fields, ban or unban, toggle beta tester or Mingla partner, export to CSV, and permanently delete a user. Search words: find a user, ban user, delete account, beta tester, user profile, block report.",
    "how_to": "In the sidebar under \"Explorer app\", open \"Users\". Pick a segment (All, Explorer, Business, Admin), search by name, email, username or phone, and filter by onboarding, status (Active, Banned), country or a From/To join date. Toggle \"Beta\" in a row, select rows for \"Ban Selected\" or \"Export\", or use the page \"Export\" button. Row actions are \"View\", \"Ban\" or \"Unban\", and \"Delete\".\n\nOn a user's page, tabs include Profile, Preferences, Saves, Friends, Requests, Links, People, Blocked, Messages, Boards, Calendar, Reviews, Interactions, Reports, Activity, Sessions, Location and Pref History. Top buttons: \"Edit\" (then \"Save Changes\"), \"Toggle Mingla partner\" or \"Unmark Mingla partner\", \"Ban\" or \"Unban\", and \"Delete\". \"Delete User Permanently\" asks you to type the user's name or email, then \"Delete Permanently\". \"Preview Profile\" shows what the user has saved.",
    "limitations": "Owner and Admin only. Ban makes the user unable to use the app and can be undone with Unban. Delete is permanent and is blocked when the user has no username, display name or email to confirm against; it removes data across many records from the browser and may report partial errors. Marking someone a Mingla partner lets them connect partner Stripe to receive partner earnings. Host business accounts and brands are managed on the \"People\" and \"Brands\" pages instead.",
    "support_wording": "Our team can look up your Mingla account, correct profile details, and help with access issues. If you ask us to delete your account, we can remove it permanently.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-feature-guide",
    "title": "Feature Guide",
    "outcome_summary": "A searchable record of what Mingla can do, for Support staff and their AI agents. Each capability shows who can use it, where it works, how to use it, limitations, approved Support wording and current evidence. A capability counts as Live only when every required proof is current; otherwise it shows Needs review. Agents connected through My agent can search it with the find_capabilities tool.",
    "how_to": "1. In Mingla Admin open \"Community & Support\", then \"Product\", then \"Feature Guide\".\n2. Type in the search box and click \"Search\", or filter by area (\"All areas\") and status (\"Needs review\", \"Live\", \"Not available yet\", \"Removed\").\n3. Open a capability to read \"Who can use it\", \"Where it works\", \"How to use it\", \"Limitations\", \"Approved Support wording\" and \"Current evidence\".\n4. Admins can click \"New capability\", \"Edit\", \"Add evidence\" (\"Record current evidence\") or \"Apply evidence packet\".\n5. A teammate's own agent connected under My agent can call find_capabilities to search the same records.",
    "limitations": "Read access: Owner, Admin and anyone who can work Support (every active Mingla Admin teammate and the support staff list). Creating, editing and recording evidence is Owner and Admin only. A capability claimed Live still shows Needs review until all required evidence kinds are current. An empty search result means nothing matched, not that a feature does not exist. Agents only read; they cannot change entries.",
    "support_wording": "Mingla staff check the Feature Guide before answering what Mingla can do. If an item is marked Needs review, treat it as unconfirmed and check with the team before telling a customer it is available.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Support staff",
      "Sales and marketing (read)",
      "Founding partner (read)",
      "Teammate agents via My agent (read)"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)",
      "Team agents connected through My agent"
    ]
  },
  {
    "capability_key": "staff-health",
    "title": "API health and Stripe mode check",
    "outcome_summary": "Owners and admins check whether the outside services Mingla depends on are healthy (API health), whether Stripe is consistently in test or live mode across Mingla (Stripe mode), and how the waiting-room queue is behaving (Queue health). Search words: API health, service status, outage, Stripe mode, test mode, live mode, queue health, monitoring.",
    "how_to": "1. In Mingla Admin, open System > API health. Each service card shows a status dot, latency, credit balance where available, last check, 24-hour uptime and the last incident. A grey dot with \"No signal yet\" means no data, not healthy. Press \"Refresh\" to reload; the page also refreshes every 60 seconds and warns \"Probe may be stalled\" if checks stop.\n2. Open System > Stripe mode. The banner is green (\"All signals aligned\") when the backend resolves to one mode, or red (\"Backend mode unresolved\"). \"Signal sources\" lists the backend, the Host web app key and the Vercel settings. Press \"Refresh\" to re-check.\n3. Open System > Queue health for the waiting-room gauges: Verdict, Live queue, 72h rollup, Cross signals and Recent observe runs.",
    "limitations": "Owner and Admin only. All three pages are read only: they show status but cannot fix or switch anything. On Stripe mode, the Host web app key check is best effort and the Vercel settings cannot be read from the page, so they must be confirmed separately. The Stripe mode run-book link points to an archived document location.",
    "support_wording": "Mingla's team monitors the outside services we rely on, including payments, from internal health pages. If a service is having trouble, the team is already able to see it there.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-my-agent",
    "title": "My agent: connect your own Claude or Codex",
    "outcome_summary": "Team members connect their own Claude Code or Codex agent to Mingla. The agent works under the person's name and role: it can read and update their host and creator pipelines, log what happened, work the content calendar and write outreach drafts for review. It never sends messages. Search words: my agent, AI agent, Claude, Codex, connect agent, agent key, MCP.",
    "how_to": "1. In Mingla Admin, open System > My agent.\n2. Step 1, \"Copy your setup message\": choose your computer (\"macOS or Linux\" or \"Windows\") and copy the setup message for Claude or Codex. It works once, for 10 minutes.\n3. Step 2, \"Paste it into your agent\": paste it into Claude Code or Codex on your own computer and let it run the one command it contains.\n4. Step 3, \"Restart your agent, then just ask\": reopen the agent and ask \"What is on my plate in Mingla?\". If it fails, open \"Not working?\".\n5. Advanced lets you create a key by hand; it is shown once and hidden after 10 minutes.\n6. The page also lists \"What it can do now\", \"Not yet\", \"Guardrails\", suggested routines and \"What my agent did\". Use Disconnect to turn an agent off. Owners also see \"Agents on the team\" and can disconnect anyone's agent.",
    "limitations": "Open to Owner, Admin, Sales and marketing and Founding partner. One active key per person for each agent (one for Claude, one for Codex). The agent sees only what the person's role sees, cannot delete, manage keys or manage the team, never sends an email, DM or WhatsApp, may log only a cold first message, and cannot contact or unmark records set to Do not contact or Warm intro only. Undoing a move, adding beta leads to Hosts and setting targets are not available to the agent yet. Claude in the browser or on a phone is not supported yet. A key unused for a set number of days (90 by default) is turned off. Windows setup is untested.",
    "support_wording": "Mingla team members can connect their own Claude Code or Codex agent to help with pipeline work. The agent acts under their own name and permissions, and it never sends messages for them.",
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
    "capability_key": "staff-offerings",
    "title": "Manage live offerings",
    "outcome_summary": "Owners and Admins can find any event, RSVP, trip or experience across all brands, including drafts, private and deleted ones, and open a type-aware record with tiers, orders, guest list, itinerary or stops. They can take audited fixes: change visibility (unpublish), cancel an offering, release held cancel refunds, close or reopen bookings, soft-delete or restore, fix a ticket price, edit trip days or experience stops, manage RSVP guests and adjust RSVP capacity. Search words: unpublish event, cancel event, close sales, wrong ticket price, RSVP list.",
    "how_to": "In the sidebar under \"Business\", open \"Offerings\". Search \"All offerings\" by title, brand, city or slug, and filter by Type, Status, Visibility, Lifecycle, Brand or \"Include deleted\". Click an offering to open it.\n\nOn the detail, use \"Change visibility\" to unpublish (hidden) or republish. Footer actions include \"Cancel offering\" (type CANCEL), \"Release held refunds\" (type RELEASE) when a cancellation is holding refunds, \"Close bookings\" or \"Reopen bookings\", and \"Soft-delete offering\" or \"Restore offering\". Per-row actions include \"Fix ticket price\" (new price in cents), editing or reordering trip days, editing, removing or reordering experience stops, approving, denying or removing RSVP guests, and \"Adjust RSVP capacity\".",
    "limitations": "Owner and Admin only. Every change asks for a reason (reorders are optional) and is written to the audit log. Cancelling an offering does not refund buyers by itself: paid refunds are held for review until staff click \"Release held refunds\". A price fix changes the amount only, not the currency. Raising RSVP capacity may promote waitlisted guests automatically. Soft-deleted offerings disappear for hosts and buyers but stay visible to staff. Experience feedback is not shown yet.",
    "support_wording": "Our team can look up any event, trip or experience and help with fixes such as unpublishing it, closing bookings, correcting a ticket price or cancelling it. If an offering is cancelled, refunds are reviewed by our team before they are released to buyers.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-orders-money",
    "title": "Orders, refunds and the money ledger",
    "outcome_summary": "Owners and Admins can look up any order across all brands, see its full money record (line items, fees, tax, installments, partner split, refunds), issue a full or partial refund, and track refunds, Stripe and Paystack disputes, payouts, organiser debts and platform fee revenue in one money ledger. A separate refund operations queue handles stuck or failed refunds. Search words: order lookup, refund a ticket, chargeback, dispute, payout status, money ledger.",
    "how_to": "Order lookup and refunds: in the sidebar under \"Money\", open \"Orders\". Search the \"All orders\" list by buyer email, phone, name, payment id or order id, or filter by \"Payment status\" (Paid, Pending, Failed, Refunded, Partially refunded, Disputed, Cancelled). Click a row to open the order. Use \"Show breakdown\" for pricing and tax detail and \"View subscriber\" to see the buyer. For a paid or partially refunded order, click \"Issue refund\", set a quantity per item or click \"Full refund\", type the exact refund total to confirm, give a reason (10 to 200 characters) and click \"Refund\".\n\nMoney ledger: open \"Money ledger\" and pick a tab: \"Refunds\", \"Disputes\", \"Paystack disputes\", \"Payouts\", \"Organiser debts\", \"Platform revenue\" or \"Stay reconciliation\". On \"Refunds\", a \"Reconcile\" button appears when the Mingla fee refund is still pending. Open a Stripe dispute to see the linked order and use \"Add internal note / Mark reviewed\". Open a Paystack dispute to see the evidence dossier, then \"Review & approve dossier\", \"Export dossier JSON\" and \"Submit to Paystack (stub)\".\n\nRefund operations: open \"Refund operations\" for the queue of refunds that need review. Click a row to see \"Live details\", then use \"Reconcile provider\", \"Escalate\" or \"Resolve Ops\". When the buyer needs attention, \"Attention recovery\" lets you correct the guest contact, reclaim a delivery confirmed as unsent, or invalidate and resend the attention link, each with an approved reason, then \"Apply recovery\".\n\nPayout readiness per brand lives on the \"Payments\" page (see the Stripe Connect entry).",
    "limitations": "Owner and Admin only (these pages need the admin console area). The order refund moves real money through Stripe and only works for orders paid by Stripe with a connected account and a charge on file; it refuses amounts above what is left to refund. The Orders page header still says \"Read-only\" even though \"Issue refund\" is live. Stripe dispute annotation is an internal note only and never changes the dispute at Stripe. The Paystack \"Submit to Paystack (stub)\" button only records the submission in Mingla: nothing is sent to Paystack, so staff must upload the exported JSON in the Paystack dashboard before Paystack's deadline. The money ledger otherwise shows records only; there is no resolve dispute action. Refund operations recovery choices only appear when the matching delivery state exists.",
    "support_wording": "Our team can look up your order, see exactly what was paid and refunded, and issue a full or partial refund where the order allows it. If a payment is under dispute, our team reviews it and responds through the payment provider.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-people-brands",
    "title": "Manage people and brands, including pausing payouts",
    "outcome_summary": "Owners and Admins can search every host business account and every brand, open a full record (profile, claim state, money, owner, team, invites, support tickets), and take audited support actions: edit details, reassign a brand owner, change or remove team members, revoke invites, suspend or soft-delete a brand, disable a user, and pause or resume a brand's payouts. Search words: host account, brand owner, team member, suspend brand, hold payouts, pause payouts.",
    "how_to": "People: in the sidebar under \"Business\", open \"People\". Search \"Business accounts\" by business, name, email or phone, and filter by \"Partner\" or \"Status\". Open a person to see the consumer profile, business account, brands, subscription and support tickets. Use \"Edit account\", \"Enable beta\" or \"Disable beta\", and the footer actions \"Disable user\" or \"Enable user\" and \"Soft-delete account\" or \"Restore account\".\n\nBrands: open \"Brands\" under \"Business\". Search \"All brands\" by name, slug or city, and filter by \"Claim status\", \"Status\" or \"Provider\". Open a brand to see its profile, claim and verification, money, owner, team, invites and the \"Payouts (admin)\" section (pause state, next payout, balances, outstanding debt, recent payouts). Use \"Edit profile\" or \"Reassign owner\", change a team member's role, remove a member or revoke an invite.\n\nTo pause payouts, open the brand and click \"Pause payouts\" in the footer, type a reason and the brand's slug to confirm, then confirm. To undo, click \"Resume payouts\" with a reason. Other footer actions are \"Suspend brand\" or \"Unsuspend brand\" and \"Soft-delete brand\" or \"Restore brand\".",
    "limitations": "Owner and Admin only. Every action asks for a reason and is written to the audit log; risky ones also ask you to type the brand slug. Pausing payouts stops new payouts while money keeps building up, but a payout already in flight still completes and nothing is clawed back; charging and publishing are not affected. The pause and resume buttons only appear once the brand's payout status has loaded. Suspending a brand stops its public pages and selling. Soft-delete is reversible. The People list shows business accounts; consumer-only users are reached through a direct link or from the Explorer Users page.",
    "support_wording": "Our team can review your account and brand, fix profile details, and update who owns or helps run a brand. In some cases we may pause a brand's payouts while we look into something; money keeps building up during the pause and is released when it is lifted.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-places-cities",
    "title": "Place pool, launch cities and signals",
    "outcome_summary": "Owners and admins manage the places the Explorer app recommends: add and seed cities with places (with a cost preview), download photos and thumbnails, edit, suspend or restore a place, review places the quality filter excluded, choose which cities are live for Explorer onboarding, and run place quality and signal scoring per city. Search words: place pool, seeding, launch city, city live, places, photos, bouncer, signals, scoring.",
    "how_to": "1. In Mingla Admin, open Explorer app > Place Pool. Pick a city with the city picker, or press \"Add City\". Tabs: \"Overview\", \"Browse Pool\", \"Map View\", \"Seeding\", \"Refresh\", \"Photos\", \"Thumbnails\" and \"Bouncer-Excluded\".\n2. Seeding: choose categories, check the cost preview, then start the run. Past runs show their API calls, places found and cost.\n3. Browse Pool: open a place to edit it, \"Suspend…\" it (\"Suspend & notify owner\") or \"Restore listing\". \"Update Bbox\" changes a registered city's area.\n4. Explorer app > Launch Cities: turn the \"Live\" switch on a city to let people there start onboarding, and set or refresh its boundary.\n5. Explorer app > Signal Library: pick a city, run the Bouncer steps in order, then run the scorer for every signal, and preview the top places with their score breakdown.",
    "limitations": "Owner and Admin only. The Refresh tab shows \"Refresh tab, coming soon\" until enable_refresh_tab is turned on. Seeding uses paid Google calls; the page tracks spend against a $500 cap. Suspending a place removes it from the pool and revokes any venue claim (reversible with Restore). Signal weights cannot be edited on the Signal Library page. A city with no servable places can still be switched live, so check its count first.",
    "support_wording": "Mingla's team chooses which cities are live and which places the Explorer app shows. If your city is not live yet, Mingla is not available there yet.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-sites-ops",
    "title": "Brand Sites operations",
    "outcome_summary": "Owners and Admins can see the health of each brand's Mingla-hosted website (Brand Sites pilot): publication state, permanent address, editor and public health, media backlog, publication history, operation receipts and audit history. Safe recovery controls let staff reconcile a stuck operation, suspend or resume public access, and revoke editing sessions. Search words: brand website, site down, suspend site, publish failed, site editor.",
    "how_to": "In the sidebar under \"Business\", open \"Brand Sites\". The \"Sites\" list shows Brand, State (with a Pilot badge), Permanent address, Publication, Editor, Public and Media. Search by brand name or exact ID and click \"Search\", or \"Refresh\". Click a site to open it.\n\nThe detail shows \"Safe operations\", \"Identity and health\", \"Permanent addresses\", \"Publication history\", \"Operation receipts\" and \"Audit history\". Under \"Safe operations\": \"Reconcile\" (only when an operation is ambiguous, type RECONCILE), \"Suspend\" (type SUSPEND) or \"Resume\" (type RESUME), and \"Revoke editing sessions\" (type REVOKE). Each needs a reason. Use \"Back to all sites\" to return.",
    "limitations": "Pilot only: Brand Sites is limited to pilot brands. Owner and Admin only. Every action needs a reason and a typed phrase and is audited. No control here can edit site content, force a publication, or delete a site. Suspending keeps the last good publication and all drafts; resuming restores that publication and publishes nothing new. The page shows no credentials or draft content.",
    "support_wording": "Brand websites are in a limited pilot. For pilot brands, our team can check the site's health, pause or restore public access, and end open editing sessions, without changing the site's content.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-stripe-tools",
    "title": "Stripe Connect status and onboarding links",
    "outcome_summary": "Owners and Admins can see every brand's payout readiness (Stripe Connect or Paystack), whether charges and payouts are enabled, what is blocking verification, and bank accounts on file. From a brand they can refresh its status from Stripe or generate a fresh Stripe onboarding link to send to the host. Search words: Stripe onboarding link, KYC, payouts disabled, connect account status, bank account, verification requirements.",
    "how_to": "In the sidebar under \"Money\", open \"Payments\". The \"Payment providers\" list shows each brand with Provider, Status, Charges, Payouts, Country, Currency and \"Blocked by\". Search by brand, slug or account id, or filter by \"Status\" (Active, Onboarding, Restricted, Not connected) or \"Provider\" (Stripe, Paystack, None). Click a brand to see its status, \"Requirements / next steps\" (Past due, Currently due, Pending verification, Eventually due) and Paystack details.\n\nTo update from Stripe, click \"Refresh from Stripe\", give a reason and click \"Refresh\". To get a new onboarding link, click \"Generate onboarding link\", give a reason and click \"Generate link\"; the link appears under \"Onboarding link (send to the brand out-of-band)\" with a \"Copy\" button. Send it to the host yourself. The \"Stripe mode\" page under \"System\" is separate and shows the platform's Stripe mode.",
    "limitations": "Owner and Admin only. Both actions need a reason and move no money. An onboarding link can only be generated for a brand that already has a Stripe account; otherwise the host must start onboarding first. The link is not sent automatically. The list view shows synced data, so use \"Refresh from Stripe\" for the latest status. Paystack brands show their Paystack details but have no refresh or link actions here.",
    "support_wording": "Our team can check whether your payouts are set up and what Stripe still needs from you. If your setup link has expired, we can create a new one and send it to you.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-subscriptions",
    "title": "Subscription overrides",
    "outcome_summary": "Owners and Admins can see every Explorer user's Mingla+ subscription tier, grant or revoke a time-limited tier override (for example a free Mingla+ upgrade for a beta tester or partner), view override history, export the list, and switch on Global Plus Access to give every user Mingla+. Search words: Mingla+, free upgrade, comp subscription, premium access, override tier, trial.",
    "how_to": "In the sidebar under \"Money\", open \"Subscriptions\". Stat cards show Total Users, Free, Mingla+ and Admin Overrides. Search by name or phone and filter by tier (All, Free, Mingla+). In a user's row, click the gift icon to open \"Grant Tier Override\": pick the tier, set \"Duration (days)\" (1 to 365, default 30), enter \"Reason (required)\" and confirm. If the user has an override, the ban icon opens \"Revoke Override\". The history icon shows past overrides marked Active, Revoked or Expired. Use \"Export\" for a CSV.\n\nThe \"Global Plus Access\" switch at the top gives every user Mingla+ regardless of subscription when on; when off, users see their real tier.",
    "limitations": "Owner and Admin only. Overrides apply to Explorer app (Mingla+) tiers only, not host plans. A reason is required for each grant. Global Plus Access affects every user at once and takes effect as soon as it is switched. If the subscription database setup is missing, the page shows \"Setup Required\" instead of the list. Paid subscriptions themselves are not changed or refunded here.",
    "support_wording": "Our team can give you Mingla+ access for a set period, for example as a thank you for beta testing, and can remove it again. This does not change or refund a paid subscription.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-support-desk",
    "title": "Support desk with staff-created tickets and next-update promises",
    "outcome_summary": "Staff answer host support chats from a ticket queue in Mingla Admin. Each ticket can be claimed, given a status and priority, and must carry a next-update promise (a date and what Support will do before then) before a staff reply can be sent. Staff can also add internal staff-created tickets that never message the customer, and send a private signal to Product.",
    "how_to": "1. In Mingla Admin open \"Community & Support\", then \"Support\", then \"Tickets\".\n2. Filter with the status control (\"All\", \"New\", \"Open\", \"Pending\", \"Resolved\", \"Closed\") and the unassigned-only checkbox. Rows show \"Promise needed\" when no next update is set.\n3. Open a ticket. Click \"Claim ticket\" to assign it to yourself, and set Status and Priority (low, normal, high, urgent).\n4. Under \"Next update\" click \"Set now\" or \"Change\" to open \"Set the next customer update\": pick \"Next update by\" (at least about 15 minutes ahead) and fill \"What will Support do before then?\", then \"Save next update\". On a live chat this posts a visible system message to the host.\n5. Type in \"Reply to the business…\" and click \"Send\". Replies go out under your real staff name with Mingla Support.\n6. Click \"Add ticket\" to open \"Add a staff-created ticket\" for internal work: subject, details, optional customer email and brand, priority and next update. It does not message the customer.\n7. Under \"Product signal\" click \"Create signal\" to send a private report to Product; \"Product inbox\" lists them.\n8. Admins can click \"Agents\" to grant or revoke support access by email.",
    "limitations": "There is no private internal-note field on a live customer chat: everything typed in the reply box is visible to the host. Internal-only work goes in staff-created tickets (marked \"Internal only, no customer message was sent\") and Product signals. A staff reply is blocked until a future next-update promise is set. The \"Agents\" button is Owner and Admin only. Open to every active Mingla Admin teammate plus the support staff list.",
    "support_wording": "Our support team works every host chat from a shared queue, and before replying they set when you will next hear from us and what they will do in the meantime. That promise is about when we will update you, not a date the problem will be fixed.",
    "who_can_use": [
      "Owner",
      "Admin",
      "Sales and marketing",
      "Founding partner",
      "Support staff"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-take-rate",
    "title": "Mingla fee settings",
    "outcome_summary": "Owners and Admins set Mingla's platform take-rate, the percentage Mingla earns on every sale across all brands, and can put individual brands on a custom rate. Changes apply to future sales only. Search words: Mingla fee, commission, take rate, platform fee, custom rate for a brand, pricing.",
    "how_to": "In the sidebar under \"Money\", open \"Pricing\". In the \"Mingla platform take-rate\" card, type the new percentage and click \"Save default\", then confirm in \"Change Mingla's default take-rate?\". To give one brand a different rate, click \"Add override\" in \"Brand overrides\", search for the brand, enter \"This brand's take-rate\", click \"Continue\" and confirm. In the overrides table, use \"Edit rate\" or \"Remove override\" on a row. Each change shows a before and after confirmation.",
    "limitations": "Owner and Admin only (the server also checks admin rights). Rates must be between 0% and 30% with at most two decimals. Changes apply to future sales only; orders already placed keep the rate they were sold at. This is Mingla's own cut, separate from any service fee a brand adds to cover card processing. Every change is written to the audit log.",
    "support_wording": "Mingla's fee is a set percentage of each sale. Our team can review the rate on your brand, and any change only applies to future sales, never to orders already placed.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-team-roles",
    "title": "Invite teammates and set roles",
    "outcome_summary": "The owner invites people into Mingla Admin and sets their role: Admin, Sales and marketing, or Founding partner. Invitees get an email with a one-time link that expires in 7 days. Separately, admins give existing teammates a Community role (Moderator or Agent) under Community & Support, Team, People and roles, and grant support access from the Support desk.",
    "how_to": "Company access (owner): 1. In Mingla Admin open \"Team and roles\" under Company. 2. In \"Invite someone\", enter the \"Email address\", choose a role and send. 3. In \"People\", change a role from the row dropdown, \"Resend invite\", \"Invite again\" with a chosen role, or remove access (confirm \"Remove\"). Changes can be undone from the notice.\n\nCommunity roles (Owner or Admin): 1. Open \"Community & Support\", then \"Team\", then \"People and roles\". 2. Click \"Invite teammate\", enter their Email and Display name, pick \"Moderator\" or \"Agent\" and \"Save\". 3. Use \"Manage\" on a row to change or \"Remove role\". The table shows each person's Community role, Support, Available now and Last active.",
    "limitations": "Team and roles is Owner only; nobody can change the owner's access. Invite links last 7 days, and changing a role or resending makes the old link stop working. An address that already has a Mingla account signing in another way (phone, Google or Apple) cannot be invited. In People and roles, \"Invite teammate\" does not send an invite: it assigns a role to someone who already has a Mingla profile with that email, and active Admins cannot be given a Community role. A Community role only opens the Community tabs for someone who is also an active Mingla Admin teammate. Removing access also turns off that person's agent keys.",
    "support_wording": "Only the account owner can invite people to Mingla Admin and set their role. Community and Support roles are given by an admin to people who are already on the team.",
    "who_can_use": [
      "Owner",
      "Admin (Community roles only)"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "staff-venue-claims",
    "title": "Review venue claims and changes",
    "outcome_summary": "Owners and Admins review venues that hosts have claimed: check the details, photos, phone and quality signals against the Google place, call the venue, tweak fields, send feedback, and approve, reject or ask for more information. They also approve or reject requests from live venues to change their name, category or address. Search words: claim my venue, venue verification, approve claim, claim rejected, change venue name, change address.",
    "how_to": "In the sidebar under \"Business\", open \"Venue claims\". Pick a tab: \"Pending review\", \"Verified\", \"Rejected\" or \"Detail changes\". Click \"Refresh\" to reload. Open a claim to see slug, category, Google place, address, \"Phone to dial\", contact email, description, photos, quality signals and hours, with \"Open in Google Maps\". Under \"Admin adjustments\" use \"Tweak fields\" (address, category, price level) and \"Save field tweaks\". Under \"Feedback to business\" add items, an optional overall message and click \"Send feedback\". A pending claim can also be corrected with \"Correct venue identity\". In the footer, use \"Mark as called\", \"Need more info\", \"Reject\" (enter why, which is emailed to the operator, then \"Confirm reject\") or \"Approve\".\n\nOn \"Detail changes\", each live venue request shows \"Now (what guests see)\" next to \"Requested\". Click \"Approve change\" or \"Reject\" and give a reason, then \"Reject change\".\n\nTo browse all venues and edit reservation settings, use \"Venues\" under \"Business\" instead.",
    "limitations": "Owner and Admin only. Approve is blocked when the claim duplicates an already approved claim for the same Google place. A rejected operator is emailed the reason and can submit again. Guests keep seeing the current venue details until a detail change is approved. The separate \"Venues\" page lets staff edit reservation settings, capacity rules and reservation status, but not the venue's name, address, hours, category or contact.",
    "support_wording": "Our team reviews every venue claim, sometimes with a quick call, and will either approve it, ask for more information, or explain what needs fixing so you can submit again. Changes to a live venue's name, category or address are checked by our team before guests see them.",
    "who_can_use": [
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla Admin (admin.usemingla.com)"
    ]
  },
  {
    "capability_key": "stays-hosting",
    "title": "Host stays: rooms, bookings and payments",
    "outcome_summary": "Hotels, resorts, guest houses, lodges and short-stay or serviced apartments can list rooms and other bookable places, open dates and set nightly prices, publish the property, and take guest reservations with payment (hotel booking, rooms, stays, accommodation, lodging, check-in, check-out). Guests find the property on its public page or under Discover, Stays in the Mingla Explorer app, pick dates and rooms, and book instantly or send a request the property approves. The host team reviews, approves, declines or cancels bookings with refunds.",
    "how_to": "Host side (Mingla Host iOS, Android or web):\n1) Create the venue from Hub, then Venues (or claim an existing listing) and pick the \"Stay\" category (\"Hotels, resorts & short stays\"). Mingla reviews the venue before it can take bookings.\n2) Open the venue card. The Stay workspace has Overview, \"Rooms & Places\", \"Availability & pricing\", Reservations, Menus and Settings. On wide web screens these sit in a side rail.\n3) In Settings (\"Stay settings\") choose the \"Property type (optional)\", write the \"Stay summary\" (at least 20 characters), set \"Local time zone\", \"Check-in\" and \"Check-out\" times, \"Default confirmation\" (\"Instant confirmation\" or \"Request confirmation\"), \"Property amenities\", \"Accessibility\" and \"Arrival instructions\".\n4) In \"Rooms & Places\" tap \"Add Room or Place\". Choose \"Room\" (a space with a bed, booked by the night) or \"Place\" (any other reservable space), and \"Add one\" or \"Add several\". Set the name, description, \"What's included\", how many you have, \"Guests per booking\", \"Price per night\", any extra charge, the \"Cancellation policy\" and the no-show refund, whether it is \"Confirmed instantly\" or \"You approve first\", and who can book (\"Anyone can book\" or \"Only guests staying here\"). Tap \"Add photos\".\n5) In \"Availability & pricing\" open nights for Rooms (\"Rooms open that night\", \"Price for these nights\", \"Open for booking\" or \"Closed\") and time windows for Places (\"Fixed\", \"Repeating\" or \"Full day\").\n6) On Overview, work through the checklist (Stay basics, Amenities & accessibility, Rooms & Places, Availability & pricing, Bank & currency, Venue review) and tap \"Publish Stay\". In Rooms & Places use \"Make live\" or \"Pause\" on each offering.\n7) In Reservations (\"Stay reservations\") open a booking to see its rooms, fees and timeline. For request bookings use \"Approve all\" or \"Decline all\". To cancel, choose lines under \"Cancel selected lines\", review the refund in \"Review cancellation\" and tap \"Confirm cancellation\".\nGuest side: on the property's web page (Buyer web) or by tapping a property in the Mingla Explorer app under Discover, Stays, the guest chooses check-in and check-out dates, adults and children, and rooms or places (rooms can be sorted by price), then enters name and email or phone and taps \"Review and reserve\" (or \"Review request\"). They pay with \"Confirm and pay\", or tap \"Send request\" for a request booking and are not charged unless the property approves. From the reservation page they can \"Complete payment\", \"Preview cancellation\" and \"Confirm cancellation\", and see refund progress.",
    "limitations": "Creating the Stay venue, rooms, availability and prices, and approving, declining or cancelling bookings need the event manager role or higher (event manager, brand admin or brand owner). Finance managers can view Stay bookings. Publishing needs: Mingla's approval of the venue listing, the Organiser Terms accepted, a connected payout bank so the brand has a currency, and at least one Room or Place with photos, pricing, a policy and open availability. Payments run on Stripe, or on Paystack for Nigerian brands. Request bookings are not charged until the property approves. Stays, Stay booking, Stay payments and Stay notifications are all switched on in production; Mingla staff can turn each off with a server switch. Mingla staff can view Stay operations and pause an offering from Mingla Admin. Room QR codes for in-room ordering only work once a serving venue with a menu is chosen.",
    "support_wording": "Hotels and other stay properties can list rooms and bookable places in the Mingla Host app, set dates and nightly prices, publish once Mingla has approved the venue, and manage bookings from the Reservations section. Guests book and pay on the property's Mingla page or from Discover, Stays in the Mingla Explorer app, and request bookings are only charged after the property approves.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Buyer",
      "Explorer",
      "Mingla Support"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Mingla Admin"
    ]
  },
  {
    "capability_key": "trips-cancel-booking",
    "title": "Travellers cancel from the email link and get their tier refund",
    "outcome_summary": "Planned: a traveller who booked a trip would cancel their own booking from a link in their confirmation email, see the refund their trip's cancellation policy gives (for example 100%, 50% or no refund depending on how close the trip is) and confirm. Today travellers cannot self-cancel a trip booking; the trip organiser cancels it and the refund follows the same policy tiers. Also called cancel my trip, cancel reservation, trip refund.",
    "how_to": "Not available to travellers yet. What works today: the host opens the trip in Mingla Host, taps \"Payments\", finds the traveller and taps \"Cancel & refund\". The \"Cancel this booking?\" sheet shows the refund the policy gives; the host adds a cancellation reason and taps \"Cancel & refund\" (or \"Keep reservation\"). Any scheduled instalments for that booking are cancelled too. The traveller cancel page itself exists on buyer web (\"Cancel & refund\", \"Keep my spot\", or type CANCEL when no refund applies) but no email currently gives travellers a link to it.",
    "limitations": "No code creates the traveller cancel token or puts a cancel link in any email, so the traveller page cannot be opened with a valid link and shows \"This cancel link isn't valid\". Trips only; single events use the normal refund flow. The refund amount comes from the trip's refund tiers set on the \"Cancellation & deadline\" step, and is recalculated if the policy changed. The host path is on the trip Payments screen in Mingla Host (Hub access needs the finance manager role or above in the app). Refunds go back through the original card or Paystack payment.",
    "support_wording": "Travellers cannot cancel a trip booking themselves in Mingla yet. Please contact the trip organiser, who can cancel your booking from their Mingla Host app; any refund follows the trip's cancellation policy and goes back to your original payment method.",
    "who_can_use": [
      "Buyer"
    ],
    "surfaces": [
      "Not currently available"
    ],
    "claimed_status": "planned"
  },
  {
    "capability_key": "trips-create",
    "title": "Create trips and manage travellers",
    "outcome_summary": "Hosts create a multi-day trip (retreat, tour, weekend getaway) with dates, departure and destination, a day-by-day itinerary, what is and is not included, one or more priced packages with optional payment plans, a refund policy and booking deadline, and questions for travellers. After publishing they share the public trip page and manage the trip: travellers list with their answers, orders, payments, scanning, group chat and cancelling. Also called tour, retreat, travel package, itinerary, traveller list or guest list.",
    "how_to": "1. In Mingla Host tap the \"+\" button in the top bar and choose \"Create trip or otherwise\". The wizard saves as you go.\n2. Basics: \"Trip title\", \"Start date\", \"End date\", \"Departing from\", \"Destination\" (pick both from the suggestions) and \"Cover\".\n3. Day by day: \"Add a day\" and describe each day. Shortening the dates asks before removing a day that has content.\n4. What's included: add items under \"What's included\" and \"What's NOT included\".\n5. Pricing: \"Add package\" for each package with \"Package name\", \"Price per spot\", \"Spots in this package\" and an optional \"Payment plan\". Trip capacity is the total of the package spots.\n6. Cancellation & deadline: pick a refund policy (\"Flexible\", \"Standard\", \"Custom\" tiers or none) and when bookings close.\n7. Traveler info: add the questions travellers answer before paying.\n8. Review and tap \"Publish trip\", and confirm in \"Publish trip?\".\n9. Manage it under Hub > Trips: \"Edit trip\" or \"Continue editing\", \"Guests\" (the Travelers list with name, email, package, payment status, amount and intake answers), \"Orders\", \"Payments\", \"Group chat\", \"Public page\", and the options menu with \"View public page\", \"Share trip link\" and \"Cancel trip\".",
    "limitations": "Creating, editing and publishing need the brand owner, brand admin or event manager role; the Hub tab is shown only to finance manager and above. A paid trip needs a connected bank and accepted Organiser Terms. Payment plans work only for brands paid out through Stripe; Nigerian (Paystack) brands cannot publish a trip with a payment plan. An earlier publishing fault (#3801), where publishing failed with \"Set both start and end dates before publishing.\" even when dates were set, is fixed in production; if a host still sees that message with dates filled in, escalate to engineering. Travellers are not emailed when a host edits a live trip, except for intake question changes. Cancelling a live trip with bookings stops sales and puts paid orders into a refund batch that Mingla reviews.",
    "support_wording": "Create a trip in Mingla Host by tapping +, then Create trip or otherwise, and work through the steps from Basics to Review before tapping Publish trip. Paid trips need a connected bank. Once it is live, open it from Hub > Trips to see your travellers, their answers, orders and payments, or to share the trip link.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "trips-installments",
    "title": "Let travellers pay in instalments",
    "outcome_summary": "Hosts add a payment plan to a trip package: a deposit at booking, then up to 11 more payments on set dates or a number of days after booking. Travellers choose \"Pay in full\" or pay over time at checkout, and later payments are charged automatically to their saved card. Hosts see who has paid, what is outstanding and who is at risk, and can charge now, retry, send a reminder or cancel and refund. Also called deposit, payment plan, split payments, pay later, pay over time.",
    "how_to": "Host setup: 1. In the trip wizard (or \"Edit trip\" on a draft) go to Pricing and switch on \"Payment plan\" for a package. 2. Set \"Deposit at booking\" as a percentage, then each instalment's \"Amount\" and due date (a fixed date or days after booking). Use \"Add another installment\" for up to 11. 3. Publish the trip.\nTraveller: on the trip checkout's \"Review & pay\" step (buyer web) or in the Mingla Explorer app cart, choose under \"HOW YOU PAY\" between \"Pay in full\" and the deposit option, which shows the deposit due today and how many more payments follow. Later payments are charged to the same card automatically.\nHost follow-up: open the trip and tap \"Payments\". Each booking shows Plan, Paid-to-date, Outstanding, Next installment and Last status (Scheduled, Collected, At risk, Refunded, Cancelled). Use \"Charge now\", \"Retry now\", \"Send reminder\" (email and push to the traveller) or \"Cancel & refund\".",
    "limitations": "Trips only. Only brands paid out through Stripe can offer payment plans; Nigerian (Paystack) brands cannot, and the app refuses to publish a plan for them. A paid trip with a plan also needs a connected bank. Once anyone has booked under a plan it is locked and cannot be changed. Automatic charges run every 6 hours; after 3 failed attempts the booking is marked At risk and automatic retries stop, and the host must confirm \"Charge anyway\" to try again. \"Retry now\" queues the attempt for the next automatic run. Reminders are limited to one per traveller per 24 hours. The Payments screen sits under Hub, which needs the finance manager role or above.",
    "support_wording": "Hosts can add a payment plan to a trip package so travellers pay a deposit at booking and the rest automatically on set dates. Travellers choose Pay in full or the deposit option at checkout, and later payments are taken from the same card. Payment plans are not available for brands paid out in Nigeria.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Email",
      "Push notifications"
    ]
  },
  {
    "capability_key": "trips-intake-forms",
    "title": "Traveller intake forms",
    "outcome_summary": "Hosts set the questions every traveller must answer before paying for a trip, such as full name, date of birth, dietary needs, passport scan or emergency contact. Questions can be short or long text, single or multiple choice, date, number or file upload (images and PDFs), required or optional, and different for each package. Travellers answer them during checkout and hosts read the answers on the trip's traveller list. Also called traveller questions, traveller details, booking form, registration form, passenger info.",
    "how_to": "Host: 1. In the trip wizard go to the \"Traveler info\" step (\"What to ask travelers before they pay\"). With several packages, pick the package tab; with one package the questions are \"For all travelers\". 2. Tap \"Add question\", pick a type (\"Short text\", \"Long text\", \"Choice\", \"Multi\", \"Date\", \"Number\", \"File upload\"), write the question and set whether it is required. Drag to reorder on iPhone and Android; on web use move up and move down. 3. Publish the trip. To change questions on a live trip open \"Edit trip\", then \"Intake form\", make the change and give a reason in \"Save intake form changes?\", then \"Save + notify travelers\".\nTraveller: during trip checkout on buyer web, after \"Your details\", the \"Tell us about your trip\" step asks the questions for each package booked; then \"Continue to payment\". In the Mingla Explorer app the questions appear in the booking sheet before paying.\nHost review: open the trip, tap \"Guests\" to see each traveller with their answers and uploaded files.",
    "limitations": "Trips only. Up to 20 questions per package. Answers are collected once per booking, before payment; the app warns hosts \"Ask EVERYTHING you need upfront\" because there is no separate way to ask paid travellers again. When a host edits questions on a live trip, affected travellers get an email listing the changed questions, but the email has no link and there is no page where they can update their answers, so the host must collect updates directly. File uploads accept images and PDFs as the host allows. Editing needs the brand owner, brand admin or event manager role.",
    "support_wording": "Hosts add traveller questions on the Traveler info step when creating a trip, and travellers answer them during checkout before paying. Hosts can see every traveller's answers under Guests on the trip. If a host changes the questions after you booked, please send the updated details to the host directly.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Email"
    ]
  },
  {
    "capability_key": "venues-claim-or-add",
    "title": "Claim your venue or add a new one",
    "outcome_summary": "A host adds a restaurant, bar, cafe, activity space or other physical venue to their brand. If Mingla already knows the place, the host claims the existing listing and keeps its details, photos and hours; otherwise they create a new venue listing from scratch. Every new listing and every claim is reviewed and approved by Mingla staff before it is verified. Also known as: add venue, list my venue, claim my business, claim listing, venue verification, ownership check.",
    "how_to": "1. In Mingla Host (iOS, Android or web), tap \"+\" and choose \"Venue\" (\"A restaurant, bar or space guests can book\"). You can also tap \"Add your venue\" on the Venues list in Hub, or \"Finish adding <venue name>\" on Home to resume a saved draft.\n2. On \"Add a venue\", answer \"What's your venue called?\". Mingla searches its directory (\"Searching our directory...\").\n3. If your place appears (\"We found your place in our directory\"), tap \"Yes, this is me\" to claim it. Tap \"No, different business\", or the skip option to create from scratch, if it is not yours. If the place is already managed or someone else's claim is under review, you see that message with \"Message support\" and \"Not your place? Create a new listing\".\n4. Claiming opens \"Claim your place\": a 10 step walkthrough prefilled from the directory (\"Is this right?\", category, \"How people reach you\", hours, \"Pick your cover\", \"Your photos\", pitch, price, \"Bookings\", then \"Review & submit\"). Each step shows Keep, Save or Continue.\n5. Creating new opens \"List your venue\": pick \"What kind of place is it?\", then \"Where is your venue?\", name, \"Opening hours\", \"Pick your cover\", \"Guest contact\", \"Tell guests what to expect\", and \"Review & submit\". Tap \"Submit for review\".\n6. You see \"<venue> is in review\". For a claim the existing listing stays visible to guests while Mingla checks it is really you; a new listing is not public until approved, but you can keep setting it up in the venue page.\n7. Mingla staff review it in Mingla Admin under \"Venue Claims\" (tabs \"Pending review\", \"Verified\", \"Rejected\", \"Detail changes\"), can call the venue (\"Mark as called\"), ask for fixes (\"Need more info\", \"Send feedback\"), \"Approve\" or \"Reject\" with a reason. The brand owner gets an email and an app notification with the decision.",
    "limitations": "Creating or claiming a venue needs the brand role event manager or above (event manager, brand admin or brand owner); the server refuses lower roles. The \"Stay\" (hotel) category only appears when the Stay authoring feature flag is on, and is otherwise disabled. A place that is already managed on Mingla, or has another claim pending, cannot be claimed from the app: the host must contact support. Approval is manual by Mingla staff, so a new venue does not appear publicly (public venue page, Explorer) until it is verified. The \"listing submitted\" email is only sent when the person submitting is the brand's account owner. A rejection always carries a written reason.",
    "support_wording": "You can add your venue from the \"+\" button in Mingla Host by choosing Venue. If we already have your place in our directory you can claim it and keep its details; otherwise you can create a new listing. Every venue is checked by the Mingla team before it is verified, and you will get an email and a notification with the result.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Mingla Support"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Mingla Admin",
      "Email",
      "Push notifications"
    ]
  },
  {
    "capability_key": "venues-go-live-readiness",
    "title": "Check readiness to appear in Explorer",
    "outcome_summary": "A host sees what their venue still needs before Mingla can recommend it to Explorer users, and fills those gaps in one place: hero cover photo or video, at least 5 venue photos, website, typical spend, \"Best for\" tags and quick yes/no details. Mingla shows plain checklist cards such as \"Add more photos\" or \"Add your website\". Also known as: get recommended, go live, deck readiness, get discovered, appear in the app, venue setup checklist.",
    "how_to": "1. In Mingla Host, open the venue (Hub > Venues > tap the venue), or tap the \"Get <venue> live\" item on Home.\n2. From the venue's \"Overview\" tap \"Edit listing\", or from \"Settings\" > \"Photos & vibes & AI\" tap \"Edit photos & details\". This opens \"Deck readiness\" with the heading \"Get recommended on Mingla\".\n3. Under \"Photos & video\" tap \"Add hero cover\" (or \"Change hero cover\"). Under \"Venue photos\" tap \"Add photos\" until the counter shows at least 5 (up to 20).\n4. Under \"About your venue\" enter \"Website (required)\", \"Typical spend from\" and optionally \"Up to\", pick \"Best for\" tags and answer \"A few quick questions\" (for example \"Good for groups?\", \"Outdoor seating?\").\n5. Tap \"Save deck details\". If you leave with unsaved changes you are asked \"Save your deck changes?\".\n6. Read \"What's left before you go live\": each card names one remaining fix (for example add photos, add an official website rather than a social link, confirm opening hours). Mingla writes your pitch and match scores when it approves the venue.",
    "limitations": "Editing needs the brand role event manager or above; lower roles do not see the edit button and the server refuses them. The screen only works for a venue already linked to a Mingla directory place (created or claimed through the venue flow). Some blockers cannot be fixed by the host (for example the venue looks like a chain, fast food, or a location inside another business); the card says to request a review, but there is no request button on this screen, so the host must contact support. The typical spend currency comes from the brand's payout account; until a payout account exists the currency is shown as not yet confirmed. Final listing in Explorer still depends on Mingla approving the venue.",
    "support_wording": "In Mingla Host, open your venue and tap Edit listing to see what is left before Mingla can recommend it in the Explorer app. You will need a cover photo or video, at least 5 venue photos, your own website and a typical price range. Once those are in, the Mingla team reviews the venue before it is recommended.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web"
    ]
  },
  {
    "capability_key": "venues-insights",
    "title": "Venue insights: website check, competitor watch, order and page stats",
    "outcome_summary": "A venue host gets a graded report card on how their website treats guests (first impression, findability, mobile, menu and offers, occasion signal) compared with nearby venues, can watch up to 5 competitors for public website and Instagram changes with a weekly brief, sees order insights (what sells, where, when), and sees 30 day organic stats for their public venue page (page views, menu opens, reservation starts). Also known as: site check, website grader, competitor tracking, market intel, analytics, page views. A pricing audit is not part of venue Insights yet.",
    "how_to": "1. In Mingla Host, open the venue (Hub > Venues > tap the venue) and choose the \"Insights\" tab.\n2. Site check: under \"How does your website treat your guests?\" confirm the venue name, city and website, then tap \"Check my site\". When it finishes, open the full report; later use \"Re-check my site\". If no website is on file, tap \"Add website\".\n3. Orders: tap \"Orders\" (\"See what sells, where, and when.\") for venue order insights.\n4. Competitor watch: under \"COMPETITION\" tap \"Watch a competitor\", search nearby venues or enter a name, city and public links (\"Website\" checked weekly, \"Instagram profile\" weekly if eligible, \"TikTok\" saved as a link only). Each watched competitor shows \"THIS WEEK\" and \"WORTH DOING NEXT\", with \"Open weekly brief\", \"Refresh now\", \"Edit sources\" and \"Stop watching\".\n5. Organic page stats are on the venue's \"Overview\" tab under \"Organic engagement\" > \"Venue page activity\" (last 30 days).",
    "limitations": "Insights exist for restaurant, bar and activity venues; Stays do not have this tab. Any brand team member can view Insights and run a site check; watched competitors are per venue, capped at 5. Site checks are limited to 10 runs per brand per 24 hours; unchanged inputs return the saved report. Competitor watch is off by default on the server: website and Instagram analysis start disabled, automatic weekly checking is off and the AI spend budget starts at zero, so a watched competitor may stay at \"Preparing\" or show \"Refresh delayed\" until Mingla staff turn these on. TikTok links are never analysed. The pricing audit tool is not available in venue Insights. Organic page stats only count visits to the public venue page on buyer web and the Explorer app.",
    "support_wording": "Open your venue in Mingla Host and choose Insights to run a website check and see order insights; page views for your venue page are on the Overview tab. You can add up to 5 competitors to watch, but weekly competitor briefs depend on checks that the Mingla team switches on, so a new watch can stay in preparing for a while. A pricing audit is not available in Insights yet.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Finance manager",
      "Mingla Support"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Mingla Admin"
    ]
  },
  {
    "capability_key": "venues-menu",
    "title": "Build your menu",
    "outcome_summary": "A venue host builds the menu guests see on the public venue page: categories (for example Starters, Drinks) with serving times and days, dishes with a guest price, an optional private cost only the host sees, availability on or off, guest notes, where it is made (kitchen or bar), and option groups such as \"How would you like it?\" or extras with price changes. The same menu feeds table QR ordering where it is turned on. Also known as: food menu, drinks menu, dishes, items, prices, modifiers, add-ons.",
    "how_to": "1. In Mingla Host, open the venue (Hub > Venues > tap the venue) and choose the \"Menu\" tab.\n2. Tap \"Add a category\". Enter \"Category name\" and an optional description, set \"When it's served\" with \"From\" and \"Until\" and the service days, or clear the times to serve all day. Tap \"Add category\".\n3. In a category tap \"+ Add item\". Enter \"Item name\", optional description, \"Price\", and optionally \"What it costs you\" (\"Only you ever see this. Guests never do.\"). Use \"Show this item to guests\" to hide or show it, \"Let guests add a note\" for kitchen notes, and \"Where it's made\" (Kitchen, Bar, Somewhere else).\n4. Under \"Options\" tap \"Add a choice\" to create an options group: name the question, choose \"Pick one\" or \"Pick several\", mark it \"Required\" or \"Optional\", add options with an optional price change, then \"Add group\". Tap \"Add item\" or \"Save item\".\n5. Reorder categories and items with the move up and move down controls; edit with the Edit control; delete with \"Delete item\" or \"Delete category\".\n6. \"QR spots & printing\" opens table and room QR cards for the venue.",
    "limitations": "Adding, editing, reordering and deleting need the brand role event manager or above; other team members see the menu read-only (\"Ask a manager or owner to add one\"). Guests only see the menu once the venue is verified and its public page is live. For Stays the menu can be built but guests cannot see it on the public page yet. Prices use the brand's currency. An options group that guests have already ordered cannot be removed; turn its options off instead. Ordering from the menu is a separate per-venue setting that is off by default.",
    "support_wording": "Open your venue in Mingla Host and choose the Menu tab to add categories, dishes, prices and options. Guests see the menu on your public venue page once your venue is verified. Only brand owners, admins and event managers can edit the menu.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "venues-qr-ordering",
    "title": "Guests order and pay from a table QR code",
    "outcome_summary": "Guests scan a QR code on their table, room or counter, browse the venue's menu, order food and drinks and pay on their phone (scan to order, mobile ordering, order at table, pay at table, counter pickup, tips, tabs). The venue team sees every ticket live in an Orders queue, can pause new orders when busy, and staff can also take orders and run tabs from the Host app.",
    "how_to": "Host side (Mingla Host app on iOS, Android or web): 1) Open Hub, then Venues, and tap the venue card. 2) Open the Orders module and turn on \"Take orders through Mingla\". The switch only works once the venue is live (verified) on Mingla; before that the card says \"Ordering turns on once your venue is live. Mingla is still reviewing it.\" 3) Build the menu in the Menu module. 4) Print codes: in the Menu or Tables module tap \"QR spots & printing\", then \"Print\" for one area or \"Print all\" for every active spot. Each table gets a code automatically. 5) Work the queue in Orders using the views New, Cooking, Ready, Refunds and Done, and filter by area with \"All areas\" or a zone. Use \"Pause new orders\" when the kitchen is slammed; guests are told you are not taking orders. 6) Staff can tap \"New order\" to take an order at the table, \"Send to kitchen\", and open or close a tab with \"Send the bill\".\nGuest side: scanning the code opens the venue's public page on the web on the Menu tab, labelled \"Ordering for\" the table, or \"Order & collect from the counter\". The guest adds items, enters name, email and phone, reviews the total and taps \"Pay\". The order page then shows progress (\"Order placed\", \"The venue has your order\", \"Being made now\", \"Ready to collect\" or \"On its way\"). Until the venue picks the order up, the guest can tap \"Cancel · full refund\"; after that they can tap \"Ask for a refund\". They can also \"Order another round\". The same venue page and ordering also open in the Mingla Explorer app when the link opens there.",
    "limitations": "Off by default for every venue and only a venue that Mingla has verified can turn it on (switching off is always allowed). Turning ordering on or off, pausing, cancelling or refunding orders and opening or closing tabs need the event manager role or higher (event manager, brand admin or brand owner); any team member, including scanners, can acknowledge tickets and take orders with \"New order\". The brand needs a working payout account to take money: Stripe with charges enabled, or a Paystack account for Nigerian brands (naira). Guests pay by card through Stripe, or through Paystack in Nigeria. Once ordering is on, tips, counter pickup and staff tabs are on by default and there is no setting in the Host app to switch them off. Guest ordering happens on the web venue page (and the Explorer app venue page when opened from a link); there is no ordering entry point inside Explorer browsing. Room QR codes at a Stay property stay inactive until a serving venue with a menu is chosen.",
    "support_wording": "Venues can let guests scan a table QR code, order from the menu and pay on their phone, and the team sees every order live in the Orders section of the Mingla Host app. Ordering is off until a brand manager, admin or owner turns on \"Take orders through Mingla\", and it can only be turned on once Mingla has verified the venue. Guests can cancel for a full refund until the venue picks up the order.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Scanner",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android",
      "Push notifications"
    ]
  },
  {
    "capability_key": "venues-reservations",
    "title": "Table reservations, with optional deposits",
    "outcome_summary": "Venues take table bookings online (reservations, book a table, table booking, deposits, reservation fee, large party deposit). Guests pick party size, date and time from live availability, confirm, and can manage or cancel later. The venue sets up tables, opening hours, blackout dates, a calendar of bookings and a walk-in waitlist, and can charge an optional reservation fee or a deposit for large parties.",
    "how_to": "Host side (Mingla Host iOS, Android or web): 1) Open Hub, then Venues, tap the venue card and open Settings. 2) Under \"Reservations\" turn on \"Take table reservations\". This adds the Tables, Availability, Reservations and Waitlist modules. 3) Optional: under \"Reservation fee\" turn on \"Charge a reservation fee\" and enter the \"Fee amount\". Guests then pay that all-in at booking. Set the cancellation policy under \"Cancellation & no-show\" (\"Forfeit fee on no-show\" or \"No penalty\"). 4) In Tables, add tables and open \"Smart capacity rules\" to use \"Party fit\" or \"Deposit for large parties\" (choose the party size and deposit amount). 5) In Availability set reservation hours, turn times and blackout dates. 6) In Reservations see bookings by day, week or month, and tap \"New reservation\" to add one yourself.\nGuest side: on the venue's public web page tap \"Reserve a table\" (some venue types say \"Book a visit\"), choose party size, a date and a time, enter name, email and phone, optional occasion and notes, then tap \"Confirm reservation\". If a fee or deposit applies they pay on the next step and land on \"Your table is reserved\", with a \"Manage reservation\" link to view or cancel. In the Mingla Explorer app, a reservable venue card shows \"Reserve a table\": pick party size and date, tap \"See times\", choose a slot and confirm; a fee is paid with the in-app payment sheet.",
    "limitations": "Turned on per venue; off unless the venue switches on \"Take table reservations\". Changing reservation settings, tables, availability and bookings needs the event manager role or higher (event manager, brand admin or brand owner). A paid fee or deposit can only be switched on once the brand's payouts are ready (Stripe charges enabled, or a Paystack account in Nigeria) and the brand has a currency set from its bank country. If \"Deposit for large parties\" is on without an amount, large parties cannot book until an amount is set. Guests can cancel online; a paid fee is refunded only if the venue's policy allows it and the guest cancels before the cutoff (24 hours by default), otherwise it is kept. If the venue cancels a paid booking the guest is refunded in full. Nigerian brands take payment through Paystack. Open follow-up work on deposits and reservations is tracked on #3729.",
    "support_wording": "Venues can take table reservations through Mingla once they turn on \"Take table reservations\" in their venue Settings, and guests can book from the venue's web page or the Mingla Explorer app. A reservation fee or a deposit for large parties is optional and needs the venue's payouts set up first. Guests can manage or cancel from the link in their confirmation, and if the venue cancels a paid booking the guest gets a full refund.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager",
      "Buyer",
      "Explorer"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "Buyer web",
      "Mingla Explorer iOS",
      "Mingla Explorer Android"
    ]
  },
  {
    "capability_key": "venues-waitlist-text",
    "title": "Text guests when their table is ready",
    "outcome_summary": "When a venue is full, staff add walk-in guests to a waitlist with party size, quoted wait and mobile number, then tap Notify to send a text message (SMS) saying their table is ready. The guest gets one short text from Mingla with the venue name and an option to reply STOP. Staff can also seat a waiting guest as a reservation or mark them as left.",
    "how_to": "In the Mingla Host app (iOS, Android or web): 1) Make sure \"Take table reservations\" is on in the venue's Settings, which shows the Waitlist module. 2) Open Hub, then Venues, tap the venue card and open Waitlist. 3) Tap \"Add\" (or \"Add to waitlist\" when empty), enter \"Guest name\", party size, \"Preferred seating (optional)\", \"Quoted wait (minutes, optional)\" and the guest's mobile under \"Phone for the table's ready text\", then tap \"Add to waitlist\". 4) When a table opens, tap \"Notify\" on the guest's row. The guest receives: \"Your table's ready at\" the venue name, with \"Reply STOP to opt out.\" The row then shows \"Notified\". 5) Tap \"Seat\" to turn the guest into a reservation with \"Seat as reservation\", or the X to mark them as left.",
    "limitations": "Only shows when the venue has reservations turned on. Sending the text needs the event manager role or higher (event manager, brand admin or brand owner); the Notify button only appears when a phone number was entered. Texts are sent per market: US, Canada, UK, France and Belgium numbers go through Twilio under the US SMS switch, and Nigerian numbers go through Termii under a separate Nigeria switch. Numbers from any other country are not texted. If a market's switch is off, nothing is sent and staff see that SMS is switched off for this region and should tell the guest in person. Nigerian texts can be refused at night by the network operator window, and are not resent automatically. Guests who replied STOP are never texted. There is no link in the text and no reply handling beyond STOP. The waitlist and its text log have not been used in production yet.",
    "support_wording": "Venues using reservations in the Mingla Host app can add walk-ins to a waitlist and tap Notify to text a guest that their table is ready. The text only goes to the number staff entered, and if texting is not available in that guest's country the app says so and staff should let the guest know in person.",
    "who_can_use": [
      "Brand owner",
      "Brand admin",
      "Event manager"
    ],
    "surfaces": [
      "Mingla Host iOS",
      "Mingla Host Android",
      "Mingla Host web",
      "SMS"
    ]
  },
  {
    "capability_key": "web-book-a-call",
    "title": "Book a call with Mingla",
    "outcome_summary": "Anyone can book a free 20 minute video call with Mingla on the website at usemingla.com/schedule. They pick a day and time, enter their name and email, and get a confirmation email plus a calendar invite with a Google Meet link. Search words: book a call, schedule a meeting, demo, talk to sales, appointment, calendar.",
    "how_to": "1. Go to usemingla.com/schedule (the free tool reports also link here after the full report is opened).\n2. Under \"Pick a day\", choose one of the open weekdays shown.\n3. Under \"Pick a time\", choose a 20 minute slot. Times are shown in the visitor's own timezone.\n4. Enter \"Your name\" and \"Your email\", then press \"Confirm <time>\".\n5. The page shows the booked day and time and says a confirmation and a calendar invite with a Google Meet link are on the way to that email. The Mingla team also gets a notification email.\nIf the chosen time was just taken, the page says so and refreshes the open times.",
    "limitations": "Only weekdays (Monday to Friday) between 5:00 and 20:00 New York time can be booked, in 20 minute slots, at least 12 hours ahead and up to about a month out. Bookings go on one Mingla team calendar; there is no admin page that lists them. If online booking is not set up or there are no open times, the page shows \"Let's find a time by email\" with an \"Email us to book\" button instead. The page is hidden from search engines and is not in the main site menu. Confirmation emails are best effort; the calendar invite is the main record.",
    "support_wording": "You can book a 20 minute call with the Mingla team at usemingla.com/schedule. Pick a weekday and time that suits you, add your name and email, and you will get a confirmation and a calendar invite with a video link. If no times show, use the email button on that page and we will set up a time with you.",
    "who_can_use": [
      "Everyone",
      "Venue owners and hosts"
    ],
    "surfaces": [
      "Mingla website (usemingla.com)"
    ]
  },
  {
    "capability_key": "web-careers",
    "title": "Careers site and applications",
    "outcome_summary": "Job seekers can see Mingla's open roles at career.usemingla.com, read each job description and apply online with a CV upload. Applications land in the Careers page of Mingla Admin, where Owners and Admins review them, download CVs, set a status and create, open or close roles. Search words: jobs, careers, hiring, apply, CV, resume, job posting, vacancy.",
    "how_to": "Applicant: 1. Go to career.usemingla.com and pick a role. 2. Press \"Apply for this role\". 3. Fill in Full name, Email, WhatsApp phone, Preferred salary, Portfolio link and upload a CV (PDF or Word, up to 5 MB). All six are required. 4. Press \"Submit application\". The page shows \"Application received.\" and a confirmation email is sent.\nStaff: 1. In Mingla Admin open Company, then \"Careers\". 2. The \"Applications\" tab lists applications; filter by status (All, New, Reviewing, Shortlisted, Rejected, Hired) or by role, then open a row to copy the email or WhatsApp number, \"Download CV\", and set a new status under \"Update status\". 3. The \"Roles\" tab lists every role; use \"New role\" to create one, \"Edit\" to change it, and \"Open\" or \"Close\" to publish or unpublish it.",
    "limitations": "Only roles with status open appear on the careers site; draft and closed roles are hidden and their links show a not-open state. The careers pages live only on career.usemingla.com; usemingla.com/careers returns not found. Applying needs all six fields and a CV that is PDF or Word up to 5 MB. More than five submissions from the same network within 10 minutes are blocked for a while. The same person can apply to several roles, and repeat applications are kept as separate entries. The admin Careers page is for Owner and Admin roles only. Applicants hear back by email; there is no applicant login or status tracker.",
    "support_wording": "Open roles and the application form are at career.usemingla.com. Pick a role, press Apply, fill in your details and upload your CV as a PDF or Word file up to 5 MB. You will get a confirmation email, and the team reaches out by email if there is a fit.",
    "who_can_use": [
      "Everyone",
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla careers site (career.usemingla.com)",
      "Mingla Admin"
    ]
  },
  {
    "capability_key": "web-city-guides",
    "title": "City guides for 10 cities",
    "outcome_summary": "The website has a city guide page for each of 10 cities: Lagos, Durham, Cary, Raleigh, New York City, Brussels, Paris, London, Fort Lauderdale and Washington, DC. Each guide gives a short answer on going out there, planning tips for Explorers, tips for Hosts, common questions, a ranked list of places, and buttons to get the app. Search words: city guide, things to do, cities, locations, where is Mingla, city page.",
    "how_to": "1. Go to usemingla.com/cities and choose a city under \"Choose your city.\", or go straight to usemingla.com/cities/<city>, for example /cities/lagos, /cities/durham-nc, /cities/cary-nc, /cities/raleigh-nc, /cities/new-york-city, /cities/brussels, /cities/paris, /cities/london, /cities/fort-lauderdale or /cities/washington-dc.\n2. The page opens with the city answer and two buttons, \"Explore <city>\" (Explorer app) and \"Host in <city>\" (Mingla Host).\n3. Scroll for the Explorer planning guide, the \"For Hosts\" section, \"<city> questions, answered.\", the ranked places, and \"How this <city> guide is checked.\" which shows when sources were last checked.\n4. Use the city links at the bottom to switch to another city.",
    "limitations": "Exactly 10 city guides exist and the list is fixed in the website code; adding a city needs a code change. These guide pages are marketing pages and are separate from the cities where the Explorer app is switched on, which staff manage in Launch Cities in Mingla Admin. Only Lagos shows curated plans; the other cities show the ranked places list only. The place lists are built into the site at release time, so they are not live. A guide that falls out of review shows a notice such as \"This city guide is being refreshed.\"",
    "support_wording": "Mingla's website has city guides for Lagos, Durham, Cary, Raleigh, New York City, Brussels, Paris, London, Fort Lauderdale and Washington, DC at usemingla.com/cities. Each guide has tips, common questions, a ranked list of places and links to get the app. Having a guide does not by itself mean every app feature is live in that city.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Mingla website (usemingla.com)"
    ]
  },
  {
    "capability_key": "web-download",
    "title": "Download links that pick the right store",
    "outcome_summary": "One download link, usemingla.com/download, sends iPhone users to the App Store and Android users to Google Play for the Mingla Explorer app. On a computer it shows a QR code to scan with a phone plus both store badges. Buttons across the site work the same way for the Explorer app and for Mingla Host. Search words: download, get the app, install, App Store, Google Play, QR code, app link.",
    "how_to": "1. Share or open usemingla.com/download (this is also the address inside the download QR code).\n2. On an iPhone it goes straight to the App Store; on an Android phone it goes straight to Google Play.\n3. On a computer the \"Get Mingla\" page shows a QR code (\"Scan this with your phone, or pick your store.\") and App Store and Google Play badges.\nOther site buttons: Explorer buttons on a phone open the store through a tracked app link, and on a computer open a QR panel. Mingla Host buttons on a phone open the Host app store listing, and on a computer open the Host web app at host.usemingla.com.",
    "limitations": "The store is picked from the device's browser information. On /download an iPad that reports itself as a Mac lands on the QR page instead of being redirected; it can still use the App Store badge there. The /download link is for the Explorer app only; Host downloads come from the Host buttons on the site. The page has no form and collects no personal details. It is hidden from search engines.",
    "support_wording": "Send people to usemingla.com/download. On an iPhone it opens the App Store, on Android it opens Google Play, and on a computer it shows a QR code to scan with your phone plus both store buttons. For the host app, use the Mingla Host button on the website, which opens the right store on a phone or the web version on a computer.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Mingla website (usemingla.com)"
    ]
  },
  {
    "capability_key": "web-free-tools",
    "title": "Free tools: website grader, turnout predictor, trip quote, pricing audit",
    "outcome_summary": "Four free AI tools on usemingla.com/tools, no sign-up needed: Venue Website Grader (grades a venue's website), Event Turnout Predictor (forecasts how many people will show up), Quote Any Trip (prices a group trip per person) and The Undercharging Audit (shows true cost per head and what to charge). Each gives a free preview, then emails the full report. Every run shows up in Tool Leads in Mingla Admin. Search words: free tools, website grader, turnout, trip quote, pricing audit, report, leads.",
    "how_to": "1. Go to usemingla.com/tools and pick a card: \"Grade my website\" (/tools/venues), \"Forecast my turnout\" (/tools/events), \"Quote a trip\" (/tools/trips) or \"Audit my pricing\" (/tools/pricing).\n2. Fill in the short form and run it. A free part of the report shows right away; the rest is blurred.\n3. Enter an email and press \"Send my report\" (grader), \"Email my report\" (turnout), \"Email my quote\" (trip) or \"Email my audit\" (pricing). The full report arrives as an email with a private link that opens the complete report, which ends with an offer to book a call.\nStaff: in Mingla Admin open Pipeline, then \"Tool Leads\". Filter by tool, by \"Has email\" or \"Anonymous\", and by lane (Web or App), then open a row to see what the visitor entered and the report.",
    "limitations": "Each tool allows about 10 runs per network per 24 hours, then shows \"You've hit today's limit\". Entering an email sends the report by email; it does not unlock the page itself. Report emails can fail; the lead is still saved. Tool Leads is read only (no editing, deleting or export) and is for Owner and Admin roles. In Tool Leads the pricing audit is listed as \"Undercharging Audit\", and rows marked App are runs from the Mingla Host app, not website leads.",
    "support_wording": "Mingla has four free tools at usemingla.com/tools: a venue website grader, an event turnout predictor, a group trip quote and a pricing audit. You get a free preview straight away, and if you add your email we send the full report to your inbox. Each tool can be run about 10 times a day.",
    "who_can_use": [
      "Everyone",
      "Venue owners and hosts",
      "Owner",
      "Admin"
    ],
    "surfaces": [
      "Mingla website (usemingla.com)",
      "Mingla Admin"
    ]
  },
  {
    "capability_key": "web-legal",
    "title": "Terms, privacy, organiser terms and SMS terms",
    "outcome_summary": "The website publishes Mingla's legal pages: Terms of Service, Privacy Policy, Organiser Terms for hosts, and SMS Terms for text messages, plus a page explaining how to delete your account. Each shows its effective or last updated date. Search words: terms, terms of service, privacy policy, organiser terms, organizer terms, SMS terms, text message terms, legal, delete account, data deletion.",
    "how_to": "Open the page directly or from the \"Legal\" links in the site footer:\n- Terms of Service: usemingla.com/terms-of-service\n- Privacy Policy: usemingla.com/privacy-policy\n- Organiser Terms (for anyone who lists, sells, messages or advertises with Mingla Host): usemingla.com/organiser-terms\n- SMS Terms: usemingla.com/sms-terms (linked from the unsubscribe page)\n- Account deletion instructions: usemingla.com/delete-account, which tells people to open the app, go to Settings, then Delete Account, and to email privacy@usemingla.com for exceptional requests.\nThe footer \"Legal\" group shows Privacy, Terms and Organiser Terms.",
    "limitations": "These are read-only pages; the text changes only through a website code change. SMS Terms and the delete-account page are not in the footer and are hidden from search engines; SMS Terms is reachable from the unsubscribe page or by direct link. The delete-account page gives instructions only; the deletion itself happens in the app.",
    "support_wording": "Our Terms of Service are at usemingla.com/terms-of-service, the Privacy Policy at usemingla.com/privacy-policy, the Organiser Terms for hosts at usemingla.com/organiser-terms, and the SMS Terms at usemingla.com/sms-terms. To delete an account, open the app and go to Settings, then Delete Account; the steps are also at usemingla.com/delete-account.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Mingla website (usemingla.com)"
    ]
  },
  {
    "capability_key": "web-unsubscribe",
    "title": "Unsubscribe from emails",
    "outcome_summary": "Anyone can stop Mingla marketing emails or texts at usemingla.com/unsubscribe without logging in. They enter an email or phone number and choose \"Marketing only\" or \"All messages\"; the opt-out takes effect right away. The one-click link in Mingla emails opens the same page with the email already filled in. Search words: unsubscribe, opt out, stop emails, stop texts, SMS opt out, email preferences.",
    "how_to": "1. Click the unsubscribe link in a Mingla email, or go to usemingla.com/unsubscribe.\n2. Enter an \"Email address\", a \"Phone number (international format)\" starting with + and the country code, or both. With the one-click email link no typing is needed.\n3. Under \"What would you like to stop?\" choose \"Marketing only\" (still get essential booking messages) or \"All messages\" (stop all non-essential messages).\n4. Press \"Opt out\". The page confirms \"You're opted out.\"",
    "limitations": "No account or login is needed. \"Marketing only\" still allows essential messages about bookings (confirmations, changes, refunds). The opt-out covers messages from Mingla and from businesses the person booked with. Phone numbers must be in international format. An expired or invalid one-click link shows an error and asks for the email or phone instead. Too many attempts in a minute are briefly blocked. If something fails, the page asks the person to email support@usemingla.com so the opt-out can be done by hand.",
    "support_wording": "You can stop Mingla emails or texts at usemingla.com/unsubscribe, no login needed. Enter your email or phone number, choose marketing only or all non-essential messages, and press Opt out; it takes effect right away. Marketing only still lets essential booking messages through.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Mingla website (usemingla.com)"
    ]
  },
  {
    "capability_key": "web-waitlist",
    "title": "Waitlist or beta sign-up form",
    "outcome_summary": "There is no waitlist or beta sign-up form on the Mingla website. This is not available yet. People who want Mingla can download the Explorer app or use Mingla Host directly. Search words: waitlist, wait list, beta, early access, sign up, join the list.",
    "how_to": "There is nothing to open on the website. If someone asks to join a waitlist or beta, point them to usemingla.com/download for the Explorer app, or the Mingla Host button on the site for hosts, and note their request for the team.",
    "limitations": "No page on the website renders a waitlist or beta form. A waitlist form component exists in the website code but no page uses it, and it is not connected to any backend. The older early-access pop-up on the site was removed and replaced with direct download buttons and a QR code. This is separate from waitlists for sold-out tickets or restaurant tables, which are different features.",
    "support_wording": "Mingla does not have a waitlist or beta sign-up on the website; that is not available yet. You can download the Explorer app at usemingla.com/download, or hosts can start with Mingla Host from the website.",
    "who_can_use": [
      "Everyone"
    ],
    "surfaces": [
      "Not currently available"
    ]
  }
]
$catalog$::jsonb) AS seed(
    capability_key text, title text, outcome_summary text, how_to text,
    limitations text, support_wording text, who_can_use jsonb, surfaces jsonb,
    claimed_status text
  );

CREATE TEMP TABLE issue_3720_content_evidence_fix ON COMMIT DROP AS
SELECT *
  FROM jsonb_to_recordset($fixes$
[
  {
    "capability_key": "account-delete",
    "kind": "test",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/functions/delete-user/index.test.ts"
  },
  {
    "capability_key": "account-settings",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/app-mobile/src/components/profile/AccountSettings.tsx"
  },
  {
    "capability_key": "ari-host-assistant",
    "kind": "test",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/functions/agent-confirm-action/__tests__/issue_1981_paid_order_must_refund_status.test.ts"
  },
  {
    "capability_key": "checkout-free",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/checkout/[eventId]/buyer.tsx"
  },
  {
    "capability_key": "checkout-tickets",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/checkout/[eventId]/payment.tsx"
  },
  {
    "capability_key": "checkout-trips-experiences",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/checkout-trip/[tripEventId]/payment.tsx"
  },
  {
    "capability_key": "events-discount-codes",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/functions/_shared/orderMoneyTruth.ts"
  },
  {
    "capability_key": "events-reconciliation",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/event/[id]/reconciliation.tsx"
  },
  {
    "capability_key": "events-update-email",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/src/utils/buyerNoticeCopy.ts"
  },
  {
    "capability_key": "events-wallet-passes",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/checkout/[eventId]/confirm.tsx"
  },
  {
    "capability_key": "help-announcements-roadmap",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/src/components/support/CommunityTabPanel.tsx"
  },
  {
    "capability_key": "help-ideas-and-questions",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/src/components/support/CommunityConversationsPanel.tsx"
  },
  {
    "capability_key": "marketing-buyer-blasts",
    "kind": "test",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/src/hooks/marketing/__tests__/useEventBuyers.rsvpAudience.test.ts"
  },
  {
    "capability_key": "marketing-buyer-blasts",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/event/[id]/blasts/index.tsx"
  },
  {
    "capability_key": "marketing-templates",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/(tabs)/marketing/templates/[id].tsx"
  },
  {
    "capability_key": "money-provider-refunds",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/functions/_shared/stripeWebhookRouter.ts"
  },
  {
    "capability_key": "offerings-refund-policy",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/src/components/trip/RefundPolicyEditor.tsx"
  },
  {
    "capability_key": "payouts-timing",
    "kind": "migration",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/migrations/20271107003872_issue_3872_money_truth.sql"
  },
  {
    "capability_key": "rsvp-approvals",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/app/rsvp/[id]/guests.tsx"
  },
  {
    "capability_key": "rsvp-chip-in",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/functions/rsvp-contribution-create/index.ts"
  },
  {
    "capability_key": "social-follow-brands",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/app-mobile/src/hooks/useBrandFollow.ts"
  },
  {
    "capability_key": "social-referrals",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/supabase/migrations/20260505000000_baseline_squash_orch_0729.sql"
  },
  {
    "capability_key": "staff-community-support",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-admin/src/pages/CommunitySupportPage.jsx"
  },
  {
    "capability_key": "staff-content-calendar",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-admin/src/pages/ContentCalendarPage.jsx"
  },
  {
    "capability_key": "staff-people-brands",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-admin/src/pages/BrandsConsolePage.jsx"
  },
  {
    "capability_key": "staff-stripe-tools",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-admin/src/pages/BusinessPaymentsPage.jsx"
  },
  {
    "capability_key": "staff-stripe-tools",
    "kind": "test",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-admin/src/__tests__/orch1278_money_console_act.test.js"
  },
  {
    "capability_key": "staff-venue-claims",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-admin/src/pages/ClaimsPage.jsx"
  },
  {
    "capability_key": "trips-intake-forms",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-business/src/components/trip/TripCreatorStep6Intake.tsx"
  },
  {
    "capability_key": "web-download",
    "kind": "source",
    "url": "https://github.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/mingla-marketing/app/download/page.tsx"
  }
]
$fixes$::jsonb) AS fix(capability_key text, kind text, url text);

CREATE TEMP TABLE issue_3720_content_live_before ON COMMIT DROP AS
SELECT count(*)::integer AS live_rows
  FROM public.product_capabilities c
 WHERE c.claimed_status = 'live'
   AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live';

DO $preflight$
DECLARE
  v_missing text;
BEGIN
  IF (SELECT count(*) FROM issue_3720_content_truth) <> 149
     OR (SELECT count(DISTINCT capability_key) FROM issue_3720_content_truth) <> 149 THEN
    RAISE EXCEPTION 'issue3720_content_truth_payload_shape';
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_3720_content_truth
     WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')
  ) OR EXISTS (
    SELECT 1 FROM issue_3720_content_evidence_fix
     WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')
  ) THEN
    RAISE EXCEPTION 'issue3720_content_truth_protected_live_entry';
  END IF;
  SELECT string_agg(k.capability_key, ', ' ORDER BY k.capability_key)
    INTO v_missing
    FROM (
      SELECT capability_key FROM issue_3720_content_truth
      UNION
      SELECT capability_key FROM issue_3720_content_evidence_fix
    ) k
   WHERE NOT EXISTS (
     SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = k.capability_key
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'issue3720_content_truth_missing_capability: %', v_missing;
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_3720_content_truth
     WHERE claimed_status IS NOT NULL AND claimed_status <> 'planned'
  ) OR EXISTS (
    SELECT 1 FROM issue_3720_content_evidence_fix
     WHERE kind NOT IN ('source', 'test', 'migration')
        OR url !~ '^https://github\.com/Mingla-LLC/mingla-main/blob/52cb68950ef3a1c86d23090d9c21dbadae970eef/'
  ) THEN
    RAISE EXCEPTION 'issue3720_content_truth_status_or_evidence_out_of_scope';
  END IF;
  IF (SELECT count(*) FROM issue_3720_content_evidence_fix)
     <> (SELECT count(DISTINCT (capability_key, kind)) FROM issue_3720_content_evidence_fix) THEN
    RAISE EXCEPTION 'issue3720_content_truth_duplicate_evidence_fix';
  END IF;
END;
$preflight$;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET title = s.title,
         outcome_summary = s.outcome_summary,
         how_to = s.how_to,
         limitations = s.limitations,
         support_wording = s.support_wording,
         who_can_use = ARRAY(SELECT jsonb_array_elements_text(s.who_can_use)),
         surfaces = ARRAY(SELECT jsonb_array_elements_text(s.surfaces)),
         claimed_status = COALESCE(s.claimed_status, c.claimed_status),
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_3720_content_truth s
   WHERE c.capability_key = s.capability_key
     AND (c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording,
          c.who_can_use, c.surfaces, c.claimed_status)
         IS DISTINCT FROM
         (s.title, s.outcome_summary, s.how_to, s.limitations, s.support_wording,
          ARRAY(SELECT jsonb_array_elements_text(s.who_can_use)),
          ARRAY(SELECT jsonb_array_elements_text(s.surfaces)),
          COALESCE(s.claimed_status, c.claimed_status))
  RETURNING c.id, c.revision, c.claimed_status, s.claimed_status AS requested_status
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', saved.id,
       jsonb_build_object(
         'source', 'issue_3720_feature_guide_content_truth',
         'issue', 3720,
         'revision', saved.revision,
         'claimed_status', saved.claimed_status,
         'status_corrected', saved.requested_status IS NOT NULL
       )
  FROM saved;

CREATE TEMP TABLE issue_3720_content_evidence_new ON COMMIT DROP AS
SELECT c.id AS capability_id, f.kind, f.url
  FROM issue_3720_content_evidence_fix f
  JOIN public.product_capabilities c USING (capability_key)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.product_capability_evidence e
    WHERE e.capability_id = c.id
      AND e.evidence_kind = f.kind
      AND e.is_current
      AND e.evidence_url = f.url
      AND e.verdict = 'verified'
 );

UPDATE public.product_capability_evidence e
   SET is_current = false
  FROM issue_3720_content_evidence_new n
 WHERE e.capability_id = n.capability_id
   AND e.evidence_kind = n.kind
   AND e.is_current;

WITH recorded AS (
  INSERT INTO public.product_capability_evidence(
    capability_id, evidence_kind, evidence_url, verdict, details, observed_at
  )
  SELECT n.capability_id, n.kind, n.url, 'verified',
         'Corrected pinned ' || n.kind || ' evidence at 52cb689.',
         '2026-10-19T17:00:00Z'::timestamptz
    FROM issue_3720_content_evidence_new n
  RETURNING id, capability_id, evidence_kind
)
INSERT INTO public.product_truth_audit(action, capability_id, evidence_id, metadata)
SELECT 'evidence_recorded', recorded.capability_id, recorded.id,
       jsonb_build_object(
         'source', 'issue_3720_feature_guide_content_truth',
         'issue', 3720,
         'evidence_kind', recorded.evidence_kind,
         'verdict', 'verified'
       )
  FROM recorded;

UPDATE public.product_capabilities c
   SET revision = c.revision + 1,
       updated_at = now()
 WHERE c.id IN (SELECT DISTINCT capability_id FROM issue_3720_content_evidence_new);

DO $postcheck$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(c.capability_key, ', ' ORDER BY c.capability_key)
    INTO v_bad
    FROM public.product_capabilities c
   WHERE concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording)
         ILIKE ANY (ARRAY[
           '%follow the on-screen%',
           '%complete this job through%',
           '%Support must use the current evidence status%'
         ]);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue3720_content_truth_template_wording_remains: %', v_bad;
  END IF;

  IF (SELECT count(*)::integer
        FROM public.product_capabilities c
       WHERE c.claimed_status = 'live'
         AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live')
     <> (SELECT live_rows FROM issue_3720_content_live_before) THEN
    RAISE EXCEPTION 'issue3720_content_truth_live_count_changed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM issue_3720_content_truth s
      JOIN public.product_capabilities c USING (capability_key)
     WHERE public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
  ) THEN
    RAISE EXCEPTION 'issue3720_content_truth_promoted_entry';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM issue_3720_content_truth s
      JOIN public.product_capabilities c USING (capability_key)
     WHERE char_length(btrim(c.title)) NOT BETWEEN 4 AND 160
        OR char_length(btrim(c.outcome_summary)) NOT BETWEEN 20 AND 1000
        OR char_length(btrim(c.how_to)) NOT BETWEEN 20 AND 4000
        OR char_length(btrim(c.limitations)) NOT BETWEEN 10 AND 4000
        OR char_length(btrim(c.support_wording)) NOT BETWEEN 20 AND 4000
        OR cardinality(c.who_can_use) NOT BETWEEN 1 AND 20
        OR cardinality(c.surfaces) NOT BETWEEN 1 AND 20
        OR EXISTS (SELECT 1 FROM unnest(c.who_can_use) w WHERE char_length(btrim(w)) NOT BETWEEN 2 AND 80)
        OR EXISTS (SELECT 1 FROM unnest(c.surfaces) x WHERE char_length(btrim(x)) NOT BETWEEN 2 AND 120)
        OR c.title <> s.title
        OR c.how_to <> s.how_to
        OR c.claimed_status <> COALESCE(s.claimed_status, c.claimed_status)
  ) THEN
    RAISE EXCEPTION 'issue3720_content_truth_row_not_saved_or_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM issue_3720_content_evidence_fix f
      JOIN public.product_capabilities c USING (capability_key)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.product_capability_evidence e
        WHERE e.capability_id = c.id AND e.evidence_kind = f.kind
          AND e.is_current AND e.evidence_url = f.url AND e.verdict = 'verified'
     )
  ) THEN
    RAISE EXCEPTION 'issue3720_content_truth_evidence_fix_not_current';
  END IF;
END;
$postcheck$;

COMMIT;
