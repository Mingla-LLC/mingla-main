'use client'

import Link from 'next/link'
import { ArrowRight, BadgeCheck, Megaphone, QrCode, Sparkles, TicketCheck, Users } from 'lucide-react'
import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { GsapReveal } from '@/components/ui/gsap-reveal'
import { buttonClasses } from '@/components/ui/button'

gsap.registerPlugin(useGSAP)

const capabilities = [
  { icon: Sparkles, title: 'Publish polished pages', body: 'Give every venue, event, trip or experience a page built to be discovered and shared.' },
  { icon: TicketCheck, title: 'Sell with honest pricing', body: 'Offer tickets and reservations with the full cost clear before checkout.' },
  { icon: QrCode, title: 'Run the guest list', body: 'Keep arrivals organized with booking details and ticket scanning in one flow.' },
  { icon: Megaphone, title: 'Bring people back', body: 'Understand your audience and reconnect through People and targeted blasts.' },
]

export function HostExperienceHome() {
  const hero = useRef<HTMLElement>(null)
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('[data-host-kicker]', { y: 14, duration: .55 })
        .from('[data-host-title]', { y: 24, duration: .75 }, '-=.3')
        .from('[data-host-copy]', { y: 18, duration: .65 }, '-=.4')
        .from('[data-host-actions]', { y: 16, duration: .6 }, '-=.35')
        .from('[data-host-visual]', { y: 22, rotate: 1.5, duration: .8 }, '-=.55')
    })
    return () => mm.revert()
  }, { scope: hero })

  return <div className="overflow-hidden bg-parchment text-ink">
    <section ref={hero} className="relative min-h-[820px] px-5 pb-24 pt-36 md:px-10 md:pt-44">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_78%_25%,rgba(235,120,37,.2),transparent_32%),radial-gradient(circle_at_12%_72%,rgba(244,214,121,.2),transparent_28%)]" />
      <div className="relative mx-auto grid max-w-[1184px] items-center gap-14 lg:grid-cols-[1.07fr_.93fr]">
        <div><p data-host-kicker className="text-sm font-bold uppercase tracking-[.18em] text-warm-ink">Mingla Host</p><h1 data-host-title className="mt-6 font-display text-[clamp(3rem,7vw,5.5rem)] leading-[.98] tracking-[-.055em]">Your place deserves to be found.</h1><p data-host-copy className="mt-7 max-w-[670px] text-lg leading-8 text-black/65 md:text-xl">Create what makes your place, event, trip or experience worth showing up for. Mingla helps the right people discover it, book it and arrive.</p><div data-host-actions className="mt-9 flex flex-wrap gap-4"><Link href="/host/download" className={buttonClasses({variant:'primary',size:'lg'})}>Get Mingla Host <ArrowRight className="h-4 w-4"/></Link><a href="https://host.usemingla.com" className={buttonClasses({variant:'secondary',size:'lg'})}>Open on web</a></div></div>
        <div data-host-visual className="mx-auto w-full max-w-[470px] rounded-[36px] border border-black/10 bg-white/80 p-4 shadow-[0_40px_120px_rgba(50,25,8,.16)] backdrop-blur-xl"><div className="rounded-[28px] bg-ink p-6 text-white"><div className="flex items-center justify-between"><span className="font-display text-lg">Tonight at your place</span><span className="rounded-full bg-warm px-3 py-1 text-xs font-bold">Published</span></div><div className="mt-10 rounded-[22px] bg-white/8 p-5"><p className="text-xs uppercase tracking-[.16em] text-white/50">Your experience</p><h2 className="mt-3 font-display text-3xl">Make the night worth showing up for.</h2><div className="mt-8 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white/8 p-4"><TicketCheck className="h-5 w-5 text-warm"/><p className="mt-4 text-sm">Tickets ready</p></div><div className="rounded-2xl bg-white/8 p-4"><Users className="h-5 w-5 text-warm"/><p className="mt-4 text-sm">Guest list ready</p></div></div></div></div></div>
      </div>
    </section>

    <GsapReveal className="bg-ink px-5 py-24 text-white md:px-10 md:py-36"><section className="mx-auto max-w-[1184px]"><p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-warm">From idea to arrival</p><h2 data-reveal className="mt-5 max-w-4xl font-display text-[clamp(2.5rem,5vw,4.6rem)] leading-[1.03] tracking-[-.045em]">Create it once. Reach people by vibe. Turn interest into bookings.</h2><div className="mt-16 grid gap-4 md:grid-cols-3">{['Create it once','Reach people by vibe','Turn interest into bookings'].map((x,i)=><div data-reveal key={x} className="rounded-[28px] border border-white/10 bg-white/[.045] p-7"><span className="text-warm">0{i+1}</span><h3 className="mt-12 font-display text-2xl">{x}</h3></div>)}</div></section></GsapReveal>

    <GsapReveal className="px-5 py-24 md:px-10 md:py-36"><section className="mx-auto max-w-[1184px]"><p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-warm-ink">Everything around the moment</p><h2 data-reveal className="mt-5 max-w-3xl font-display text-[clamp(2.5rem,5vw,4.5rem)] leading-[1.04] tracking-[-.045em]">One clear system for discovery, booking and arrival.</h2><div className="mt-14 grid gap-5 md:grid-cols-2">{capabilities.map(({icon:Icon,title,body})=><article data-reveal key={title} className="rounded-[28px] border border-black/8 bg-white p-7 shadow-[0_20px_70px_rgba(14,14,16,.06)]"><Icon className="h-6 w-6 text-warm-ink"/><h3 className="mt-12 font-display text-2xl">{title}</h3><p className="mt-3 max-w-lg leading-7 text-black/60">{body}</p></article>)}</div></section></GsapReveal>

    <GsapReveal className="px-5 pb-24 md:px-10 md:pb-36"><section className="mx-auto grid max-w-[1184px] gap-8 rounded-[36px] bg-[#f1e8dc] p-8 md:grid-cols-[.8fr_1.2fr] md:p-14"><div data-reveal className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm text-white"><Sparkles/></div><div><p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-warm-ink">Ari for hosts</p><h2 data-reveal className="mt-4 font-display text-[clamp(2.3rem,4vw,4rem)] leading-[1.04] tracking-[-.04em]">Start faster. Stay in control.</h2><p data-reveal className="mt-5 max-w-2xl text-lg leading-8 text-black/60">Ari can help shape the starting point. You review the details, make the decisions and publish when it is ready.</p><div data-reveal className="mt-8 flex flex-wrap gap-3">{['Draft the description','Shape the experience','Review before publishing'].map(x=><span key={x} className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm"><BadgeCheck className="mr-2 inline h-4 w-4 text-warm-ink"/>{x}</span>)}</div></div></section></GsapReveal>

    <GsapReveal className="bg-ink px-5 py-24 text-white md:px-10 md:py-32"><section className="mx-auto max-w-[1184px]"><p data-reveal className="text-sm font-bold uppercase tracking-[.18em] text-warm">Built for people who make plans possible</p><div className="mt-8 flex flex-wrap gap-3">{['Restaurants & bars','Venues & nightlife','Event organisers','Trip & experience hosts','Pop-ups & creators'].map(x=><span data-reveal key={x} className="rounded-full border border-white/12 bg-white/[.05] px-5 py-3">{x}</span>)}</div></section></GsapReveal>

    <section className="px-5 py-24 text-center md:px-10 md:py-36"><h2 className="mx-auto max-w-4xl font-display text-[clamp(2.7rem,6vw,5.2rem)] leading-[1.02] tracking-[-.05em]">Put what you create in front of people looking for it.</h2><Link href="/host/download" className={buttonClasses({variant:'primary',size:'lg',className:'mt-9'})}>Get Mingla Host <ArrowRight className="h-4 w-4"/></Link></section>
  </div>
}
