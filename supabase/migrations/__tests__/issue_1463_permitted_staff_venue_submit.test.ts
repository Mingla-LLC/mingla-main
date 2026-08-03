import { assert, assertEquals } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20270208001463_issue_1463_permitted_staff_venue_submit.sql",
);
const bookings = await Deno.readTextFile(
  "mingla-business/src/components/venue/venueBookingSetupCopy.ts",
);
const bookingsStep = await Deno.readTextFile(
  "mingla-business/src/components/venue/claim/ClaimStepBookings.tsx",
);
const sanitizer = await Deno.readTextFile(
  "mingla-business/src/utils/sanitizeAuthoringError.ts",
);

Deno.test(
  "#1463: create authority moves only to canonical event_manager",
  () => {
    assertEquals(
      migration.match(/biz_role_rank\('event_manager'\)/g)?.length,
      1,
    );
    assert(!migration.includes("biz_role_rank('brand_owner')"));
    assertEquals(
      migration.match(
        /CREATE OR REPLACE FUNCTION public\.biz_create_venue_listing/g,
      )?.length,
      1,
    );
    assert(
      !migration.includes("CREATE OR REPLACE FUNCTION public.biz_publish_stay"),
    );
    assert(!migration.includes("UPDATE public.feature_flags"));
    assert(!migration.includes("INSERT INTO public.feature_flags"));
  },
);

Deno.test(
  "#1463: authenticated-only execution and pending-review truth remain",
  () => {
    assert(migration.includes("FROM anon;"));
    assert(migration.includes("TO authenticated;"));
    assert(migration.includes("'pending_review'"));
    assert(migration.includes("SECURITY DEFINER"));
  },
);

Deno.test(
  "#1463: Stay booking copy and structured error safety are wired",
  () => {
    assert(
      bookings.includes(
        "You can set rooms, reservable places, availability and fees after you're live.",
      ),
    );
    assert(bookings.includes('venueCategory === "stay"'));
    assert(bookingsStep.includes("venueBookingSetupCopy(venueCategory"));
    assert(sanitizer.includes('typeof err !== "object"'));
    assert(sanitizer.includes("Ask a brand owner to update your role."));
  },
);
