import { toMinutes } from './clock.js';

const minutesOf = (s) => toMinutes(s.endsAt) - toMinutes(s.startsAt);

/**
 * The fetched schedule, re-filtered through the store. The store — not the
 * payload — is the truth about what I hold, so a removed session leaves at
 * once; totals are recomputed so hours stay chairs held (confirmed only) with
 * the queue totalled apart, and a day with nothing left drops out.
 * `reservationFor(id)` is `'confirmed' | 'waitlisted' | null`.
 */
export function agendaDays(days, reservationFor) {
  return (days ?? []).flatMap((d) => {
    const sessions = d.sessions
      .map((s) => ({ ...s, reservation: reservationFor(s.id) }))
      .filter((s) => s.reservation)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
    if (!sessions.length) return [];
    const sum = (status) => sessions.filter((s) => s.reservation === status).reduce((n, s) => n + minutesOf(s), 0);
    return [{ ...d, sessions, totalMinutes: sum('confirmed'), waitlistedMinutes: sum('waitlisted') }];
  });
}

/** 135 → "2h 15m", 120 → "2h", 45 → "45m". */
export function hoursLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h && !m) return '0h';
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ');
}
