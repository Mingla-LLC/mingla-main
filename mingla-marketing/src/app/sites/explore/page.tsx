import { Container } from '@/components/ui/Container';

/**
 * Explore zone home — explore.usemingla.com
 *
 * Phase 1: hero placeholder. Phase 3 builds the full Explorer pitch with
 * every consumer feature highlighted + real-people imagery.
 */
export default function ExploreHome(): React.ReactElement {
  return (
    <Container size="lg">
      <section
        className="flex flex-col items-center justify-center text-center"
        style={{ minHeight: 'calc(100vh - 200px)' }}
      >
        <p
          className="uppercase tracking-widest mb-mingla-md"
          style={{ fontSize: 12, color: 'var(--mingla-accent)', letterSpacing: '0.18em' }}
        >
          {/* [TRANSITIONAL] PHASE 1 placeholder — owner: ORCH-0697 Phase 3 */}
          {'<EXPLORER HERO PLACEHOLDER — PHASE 3>'}
        </p>
        <h1
          style={{
            fontSize: 'clamp(48px, 8vw, 96px)',
            lineHeight: 1.05,
            color: 'var(--mingla-text-inverse)',
            maxWidth: 900,
          }}
        >
          For Explorers.
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
          Find places and events that match your vibe. Phase 3 ships every Explorer feature
          with cinematic real-people imagery.
        </p>
      </section>
    </Container>
  );
}
