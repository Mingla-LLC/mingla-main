# Reconnaissance Procedures

Detailed instructions for Phase 1 of the PMM Codebase Analyst workflow.

## Table of Contents
1. Initial Scan Strategy
2. Stack Detection Heuristics
3. Product Type Classification
4. Surface Mapping Procedures
5. Evidence Collection Standards

---

## 1. Initial Scan Strategy

Start with the directory tree (2 levels deep). This reveals the organizational model before
you read any code.

**What the directory structure tells you:**

| Pattern | Indicates |
|---------|-----------|
| `/pages` or `/app` with nested routes | Next.js / page-based routing — each file is a product surface |
| `/src/features/` or `/modules/` | Domain-driven organization — each folder is a feature area |
| `/components`, `/hooks`, `/services` split | Technical-layer organization — feature logic is distributed |
| `/api/` or `/server/` alongside `/client/` | Full-stack monorepo — both sides available for analysis |
| `/packages/` with multiple apps | Monorepo — ask user which package to focus on |
| `/functions/` or `/supabase/` or `/netlify/` | Serverless backend — check each function for product logic |
| `/prisma/` or `/drizzle/` or `/migrations/` | ORM with schema — read schema for domain model |
| `docker-compose.yml` with multiple services | Microservices — map service boundaries to product domains |

**Priority reading order for initial scan:**

```
1. package.json / Cargo.toml / go.mod / requirements.txt  →  dependencies reveal stack + integrations
2. Routing config or pages directory                        →  reveals all product surfaces
3. Database schema / models / migrations                    →  reveals domain model
4. Environment variables / config files                     →  reveals external services + feature flags
5. README (read skeptically)                                →  reveals intended positioning
```

## 2. Stack Detection Heuristics

Map dependencies to product implications:

**Auth libraries** → user type complexity
- `next-auth` / `clerk` / `auth0` → multi-provider, likely B2B or prosumer
- `supabase-auth` / `firebase-auth` → self-serve SaaS patterns
- Custom JWT + RBAC → enterprise patterns, complex permissions
- No auth → internal tool, CLI, or very early stage

**Payment libraries** → monetization model
- `stripe` → subscription SaaS (check for `subscription`, `checkout`, `portal`)
- `stripe-connect` → marketplace / platform
- `paddle` / `lemonsqueezy` → indie SaaS
- No payments → free tool, pre-monetization, or enterprise (invoiced)

**Analytics/tracking** → what the team measures
- `posthog` / `amplitude` / `mixpanel` → product-led growth, event-driven
- `segment` → data infrastructure maturity
- `google-analytics` only → marketing-led, less product sophistication
- Custom events → check event names for activation/engagement signals

**Email/messaging** → lifecycle maturity
- `resend` / `sendgrid` / `postmark` → transactional email
- `customer.io` / `intercom` → lifecycle messaging sophistication
- No email service → early stage or relies on third-party

**Collaboration signals**
- `socket.io` / `pusher` / `ably` / realtime subscriptions → multiplayer features
- `@tiptap` / `yjs` / `automerge` → collaborative editing
- Invite/team/org models in schema → team-oriented product

## 3. Product Type Classification

After initial scan, classify the product. This shapes all subsequent analysis.

| Classification | Code Signals |
|---------------|-------------|
| **B2B SaaS** | Org/team/workspace models, RBAC, billing per seat/org, admin panels, SSO |
| **B2C App** | Individual user model, social features, content feeds, notifications |
| **Marketplace** | Two-sided models (buyer/seller, host/guest), transaction flows, reviews |
| **Developer Tool** | CLI entry points, API-first design, SDK packages, webhook handlers |
| **Internal Tool** | No public auth, hardcoded org references, admin-heavy, no billing |
| **E-commerce** | Product/cart/order models, checkout flow, inventory management |
| **Content Platform** | CMS models, publishing workflows, content types, media handling |
| **AI Product** | LLM API calls, prompt templates, streaming responses, token tracking |

## 4. Surface Mapping Procedures

For each product surface you identify, collect:

```
Surface: [name]
Route/URL: [path or navigation target]
Entry point: [file]
Purpose: [what the user does here]
User types with access: [who can see this]
Key state: [what data drives this surface]
Empty state: [what happens with no data — check if it exists]
Error state: [what happens on failure — check if it exists]
Connected surfaces: [where can the user go from here]
Evidence quality: [HIGH: read the component / MEDIUM: inferred from route / LOW: guessed from name]
```

**Common surfaces to look for:**
Landing/marketing, signup/registration, login, onboarding wizard, dashboard/home, core feature
area(s), search/browse/explore, detail/single-item views, creation/editing flows, settings/profile,
team/org management, billing/subscription, admin panel, notifications, help/support, API docs,
integrations marketplace, export/reporting.

## 5. Evidence Collection Standards

Every claim needs evidence. Use this format:

```
Claim: [what you believe]
Source: [file path + relevant section]
Type: DIRECT (read it in code) / INFERRED (derived from patterns) / STRUCTURAL (from architecture)
Confidence: HIGH / MEDIUM / LOW
```

**Confidence calibration:**
- **HIGH**: You read the specific code that implements this behavior
- **MEDIUM**: Multiple indirect signals point to this conclusion (naming, patterns, adjacent code)
- **LOW**: Based on conventions, structure, or single weak signals — flag for verification

When reporting findings, distinguish between:
- **Implemented**: Code exists and appears functional
- **Partially implemented**: Code exists but is incomplete (TODO comments, empty handlers, stub returns)
- **Scaffolded**: Structure exists but no real logic (placeholder components, empty routes)
- **Abandoned**: Code exists but appears dead (no references, old patterns, commented out)
- **Feature-flagged**: Complete but gated behind a flag or env variable