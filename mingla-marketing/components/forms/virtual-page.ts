// #4452 §2.8 / D-5: pop-ups and inline blocks keep the URL and send a virtual
// page view (GA4 page_view and PostHog $pageview), only with analytics on.
import { formEvent } from './form-events'

export function virtualPageView(path: string): void {
  // GA4 page_view (the virtual address) and PostHog success_viewed, only with analytics on (formEvent checks).
  formEvent('success_viewed', null, { screen: path.endsWith('/booked') ? 'booked' : 'thanks', virtual_path: path })
}
