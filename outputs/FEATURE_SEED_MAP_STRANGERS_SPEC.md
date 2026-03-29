# Feature Spec: Seed Discover Map with Fake Strangers

## What This Does (Plain English)

Right now, when you open the Discover Map, it looks empty unless real users happen to be nearby with visibility set to "everyone." This feature creates **fake stranger profiles** with real international names that automatically appear around any real user on the map — making the app look busy and alive.

Each real user will see ~15 strangers scattered within their map radius, with diverse names from around the world (Arabic, Japanese, Korean, Brazilian, Indian, Nigerian, Turkish, French, etc.), realistic taste match percentages, and activity statuses.

---

## Approach: Admin Edge Function

**Why an edge function (not a migration)?**
- Can be run on-demand, re-run after cleanup, and parameterized
- Follows the existing `admin-seed-places` pattern
- Uses `service_role` key to bypass RLS
- No `auth.users` entry needed — `profiles.id` is a standalone UUID PK (verified: no FK to `auth.users`)

**Why NOT inject fake data in the edge function response?**
- That would pollute production code with demo logic
- Seed data in the DB is honest — the existing `get-nearby-people` function works unmodified
- Easy to clean up: `DELETE FROM profiles WHERE id IN (SELECT user_id FROM user_map_settings WHERE activity_status LIKE 'seed:%')`

---

## Data Flow

```
admin-seed-map-strangers (edge function)
  → Creates profiles (display_name, first_name, avatar_url = null)
  → Creates user_map_settings (visibility='everyone', approximate_lat/lng near center)
  → Creates preferences (random categories, price_tiers, intents)
  → Tags seed users: activity_status = 'seed:v1' (for easy cleanup)
```

Then the existing `get-nearby-people` picks them up naturally — no code changes needed.

---

## Edge Function: `admin-seed-map-strangers`

### File: `supabase/functions/admin-seed-map-strangers/index.ts`

### Request Body
```json
{
  "action": "seed",
  "centerLat": 35.7796,
  "centerLng": -78.6382,
  "count": 15,
  "radiusKm": 5
}
```

Or to clean up:
```json
{
  "action": "cleanup"
}
```

Or to seed around ALL existing real users:
```json
{
  "action": "seed_around_all_users",
  "count": 15,
  "radiusKm": 5
}
```

### Auth
- Requires `service_role` key OR admin check (same pattern as `admin-seed-places`)
- No user auth token needed — this is an admin-only operation

### Name Pool (50 international names)

```typescript
const FAKE_PEOPLE = [
  // Arabic
  { firstName: "Yasmin", displayName: "Yasmin" },
  { firstName: "Omar", displayName: "Omar" },
  { firstName: "Layla", displayName: "Layla" },
  { firstName: "Khalid", displayName: "Khalid" },
  // Japanese
  { firstName: "Haruki", displayName: "Haruki" },
  { firstName: "Sakura", displayName: "Sakura" },
  { firstName: "Kenji", displayName: "Kenji" },
  { firstName: "Aiko", displayName: "Aiko" },
  // Korean
  { firstName: "Jihye", displayName: "Jihye" },
  { firstName: "Minho", displayName: "Minho" },
  { firstName: "Soyeon", displayName: "Soyeon" },
  // Brazilian / Portuguese
  { firstName: "Matheus", displayName: "Matheus" },
  { firstName: "Camila", displayName: "Camila" },
  { firstName: "Thiago", displayName: "Thiago" },
  { firstName: "Isabela", displayName: "Isabela" },
  // Indian
  { firstName: "Priya", displayName: "Priya" },
  { firstName: "Arjun", displayName: "Arjun" },
  { firstName: "Ananya", displayName: "Ananya" },
  { firstName: "Rohan", displayName: "Rohan" },
  // Nigerian
  { firstName: "Chioma", displayName: "Chioma" },
  { firstName: "Emeka", displayName: "Emeka" },
  { firstName: "Adaeze", displayName: "Adaeze" },
  // Turkish
  { firstName: "Elif", displayName: "Elif" },
  { firstName: "Baris", displayName: "Barış" },
  { firstName: "Defne", displayName: "Defne" },
  // French
  { firstName: "Manon", displayName: "Manon" },
  { firstName: "Théo", displayName: "Théo" },
  { firstName: "Chloé", displayName: "Chloé" },
  // German
  { firstName: "Lena", displayName: "Lena" },
  { firstName: "Finn", displayName: "Finn" },
  // Russian
  { firstName: "Anastasia", displayName: "Anastasia" },
  { firstName: "Dmitri", displayName: "Dmitri" },
  // Spanish / Latin American
  { firstName: "Valentina", displayName: "Valentina" },
  { firstName: "Mateo", displayName: "Mateo" },
  { firstName: "Lucía", displayName: "Lucía" },
  { firstName: "Santiago", displayName: "Santiago" },
  // Thai
  { firstName: "Niran", displayName: "Niran" },
  { firstName: "Ploy", displayName: "Ploy" },
  // Ethiopian
  { firstName: "Abeni", displayName: "Abeni" },
  { firstName: "Tariku", displayName: "Tariku" },
  // Chinese
  { firstName: "Mei", displayName: "Mei" },
  { firstName: "Wei", displayName: "Wei" },
  { firstName: "Lianhua", displayName: "Lianhua" },
  // Scandinavian
  { firstName: "Astrid", displayName: "Astrid" },
  { firstName: "Soren", displayName: "Søren" },
  // Greek
  { firstName: "Eleni", displayName: "Eleni" },
  { firstName: "Nikos", displayName: "Nikos" },
  // Persian
  { firstName: "Parisa", displayName: "Parisa" },
  { firstName: "Dariush", displayName: "Dariush" },
  // Swahili
  { firstName: "Amani", displayName: "Amani" },
  { firstName: "Zuri", displayName: "Zuri" },
];
```

### Activity Statuses (rotating)
```typescript
const ACTIVITY_STATUSES = [
  "Exploring coffee shops ☕",
  "Looking for dinner spots",
  "Weekend brunch hunt 🥞",
  "Finding hidden gems",
  "New in town — exploring!",
  "Craving something sweet",
  "On a food adventure",
  "Happy hour search 🍷",
  null, // some have no status
  null,
  null,
];
```

### Seed Logic (per center point)

```typescript
async function seedAroundPoint(
  adminClient: SupabaseClient,
  centerLat: number,
  centerLng: number,
  count: number,
  radiusKm: number
) {
  // 1. Pick `count` random names from FAKE_PEOPLE (no duplicates)
  const shuffled = [...FAKE_PEOPLE].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  // 2. For each, generate a random position within radiusKm
  for (const person of selected) {
    const id = crypto.randomUUID();
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * radiusKm; // km
    const latOffset = (distance / 111.32) * Math.cos(angle);
    const lngOffset = (distance / (111.32 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
    const approxLat = centerLat + latOffset;
    const approxLng = centerLng + lngOffset;

    // 3. Random preferences
    const allCategories = [
      'Nature & Views', 'First Meet', 'Picnic Park', 'Drink',
      'Casual Eats', 'Fine Dining', 'Live & Loud', 'Culture',
      'Active', 'Sweet Tooth', 'Shop & Browse', 'Nightlife', 'Spa & Relax'
    ];
    const allTiers = ['chill', 'comfy', 'bougie', 'lavish'];
    const allIntents = ['adventurous', 'romantic', 'friendly', 'group-fun'];

    const categories = allCategories.sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 5));
    const priceTiers = allTiers.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
    const intents = allIntents.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));

    // 4. Random "last active" within past 2 hours (so they show as recently active)
    const lastActive = new Date(Date.now() - Math.random() * 2 * 60 * 60 * 1000);

    // 5. Random activity status (some null)
    const status = ACTIVITY_STATUSES[Math.floor(Math.random() * ACTIVITY_STATUSES.length)];
    const statusExpiry = status ? new Date(Date.now() + 4 * 60 * 60 * 1000) : null;

    // INSERT profile
    await adminClient.from("profiles").insert({
      id,
      display_name: person.displayName,
      first_name: person.firstName,
      avatar_url: null, // no avatar — will show initials
      has_completed_onboarding: true,
    });

    // INSERT user_map_settings
    await adminClient.from("user_map_settings").insert({
      user_id: id,
      visibility_level: "everyone",
      approximate_lat: approxLat,
      approximate_lng: approxLng,
      real_lat: approxLat, // same for seed data
      real_lng: approxLng,
      last_active_at: lastActive.toISOString(),
      activity_status: status ? `seed:v1|${status}` : 'seed:v1',
      activity_status_expires_at: statusExpiry?.toISOString() || null,
    });

    // INSERT preferences
    await adminClient.from("preferences").insert({
      profile_id: id,
      categories,
      price_tiers: priceTiers,
      intents,
    });
  }
}
```

**Tag convention:** `activity_status` starts with `seed:v1` so we can:
- Identify all seed users: `WHERE activity_status LIKE 'seed:%'`
- Clean them up without touching real users
- The `get-nearby-people` function strips expired statuses, but seed statuses have a 4-hour expiry that can be refreshed

### Wait — Activity Status Display Issue

The `get-nearby-people` function returns `activity_status` raw. If we tag it `seed:v1|Exploring...`, the UI will show `seed:v1|Exploring...`.

**Better approach:** Use a separate marker. Options:
1. Add `is_seed BOOLEAN DEFAULT false` column to profiles — cleanest
2. Store seed IDs in a separate `seed_users` table
3. Use a specific `last_name` value like `__SEED__` as the tag

**Recommendation: Option 1** — add `is_seed` to profiles. One column, trivial migration, clean queries.

### Revised Tag Strategy

```sql
-- Migration: add is_seed column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_profiles_is_seed ON profiles(is_seed) WHERE is_seed = true;
```

Then `activity_status` can be the real visible status (or null), and cleanup is:
```sql
DELETE FROM profiles WHERE is_seed = true;
-- CASCADE handles user_map_settings and preferences
```

### Cleanup Action

```typescript
async function cleanup(adminClient: SupabaseClient) {
  const { data, error } = await adminClient
    .from("profiles")
    .delete()
    .eq("is_seed", true)
    .select("id");
  // CASCADE deletes from user_map_settings + preferences
  return { deleted: data?.length || 0 };
}
```

### Seed Around All Users Action

```typescript
async function seedAroundAllUsers(adminClient: SupabaseClient, count: number, radiusKm: number) {
  // 1. Get all real users with map locations
  const { data: realUsers } = await adminClient
    .from("user_map_settings")
    .select("user_id, approximate_lat, approximate_lng")
    .not("approximate_lat", "is", null)
    .not("approximate_lng", "is", null);

  // 2. Filter out seed users
  const { data: seedIds } = await adminClient
    .from("profiles")
    .select("id")
    .eq("is_seed", true);
  const seedIdSet = new Set((seedIds || []).map(s => s.id));
  const realUserLocations = (realUsers || []).filter(u => !seedIdSet.has(u.user_id));

  // 3. Clean up existing seed data first
  await cleanup(adminClient);

  // 4. Seed around each real user
  let totalCreated = 0;
  for (const loc of realUserLocations) {
    await seedAroundPoint(adminClient, loc.approximate_lat, loc.approximate_lng, count, radiusKm);
    totalCreated += count;
  }
  return { totalCreated, realUsers: realUserLocations.length };
}
```

---

## Migration

### File: `supabase/migrations/YYYYMMDDHHMMSS_add_is_seed_to_profiles.sql`

```sql
-- Add is_seed flag to profiles for demo/seed data identification
-- Allows clean separation and bulk cleanup of seeded fake users
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_profiles_is_seed ON public.profiles(is_seed) WHERE is_seed = true;
```

---

## What Changes and What Doesn't

### Changes (new files only)
| File | Action |
|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_add_is_seed_to_profiles.sql` | NEW — adds `is_seed` column |
| `supabase/functions/admin-seed-map-strangers/index.ts` | NEW — edge function |

### No Changes Required
| File | Why |
|------|-----|
| `get-nearby-people/index.ts` | Seed profiles are real rows — works as-is |
| `DiscoverMap.tsx` | No changes — renders whatever `get-nearby-people` returns |
| `PersonPin.tsx` | No changes — handles null avatars (shows initials) |
| `useNearbyPeople.ts` | No changes |
| Any mobile code | No changes at all |

---

## Verification

After running `seed_around_all_users`:

```sql
-- Count seed users
SELECT COUNT(*) FROM profiles WHERE is_seed = true;

-- See their map positions
SELECT p.display_name, p.first_name, m.approximate_lat, m.approximate_lng, m.visibility_level
FROM profiles p
JOIN user_map_settings m ON m.user_id = p.id
WHERE p.is_seed = true;

-- Verify preferences exist
SELECT p.display_name, pr.categories, pr.price_tiers
FROM profiles p
JOIN preferences pr ON pr.profile_id = p.id
WHERE p.is_seed = true;
```

Then open the app → Discover Map → should see ~15 strangers with international names scattered around you.

---

## Edge Cases & Risks

1. **Friend requests to seed users — WORKS NATURALLY.** The `friend_requests` table FK was already migrated from `auth.users(id)` to `profiles(id)` (migration `20250127000021`). Since seed users have real `profiles` rows, friend requests insert successfully. The sender sees "Sent" status. The seed user simply never responds — exactly like a real user who ignores requests. No code changes, no guards needed.

2. **Taste match computation** — Works fine because seed users have real `preferences` rows.

3. **Avatars** — Seed users have `avatar_url: null`, so `PersonPin` will render initials (first letter of display_name). This looks natural — many real users don't have avatars either.

4. **Last active time** — Seed users' `last_active_at` will drift into the past over time. The online indicator (green dot) checks if active within 15 minutes. After 15 min, seed users will show as "recently active" but not online.
   - **Optional:** A cron or manual re-seed refreshes timestamps.

5. **Cleanup** — `DELETE FROM profiles WHERE is_seed = true` cascades to all related tables (`user_map_settings`, `preferences`, `friend_requests`). Clean and complete.

6. **Pair requests to seed users** — `send-pair-request` edge function also references profiles. Same behavior: request inserts, shows "Sent", seed user never responds.

---

## Recommended Implementation Order

1. Apply migration (add `is_seed` column)
2. Create edge function `admin-seed-map-strangers`
3. Deploy edge function
4. Run: `seed_around_all_users` with count=15, radiusKm=5
5. Verify on map — strangers appear, friend requests show "Sent"
