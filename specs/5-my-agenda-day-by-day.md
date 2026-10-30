# My Agenda shows my conference, day by day

## What this changes
`/my-agenda` stops being a "coming soon" panel. It lists the current attendee's confirmed seats and waitlist places grouped by day, in time order, each row showing time, venue, room and speakers. Each row links to the session, has a Remove button (gives up the seat or waitlist place), and shows check-in / rating when the existing rules allow. Each day shows booked hours (confirmed only) with waitlisted time apart. An attendee with nothing booked sees an empty state linking to `/schedule`.

## Where
- `src/pages/MyAgendaPage.jsx` — fetch `api.getSchedule(currentUserId)` keyed on `[currentUserId]` (`useFetch`); re-filter every day through `reservationFor(s.id)` from `useConference()`, recompute `totalMinutes`, `waitlistedMinutes` (and drop empty days) client-side per `docs/context/agenda.md` "Building on it". Rows reuse `SessionCard variant="row"` with the `attendance` prop for confirmed seats; speakers listed under each row (`session.speakers`, check the `toSession`/`hydrateSessions` shape). Hours shown with `Stat` (`note` for `+Nh waitlisted`). Remove calls `releaseSeat` from the store. Empty state keeps a `Button to="/schedule"`. New test ids: `agenda-day`, `agenda-session`, `agenda-booked-hours`, `agenda-waitlisted-hours`, `agenda-empty`, `agenda-remove`.
- `src/components/AttendancePanel.jsx` — reused unchanged inside a confirmed, check-in-open-or-past row, so it enforces the existing gating (`canCheckIn`, `canRate`); it is mounted only when the session's check-in window has opened (same `open` test as `SessionCard`'s `AttendanceStatus`), so nothing shows early.
- `tests/agenda.spec.js` (new) — Playwright, clock pinned with `visit(..., { at: await momentOn(0, '13:00') })`; seats booked through the API and released after; a new lane `agenda.page` added to `LANES` in `tests/helpers.js` (check `tests/unit/lanes.test.js` for the rules) using `laneFor`, `clearAgendaFor`, `visit`.
- `tests/home.spec.js` — replace "My Agenda is a blank canvas" with the nav / `/my-plan` redirect assertions minus the coming-soon text.
- `docs/context/agenda.md` — update the placeholder description, files and "Where to change".

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Grouped by day, time order, with time, venue, room, speakers | book two sessions on one lane day in reverse order via API; page shows `agenda-day` with rows ordered by time, each containing time, room, venue name and speaker names | spec |
| Removing takes it off immediately and frees the seat | click `agenda-remove`; row disappears with no reload, and `GET /sessions/:id` seatsTaken drops by one | spec |
| Check-in and rating only when rules allow, both work | clock pinned before check-in opens: no `check-in` button; pinned in-window: `check-in` appears and works; after end (checked-in session): `rating-form` submits | spec |
| Hours confirmed only, waitlisted apart | a lane with one confirmed and one waitlisted session: `agenda-booked-hours` counts the confirmed one, `agenda-waitlisted-hours` the queued one | spec |
| Switching attendee shows their agenda | choose another attendee in the switcher; rows change to that attendee's | spec |
| Empty state links to the schedule | attendee with a clean day/no bookings sees `agenda-empty` with a link to `/schedule` | spec |

## Decisions
- Show check-in / rating by mounting the existing `AttendancePanel` in the row (so the rules stay in one place), and show nothing before check-in opens rather than its "opens 15 minutes before" note — OK?
- Waitlisted rows get Remove but never check-in or rating — OK?
- Empty state applies to the whole agenda (no booked sessions on any day), not per day — OK?

## Out of scope
Followed speakers, personal activities, preference-built agendas; changes to `seats.js`, `attendance.js` or the API.
