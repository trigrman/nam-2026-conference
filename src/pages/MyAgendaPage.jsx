import { useEffect, useRef, useState } from 'react';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useConference, useFetch } from '../lib/store.jsx';
import * as api from '../lib/api.js';
import { hasEnded, toMinutes } from '../lib/clock.js';
import { dayLabel } from '../lib/format.js';
import { agendaDays, hoursLabel, promotedSince, statusMap } from '../lib/agendaDays.js';
import { Button, SectionHeader, Stat } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { SessionCard } from '../components/SessionCard.jsx';
import { AttendancePanel } from '../components/AttendancePanel.jsx';

/** One session on the agenda: the row, who is speaking, Remove, and — once the doors open — check-in and rating. */
function AgendaSession({ session, promoted, onAdded }) {
  const { clock, releaseSeat, reserveSeat, reservationFor } = useConference();
  const confirmed = session.reservation === 'confirmed';
  // Same test as the row's own status line: nothing before check-in opens, 15 minutes ahead.
  const open = clock.day > session.day ||
    (clock.day === session.day && toMinutes(clock.time) >= toMinutes(session.startsAt) - 15);
  const speakers = session.speakers ?? [];
  // Backups for a queued place: not once it is over, and never one I now hold in any status.
  const backups = confirmed || hasEnded(session, clock)
    ? []
    : (session.backups ?? []).filter((b) => !reservationFor(b.id) && !hasEnded(b, clock));
  const addBackup = async (b) => {
    const state = await reserveSeat(b.id);
    if (state?.status) onAdded();
  };

  return (
    <li className="space-y-2" data-testid="agenda-session">
      <SessionCard
        session={session}
        variant="row"
        attendance={confirmed ? {
          ended: clock.day > session.day || (clock.day === session.day && toMinutes(clock.time) >= toMinutes(session.endsAt)),
          checkedIn: session.checkedIn,
          myStars: session.myStars,
        } : null}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-muted">
        <span>
          <span data-testid="agenda-status" className={confirmed ? 'font-medium text-emerald-300' : 'font-medium text-amber-300'}>
            {confirmed ? 'Seated' : 'Waitlisted'}
          </span>
          {promoted && (
            <span data-testid="agenda-promoted" className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">
              You got a seat
            </span>
          )}
          {' · '}
          {session.venue.name}
          {speakers.length > 0 && <> · {speakers.map((s) => s.name).join(', ')}</>}
        </span>
        <Button size="sm" onClick={() => releaseSeat(session.id, session)} data-testid="agenda-remove"
          aria-label={`Remove ${session.title}`}>
          Remove
        </Button>
      </div>
      {backups.length > 0 && (
        <div className="space-y-2 rounded-xl border border-hairline bg-surface px-3 py-2" data-testid="agenda-backups">
          <p className="text-[12px] font-medium text-muted">Backup sessions in this slot</p>
          <ul className="space-y-2">
            {backups.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]" data-testid="agenda-backup">
                <span>
                  <span className="font-medium">{b.title}</span>
                  <span className="text-muted"> · {b.startsAt} · {b.room.name} · {b.seatsLeft} seats left</span>
                </span>
                <Button size="sm" onClick={() => addBackup(b)} data-testid="agenda-backup-add"
                  aria-label={`Add ${b.title}`}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmed && open && <AttendancePanel session={session} />}
    </li>
  );
}

export function MyAgendaPage() {
  useDocumentTitle('My Agenda');
  const { currentUserId, reservationFor } = useConference();
  const { data, loading, error, reload } = useFetch(() => api.getSchedule(currentUserId), [currentUserId]);
  const days = agendaDays(data?.days, reservationFor);

  // What I last saw, remembered per attendee in this browser: a place that was
  // queued then and is a seat now is flagged for this visit, and the snapshot is
  // refreshed so the next visit shows an ordinary row. Once per load, and only
  // after the store knows my reservations (they start empty).
  const [promoted, setPromoted] = useState([]);
  const handled = useRef(null);
  useEffect(() => {
    if (!data || !days.length || handled.current === data) return;
    handled.current = data;
    const key = `orbit:agendaSeen:${currentUserId}`;
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(key)); } catch { /* unreadable: treat as a first visit */ }
    setPromoted(promotedSince(seen, days.flatMap((d) => d.sessions)));
    try { localStorage.setItem(key, JSON.stringify(statusMap(days))); } catch { /* storage full or blocked */ }
  });

  return (
    <div className="space-y-8">
      <SectionHeader eyebrow="Your conference" title="My Agenda" />

      {error && <p className="text-sm text-rose-300">Could not load your agenda: {error.message}</p>}
      {!data && loading && <p className="text-sm text-muted">Loading your agenda…</p>}

      {data && days.length === 0 && (
        <section className="grid place-items-center rounded-2xl border border-dashed border-hairline bg-surface px-6 py-16 text-center"
          data-testid="agenda-empty">
          <span className="grid size-12 place-items-center rounded-xl bg-violet-500/12 text-violet-300">
            <Icon name="ticket" className="size-5" />
          </span>
          <h3 className="mt-4 font-display text-2xl">Nothing on your agenda yet</h3>
          <p className="mt-2 max-w-sm text-sm text-muted">Add a session and it takes you a seat.</p>
          <Button to="/schedule" size="sm" className="mt-6">Browse the schedule</Button>
        </section>
      )}

      {days.map((d) => (
        <section key={d.date} className="space-y-3" data-testid="agenda-day">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="font-display text-xl">{dayLabel(d.date)}</h3>
            <div className="flex gap-3">
              <Stat value={hoursLabel(d.totalMinutes)} label="Booked" accent="emerald" testId="agenda-booked-hours" />
              {d.waitlistedMinutes > 0 && (
                <Stat value={hoursLabel(d.waitlistedMinutes)} label="Waitlisted" accent="amber" testId="agenda-waitlisted-hours" />
              )}
            </div>
          </div>
          <ul className="space-y-3">
            {d.sessions.map((s) => <AgendaSession key={s.id} session={s} promoted={promoted.includes(s.id)} onAdded={reload} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
