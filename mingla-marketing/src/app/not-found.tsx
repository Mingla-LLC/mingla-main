import Link from 'next/link';
import { Container } from '@/components/ui/Container';

export default function NotFound(): React.ReactElement {
  return (
    <Container size="md">
      <section className="flex min-h-screen flex-col items-center justify-center text-center">
        <p
          className="uppercase tracking-widest mb-mingla-md"
          style={{ fontSize: 12, color: 'var(--mingla-accent)', letterSpacing: '0.18em' }}
        >
          404
        </p>
        <h1 style={{ fontSize: 'clamp(48px, 8vw, 80px)', lineHeight: 1.1, color: 'var(--mingla-text-inverse)' }}>
          Lost the vibe.
        </h1>
        <p className="mt-mingla-lg" style={{ fontSize: 18, color: 'rgb(255 255 255 / 0.65)', maxWidth: 480 }}>
          The page you tried to find isn&apos;t here.
        </p>
        <Link
          href="/"
          className="mt-mingla-xl inline-flex items-center justify-center h-11 px-mingla-lg rounded-mingla-lg no-underline"
          style={{ background: 'var(--mingla-accent)', color: '#ffffff' }}
        >
          Take me home
        </Link>
      </section>
    </Container>
  );
}
