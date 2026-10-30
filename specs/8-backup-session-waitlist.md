# Suggest a backup session for a waitlisted slot on My Agenda

## What this changes
On My Agenda, a waitlisted row now shows up to three "Backup" sessions that start in the
same slot and still have free seats, each with an Add button. Add takes a seat (a clash
with a confirmed seat opens the existing `ConflictDialog`), and the new session appears
on the agenda. Seated rows show no backups; a full session is never offered.

## Where
- `server/lib/agenda.js` — `suggestionsFor` takes an optional set of session ids to leave
  out and is reused (taste ranking, `openInSlot`, top `SUGGESTION_COUNT`). `scheduleFor`
  adds `backups` to each waitlisted session: `suggestionsFor(userId, s.day, s.startsAt, held)`
  where `held` is every session the attendee already has a seat or place in; other
  sessions get no `backups`. Test in `tests/api/agenda.test.js` using `startApi`/`clearAgenda`.
- `src/pages/MyAgendaPage.jsx` — `AgendaSession` renders `agenda-backups` under a waitlisted
  row: each `agenda-backup` shows title, time, room and seats left, plus an Add button
  (`agenda-backup-add`) calling the store's `reserveSeat`; a taken or ended backup is hidden
  (filter on `reservationFor` and `hasEnded`). After a successful add the page calls the
  fetch's `reload()` so the new row appears. Conflicts reuse the store's dialog.
- `src/lib/agendaDays.js` — nothing changes; `backups` rides along on the session.
- `tests/agenda.spec.js` — browser walk using a new lane `agenda.backup` in `tests/helpers.js`
  (desktop jonas day 1, mobile andy day 1; check `lanes.test.js` for collisions), `bookableFor`,
  a full session as the waitlist place and a pinned clock before the slot.
- `docs/context/agenda.md` — My Agenda and Suggestion ranking sections.

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Waitlisted item shows up to 3 same-slot alternatives with free seats | `scheduleFor` backups for a waitlisted session: length <= 3, all same day and `startsAt`, `seatsLeft > 0` | API (`tests/api/agenda.test.js`) |
| A full session is never suggested | same test: no backup `isFull`, none equals a held session | API |
| A seated item shows no alternatives | same test: a confirmed session has no `backups` | API |
| Adding one takes a seat and it appears on My Agenda | page shows `agenda-backup` under the queued row; click Add; new `agenda-session` is `Seated` | Browser (`tests/agenda.spec.js`) |
| Seated item shows none | seated row has no `agenda-backups` in the page | Browser |

## Decisions
- Leave a backup out of the list once the attendee holds it in any status, so a second
  waitlist place is never offered as a "backup" — OK?
- Show no backups on a waitlisted row whose session has already ended — OK?
- Put `backups` on the existing `/schedule` payload rather than a new endpoint — OK?

## Out of scope
Notifying when a waitlist place clears, and backups on Home or `/today`.
