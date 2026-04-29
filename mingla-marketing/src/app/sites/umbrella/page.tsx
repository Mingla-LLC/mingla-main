import { Container } from '@/components/ui/Container';

/**
 * Umbrella zone home — usemingla.com
 *
 * Phase 1: hero placeholder only.
 * Phase 2 will replace with the cinematic ecosystem story (restaurant →
 * organiser → explorer → climax) using Veo 3 + Nano Banana generated assets.
 */
export default function UmbrellaHome(): React.ReactElement {
  return (
    <Container size="lg">
      <section
        className="flex flex-col items-center justify-center text-center"
        style={{ minHeight: 'calc(100vh - 200px)' }}
      >
        <p
          className="uppercase tracking-widest mb-mingla-md"
          style={{ fontSize: 12, color: 'rgb(255 255 255 / 0.55)', letterSpacing: '0.18em' }}
        >
          {/* [TRANSITIONAL] PHASE 1 placeholder — owner: ORCH-0697 Phase 2 */}
          {'<HERO PLACEHOLDER — PHASE 2>'}
        </p>
        <h1
          style={{
            fontSize: 'clamp(48px, 8vw, 96px)',
            lineHeight: 1.05,
            color: 'var(--mingla-text-inverse)',
            maxWidth: 900,
          }}
        >
          The marketing site shell is alive.
        </h1>
        <p
          className="mt-mingla-lg"
          style={{
            fontSize: 18,
            lineHeight: 1.6,
            color: 'rgb(255 255 255 / 0.65)',
            maxWidth: 640,
          }}
        >
          Phase 1 ships the empty house: subdomain routing, design tokens, audience switcher.
          Phase 2 wires up the cinematic ecosystem story with Veo 3 video and Nano Banana imagery.
        </p>
      </section>
    </Container>
  );
}
