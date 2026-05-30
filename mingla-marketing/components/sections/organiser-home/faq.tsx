'use client'
import { FAQAccordion, type FAQItem } from '@/components/ui/faq-accordion'
import { Reveal } from '@/components/ui/reveal'

// ORCH-1010 — answer real objections honestly. The two fabricated answers
// (performance-based pricing SLA, one-week placements) are GONE. No price/SLA
// chrome. Q5/Q7 market ONLY shipped capabilities (native all-in checkout with
// tax/fee toggle; Marketing Hub Phase A email).

const FAQS: FAQItem[] = [
  {
    q: 'How does Mingla decide who to show your place to?',
    a: "Mingla learns what people are in the mood for — the vibe, the timing, the budget, the kind of night they're planning — and surfaces the places and events that actually fit. The match isn't “they're nearby.” It's “this is the one they've been looking for.”",
  },
  {
    q: 'What kinds of businesses is Mingla for?',
    a: 'Restaurants, bars, cafés, clubs, activity venues, galleries, comedy clubs, taprooms, markets, ticketed events and pop-ups — and the whole experience economy: cooking classes, horseback rides, tours, day trips, tastings, and outdoor adventures. If people gather to do a thing, Mingla is for you.',
  },
  {
    q: 'How is this different from a listing or an ad?',
    a: 'A listing says you exist. An ad rents you attention for a moment. Mingla shows people why you’re worth choosing tonight — your vibe, your story, the reason — and puts it in front of people whose plans already fit. You’re not buying impressions. You’re getting found by the right people.',
  },
  {
    q: 'Do I have to build everything myself?',
    a: 'No. You bring the raw material — your photos, your menu, your event, your experience — and Mingla helps you shape it into a page and a story people understand instantly. The heavy lifting of getting discovered is on us.',
  },
  {
    q: 'Can people actually book and pay through Mingla?',
    a: 'Yes. Sell tickets, tables, and packages with checkout built right in — one all-in price up front, no address typing, no surprise fees at the end. You choose whether to pass on taxes and fees or absorb them; buyers always see the real total before they pay.',
  },
  {
    q: 'Can I see who showed up?',
    a: 'Yes. Your dashboard shows the guest list, check-ins, and what sold — so you know which nights, offers, and crowds are working, and can do more of what does.',
  },
  {
    q: 'Can I reach my own customers, too?',
    a: 'Yes. Mingla can send email campaigns to the people who’ve already bought from you or your events — no list to build, no separate tool. The audience is already there; you just hit send.',
  },
  {
    q: 'Does Mingla replace my other marketing?',
    a: 'No — it makes the rest of it work harder. Your menu, your vibe, your events, your story become reasons people choose you. Keep your other channels; Mingla is the layer that turns all of it into people actually showing up.',
  },
]

export function OrganiserFaq() {
  return (
    <section className="seam-top px-6 py-24 md:px-10 md:py-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <div className="flex flex-col gap-4">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
              Common questions
            </span>
            <h2 className="font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-5xl">
              before we get on a call.
            </h2>
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-12">
            <FAQAccordion items={FAQS} />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
