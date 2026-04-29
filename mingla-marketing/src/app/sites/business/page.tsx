import { Container } from '@/components/ui/Container';

/**
 * Business zone home — business.usemingla.com
 *
 * Phase 1: hero placeholder. Phase 4 builds the operator pitch with the
 * giant 90% as the hero centerpiece (operators keep 90% of earnings).
 */
export default function BusinessHome(): React.ReactElement {
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
          {/* [TRANSITIONAL] PHASE 1 placeholder — owner: ORCH-0697 Phase 4 */}
          {'<BUSINESS HERO PLACEHOLDER — PHASE 4: 90% CENTERPIECE>'}
        </p>
        <h1
          style={{
            fontSize: 'clamp(48px, 8vw, 96px)',
            lineHeight: 1.05,
            color: 'var(--mingla-text-inverse)',
            maxWidth: 900,
          }}
        >
          For Organisers.
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
          Fill seats fast. Keep 90% of your earnings. Phase 4 makes the 90 the hero.
        </p>
      </section>
    </Container>
  );
}
