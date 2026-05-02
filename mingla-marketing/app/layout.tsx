import type { Metadata } from 'next'
import { Mochiy_Pop_One, Nunito_Sans } from 'next/font/google'
import './globals.css'

// Brand display — matches the live usemingla.com brand font.
// Mochiy Pop One ships in a single weight (400) with no italic axis.
const mochiy = Mochiy_Pop_One({
  subsets: ['latin'],
  variable: '--font-mochiy',
  display: 'swap',
  weight: '400',
})

// Brand body — matches the live usemingla.com body font.
const nunito = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: { default: 'Mingla — Find a vibe, not a venue.', template: '%s — Mingla' },
  description:
    "Mingla curates the spots, plans, and experiences that match the night you actually want — for hangouts, dates, group outings, and slow Sundays.",
  metadataBase: new URL('https://www.usemingla.com'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mochiy.variable} ${nunito.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-coral-500 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
