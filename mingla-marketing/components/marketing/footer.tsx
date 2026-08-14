import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { Surface } from '@/lib/subdomain'
import { socialHref, socialsForTab } from '@/lib/links-config'

interface FooterProps { surface: Surface }

const productLinks = [
  { href: '/', label: 'Mingla' },
  { href: '/host', label: 'Mingla Host' },
  { href: '/tools', label: 'Free tools' },
]
const exploreLinks = [
  { href: '/download', label: 'Get Mingla' },
  { href: '/host/download', label: 'Get Mingla Host' },
  { href: '/support', label: 'Support' },
]
const legalLinks = [
  { href: '/privacy-policy', label: 'Privacy' },
  { href: '/terms-of-service', label: 'Terms' },
]

export function Footer({ surface }: FooterProps) {
  const host = surface === 'organiser'
  const socials = socialsForTab(host ? 'business' : 'explorer')
  return <footer data-theme="dark" className="border-t border-white/8 bg-obsidian px-5 py-20 text-white md:px-10 md:py-24">
    <div className="mx-auto max-w-[1184px]">
      <div className="grid gap-14 lg:grid-cols-[1.3fr_2fr]">
        <div className="max-w-md">
          <img src={host ? '/brand/mingla-business-logo.svg' : '/brand/mingla-wordmark.svg'} alt={host ? 'Mingla Host' : 'Mingla'} className={host ? 'h-32 w-32 object-contain' : 'h-8 w-auto'} />
          <p className="mt-6 text-base leading-7 text-white/62">{host ? 'Create, publish and run the places, events, trips and experiences people want to show up for.' : 'Find places, events, trips and experiences that fit the vibe—then turn them into a real plan.'}</p>
        </div>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          {[['Products',productLinks],['Explore',exploreLinks],['Legal',legalLinks]].map(([title,links]) => <div key={title as string}><h2 className="text-xs font-bold uppercase tracking-[.18em] text-white/45">{title as string}</h2><ul className="mt-5 space-y-3">{(links as typeof productLinks).map(link=><li key={link.href}><Link href={link.href} className="text-sm text-white/70 transition-colors hover:text-white focus-ring">{link.label}</Link></li>)}</ul></div>)}
          <div><h2 className="text-xs font-bold uppercase tracking-[.18em] text-white/45">Social</h2><ul className="mt-5 space-y-3">{socials.map(s=><li key={s.label}><a href={socialHref(s,host?'business':'explorer')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-white/70 transition-colors hover:text-white focus-ring">{s.label}<ArrowUpRight className="h-3 w-3"/></a></li>)}</ul></div>
        </div>
      </div>
      <div className="mt-16 flex flex-col gap-5 border-t border-white/10 pt-8 md:flex-row md:items-center md:justify-between"><Link href={host ? '/' : '/host'} className="font-display text-sm text-warm transition-colors hover:text-white">{host ? 'Planning something? Meet Mingla →' : 'Create the place people find. Meet Mingla Host →'}</Link><p className="text-xs text-white/40">© {new Date().getFullYear()} Mingla. All rights reserved.</p></div>
    </div>
  </footer>
}
