'use client'

import Link from 'next/link'
import { ArrowRight, CalendarDays, Compass, MapPin, Sparkles, Users } from 'lucide-react'
import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { CityKey } from '@/lib/city-decks'
import { HeroPlaceDeck, useDeckRotation } from './hero-place-deck'
import { GsapReveal } from '@/components/ui/gsap-reveal'
import { buttonClasses } from '@/components/ui/button'

gsap.registerPlugin(useGSAP)

const steps = [
  ['01', 'Name the vibe', 'Tell Mingla what the moment should feel like.'],
  ['02', 'Pick the plan', 'Explore places, events and experiences that fit.'],
  ['03', 'Show up together', 'Turn the choice into a plan everyone can follow.'],
]

const breadth = [
  { icon: MapPin, title: 'Places', body: 'Restaurants, bars, cafés and local finds that match the mood.' },
  { icon: CalendarDays, title: 'Events', body: 'Discover what is happening when your people are actually free.' },
  { icon: Compass, title: 'Trips & experiences', body: 'Find a bigger day out without stitching five apps together.' },
  { icon: Users, title: 'Plans together', body: 'Share the idea and bring the group from maybe to happening.' },
]

export function ExplorerExperienceHome({ cityKey }: { cityKey: CityKey }) {
  const hero = useRef<HTMLElement>(null)
  const rotation = useDeckRotation(cityKey)

  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('[data-hero-kicker]', { y: 14, duration: 0.55 })
        .from('[data-hero-title]', { y: 24, duration: 0.75 }, '-=0.3')
        .from('[data-hero-copy]', { y: 18, duration: 0.65 }, '-=0.4')
        .from('[data-hero-actions]', { y: 16, duration: 0.6 }, '-=0.35')
        .from('[data-hero-visual]', { y: 22, scale: 0.97, duration: 0.8 }, '-=0.55')
    })
    return () => mm.revert()
  }, { scope: hero })

  return (
    <div className="overflow-hidden bg-smoke text-text-primary">
      <section ref={hero} className="relative min-h-[820px] px-5 pb-24 pt-36 md:px-10 md:pt-44">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_18%,rgba(235,120,37,0.16),transparent_30%),radial-gradient(circle_at_14%_75%,rgba(92,122,90,0.13),transparent_28%)]" />
        <div className="relative mx-auto grid max-w-[1184px] items-center gap-16 lg:grid-cols-[1.08fr_.92fr]">
          <div className="max-w-[720px]">
            <p data-hero-kicker className="mb-6 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[.18em] text-warm"><Sparkles className="h-4 w-4" /> Plans that feel like you</p>
            <h1 data-hero-title className="font-display text-[clamp(3rem,7vw,5.5rem)] leading-[.98] tracking-[-.055em]">Turn the group chat into a real plan.</h1>
            <p data-hero-copy className="mt-7 max-w-[650px] text-lg leading-8 text-text-secondary md:text-xl">Tell Mingla the vibe. Get places, events, trips and experiences that fit—then make the plan together.</p>
            <div data-hero-actions className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/download" className={buttonClasses({ variant: 'primary', size: 'lg' })}>Get Mingla <ArrowRight className="h-4 w-4" /></Link>
              <a href="#how-it-works" className={buttonClasses({ variant: 'glass', size: 'lg' })}>See how it works</a>
            </div>
          </div>
          <div data-hero-visual className="relative mx-auto flex min-h-[470px] w-full max-w-[460px] items-center justify-center">
            <div className="absolute h-72 w-72 rounded-full bg-warm/20 blur-[90px]" />
            <HeroPlaceDeck rotation={rotation} cityKey={cityKey} />
          </div>
        </div>
      </section>

      <GsapReveal className="bg-parchment px-5 py-24 text-ink md:px-10 md:py-36" >
        <section id="how-it-works" className="mx-auto max-w-[1184px] scroll-mt-28">
          <p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-warm-ink">How Mingla works</p>
          <h2 data-reveal className="mt-5 max-w-3xl font-display text-[clamp(2.6rem,5vw,4.7rem)] leading-[1.02] tracking-[-.045em]">Less planning. More living.</h2>
          <div className="mt-16 grid gap-5 md:grid-cols-3">
            {steps.map(([n,title,body]) => <article data-reveal key={n} className="rounded-[28px] border border-black/8 bg-white p-7 shadow-[0_20px_60px_rgba(14,14,16,.06)]"><span className="text-sm font-bold text-warm-ink">{n}</span><h3 className="mt-10 font-display text-2xl tracking-[-.03em]">{title}</h3><p className="mt-3 leading-7 text-black/60">{body}</p></article>)}
          </div>
        </section>
      </GsapReveal>

      <GsapReveal className="px-5 py-24 md:px-10 md:py-36">
        <section className="mx-auto max-w-[1184px]">
          <p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-warm">One place to decide</p>
          <h2 data-reveal className="mt-5 max-w-3xl font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[1.04] tracking-[-.045em]">Whatever the plan becomes, start with the vibe.</h2>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{breadth.map(({icon:Icon,title,body}) => <article data-reveal key={title} className="rounded-[28px] border border-white/10 bg-white/[.045] p-6"><Icon className="h-6 w-6 text-warm"/><h3 className="mt-10 font-display text-xl">{title}</h3><p className="mt-3 text-sm leading-6 text-text-secondary">{body}</p></article>)}</div>
        </section>
      </GsapReveal>

      <GsapReveal className="px-5 pb-24 md:px-10 md:pb-36">
        <section className="mx-auto flex max-w-[1184px] flex-col items-start justify-between gap-10 rounded-[36px] bg-warm p-8 text-white md:flex-row md:items-end md:p-14">
          <div><p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-white/70">For the people creating the moment</p><h2 data-reveal className="mt-5 max-w-3xl font-display text-[clamp(2.2rem,4vw,4rem)] leading-[1.04] tracking-[-.04em]">A great plan needs somewhere worth showing up for.</h2></div>
          <Link data-reveal href="/host" className="inline-flex h-14 shrink-0 items-center gap-2 rounded-full bg-white px-7 font-display text-ink transition-transform hover:-translate-y-0.5 focus-ring">Meet Mingla Host <ArrowRight className="h-4 w-4" /></Link>
        </section>
      </GsapReveal>

      <section className="px-5 py-24 text-center md:px-10 md:py-36"><h2 className="mx-auto max-w-4xl font-display text-[clamp(2.7rem,6vw,5.2rem)] leading-[1.02] tracking-[-.05em]">Find the plan. Feel the city. Show up.</h2><Link href="/download" className={buttonClasses({ variant: 'primary', size: 'lg', className: 'mt-9' })}>Get Mingla <ArrowRight className="h-4 w-4" /></Link></section>
    </div>
  )
}
