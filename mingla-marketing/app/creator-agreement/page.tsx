import Link from "next/link";
import type { Metadata } from "next";
import {
  CREATOR_AGREEMENT_SECTIONS,
  CREATOR_AGREEMENT_SHA256,
  CREATOR_AGREEMENT_STATUS,
  CREATOR_AGREEMENT_VERSION,
  creatorAgreementHeading,
} from "@/lib/creatorAgreementContent";

export const metadata: Metadata = {
  title: "Mingla Creator Program Agreement",
  description: "The complete agreement for the Mingla Creator programme.",
  alternates: { canonical: "/creator-agreement" },
  robots: { index: true, follow: true },
};

const linkClass =
  "font-semibold text-warm underline-offset-4 hover:underline focus-ring";

export default function CreatorAgreementPage() {
  return (
    <main
      id="main"
      className="relative min-h-screen overflow-hidden bg-[#08090b] px-5 py-8 text-text-primary sm:px-8 sm:py-10"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,rgba(235,120,37,0.18),transparent_32%),radial-gradient(ellipse_at_84%_18%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,#08090b_0%,#0d0d10_58%,#07080a_100%)]" />
        <div className="absolute inset-0 opacity-[0.09] [background-image:linear-gradient(rgba(235,120,37,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>
      <div className="relative mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="mb-8 inline-flex min-h-10 items-center rounded-full border border-white/12 bg-white/8 px-4 text-sm font-semibold text-text-secondary transition hover:bg-white/12 hover:text-text-primary focus-ring"
        >
          Back to Mingla
        </Link>
        <article className="rounded-[28px] border border-white/12 bg-[#0d0d10]/94 p-6 shadow-[0_40px_120px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
            {CREATOR_AGREEMENT_STATUS} · Version {CREATOR_AGREEMENT_VERSION}
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-6xl">
            Mingla Creator Program Agreement
          </h1>
          <p className="mt-4 text-sm leading-7 text-white/72 sm:text-base">
            Read every section before accepting in Mingla Explorer.
          </p>
          <p className="mt-3 break-all text-xs leading-5 text-white/48">
            Agreement fingerprint: {CREATOR_AGREEMENT_SHA256}
          </p>
          <nav
            aria-labelledby="creator-agreement-contents"
            className="mt-8 rounded-3xl border border-white/12 bg-black/20 p-5"
          >
            <h2
              id="creator-agreement-contents"
              className="font-display text-xl leading-tight text-white/95"
            >
              Contents
            </h2>
            <ol className="mt-3 space-y-1.5 text-sm leading-6">
              {CREATOR_AGREEMENT_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="text-white/76 underline-offset-4 hover:text-warm hover:underline focus-ring"
                  >
                    {creatorAgreementHeading(section)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="mt-8 space-y-8">
            {CREATOR_AGREEMENT_SECTIONS.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-6 space-y-3"
              >
                <h2 className="font-display text-xl leading-tight text-white/95 sm:text-2xl">
                  {creatorAgreementHeading(section)}
                </h2>
                <div className="space-y-3 text-sm leading-7 text-white/72 sm:text-base">
                  {section.blocks.map((block, index) =>
                    block.type === "list" ? (
                      <ul key={index} className="space-y-2 pl-5">
                        {block.items.map((item) => (
                          <li
                            key={item}
                            className="list-disc marker:text-warm/80"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p key={index}>{block.text}</p>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
          <footer className="mt-10 border-t border-white/12 pt-6 text-sm leading-6 text-white/60">
            This page adds to Mingla’s{" "}
            <Link href="/terms-of-service" className={linkClass}>
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy" className={linkClass}>
              Privacy Policy
            </Link>
            . Questions:{" "}
            <a href="mailto:legal@usemingla.com" className={linkClass}>
              legal@usemingla.com
            </a>
            .
          </footer>
        </article>
      </div>
    </main>
  );
}
