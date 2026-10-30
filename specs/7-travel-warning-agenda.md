# Warn on My Agenda when back-to-back sessions are at venues too far apart

## What this changes
On My Agenda, between two consecutive seated sessions on the same day at different venues, a warning
(`agenda-travel-warning`) says the trip takes N minutes and there are only M minutes between them. Same venue,
or a gap that fits a trip, shows nothing. The warning is derived from the store-filtered days, so removing
either session removes it at once.

## Where
- `src/lib/agendaDays.js` — new pure `travelWarnings(sessions, travel)`: over a day's confirmed sessions in time order,
  for each adjacent pair call `assessTravel({ travel, from, to, gapMinutes: toMinutes(to.startsAt) - toMinutes(from.endsAt) })`;
  keep it when the result is non-null and `impossible`; return `{ [fromSessionId]: assessment }`. Unit test in
  `tests/unit/agenda-days.test.js` (travel fixture shape as in `tests/unit/travel.test.js`).
- `src/pages/MyAgendaPage.jsx` — read `travel` from `useConference()`; per day compute `travelWarnings(d.sessions.filter(confirmed), travel)`;
  after the `AgendaSession` for a flagged `from`, render a small amber notice `data-testid="agenda-travel-warning"` reading
  e.g. "Aurora to Foundry takes 18 min, you have 15". Wrap each row and its notice in a fragment inside the `<ul>` (notice as an `<li>`).
- `tests/agenda.spec.js` — Playwright, new lane `agenda.travel` in `tests/helpers.js` `LANES` (a free attendee and day per project,
  see `tests/api/lanes.test.js`): book via API two sessions in consecutive slots at different venues (find with `bookableFor`),
  visit `/my-agenda` pinned with `at`, expect the warning with both numbers; release the second via the Remove button and expect count 0
  with no reload; a same-venue consecutive pair shows none.
- `docs/context/agenda.md` and `docs/context/venues.md` — say My Agenda now calls `assessTravel` (venues.md currently says "No UI calls it yet").

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Different venues, too little time: warning with travel time and gap | `travelWarnings` returns an entry carrying the trip minutes and gap for a 15 min gap across venues; spec row text contains both numbers | unit + spec |
| Same venue, or enough time: no warning | `travelWarnings` empty for same-venue pair and for a 60 min gap across venues | unit |
| Removing one of the pair removes the warning without a refresh | spec clicks `agenda-remove` and expects `agenda-travel-warning` count 0 | spec |

## Decisions
- Warn only when no mode fits the gap (`impossible`), and quote the fastest mode's total including the walk to the room, rather than also warning when only the free shuttle is too slow — OK?
- Consider confirmed seats only, so a waitlisted place between or beside a pair never raises or hides a warning (a waitlist place may never come good) — OK?
- Show the warning directly after the earlier session of the pair, even when a waitlisted row sits between them in the list — OK?

## Out of scope
Home, suggestions, rerouting, and any API or `assessTravel` change.
