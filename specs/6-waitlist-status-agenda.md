# Show waitlist status on My Agenda, and when a waitlist place becomes a seat

## What this changes
Every row on My Agenda says **Seated** or **Waitlisted**. A session that was a waitlist place the last time this attendee looked at My Agenda and is a confirmed seat now carries a **You got a seat** highlight on that visit. On the next visit it is an ordinary Seated row. Booked hours already count confirmed seats only, so the promoted session joins them with no new total code. Nothing outside My Agenda changes; `seats.js` is untouched.

## Where
- `src/lib/agendaDays.js` — add a pure `promotedSince(seen, sessions)`: ids that were `'waitlisted'` in `seen` (a `{ [sessionId]: status }` map or null) and are `'confirmed'` in `sessions`; plus `statusMap(days)` to build the next snapshot. Test in `tests/unit/agenda-days.test.js` (node:test, same `s()`/`store()` helpers).
- `src/pages/MyAgendaPage.jsx` — read the snapshot from `localStorage` key `orbit:agendaSeen:<currentUserId>` once the schedule has loaded (not before: the store's `reservations` start empty), compute the promoted ids into state, then write the current statuses back. `AgendaSession` takes a `promoted` prop and renders the status chip (`data-testid="agenda-status"`, text Seated or Waitlisted) and, when promoted, `data-testid="agenda-promoted"` reading "You got a seat". The existing Waitlisted label in `SessionCard.jsx` stays; the chip sits in `AgendaSession`, not the shared card.
- Browser test in `tests/agenda.spec.js` using `laneFor('agenda.page', testInfo)`, `bookableFor`, `visit(page, '/my-agenda', { as: user, at })`. Setup: take a full session (`isFull`) as waitlisted via `PUT /users/:id/reservations/:sid`, visit My Agenda (snapshot written), then free a seat by releasing one confirmed seat of that session through the API as another attendee, reload, assert. Release what is booked in `finally`.

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Every item shows Seated or Waitlisted, matching the reservation | `agenda-status` text per row equals the API's status for a confirmed and a waitlisted session | spec |
| After promotion, next visit highlights "You got a seat" | `promotedSince({1:'waitlisted'}, [{id:1,reservation:'confirmed'}])` returns `[1]`; spec asserts `agenda-promoted` after a reload following the release | unit + spec |
| The highlight appears once | `promotedSince` with the refreshed snapshot returns `[]`; spec reloads again and asserts `agenda-promoted` count 0 and status Seated | unit + spec |
| Booked hours include the promoted session | spec reads `agenda-booked-hours` before and after promotion; it grows by the session's duration | spec |

## Decisions
- Remember "last viewed" in the browser (`localStorage`, per attendee) rather than in a new database column — OK? It keeps seats.js and the schema untouched, but a different browser or cleared storage shows no highlight.
- A first-ever visit (no snapshot) highlights nothing, since there is no earlier state to compare — OK?
- The highlight stays for the whole visit (until leaving the page and coming back), rather than fading after a few seconds — OK?
- A seat you take yourself from the schedule is never "You got a seat"; only waitlisted-then-confirmed counts — OK?

## Out of scope
Push, email or app-wide notices; Home; any change to promotion in `server/lib/seats.js`.
