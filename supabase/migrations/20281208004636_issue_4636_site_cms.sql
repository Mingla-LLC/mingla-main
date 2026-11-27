-- Issue #4636 build 2: usemingla.com pages built from blocks, staff-made pages,
-- site-wide nav and footer, and the site media library.
--
-- Extends the #4452 site pages engine (20280712014452_issue_4452_site_pages.sql,
-- not edited): drafts with rev / PT409, append-only versions, publish PT409,
-- history, restore and one-hour preview tokens stay exactly as they are. What
-- this adds:
--
--   1. site_block_registry(): the block registry as data, a copy of
--      mingla-marketing/lib/site-blocks/registry.json. A node parity test fails
--      when the two drift (I-4636-ONE-BLOCK-REGISTRY). A registry change ships as
--      a migration that re-emits this function.
--   2. site_reserved_segments(): every first address segment the site already
--      answers (mingla-marketing/lib/site-pages/reserved-paths.json, generated
--      from app/**). Parity test: I-4636-NO-ADDRESS-COLLISION.
--   3. The block validator (site_block_errors, site_sections_errors), a port of
--      validateBlock / validatePage in mingla-marketing/lib/site-blocks/registry.ts,
--      plus what only the database knows: media library ids and live forms.
--   4. site_validate_content (re-emitted): a page may carry `sections`, an
--      ordered list of blocks {type, version, content, colour?, hidden?, id?}
--      (at most 40), on the 14 converted pages and on staff-made pages. The
--      reserved key 'site-settings' carries {nav, footer}. Every #4452 rule
--      (spot blocks, pop-up, details step, hero) is unchanged.
--   5. site_custom_pages: staff-made pages (address, name, format, SEO
--      description, share image, hide from search, show in menu, status
--      draft / live / unpublished, redirect after delete).
--   6. site_media: the media library (images in site-media, videos in a new
--      site-video bucket: MP4 only, 50 MB, at most 60 seconds). Usage is
--      measured against 5 GB: a warning at 70 %, uploads refused at 90 %
--      (enforced on storage.objects by a RESTRICTIVE policy, not only in the UI).
--   7. View-only staff (forms_can_view) can mint a preview token of the LIVE
--      content (the #4636 investigation's F-4): never the draft.
--   8. Anonymous reads: site_public_page(key) (one page, its media),
--      site_public_custom_index() (live and redirected staff-made pages), and
--      site_public_content() now leaves the block lists out (one fetch per page).
--
-- No Supabase Image Transformations anywhere (#1643): images are resized in the
-- browser and stored with a _thumb copy (I-4636-NO-IMAGE-TRANSFORMS).
--
-- ROLLBACK (manual):
--   DROP POLICY IF EXISTS issue_4636_site_media_quota ON storage.objects;
--   DROP POLICY IF EXISTS issue_4636_site_media_library_insert ON storage.objects;
--   DROP POLICY IF EXISTS issue_4636_site_video_public_read ON storage.objects;
--   DROP POLICY IF EXISTS issue_4636_site_video_editor_insert ON storage.objects;
--   DROP POLICY IF EXISTS issue_4636_site_video_editor_delete ON storage.objects;
--   DROP FUNCTION IF EXISTS public.site_public_page(text), public.site_public_custom_index(),
--     public.admin_site_media_list(text,boolean,integer), public.admin_site_media_register(uuid,text,integer,integer,numeric,text),
--     public.admin_site_media_update(uuid,text), public.admin_site_media_archive(uuid), public.admin_site_media_usage(),
--     public.site_media_upload_open(), public.site_media_usage_bytes(), public.site_media_map(jsonb),
--     public.admin_site_page_create(text,text,text,jsonb), public.admin_site_page_update_meta(text,jsonb),
--     public.admin_site_page_delete(text,text), public.site_custom_path_error(text, text),
--     public.site_settings_errors(jsonb), public.site_settings_link_errors(jsonb,text,integer),
--     public.site_sections_errors(jsonb), public.site_block_errors(jsonb,jsonb), public.site_block_object_errors(jsonb,jsonb,text),
--     public.site_block_field_errors(jsonb,jsonb,text), public.site_block_text_errors(jsonb,integer,boolean,text),
--     public.site_action_target_kind(text), public.site_converted_page_keys(), public.site_reserved_segments(),
--     public.site_block_registry();
--   Re-run the #4452 bodies of site_validate_content, site_content_changes, site_page_put_live,
--   admin_site_pages_state, admin_site_page_get, admin_site_page_history,
--   admin_site_page_create_preview_token, site_public_preview and site_public_content.
--   DROP TABLE IF EXISTS public.site_custom_pages, public.site_media;
--   (Leave the site-video bucket and its objects; delete them only with Seth's approval.)

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. The block registry and the reserved addresses (data, parity-tested)
-- ---------------------------------------------------------------------------
-- I-4636-ONE-BLOCK-REGISTRY: this literal equals mingla-marketing/lib/site-blocks/registry.json
-- (mingla-marketing/lib/__tests__/issue-4636-db-parity.implementor.test.mjs).
CREATE FUNCTION public.site_block_registry() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $registry$ SELECT $json${"registry_version":1,"colours":["paper","cream","sand","moss","night","clay"],"blocks":[{"key":"reelHero","version":1,"name":"Reel hero","description":"The big headline with one button in a ring and the curved card carousel (Home, For hosts).","category":"hero","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["paper","night"]},"fields":[{"key":"lines","kind":"list","label":"Headline lines","min":1,"max":3,"item":[],"textItem":{"max":40,"em":true}},{"key":"phrases","kind":"list","label":"Rotating phrases (shown after the first line)","min":0,"max":8,"item":[],"textItem":{"max":30}},{"key":"srTitle","kind":"text","label":"Headline for screen readers (needed with rotating phrases)","max":90,"required":false},{"key":"sub","kind":"text","label":"Line under the headline","max":220,"required":true},{"key":"cta","kind":"action","label":"Button","required":true},{"key":"cards","kind":"list","label":"Carousel cards","min":4,"max":12,"item":[{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true},{"key":"caption","kind":"text","label":"Caption","max":28,"required":true}]}]},{"key":"heroWords","version":1,"name":"Programme hero","description":"Headline, lead and two buttons (Creators, Locals).","category":"hero","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["paper"]},"fields":[{"key":"title","kind":"text","label":"Headline","max":70,"required":true},{"key":"em","kind":"text","label":"Italic end of the headline","max":40,"required":false},{"key":"lead","kind":"text","label":"Lead","max":260,"required":true},{"key":"primary","kind":"action","label":"Main button","required":true,"targets":["internal","explorer"]},{"key":"secondary","kind":"action","label":"Second button","required":true,"targets":["internal"]}]},{"key":"pageHero","version":1,"name":"Page headline","description":"A large serif headline and a lead, with optional note and buttons (About, Going out, Cities, Help, Support, Careers, Free tools).","category":"hero","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["paper"]},"fields":[{"key":"variant","kind":"enum","label":"Format","options":["plain","centred"],"required":true,"hidden":true},{"key":"title","kind":"text","label":"Headline","max":90,"required":true,"em":true},{"key":"lead","kind":"text","label":"Lead","max":260,"required":false},{"key":"note","kind":"text","label":"Small note above the buttons","max":160,"required":false},{"key":"actions","kind":"list","label":"Buttons","min":0,"max":2,"item":[{"key":"action","kind":"action","label":"Button","required":true,"targets":["internal","web","mail"]}]}]},{"key":"icpHero","version":1,"name":"Full-screen video hero","description":"Full-screen clip, two-line headline and the glass button bar (the host-type pages).","category":"hero","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["night"]},"fields":[{"key":"pillLead","kind":"text","label":"Label pill, first word","max":20,"required":true},{"key":"pill","kind":"text","label":"Label pill","max":40,"required":true},{"key":"line1","kind":"text","label":"Headline line one","max":40,"required":true},{"key":"line2","kind":"text","label":"Headline line two (italic)","max":40,"required":true},{"key":"sub","kind":"text","label":"Line under the headline","max":220,"required":true},{"key":"media","kind":"media","label":"Background clip","accept":["video","photo"],"required":true},{"key":"call","kind":"action","label":"Call button","required":true,"targets":["internal"]},{"key":"app","kind":"action","label":"App button","required":true,"targets":["host"]}]},{"key":"cityHero","version":1,"name":"City hero","description":"The city clip with \"Things to do in <City>\" and the app button. Text follows the city.","category":"hero","live":true,"wrapper":{"landingRoot":true,"city":true},"frame":"own","maxPerPage":1,"colours":{"*":["night"]},"fields":[{"key":"city","kind":"city","label":"City","required":true}]},{"key":"steps","version":1,"name":"Numbered steps","description":"Three numbered steps (Home how it works, Creators, Locals, Careers values).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":{"*":"programme","home":"own"},"colours":{"home":["paper"],"creators":["paper"],"locals":["paper"],"values":["paper"]},"fields":[{"key":"variant","kind":"enum","label":"Format","options":["home","creators","locals","values"],"required":true,"hidden":true},{"key":"heading","kind":"text","label":"Heading","max":90,"required":false,"em":true},{"key":"lead","kind":"text","label":"Lead","max":260,"required":false},{"key":"items","kind":"list","label":"Steps","min":3,"max":3,"item":[{"key":"title","kind":"text","label":"Step title","max":60,"required":true,"em":true},{"key":"body","kind":"text","label":"Step text","max":200,"required":true},{"key":"visual","kind":"enum","label":"Picture","options":["none","pills","saved","scheduled"],"required":false,"hidden":true},{"key":"words","kind":"list","label":"Picture words","min":0,"max":3,"item":[],"textItem":{"max":24}}]}]},{"key":"litAbout","version":1,"name":"Intro with lit paragraph","description":"Intro, two buttons, the wordmark and a large paragraph that lights up word by word on scroll.","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["cream"]},"fields":[{"key":"intro","kind":"text","label":"Intro","max":320,"required":true},{"key":"call","kind":"action","label":"Talk button","required":true,"targets":["internal"]},{"key":"insideLabel","kind":"text","label":"\"See what's inside\" label","max":30,"required":true},{"key":"duoA","kind":"text","label":"Before word","max":20,"required":true},{"key":"duoB","kind":"text","label":"After word","max":20,"required":true},{"key":"big","kind":"text","label":"Large paragraph","max":420,"required":true,"em":true}]},{"key":"icpFeatures","version":1,"name":"Sticky features over video","description":"A sticky left column with three section buttons beside three glass video cards, over a background clip.","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["night"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"lead","kind":"text","label":"Lead","max":200,"required":true},{"key":"background","kind":"media","label":"Background","accept":["video","photo"],"required":true},{"key":"cta","kind":"action","label":"Button","required":true,"targets":["host"]},{"key":"items","kind":"list","label":"Feature cards","min":3,"max":3,"item":[{"key":"icon","kind":"enum","label":"Icon","options":["ticket","users","mail","map","card","chat","calendar","tag","image","chart","sun"],"required":true},{"key":"title","kind":"text","label":"Title","max":40,"required":true},{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true},{"key":"body","kind":"text","label":"Text","max":220,"required":true},{"key":"tags","kind":"list","label":"Tags","min":1,"max":6,"item":[],"textItem":{"max":24}}]}]},{"key":"paras","version":1,"name":"Heading with paragraphs","description":"A heading beside a few paragraphs (About \"why\").","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"paragraphs","kind":"list","label":"Paragraphs","min":1,"max":5,"item":[],"textItem":{"max":400}}]},{"key":"answer","version":1,"name":"Direct answer","description":"One question and its plain answer, the text search and answer engines quote (About, Going out).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"question","kind":"text","label":"Question","max":120,"required":true},{"key":"answer","kind":"text","label":"Answer","max":600,"required":true}]},{"key":"facts","version":1,"name":"Fact cards","description":"Two cards with a short title and a paragraph (Locals).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"programme","colours":{"*":["paper"]},"fields":[{"key":"items","kind":"list","label":"Cards","min":2,"max":2,"item":[{"key":"title","kind":"text","label":"Title","max":60,"required":true},{"key":"body","kind":"text","label":"Text","max":400,"required":true}]}]},{"key":"toolkit","version":1,"name":"Numbered link list","description":"A heading over numbered rows, each opening a page or the Host app (For hosts toolkit).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"items","kind":"list","label":"Rows","min":2,"max":8,"item":[{"key":"title","kind":"text","label":"Title","max":40,"required":true},{"key":"line","kind":"text","label":"Line","max":140,"required":true},{"key":"action","kind":"action","label":"Opens","required":true,"targets":["internal","host"]}]}]},{"key":"chips","version":1,"name":"Who it is for","description":"A heading beside a set of chips (host-type pages).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"items","kind":"list","label":"Chips","min":2,"max":12,"item":[],"textItem":{"max":32}}]},{"key":"faq","version":1,"name":"Questions","description":"Questions that open to their answers (host-type pages, city pages).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"variant","kind":"enum","label":"Format","options":["icp","city"],"required":true,"hidden":true},{"key":"prefix","kind":"text","label":"Words before the heading (the city name)","max":40,"required":false},{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"action","kind":"action","label":"Button under the heading","required":false,"targets":["internal"]},{"key":"items","kind":"list","label":"Questions","min":1,"max":12,"item":[{"key":"question","kind":"text","label":"Question","max":140,"required":true},{"key":"answer","kind":"text","label":"Answer","max":600,"required":true}]}]},{"key":"marquee","version":1,"name":"Moving words","description":"A decorative line of words that scrolls sideways (Home).","category":"story","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"words","kind":"list","label":"Words","min":3,"max":16,"item":[],"textItem":{"max":24}}]},{"key":"tiles","version":1,"name":"Video tiles","description":"A heading and lead over a grid of clip tiles that open pages (Home audiences, For hosts host types).","category":"media","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper","night"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"lead","kind":"text","label":"Lead","max":260,"required":false},{"key":"items","kind":"list","label":"Tiles","min":2,"max":12,"item":[{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true},{"key":"title","kind":"text","label":"Title","max":40,"required":true},{"key":"line","kind":"text","label":"Line","max":120,"required":true},{"key":"lineEnd","kind":"text","label":"Line, second half","max":120,"required":false},{"key":"action","kind":"action","label":"Opens","required":true,"targets":["internal"]},{"key":"look","kind":"enum","label":"Tile look","options":["plain","tools"],"required":false,"hidden":true}]}]},{"key":"clipGrid","version":1,"name":"Four clips","description":"Four silent clips in a row (Creators).","category":"media","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"programme","colours":{"*":["paper"]},"fields":[{"key":"items","kind":"list","label":"Clips","min":4,"max":4,"item":[{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true}]}]},{"key":"wideClip","version":1,"name":"Wide clip","description":"One wide ambient clip (About).","category":"media","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true}]},{"key":"vcards","version":1,"name":"Video text cards","description":"Clip cards with the wordmark and text over an ink wash (About app cards, For hosts Ari cards).","category":"media","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"about":["cream"],"ari":["night"]},"fields":[{"key":"variant","kind":"enum","label":"Format","options":["about","ari"],"required":true,"hidden":true},{"key":"heading","kind":"text","label":"Heading","max":90,"required":false,"em":true},{"key":"lead","kind":"text","label":"Lead","max":260,"required":false},{"key":"items","kind":"list","label":"Cards","min":2,"max":4,"item":[{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true},{"key":"wordmark","kind":"text","label":"Wordmark name (screen readers)","max":30,"required":false},{"key":"title","kind":"text","label":"Title","max":60,"required":true,"em":true},{"key":"line","kind":"text","label":"Line","max":140,"required":true},{"key":"action","kind":"action","label":"Opens","required":false,"targets":["internal","explorer"]}]}]},{"key":"filterGrid","version":1,"name":"Filtered guides","description":"A row of filter chips, one wide tile and guide tiles the chips filter (Going out).","category":"media","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"chips","kind":"list","label":"Filter chips","min":2,"max":8,"item":[],"textItem":{"max":24}},{"key":"wideMedia","kind":"media","label":"Wide tile clip","accept":["video","photo"],"required":true},{"key":"wideTitle","kind":"text","label":"Wide tile title","max":60,"required":true,"em":true},{"key":"wideLine","kind":"text","label":"Wide tile line","max":120,"required":true},{"key":"wideAction","kind":"action","label":"Wide tile opens","required":true,"targets":["internal"]},{"key":"empty","kind":"text","label":"Text when a chip has no guides","max":60,"required":false},{"key":"items","kind":"list","label":"Guides","min":1,"max":12,"item":[{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true},{"key":"title","kind":"text","label":"Title","max":40,"required":true},{"key":"line","kind":"text","label":"Line","max":120,"required":true},{"key":"tags","kind":"list","label":"Chips it shows under","min":1,"max":4,"item":[],"textItem":{"max":24}},{"key":"city","kind":"city","label":"City (empty: all cities)","required":false}]}]},{"key":"videoBand","version":1,"name":"Closing video band","description":"A rounded clip band with a heading and buttons (the closing band of Home, For hosts, host types, Creators, Locals).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":{"*":"own","creators":"programme","locals":"programme"},"colours":{"*":["night"]},"fields":[{"key":"variant","kind":"enum","label":"Format","options":["plain","glass","icp","creators","locals"],"required":true,"hidden":true},{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true},{"key":"heading","kind":"text","label":"Heading","max":80,"required":true,"em":true},{"key":"body","kind":"text","label":"Text","max":260,"required":false},{"key":"bring","kind":"text","label":"Line beside the button","max":60,"required":false},{"key":"primary","kind":"action","label":"Button","required":true},{"key":"secondary","kind":"action","label":"Second button","required":false}]},{"key":"toolCard","version":1,"name":"Free tool card","description":"One free tool with its preview form (host-type pages).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"tool","kind":"enum","label":"Tool","options":["Venue Website Grader","Event Turnout Predictor","Quote Any Trip","The Undercharging Audit"],"required":true},{"key":"body","kind":"text","label":"Text","max":260,"required":true},{"key":"cta","kind":"text","label":"Button","max":30,"required":true},{"key":"fields","kind":"list","label":"Preview fields","min":1,"max":6,"item":[{"key":"label","kind":"text","label":"Label","max":30,"required":true},{"key":"input","kind":"enum","label":"Kind","options":["text","select"],"required":true,"hidden":true},{"key":"example","kind":"text","label":"Example","max":40,"required":true}]}]},{"key":"toolCards","version":1,"name":"Free tool cards","description":"A card per free tool with its clip (Free tools).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"items","kind":"list","label":"Tools","min":1,"max":4,"item":[{"key":"tool","kind":"enum","label":"Tool page","options":["/tools/venues","/tools/events","/tools/trips","/tools/pricing"],"required":true},{"key":"title","kind":"text","label":"Title","max":40,"required":true},{"key":"body","kind":"text","label":"Text","max":220,"required":true},{"key":"forWho","kind":"text","label":"Who it is for","max":60,"required":true},{"key":"cta","kind":"text","label":"Button","max":30,"required":true},{"key":"media","kind":"media","label":"Clip","accept":["video","photo"],"required":true}]}]},{"key":"promptDemo","version":1,"name":"Website prompt demo","description":"Heading, lead and button beside the \"prompt your website\" demo (For hosts).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["cream"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"lead","kind":"text","label":"Lead","max":260,"required":true},{"key":"button","kind":"text","label":"Button","max":30,"required":true}]},{"key":"getApp","version":1,"name":"Get the app","description":"The Mingla / Mingla Host toggle with QR codes and store buttons (Download).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["paper"]},"fields":[{"key":"explorerTitle","kind":"text","label":"Mingla headline","max":40,"required":true,"em":true},{"key":"explorerLead","kind":"text","label":"Mingla lead","max":160,"required":true},{"key":"hostTitle","kind":"text","label":"Mingla Host headline","max":40,"required":true,"em":true},{"key":"hostLead","kind":"text","label":"Mingla Host lead","max":160,"required":true},{"key":"media","kind":"media","label":"Phone clip","accept":["video","photo"],"required":true}]},{"key":"quickLinks","version":1,"name":"Quick links","description":"A row of link cards and a note (Support).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"heading","kind":"text","label":"Heading (screen readers)","max":60,"required":true},{"key":"items","kind":"list","label":"Links","min":1,"max":8,"item":[{"key":"action","kind":"action","label":"Link","required":true,"targets":["internal"]}]},{"key":"note","kind":"text","label":"Note","max":200,"required":false}]},{"key":"stillStuck","version":1,"name":"Contact card","description":"A card with a heading, a line and two buttons (Help \"Still stuck?\").","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":60,"required":true,"em":true},{"key":"lead","kind":"text","label":"Lead","max":200,"required":true},{"key":"primary","kind":"action","label":"Main button","required":true,"targets":["internal","web","mail"]},{"key":"secondary","kind":"action","label":"Second button","required":true,"targets":["internal","web","mail"]}]},{"key":"finePrint","version":1,"name":"Fine print","description":"One small line with a link (Creators, Locals agreement line).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"programme","colours":{"*":["paper"]},"fields":[{"key":"before","kind":"text","label":"Text before the link","max":120,"required":true},{"key":"link","kind":"action","label":"Link","required":true,"targets":["internal"]},{"key":"after","kind":"text","label":"Text after the link","max":120,"required":true}]},{"key":"form","version":1,"name":"Form","description":"A published form from Forms (#4452).","category":"action","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"formId","kind":"text","label":"Form","max":64,"required":true},{"key":"heading","kind":"text","label":"Heading","max":60,"required":false},{"key":"em","kind":"text","label":"Italic end of the heading","max":40,"required":false},{"key":"sub","kind":"text","label":"Line under the heading","max":160,"required":false}]},{"key":"buttons","version":1,"name":"Buttons","description":"One or two buttons in a row (#4452).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"items","kind":"list","label":"Buttons","min":1,"max":2,"item":[{"key":"action","kind":"action","label":"Button","required":true}]}]},{"key":"banner","version":1,"name":"Banner","description":"A one-line banner with a button, optionally until a date (#4452).","category":"action","live":false,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"text","kind":"text","label":"Text","max":140,"required":true},{"key":"button","kind":"text","label":"Button","max":30,"required":true},{"key":"action","kind":"action","label":"Opens","required":true},{"key":"showUntil","kind":"text","label":"Show until (YYYY-MM-DD)","max":10,"required":false}]},{"key":"citiesRow","version":1,"name":"Live cities","description":"Every live Mingla city as a clip tile, A to Z (Home row, Cities page). The list stays live.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"home":["paper"],"index":["paper"]},"fields":[{"key":"variant","kind":"enum","label":"Format","options":["home","index"],"required":true,"hidden":true},{"key":"heading","kind":"text","label":"Heading","max":90,"required":false,"em":true},{"key":"action","kind":"action","label":"Button","required":false,"targets":["internal"]}]},{"key":"cityLinks","version":1,"name":"City links","description":"One \"Things to do in <City>\" link per live city (Going out).","category":"live","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true},{"key":"prefix","kind":"text","label":"Link text before the city name","max":40,"required":true}]},{"key":"cityWeekend","version":1,"name":"This weekend","description":"The city's live weekend plans with Events / Experiences / Places chips.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":true},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"city","kind":"city","label":"City","required":true}]},{"key":"topPlaces","version":1,"name":"Top places","description":"The city's ranked places with their detail sheet.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":true},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"city","kind":"city","label":"City","required":true}]},{"key":"cityPlans","version":1,"name":"City plans","description":"The moss \"More than one mode.\" band with the city's ready-made plans.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":true},"frame":"own","colours":{"*":["moss"]},"fields":[{"key":"city","kind":"city","label":"City","required":true},{"key":"heading","kind":"text","label":"Heading","max":90,"required":true,"em":true}]},{"key":"cityHostBand","version":1,"name":"City host band","description":"\"Run a place in <City>?\" with the Mingla Host button.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":true},"frame":"own","colours":{"*":["paper"]},"fields":[{"key":"city","kind":"city","label":"City","required":true}]},{"key":"blogStories","version":1,"name":"Blog stories","description":"The latest blog stories with category tabs and load more. The stories stay live.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["paper"]},"fields":[{"key":"title","kind":"text","label":"Headline","max":60,"required":true,"em":true},{"key":"lede","kind":"text","label":"Lead","max":200,"required":true}]},{"key":"helpVideos","version":1,"name":"Help videos","description":"The help centre search, chips and video cards. The videos stay live.","category":"live","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["paper"]},"fields":[]},{"key":"openRoles","version":1,"name":"Open roles","description":"The live open roles, or \"No open roles right now.\" (Careers).","category":"live","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"programme","maxPerPage":1,"colours":{"*":["paper"]},"fields":[]},{"key":"scheduler","version":1,"name":"Book a call","description":"The live booking calendar (Schedule).","category":"live","live":true,"wrapper":{"landingRoot":true,"city":false},"frame":"own","maxPerPage":1,"colours":{"*":["night"]},"fields":[]}]}$json$::jsonb $registry$;

-- I-4636-NO-ADDRESS-COLLISION: this list equals mingla-marketing/lib/site-pages/reserved-paths.json,
-- which scripts/issue-4636-reserved-paths.mjs builds from the coded routes.
CREATE FUNCTION public.site_reserved_segments() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $reserved$ SELECT ARRAY(SELECT jsonb_array_elements_text($json${"segments":["_next","about","admin","api","apple-icon","apply","assets","auth","blog","board","brand","business","c","careers","careers-not-found","chat","cities","claim","creator-agreement","creators","delete-account","download","edit","event-preview","explorer","favicon","feed","fonts","going-out","help","home","home-page-cards","host","icon","index","indexnow-key.txt","intent-preview","internal","invite","links","local-agreement","locals","login","logout","m","manifest","marketing","new","og","opengraph-image","orders","organiser-terms","organisers","p","page","pages","preview","privacy-policy","product-proof","r","robots","rss","s","schedule","search","share","signature","signature.html","site-manifest","site-manifest.json","site-preview","sitemap","sms-terms","static","support","terms-of-service","tools","trip-preview","twitter-image","unsubscribe","venue-preview","well-known"]}$json$::jsonb->'segments')) $reserved$;

-- The 14 pages whose sections are blocks (mingla-marketing/lib/site-pages/converted.ts).
CREATE FUNCTION public.site_converted_page_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT ARRAY['home','host','creators','locals','about','going-out','download',
                   'events','trips','experiences','restaurants','hotels','art','play']::text[] $$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.site_media (
  id               uuid PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('image', 'video')),
  bucket           text NOT NULL CHECK (bucket IN ('site-media', 'site-video')),
  path             text NOT NULL UNIQUE CHECK (path ~ '^library/[0-9a-f-]{36}\.(jpg|mp4)$'),
  thumb_path       text NOT NULL CHECK (thumb_path ~ '^library/[0-9a-f-]{36}_(thumb|poster)\.jpg$'),
  bytes            bigint NOT NULL CHECK (bytes > 0),
  thumb_bytes      bigint NOT NULL DEFAULT 0 CHECK (thumb_bytes >= 0),
  width            integer NOT NULL CHECK (width BETWEEN 1 AND 20000),
  height           integer NOT NULL CHECK (height BETWEEN 1 AND 20000),
  duration_seconds numeric(6,2) CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 60)),
  alt              text NOT NULL CHECK (length(btrim(alt)) BETWEEN 1 AND 200 AND alt !~ E'[<>\\x01-\\x1F\\x7F]'),
  uploaded_by      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  CHECK ((kind = 'video') = (duration_seconds IS NOT NULL)),
  CHECK ((kind = 'video') = (bucket = 'site-video'))
);
CREATE INDEX site_media_created_idx ON public.site_media (created_at DESC);

CREATE TABLE public.site_custom_pages (
  page_key          text PRIMARY KEY CHECK (page_key ~ '^p-[0-9a-f]{12}$'),
  path              text NOT NULL UNIQUE CHECK (length(path) <= 80
                      AND path ~ '^/[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)?$'),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 70 AND name !~ E'[<>\\x01-\\x1F\\x7F]'),
  format            text NOT NULL CHECK (format IN ('landing', 'host-type', 'programme', 'story', 'blank')),
  seo_description   text CHECK (seo_description IS NULL OR (length(btrim(seo_description)) BETWEEN 1 AND 160
                      AND seo_description !~ E'[<>\\x01-\\x1F\\x7F]')),
  share_media_id    uuid REFERENCES public.site_media(id) ON DELETE SET NULL,
  hide_from_search  boolean NOT NULL DEFAULT false,
  show_in_menu      boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'unpublished')),
  redirect_to       text CHECK (redirect_to IS NULL OR (length(redirect_to) <= 200
                      AND redirect_to ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND redirect_to !~ '^//' AND strpos(redirect_to, '..') = 0)),
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'unpublished') = (redirect_to IS NOT NULL))
);

ALTER TABLE public.site_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_custom_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_media, public.site_custom_pages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.site_media, public.site_custom_pages TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The block validator (port of lib/site-blocks/registry.ts validateBlock / validatePage)
-- ---------------------------------------------------------------------------
-- Where an action may go: 'internal' | 'web' | 'mail' | 'explorer' | 'host', or NULL.
CREATE FUNCTION public.site_action_target_kind(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p IS NULL OR length(p) > 300 THEN NULL
    WHEN p = 'app:explorer' THEN 'explorer'
    WHEN p = 'app:host' THEN 'host'
    WHEN p ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND p !~ '^//' AND strpos(p, '..') = 0 THEN 'internal'
    WHEN p ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]<>"'']*)?$' THEN 'web'
    WHEN p ~ '^mailto:[^[:space:]<>"''@]+@[^[:space:]<>"''@]+$' THEN 'mail'
    ELSE NULL END
$$;

-- Plain words: no HTML; `*italic*` only where allowed and balanced. Returns a jsonb array of messages.
CREATE FUNCTION public.site_block_text_errors(p jsonb, p_max integer, p_em boolean, p_at text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v text;
  v_stars integer;
  e jsonb := '[]'::jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'string' THEN RETURN jsonb_build_array(p_at || ': must be text'); END IF;
  v := p #>> '{}';
  IF v ~ '^[[:space:]]*$' THEN e := e || to_jsonb(p_at || ': is empty'); END IF;
  IF length(v) > p_max THEN e := e || to_jsonb(format('%s: longer than %s characters', p_at, p_max)); END IF;
  IF v ~ '[<>]' THEN e := e || to_jsonb(p_at || ': contains < or >'); END IF;
  v_stars := length(v) - length(replace(v, '*', ''));
  IF NOT p_em AND v_stars > 0 THEN e := e || to_jsonb(p_at || ': italic markup is not allowed here'); END IF;
  IF p_em AND v_stars % 2 <> 0 THEN e := e || to_jsonb(p_at || ': unbalanced *italic* markup'); END IF;
  RETURN e;
END;
$fn$;

CREATE FUNCTION public.site_block_field_errors(p_field jsonb, p_value jsonb, p_at text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_kind text := p_field->>'kind';
  v_required boolean;
  v text;
  v_target text;
  v_i integer;
  v_n integer;
  v_media_kind text;
  v_media_archived timestamptz;
  e jsonb := '[]'::jsonb;
BEGIN
  v_required := CASE WHEN v_kind = 'list' THEN (p_field->>'min')::integer > 0
                     ELSE COALESCE(p_field->>'required', 'true') <> 'false' END;
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN CASE WHEN v_required THEN jsonb_build_array(p_at || ': missing') ELSE '[]'::jsonb END;
  END IF;
  CASE v_kind
  WHEN 'text' THEN
    RETURN public.site_block_text_errors(p_value, (p_field->>'max')::integer, COALESCE((p_field->>'em')::boolean, false), p_at);
  WHEN 'media' THEN
    v := CASE WHEN jsonb_typeof(p_value) = 'string' THEN p_value #>> '{}' ELSE NULL END;
    IF v IS NULL OR NOT (v ~ '^(v|p):[a-z0-9][a-z0-9-]{0,60}$'
                         OR v ~ '^m:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RETURN jsonb_build_array(p_at || ': not a media reference');
    END IF;
    IF v LIKE 'v:%' AND NOT (p_field->'accept') ? 'video' THEN e := e || to_jsonb(p_at || ': a clip is not allowed here'); END IF;
    IF v LIKE 'p:%' AND NOT (p_field->'accept') ? 'photo' THEN e := e || to_jsonb(p_at || ': a photo is not allowed here'); END IF;
    IF v LIKE 'm:%' THEN
      -- Only the database knows the library: the item must exist and not be archived.
      SELECT m.kind, m.archived_at INTO v_media_kind, v_media_archived FROM public.site_media m WHERE m.id = substr(v, 3)::uuid;
      IF NOT FOUND OR v_media_archived IS NOT NULL THEN
        e := e || to_jsonb(p_at || ': not in the media library');
      ELSIF v_media_kind = 'video' AND NOT (p_field->'accept') ? 'video' THEN
        e := e || to_jsonb(p_at || ': a clip is not allowed here');
      ELSIF v_media_kind = 'image' AND NOT (p_field->'accept') ? 'photo' THEN
        e := e || to_jsonb(p_at || ': a photo is not allowed here');
      END IF;
    END IF;
    RETURN e;
  WHEN 'action' THEN
    IF jsonb_typeof(p_value) <> 'object' THEN RETURN jsonb_build_array(p_at || ': must be { label, to }'); END IF;
    SELECT e || COALESCE(jsonb_agg(to_jsonb(p_at || '.' || k || ': unknown')), '[]'::jsonb) INTO e
      FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('label', 'to', 'track');
    v := CASE WHEN jsonb_typeof(p_value->'to') = 'string' THEN p_value->>'to' ELSE NULL END;
    v_target := public.site_action_target_kind(v);
    IF v_target IS NULL THEN
      e := e || to_jsonb(p_at || '.to: not an internal path, https link, email or app');
    ELSIF p_field ? 'targets' AND NOT (p_field->'targets') ? v_target THEN
      e := e || to_jsonb(format('%s.to: a %s destination is not allowed here', p_at, v_target));
    END IF;
    IF p_value ? 'label' THEN e := e || public.site_block_text_errors(p_value->'label', 40, false, p_at || '.label'); END IF;
    IF NOT p_value ? 'label' AND v IS DISTINCT FROM 'app:explorer' AND v IS DISTINCT FROM 'app:host' THEN
      e := e || to_jsonb(p_at || '.label: needed for a link');
    END IF;
    IF p_value ? 'track' AND (jsonb_typeof(p_value->'track') <> 'string' OR p_value->>'track' !~ '^[a-z0-9_]{1,40}$') THEN
      e := e || to_jsonb(p_at || '.track: invalid');
    END IF;
    RETURN e;
  WHEN 'enum' THEN
    IF jsonb_typeof(p_value) <> 'string' OR NOT (p_field->'options') ? (p_value #>> '{}') THEN
      RETURN jsonb_build_array(p_at || ': not one of the options');
    END IF;
    RETURN e;
  WHEN 'city' THEN
    IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}') !~ '^[a-z0-9][a-z0-9-]{0,40}$' THEN
      RETURN jsonb_build_array(p_at || ': not a city');
    END IF;
    RETURN e;
  WHEN 'list' THEN
    IF jsonb_typeof(p_value) <> 'array' THEN RETURN jsonb_build_array(p_at || ': must be a list'); END IF;
    v_n := jsonb_array_length(p_value);
    IF v_n < (p_field->>'min')::integer THEN e := e || to_jsonb(format('%s: needs at least %s', p_at, p_field->>'min')); END IF;
    IF v_n > (p_field->>'max')::integer THEN e := e || to_jsonb(format('%s: at most %s', p_at, p_field->>'max')); END IF;
    FOR v_i IN 0 .. v_n - 1 LOOP
      IF jsonb_typeof(p_field->'textItem') = 'object' THEN
        e := e || public.site_block_text_errors(p_value->v_i, (p_field->'textItem'->>'max')::integer,
                                                COALESCE((p_field->'textItem'->>'em')::boolean, false), format('%s[%s]', p_at, v_i));
      ELSIF jsonb_typeof(p_value->v_i) <> 'object' THEN
        e := e || to_jsonb(format('%s[%s]: must be an object', p_at, v_i));
      ELSE
        e := e || public.site_block_object_errors(p_field->'item', p_value->v_i, format('%s[%s]', p_at, v_i));
      END IF;
    END LOOP;
    RETURN e;
  ELSE
    RETURN jsonb_build_array(format('%s: unknown field kind %s', p_at, v_kind));
  END CASE;
END;
$fn$;

CREATE FUNCTION public.site_block_object_errors(p_fields jsonb, p_value jsonb, p_at text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  e jsonb := '[]'::jsonb;
  f jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(p_at || '.' || k || ': unknown field')), '[]'::jsonb) INTO e
    FROM jsonb_object_keys(p_value) k
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fields) x WHERE x->>'key' = k);
  FOR f IN SELECT x FROM jsonb_array_elements(p_fields) x LOOP
    e := e || public.site_block_field_errors(f, p_value->(f->>'key'), p_at || '.' || (f->>'key'));
  END LOOP;
  RETURN e;
END;
$fn$;

-- One block against the registry: a jsonb array of messages (empty = valid).
CREATE FUNCTION public.site_block_errors(p_block jsonb, p_registry jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  e jsonb := '[]'::jsonb;
  v_def jsonb;
  v_variant text;
  v_allowed jsonb;
BEGIN
  IF p_block IS NULL OR jsonb_typeof(p_block) <> 'object' THEN RETURN jsonb_build_array('block: must be an object'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb('block.' || k || ': unknown')), '[]'::jsonb) INTO e
    FROM jsonb_object_keys(p_block) k WHERE k NOT IN ('type', 'version', 'content', 'colour', 'hidden', 'id');
  SELECT b INTO v_def FROM jsonb_array_elements(p_registry->'blocks') b
   WHERE jsonb_typeof(p_block->'type') = 'string' AND b->>'key' = p_block->>'type';
  IF v_def IS NULL THEN RETURN jsonb_build_array(format('block.type: unknown block "%s"', COALESCE(p_block->>'type', 'undefined'))); END IF;
  IF jsonb_typeof(p_block->'version') IS DISTINCT FROM 'number'
     OR (p_block->>'version')::numeric <> trunc((p_block->>'version')::numeric) OR (p_block->>'version')::numeric < 1 THEN
    e := e || to_jsonb('block.version: must be a whole number'::text);
  ELSIF (p_block->>'version')::numeric > (v_def->>'version')::numeric THEN
    e := e || to_jsonb(format('block.version: %s is newer than this site knows (%s)', p_block->>'version', v_def->>'version'));
  END IF;
  IF p_block ? 'hidden' AND jsonb_typeof(p_block->'hidden') <> 'boolean' THEN
    e := e || to_jsonb('block.hidden: must be true or false'::text);
  END IF;
  IF p_block ? 'id' AND (jsonb_typeof(p_block->'id') <> 'string' OR p_block->>'id' !~ '^[A-Za-z0-9_-]{1,64}$') THEN
    e := e || to_jsonb('block.id: must be 1-64 letters, digits, - or _'::text);
  END IF;
  IF jsonb_typeof(p_block->'content') IS DISTINCT FROM 'object' THEN
    RETURN e || to_jsonb('block.content: must be an object'::text);
  END IF;
  e := e || public.site_block_object_errors(v_def->'fields', p_block->'content', v_def->>'key');
  IF p_block ? 'colour' THEN
    v_variant := CASE WHEN jsonb_typeof(p_block->'content'->'variant') = 'string' THEN p_block->'content'->>'variant' END;
    v_allowed := COALESCE(CASE WHEN v_variant IS NOT NULL THEN v_def->'colours'->v_variant END,
                          v_def->'colours'->'*',
                          (SELECT x FROM jsonb_each(v_def->'colours') AS t(k, x) LIMIT 1),
                          '[]'::jsonb);
    IF jsonb_typeof(p_block->'colour') <> 'string' OR NOT v_allowed ? (p_block->>'colour') THEN
      e := e || to_jsonb(format('block.colour: "%s" is not available for %s', p_block->>'colour', v_def->>'key'));
    END IF;
  END IF;
  RETURN e;
END;
$fn$;

-- A page's block list: at most 40, each block valid, per-page limits, live forms only.
-- Returns #4452-shaped errors: [{path, code, message?}].
CREATE FUNCTION public.site_sections_errors(p_sections jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_reg jsonb := public.site_block_registry();
  v_err jsonb := '[]'::jsonb;
  v_i integer;
  v_b jsonb;
  v_msg jsonb;
  v_row record;
BEGIN
  IF p_sections IS NULL OR jsonb_typeof(p_sections) <> 'array' THEN
    RETURN jsonb_build_array(jsonb_build_object('path', 'sections', 'code', 'bad_sections'));
  END IF;
  IF jsonb_array_length(p_sections) > 40 THEN
    v_err := v_err || jsonb_build_object('path', 'sections', 'code', 'too_many_blocks', 'message', 'page: at most 40 blocks');
  END IF;
  FOR v_i IN 0 .. LEAST(jsonb_array_length(p_sections), 60) - 1 LOOP
    v_b := p_sections->v_i;
    FOR v_msg IN SELECT x FROM jsonb_array_elements(public.site_block_errors(v_b, v_reg)) x LOOP
      v_err := v_err || jsonb_build_object('path', format('sections[%s]', v_i), 'code', 'invalid_block', 'message', v_msg #>> '{}');
    END LOOP;
    -- A form block needs a form that exists and is not archived (the registry only knows the shape).
    IF v_b->>'type' = 'form' AND jsonb_typeof(v_b->'content') = 'object' THEN
      IF COALESCE(v_b->'content'->>'formId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.id = (v_b->'content'->>'formId')::uuid AND f.status <> 'archived') THEN
        v_err := v_err || jsonb_build_object('path', format('sections[%s].content.formId', v_i), 'code', 'bad_form');
      END IF;
    END IF;
  END LOOP;
  FOR v_row IN
    SELECT b->>'type' AS t, count(*) AS n FROM jsonb_array_elements(p_sections) b
     WHERE jsonb_typeof(b) = 'object' AND jsonb_typeof(b->'type') = 'string' GROUP BY b->>'type'
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_reg->'blocks') d
                WHERE d->>'key' = v_row.t AND d ? 'maxPerPage' AND v_row.n > (d->>'maxPerPage')::integer) THEN
      v_err := v_err || jsonb_build_object('path', 'sections', 'code', 'over_page_limit',
                                           'message', format('page: %s over its per-page limit', v_row.t));
    END IF;
  END LOOP;
  RETURN v_err;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Site-wide nav and footer ('site-settings')
-- ---------------------------------------------------------------------------
-- {label, to}: plain words (no markup) and an internal path, https link or email.
CREATE FUNCTION public.site_settings_link_errors(p jsonb, p_at text, p_max integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  e jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_array(p_at || ': must be { label, to }'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p_at || '.' || k || ': unknown')), '[]'::jsonb) INTO e
    FROM jsonb_object_keys(p) k WHERE k NOT IN ('label', 'to');
  e := e || public.site_block_text_errors(p->'label', p_max, false, p_at || '.label');
  IF jsonb_typeof(p->'to') IS DISTINCT FROM 'string'
     OR COALESCE(public.site_action_target_kind(p->>'to'), 'x') NOT IN ('internal', 'web', 'mail') THEN
    e := e || to_jsonb(p_at || '.to: not an internal path, https link or email');
  END IF;
  RETURN e;
END;
$fn$;

-- nav:    { top: [link] 1..6, menu: [{ title, links: [link] 1..12 }] 1..4 }
-- footer: { columns: [{ title, links: [link] 1..6 }] 1..4, tagline? }
-- Either may be absent (that part stays as coded).
CREATE FUNCTION public.site_settings_errors(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $fn$
DECLARE
  v_err jsonb := '[]'::jsonb;
  v_msgs jsonb := '[]'::jsonb;
  v_nav jsonb := p->'nav';
  v_foot jsonb := p->'footer';
  v_i integer;
  v_j integer;
  v_g jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('path', '', 'code', 'not_object'));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('nav', 'footer')) THEN
    v_err := v_err || jsonb_build_object('path', '', 'code', 'unknown_key');
  END IF;
  IF v_nav IS NOT NULL AND jsonb_typeof(v_nav) <> 'null' THEN
    IF jsonb_typeof(v_nav) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_nav) k WHERE k NOT IN ('top', 'menu'))
       OR jsonb_typeof(v_nav->'top') IS DISTINCT FROM 'array' OR jsonb_array_length(v_nav->'top') NOT BETWEEN 1 AND 6
       OR jsonb_typeof(v_nav->'menu') IS DISTINCT FROM 'array' OR jsonb_array_length(v_nav->'menu') NOT BETWEEN 1 AND 4 THEN
      v_msgs := v_msgs || to_jsonb('nav: needs 1-6 top links and 1-4 menu groups'::text);
    ELSE
      FOR v_i IN 0 .. jsonb_array_length(v_nav->'top') - 1 LOOP
        v_msgs := v_msgs || public.site_settings_link_errors(v_nav->'top'->v_i, format('nav.top[%s]', v_i), 24);
      END LOOP;
      FOR v_i IN 0 .. jsonb_array_length(v_nav->'menu') - 1 LOOP
        v_g := v_nav->'menu'->v_i;
        IF jsonb_typeof(v_g) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_g) k WHERE k NOT IN ('title', 'links'))
           OR jsonb_typeof(v_g->'links') IS DISTINCT FROM 'array' OR jsonb_array_length(v_g->'links') NOT BETWEEN 1 AND 12 THEN
          v_msgs := v_msgs || to_jsonb(format('nav.menu[%s]: needs a title and 1-12 links', v_i));
          CONTINUE;
        END IF;
        v_msgs := v_msgs || public.site_block_text_errors(v_g->'title', 24, false, format('nav.menu[%s].title', v_i));
        FOR v_j IN 0 .. jsonb_array_length(v_g->'links') - 1 LOOP
          v_msgs := v_msgs || public.site_settings_link_errors(v_g->'links'->v_j, format('nav.menu[%s].links[%s]', v_i, v_j), 40);
        END LOOP;
      END LOOP;
    END IF;
  END IF;
  IF v_foot IS NOT NULL AND jsonb_typeof(v_foot) <> 'null' THEN
    IF jsonb_typeof(v_foot) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_foot) k WHERE k NOT IN ('columns', 'tagline'))
       OR jsonb_typeof(v_foot->'columns') IS DISTINCT FROM 'array' OR jsonb_array_length(v_foot->'columns') NOT BETWEEN 1 AND 4 THEN
      v_msgs := v_msgs || to_jsonb('footer: needs 1-4 columns'::text);
    ELSE
      FOR v_i IN 0 .. jsonb_array_length(v_foot->'columns') - 1 LOOP
        v_g := v_foot->'columns'->v_i;
        IF jsonb_typeof(v_g) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_g) k WHERE k NOT IN ('title', 'links'))
           OR jsonb_typeof(v_g->'links') IS DISTINCT FROM 'array' OR jsonb_array_length(v_g->'links') NOT BETWEEN 1 AND 6 THEN
          v_msgs := v_msgs || to_jsonb(format('footer.columns[%s]: needs a title and 1-6 links', v_i));
          CONTINUE;
        END IF;
        v_msgs := v_msgs || public.site_block_text_errors(v_g->'title', 24, false, format('footer.columns[%s].title', v_i));
        FOR v_j IN 0 .. jsonb_array_length(v_g->'links') - 1 LOOP
          v_msgs := v_msgs || public.site_settings_link_errors(v_g->'links'->v_j, format('footer.columns[%s].links[%s]', v_i, v_j), 40);
        END LOOP;
      END LOOP;
      IF v_foot ? 'tagline' THEN
        v_msgs := v_msgs || public.site_block_text_errors(v_foot->'tagline', 80, false, 'footer.tagline');
      END IF;
    END IF;
  END IF;
  SELECT v_err || COALESCE(jsonb_agg(jsonb_build_object('path', 'settings', 'code', 'bad_settings', 'message', m #>> '{}')), '[]'::jsonb)
    INTO v_err FROM jsonb_array_elements(v_msgs) m;
  RETURN v_err;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. site_validate_content (re-emitted: the #4452 rules plus sections and settings)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.site_validate_content(p_page_key text, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_err   jsonb := '[]'::jsonb;
  v_b     jsonb;
  v_i     integer;
  v_p     text;
  v_spots text[] := ARRAY[]::text[];
  v_ids   text[] := ARRAY[]::text[];
  v_popups integer := 0;
  v_type  text;
  v_spot  text;
  v_tpl   text;
  v_pu    jsonb;
  v_hero  jsonb;
  v_host  boolean := p_page_key IN ('events','trips','experiences','restaurants','hotels','art','play','host-template');
  v_custom boolean := false;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('path', '', 'code', 'not_object')));
  END IF;
  -- #4636: the site-wide nav and footer.
  IF p_page_key = 'site-settings' THEN
    v_err := public.site_settings_errors(p);
    RETURN jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'errors', v_err);
  END IF;
  -- #4636: a staff-made page exists before it has content.
  IF p_page_key ~ '^p-' THEN
    v_custom := EXISTS (SELECT 1 FROM public.site_custom_pages c WHERE c.page_key = p_page_key);
    IF NOT v_custom THEN v_err := v_err || jsonb_build_object('path', '', 'code', 'unknown_page'); END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('blocks','hero','sections')) THEN
    v_err := v_err || jsonb_build_object('path', '', 'code', 'unknown_key');
  END IF;
  -- #4636: the page as an ordered block list, on converted and staff-made pages only.
  IF p ? 'sections' THEN
    IF NOT (p_page_key = ANY (public.site_converted_page_keys()) OR v_custom) THEN
      v_err := v_err || jsonb_build_object('path', 'sections', 'code', 'sections_not_editable');
    ELSE
      v_err := v_err || public.site_sections_errors(p->'sections');
    END IF;
  END IF;
  -- The #4452 spot blocks (required unless the page carries sections).
  IF p ? 'blocks' OR NOT p ? 'sections' THEN
  IF jsonb_typeof(p->'blocks') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'blocks') > 20 THEN
    v_err := v_err || jsonb_build_object('path', 'blocks', 'code', 'bad_blocks');
  ELSE
    FOR v_i IN 0 .. jsonb_array_length(p->'blocks') - 1 LOOP
      v_b := p->'blocks'->v_i;
      v_p := format('blocks[%s]', v_i);
      IF jsonb_typeof(v_b) <> 'object' THEN
        v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_block'); CONTINUE;
      END IF;
      v_type := v_b->>'type';
      v_spot := v_b->>'spot';
      IF COALESCE(v_b->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (v_b->>'id') = ANY (v_ids) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.id', 'code', 'bad_id');
      ELSE
        v_ids := v_ids || (v_b->>'id');
      END IF;
      IF v_type IS NULL OR v_type NOT IN ('form','buttons','banner','popup') THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.type', 'code', 'bad_type'); CONTINUE;
      END IF;
      IF v_spot IS NULL OR (v_spot !~ '^[a-z0-9-]{2,48}$') THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'bad_spot'); CONTINUE;
      END IF;
      IF (v_type = 'popup') <> (v_spot = 'popup') THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'popup_spot');
      END IF;
      IF v_spot = 'details-step' THEN
        IF p_page_key <> 'schedule' OR v_type <> 'form' THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'details_step_schedule_only');
        END IF;
      END IF;
      IF v_spot = ANY (v_spots) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.spot', 'code', 'spot_taken');
      ELSE
        v_spots := v_spots || v_spot;
      END IF;
      IF v_type = 'popup' THEN v_popups := v_popups + 1; END IF;
      IF v_b ? 'all_host_pages' AND (jsonb_typeof(v_b->'all_host_pages') <> 'boolean'
           OR (v_b->'all_host_pages' = 'true'::jsonb AND NOT v_host)) THEN
        v_err := v_err || jsonb_build_object('path', v_p || '.all_host_pages', 'code', 'not_template_page');
      END IF;
      IF v_type IN ('form','popup') THEN
        IF COALESCE(v_b->>'form_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'bad_form');
        ELSE
          SELECT f.template INTO v_tpl FROM public.forms f WHERE f.id = (v_b->>'form_id')::uuid;
          IF NOT FOUND THEN
            v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'bad_form');
          ELSIF v_spot = 'details-step' AND v_tpl IS DISTINCT FROM 'book_call_extra' THEN
            v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'details_step_form');
          ELSIF v_spot <> 'details-step' AND v_tpl = 'book_call_extra' THEN
            v_err := v_err || jsonb_build_object('path', v_p || '.form_id', 'code', 'details_form_elsewhere');
          END IF;
        END IF;
        IF NOT public.site_plain_ok(v_b->'head', 32, true) OR NOT public.site_plain_ok(v_b->'em', 24, true)
           OR NOT public.site_plain_ok(v_b->'sub', 90, true) THEN
          v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_text');
        END IF;
      END IF;
      IF v_type = 'popup' THEN
        v_pu := v_b->'popup';
        IF jsonb_typeof(v_pu) IS DISTINCT FROM 'object'
           OR COALESCE(v_pu->>'trigger', '') NOT IN ('scroll_half','after_20s','exit_intent','button_only')
           OR COALESCE(v_pu->>'freq', '') NOT IN ('weekly','visit','every_view')
           OR COALESCE(v_pu->>'devices', '') NOT IN ('all','phone','desktop')
           OR COALESCE(v_pu->>'style', '') NOT IN ('centre','side') THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.popup', 'code', 'bad_popup');
        END IF;
      END IF;
      IF v_type = 'buttons' THEN
        IF jsonb_typeof(v_b->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(v_b->'buttons') NOT BETWEEN 1 AND 2
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_b->'buttons') x
                       WHERE NOT public.site_plain_ok(x->'text', 28, false) OR NOT public.site_valid_dest(x->'to')) THEN
          v_err := v_err || jsonb_build_object('path', v_p || '.buttons', 'code', 'bad_buttons');
        END IF;
      END IF;
      IF v_type = 'banner' THEN
        IF NOT public.site_plain_ok(v_b->'text', 60, false) OR NOT public.site_plain_ok(v_b->'btn', 24, false)
           OR NOT COALESCE(public.site_valid_dest(v_b->'to'), false)
           OR (v_b ? 'show_until' AND jsonb_typeof(v_b->'show_until') <> 'null'
               AND NOT public.forms_real_date(v_b->>'show_until')) THEN
          v_err := v_err || jsonb_build_object('path', v_p, 'code', 'bad_banner');
        END IF;
      END IF;
    END LOOP;
  END IF;
  END IF;
  IF v_popups > 1 THEN v_err := v_err || jsonb_build_object('path', 'blocks', 'code', 'one_popup'); END IF;

  v_hero := p->'hero';
  IF v_hero IS NOT NULL AND jsonb_typeof(v_hero) <> 'null' THEN
    IF p_page_key NOT IN ('creators','locals') THEN
      v_err := v_err || jsonb_build_object('path', 'hero', 'code', 'hero_not_editable');
    ELSIF jsonb_typeof(v_hero) <> 'object'
       OR NOT public.site_plain_ok(v_hero->'h1', 48, false) OR NOT public.site_plain_ok(v_hero->'em', 24, true)
       OR NOT public.site_plain_ok(v_hero->'lead', 200, true)
       OR jsonb_typeof(v_hero->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(v_hero->'buttons') <> 2
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_hero->'buttons') x
                   WHERE NOT public.site_plain_ok(x->'text', 28, false) OR NOT public.site_valid_dest(x->'to')) THEN
      v_err := v_err || jsonb_build_object('path', 'hero', 'code', 'bad_hero');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', jsonb_array_length(v_err) = 0, 'errors', v_err);
END;
$fn$;

-- The number of things that differ between two contents: spot blocks (as a set), block-list
-- positions, plus 1 each for a hero, nav or footer change.
CREATE OR REPLACE FUNCTION public.site_content_changes(p_a jsonb, p_b jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT (SELECT count(*)::integer FROM (
            (SELECT x FROM jsonb_array_elements(COALESCE(p_a->'blocks', '[]'::jsonb)) x
             EXCEPT SELECT y FROM jsonb_array_elements(COALESCE(p_b->'blocks', '[]'::jsonb)) y)
            UNION ALL
            (SELECT y FROM jsonb_array_elements(COALESCE(p_b->'blocks', '[]'::jsonb)) y
             EXCEPT SELECT x FROM jsonb_array_elements(COALESCE(p_a->'blocks', '[]'::jsonb)) x)) d)
       + (SELECT count(*)::integer FROM generate_series(0, GREATEST(
              jsonb_array_length(CASE WHEN jsonb_typeof(p_a->'sections') = 'array' THEN p_a->'sections' ELSE '[]'::jsonb END),
              jsonb_array_length(CASE WHEN jsonb_typeof(p_b->'sections') = 'array' THEN p_b->'sections' ELSE '[]'::jsonb END)) - 1) i
           WHERE (p_a->'sections'->i) IS DISTINCT FROM (p_b->'sections'->i))
       + CASE WHEN COALESCE(p_a->'hero', 'null'::jsonb) IS DISTINCT FROM COALESCE(p_b->'hero', 'null'::jsonb) THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(p_a->'nav', 'null'::jsonb) IS DISTINCT FROM COALESCE(p_b->'nav', 'null'::jsonb) THEN 1 ELSE 0 END
       + CASE WHEN COALESCE(p_a->'footer', 'null'::jsonb) IS DISTINCT FROM COALESCE(p_b->'footer', 'null'::jsonb) THEN 1 ELSE 0 END
$$;

-- ---------------------------------------------------------------------------
-- 6. The media library
-- ---------------------------------------------------------------------------
-- 5 GB allowance; a warning at 70 %, uploads refused at 90 % (spec D2).
CREATE FUNCTION public.site_media_usage_bytes() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$' THEN (o.metadata->>'size')::bigint ELSE 0 END), 0)::bigint
    FROM storage.objects o WHERE o.bucket_id IN ('site-media', 'site-video')
$$;

CREATE FUNCTION public.site_media_upload_open() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT public.site_media_usage_bytes() < (5368709120::numeric * 0.9) $$;

CREATE FUNCTION public.admin_site_media_usage() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_bytes bigint;
  v_limit constant bigint := 5368709120;
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  v_bytes := public.site_media_usage_bytes();
  RETURN jsonb_build_object('bytes', v_bytes, 'limit_bytes', v_limit,
    'warn_bytes', (v_limit * 7) / 10, 'block_bytes', (v_limit * 9) / 10,
    'state', CASE WHEN v_bytes >= (v_limit * 9) / 10 THEN 'blocked' WHEN v_bytes >= (v_limit * 7) / 10 THEN 'warn' ELSE 'ok' END);
END;
$fn$;

-- The library items a content references (m:<uuid>), keyed by id, for the renderer.
CREATE FUNCTION public.site_media_map(p_content jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(m.id, jsonb_build_object(
           'kind', m.kind, 'bucket', m.bucket, 'path', m.path, 'thumb_path', m.thumb_path,
           'width', m.width, 'height', m.height, 'alt', m.alt, 'duration_seconds', m.duration_seconds)), '{}'::jsonb)
    FROM public.site_media m
   WHERE p_content IS NOT NULL
     AND m.id IN (SELECT (x[1])::uuid FROM regexp_matches(p_content::text,
                    '"m:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"', 'g') x)
$$;

CREATE FUNCTION public.site_media_json(m public.site_media) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', m.id, 'ref', 'm:' || m.id, 'kind', m.kind, 'bucket', m.bucket, 'path', m.path,
    'thumb_path', m.thumb_path, 'bytes', m.bytes + m.thumb_bytes, 'width', m.width, 'height', m.height,
    'duration_seconds', m.duration_seconds, 'alt', m.alt, 'uploaded_by_name', public.forms_staff_name(m.uploaded_by),
    'created_at', m.created_at, 'archived_at', m.archived_at,
    'in_use', EXISTS (SELECT 1 FROM public.site_page_live l JOIN public.site_page_versions v ON v.id = l.version_id
                       WHERE strpos(v.content::text, '"m:' || m.id || '"') > 0)
              OR EXISTS (SELECT 1 FROM public.site_custom_pages c WHERE c.share_media_id = m.id AND c.status = 'live'))
$$;

-- Records an uploaded file. The bytes come from storage (never from the browser); the
-- object must already be at its library path: images library/<id>.jpg + library/<id>_thumb.jpg
-- in site-media; videos library/<id>.mp4 in site-video + library/<id>_poster.jpg in site-media.
CREATE FUNCTION public.admin_site_media_register(p_id uuid, p_kind text, p_width integer, p_height integer,
                                                 p_duration_seconds numeric, p_alt text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_bucket text;
  v_path text;
  v_thumb text;
  v_bytes bigint;
  v_thumb_bytes bigint;
  v_row public.site_media;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('image', 'video') THEN RAISE EXCEPTION 'bad_media' USING ERRCODE = '22023'; END IF;
  IF p_alt IS NULL OR length(btrim(p_alt)) NOT BETWEEN 1 AND 200 OR p_alt ~ E'[<>\\x01-\\x1F\\x7F]' THEN
    RAISE EXCEPTION 'bad_alt' USING ERRCODE = '22023';
  END IF;
  IF p_width IS NULL OR p_height IS NULL OR p_width NOT BETWEEN 1 AND 20000 OR p_height NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'bad_size' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'video' AND (p_duration_seconds IS NULL OR p_duration_seconds <= 0) THEN
    RAISE EXCEPTION 'bad_duration' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'video' AND p_duration_seconds > 60 THEN RAISE EXCEPTION 'video_too_long' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.site_media WHERE id = p_id;
  IF FOUND THEN RETURN public.site_media_json(v_row); END IF;   -- a retried register is harmless
  v_bucket := CASE p_kind WHEN 'image' THEN 'site-media' ELSE 'site-video' END;
  v_path := 'library/' || p_id || CASE p_kind WHEN 'image' THEN '.jpg' ELSE '.mp4' END;
  v_thumb := 'library/' || p_id || CASE p_kind WHEN 'image' THEN '_thumb.jpg' ELSE '_poster.jpg' END;
  SELECT CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$' THEN (o.metadata->>'size')::bigint ELSE 0 END INTO v_bytes
    FROM storage.objects o WHERE o.bucket_id = v_bucket AND o.name = v_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_not_uploaded' USING ERRCODE = 'P0002'; END IF;
  SELECT CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$' THEN (o.metadata->>'size')::bigint ELSE 0 END INTO v_thumb_bytes
    FROM storage.objects o WHERE o.bucket_id = 'site-media' AND o.name = v_thumb;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_not_uploaded' USING ERRCODE = 'P0002'; END IF;
  IF v_bytes <= 0 THEN RAISE EXCEPTION 'media_empty' USING ERRCODE = '22023'; END IF;
  IF (p_kind = 'image' AND v_bytes > 5242880) OR (p_kind = 'video' AND v_bytes > 52428800) THEN
    RAISE EXCEPTION 'media_too_large' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.site_media (id, kind, bucket, path, thumb_path, bytes, thumb_bytes, width, height, duration_seconds, alt, uploaded_by)
  VALUES (p_id, p_kind, v_bucket, v_path, v_thumb, v_bytes, v_thumb_bytes, p_width, p_height,
          CASE WHEN p_kind = 'video' THEN round(p_duration_seconds, 2) END, btrim(p_alt), auth.uid())
  RETURNING * INTO v_row;
  RETURN public.site_media_json(v_row);
END;
$fn$;

CREATE FUNCTION public.admin_site_media_list(p_kind text DEFAULT NULL, p_include_archived boolean DEFAULT false,
                                             p_limit integer DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.site_media_json(m) ORDER BY m.created_at DESC)
      FROM (SELECT * FROM public.site_media x
             WHERE (p_kind IS NULL OR x.kind = p_kind) AND (COALESCE(p_include_archived, false) OR x.archived_at IS NULL)
             ORDER BY x.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)) m), '[]'::jsonb);
END;
$fn$;

CREATE FUNCTION public.admin_site_media_update(p_id uuid, p_alt text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row public.site_media;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_alt IS NULL OR length(btrim(p_alt)) NOT BETWEEN 1 AND 200 OR p_alt ~ E'[<>\\x01-\\x1F\\x7F]' THEN
    RAISE EXCEPTION 'bad_alt' USING ERRCODE = '22023';
  END IF;
  UPDATE public.site_media SET alt = btrim(p_alt) WHERE id = p_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public.site_media_json(v_row);
END;
$fn$;

-- Archive (soft): refused while a live page or a live page's share image uses it.
CREATE FUNCTION public.admin_site_media_archive(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row public.site_media;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.site_media WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_not_found' USING ERRCODE = 'P0002'; END IF;
  IF (public.site_media_json(v_row)->>'in_use')::boolean THEN
    RAISE EXCEPTION 'media_in_use' USING ERRCODE = 'PT409', DETAIL = jsonb_build_object('code', 'media_in_use')::text;
  END IF;
  UPDATE public.site_media SET archived_at = COALESCE(archived_at, now()) WHERE id = p_id RETURNING * INTO v_row;
  RETURN public.site_media_json(v_row);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Staff-made pages
-- ---------------------------------------------------------------------------
-- NULL when the address is usable for p_page_key; else bad_path / path_reserved / path_taken.
CREATE FUNCTION public.site_custom_path_error(p_path text, p_page_key text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_path IS NULL OR length(p_path) > 80
      OR p_path !~ '^/[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)?$' THEN 'bad_path'
    WHEN split_part(substr(p_path, 2), '/', 1) = ANY (public.site_reserved_segments()) THEN 'path_reserved'
    WHEN EXISTS (SELECT 1 FROM public.site_custom_pages c WHERE c.path = p_path AND c.page_key IS DISTINCT FROM p_page_key) THEN 'path_taken'
    ELSE NULL END
$$;

CREATE FUNCTION public.site_custom_page_json(c public.site_custom_pages) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('page_key', c.page_key, 'path', c.path, 'name', c.name, 'format', c.format,
    'seo_description', c.seo_description, 'share_media_id', c.share_media_id,
    'hide_from_search', c.hide_from_search, 'show_in_menu', c.show_in_menu, 'status', c.status,
    'redirect_to', c.redirect_to, 'created_at', c.created_at, 'updated_at', c.updated_at,
    'ever_published', EXISTS (SELECT 1 FROM public.site_page_versions v WHERE v.page_key = c.page_key))
$$;

CREATE FUNCTION public.admin_site_page_create(p_path text, p_name text, p_format text, p_sections jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_problem text;
  v_key text;
  v_check jsonb;
  v_row public.site_custom_pages;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_custom_path:' || COALESCE(p_path, ''), 0));
  v_problem := public.site_custom_path_error(p_path, NULL);
  IF v_problem = 'bad_path' THEN RAISE EXCEPTION 'bad_path' USING ERRCODE = '22023'; END IF;
  IF v_problem IS NOT NULL THEN   -- "That address is already used."
    RAISE EXCEPTION '%', v_problem USING ERRCODE = 'PT409', DETAIL = jsonb_build_object('code', v_problem)::text;
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 70 OR p_name ~ E'[<>\\x01-\\x1F\\x7F]' THEN
    RAISE EXCEPTION 'bad_name' USING ERRCODE = '22023';
  END IF;
  IF p_format IS NULL OR p_format NOT IN ('landing', 'host-type', 'programme', 'story', 'blank') THEN
    RAISE EXCEPTION 'bad_format' USING ERRCODE = '22023';
  END IF;
  v_key := 'p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  INSERT INTO public.site_custom_pages (page_key, path, name, format, created_by, updated_by)
  VALUES (v_key, p_path, btrim(p_name), p_format, auth.uid(), auth.uid())
  RETURNING * INTO v_row;
  IF p_sections IS NOT NULL THEN
    v_check := public.site_validate_content(v_key, jsonb_build_object('sections', p_sections));
    IF NOT (v_check->>'ok')::boolean THEN
      RAISE EXCEPTION 'invalid_content' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
    END IF;
    INSERT INTO public.site_page_drafts (page_key, content, rev, base_version, updated_by)
    VALUES (v_key, jsonb_build_object('sections', p_sections), 1, 0, auth.uid());
  END IF;
  RETURN public.site_custom_page_json(v_row) || jsonb_build_object('draft_rev', CASE WHEN p_sections IS NULL THEN 0 ELSE 1 END);
END;
$fn$;

-- p_patch keys: path (only before the first publish), name, seo_description, share_media_id,
-- hide_from_search, show_in_menu. Anything else is refused.
CREATE FUNCTION public.admin_site_page_update_meta(p_page_key text, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row public.site_custom_pages;
  v_problem text;
  v_media uuid;
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k
                 WHERE k NOT IN ('path', 'name', 'seo_description', 'share_media_id', 'hide_from_search', 'show_in_menu')) THEN
    RAISE EXCEPTION 'bad_meta' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_page:' || COALESCE(p_page_key, ''), 0));
  SELECT * INTO v_row FROM public.site_custom_pages WHERE page_key = p_page_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_custom_page' USING ERRCODE = 'P0002'; END IF;
  IF p_patch ? 'path' AND p_patch->>'path' IS DISTINCT FROM v_row.path THEN
    IF EXISTS (SELECT 1 FROM public.site_page_versions v WHERE v.page_key = p_page_key) THEN
      RAISE EXCEPTION 'path_locked' USING ERRCODE = 'PT409', DETAIL = jsonb_build_object('code', 'path_locked')::text;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_custom_path:' || COALESCE(p_patch->>'path', ''), 0));
    v_problem := public.site_custom_path_error(p_patch->>'path', p_page_key);
    IF v_problem = 'bad_path' THEN RAISE EXCEPTION 'bad_path' USING ERRCODE = '22023'; END IF;
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION '%', v_problem USING ERRCODE = 'PT409', DETAIL = jsonb_build_object('code', v_problem)::text;
    END IF;
    v_row.path := p_patch->>'path';
  END IF;
  IF p_patch ? 'name' THEN
    IF jsonb_typeof(p_patch->'name') <> 'string' OR length(btrim(p_patch->>'name')) NOT BETWEEN 1 AND 70
       OR p_patch->>'name' ~ E'[<>\\x01-\\x1F\\x7F]' THEN RAISE EXCEPTION 'bad_name' USING ERRCODE = '22023'; END IF;
    v_row.name := btrim(p_patch->>'name');
  END IF;
  IF p_patch ? 'seo_description' THEN
    IF jsonb_typeof(p_patch->'seo_description') = 'null' THEN v_row.seo_description := NULL;
    ELSIF jsonb_typeof(p_patch->'seo_description') <> 'string' OR length(btrim(p_patch->>'seo_description')) NOT BETWEEN 1 AND 160
       OR p_patch->>'seo_description' ~ E'[<>\\x01-\\x1F\\x7F]' THEN RAISE EXCEPTION 'bad_description' USING ERRCODE = '22023';
    ELSE v_row.seo_description := btrim(p_patch->>'seo_description');
    END IF;
  END IF;
  IF p_patch ? 'share_media_id' THEN
    IF jsonb_typeof(p_patch->'share_media_id') = 'null' THEN v_row.share_media_id := NULL;
    ELSE
      IF COALESCE(p_patch->>'share_media_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'bad_share_image' USING ERRCODE = '22023';
      END IF;
      v_media := (p_patch->>'share_media_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.site_media m WHERE m.id = v_media AND m.kind = 'image' AND m.archived_at IS NULL) THEN
        RAISE EXCEPTION 'bad_share_image' USING ERRCODE = '22023';
      END IF;
      v_row.share_media_id := v_media;
    END IF;
  END IF;
  IF p_patch ? 'hide_from_search' THEN
    IF jsonb_typeof(p_patch->'hide_from_search') <> 'boolean' THEN RAISE EXCEPTION 'bad_meta' USING ERRCODE = '22023'; END IF;
    v_row.hide_from_search := (p_patch->>'hide_from_search')::boolean;
  END IF;
  IF p_patch ? 'show_in_menu' THEN
    IF jsonb_typeof(p_patch->'show_in_menu') <> 'boolean' THEN RAISE EXCEPTION 'bad_meta' USING ERRCODE = '22023'; END IF;
    v_row.show_in_menu := (p_patch->>'show_in_menu')::boolean;
  END IF;
  BEGIN
    UPDATE public.site_custom_pages SET path = v_row.path, name = v_row.name, seo_description = v_row.seo_description,
      share_media_id = v_row.share_media_id, hide_from_search = v_row.hide_from_search, show_in_menu = v_row.show_in_menu,
      updated_by = auth.uid(), updated_at = now()
     WHERE page_key = p_page_key RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'path_taken' USING ERRCODE = 'PT409', DETAIL = jsonb_build_object('code', 'path_taken')::text;
  END;
  RETURN public.site_custom_page_json(v_row);
END;
$fn$;

-- Delete = unpublish with a redirect (spec D6 / D10: Home by default, a 308 on the site).
-- A page that was never published is removed outright.
CREATE FUNCTION public.admin_site_page_delete(p_page_key text, p_redirect_to text DEFAULT '/') RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_row public.site_custom_pages;
  v_to text := COALESCE(p_redirect_to, '/');
BEGIN
  IF NOT public.forms_can_edit() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_page:' || COALESCE(p_page_key, ''), 0));
  SELECT * INTO v_row FROM public.site_custom_pages WHERE page_key = p_page_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_custom_page' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.site_page_versions v WHERE v.page_key = p_page_key) THEN
    DELETE FROM public.site_preview_tokens WHERE page_key = p_page_key;
    DELETE FROM public.site_page_drafts WHERE page_key = p_page_key;
    DELETE FROM public.site_custom_pages WHERE page_key = p_page_key;
    RETURN jsonb_build_object('page_key', p_page_key, 'deleted', true);
  END IF;
  IF COALESCE(public.site_action_target_kind(v_to), 'x') <> 'internal' OR length(v_to) > 200 THEN
    RAISE EXCEPTION 'bad_redirect' USING ERRCODE = '22023';
  END IF;
  IF split_part(split_part(v_to, '?', 1), '#', 1) = v_row.path THEN RAISE EXCEPTION 'redirect_to_self' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.site_page_live WHERE page_key = p_page_key;
  UPDATE public.site_custom_pages SET status = 'unpublished', redirect_to = v_to, updated_by = auth.uid(), updated_at = now()
   WHERE page_key = p_page_key RETURNING * INTO v_row;
  RETURN public.site_custom_page_json(v_row);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. #4452 RPCs re-emitted for block lists, staff-made pages and view-only preview
-- ---------------------------------------------------------------------------
-- Publish and restore: also mark a staff-made page live (and drop its redirect).
CREATE OR REPLACE FUNCTION public.site_page_put_live(p_page_key text, p_expected_live_version integer, p_content jsonb,
                                                     p_note text, p_restored_from integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_cur public.site_page_live;
  v_by uuid;
  v_next integer;
  v_vid uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_page:' || p_page_key, 0));
  SELECT * INTO v_cur FROM public.site_page_live WHERE page_key = p_page_key FOR UPDATE;
  IF COALESCE(v_cur.version, 0) <> COALESCE(p_expected_live_version, 0) THEN
    SELECT published_by INTO v_by FROM public.site_page_versions WHERE id = v_cur.version_id;
    RAISE EXCEPTION 'page_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('code', 'page_conflict', 'live_version', v_cur.version,
                                  'published_by', public.forms_staff_name(v_by),
                                  'published_at', v_cur.published_at)::text;
  END IF;
  IF p_page_key ~ '^p-' AND NOT EXISTS (SELECT 1 FROM public.site_custom_pages c WHERE c.page_key = p_page_key) THEN
    RAISE EXCEPTION 'not_custom_page' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_next FROM public.site_page_versions WHERE page_key = p_page_key;
  INSERT INTO public.site_page_versions (page_key, version, content, note, restored_from, published_by)
  VALUES (p_page_key, v_next, p_content, left(p_note, 200), p_restored_from, auth.uid())
  RETURNING id INTO v_vid;
  INSERT INTO public.site_page_live (page_key, version_id, version, published_at)
  VALUES (p_page_key, v_vid, v_next, now())
  ON CONFLICT (page_key) DO UPDATE SET version_id = EXCLUDED.version_id, version = EXCLUDED.version,
    published_at = EXCLUDED.published_at, revalidated_at = NULL, revalidate_error = NULL;
  UPDATE public.site_custom_pages SET status = 'live', redirect_to = NULL, updated_by = auth.uid(), updated_at = now()
   WHERE page_key = p_page_key;
  RETURN jsonb_build_object('version', v_next);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_site_pages_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'page_key', k.page_key,
      'live', CASE WHEN l.page_key IS NULL THEN NULL ELSE jsonb_build_object(
        'version', l.version, 'published_at', l.published_at,
        'published_by_name', public.forms_staff_name(v.published_by),
        'has_sections', jsonb_typeof(v.content->'sections') = 'array') END,
      'draft', CASE WHEN d.page_key IS NULL THEN NULL ELSE jsonb_build_object(
        'rev', d.rev, 'base_version', d.base_version,
        'changes', public.site_content_changes(d.content, COALESCE(v.content, '{"blocks":[]}'::jsonb)),
        'updated_at', d.updated_at, 'updated_by_name', public.forms_staff_name(d.updated_by)) END,
      'custom', CASE WHEN c.page_key IS NULL THEN NULL ELSE public.site_custom_page_json(c) END,
      'revalidate_error', l.revalidate_error) ORDER BY k.page_key)
    FROM (SELECT page_key FROM public.site_page_drafts UNION SELECT page_key FROM public.site_page_live
          UNION SELECT page_key FROM public.site_custom_pages) k
    LEFT JOIN public.site_page_live l ON l.page_key = k.page_key
    LEFT JOIN public.site_page_versions v ON v.id = l.version_id
    LEFT JOIN public.site_page_drafts d ON d.page_key = k.page_key
    LEFT JOIN public.site_custom_pages c ON c.page_key = k.page_key), '[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_site_page_get(p_page_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_live jsonb;
  v_ver integer;
  v_d public.site_page_drafts;
  v_c public.site_custom_pages;
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT v.content, l.version INTO v_live, v_ver FROM public.site_page_live l
    JOIN public.site_page_versions v ON v.id = l.version_id WHERE l.page_key = p_page_key;
  SELECT * INTO v_d FROM public.site_page_drafts WHERE page_key = p_page_key;
  SELECT * INTO v_c FROM public.site_custom_pages WHERE page_key = p_page_key;
  RETURN jsonb_build_object(
    'live_content', COALESCE(v_live, '{"blocks":[]}'::jsonb),
    'live_version', COALESCE(v_ver, 0),
    -- View-only staff see the live page only, never an unpublished draft.
    'draft_content', CASE WHEN public.forms_can_edit() THEN v_d.content END,
    'draft_rev', v_d.rev,
    'base_version', v_d.base_version,
    'custom', CASE WHEN v_c.page_key IS NULL THEN NULL ELSE public.site_custom_page_json(v_c) END,
    'media', public.site_media_map(COALESCE(v_live, '{}'::jsonb) || jsonb_build_object('draft', CASE WHEN public.forms_can_edit() THEN v_d.content END)),
    'can_edit', public.forms_can_edit());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_site_page_history(p_page_key text, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'version', v.version, 'published_at', v.published_at,
      'published_by_name', public.forms_staff_name(v.published_by),
      'note', v.note, 'restored_from', v.restored_from,
      'is_live', l.version_id = v.id,
      'blocks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('type', b->>'type', 'spot', b->>'spot')), '[]'::jsonb)
                   FROM jsonb_array_elements(COALESCE(v.content->'blocks', '[]'::jsonb)) b),
      'sections', (SELECT COALESCE(jsonb_agg(b->>'type'), '[]'::jsonb)
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.content->'sections') = 'array'
                                                    THEN v.content->'sections' ELSE '[]'::jsonb END) b),
      'settings', v.content ? 'nav' OR v.content ? 'footer',
      'hero', v.content ? 'hero' AND jsonb_typeof(v.content->'hero') = 'object') ORDER BY v.version DESC)
    FROM (SELECT * FROM public.site_page_versions WHERE page_key = p_page_key
           ORDER BY version DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)) v
    LEFT JOIN public.site_page_live l ON l.page_key = v.page_key), '[]'::jsonb);
END;
$fn$;

-- Editors mint a token for any valid content (their draft). View-only staff (forms_can_view)
-- get a token for the LIVE content of the page, whatever they send (fix F-4: a real preview
-- instead of a framed live URL the browser refuses).
CREATE OR REPLACE FUNCTION public.admin_site_page_create_preview_token(p_page_key text, p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_check jsonb;
  v_token text;
  v_expires timestamptz := now() + interval '1 hour';
  v_content jsonb := p_content;
  v_editor boolean := public.forms_can_edit();
BEGIN
  IF NOT public.forms_can_view() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  IF p_page_key IS NULL OR p_page_key !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'bad_page' USING ERRCODE = '22023';
  END IF;
  IF NOT v_editor THEN
    SELECT v.content INTO v_content FROM public.site_page_live l
      JOIN public.site_page_versions v ON v.id = l.version_id WHERE l.page_key = p_page_key;
    v_content := COALESCE(v_content, CASE WHEN p_page_key = 'site-settings' THEN '{}'::jsonb ELSE '{"blocks":[]}'::jsonb END);
  ELSE
    v_check := public.site_validate_content(p_page_key, v_content);
    IF NOT (v_check->>'ok')::boolean THEN
      RAISE EXCEPTION 'invalid_content' USING ERRCODE = '22023', DETAIL = (v_check->'errors')::text;
    END IF;
  END IF;
  -- The #4137 blog token: 32 random bytes, url-safe base64 (43 chars); only the sha256 is stored.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO public.site_preview_tokens (token_hash, page_key, content, created_by, expires_at)
  VALUES (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_page_key, v_content, auth.uid(), v_expires);
  RETURN jsonb_build_object('token', v_token, 'expires_at', v_expires, 'live_only', NOT v_editor);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 9. Anonymous reads for the site
-- ---------------------------------------------------------------------------
-- The #4452 read keeps spot blocks, hero and pop-ups for every page; the block lists,
-- settings and staff-made pages are read one page at a time (site_public_page).
CREATE OR REPLACE FUNCTION public.site_public_content() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'pages', COALESCE((SELECT jsonb_object_agg(l.page_key, v.content - 'sections')
                         FROM public.site_page_live l JOIN public.site_page_versions v ON v.id = l.version_id
                        WHERE l.page_key <> 'site-settings' AND l.page_key !~ '^p-'), '{}'::jsonb),
    'forms', public.site_public_forms(),
    'form_pages', COALESCE((SELECT jsonb_object_agg(s.slug, jsonb_build_object(
                     'form_id', s.form_id,
                     'current_slug', (SELECT c.slug FROM public.form_page_slugs c WHERE c.form_id = s.form_id AND c.is_current)))
                     FROM public.form_page_slugs s JOIN public.forms f ON f.id = s.form_id
                    WHERE f.status = 'live'
                      AND EXISTS (SELECT 1 FROM public.form_page_slugs c WHERE c.form_id = s.form_id AND c.is_current)), '{}'::jsonb))
$$;

-- One page's live block list (and the library media it uses), or NULL. A converted page
-- with no published block list returns sections = null: it renders as coded.
CREATE FUNCTION public.site_public_page(p_page_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_content jsonb;
  v_version integer;
  v_at timestamptz;
BEGIN
  IF p_page_key IS NULL OR p_page_key !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' THEN RETURN NULL; END IF;
  IF NOT (p_page_key = 'site-settings' OR p_page_key = ANY (public.site_converted_page_keys())
          OR EXISTS (SELECT 1 FROM public.site_custom_pages c WHERE c.page_key = p_page_key AND c.status = 'live')) THEN
    RETURN NULL;
  END IF;
  SELECT v.content, l.version, l.published_at INTO v_content, v_version, v_at
    FROM public.site_page_live l JOIN public.site_page_versions v ON v.id = l.version_id WHERE l.page_key = p_page_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_page_key = 'site-settings' THEN
    RETURN jsonb_build_object('page_key', p_page_key, 'version', v_version, 'published_at', v_at,
                              'nav', v_content->'nav', 'footer', v_content->'footer');
  END IF;
  RETURN jsonb_build_object('page_key', p_page_key, 'version', v_version, 'published_at', v_at,
                            'sections', v_content->'sections', 'media', public.site_media_map(v_content->'sections'));
END;
$fn$;

-- Live and redirected staff-made pages (never drafts), for the catch-all route, the sitemap
-- and the menu. Small: one row per page.
CREATE FUNCTION public.site_public_custom_index() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', c.page_key, 'path', c.path, 'status', c.status, 'redirect_to', c.redirect_to,
           'name', c.name, 'description', c.seo_description, 'format', c.format,
           'hide_from_search', c.hide_from_search, 'show_in_menu', c.show_in_menu,
           'published_at', l.published_at,
           'share', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object(
             'bucket', m.bucket, 'path', m.path, 'width', m.width, 'height', m.height, 'alt', m.alt) END)
           ORDER BY c.path), '[]'::jsonb)
    FROM public.site_custom_pages c
    LEFT JOIN public.site_page_live l ON l.page_key = c.page_key
    LEFT JOIN public.site_media m ON m.id = c.share_media_id AND m.kind = 'image'
   WHERE (c.status = 'live' AND l.page_key IS NOT NULL) OR c.status = 'unpublished'
$$;

CREATE OR REPLACE FUNCTION public.site_public_preview(p_token text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_t public.site_preview_tokens;
  v_c public.site_custom_pages;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_t FROM public.site_preview_tokens
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_c FROM public.site_custom_pages WHERE page_key = v_t.page_key;
  RETURN jsonb_build_object('page_key', v_t.page_key, 'content', v_t.content, 'expires_at', v_t.expires_at,
    -- A draft form in a preview renders from its draft (staff are previewing it).
    'forms', public.site_public_forms() || COALESCE((
      SELECT jsonb_object_agg(f.id, public.site_public_form(f.draft) || jsonb_build_object(
               'id', f.id, 'key', f.key, 'name', f.name, 'version', 0, 'template', f.template, 'preview', true))
        FROM public.forms f
       WHERE f.status <> 'archived'
         AND f.id IN (SELECT (b->>'form_id')::uuid FROM jsonb_array_elements(COALESCE(v_t.content->'blocks', '[]'::jsonb)) b
                       WHERE b->>'form_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      UNION
                      SELECT (b->'content'->>'formId')::uuid
                        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_t.content->'sections') = 'array'
                                                       THEN v_t.content->'sections' ELSE '[]'::jsonb END) b
                       WHERE b->'content'->>'formId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
         AND (f.status <> 'live')), '{}'::jsonb),
    'media', public.site_media_map(v_t.content),
    'custom', CASE WHEN v_c.page_key IS NULL THEN NULL ELSE jsonb_build_object(
      'path', v_c.path, 'name', v_c.name, 'format', v_c.format, 'description', v_c.seo_description,
      'hide_from_search', v_c.hide_from_search, 'status', v_c.status) END,
    'changes', public.site_content_changes(v_t.content, COALESCE((
      SELECT v.content FROM public.site_page_live l JOIN public.site_page_versions v ON v.id = l.version_id
       WHERE l.page_key = v_t.page_key), '{"blocks":[]}'::jsonb)));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.site_block_registry(), public.site_reserved_segments(), public.site_converted_page_keys(),
  public.site_action_target_kind(text), public.site_block_text_errors(jsonb, integer, boolean, text),
  public.site_block_field_errors(jsonb, jsonb, text), public.site_block_object_errors(jsonb, jsonb, text),
  public.site_block_errors(jsonb, jsonb), public.site_sections_errors(jsonb),
  public.site_settings_link_errors(jsonb, text, integer), public.site_settings_errors(jsonb),
  public.site_media_usage_bytes(), public.site_media_upload_open(), public.site_media_map(jsonb),
  public.site_media_json(public.site_media), public.site_custom_path_error(text, text),
  public.site_custom_page_json(public.site_custom_pages),
  public.admin_site_media_usage(), public.admin_site_media_register(uuid, text, integer, integer, numeric, text),
  public.admin_site_media_list(text, boolean, integer), public.admin_site_media_update(uuid, text),
  public.admin_site_media_archive(uuid), public.admin_site_page_create(text, text, text, jsonb),
  public.admin_site_page_update_meta(text, jsonb), public.admin_site_page_delete(text, text),
  public.site_public_page(text), public.site_public_custom_index()
  FROM PUBLIC, anon;
-- Pure helpers the editor may call to check content before saving.
GRANT EXECUTE ON FUNCTION public.site_block_registry(), public.site_reserved_segments(), public.site_converted_page_keys(),
  public.site_action_target_kind(text), public.site_block_text_errors(jsonb, integer, boolean, text),
  public.site_settings_link_errors(jsonb, text, integer), public.site_settings_errors(jsonb)
  TO authenticated, service_role;
-- Validators that read the library or forms run inside the definer RPCs (and for the editor's checks).
GRANT EXECUTE ON FUNCTION public.site_block_field_errors(jsonb, jsonb, text), public.site_block_object_errors(jsonb, jsonb, text),
  public.site_block_errors(jsonb, jsonb), public.site_sections_errors(jsonb) TO authenticated, service_role;
-- The storage quota policy evaluates this as the uploading editor.
GRANT EXECUTE ON FUNCTION public.site_media_upload_open() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.site_media_usage_bytes(), public.site_media_map(jsonb), public.site_media_json(public.site_media),
  public.site_custom_path_error(text, text), public.site_custom_page_json(public.site_custom_pages) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_site_media_usage(), public.admin_site_media_register(uuid, text, integer, integer, numeric, text),
  public.admin_site_media_list(text, boolean, integer), public.admin_site_media_update(uuid, text),
  public.admin_site_media_archive(uuid), public.admin_site_page_create(text, text, text, jsonb),
  public.admin_site_page_update_meta(text, jsonb), public.admin_site_page_delete(text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.site_public_page(text), public.site_public_custom_index() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.site_public_page(text) IS '#4636: one live page block list (converted or staff-made, with its library media) or the live site-wide nav and footer (site-settings); NULL when none. Anonymous read.';
COMMENT ON FUNCTION public.site_public_custom_index() IS '#4636: live and redirected staff-made pages (address, status, redirect, SEO fields); never drafts. Anonymous read.';
COMMENT ON FUNCTION public.site_block_registry() IS '#4636: the usemingla.com block registry (copy of mingla-marketing/lib/site-blocks/registry.json, parity-tested; I-4636-ONE-BLOCK-REGISTRY).';
COMMENT ON FUNCTION public.site_reserved_segments() IS '#4636: first address segments the site already answers (copy of mingla-marketing/lib/site-pages/reserved-paths.json; I-4636-NO-ADDRESS-COLLISION).';

-- ---------------------------------------------------------------------------
-- 11. Storage: the site-video bucket, the library paths and the 90 % refusal
-- ---------------------------------------------------------------------------
DO $bucket$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public') INTO has_public;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') INTO has_file_size_limit;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') INTO has_allowed_mime_types;
  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('site-video', 'site-video', true, 52428800, ARRAY['video/mp4'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('site-video', 'site-video', true)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name) VALUES ('site-video', 'site-video')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  END IF;
END
$bucket$;

-- Library images, thumbs and video posters: library/<uuid>(_thumb|_poster).jpg in site-media.
DROP POLICY IF EXISTS issue_4636_site_media_library_insert ON storage.objects;
CREATE POLICY issue_4636_site_media_library_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'site-media'
    AND public.forms_can_edit()
    AND name ~ '^library/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_thumb|_poster)?\.jpg$'
  );

DROP POLICY IF EXISTS issue_4636_site_video_public_read ON storage.objects;
CREATE POLICY issue_4636_site_video_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'site-video');

DROP POLICY IF EXISTS issue_4636_site_video_editor_insert ON storage.objects;
CREATE POLICY issue_4636_site_video_editor_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'site-video'
    AND public.forms_can_edit()
    AND name ~ '^library/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$'
  );

DROP POLICY IF EXISTS issue_4636_site_video_editor_delete ON storage.objects;
CREATE POLICY issue_4636_site_video_editor_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-video' AND public.forms_can_edit());

-- RESTRICTIVE: ANDed with every permissive insert policy, so no path into the two site
-- buckets (the #4452 <uid>/ folder included) uploads once usage reaches 90 % of 5 GB.
-- Other buckets are untouched (the first test short-circuits).
DROP POLICY IF EXISTS issue_4636_site_media_quota ON storage.objects;
CREATE POLICY issue_4636_site_media_quota
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id NOT IN ('site-media', 'site-video') OR public.site_media_upload_open());

COMMIT;
