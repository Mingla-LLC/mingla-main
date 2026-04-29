import { Nav } from '@/components/chrome/Nav';
import { Footer } from '@/components/chrome/Footer';
import { getZoneFromHeaders } from '@/lib/getZoneFromHeaders';

export default async function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { zone, isDev } = await getZoneFromHeaders();
  return (
    <div className="min-h-screen flex flex-col">
      <Nav activeZone={zone} isDev={isDev} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
