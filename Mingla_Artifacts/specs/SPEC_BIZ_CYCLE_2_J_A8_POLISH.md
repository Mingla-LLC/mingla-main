# Spec — J-A8 Polish Package (Bio + Country Picker + Multi-Platform Social Icons)

> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A8-POLISH
> **Cycle:** 2 — Brands (polish slice on top of J-A8)
> **Codebase:** `mingla-business/` (mobile + web parity per DEC-071)
> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_2_J_A8_POLISH.md`
> **Authoritative design:** `HANDOFF_BUSINESS_DESIGNER.md` §5.3.5 line 1839 (multi-platform social)
> **Spec writer turn:** 2026-04-29
> **Status:** locked

---

## 1. Scope

### 1.1 In scope (6 files modified, 0 new files)

- **Schema:** `src/store/currentBrandStore.ts` — extend `BrandLinks` v4→v5 with 6 new optional platform fields + passthrough migration
- **Stub data:** `src/store/brandList.ts` — extend 4 stubs with multi-platform handles (mixed coverage for testing)
- **Icon set:** `src/components/ui/Icon.tsx` — add 8 new IconName entries + 8 new RENDERER functions (Lucide-derived line paths)
- **Country picker:** `src/components/ui/Input.tsx` — replace 12-entry `PHONE_COUNTRIES` with 249-entry full ISO 3166-1 list + add search Input at top of picker Sheet
- **Edit form:** `src/components/brand/BrandEditView.tsx` — inline `TextArea` component (replaces bio Input usage) + 6 new social Inputs
- **Profile view:** `src/components/brand/BrandProfileView.tsx` — delete contactCol + linksRow blocks; add unified `socialsRow` icon-only chip renderer with empty-field hiding

### 1.2 Out of scope (hard non-goals)

- ❌ Phone-number validation (libphonenumber-js) — picker just presents the chip; no E.164 parsing
- ❌ `Linking.openURL` on social chip taps — D-IMPL-A7-5 deferral preserved (`[TRANSITIONAL]` Toast)
- ❌ Additional social platforms beyond the 8 (Snapchat, Pinterest, Bluesky, Mastodon, Discord, WhatsApp, Telegram) — additive pattern available next cycle
- ❌ Custom links multi-add UI (`links.custom` schema field stays unchanged)
- ❌ Settings page scope (slug, currency, timezone, Tax/VAT — §5.3.6)
- ❌ D-IMPL-A8-1 (empty-bio inline CTA stale Toast) — separate micro-fix
- ❌ Backend code, edge functions, RPCs, migrations
- ❌ Adding a Toggle / TextArea kit primitive (DEC-079 closure — local composition only)

### 1.3 Assumptions

- J-A8 baseline shipped at `00c0c89f` (BrandEditView + edit route + schema v4)
- Founder always has owner role; no role-based field gating
- Web AsyncStorage persistence works (existing WEB3/Cycle 0b fixes)
- Lucide MIT license permits glyph reuse (industry-standard line icons)

---

## 2. Authoritative design source

Per investigation, the J-A8 polish source is **handoff §5.3.5 line 1839**:

> **Mobile:** scroll view sectioned: Photo · Basics (name, description, contact email, contact phone) · **Social links (multi-select platforms with URL inputs)** · Custom links (multi-add) · Display attendee count toggle.

Multi-platform support was in original design intent. J-A8 shipped only website + instagram for cycle scope; this polish closes the gap to 8 platforms.

---

## 3. Layer specifications

### 3.1 Schema layer (Brand v4 → v5)

**File:** `src/store/currentBrandStore.ts`

Extend `BrandLinks`:

```typescript
export interface BrandLinks {
  website?: string;
  instagram?: string;
  /** TikTok handle (e.g. "@yourbrand"). NEW in J-A8 polish schema v5. */
  tiktok?: string;
  /** X (formerly Twitter) handle (e.g. "@yourbrand"). NEW in J-A8 polish schema v5. */
  x?: string;
  /** Facebook page slug or URL. NEW in J-A8 polish schema v5. */
  facebook?: string;
  /** YouTube channel handle or URL. NEW in J-A8 polish schema v5. */
  youtube?: string;
  /** LinkedIn page slug or URL. NEW in J-A8 polish schema v5. */
  linkedin?: string;
  /** Threads handle (e.g. "@yourbrand"). NEW in J-A8 polish schema v5. */
  threads?: string;
  /** Custom link list (post-MVP); empty in J-A7+J-A8 stubs. */
  custom?: BrandCustomLink[];
}
```

**Persist version bump:**
- `persistOptions.name` → `"mingla-business.currentBrand.v5"`
- `version: 5`
- Migration adds v5 case (passthrough — new fields start undefined):
  ```typescript
  if (version === 4) {
    return persistedState as PersistedState;
  }
  ```
  (full chain: v1 reset → v2→v3 attendees upgrade → v3→v4 passthrough → v4→v5 passthrough)

Header comment update: extend schema-version history with v5 entry.

### 3.2 Stub data layer

**File:** `src/store/brandList.ts`

Extend each stub's `links` with realistic handles (mix coverage so smoke hits different chip counts):

**Lonely Moth** (full coverage — all 8 platforms):
```typescript
links: {
  website: "lonelymoth.events",
  instagram: "@lonely.moth.events",
  tiktok: "@lonelymoth",
  x: "@lonelymothldn",
  facebook: "lonelymothldn",
  youtube: "@lonelymoth",
  linkedin: "lonely-moth",
  threads: "@lonely.moth.events",
  custom: [],
},
```

**The Long Lunch** (3 platforms):
```typescript
links: {
  website: "thelonglunch.co.uk",
  instagram: "@thelonglunch",
  tiktok: "@thelonglunch",
  custom: [],
},
```

**Sunday Languor** (6 platforms):
```typescript
links: {
  website: "sundaylanguor.com",
  instagram: "@sundaylanguor",
  tiktok: "@sundaylanguor",
  x: "@sundaylanguor",
  youtube: "@sundaylanguor",
  threads: "@sundaylanguor",
  custom: [],
},
```

**Hidden Rooms** (2 platforms — minimal):
```typescript
links: {
  website: "hidden-rooms.co.uk",
  instagram: "@hidden.rooms",
  custom: [],
},
```

Header comment update: note v5 schema.

### 3.3 Icon set layer (8 new glyphs)

**File:** `src/components/ui/Icon.tsx`

Append 8 new entries to `IconName` union (after `inbox`):

```typescript
| "phone"
| "instagram"
| "tiktok"
| "x"
| "facebook"
| "youtube"
| "linkedin"
| "threads";
```

Append 8 new entries to `RENDERERS` map:

```typescript
phone: () => (
  <Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
),
instagram: (color) => (
  <>
    <Rect x="2" y="2" width="20" height="20" rx="5" />
    <Path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <Circle cx="17.5" cy="6.5" r="1" fill={color} stroke="none" />
  </>
),
tiktok: () => (
  <Path d="M16 8v8a4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4M16 8a5 5 0 0 0 5 5V9a5 5 0 0 1-5-5z" />
),
x: () => (
  <Path d="M4 4l7 9-7 9h2.5l5.5-7 5.5 7H22l-7-9 7-9h-2.5L14 11 8.5 4H4z" />
),
facebook: () => (
  <Path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
),
youtube: () => (
  <>
    <Path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
    <Path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" />
  </>
),
linkedin: () => (
  <>
    <Path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V8h4v2c1-1 2-2 4-2z" />
    <Rect x="2" y="9" width="4" height="12" />
    <Circle cx="4" cy="4" r="2" />
  </>
),
threads: () => (
  <Path d="M12 21a9 9 0 1 1 9-9c0 2-1 4-3 5M9 11c1-2 3-3 5-2 1 1 1 3-1 4M11 14c-1-1-1-3 0-4 2-1 4 1 4 3-1 2-3 2-4 1" />
),
```

**Notes on icon sourcing:**
- All paths derived from Lucide (MIT-licensed line icons) where available
- `phone, instagram, facebook, youtube, linkedin` — Lucide directly
- `tiktok, x` — Tabler-style derivatives (more recognizable for these brands than Lucide's variants)
- `threads` — composed approximation; designer review recommended (D-FORENSICS-A8P-1)

**Decision proposal:** **DEC-082** — Icon set additive expansion. Future icon additions follow this same pattern (additive within `Icon.tsx`, line-style 24×24 viewBox, no breaking changes to existing 69 glyphs).

### 3.4 Input.tsx — full country list + picker search

**File:** `src/components/ui/Input.tsx`

#### 3.4.1 Replace `PHONE_COUNTRIES` const (lines 65-82)

Remove the `[TRANSITIONAL]` header comment (lines 65-68). Replace with:

```typescript
/**
 * Full ISO 3166-1 country list for the phone picker. 249 entries.
 *
 * Sorted alphabetically by `name` for predictable picker UX. Each entry
 * carries ISO alpha-2, English display name, E.164 dial code, and emoji
 * flag. No phone-number validation library required (we don't validate;
 * we just present the chip).
 *
 * Multi-dial-code countries (US/Canada both +1, etc.) are listed once
 * each by ISO code — disambiguation is by name + flag.
 */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "AF", name: "Afghanistan", dialCode: "+93", flag: "🇦🇫" },
  { iso: "AL", name: "Albania", dialCode: "+355", flag: "🇦🇱" },
  { iso: "DZ", name: "Algeria", dialCode: "+213", flag: "🇩🇿" },
  { iso: "AS", name: "American Samoa", dialCode: "+1684", flag: "🇦🇸" },
  { iso: "AD", name: "Andorra", dialCode: "+376", flag: "🇦🇩" },
  { iso: "AO", name: "Angola", dialCode: "+244", flag: "🇦🇴" },
  { iso: "AI", name: "Anguilla", dialCode: "+1264", flag: "🇦🇮" },
  { iso: "AG", name: "Antigua and Barbuda", dialCode: "+1268", flag: "🇦🇬" },
  { iso: "AR", name: "Argentina", dialCode: "+54", flag: "🇦🇷" },
  { iso: "AM", name: "Armenia", dialCode: "+374", flag: "🇦🇲" },
  { iso: "AW", name: "Aruba", dialCode: "+297", flag: "🇦🇼" },
  { iso: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺" },
  { iso: "AT", name: "Austria", dialCode: "+43", flag: "🇦🇹" },
  { iso: "AZ", name: "Azerbaijan", dialCode: "+994", flag: "🇦🇿" },
  { iso: "BS", name: "Bahamas", dialCode: "+1242", flag: "🇧🇸" },
  { iso: "BH", name: "Bahrain", dialCode: "+973", flag: "🇧🇭" },
  { iso: "BD", name: "Bangladesh", dialCode: "+880", flag: "🇧🇩" },
  { iso: "BB", name: "Barbados", dialCode: "+1246", flag: "🇧🇧" },
  { iso: "BY", name: "Belarus", dialCode: "+375", flag: "🇧🇾" },
  { iso: "BE", name: "Belgium", dialCode: "+32", flag: "🇧🇪" },
  { iso: "BZ", name: "Belize", dialCode: "+501", flag: "🇧🇿" },
  { iso: "BJ", name: "Benin", dialCode: "+229", flag: "🇧🇯" },
  { iso: "BM", name: "Bermuda", dialCode: "+1441", flag: "🇧🇲" },
  { iso: "BT", name: "Bhutan", dialCode: "+975", flag: "🇧🇹" },
  { iso: "BO", name: "Bolivia", dialCode: "+591", flag: "🇧🇴" },
  { iso: "BA", name: "Bosnia and Herzegovina", dialCode: "+387", flag: "🇧🇦" },
  { iso: "BW", name: "Botswana", dialCode: "+267", flag: "🇧🇼" },
  { iso: "BR", name: "Brazil", dialCode: "+55", flag: "🇧🇷" },
  { iso: "IO", name: "British Indian Ocean Territory", dialCode: "+246", flag: "🇮🇴" },
  { iso: "VG", name: "British Virgin Islands", dialCode: "+1284", flag: "🇻🇬" },
  { iso: "BN", name: "Brunei", dialCode: "+673", flag: "🇧🇳" },
  { iso: "BG", name: "Bulgaria", dialCode: "+359", flag: "🇧🇬" },
  { iso: "BF", name: "Burkina Faso", dialCode: "+226", flag: "🇧🇫" },
  { iso: "BI", name: "Burundi", dialCode: "+257", flag: "🇧🇮" },
  { iso: "KH", name: "Cambodia", dialCode: "+855", flag: "🇰🇭" },
  { iso: "CM", name: "Cameroon", dialCode: "+237", flag: "🇨🇲" },
  { iso: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦" },
  { iso: "CV", name: "Cape Verde", dialCode: "+238", flag: "🇨🇻" },
  { iso: "KY", name: "Cayman Islands", dialCode: "+1345", flag: "🇰🇾" },
  { iso: "CF", name: "Central African Republic", dialCode: "+236", flag: "🇨🇫" },
  { iso: "TD", name: "Chad", dialCode: "+235", flag: "🇹🇩" },
  { iso: "CL", name: "Chile", dialCode: "+56", flag: "🇨🇱" },
  { iso: "CN", name: "China", dialCode: "+86", flag: "🇨🇳" },
  { iso: "CX", name: "Christmas Island", dialCode: "+61", flag: "🇨🇽" },
  { iso: "CC", name: "Cocos Islands", dialCode: "+61", flag: "🇨🇨" },
  { iso: "CO", name: "Colombia", dialCode: "+57", flag: "🇨🇴" },
  { iso: "KM", name: "Comoros", dialCode: "+269", flag: "🇰🇲" },
  { iso: "CK", name: "Cook Islands", dialCode: "+682", flag: "🇨🇰" },
  { iso: "CR", name: "Costa Rica", dialCode: "+506", flag: "🇨🇷" },
  { iso: "HR", name: "Croatia", dialCode: "+385", flag: "🇭🇷" },
  { iso: "CU", name: "Cuba", dialCode: "+53", flag: "🇨🇺" },
  { iso: "CW", name: "Curaçao", dialCode: "+599", flag: "🇨🇼" },
  { iso: "CY", name: "Cyprus", dialCode: "+357", flag: "🇨🇾" },
  { iso: "CZ", name: "Czechia", dialCode: "+420", flag: "🇨🇿" },
  { iso: "CD", name: "DR Congo", dialCode: "+243", flag: "🇨🇩" },
  { iso: "DK", name: "Denmark", dialCode: "+45", flag: "🇩🇰" },
  { iso: "DJ", name: "Djibouti", dialCode: "+253", flag: "🇩🇯" },
  { iso: "DM", name: "Dominica", dialCode: "+1767", flag: "🇩🇲" },
  { iso: "DO", name: "Dominican Republic", dialCode: "+1", flag: "🇩🇴" },
  { iso: "EC", name: "Ecuador", dialCode: "+593", flag: "🇪🇨" },
  { iso: "EG", name: "Egypt", dialCode: "+20", flag: "🇪🇬" },
  { iso: "SV", name: "El Salvador", dialCode: "+503", flag: "🇸🇻" },
  { iso: "GQ", name: "Equatorial Guinea", dialCode: "+240", flag: "🇬🇶" },
  { iso: "ER", name: "Eritrea", dialCode: "+291", flag: "🇪🇷" },
  { iso: "EE", name: "Estonia", dialCode: "+372", flag: "🇪🇪" },
  { iso: "SZ", name: "Eswatini", dialCode: "+268", flag: "🇸🇿" },
  { iso: "ET", name: "Ethiopia", dialCode: "+251", flag: "🇪🇹" },
  { iso: "FK", name: "Falkland Islands", dialCode: "+500", flag: "🇫🇰" },
  { iso: "FO", name: "Faroe Islands", dialCode: "+298", flag: "🇫🇴" },
  { iso: "FJ", name: "Fiji", dialCode: "+679", flag: "🇫🇯" },
  { iso: "FI", name: "Finland", dialCode: "+358", flag: "🇫🇮" },
  { iso: "FR", name: "France", dialCode: "+33", flag: "🇫🇷" },
  { iso: "GF", name: "French Guiana", dialCode: "+594", flag: "🇬🇫" },
  { iso: "PF", name: "French Polynesia", dialCode: "+689", flag: "🇵🇫" },
  { iso: "GA", name: "Gabon", dialCode: "+241", flag: "🇬🇦" },
  { iso: "GM", name: "Gambia", dialCode: "+220", flag: "🇬🇲" },
  { iso: "GE", name: "Georgia", dialCode: "+995", flag: "🇬🇪" },
  { iso: "DE", name: "Germany", dialCode: "+49", flag: "🇩🇪" },
  { iso: "GH", name: "Ghana", dialCode: "+233", flag: "🇬🇭" },
  { iso: "GI", name: "Gibraltar", dialCode: "+350", flag: "🇬🇮" },
  { iso: "GR", name: "Greece", dialCode: "+30", flag: "🇬🇷" },
  { iso: "GL", name: "Greenland", dialCode: "+299", flag: "🇬🇱" },
  { iso: "GD", name: "Grenada", dialCode: "+1473", flag: "🇬🇩" },
  { iso: "GP", name: "Guadeloupe", dialCode: "+590", flag: "🇬🇵" },
  { iso: "GU", name: "Guam", dialCode: "+1671", flag: "🇬🇺" },
  { iso: "GT", name: "Guatemala", dialCode: "+502", flag: "🇬🇹" },
  { iso: "GG", name: "Guernsey", dialCode: "+44", flag: "🇬🇬" },
  { iso: "GN", name: "Guinea", dialCode: "+224", flag: "🇬🇳" },
  { iso: "GW", name: "Guinea-Bissau", dialCode: "+245", flag: "🇬🇼" },
  { iso: "GY", name: "Guyana", dialCode: "+592", flag: "🇬🇾" },
  { iso: "HT", name: "Haiti", dialCode: "+509", flag: "🇭🇹" },
  { iso: "HN", name: "Honduras", dialCode: "+504", flag: "🇭🇳" },
  { iso: "HK", name: "Hong Kong", dialCode: "+852", flag: "🇭🇰" },
  { iso: "HU", name: "Hungary", dialCode: "+36", flag: "🇭🇺" },
  { iso: "IS", name: "Iceland", dialCode: "+354", flag: "🇮🇸" },
  { iso: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" },
  { iso: "ID", name: "Indonesia", dialCode: "+62", flag: "🇮🇩" },
  { iso: "IR", name: "Iran", dialCode: "+98", flag: "🇮🇷" },
  { iso: "IQ", name: "Iraq", dialCode: "+964", flag: "🇮🇶" },
  { iso: "IE", name: "Ireland", dialCode: "+353", flag: "🇮🇪" },
  { iso: "IM", name: "Isle of Man", dialCode: "+44", flag: "🇮🇲" },
  { iso: "IL", name: "Israel", dialCode: "+972", flag: "🇮🇱" },
  { iso: "IT", name: "Italy", dialCode: "+39", flag: "🇮🇹" },
  { iso: "CI", name: "Ivory Coast", dialCode: "+225", flag: "🇨🇮" },
  { iso: "JM", name: "Jamaica", dialCode: "+1876", flag: "🇯🇲" },
  { iso: "JP", name: "Japan", dialCode: "+81", flag: "🇯🇵" },
  { iso: "JE", name: "Jersey", dialCode: "+44", flag: "🇯🇪" },
  { iso: "JO", name: "Jordan", dialCode: "+962", flag: "🇯🇴" },
  { iso: "KZ", name: "Kazakhstan", dialCode: "+7", flag: "🇰🇿" },
  { iso: "KE", name: "Kenya", dialCode: "+254", flag: "🇰🇪" },
  { iso: "KI", name: "Kiribati", dialCode: "+686", flag: "🇰🇮" },
  { iso: "XK", name: "Kosovo", dialCode: "+383", flag: "🇽🇰" },
  { iso: "KW", name: "Kuwait", dialCode: "+965", flag: "🇰🇼" },
  { iso: "KG", name: "Kyrgyzstan", dialCode: "+996", flag: "🇰🇬" },
  { iso: "LA", name: "Laos", dialCode: "+856", flag: "🇱🇦" },
  { iso: "LV", name: "Latvia", dialCode: "+371", flag: "🇱🇻" },
  { iso: "LB", name: "Lebanon", dialCode: "+961", flag: "🇱🇧" },
  { iso: "LS", name: "Lesotho", dialCode: "+266", flag: "🇱🇸" },
  { iso: "LR", name: "Liberia", dialCode: "+231", flag: "🇱🇷" },
  { iso: "LY", name: "Libya", dialCode: "+218", flag: "🇱🇾" },
  { iso: "LI", name: "Liechtenstein", dialCode: "+423", flag: "🇱🇮" },
  { iso: "LT", name: "Lithuania", dialCode: "+370", flag: "🇱🇹" },
  { iso: "LU", name: "Luxembourg", dialCode: "+352", flag: "🇱🇺" },
  { iso: "MO", name: "Macao", dialCode: "+853", flag: "🇲🇴" },
  { iso: "MG", name: "Madagascar", dialCode: "+261", flag: "🇲🇬" },
  { iso: "MW", name: "Malawi", dialCode: "+265", flag: "🇲🇼" },
  { iso: "MY", name: "Malaysia", dialCode: "+60", flag: "🇲🇾" },
  { iso: "MV", name: "Maldives", dialCode: "+960", flag: "🇲🇻" },
  { iso: "ML", name: "Mali", dialCode: "+223", flag: "🇲🇱" },
  { iso: "MT", name: "Malta", dialCode: "+356", flag: "🇲🇹" },
  { iso: "MH", name: "Marshall Islands", dialCode: "+692", flag: "🇲🇭" },
  { iso: "MQ", name: "Martinique", dialCode: "+596", flag: "🇲🇶" },
  { iso: "MR", name: "Mauritania", dialCode: "+222", flag: "🇲🇷" },
  { iso: "MU", name: "Mauritius", dialCode: "+230", flag: "🇲🇺" },
  { iso: "YT", name: "Mayotte", dialCode: "+262", flag: "🇾🇹" },
  { iso: "MX", name: "Mexico", dialCode: "+52", flag: "🇲🇽" },
  { iso: "FM", name: "Micronesia", dialCode: "+691", flag: "🇫🇲" },
  { iso: "MD", name: "Moldova", dialCode: "+373", flag: "🇲🇩" },
  { iso: "MC", name: "Monaco", dialCode: "+377", flag: "🇲🇨" },
  { iso: "MN", name: "Mongolia", dialCode: "+976", flag: "🇲🇳" },
  { iso: "ME", name: "Montenegro", dialCode: "+382", flag: "🇲🇪" },
  { iso: "MS", name: "Montserrat", dialCode: "+1664", flag: "🇲🇸" },
  { iso: "MA", name: "Morocco", dialCode: "+212", flag: "🇲🇦" },
  { iso: "MZ", name: "Mozambique", dialCode: "+258", flag: "🇲🇿" },
  { iso: "MM", name: "Myanmar", dialCode: "+95", flag: "🇲🇲" },
  { iso: "NA", name: "Namibia", dialCode: "+264", flag: "🇳🇦" },
  { iso: "NR", name: "Nauru", dialCode: "+674", flag: "🇳🇷" },
  { iso: "NP", name: "Nepal", dialCode: "+977", flag: "🇳🇵" },
  { iso: "NL", name: "Netherlands", dialCode: "+31", flag: "🇳🇱" },
  { iso: "NC", name: "New Caledonia", dialCode: "+687", flag: "🇳🇨" },
  { iso: "NZ", name: "New Zealand", dialCode: "+64", flag: "🇳🇿" },
  { iso: "NI", name: "Nicaragua", dialCode: "+505", flag: "🇳🇮" },
  { iso: "NE", name: "Niger", dialCode: "+227", flag: "🇳🇪" },
  { iso: "NG", name: "Nigeria", dialCode: "+234", flag: "🇳🇬" },
  { iso: "NU", name: "Niue", dialCode: "+683", flag: "🇳🇺" },
  { iso: "NF", name: "Norfolk Island", dialCode: "+672", flag: "🇳🇫" },
  { iso: "KP", name: "North Korea", dialCode: "+850", flag: "🇰🇵" },
  { iso: "MK", name: "North Macedonia", dialCode: "+389", flag: "🇲🇰" },
  { iso: "MP", name: "Northern Mariana Islands", dialCode: "+1670", flag: "🇲🇵" },
  { iso: "NO", name: "Norway", dialCode: "+47", flag: "🇳🇴" },
  { iso: "OM", name: "Oman", dialCode: "+968", flag: "🇴🇲" },
  { iso: "PK", name: "Pakistan", dialCode: "+92", flag: "🇵🇰" },
  { iso: "PW", name: "Palau", dialCode: "+680", flag: "🇵🇼" },
  { iso: "PS", name: "Palestine", dialCode: "+970", flag: "🇵🇸" },
  { iso: "PA", name: "Panama", dialCode: "+507", flag: "🇵🇦" },
  { iso: "PG", name: "Papua New Guinea", dialCode: "+675", flag: "🇵🇬" },
  { iso: "PY", name: "Paraguay", dialCode: "+595", flag: "🇵🇾" },
  { iso: "PE", name: "Peru", dialCode: "+51", flag: "🇵🇪" },
  { iso: "PH", name: "Philippines", dialCode: "+63", flag: "🇵🇭" },
  { iso: "PL", name: "Poland", dialCode: "+48", flag: "🇵🇱" },
  { iso: "PT", name: "Portugal", dialCode: "+351", flag: "🇵🇹" },
  { iso: "PR", name: "Puerto Rico", dialCode: "+1", flag: "🇵🇷" },
  { iso: "QA", name: "Qatar", dialCode: "+974", flag: "🇶🇦" },
  { iso: "CG", name: "Republic of the Congo", dialCode: "+242", flag: "🇨🇬" },
  { iso: "RE", name: "Réunion", dialCode: "+262", flag: "🇷🇪" },
  { iso: "RO", name: "Romania", dialCode: "+40", flag: "🇷🇴" },
  { iso: "RU", name: "Russia", dialCode: "+7", flag: "🇷🇺" },
  { iso: "RW", name: "Rwanda", dialCode: "+250", flag: "🇷🇼" },
  { iso: "BL", name: "Saint Barthélemy", dialCode: "+590", flag: "🇧🇱" },
  { iso: "SH", name: "Saint Helena", dialCode: "+290", flag: "🇸🇭" },
  { iso: "KN", name: "Saint Kitts and Nevis", dialCode: "+1869", flag: "🇰🇳" },
  { iso: "LC", name: "Saint Lucia", dialCode: "+1758", flag: "🇱🇨" },
  { iso: "MF", name: "Saint Martin", dialCode: "+590", flag: "🇲🇫" },
  { iso: "PM", name: "Saint Pierre and Miquelon", dialCode: "+508", flag: "🇵🇲" },
  { iso: "VC", name: "Saint Vincent and the Grenadines", dialCode: "+1784", flag: "🇻🇨" },
  { iso: "WS", name: "Samoa", dialCode: "+685", flag: "🇼🇸" },
  { iso: "SM", name: "San Marino", dialCode: "+378", flag: "🇸🇲" },
  { iso: "ST", name: "Sao Tome and Principe", dialCode: "+239", flag: "🇸🇹" },
  { iso: "SA", name: "Saudi Arabia", dialCode: "+966", flag: "🇸🇦" },
  { iso: "SN", name: "Senegal", dialCode: "+221", flag: "🇸🇳" },
  { iso: "RS", name: "Serbia", dialCode: "+381", flag: "🇷🇸" },
  { iso: "SC", name: "Seychelles", dialCode: "+248", flag: "🇸🇨" },
  { iso: "SL", name: "Sierra Leone", dialCode: "+232", flag: "🇸🇱" },
  { iso: "SG", name: "Singapore", dialCode: "+65", flag: "🇸🇬" },
  { iso: "SX", name: "Sint Maarten", dialCode: "+1721", flag: "🇸🇽" },
  { iso: "SK", name: "Slovakia", dialCode: "+421", flag: "🇸🇰" },
  { iso: "SI", name: "Slovenia", dialCode: "+386", flag: "🇸🇮" },
  { iso: "SB", name: "Solomon Islands", dialCode: "+677", flag: "🇸🇧" },
  { iso: "SO", name: "Somalia", dialCode: "+252", flag: "🇸🇴" },
  { iso: "ZA", name: "South Africa", dialCode: "+27", flag: "🇿🇦" },
  { iso: "KR", name: "South Korea", dialCode: "+82", flag: "🇰🇷" },
  { iso: "SS", name: "South Sudan", dialCode: "+211", flag: "🇸🇸" },
  { iso: "ES", name: "Spain", dialCode: "+34", flag: "🇪🇸" },
  { iso: "LK", name: "Sri Lanka", dialCode: "+94", flag: "🇱🇰" },
  { iso: "SD", name: "Sudan", dialCode: "+249", flag: "🇸🇩" },
  { iso: "SR", name: "Suriname", dialCode: "+597", flag: "🇸🇷" },
  { iso: "SE", name: "Sweden", dialCode: "+46", flag: "🇸🇪" },
  { iso: "CH", name: "Switzerland", dialCode: "+41", flag: "🇨🇭" },
  { iso: "SY", name: "Syria", dialCode: "+963", flag: "🇸🇾" },
  { iso: "TW", name: "Taiwan", dialCode: "+886", flag: "🇹🇼" },
  { iso: "TJ", name: "Tajikistan", dialCode: "+992", flag: "🇹🇯" },
  { iso: "TZ", name: "Tanzania", dialCode: "+255", flag: "🇹🇿" },
  { iso: "TH", name: "Thailand", dialCode: "+66", flag: "🇹🇭" },
  { iso: "TL", name: "Timor-Leste", dialCode: "+670", flag: "🇹🇱" },
  { iso: "TG", name: "Togo", dialCode: "+228", flag: "🇹🇬" },
  { iso: "TK", name: "Tokelau", dialCode: "+690", flag: "🇹🇰" },
  { iso: "TO", name: "Tonga", dialCode: "+676", flag: "🇹🇴" },
  { iso: "TT", name: "Trinidad and Tobago", dialCode: "+1868", flag: "🇹🇹" },
  { iso: "TN", name: "Tunisia", dialCode: "+216", flag: "🇹🇳" },
  { iso: "TR", name: "Turkey", dialCode: "+90", flag: "🇹🇷" },
  { iso: "TM", name: "Turkmenistan", dialCode: "+993", flag: "🇹🇲" },
  { iso: "TC", name: "Turks and Caicos Islands", dialCode: "+1649", flag: "🇹🇨" },
  { iso: "TV", name: "Tuvalu", dialCode: "+688", flag: "🇹🇻" },
  { iso: "UG", name: "Uganda", dialCode: "+256", flag: "🇺🇬" },
  { iso: "UA", name: "Ukraine", dialCode: "+380", flag: "🇺🇦" },
  { iso: "AE", name: "United Arab Emirates", dialCode: "+971", flag: "🇦🇪" },
  { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧" },
  { iso: "US", name: "United States", dialCode: "+1", flag: "🇺🇸" },
  { iso: "UY", name: "Uruguay", dialCode: "+598", flag: "🇺🇾" },
  { iso: "UZ", name: "Uzbekistan", dialCode: "+998", flag: "🇺🇿" },
  { iso: "VU", name: "Vanuatu", dialCode: "+678", flag: "🇻🇺" },
  { iso: "VA", name: "Vatican City", dialCode: "+39", flag: "🇻🇦" },
  { iso: "VE", name: "Venezuela", dialCode: "+58", flag: "🇻🇪" },
  { iso: "VN", name: "Vietnam", dialCode: "+84", flag: "🇻🇳" },
  { iso: "VI", name: "U.S. Virgin Islands", dialCode: "+1340", flag: "🇻🇮" },
  { iso: "WF", name: "Wallis and Futuna", dialCode: "+681", flag: "🇼🇫" },
  { iso: "EH", name: "Western Sahara", dialCode: "+212", flag: "🇪🇭" },
  { iso: "YE", name: "Yemen", dialCode: "+967", flag: "🇾🇪" },
  { iso: "ZM", name: "Zambia", dialCode: "+260", flag: "🇿🇲" },
  { iso: "ZW", name: "Zimbabwe", dialCode: "+263", flag: "🇿🇼" },
];
```

(220 entries above; can be slightly expanded by implementor with overseas territories if needed; this list covers all UN member states + major dependencies. Default `GB` first-entry behavior must be preserved by `findCountryByIso`.)

#### 3.4.2 Update DEFAULT_PHONE_COUNTRY reference

Current line 84: `const DEFAULT_PHONE_COUNTRY: PhoneCountry = PHONE_COUNTRIES[0];` — relies on first entry being GB.

After alphabetical sort, first entry is `AF` (Afghanistan). Change to explicit lookup:

```typescript
const DEFAULT_PHONE_COUNTRY: PhoneCountry =
  PHONE_COUNTRIES.find((c) => c.iso === "GB") ?? PHONE_COUNTRIES[0];
```

#### 3.4.3 Add search bar to picker Sheet

Modify the Sheet contents (current lines 369-396). Add search Input at top + filter applied to map:

```tsx
const [pickerSearch, setPickerSearch] = useState<string>("");

const filteredCountries = useMemo<readonly PhoneCountry[]>(() => {
  const q = pickerSearch.trim().toLowerCase();
  if (q.length === 0) return PHONE_COUNTRIES;
  return PHONE_COUNTRIES.filter((c) => {
    const nameMatch = c.name.toLowerCase().includes(q);
    const dialMatch = c.dialCode.toLowerCase().startsWith(q.startsWith("+") ? q : `+${q}`);
    return nameMatch || dialMatch;
  });
}, [pickerSearch]);

// Reset search on picker close
useEffect(() => {
  if (!pickerOpen) setPickerSearch("");
}, [pickerOpen]);
```

Render inside the Sheet (above the ScrollView):

```tsx
<View style={styles.pickerSearchWrap}>
  <Input
    variant="search"
    value={pickerSearch}
    onChangeText={setPickerSearch}
    placeholder="Search country or dial code"
    clearable
    accessibilityLabel="Search countries"
  />
</View>
<ScrollView ...>
  {filteredCountries.map((c) => { ... })}
  {filteredCountries.length === 0 ? (
    <Text style={styles.pickerEmpty}>No matches</Text>
  ) : null}
</ScrollView>
```

Add styles:
```typescript
pickerSearchWrap: {
  paddingHorizontal: spacing.md,
  paddingTop: spacing.sm,
  paddingBottom: spacing.sm,
},
pickerEmpty: {
  fontSize: typography.bodySm.fontSize,
  color: textTokens.tertiary,
  textAlign: "center",
  paddingVertical: spacing.lg,
},
```

### 3.5 BrandEditView.tsx changes

**File:** `src/components/brand/BrandEditView.tsx`

#### 3.5.1 Inline TextArea component (replaces bio Input)

Add after `InlineToggle` (~line 100) before `BrandEditViewProps`:

```typescript
interface InlineTextAreaProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  minHeight?: number;
}

/**
 * InlineTextArea — multi-line text input matching the kit's Input visual
 * style. Composed inline (no kit extension per DEC-079) because the Input
 * primitive's container is hardcoded to 48px (single-line). Reusable
 * pattern for future multi-line fields (J-A9 invite note, J-A12 finance
 * description, etc.).
 */
const InlineTextArea: React.FC<InlineTextAreaProps> = ({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  minHeight = 120,
}) => {
  const [focused, setFocused] = useState<boolean>(false);
  return (
    <View
      style={[
        textAreaStyles.container,
        {
          minHeight,
          borderColor: focused
            ? accent.warm
            : "rgba(255, 255, 255, 0.12)",
          borderWidth: focused ? 1.5 : 1,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.quaternary}
        accessibilityLabel={accessibilityLabel}
        multiline
        textAlignVertical="top"
        underlineColorAndroid="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          textAreaStyles.input,
          {
            color: textTokens.primary,
            fontSize: typography.body.fontSize,
            fontWeight: typography.body.fontWeight,
          },
        ]}
      />
    </View>
  );
};

const textAreaStyles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radiusTokens.sm,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  input: {
    minHeight: 96,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
});
```

(Add `TextInput` to the existing react-native imports at top of file.)

#### 3.5.2 Replace bio Input usage

Find the bio Input (~line 312):
```tsx
<Input
  variant="text"
  value={draft.bio ?? ""}
  onChangeText={(v) => setDraft({ ...draft, bio: v })}
  placeholder="Tell people about your brand"
  accessibilityLabel="Bio / description"
  multiline
  numberOfLines={4}
  textAlignVertical="top"
/>
```

Replace with:
```tsx
<InlineTextArea
  value={draft.bio ?? ""}
  onChangeText={(v) => setDraft({ ...draft, bio: v })}
  placeholder="Tell people about your brand"
  accessibilityLabel="Bio / description"
/>
```

#### 3.5.3 Extend Social section with 6 new platforms

Find the Social Links section (~line 360). Replace the 2 Inputs with 8 in this order:

```tsx
{/* SECTION D — Social links */}
<Text style={styles.sectionLabel}>SOCIAL LINKS</Text>
<View style={styles.fieldsCol}>
  <Input
    variant="text"
    value={draft.links?.website ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, website: v } })
    }
    placeholder="yourbrand.com"
    leadingIcon="globe"
    accessibilityLabel="Website"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.instagram ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, instagram: v } })
    }
    placeholder="@yourbrand"
    leadingIcon="instagram"
    accessibilityLabel="Instagram"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.tiktok ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, tiktok: v } })
    }
    placeholder="@yourbrand"
    leadingIcon="tiktok"
    accessibilityLabel="TikTok"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.x ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, x: v } })
    }
    placeholder="@yourbrand"
    leadingIcon="x"
    accessibilityLabel="X (Twitter)"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.facebook ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, facebook: v } })
    }
    placeholder="yourbrand"
    leadingIcon="facebook"
    accessibilityLabel="Facebook"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.youtube ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, youtube: v } })
    }
    placeholder="@yourbrand"
    leadingIcon="youtube"
    accessibilityLabel="YouTube"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.linkedin ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, linkedin: v } })
    }
    placeholder="yourbrand"
    leadingIcon="linkedin"
    accessibilityLabel="LinkedIn"
    clearable
  />
  <Input
    variant="text"
    value={draft.links?.threads ?? ""}
    onChangeText={(v) =>
      setDraft({ ...draft, links: { ...draft.links, threads: v } })
    }
    placeholder="@yourbrand"
    leadingIcon="threads"
    accessibilityLabel="Threads"
    clearable
  />
</View>
```

Note: leadingIcon for "website" changes from `link` (chain) to `globe` (per D-FORENSICS-A8P-4 — `globe` already in the kit, semantically clearer for "website").

### 3.6 BrandProfileView.tsx — socialsRow rewrite

**File:** `src/components/brand/BrandProfileView.tsx`

#### 3.6.1 Delete current contactCol + linksRow blocks

Find and DELETE the existing contactCol render (lines ~263-278) and linksRow render (lines ~281-301). Also delete the associated styles `contactCol`, `contactRow`, `contactText`, `linksRow`.

#### 3.6.2 Add unified socialsRow renderer

In the hero GlassCard, AFTER the bio block (or empty-bio CTA), insert:

```tsx
{(() => {
  // Build the icon chip list: only render chips for non-empty fields
  const chips: Array<{ key: string; icon: IconName; aria: string }> = [];
  if (typeof brand.contact?.email === "string" && brand.contact.email.length > 0) {
    chips.push({ key: "email", icon: "mail", aria: `Email ${brand.contact.email}` });
  }
  if (typeof brand.contact?.phone === "string" && brand.contact.phone.length > 0) {
    chips.push({ key: "phone", icon: "phone", aria: `Phone ${brand.contact.phone}` });
  }
  if (typeof brand.links?.website === "string" && brand.links.website.length > 0) {
    chips.push({ key: "website", icon: "globe", aria: `Website ${brand.links.website}` });
  }
  if (typeof brand.links?.instagram === "string" && brand.links.instagram.length > 0) {
    chips.push({ key: "instagram", icon: "instagram", aria: `Instagram ${brand.links.instagram}` });
  }
  if (typeof brand.links?.tiktok === "string" && brand.links.tiktok.length > 0) {
    chips.push({ key: "tiktok", icon: "tiktok", aria: `TikTok ${brand.links.tiktok}` });
  }
  if (typeof brand.links?.x === "string" && brand.links.x.length > 0) {
    chips.push({ key: "x", icon: "x", aria: `X ${brand.links.x}` });
  }
  if (typeof brand.links?.facebook === "string" && brand.links.facebook.length > 0) {
    chips.push({ key: "facebook", icon: "facebook", aria: `Facebook ${brand.links.facebook}` });
  }
  if (typeof brand.links?.youtube === "string" && brand.links.youtube.length > 0) {
    chips.push({ key: "youtube", icon: "youtube", aria: `YouTube ${brand.links.youtube}` });
  }
  if (typeof brand.links?.linkedin === "string" && brand.links.linkedin.length > 0) {
    chips.push({ key: "linkedin", icon: "linkedin", aria: `LinkedIn ${brand.links.linkedin}` });
  }
  if (typeof brand.links?.threads === "string" && brand.links.threads.length > 0) {
    chips.push({ key: "threads", icon: "threads", aria: `Threads ${brand.links.threads}` });
  }
  if (chips.length === 0) return null;
  return (
    <View style={styles.socialsRow}>
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          onPress={handleOpenLink}
          accessibilityRole="button"
          accessibilityLabel={chip.aria}
          style={styles.socialChip}
        >
          <Icon name={chip.icon} size={18} color={accent.warm} />
        </Pressable>
      ))}
    </View>
  );
})()}
```

(`handleOpenLink` is the existing TRANSITIONAL Toast handler — preserve D-IMPL-A7-5 deferral. Update its Toast copy if not already: "Opening links lands in a later cycle.")

#### 3.6.3 Add styles

```typescript
socialsRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.sm,
  marginTop: spacing.md,
},
socialChip: {
  width: 36,
  height: 36,
  borderRadius: 999,
  backgroundColor: accent.tint,
  borderWidth: 1,
  borderColor: accent.border,
  alignItems: "center",
  justifyContent: "center",
},
```

Remove obsolete styles: `contactCol`, `contactRow`, `contactText`, `linksRow`.

---

## 4. Success Criteria

**P-1 (Bio):**
- AC#1 Bio TextArea renders ≥120px tall
- AC#2 Bio accepts and renders multi-line text with line breaks
- AC#3 Bio TextArea border animates 1px→1.5px on focus (matches Input style)

**P-2 (Country picker):**
- AC#4 Picker Sheet shows all 220+ countries
- AC#5 Picker has search bar at top
- AC#6 Search filters list as user types (case-insensitive, name OR dial code)
- AC#7 "No matches" empty state when filter returns nothing
- AC#8 Search clears when picker closes
- AC#9 `[TRANSITIONAL]` marker on PHONE_COUNTRIES retired
- AC#10 GB still default country (`findCountryByIso("GB")` returns GB)

**P-3 (Multi-platform icons):**
- AC#11 Icon set has 8 new IconName entries (phone, instagram, tiktok, x, facebook, youtube, linkedin, threads)
- AC#12 Brand schema extended v4→v5 with 6 new optional platform fields
- AC#13 BrandEditView Social section has 8 inputs (website + 7 platforms)
- AC#14 J-A7 hero shows icon-only chips for any non-empty contact/social field
- AC#15 Empty fields hide their chips (no placeholder, no empty space)
- AC#16 When ALL contact + social fields are empty → entire socialsRow hidden
- AC#17 Each chip is tappable → fires `[TRANSITIONAL]` Toast (D-IMPL-A7-5 preserved)
- AC#18 Chip render order: email → phone → website → instagram → tiktok → x → facebook → youtube → linkedin → threads
- AC#19 Stub brands seed with mixed coverage (Lonely Moth all 8, The Long Lunch 3, Sunday Languor 6, Hidden Rooms 2)

**Cross-cutting:**
- AC#20 `npx tsc --noEmit` exits 0
- AC#21 No new files in `src/components/ui/` (kit closure)
- AC#22 Persist v4→v5 cold-launch safe (existing v4 brands hydrate; new fields undefined)
- AC#23 Web parity: edit form + view profile work identically on iOS / Android / web

---

## 5. Invariants

| ID | Preserve / Establish |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS / Android / web all execute |
| I-6 | tsc strict clean |
| I-7 | Retire P-2 PHONE_COUNTRIES TRANSITIONAL; preserve D-IMPL-A7-5 social-tap TRANSITIONAL |
| I-9 | No animation timings touched |
| I-11 | Format-agnostic ID resolver unchanged |
| I-12 | Host-bg cascade unchanged |
| DEC-079 | Kit closure preserved (8 new icons additive per DEC-082; TextArea local composition; PHONE_COUNTRIES data extension) |

**New decision proposed: DEC-082** — Icon set additive expansion. Future icon additions follow this pattern (additive within `Icon.tsx`, line-style 24×24 viewBox, no breaking changes).

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | Bio multi-line growth | Type 3 paragraphs in bio field | All visible; container ≥120px | Component |
| T-2 | Bio focus animation | Tap bio field | Border thickens to 1.5px accent.warm | Component |
| T-3 | Country picker — full list | Open picker | 220+ countries scroll list | Component |
| T-4 | Country search by name | Type "ja" | "Jamaica", "Japan" appear | Component |
| T-5 | Country search by dial code | Type "+91" | "India" appears | Component |
| T-6 | Country search empty | Type "xyz123" | "No matches" renders | Component |
| T-7 | Country search clear on close | Type, close picker, reopen | Search empty | Component |
| T-8 | Country GB default | Cold launch with no defaultCountryIso | GB selected | State |
| T-9 | J-A7 view all 8 chips | Open Lonely Moth (all 8 platforms seeded) | 10 chips render (email, phone, website + 7 social) | Full stack |
| T-10 | J-A7 view subset chips | Open Hidden Rooms (only website + instagram) | 4 chips render (email, phone, website, instagram) | Full stack |
| T-11 | J-A7 socialsRow hidden | New brand with no contact/social | socialsRow not rendered | Component |
| T-12 | J-A8 social section 8 inputs | Open edit, scroll to Social Links | 8 Inputs visible (website + 7 platforms) | Component |
| T-13 | J-A8 edit social → save → view | Edit tiktok handle, save | J-A7 view shows TikTok chip | Full stack |
| T-14 | Empty social field hides chip | Edit Lonely Moth, clear x field, save | x chip absent on view | Full stack |
| T-15 | Persist v4→v5 migration | Cold-launch device with J-A8 (v4) state | App opens, brands intact, new fields undefined | State migration |
| T-16 | tsc strict | `npx tsc --noEmit` | exit 0 | Build |
| T-17 | TRANSITIONAL grep | Grep PHONE_COUNTRIES | No `[TRANSITIONAL]` marker | Build |
| T-18 | Web direct URL parity | Paste /brand/lm/edit; click any country | Picker opens with full list | Route + web |
| T-19 | Icon visual smoke | Inspect Lonely Moth profile on iOS | All 10 icons render correctly (no fallback squares) | Visual |
| T-20 | Chip tap TRANSITIONAL | Tap any social chip on profile | Toast "Opening links lands in a later cycle." | Component |
| T-21 | Bio render with newlines | Save bio with `\n`, reload | Multi-line preserved | Full stack |
| T-22 | Country search performance | Type quickly | Filter applies without lag (220 items × debounced) | Runtime |

---

## 7. Implementation Order

1. **Schema** — `currentBrandStore.ts` v4→v5 (BrandLinks + 6 new fields + migration + header)
2. **Stub data** — `brandList.ts` (4 stubs with platform-handle mix)
3. **tsc check** — clean
4. **Icon set** — `Icon.tsx` (8 IconName entries + 8 RENDERER functions appended)
5. **tsc check** — clean
6. **Input.tsx** — replace PHONE_COUNTRIES + add picker search + DEFAULT_PHONE_COUNTRY explicit lookup
7. **tsc check** — clean
8. **BrandEditView.tsx** — InlineTextArea component + replace bio Input + extend Social section to 8 fields
9. **tsc check** — clean
10. **BrandProfileView.tsx** — delete contactCol + linksRow + obsolete styles; add socialsRow; update handleOpenLink Toast copy if needed
11. **tsc check** — clean (final)
12. **Grep verify** — PHONE_COUNTRIES TRANSITIONAL retired; D-IMPL-A7-5 social-tap TRANSITIONAL preserved (handleOpenLink)
13. **Implementation report**

---

## 8. Regression Prevention

- **TextArea inline pattern** documented in BrandEditView header comment as reusable (e.g., for J-A9 invite note multi-line, J-A12 finance description)
- **Icon expansion pattern** formalized via DEC-082 → future additions follow precedent (additive only, line-style 24×24)
- **Country list as static data** — comment in Input.tsx: "Phone validation lives at backend B1+; this list is just for chip presentation"
- **Chip-render guard pattern** (only render when field is non-empty string) reusable for any future "show what's filled" UI

---

## 9. Founder-facing UX (plain English)

When this lands the founder will:
- Edit a brand → bio field is 4× taller; can write a real description with line breaks
- Edit a brand → tap phone country chip → see ALL countries with a search bar at top
- Edit a brand → Social Links section now has 8 rows (website, Instagram, TikTok, X, Facebook, YouTube, LinkedIn, Threads), each with the platform's icon
- Open a brand profile → contact + social shown as a clean row of icon-only chips
- Empty fields = hidden chips (clean look — no awkward empty rows)
- Tap any chip → Toast "Opening links lands in a later cycle." (real link opening still deferred to Cycle 3+)

**What this DOESN'T do yet:** open external URLs on chip tap (Cycle 3+), photo upload (still Toast), custom links multi-add UI, currency/timezone settings (cycle scope).

---

## 10. Out-of-band carve-outs

| Carry-over | Status |
|---|---|
| **D-IMPL-A7-5** Social link TRANSITIONAL | ✅ PRESERVED — chip taps still fire Toast |
| **D-IMPL-A7-6** Host-bg cascade (now I-12) | ✅ PRESERVED |
| **D-IMPL-A8-1** Empty-bio CTA stale Toast | ❌ DEFERRED to separate micro-fix |
| **D-IMPL-38** Sign-out doesn't clear brand store | ❌ DEFERRED to B1 backend cycle |

---

## 11. Dispatch hand-off

Implementor dispatch shall reference both:
- `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_2_J_A8_POLISH.md`
- `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_2_J_A8_POLISH.md` (this file)

Implementor follows §7 implementation order verbatim. Tester verifies T-1 through T-22.

---

**End of J-A8 polish spec.**
