export const BLOG_CATEGORIES = Object.freeze([
  { slug: "going-out", label: "Going out" },
  { slug: "date-ideas", label: "Date ideas" },
  { slug: "host-playbook", label: "Host playbook" },
  { slug: "product-news", label: "Product news" },
]);

export const BLOG_CITY_TARGETS = Object.freeze([
  ["lagos", "Lagos"], ["durham-nc", "Durham"], ["cary-nc", "Cary"], ["raleigh-nc", "Raleigh"],
  ["new-york-city", "New York City"], ["brussels", "Brussels"], ["paris", "Paris"], ["london", "London"],
  ["fort-lauderdale", "Fort Lauderdale"], ["washington-dc", "Washington, DC"],
].map(([slug, label]) => Object.freeze({ slug, label, path: `/cities/${slug}` })));

const HELP = [
  ["getting-the-apps", "Getting the apps"], ["sign-up-and-create-a-brand", "Sign up and create your brand"],
  ["connect-a-bank-and-get-paid", "Connect a bank and get paid"], ["sell-tickets-to-a-one-night-event", "Sell tickets to a one-night event"],
  ["sell-tickets-to-an-event-in-nigeria", "Sell tickets to an event in Nigeria"], ["sell-tickets-to-a-multi-day-event", "Sell tickets to a multi-day event"],
  ["sell-tickets-to-a-multi-day-event-in-nigeria", "Sell tickets to a multi-day event in Nigeria"], ["sell-tickets-to-a-weekly-event", "Sell tickets to a weekly event"],
  ["sell-tickets-to-an-online-event", "Sell tickets to an online event"], ["sell-tickets-to-an-online-event-from-nigeria", "Sell tickets to an online event from Nigeria"],
  ["sell-tickets-to-a-hybrid-event-in-nigeria", "Sell tickets to a hybrid event in Nigeria"], ["sell-tickets-to-a-hybrid-event-in-new-york", "Sell tickets to a hybrid event in New York"],
  ["run-a-free-rsvp-night", "Run a free RSVP night"], ["create-an-unlisted-rsvp-event-in-nigeria", "Create an unlisted RSVP event in Nigeria"],
  ["create-a-recurring-event-in-nigeria", "Create a recurring event in Nigeria"], ["create-and-submit-your-venue", "Create and submit your venue"],
  ["polish-your-listing-and-go-live", "Polish your listing and go live"], ["build-your-menu", "Build your menu"],
  ["build-your-guest-list-and-groups", "Build your guest list and groups"], ["send-a-campaign-to-a-group", "Send a campaign to a group"],
];

export const BLOG_MARKETING_PAGE_TARGETS = Object.freeze([
  ["/", "Mingla home"], ["/host", "Mingla Host"], ["/going-out", "Going out with Mingla"],
  ["/cities", "Cities"], ["/tools", "Free tools"], ["/help", "Help centre"], ["/blog", "Blog"],
  ...BLOG_CATEGORIES.map((category) => [`/blog/category/${category.slug}`, category.label]),
  ...BLOG_CITY_TARGETS.map((city) => [city.path, city.label]),
  ...HELP.map(([slug, label]) => [`/help/${slug}`, label]),
].map(([path, label]) => Object.freeze({ path, label })));

export function searchStaticBlogTargets(query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return BLOG_MARKETING_PAGE_TARGETS;
  return BLOG_MARKETING_PAGE_TARGETS.filter((target) => `${target.label} ${target.path}`.toLowerCase().includes(needle));
}
