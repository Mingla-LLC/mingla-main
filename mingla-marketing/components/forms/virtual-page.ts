// #4452 §2.8 / D-5: pop-ups and inline blocks keep the URL and send a virtual
// page view (GA4 page_view and PostHog $pageview), only with analytics on.
import { captureMarketing, isMarketingAnalyticsOn } from '@/components/marketing/marketing-capture'

export function virtualPageView(path: string): void {
  if (typeof window === 'undefined' || !isMarketingAnalyticsOn()) return
  const url = `https://usemingla.com${path}`
  try {
    ;(window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.('event', 'page_view', { page_location: url })
  } catch {
    // GA not loaded
  }
  captureMarketing('success_viewed', { screen: path.endsWith('/booked') ? 'booked' : 'thanks', virtual_path: path })
}
