const read = (name: string): Promise<string> =>
  Deno.readTextFile(new URL(`../${name}`, import.meta.url));

const bodies = {
  event: await read("EventOfferingBody.tsx"),
  rsvp: await read("RsvpOfferingBody.tsx"),
  trip: await read("TripOfferingBody.tsx"),
  experience: await read("ExperienceOfferingBody.tsx"),
};

Deno.test("#3682 all four offering bodies render the shared count line from optional props", () => {
  for (const [name, source] of Object.entries(bodies)) {
    for (const signature of [
      "presentedByFollowerCount?: number | null",
      "presentedByFollowerCountLoading?: boolean",
      "<FollowerCountLine",
      "count={presentedByFollowerCount}",
      "loading={presentedByFollowerCountLoading}",
    ]) {
      if (!source.includes(signature)) throw new Error(`${name} missing ${signature}`);
    }
  }
});

Deno.test("#3682 Trip and Experience keep Follow as a sibling of identity", () => {
  for (const name of ["trip", "experience"] as const) {
    const source = bodies[name];
    if (!source.includes("presentedByFollow?: React.ReactNode")) {
      throw new Error(`${name} missing presentedByFollow prop`);
    }
    const card = source.slice(source.indexOf("styles.brandFollowerCount"));
    const close = card.indexOf("</Pressable>");
    const slot = card.indexOf("{presentedByFollow}");
    if (close < 0 || slot < close) {
      throw new Error(`${name} nests Follow inside the identity Pressable`);
    }
  }
});
