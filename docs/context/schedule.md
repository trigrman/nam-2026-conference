---
area: schedule
summary: Browsing the programme — /schedule in grid or list view with URL filters, the session cards, and a session's detail page, all fed by /api/sessions.
read_when: touching /schedule, its filters or grid/list views, ScheduleGrid, SessionCard, the session detail page, or the /sessions endpoints
files:
  - src/pages/SchedulePage.jsx
  - src/components/ScheduleGrid.jsx
  - src/components/FilterBar.jsx
  - src/components/SessionCard.jsx
  - src/pages/SessionPage.jsx
  - server/routes/sessions.js
tests:
  - tests/schedule.spec.js
  - tests/session.spec.js
related: [seats, attendance, agenda, venues, speakers, ui, clock]
---

# Schedule

Why two views, and why content filters kill the grid: CLAUDE.md § The schedule has
two views. Why only keynotes are featured: § Visual hierarchy. This doc is where it lives.

## How it works

**`GET /api/sessions`** — `sessions.js` builds SQL per request (the documented
exception to module-scope prepares). Each present param appends a `where` clause
and a bound `?` to `args`:

| param | clause |
| --- | --- |
| `day` | `s.day = ?` |
| `trackSlug` | `t.slug IN (?, …)` — comma-separated list, empty parts ignored |
| `venueId` / `roomId` | `v.id = ?` / `r.id = ?` |
| `level` / `format` | `s.level = ?` / `s.format = ?` |
| `q` | `LIKE %q%` on title, abstract, subtitle, or any speaker name (`EXISTS`) |
| `tagSlug` | `EXISTS` on `session_tags` ⨝ `tags` |
| `speakerId` | `EXISTS` on `session_speakers` |
| `followedBy` | `EXISTS` sessions by speakers in that user's `speaker_follows` (no UI sends it yet; `api.getFollowedSessions`) |
| `reservedBy` | `EXISTS` any reservation (confirmed **or** waitlisted) |
| `sort` | `rating` → avg_rating, rating_count desc · `popularity` → fill ratio desc · default `s.day, s.starts_at, r.name` |

Result is `hydrateSessions(...)` (speakers + tags). To add a filter: one `if`
here, then pass it through `api.getSessions(filters)`; `qs()` in `src/lib/api.js`
drops `'all'`, `''`, null.

**`GET /api/sessions/:id`** returns `toSession(row, { speakers, tags })` plus
`seats` (`seatState(id, ?userId)` from `server/lib/seats.js`), `reviews` (ratings
with a non-null `comment`, newest first, with author), `alsoInRoom` (same room and
day) and `competing` (same day and `starts_at`, top 6 by `avg_rating`). Those two
lists are plain `toSession` — no speakers/tags. **`/:id.ics`** is registered
*before* `/:id` and delegates to `ical.js:sessionCalendar` (agenda doc).

**`SchedulePage`** reads everything from `useSearchParams`:
`day` (default `clock.day` if it is a conference day, else `days[0].date`),
`track`, `venue` (venue id), `level`, `format`, `tag` (topic slug), `q`, `view`.
Page keys map to API keys in the `useFetch` call (`track→trackSlug`,
`venue→venueId`, `tag→tagSlug`). `set(key, value)` deletes the key for `'all'`/empty
and writes with `{ replace: true }`; `clearAll` keeps `day` and an explicit `view`.
The empty state's heading is `No sessions match`, followed by the search text in curly quotes when `q` is set.

**Grid vs list.** `requestedView = ?view ?? (useMediaQuery('(min-width: 1024px)') ? 'grid' : 'list')`.
`BLOCKERS` is `[key, human phrase]` for `q`, `track`, `tag`, `level`, `format`;
`blocker` is the first active one. With a blocker, `view` is forced to `'list'`,
the Grid tab is `disabled` with a `title` naming the blocker, and
`grid-blocked-notice` offers `clearBlocker` (deletes all blocker keys, sets
`view=grid`). `venue` is deliberately not a blocker.

The list groups sessions by `startsAt` into `slot-<HH:MM>` sections of
`SessionCard`s in a `grid-flow-row-dense` auto-fit grid. The filter rail
(`aside`, hidden below `lg` until the Filters button toggles `railOpen`) holds
`search-input`, `starred-count` (= `reservations.size`, the agenda count), day
buttons `tab-<date>`, track pills (toggles with `aria-pressed`, several at once; All clears), and `Select`s for venue/level/format/topic.
Below `lg` the open rail is compact so the first card stays in view at 393×659: days in one
row (no weekday or count), tracks in one scrolling row (the Day and Track headings turn screen-reader-only), selects in two columns, and the
My agenda card is desktop-only (`starred-count` stays in the DOM, `hidden lg:block`);
its link opens `/my-agenda`, which is a placeholder (agenda doc).
`result-count` shows `Loading…` then `N sessions`.

**`ScheduleGrid`** (`schedule-grid`, `role="table"`) — splits `sessions` into
`gridSessions` and `bannerSessions` (`isKeynote || format === 'Social'`). Columns
are the distinct rooms of `gridSessions` (so a venue filter drops columns), primary
venue first then by name; each header takes (and is tinted by) the track of the
*first* session seen in that room — the track that room runs that day. Rows are every distinct `startsAt` across all sessions; at each,
banners render first as full-width rows (`5rem 1fr`), then a cell row if any room
has a session. Columns use a CSS var `--grid: 5rem repeat(n, minmax(9rem, 1fr))`
inside `min-w-[52rem]`. Cells show live (rose) / booked (emerald) / done (faded)
only when `sessions[0].day === clock.day`, and seats from `seatsFor` over the payload.
A seat button on a session that `hasEnded` and is not held is disabled and named
"Session ended" (banner) / "<title> has ended" (cell).

**`SessionCard`** — `variant="grid"` (default, an `<article>`) or `variant="row"`
(a `<div>`, used by the session page's competing list). `showDay`
prefixes `MM-DD`. Row only: an optional `attendance` prop (`{ ended, checkedIn, myStars }`,
meant for confirmed seats; no page passes it yet — an agenda view would, from
`scheduleFor`'s `checkedIn`/`myStars`) renders `attendance-status` in the meta line —
`Rated ★N`, `Checked in` (+ a `Rate it` link, `relative z-10` above the cover link, once
ended), or `Missed`; `null` renders nothing. The **feature** treatment is not a variant: `feature = session.isKeynote`
adds `sm:col-span-2`, a `GeneratedCover variant="orbit"` banner with seat count,
bigger title and a 3-line abstract. Both read `reservationFor`, `seatsFor`, `clock`
from `useConference()`; the seat toggle is `SeatButton` from `ui.jsx`. Both roots
carry `data-testid="session-card"` and `data-done`; done (dimmed, seat button
`ended`) is `hasEnded(session, clock)`, so a past day's cards are done too.

**`FilterBar.jsx`** exports `SearchInput`, `Select` (visually hidden label),
`TabStrip`, `ChipGroup`. Schedule uses the first two; `SpeakersPage` and `FoodPage`
also import from it.

**`SessionPage`** (`session-detail`) fetches `api.getSession(id, currentUserId)`.
An unknown id (the fetch's `error.status === 404`) renders `NotFoundState`
("Session not found", back to `/schedule`) instead of `ErrorState` — a 404 can
never succeed on retry; any other failure still shows `ErrorState` with "Try
again". Main column: header (`session-title`, `header-seats`, `save-session`
toggle, Add to calendar), `video-poster` if `isRecorded`,
abstract/takeaways/prerequisites, speakers (link to `/speakers/:id`),
"Attendee feedback", "Also at HH:MM"
(`competing` as row cards). Aside: `TravelNotice` (`travel-notice`, off-site only,
non-Walk routes from `travel.js:routesBetween`), `SeatPanel`, `AttendancePanel`,
room/amenities/step-free card, topic chips linking `/schedule?tag=`, `alsoInRoom`.

## Invariants

- Every `/sessions` value is a bound `?`; only `orderBy` is interpolated, from a fixed set.
- Seat counts on cards prefer `seatsFor(id)` (store) over the fetched payload.
- Tests find list cards as `article`; grid seat buttons by `Add <title> to my agenda`.

## Gotchas

- Mobile tests must click the `Filters` button before touching rail controls.
- Grid banner seat buttons share one generic `aria-label`; the cell buttons name the session.
- Seat buttons sit inside a `Link`; they `preventDefault` so a click toggles rather than navigates.
- `starred-count` is the agenda count despite its name — tests rely on the id.
- `competing`/`alsoInRoom` items lack `speakers`, so the row variant must not need them.
- **A filter that takes several values** keeps one URL key and one API param,
  comma-separated (`?track=a,b` → `trackSlug=a,b`; `qs()` passes the string
  through), and `sessions.js` splits it into `IN (?, ?)`. One value is then the
  same query as today, so existing links and `tests/api/endpoints.test.js` hold;
  `speakers.js` reads its own params. A toggle control exposes `aria-pressed`. A
  test of it adds a value *and* removes one, checking `result-count` against the
  API's counts each time — a list that only ever grows passes a test that never
  takes anything away.

## Where to change…

- New filter → `sessions.js` `where` clause, the `filters` object + `useFetch` in `SchedulePage`, and `BLOCKERS` if it scatters the grid.
- Grid layout → `ScheduleGrid` (`rooms`, `slots`, banner split).
- Card look or promotion → `SessionCard` (`feature`).
- Detail page payload → `sessions.js` `/:id`; its panels → `SessionPage`.
