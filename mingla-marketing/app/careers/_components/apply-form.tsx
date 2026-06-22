'use client'
// META-ORCH-1222 [Careers site] — application form (DESIGN §4). Pre-bound to the
// role slug. Six required fields + a CvDropzone. Client validation (UX-only;
// server re-validates all six). Submit sequence: read CV → base64 → POST. Maps
// results to success (replace form) / error-with-retry (never clears inputs,
// never false success).

import { useCallback, useRef, useState } from 'react'
import { Check, FileText, Loader2, UploadCloud, X } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import {
  fileToBase64,
  submitCareersApplication,
  type CareersApplyResult,
} from '@/lib/careers-apply-submit'
import { GhostCtaLink, SolidCtaButton } from './careers-button'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CV_MIME_ALLOW = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const CV_MAX_BYTES = 5 * 1024 * 1024
const CV_ACCEPT =
  'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.doc,.docx'

type FieldKey =
  | 'full_name'
  | 'email'
  | 'whatsapp_phone'
  | 'preferred_salary'
  | 'portfolio_url'
  | 'cv'

type Errors = Partial<Record<FieldKey, string>>

const ERROR_COPY: Record<FieldKey, string> = {
  full_name: 'Tell us your name.',
  email: 'Enter a valid email.',
  whatsapp_phone: 'Enter a valid WhatsApp number with country code.',
  preferred_salary: 'Tell us your preferred salary.',
  portfolio_url: 'Enter a valid link (starting with http or https).',
  cv: 'Add your CV (PDF or Word, up to 5 MB).',
}

function isValidWhatsApp(v: string): boolean {
  const trimmed = v.trim().replace(/[\s()-]/g, '')
  const m = trimmed.match(/^\+?(\d+)$/)
  return !!m && m[1].length >= 7 && m[1].length <= 20
}
function isValidUrl(v: string): boolean {
  if (v.length < 4 || v.length > 2048) return false
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function fieldLabel(key: FieldKey): string {
  switch (key) {
    case 'full_name':
      return 'Full name'
    case 'email':
      return 'Email'
    case 'whatsapp_phone':
      return 'WhatsApp phone'
    case 'preferred_salary':
      return 'Preferred salary'
    case 'portfolio_url':
      return 'Portfolio link'
    case 'cv':
      return 'CV'
  }
}

const inputBase =
  'h-12 w-full rounded-xl px-3.5 text-[15px] outline-none transition-shadow ' +
  'focus:ring-[3px] disabled:opacity-60'

function ErrorSlot({ msg }: { msg?: string }) {
  return (
    <div className="min-h-[18px] pt-1">
      {msg ? (
        <p className="text-[12.5px]" style={{ color: 'var(--danger-500)' }} role="alert">
          {msg}
        </p>
      ) : null}
    </div>
  )
}

export function ApplyForm({ slug, roleTitle }: { slug: string; roleTitle: string }) {
  const reduced = useMinglaReducedMotion()
  const [values, setValues] = useState({
    full_name: '',
    email: '',
    whatsapp_phone: '',
    preferred_salary: '',
    portfolio_url: '',
  })
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<{ tone: 'danger'; msg: string } | null>(null)
  const [done, setDone] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const firstNameRef = useRef('')

  const validateField = useCallback(
    (key: FieldKey, vals = values, file = cvFile): string | undefined => {
      switch (key) {
        case 'full_name':
          return vals.full_name.trim().length >= 1 && vals.full_name.trim().length <= 80
            ? undefined
            : ERROR_COPY.full_name
        case 'email':
          return EMAIL_RE.test(vals.email.trim()) && vals.email.trim().length <= 254
            ? undefined
            : ERROR_COPY.email
        case 'whatsapp_phone':
          return isValidWhatsApp(vals.whatsapp_phone) ? undefined : ERROR_COPY.whatsapp_phone
        case 'preferred_salary':
          return vals.preferred_salary.trim().length >= 1 && vals.preferred_salary.trim().length <= 60
            ? undefined
            : ERROR_COPY.preferred_salary
        case 'portfolio_url':
          return isValidUrl(vals.portfolio_url.trim()) ? undefined : ERROR_COPY.portfolio_url
        case 'cv':
          if (!file) return ERROR_COPY.cv
          if (!CV_MIME_ALLOW.includes(file.type)) {
            return "That file type isn't supported — use PDF or Word."
          }
          if (file.size > CV_MAX_BYTES) return "That file's too big — keep it under 5 MB."
          return undefined
      }
    },
    [values, cvFile],
  )

  const setField = (key: keyof typeof values, v: string) => {
    const next = { ...values, [key]: v }
    setValues(next)
    if (touched[key as FieldKey]) {
      setErrors((e) => ({ ...e, [key]: validateField(key as FieldKey, next) }))
    }
  }

  const blurField = (key: FieldKey) => {
    setTouched((t) => ({ ...t, [key]: true }))
    setErrors((e) => ({ ...e, [key]: validateField(key) }))
  }

  const onPickFile = (file: File | null) => {
    setCvFile(file)
    setTouched((t) => ({ ...t, cv: true }))
    setErrors((e) => ({ ...e, cv: validateField('cv', values, file) }))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0] ?? null
    if (file) onPickFile(file)
  }

  const validateAll = (): Errors => {
    const keys: FieldKey[] = [
      'full_name',
      'email',
      'whatsapp_phone',
      'preferred_salary',
      'portfolio_url',
      'cv',
    ]
    const next: Errors = {}
    for (const k of keys) {
      const msg = validateField(k)
      if (msg) next[k] = msg
    }
    return next
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBanner(null)
    const allErrors = validateAll()
    setTouched({
      full_name: true,
      email: true,
      whatsapp_phone: true,
      preferred_salary: true,
      portfolio_url: true,
      cv: true,
    })
    setErrors(allErrors)
    const firstInvalid = (
      ['full_name', 'email', 'whatsapp_phone', 'preferred_salary', 'cv', 'portfolio_url'] as FieldKey[]
    ).find((k) => allErrors[k])
    if (firstInvalid) {
      setBanner({ tone: 'danger', msg: 'Please fix the highlighted fields.' })
      const el = document.getElementById(`field-${firstInvalid}`)
      el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
      el?.focus?.()
      return
    }
    if (!cvFile) return

    setSubmitting(true)
    firstNameRef.current = values.full_name.trim().split(/\s+/)[0] || values.full_name.trim()
    try {
      const cv_base64 = await fileToBase64(cvFile)
      const result: CareersApplyResult = await submitCareersApplication({
        job_slug: slug,
        full_name: values.full_name.trim(),
        email: values.email.trim(),
        whatsapp_phone: values.whatsapp_phone.trim(),
        preferred_salary: values.preferred_salary.trim(),
        portfolio_url: values.portfolio_url.trim(),
        cv_base64,
        cv_filename: cvFile.name,
        cv_mime: cvFile.type,
      })

      if (result.ok) {
        setDone(true)
        return
      }
      if (result.error === 'validation') {
        // Map server fields[] to inputs (server is the authority).
        const mapped: Errors = {}
        for (const f of result.fields ?? []) {
          if (f === 'job_slug') {
            setBanner({ tone: 'danger', msg: 'This role is no longer open.' })
            continue
          }
          if (f in ERROR_COPY) mapped[f as FieldKey] = ERROR_COPY[f as FieldKey]
        }
        if (Object.keys(mapped).length > 0) {
          setErrors((prev) => ({ ...prev, ...mapped }))
          setBanner({ tone: 'danger', msg: 'Please fix the highlighted fields.' })
        }
      } else if (result.error === 'rate_limited') {
        setBanner({
          tone: 'danger',
          msg: "You've submitted a few times — give it a few minutes and try again.",
        })
      } else {
        setBanner({
          tone: 'danger',
          msg: 'Something went wrong sending your application. Your details are still here — tap to try again.',
        })
      }
    } catch {
      setBanner({
        tone: 'danger',
        msg: 'Something went wrong sending your application. Your details are still here — tap to try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: 'var(--coral-050)' }}
        >
          <Check size={28} style={{ color: 'var(--success-500)' }} />
        </div>
        <h2 className="mt-4 font-[family-name:var(--font-mochiy)] text-[24px]" style={{ color: 'var(--ink)' }}>
          Application received.
        </h2>
        <p className="mx-auto mt-2 max-w-[46ch] text-[16px] leading-[1.6]" style={{ color: 'var(--ink-muted)' }}>
          Thanks, {firstNameRef.current} — we&apos;ve got your application for {roleTitle}. We review every
          one and reach out by email if there&apos;s a fit. Keep an eye on your inbox.
        </p>
        <div className="mt-6 flex justify-center">
          <GhostCtaLink href="/">Back to all roles</GhostCtaLink>
        </div>
      </div>
    )
  }

  const inputStyle = (key: FieldKey) => ({
    border: `1px solid ${errors[key] ? 'var(--danger-500)' : 'var(--border)'}`,
    boxShadow: undefined,
  })

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-2xl p-5 sm:p-7"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {banner ? (
        <div
          className="mb-5 rounded-xl px-4 py-3 text-[14px]"
          style={{
            background: 'rgba(214,69,69,0.08)',
            color: 'var(--danger-500)',
            border: '1px solid rgba(214,69,69,0.25)',
          }}
          role="alert"
        >
          {banner.msg}
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        {/* Full name */}
        <div>
          <label htmlFor="field-full_name" className="block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {fieldLabel('full_name')} <span style={{ color: 'var(--coral-500)' }}>*</span>
          </label>
          <input
            id="field-full_name"
            type="text"
            className={`${inputBase} mt-1.5 focus:ring-[var(--coral-050)]`}
            style={inputStyle('full_name')}
            value={values.full_name}
            onChange={(e) => setField('full_name', e.target.value)}
            onBlur={() => blurField('full_name')}
            disabled={submitting}
            aria-required="true"
            aria-invalid={!!errors.full_name}
            aria-describedby="err-full_name"
          />
          <span id="err-full_name">
            <ErrorSlot msg={errors.full_name} />
          </span>
        </div>

        {/* Email */}
        <div>
          <label htmlFor="field-email" className="block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {fieldLabel('email')} <span style={{ color: 'var(--coral-500)' }}>*</span>
          </label>
          <input
            id="field-email"
            type="email"
            inputMode="email"
            className={`${inputBase} mt-1.5 focus:ring-[var(--coral-050)]`}
            style={inputStyle('email')}
            value={values.email}
            onChange={(e) => setField('email', e.target.value)}
            onBlur={() => blurField('email')}
            disabled={submitting}
            aria-required="true"
            aria-invalid={!!errors.email}
            aria-describedby="err-email"
          />
          <span id="err-email">
            <ErrorSlot msg={errors.email} />
          </span>
        </div>

        {/* WhatsApp phone */}
        <div>
          <label htmlFor="field-whatsapp_phone" className="block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {fieldLabel('whatsapp_phone')} <span style={{ color: 'var(--coral-500)' }}>*</span>
          </label>
          <input
            id="field-whatsapp_phone"
            type="tel"
            inputMode="tel"
            placeholder="+234…"
            className={`${inputBase} mt-1.5 focus:ring-[var(--coral-050)]`}
            style={inputStyle('whatsapp_phone')}
            value={values.whatsapp_phone}
            onChange={(e) => setField('whatsapp_phone', e.target.value)}
            onBlur={() => blurField('whatsapp_phone')}
            disabled={submitting}
            aria-required="true"
            aria-invalid={!!errors.whatsapp_phone}
            aria-describedby="err-whatsapp_phone help-whatsapp"
          />
          {!errors.whatsapp_phone ? (
            <p id="help-whatsapp" className="pt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              Include your country code, e.g. +234…
            </p>
          ) : (
            <span id="err-whatsapp_phone">
              <ErrorSlot msg={errors.whatsapp_phone} />
            </span>
          )}
        </div>

        {/* Preferred salary */}
        <div>
          <label htmlFor="field-preferred_salary" className="block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {fieldLabel('preferred_salary')} <span style={{ color: 'var(--coral-500)' }}>*</span>
          </label>
          <input
            id="field-preferred_salary"
            type="text"
            placeholder="e.g. ₦200,000/month"
            className={`${inputBase} mt-1.5 focus:ring-[var(--coral-050)]`}
            style={inputStyle('preferred_salary')}
            value={values.preferred_salary}
            onChange={(e) => setField('preferred_salary', e.target.value)}
            onBlur={() => blurField('preferred_salary')}
            disabled={submitting}
            aria-required="true"
            aria-invalid={!!errors.preferred_salary}
            aria-describedby="err-preferred_salary"
          />
          <span id="err-preferred_salary">
            <ErrorSlot msg={errors.preferred_salary} />
          </span>
        </div>

        {/* CV dropzone */}
        <div>
          <span className="block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {fieldLabel('cv')} <span style={{ color: 'var(--coral-500)' }}>*</span>
          </span>
          <input
            ref={fileInputRef}
            id="field-cv"
            type="file"
            accept={CV_ACCEPT}
            className="sr-only"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            disabled={submitting}
          />
          {cvFile ? (
            <div
              className="mt-1.5 flex items-center gap-3 rounded-xl px-3.5 py-3"
              style={{ background: 'var(--coral-050)' }}
            >
              <FileText size={20} style={{ color: 'var(--coral-500)' }} />
              <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: 'var(--ink)' }}>
                {cvFile.name}
              </span>
              <span className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                {(cvFile.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                type="button"
                onClick={() => onPickFile(null)}
                aria-label="Remove CV"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/60"
                disabled={submitting}
              >
                <X size={16} style={{ color: 'var(--ink-muted)' }} />
              </button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload your CV"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className="mt-1.5 flex cursor-pointer flex-col items-center rounded-xl px-6 py-7 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral-500)]"
              style={{
                border: `1.5px dashed ${
                  errors.cv ? 'var(--danger-500)' : dragOver ? 'var(--coral-500)' : 'var(--border)'
                }`,
                background: dragOver ? 'var(--coral-050)' : 'transparent',
                transform: dragOver ? 'scale(1.01)' : 'scale(1)',
              }}
            >
              <UploadCloud size={28} style={{ color: 'var(--ink-muted)' }} />
              <p className="mt-2 text-[14px]" style={{ color: 'var(--ink)' }}>
                Drop your CV here or <span style={{ color: 'var(--coral-500)' }}>browse</span>
              </p>
              <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                PDF or Word, up to 5 MB.
              </p>
            </div>
          )}
          <span id="err-cv">
            <ErrorSlot msg={errors.cv} />
          </span>
        </div>

        {/* Portfolio link */}
        <div>
          <label htmlFor="field-portfolio_url" className="block text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {fieldLabel('portfolio_url')} <span style={{ color: 'var(--coral-500)' }}>*</span>
          </label>
          <input
            id="field-portfolio_url"
            type="url"
            inputMode="url"
            placeholder="https://…"
            className={`${inputBase} mt-1.5 focus:ring-[var(--coral-050)]`}
            style={inputStyle('portfolio_url')}
            value={values.portfolio_url}
            onChange={(e) => setField('portfolio_url', e.target.value)}
            onBlur={() => blurField('portfolio_url')}
            disabled={submitting}
            aria-required="true"
            aria-invalid={!!errors.portfolio_url}
            aria-describedby="err-portfolio_url"
          />
          <span id="err-portfolio_url">
            <ErrorSlot msg={errors.portfolio_url} />
          </span>
        </div>
      </div>

      <div className="mt-7 flex sm:justify-end">
        <SolidCtaButton type="submit" disabled={submitting} className="w-full sm:w-auto">
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {banner ? 'Try again' : 'Submitting…'}
            </>
          ) : banner ? (
            'Try again'
          ) : (
            'Submit application'
          )}
        </SolidCtaButton>
      </div>
    </form>
  )
}
