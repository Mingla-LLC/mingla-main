// #4636 — the nav and footer with the published site-wide settings
// (page key 'site-settings'), for server components. With nothing published
// (or a payload the site refuses) they render the coded nav and footer,
// byte for byte. Live staff-made pages that asked to be in the menu join the
// first menu group.
//
// Server only: SiteNav and SiteFooter stay plain components so client
// modules (the tools frame, the blog error page) can still draw the coded
// chrome; server pages pass these in instead.
import type { ComponentProps } from 'react'
import { SiteFooter } from '@/components/marketing/footer'
import { menuEntries } from '@/lib/site-pages/custom'
import { customIndex, siteChrome } from '@/lib/site-pages/published'
import { SiteNav } from './site-nav'

export async function SiteNavLive(props: Omit<ComponentProps<typeof SiteNav>, 'settings' | 'extraMenu'>) {
  const [{ nav }, index] = await Promise.all([siteChrome(), customIndex()])
  return <SiteNav {...props} settings={nav} extraMenu={menuEntries(index)} />
}

export async function SiteFooterLive(props: Omit<ComponentProps<typeof SiteFooter>, 'settings'>) {
  const { footer } = await siteChrome()
  return <SiteFooter {...props} settings={footer} />
}
