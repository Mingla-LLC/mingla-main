-- META-ORCH-1221 [Careers site] — Migration B: seed the two open roles.
--
-- Source: Mingla_Artifacts/ORCH_1221_CAREERS_JOB_DESCRIPTIONS.md (verbatim).
-- Markdown `body` = About Mingla → About the role → What you'll do → What we're
-- looking for → Nice to have → Compensation & logistics (the "How to apply"
-- section is OMITTED — the apply CTA is the page itself, SPEC §4.A.7).
-- Idempotent: insert ... on conflict (slug) do update so re-running refreshes
-- copy without creating duplicates.

insert into public.job_postings (
  slug, title, department, location, employment_type,
  salary_min, salary_max, salary_currency, salary_period, salary_display,
  summary, body, status, sort_order
) values
(
  'multimedia-designer',
  'Multimedia Designer',
  'Brand & Creative',
  'Remote (Nigeria)',
  'full_time',
  150000, 250000, 'NGN', 'month', '₦150,000–₦250,000/month',
  'A graphics + video + motion designer in one — produces social-ready creative for a fast-moving consumer brand, fast, with AI-accelerated output.',
$body$## About Mingla

Mingla is the app for finding something to do. Date ideas, restaurants, bars, events, and city gems that actually fit the vibe — so people spend less time figuring out what to do and more time showing up. We're a two-sided experience platform: a consumer app for explorers, couples, and friend groups, and a business app that helps venues and experience brands get discovered by the people nearby who are actually looking. We operate in the US and Nigeria, and we move fast.

## About the role

We're looking for a rare multimedia designer who is genuinely great at graphics, video, AND motion — not someone strong in one and passable in the others. You'll turn ideas into scroll-stopping creative on a tight clock: social posts one hour, a short-form edit the next, a motion sequence after that. You bring taste, range, and speed, and you use AI tools to multiply your output without losing the craft. If you obsess over the difference between good and great and can ship both fast, this is your seat.

## What you'll do

- Design social-ready graphics across formats — feed, story, carousel, ad creative — that feel premium and on-brand.
- Cut and produce short-form video for Instagram, TikTok, and beyond — hooks, pacing, captions, sound.
- Build motion and animation — animated logos, transitions, kinetic type, product/UI motion.
- Turn briefs around fast and iterate without drama as feedback comes in.
- Use AI tools to dramatically accelerate ideation, asset generation, and editing — and keep the bar high.
- Help shape and protect Mingla's visual identity across every surface.

## What we're looking for

- A standout portfolio that proves all three: graphics, video, and motion.
- Expert in the Adobe suite — Photoshop and After Effects especially.
- Fluent in Canva and CapCut for fast production.
- Strong, modern taste and a sharp eye for detail, type, color, and composition.
- Real speed — you ship high-quality work on short timelines.
- Hands-on use of AI tools to speed up your workflow.

## Nice to have

- Experience designing for a consumer or lifestyle brand.
- Premiere Pro, Illustrator, Figma, Lottie, or 3D/Blender.
- Sound design or music-editing instincts for short-form.

## Compensation & logistics

- **Pay:** ₦150,000–₦250,000/month, based on experience.
- **Location:** Remote (Nigeria) — you must be based in Nigeria.
- **Type:** Full-time.
- **Applications:** Rolling — we review as they come in.$body$,
  'open',
  0
),
(
  'community-brand-manager',
  'Community & Brand Manager',
  'Growth & Community',
  'Remote (Nigeria)',
  'full_time',
  150000, 250000, 'NGN', 'month', '₦150,000–₦250,000/month',
  'Owns Mingla''s social presence, brand voice, and community — runs the channels, writes the briefs, manages influencers, and moves fast to support growth and product.',
$body$## About Mingla

Mingla is the app for finding something to do. Date ideas, restaurants, bars, events, and city gems that actually fit the vibe — so people spend less time figuring out what to do and more time showing up. We're a two-sided experience platform: a consumer app for explorers, couples, and friend groups, and a business app that helps venues and experience brands get discovered by the people nearby who are actually looking. We operate in the US and Nigeria, and we move fast.

## About the role

We're looking for a sharp, fast-moving Community & Brand Manager to own how Mingla shows up and how our community grows. You'll run our social channels, hold the brand voice, write the briefs that point our creative, and partner with influencers and creators. You'll also plug directly into growth and product — taking on whatever moves the needle, learning fast, and getting it done. This is a high-ownership role for someone who thrives without a rulebook and turns ambiguity into momentum.

## What you'll do

- Own day-to-day social media management across our channels — plan, publish, engage, and report.
- Hold and evolve Mingla's brand voice so everything sounds unmistakably us.
- Write clear creative briefs that point designers, video, and external partners.
- Drive product marketing — turn features into stories people care about.
- Support growth initiatives end to end, from campaigns to experiments to launches.
- Manage influencers and creators — outreach, briefing, coordination, and follow-through.
- Build and nurture the community, and feed what you hear back into growth and product.

## What we're looking for

- Proven social media management with work you can point to.
- Strong writing — briefs, captions, and brand voice that land.
- Product-marketing instincts: you can make a feature feel like it matters.
- A track record of supporting growth initiatives and getting things shipped.
- Experience managing influencers or creator relationships.
- Fast learner who moves quickly and takes ownership without being told twice.

## Nice to have

- Experience at a startup or fast-moving consumer brand.
- Familiarity with analytics tools (e.g. social insights, PostHog, GA).
- Light hands-on design or video editing (Canva, CapCut).
- Community-building experience in the US or Nigerian market.

## Compensation & logistics

- **Pay:** ₦150,000–₦250,000/month, based on experience.
- **Location:** Remote (Nigeria) — you must be based in Nigeria.
- **Type:** Full-time.
- **Applications:** Rolling — we review as they come in.$body$,
  'open',
  1
)
on conflict (slug) do update set
  title           = excluded.title,
  department      = excluded.department,
  location        = excluded.location,
  employment_type = excluded.employment_type,
  salary_min      = excluded.salary_min,
  salary_max      = excluded.salary_max,
  salary_currency = excluded.salary_currency,
  salary_period   = excluded.salary_period,
  salary_display  = excluded.salary_display,
  summary         = excluded.summary,
  body            = excluded.body,
  status          = excluded.status,
  sort_order      = excluded.sort_order,
  updated_at      = now();
