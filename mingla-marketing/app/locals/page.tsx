import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, CalendarCheck2, MapPinned, ShieldCheck, Star } from "lucide-react";
import {
  CutoutFooter,
  CutoutHeading,
  CutoutNav,
  CutoutSection,
  CutoutShell,
  CutReveal,
} from "@/components/cutout";

export const metadata: Metadata = {
  title: "Mingla Locals — One honest city review every month",
  description: "Apply to represent your city, choose one eligible place each month, publish a first-hand review and earn $150 after Mingla approves it.",
};

const steps = [
  { icon: MapPinned, title: "Choose one eligible place", body: "Pick somewhere in your city that no Mingla Local has covered recently and where you have no personal or paid connection." },
  { icon: CalendarCheck2, title: "Visit on your own terms", body: "Go during the month and pay for your own visit. The $150 monthly payment is designed to cover the outing and your work." },
  { icon: Star, title: "Publish a useful first-hand review", body: "Share a specific written review, strong photos or a short video, and your disclosed social post. Mingla reviews the work—not the place." },
];

export default function LocalsPage() {
  return (
    <CutoutShell>
      <CutoutNav surface="explorer" homeHref="/" showAction={false} />
      <main>
        <section className="relative overflow-hidden px-5 pb-20 pt-20 sm:px-8 sm:pt-28">
          <div className="mx-auto max-w-6xl">
            <CutReveal>
              <p className="mb-5 text-sm font-extrabold uppercase tracking-[0.2em] text-warm">Mingla Locals</p>
              <h1 className="max-w-5xl font-display text-5xl leading-[1.05] tracking-[-0.04em] text-text-primary sm:text-7xl lg:text-8xl">
                Help people feel a city <span className="cut-gradient-brand">before they go.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-text-secondary sm:text-xl">
                Mingla chooses up to three Locals in each open city. Complete one useful, independent place review each month and earn $150 after approval.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/download" className="inline-flex min-h-12 items-center justify-center rounded-full bg-warm px-7 font-extrabold text-white transition hover:bg-warm-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-warm">Get Mingla to apply</Link>
                <a href="#how-it-works" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-7 font-bold text-text-primary transition hover:border-white/40">How it works</a>
              </div>
            </CutReveal>
          </div>
        </section>

        <CutoutSection id="how-it-works" band="dark" aria-label="How Mingla Locals works">
          <CutReveal><CutoutHeading align="center" lede="One city. One place. One genuinely useful review each month.">Independent by design, <span className="cut-gradient-brand">paid by Mingla.</span></CutoutHeading></CutReveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
            {steps.map((step, index) => <CutReveal key={step.title} delay={index * 0.07}>
              <article className="h-full rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-7">
                <step.icon className="mb-5 h-7 w-7 text-warm" />
                <h2 className="font-display text-2xl text-text-primary">{step.title}</h2>
                <p className="mt-3 leading-7 text-text-secondary">{step.body}</p>
              </article>
            </CutReveal>)}
          </div>
        </CutoutSection>

        <CutoutSection aria-label="Mingla Local independence and payment">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-2">
            <CutReveal>
              <div className="rounded-[2rem] border border-black/10 bg-black/[0.035] p-8">
                <BadgeDollarSign className="h-9 w-9 text-warm-ink" />
                <h2 className="mt-5 font-display text-4xl text-text-primary">$150 after approval</h2>
                <p className="mt-4 leading-7 text-text-secondary">Your payout is converted into your payout currency when it is queued, shown to you, and sent through your connected payout provider. It never comes from the place you reviewed.</p>
              </div>
            </CutReveal>
            <CutReveal delay={0.08}>
              <div className="rounded-[2rem] border border-black/10 bg-black/[0.035] p-8">
                <ShieldCheck className="h-9 w-9 text-warm-ink" />
                <h2 className="mt-5 font-display text-4xl text-text-primary">Trust comes first</h2>
                <p className="mt-4 leading-7 text-text-secondary">You must disclose the Mingla Local relationship. Personal ties and recent paid work with a place make it ineligible. A place may reply publicly, but it cannot choose, pay or silence you.</p>
              </div>
            </CutReveal>
          </div>
        </CutoutSection>

        <CutoutSection band="dark" aria-label="Apply to become a Mingla Local">
          <CutReveal className="mx-auto max-w-4xl text-center">
            <h2 className="font-display text-4xl text-text-primary sm:text-6xl">Know your city well enough to make it useful?</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-text-secondary">Applications appear in Mingla only when a city is open. With three seats per city, a thoughtful sample matters more than a giant following.</p>
            <Link href="/download" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-warm px-7 font-extrabold text-white hover:bg-warm-hover">Get Mingla</Link>
          </CutReveal>
        </CutoutSection>
      </main>
      <CutoutFooter surface="explorer" />
    </CutoutShell>
  );
}
