# Data Pipelines Reference — Mingla Implementor

Read this file before any analytics, ETL, reporting, metrics, experiments, batch jobs,
or data modeling work.

---

## Analytics Architecture in Mingla

### Event Tracking Stack

Mingla uses a multi-layer analytics approach:

**Client-side (Mobile):**
- AppsFlyer for attribution and in-app events
- Mixpanel for product analytics and user behavior
- `userInteractionService.ts` as the unified event dispatch layer
- Events fire at interaction points in components/hooks, not in services

**Server-side (Edge Functions):**
- Supabase DB as the source of truth for all transactional data
- Edge functions can emit server-side events for actions that don't originate from the client
- Revenue events (Stripe, RevenueCat) tracked server-side for accuracy

**The AppsFlyer Event Map** (`outputs/APPSFLYER_EVENT_MAP.md`) is the single source of truth
for all event configuration. Always read and update it when touching analytics.

### Event Taxonomy

Follow existing patterns. Events are structured as:

```typescript
{
  eventName: string,          // snake_case: "place_saved", "session_created"
  eventValues: {              // Key-value pairs, all strings
    place_id?: string,
    session_id?: string,
    source_screen?: string,
    // ... context-specific params
  }
}
```

**Naming conventions:**
- `noun_verb` pattern: `place_saved`, `session_created`, `booking_confirmed`
- Past tense for completed actions: `onboarding_completed`, not `onboarding_complete`
- Present tense for views: `screen_viewed`, `card_displayed`
- Prefix experiments: `exp_variant_assigned`, `exp_conversion`

---

## Data Modeling Principles

### Supabase/PostgreSQL Patterns

**Fact tables** (events, transactions): append-only, timestamped, immutable after write.
```sql
CREATE TABLE place_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  place_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,  -- 'view', 'save', 'skip', 'book'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
-- RLS: users see only their own
ALTER TABLE place_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_interactions" ON place_interactions
  FOR ALL USING (auth.uid() = user_id);
-- Index for common queries
CREATE INDEX idx_place_interactions_user_type 
  ON place_interactions(user_id, interaction_type, created_at DESC);
```

**Dimension tables** (users, places, categories): mutable, versioned when history matters.

**Aggregation tables** (daily summaries, cohort metrics): materialized from fact tables,
refreshed on schedule. Use materialized views or scheduled edge functions.

### Denormalization Strategy

For read-heavy analytics queries, strategic denormalization is acceptable:
- Embed frequently-joined fields (e.g., `city_name` on places instead of joining cities)
- Use JSONB for flexible metadata that varies per record
- Create summary columns updated by triggers for high-frequency counts

### Indexing for Analytics

- Composite indexes on (user_id, created_at DESC) for user timelines
- Partial indexes for common filters: `WHERE interaction_type = 'save'`
- GIN indexes on JSONB columns used in queries
- Always check `EXPLAIN ANALYZE` for queries in edge functions

---

## ETL / Pipeline Patterns

### Edge Function Pipelines

Mingla uses Deno edge functions for data transformation. Patterns:

**Scheduled aggregation:**
```typescript
// Runs on cron via Supabase scheduled functions or external trigger
serve(async (req) => {
  // 1. Extract: query raw data with time window
  const { data: interactions } = await supabase
    .from('place_interactions')
    .select('*')
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd)

  // 2. Transform: aggregate in memory
  const aggregated = interactions.reduce((acc, row) => {
    // ... aggregation logic
  }, {})

  // 3. Load: upsert into summary table
  await supabase
    .from('daily_interaction_summary')
    .upsert(aggregated, { onConflict: 'date,metric_name' })
})
```

**Pipeline rules:**
- **Idempotent:** Running the same pipeline twice with the same input produces the same output.
  Use `upsert` with conflict keys, not blind `insert`.
- **Windowed:** Always process a defined time window, never "everything since last run."
  Track watermarks in a `pipeline_state` table if needed.
- **Retry-safe:** If a pipeline fails mid-run, re-running it from the start produces correct
  results (follows from idempotency).
- **Monitored:** Log pipeline runs (start time, end time, rows processed, errors) to a
  `pipeline_runs` table.
- **Bounded:** Set reasonable limits on batch sizes. Process in chunks of 1000-5000 rows.

### Data Quality Checks

Build assertions into pipelines:

```typescript
// After extract, before load
if (interactions.length === 0 && !isWeekend) {
  console.warn('Zero interactions on a weekday — possible data gap')
  // Log to monitoring, don't silently produce empty aggregations
}

// After load
const { count } = await supabase
  .from('daily_interaction_summary')
  .select('*', { count: 'exact', head: true })
  .eq('date', targetDate)
if (count === 0) {
  throw new Error(`Summary table empty after pipeline run for ${targetDate}`)
}
```

---

## Metrics & Reporting

### Core Metrics Framework

**Engagement:**
- DAU / WAU / MAU (active = opened app + meaningful action)
- Session length, sessions per user per day
- Cards swiped per session, save rate, skip rate

**Retention:**
- D1, D7, D30 retention (returned and took action)
- Weekly retention cohorts
- Churn prediction signals (declining session frequency)

**Conversion:**
- Funnel: discover → save → plan → book
- Step-by-step drop-off rates
- Time-to-first-action (onboarding → first save)

**Revenue:**
- Booking rate, average booking value
- Premium conversion rate, LTV by acquisition channel
- Partner revenue per impression/click/booking

### Building Dashboards (Admin)

Admin dashboard charts use Recharts. Patterns:

```jsx
// Use existing ChartCard component from ui/
<ChartCard title="Daily Active Users" subtitle="Last 30 days">
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={dailyData}>
      <XAxis dataKey="date" />
      <YAxis />
      <Tooltip />
      <Line type="monotone" dataKey="dau" stroke="var(--color-primary)" />
    </LineChart>
  </ResponsiveContainer>
</ChartCard>
```

- Use CSS custom properties for chart colors (theme-aware)
- Always include loading skeleton and empty state
- Date range selector for all time-series charts
- Export to CSV for all data tables

---

## Experimentation / A/B Testing

### Experiment Design in Mingla

**Variant assignment:** Server-side in edge functions for consistency. Hash user_id +
experiment_name to assign deterministically.

```typescript
function assignVariant(userId: string, experimentName: string, variants: string[]): string {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${userId}:${experimentName}`)
  )
  const hashArray = new Uint8Array(hash)
  const index = hashArray[0] % variants.length
  return variants[index]
}
```

**Tracking:**
```sql
CREATE TABLE experiment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  experiment_name TEXT NOT NULL,
  variant TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, experiment_name)
);

CREATE TABLE experiment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  experiment_name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Analysis pattern:** Edge function that computes conversion rates per variant with
confidence intervals. Expose via admin dashboard.

### Statistical Rigor

- Minimum sample size calculation before launching (use standard power analysis)
- Don't peek at results — define the analysis date upfront
- Use sequential testing if early stopping is needed
- Document the hypothesis, primary metric, and expected effect size before launch

---

## Batch Jobs & Scheduled Functions

### Patterns

**Supabase cron (pg_cron):**
```sql
SELECT cron.schedule(
  'refresh-popular-places',
  '0 */6 * * *',  -- every 6 hours
  $$SELECT net.http_post(
    'https://your-project.supabase.co/functions/v1/refresh-popular-places',
    '{}',
    '{}'::jsonb,
    ARRAY[
      net.http_header('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
    ]
  )$$
);
```

**Edge function as batch job:**
- Accept a `batch_id` or time window parameter
- Process in chunks with progress logging
- Return summary: rows processed, errors, duration

**Cache refresh patterns:**
- Place data: refresh every 24h, or on-demand if stale
- Popular/trending: refresh every 6h
- User recommendations: refresh on preference change + daily
- Distance calculations: cache for 7 days (locations don't move)

---

## Data Privacy & Compliance

- Never log PII in analytics events (email, phone, full name)
- User IDs are pseudonymous — analytics uses user_id UUID, not email
- Implement data deletion in pipeline: when user deletes account, cascade to all
  analytics tables (GDPR right to erasure)
- Aggregated metrics never have cohorts < 5 users (k-anonymity)
- Document data retention policies: raw events 90 days, aggregates 2 years

---

## Implementation Checklist for Data Work

- [ ] Event naming follows existing taxonomy (check AppsFlyer Event Map)
- [ ] Events fire at correct interaction points (components/hooks, not services)
- [ ] Pipeline is idempotent (safe to re-run)
- [ ] Pipeline is windowed (defined time range, not "all since last run")
- [ ] Pipeline has monitoring (logged runs, error counts)
- [ ] Data quality checks built in (non-zero assertions, schema validation)
- [ ] Indexes exist for all query patterns used in edge functions
- [ ] RLS policies on all new tables
- [ ] No PII in analytics events
- [ ] Dashboard charts have loading/empty states
- [ ] Dashboard uses CSS variables for theme-aware colors
- [ ] Experiments track assignment + conversion events separately
- [ ] Batch jobs log progress and handle partial failures
- [ ] AppsFlyer Event Map updated if any analytics files modified