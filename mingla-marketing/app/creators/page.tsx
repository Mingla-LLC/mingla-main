import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, Camera, CheckCircle2, Sparkles, WandSparkles } from "lucide-react";
import {
  CutoutFooter,
  CutoutHeading,
  CutoutNav,
  CutoutSection,
  CutoutShell,
  CutReveal,
} from "@/components/cutout";

export const metadata: Metadata = {
  title: "Mingla Creators — Get hired to show people what a city feels like",
  description: "Create short videos for Mingla hosts, agree the work before the shoot, deliver privately and get paid through your connected payout provider.",
};

const outcomes = [
  { icon: <Sparkles className="h-6 w-6" />, title: "Choose work that fits", body: "See the city, format, dates and budget before you raise your hand. Host names stay private until a hire is agreed." },
  { icon: <Camera className="h-6 w-6" />, title: "Know the shot before you go", body: "Every gig becomes a clear shoot plan with the promised format, deliverables, tags and posting date." },
  { icon: <BadgeDollarSign className="h-6 w-6" />, title: "Get paid to your provider", body: "Your contract, delivery and payout status stay together. Mingla does not turn your earnings into a wallet balance." },
];

export default function CreatorsPage() {
  return (
    <CutoutShell>
      <CutoutNav surface="host" homeHref="/creators" />
      <main>
        <section className="relative overflow-hidden px-5 pb-20 pt-20 sm:px-8 sm:pt-28">
          <div className="mx-auto max-w-6xl">
            <CutReveal>
              <p className="mb-5 text-sm font-extrabold uppercase tracking-[0.2em] text-warm">Mingla Creators</p>
              <h1 className="max-w-5xl font-display text-5xl leading-[1.05] tracking-[-0.04em] text-text-primary sm:text-7xl lg:text-8xl">
                Show people what a city <span className="cut-gradient-brand">feels like.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-text-secondary sm:text-xl">
                Hosts hire you for a clear short-video format. You agree the work, get a private shoot plan, deliver securely and track what happens next.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="https://host.usemingla.com/creator/setup" className="inline-flex min-h-12 items-center justify-center rounded-full bg-warm px-7 font-extrabold text-white transition hover:bg-warm-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-warm">
                  Set up my creator profile
                </Link>
                <a href="#how-it-works" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-7 font-bold text-text-primary transition hover:border-white/40">
                  See how it works
                </a>
              </div>
            </CutReveal>
          </div>
        </section>

        <CutoutSection id="how-it-works" band="dark" aria-label="How the creator program works">
          <CutReveal><CutoutHeading align="center" lede="No vague briefs. No guessing what counts as done.">A job from first look to <span className="cut-gradient-brand">paid.</span></CutoutHeading></CutReveal>
          <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
            {outcomes.map((item, index) => <CutReveal key={item.title} delay={index * 0.07}>
              <article className="h-full rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-7">
                <div className="mb-5 inline-flex rounded-2xl bg-warm/15 p-3 text-warm">{item.icon}</div>
                <h2 className="font-display text-2xl text-text-primary">{item.title}</h2>
                <p className="mt-3 leading-7 text-text-secondary">{item.body}</p>
              </article>
            </CutReveal>)}
          </div>
        </CutoutSection>

        <CutoutSection aria-label="Creator safeguards">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <CutReveal>
              <CutoutHeading>Built so both sides know <span className="cut-gradient-brand">what was promised.</span></CutoutHeading>
            </CutReveal>
            <CutReveal delay={0.08}>
              <div className="space-y-4">
                {["Your public profile never exposes your birthday or payout details.", "A host sees your contact details only after a hire.", "Terms are versioned, so a change needs both sides to accept again.", "Provider-blocked social checks go to a person—never a silent pass.", "Original showcase uploads are not kept after processing."].map((line) => <div key={line} className="flex gap-3 rounded-2xl border border-black/10 bg-black/[0.035] p-4 text-text-primary"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-warm-ink" /><span>{line}</span></div>)}
              </div>
            </CutReveal>
          </div>
        </CutoutSection>

        <CutoutSection band="dark" aria-label="Creator call to action">
          <CutReveal className="mx-auto max-w-4xl text-center">
            <WandSparkles className="mx-auto h-9 w-9 text-warm" />
            <h2 className="mt-5 font-display text-4xl text-text-primary sm:text-6xl">Your next good story may already be on the board.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-text-secondary">Build your profile now. Creator mode stays private until every readiness check is complete.</p>
            <Link href="https://host.usemingla.com/creator/setup" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-warm px-7 font-extrabold text-white hover:bg-warm-hover">Start creator setup</Link>
          </CutReveal>
        </CutoutSection>
      </main>
      <CutoutFooter surface="host" />
    </CutoutShell>
  );
}
