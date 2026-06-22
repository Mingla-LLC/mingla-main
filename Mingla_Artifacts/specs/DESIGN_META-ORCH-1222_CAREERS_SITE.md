# DESIGN CONTRACT — META-ORCH-1222 Careers Site (`career.usemingla.com`)

> Produced by mingla-designer (2026-06-22). Embed verbatim into the SPEC under Leg 3 → Component layer.
> Web-only (Next.js 15 app router, Tailwind v4, framer-motion). No mobile/RN surface.
> All copy in Mingla voice: confident, modern, concrete, never corporate.
> Light-mode-only by design (matches the live marketing site). No Android glass policy (no RN surface).

## 0. Design tokens (carried from the live marketing brand)

Mirror the existing `mingla-marketing` brand (root `layout.tsx` fonts + email `shell.ts` palette).
Reuse existing Tailwind theme tokens where present; add the few named below.

| Token | Value | Use |
|---|---|---|
| `--coral-500` | `#FF6B2C` | Primary accent, CTAs, links, focus ring |
| `--coral-600` | `#E85D1F` | CTA hover/press |
| `--coral-050` | `#FFF6F1` | Soft accent surface (chips, card hover wash) |
| `--ink` | `#0F1115` | Primary text, headings |
| `--ink-muted` | `#5B6172` | Secondary text, meta, captions |
| `--border` | `#ECECEE` | Hairline borders, card outline |
| `--surface` | `#FFFFFF` | Card / panel surface |
| `--page-bg` | `#F5F5F7` | Page background (matches email outer) |
| `--success-500` | `#1FA971` | Success state check |
| `--danger-500` | `#D64545` | Validation error text/border |
| Font display | `var(--font-mochiy)` Mochiy Pop One 400 | Page H1, role title hero |
| Font body | `var(--font-nunito)` Nunito Sans 400/600/700 | Body copy, JD, card text |
| Font UI | `var(--font-inter)` Inter 400/500/600 | Meta chips, form labels, buttons, salary |

**Spacing grid:** 4pt base; section rhythm on 8/16/24/32/48/64. **Radius:** card `16px`, chip `999px`, input `12px`, button `999px`. **Shadow:** card resting `0 1px 2px rgba(15,17,21,0.04)`; card hover `0 12px 28px rgba(15,17,21,0.10)`. **Max content width:** `1120px` index, `760px` detail/form (reading measure ≤72ch on JD body).

**Breakpoints:** mobile `<640`, tablet `640–1023`, desktop `≥1024`.

**Dark mode:** Not required for v1 — light-only (matches `color-scheme: light only` in the email shell and the live marketing site). Do not invert.

---

## 1. Shared chrome — Careers nav + footer

A **dedicated lightweight glass header** for the careers subdomain (do NOT reuse the product `GlassNav` with its app-marketing links — careers is a standalone property).

- **Header:** sticky top, height `64px`, `backdrop-filter: blur(16px) saturate(140%)`, background `rgba(255,255,255,0.72)`, bottom hairline `--border`. Left: Mingla wordmark/logo (links to `https://usemingla.com`). Right: single text link "All roles" → `/`. On scroll past `8px`, raise shadow `0 1px 0 rgba(15,17,21,0.06)`.
- **Footer:** muted, `--page-bg`, `48px` vertical padding. Mingla logo (100px), one line "Mingla — find something to do.", social row reusing the existing marketing footer links, and `© {year} Mingla LLC`. No email shown (applications go through the form only).

---

## 2. Surface 1 — Careers index (`/`) : the scalable role card list

### 2.1 IA & flow
Visitor moment: "Does Mingla have a role for me?" One decision: **which role to open**. Hierarchy: brand hook → role cards → (per card) "View role". Adding a `job_postings` row with `status='open'` = one more card, no code change.

### 2.2 Layout
- **Hero block** (top, centered, max `720px`):
  - Eyebrow (Inter 600, `13px`, letter-spacing `0.08em`, uppercase, `--coral-500`): `WE'RE HIRING`.
  - H1 (Mochiy Pop One, clamp `32px → 44px`, line-height `1.12`, `--ink`): "Build Mingla with us."
  - Subhead (Nunito Sans, `18px`, line-height `1.6`, `--ink-muted`, max `60ch`): "We're a small, fast team making it easier to find something to do — in the US and Nigeria. Remote, high-ownership, real work."
  - Top padding `64px` desktop / `40px` mobile; gap to grid `48px`.
- **Card grid:** CSS grid, `gap: 24px`. Columns: desktop `repeat(2, 1fr)`; tablet `repeat(2, 1fr)`; mobile `1fr`. (2-up max keeps cards generous; scales to N rows.)
- Cards ordered by `sort_order ASC, created_at DESC`.

### 2.3 Role card anatomy (component `RoleCard`)
Surface `--surface`, radius `16px`, border `1px --border`, resting shadow, padding `28px`. Full card is one link (`<a href="/roles/{slug}">`).

1. **Meta chip row** (gap `8px`, wrap): department + location + employment-type chips. Each: Inter 500, `12.5px`, `--ink-muted`, bg `--coral-050`, padding `4px 10px`, radius `999px`. Employment type renders human ("Full-time" from `full_time`).
2. **Title** (Mochiy Pop One, `22px`, line-height `1.25`, `--ink`), margin-top `14px`.
3. **Summary** (Nunito Sans, `15.5px`, line-height `1.6`, `--ink-muted`), clamp 3 lines, margin-top `8px`.
4. **Divider** hairline `--border`, margin `20px 0 16px`.
5. **Footer row** (flex, space-between, center):
   - **Salary** (Inter 600, `15px`, `--ink`): renders `salary_display` verbatim (`₦150,000–₦250,000/month`). Shown PUBLICLY per Seth's lock.
   - **CTA affordance** (Inter 600, `14px`, `--coral-500`): "View role" + `16px` lucide `ArrowRight`.

### 2.4 States
- **Loading:** 2 (desktop) / 1 (mobile) `RoleCardSkeleton` — same dimensions, shimmer meta row, `70%` title bar, three summary lines, footer bar. Shimmer = background-position sweep `1.4s` linear infinite (disabled under reduced-motion → static blocks).
- **Empty (zero open roles):** centered panel, max `460px`. Mark (coral briefcase or Mingla logo mark `48px`, low opacity). Headline (Mochiy `22px`): "No open roles right now." Body (Nunito `15.5px`, `--ink-muted`): "We're not hiring at the moment — but we grow fast. Check back soon." No CTA. Must feel intentional.
- **Error (fetch failed):** same layout. Headline: "We couldn't load the roles." Body: "That's on us. Give it another shot." Secondary "Try again" ghost button (coral text, `1px --coral-500` border, radius `999px`, `10px 18px`).

### 2.5 Motion
- Cards fade+rise on mount: opacity `0→1`, translateY `12px→0`, spring `{ stiffness: 260, damping: 30 }`, stagger `60ms`/card (cap 6).
- Card hover (pointer:fine only): shadow resting→hover `180ms ease-out`, translateY `0→-2px`, arrow translateX `0→4px`. Transform-only, no layout shift.
- Reduced-motion: opacity-only `120ms`, no hover translate.

---

## 3. Surface 2 — Role detail (`/roles/[slug]`) : the JD page

### 3.1 IA & flow
Moment: "Is this role for me, and how do I apply?" Primary action: **Apply** (always reachable). Invalid/closed slug → "role not found".

### 3.2 Layout (single column, max `760px`, centered)
1. **Back link:** "← All roles" (Inter 500, `14px`, `--ink-muted`, hover `--coral-500`), margin-bottom `24px`.
2. **Header block:** meta chip row; H1 title (Mochiy, clamp `30px → 40px`, line-height `1.15`); salary line (Inter 600, `17px`, `--ink`) with coral dot prefix, margin-top `10px`: `₦150,000–₦250,000/month`.
3. **Primary Apply CTA** (under header): solid coral "Apply for this role" → `/roles/[slug]/apply`. Inter 600, `16px`, padding `14px 28px`, radius `999px`, bg `--coral-500`, text `#FFF`, hover `--coral-600`. Margin `24px 0 40px`.
4. **JD body** (`body` markdown → HTML): Nunito `16.5px`, line-height `1.7`, `--ink`, ≤72ch. `h2` → Mochiy `20px` (margin `32px 0 12px`); `h3` → Inter 600 `16px` (margin `24px 0 8px`); `ul/li` → `8px` gap, coral marker; `strong` 700; `a` coral underline-on-hover; `p` margin-bottom `16px`.
5. **Sticky Apply bar (mobile + tablet only):** when top CTA scrolls out, reveal bottom-fixed glass bar (`backdrop-blur`, `rgba(255,255,255,0.85)`, top hairline, `safe-area-inset-bottom`) with truncated role title (Inter 500 `13px`) + compact "Apply" coral button. Desktop: no sticky bar.
6. **Bottom Apply CTA:** repeat solid coral button after JD body, margin-top `40px`, centered.

### 3.3 States
- **Loading:** skeleton — chip row, title `60%`, salary `30%`, CTA block, 8–10 staggered text-line bars. Reduced-motion → static.
- **Not found / closed role:** slug resolves to no `status='open'` row → centered panel. Headline (Mochiy `24px`): "This role isn't open." Body: "It may have been filled or closed. See what else we're hiring for." + solid coral "View all roles" → `/`. Closed roles must NOT render their JD publicly.
- **Error:** "We couldn't load this role." + "Try again" ghost button.

### 3.4 Motion
- Header + CTA fade/rise on mount (card spring, no stagger). JD body fades in over `200ms` after header settles.
- Sticky mobile bar: slides up `translateY 100%→0` + fade, `220ms ease-out`, via IntersectionObserver on the top CTA. Reduced-motion → instant.

---

## 4. Surface 3 — Application form (`/roles/[slug]/apply`) : pre-bound to the role

### 4.1 IA & flow
Moment: "I want this role — let me apply." Action: **Submit application**. Form pre-bound to `{slug}` (role is context, not a picked field). All six inputs required. Flow: fill → client-validate per field → submit (upload CV, then POST) → success OR error-with-retry.

### 4.2 Layout (single column, max `560px`, centered)
1. **Context header:** Back link "← Back to role" → `/roles/[slug]`. Compact role banner: "Applying for" eyebrow (Inter 500, `12.5px`, `--ink-muted`, uppercase) + role title (Mochiy `24px`) + salary line (Inter 600 `15px`). Margin-bottom `32px`.
2. **Form card:** `--surface`, radius `16px`, border `1px --border`, padding `28px` desktop / `20px` mobile. Fields stacked, gap `20px`.

### 4.3 Field specs (all required)
Each field: **label** (Inter 600, `14px`, `--ink`, coral `*`) → **input** → **helper/error slot** (reserved `18px` height). Inputs: height `48px` (min `44pt`), radius `12px`, border `1px --border`, padding `0 14px`, Inter `15px`, focus → border `--coral-500` + `0 0 0 3px rgba(255,107,44,0.18)` ring.

1. **Full name** — text. Non-empty, 1–80 chars. Error: "Tell us your name."
2. **Email** — type=email, inputmode=email. `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤254. Error: "Enter a valid email."
3. **WhatsApp phone** — type=tel, inputmode=tel. Helper: "Include your country code, e.g. +234…". Strip spaces; leading `+` optional, ≥7 and ≤20 digits. Error: "Enter a valid WhatsApp number with country code."
4. **Preferred salary** — text (currency varies). Placeholder "e.g. ₦200,000/month". Non-empty, ≤60 chars. Error: "Tell us your preferred salary." Stored as text.
5. **CV upload** — custom dropzone (NOT a bare file input). See §4.4.
6. **Portfolio link** — type=url, inputmode=url. Placeholder "https://…". Parses as http(s) URL, ≤2048. Error: "Enter a valid link (starting with http or https)."

**Validation timing:** validate on blur (first pass) + on change after first blur. Never validate-on-mount. Submit always enabled; clicking with invalid fields runs full validation, scrolls to + focuses first invalid field, shows all errors.

### 4.4 CV dropzone (component `CvDropzone`)
- **Idle:** dashed border `1.5px --border`, radius `12px`, padding `28px`, centered. lucide `UploadCloud` (`28px`, `--ink-muted`), "Drop your CV here or **browse**" (coral browse), caption (Inter `12.5px`, `--ink-muted`): "PDF or Word, up to 5 MB." Accept `application/pdf, application/msword, .docx`.
- **Drag-over:** border → solid `--coral-500`, bg `--coral-050`, scale `1.0→1.01` (`120ms`).
- **Selected:** file pill row: lucide `FileText` + filename (truncate middle, keep ext) + size + remove (lucide `X`, `36px` hit area, label "Remove CV"). Bg `--coral-050`, radius `12px`, padding `12px 14px`.
- **Client validation (pre-upload):** reject mime not in allowlist → "That file type isn't supported — use PDF or Word."; reject `size > 5 MB` → "That file's too big — keep it under 5 MB." Mirrors the bucket `file_size_limit` + `allowed_mime_types`.
- Error text under dropzone in `--danger-500`.

### 4.5 Submit button + submitting state
- Button: full-width mobile, auto-width right-aligned desktop. Solid coral "Submit application", Inter 600 `16px`, `48px`, radius `999px`. Margin-top `28px`.
- **Submitting:** label → "Submitting…" + inline spinner (lucide `Loader2`), button disabled, opacity `0.85`, inputs disabled. Sequence: (a) upload CV, (b) POST application. Spinner across the whole sequence.

### 4.6 Success state (replace the form card entirely)
- `56px` success circle: `--coral-050` fill, `--success-500` lucide `Check` (`28px`), one-shot scale-bounce (scale `0→1`, spring `{stiffness:500, damping:20}`) + check-draw.
- Headline (Mochiy `24px`): "Application received."
- Body (Nunito `16px`, `--ink-muted`, ≤46ch): "Thanks, {firstName} — we've got your application for {roleTitle}. We review every one and reach out by email if there's a fit. Keep an eye on your inbox."
- Secondary: "Back to all roles" ghost button → `/`.
- Branded confirmation EMAIL sent server-side (Leg 2); on-page success is the immediate acknowledgment.

### 4.7 Error states
- **Validation (400 fields from server):** map `fields[]` to inputs, show each error, scroll to first. Top banner (Nunito `14px`, `--danger-500`, danger-tinted bg): "Please fix the highlighted fields."
- **Rate-limited (429):** banner "You've submitted a few times — give it a few minutes and try again." Keep form filled.
- **Server/network/upload failure:** banner "Something went wrong sending your application. Your details are still here — tap to try again." + submit returns enabled, label "Try again". NEVER clear input. NEVER show false success.

### 4.8 Motion
- Form card fade/rise on mount. Field focus ring `120ms`. Error fades+expands reserved slot `120ms`. Success: form cross-fades to success panel (old `1→0` `120ms`, new `0→1` + rise `8px` `200ms`), then check bounce. Reduced-motion → instant swap.

---

## 5. Accessibility (WCAG AA, all surfaces)

- **Contrast:** `--ink` on `--surface` 16.1:1; `--ink-muted` on `--surface` 5.6:1; `--ink-muted` on `--coral-050` 4.9:1 — all pass. Coral `#FF6B2C` text on white 2.9:1 — FAILS for body; use coral ONLY for ≥18px-or-bold link/CTA text + non-text affordances, never small body. White on `--coral-500` 3.4:1 — button text is `16px` 600 (large-text) → passes AA large; hover uses `--coral-600`. (Stricter option: darken button base to `--coral-600` everywhere — OPEN QUESTION for Seth.)
- **Targets:** all buttons, linking chips, remove-CV, "browse" ≥ `44×44pt`.
- **Forms:** programmatic `<label htmlFor>`; `aria-required` + visible `*`; errors via `aria-describedby` + `aria-invalid`; dropzone keyboard-operable (focusable, Enter/Space opens picker, `role="button"`, `aria-label="Upload your CV"`).
- **Reading order:** DOM matches visual; skip-to-content reused from marketing root.
- **Focus:** visible coral ring on every interactive element (never bare `outline:none`).
- **Reduced motion:** honor `prefers-reduced-motion: reduce` globally (fallbacks specified above).
- **Color never sole indicator:** errors carry icon + text; required carries `*` + `aria-required`.
- **Images:** logo `alt="Mingla"`; decorative `alt=""`.

---

## 6. Web-specific notes

- Web-only — Android glass opaque-fallback policy does NOT apply. Glass used only in careers header + mobile sticky Apply bar via CSS `backdrop-filter`; specify `@supports not (backdrop-filter: blur(1px))` fallback to solid `rgba(255,255,255,0.96)`.
- Fonts already loaded by marketing root layout (Mochiy/Nunito/Inter) — careers route group reuses them; no new font load.
- Performance: cards/JD server-rendered (data-driven from Supabase) for instant first paint + SEO; framer-motion hydrates only entrance/hover/sticky.

---

## 7. New tokens the system must add

If not already in the marketing Tailwind theme: `--coral-600 #E85D1F`, `--coral-050 #FFF6F1`, `--success-500 #1FA971`, `--danger-500 #D64545`. Others (`coral-500`, ink, muted, border) already exist. Implementor: confirm against `mingla-marketing/app/globals.css` `@theme` block; add only the missing few.

---

## Open questions for Seth (raised by the designer)
1. The coral CTA button text passes AA only at large-text weight — option to darken the button base to `--coral-600` for a stricter pass.
2. Confirm the 2-up max card grid (vs 3-up) is the desired "premium" density.
