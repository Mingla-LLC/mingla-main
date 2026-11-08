import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Calendar,
  ChartLine,
  CreditCard,
  Image as ImageIcon,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Plus,
  Sun,
  Tag,
  Ticket,
  Users,
} from 'lucide-react'
import { SiteFooter } from '@/components/marketing/footer'
import { SiteNav } from '@/components/site/site-nav'
import '@/components/site/site.css'
import {
  ICP_LANDINGS,
  TOOL_PATH,
  emphasisRuns,
  landingBackgroundMedia,
  litWords,
  type IcpLanding,
  type IcpSlug,
  type LandingIcon,
} from '@/content/host-landing/icps'
import { HostHandoffButton } from './host-handoff'
import { LandingMedia } from './landing-media'
import { LandingRoot } from './landing-root'
import './landing.css'

// #4339 §2 — the ONE Host landing-page template ("Drift"). Every ICP page is
// this component plus its entry in content/host-landing/icps.ts. Section order
// is fixed by the spec:
//   1. full-screen video hero, 20% shade, two-line serif headline (the second
//      line italic), glass CTA bar;
//   2. paper "about" section overlapping the hero by 25px, words that light
//      up on scroll;
//   3. sticky features: fixed background, sticky left column with three
//      section buttons, three glass video cards;
//   4. who it's for;  5. the free tool;  6. FAQ;  7. closing video band.
// Buttons: "Use Mingla Web" → Host hand-off (§3), "Talk to the team" →
// /schedule?icp=<slug>, "See what's inside" → the features section, the tool →
// its internal /tools page. No privacy link here: the #4318 strip owns that.

const ICONS: Record<LandingIcon, ReactNode> = {
  ticket: <Ticket aria-hidden="true" />,
  users: <Users aria-hidden="true" />,
  mail: <Mail aria-hidden="true" />,
  map: <MapIcon aria-hidden="true" />,
  card: <CreditCard aria-hidden="true" />,
  chat: <MessageCircle aria-hidden="true" />,
  calendar: <Calendar aria-hidden="true" />,
  tag: <Tag aria-hidden="true" />,
  image: <ImageIcon aria-hidden="true" />,
  chart: <ChartLine aria-hidden="true" />,
  sun: <Sun aria-hidden="true" />,
}

const FEATURES_ID = 'features'

function Emphasis({ copy }: { copy: string }) {
  return (
    <>
      {emphasisRuns(copy).map((run, i) => (run.em ? <em key={i}>{run.text}</em> : <span key={i}>{run.text}</span>))}
    </>
  )
}

export function scheduleHref(slug: IcpSlug): string {
  return `/schedule?icp=${encodeURIComponent(slug)}`
}

export function IcpLandingPage({ slug }: { slug: IcpSlug }) {
  const d: IcpLanding = ICP_LANDINGS[slug]
  const words = litWords(d.big)
  const toolPath = TOOL_PATH[d.tool.n]

  return (
    <LandingRoot slug={slug}>
      <SiteNav surface="host" current="host" />

      {/* 1. Hero */}
      <section className="lp-hero" aria-labelledby="lp-title">
        <LandingMedia media={d.hero} hero kenBurns />
        <div className="shade" aria-hidden="true" />
        <div className="in wrap">
          <span className="pill glass">
            <span className="dot" aria-hidden="true" />
            For {d.name.toLowerCase()}
          </span>
          <h1 id="lp-title">
            <span>{d.l1}</span>
            <span>
              <em>{d.l2}</em>
            </span>
          </h1>
          <div className="bottom">
            <p>{d.sub}</p>
            <div className="glassbar">
              <span className="bring">{d.bring}</span>
              <HostHandoffButton location="hero" className="btn white" />
            </div>
          </div>
        </div>
      </section>

      {/* 2. About, over the hero by 25px */}
      <section className="about">
        <div className="wrap">
          <p className="intro">{d.intro}</p>
          <div className="row">
            <Link className="btn ink talk" href={scheduleHref(slug)}>
              <span className="circ" aria-hidden="true">
                <Mail />
              </span>
              Talk to the team
            </Link>
            <a className="btn soft" href={`#${FEATURES_ID}`} data-see-inside="">
              <Plus aria-hidden="true" /> See what’s inside
            </a>
          </div>
          <div className="divider" aria-hidden="true">
            <i />
            <b />
            <i />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="wm" src="/brand/mingla-wordmark.svg" alt="Mingla" width={85} height={30} />
          <div className="duo">
            <span className="a">{d.duo[0]}</span> / {d.duo[1]}
          </div>
          <p className="big" data-lit="">
            {words.map((w, i) => (
              <span key={i}>
                <span className={w.em ? 'w em' : 'w'}>{w.word}</span>{i < words.length - 1 ? ' ' : null}
              </span>
            ))}
          </p>
        </div>
      </section>

      {/* 3. Features */}
      <section className="feat" id={FEATURES_ID} data-feat="" aria-labelledby="lp-feat-title">
        <div className="feat-bg" aria-hidden="true">
          {/* A still, or a muted looping clip under the same video rules as every
              other clip (preload none until on screen; poster only under
              reduced motion or Save-Data). */}
          <LandingMedia media={landingBackgroundMedia(d.bg)} />
        </div>
        <div className="wrap feat-grid">
          <div className="feat-left">
            <h2 id="lp-feat-title">
              <Emphasis copy={d.fh} />
            </h2>
            <p>{d.fp}</p>
            <div className="fnav">
              {d.feats.map((f, i) => (
                <button
                  key={f.t}
                  type="button"
                  data-go={i}
                  className={i === 0 ? 'on' : undefined}
                  aria-current={i === 0 ? 'true' : undefined}
                >
                  <b>0{i + 1}</b>
                  {f.t}
                </button>
              ))}
            </div>
            <HostHandoffButton location="features" className="btn cta" withArrow />
          </div>
          <div className="fcards">
            {d.feats.map((f, i) => (
              <article className="fcard" data-i={i} key={f.t}>
                <div className="top">
                  <span className="logo">{ICONS[f.ic]}</span>
                  <h3>{f.t}</h3>
                </div>
                <div className="media">
                  <LandingMedia media={f.m} />
                </div>
                <p>{f.p}</p>
                <ul>
                  {f.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Who it's for */}
      <section className="sec">
        <div className="wrap">
          <div className="split reveal">
            <div>
              <h2 className="h2">
                Built for <em>{d.short.toLowerCase()}</em> of every size.
              </h2>
            </div>
            <ul className="chips">
              {d.who.map((w) => (
                <li className="chip" key={w}>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 5. The free tool */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="tool reveal">
            <div className="l">
              <h2 className="h2">{d.tool.n}</h2>
              <p className="lead">{d.tool.d}</p>
              <div className="row" style={{ marginTop: 28 }}>
                <Link className="btn cta" href={toolPath}>
                  {d.tool.cta} <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </div>
            {/* The design's preview of the tool's own form. It opens the tool;
                the tool asks for these details itself. */}
            <form className="r" action={toolPath} method="get" aria-label={d.tool.n}>
              {d.tool.f.map(([label, kind, example], i) => {
                const id = `lp-tool-${slug}-${i}`
                return (
                  <div className="field" key={label}>
                    <label htmlFor={id}>{label}</label>
                    {kind === 'select' ? (
                      <select id={id} defaultValue={example}>
                        <option>{example}</option>
                      </select>
                    ) : (
                      <input id={id} placeholder={example} />
                    )}
                  </div>
                )
              })}
              <button className="btn ink" type="submit" style={{ marginTop: 6 }}>
                {d.tool.cta}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* 6. FAQ */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="wrap split" style={{ alignItems: 'start' }}>
          <div className="reveal">
            <h2 className="h2">
              The <em>short</em> answers.
            </h2>
            <div className="row" style={{ marginTop: 28 }}>
              <Link className="btn soft" href="/help">
                Help centre <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="faq reveal">
            {d.faq.map(([q, a], i) => (
              <details key={q} open={i === 0}>
                <summary>
                  {q}
                  <span className="pl" aria-hidden="true">
                    <Plus />
                  </span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Closing band */}
      <section className="band-sec">
        <div className="wrap">
          <div className="band">
            <LandingMedia media={d.endm} />
            <div className="in">
              <h2>
                <Emphasis copy={d.end} />
              </h2>
              <div className="glassbar">
                <span className="bring">Set it up today.</span>
                <HostHandoffButton location="band" className="btn white" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter surface="host" />
    </LandingRoot>
  )
}
