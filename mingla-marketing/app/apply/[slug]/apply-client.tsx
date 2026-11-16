'use client'
// #4452 §2.6 — the form on its own page; after the server's 200 the browser
// goes to /apply/<slug>/thanks (a real, noindex page). The first name rides in
// sessionStorage only, never in the URL.
import { useRouter } from 'next/navigation'
import { FormRenderer, type RendererForm } from '@/components/forms/form-renderer'
import type { PublicForm } from '@/lib/site-pages/model'
import { setBookingHandoff } from '@/lib/forms/booking'

export function ApplyClient({ form, slug }: { form: PublicForm; slug: string }) {
  const router = useRouter()
  return (
    <FormRenderer
      form={form as unknown as RendererForm}
      placement="form_page"
      sendLabel="Send application"
      onDone={(o, first, booking) => {
        // §2.8: the answers for in-form booking stay in memory for the thanks page (never stored, never in the URL).
        setBookingHandoff({ basics: booking ?? null, submissionId: o.submissionId, first, audience: form.audience })
        try {
          window.sessionStorage.setItem('mingla:apply-done', JSON.stringify({ first, sub: o.submissionId, audience: form.audience }))
        } catch {
          // storage off: the thanks page says "You're in."
        }
        router.push(`/apply/${slug}/thanks`)
      }}
    />
  )
}
