---
area: venues
summary: The two physical sites and getting between them, the live room board per venue, food vendors, the expo/sponsor tiers, and the static accessibility and code-of-conduct pages.
read_when: touching /venues, /food, /expo, /accessibility, /code-of-conduct, travel times between sites, VenueBoard, the route map, the sponsor marquee
files:
  - src/pages/VenuesPage.jsx
  - src/components/VenueBoard.jsx
  - src/components/VenueRouteMap.jsx
  - src/lib/travel.js
  - src/pages/ExpoPage.jsx
  - src/pages/FoodPage.jsx
  - src/pages/AccessibilityPage.jsx
  - src/pages/CodeOfConductPage.jsx
  - src/components/SponsorMarquee.jsx
tests:
  - tests/unit/travel.test.js
  - tests/smoke.spec.js
  - tests/live.spec.js
related: [seed, clock, schedule, agenda, ui]
---

# Venues

## How it works

**Data.** Tables `venues` (with real `lat`/`lng`, `is_primary`, `wifi_ssid`,
`opens_at`/`closes_at`), `venue_travel` (PK `from_venue_id, to_venue_id, mode`;
`minutes`, `cost_usd`, `note`), `rooms` (`venue_id`, `capacity`,
`walk_minutes`, `amenities` CSV, `accessible`), `vendors`, `sponsors`. All
seeded in `server/seed.js` (`VENUES`, `TRAVEL`, `AURORA_ROOMS` …). Mappers in
`server/lib/query.js`: `toVenue`, `toTravel`, `toRoom` (splits `amenities` to
an array), `toVendor` (splits `dietary`), `toSponsor`.

**API — all in `server/routes/meta.js`** (no dedicated venues router):

- `GET /api/bootstrap` carries `venues`, `travel`, `rooms`, `cuisines` → exposed
  by `useConference()` as `venues`, `travel`, `rooms`, `cuisines`, plus
  `venueById` (built in store.jsx). Use these; do not refetch.
- `GET /api/venues` → primary first, each venue with `rooms[]`, `vendorCount`,
  `sessionCount`. Only `VenuesPage` calls it (`api.getVenues`).
- `GET /api/vendors?venueId&cuisine&dietary&q` → SQL built per request,
  `dietary` is a `LIKE`, ordered `rating DESC, name`.
- `GET /api/sponsors` → ordered by tier (Diamond → Bronze via `CASE`), then name.

**Travel is directional.** Aurora→Foundry and Foundry→Aurora are separate rows
with different minutes; never assume symmetry.

- `travel.js:routesBetween(travel, fromId, toId)` — rows for that direction,
  fastest first. Includes `Walk`. Used by `VenuesPage` (`TravelPanel`) and
  `SessionPage` (which filters out `Walk` itself).
- `travel.js:assessTravel({ travel, from, to, gapMinutes })` — `from`/`to` are
  sessions (needs `.venue.id` and `to.room.walkMinutes`). Returns `null` if same
  venue or no route. Otherwise `{ gapMinutes, walk, options, fastest, free,
  impossible, freeTooSlow }`; each option gets `total = minutes + walk` and
  `fits`. Excludes `Walk`. `free` = the first `costUsd === 0` option. My Agenda calls it
  through `agendaDays.js:travelWarnings` to warn about a cross-town hop between two
  seated sessions; `tests/unit/travel.test.js` covers it.

**`VenuesPage`** — URL params `venue` (id; defaults to first = primary) and
`day` (defaults to `clock.day`). Unlike other pages, `set()` never deletes a
key. Sections: `TravelPanel` (`data-testid="travel-panel"`: `VenueRouteMap` +
one card per mode, `Walk` greyed), a venue `role="tablist"` of
`data-testid="venue-tab-{id}"` buttons, day buttons (`aria-pressed`),
`VenueFacts`, then `VenueBoard`.

**`VenueRouteMap({ venues, routes, className })`** — SVG 900×290. `project()`
maps lng → x across `W - 2*PAD_X` and lat → y inside a `SPREAD_Y` band (north
up), so positions come only from real coordinates. Draws a dashed quadratic arc
between the first two venues, a label with the fastest non-Walk route, and a
pin per venue coloured with `accentHex(v.accent)`. Needs `v.roomCount` on each
venue — `TravelPanel` adds it. Returns null with fewer than two venues. The
"6.2 miles" label is literal text in the SVG.

**`VenueBoard({ venue, day })`** (`data-testid="venue-board-{venueId}"`) —
fetches `api.getSessions({ day, venueId })`, groups by the venue's `rooms`
from `useConference()`. Per room: `current` (only when `clock.day === day`,
start ≤ now < end) and `next` (starts after now, or first of the day on another
day). Sort: live rooms first, then most sessions, then capacity. Seat numbers
prefer the store's live `seatsFor(id)` over the fetched payload;
`reservationFor(id)` shows the "On my agenda"/"Waitlisted" chip. Rooms with no
sessions that day are listed in one "stages are dark" line. Time maths from
`src/lib/clock.js` (`toMinutes`, `relativeToNow`).

**`FoodPage`** — params `q`, `venue`, `dietary` (`vegan | vegetarian |
gluten-free`), `cuisine` (server-side), `sort` (`rating` default | `wait` |
`name`) and `open=1` (client-side, `clock.js:isOpenAt`, which handles closing
after midnight). With `sort=rating`, the first vendor is `featured` (spans 2
columns, "Top rated"). Cover art is `GeneratedCover variant="mesh"` coloured by
`accentFor(vendor.cuisine)`. Testids: `food-filters`, `food-search`,
`open-now-toggle`, `vendor-count`.

**`ExpoPage`** — `TIERS` and `TIER_STYLE` drive grid columns, logo size, banner
(`strata` cover, Diamond/Platinum only) and whether the blurb shows (not Silver
or Bronze). Section testid `tier-{tier lowercase}`. Logos are `GeneratedCover
variant="mark"`. Cards are divs, not links (no `website` shown).

**`SponsorMarquee`** — on `HomePage`. Diamond/Platinum/Gold only, hidden if
fewer than 4; renders the list twice for the `animate-marquee` loop (second copy
`aria-hidden`, `tabIndex=-1`), each links to `/expo`. Testid `sponsor-marquee`.

**`AccessibilityPage`** — derived entirely from `rooms` + `venueById`: counts
of step-free rooms, `Hearing loop`, `Live captions`, stairs-only; a
`data-testid="stairs-only"` list (self-hides); a room-by-room list.
**`CodeOfConductPage`** — static copy in `EXPECTED` / `UNACCEPTABLE` arrays.

## Invariants

- Venue geometry is only ever projected from `lat`/`lng`. There are no room map
  coordinates (see CLAUDE.md § Imagery on why the floor plan was removed).
- Accessibility facts come from `rooms.accessible` and `rooms.amenities`; the
  amenity strings are matched literally (`'Hearing loop'`, `'Live captions'`,
  `'Quiet space'`), so renaming one in the seed silently zeroes a count.
- All five routes are in the smoke suite by heading text (`Venues & stages`,
  `Food & drink`, `Partners & sponsors`, `Code of conduct`, `Accessibility`) —
  change a title and update `tests/smoke.spec.js`.

## Gotchas

- `VenueBoard` and `FoodPage` read `clock` — a Playwright test on them must pin
  it with `visit(page, path, { at })` (see `tests/live.spec.js`).
- `assessTravel` ignores `Walk` but `routesBetween` does not; callers that want
  only realistic modes must filter.
- Sponsor `website` is mapped but deliberately never rendered.

## Where to change…

- A new travel mode or time: `TRAVEL` in `server/seed.js`; the UI reads rows.
- Travel reasoning between two sessions: `travel.js:assessTravel`.
- What a room card on the board shows: `VenueBoard`.
- A new vendor filter: `metaRouter.get('/vendors')` + `FoodPage` `Select`.
- Sponsor tier layout: `TIER_STYLE` in `ExpoPage.jsx`.
