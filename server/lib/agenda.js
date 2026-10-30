import { db } from '../db.js';
import { SESSION_SELECT, hydrateSessions, toMinutes } from './query.js';

/**
 * What an attendee's conference looks like to them.
 *
 * Two shapes, both derived rather than stored:
 *  - `today` — where they are in the day right now, and what to do about the
 *    gaps. Suggestions rank on what they have actually booked, because that is
 *    a truer signal than the interests they ticked at registration.
 *  - `schedule` — every seat and waitlist place, grouped by day, with the
 *    clashes and totals an agenda page needs.
 *
 * No page renders either yet: My Agenda is a placeholder that workshop teams
 * build on these.
 * The clock comes from the client, because conference time is simulated.
 */

const myReservations = db.prepare('SELECT session_id, status FROM reservations WHERE user_id = ?');
const myCheckIns = db.prepare('SELECT session_id FROM check_ins WHERE user_id = ?');
const myRatings = db.prepare('SELECT session_id, stars FROM ratings WHERE user_id = ?');

const reservedOnDay = db.prepare(`${SESSION_SELECT}
  JOIN reservations r ON r.session_id = s.id AND r.user_id = ?
  WHERE s.day = ? ORDER BY s.starts_at`);

const reservedEver = db.prepare(`${SESSION_SELECT}
  JOIN reservations r ON r.session_id = s.id AND r.user_id = ?
  ORDER BY s.day, s.starts_at`);

/** The topics they keep choosing, most-booked first. */
const myTopics = db.prepare(`
  SELECT tg.slug, COUNT(*) n FROM reservations r
  JOIN session_tags st ON st.session_id = r.session_id
  JOIN tags tg ON tg.id = st.tag_id AND tg.kind = 'topic'
  WHERE r.user_id = ? GROUP BY tg.slug ORDER BY n DESC LIMIT 8`);

const slotsOnDay = db.prepare('SELECT DISTINCT starts_at FROM sessions WHERE day = ? ORDER BY starts_at');

/** Fillable sessions in one slot: not a keynote, not a social, seats left. */
const openInSlot = db.prepare(`${SESSION_SELECT}
  WHERE s.day = ? AND s.starts_at = ? AND s.is_keynote = 0 AND s.format != 'Social'
    AND s.seats_taken < s.capacity`);

const SUGGESTION_COUNT = 3;

export function todayFor(userId, { day, time = '00:00' }) {
  const now = toMinutes(time);

  const status = new Map(myReservations.all(userId).map((r) => [r.session_id, r.status]));
  const checkedIn = new Set(myCheckIns.all(userId).map((c) => c.session_id));
  const rated = new Set(myRatings.all(userId).map((r) => r.session_id));

  const decorate = (s) => ({
    ...s,
    reservation: status.get(s.id) ?? null,
    checkedIn: checkedIn.has(s.id),
    rated: rated.has(s.id),
  });

  const mine = hydrateSessions(reservedOnDay.all(userId, day));
  const booked = mine.filter((s) => status.get(s.id) === 'confirmed').map(decorate);
  const finished = booked.filter((s) => now >= toMinutes(s.endsAt));

  // The first slot still ahead of them with nothing booked in it.
  const taken = new Set(booked.map((s) => s.startsAt));
  const openSlot = slotsOnDay.all(day)
    .map((r) => r.starts_at)
    .find((t) => toMinutes(t) > now && !taken.has(t)) ?? null;

  return {
    day,
    time,
    current: booked.find((s) => now >= toMinutes(s.startsAt) && now < toMinutes(s.endsAt)) ?? null,
    next: booked.find((s) => toMinutes(s.startsAt) > now) ?? null,
    finished,
    // things needing a decision
    unrated: finished.filter((s) => s.checkedIn && !s.rated),
    waitlisted: mine.filter((s) => status.get(s.id) === 'waitlisted').map(decorate),
    openSlot,
    suggestions: openSlot ? suggestionsFor(userId, day, openSlot) : [],
  };
}

/** Ranked by how much a session looks like the things they already chose. */
function suggestionsFor(userId, day, slot, exclude = new Set()) {
  const taste = new Set(myTopics.all(userId).map((t) => t.slug));

  return hydrateSessions(openInSlot.all(day, slot))
    .filter((s) => !exclude.has(s.id))
    .map((s) => ({ ...s, affinity: s.tags.filter((t) => t.kind === 'topic' && taste.has(t.slug)).length }))
    .sort((a, b) => b.affinity - a.affinity || b.avgRating - a.avgRating)
    .slice(0, SUGGESTION_COUNT);
}

export function scheduleFor(userId) {
  const status = new Map(myReservations.all(userId).map((r) => [r.session_id, r.status]));
  // Attendance on every day, not just today, so an agenda can ask about a
  // Day 1 talk that is still unrated on Day 3.
  const checkedIn = new Set(myCheckIns.all(userId).map((r) => r.session_id));
  const stars = new Map(myRatings.all(userId).map((r) => [r.session_id, r.stars]));
  const sessions = hydrateSessions(reservedEver.all(userId))
    .map((s) => ({
      ...s,
      reservation: status.get(s.id) ?? null,
      checkedIn: checkedIn.has(s.id),
      myStars: stars.get(s.id) ?? null,
    }))
    // A queued place may never come good: offer open sessions in its slot, never one already held.
    .map((s) => (s.reservation === 'waitlisted'
      ? { ...s, backups: suggestionsFor(userId, s.day, s.startsAt, new Set(status.keys())) }
      : s));

  const byDay = new Map();
  for (const s of sessions) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day).push(s);
  }

  return [...byDay.entries()].map(([date, items]) => ({
    date,
    sessions: items,
    conflicts: clashesIn(items),
    totalMinutes: minutesHeld(items, 'confirmed'),
    waitlistedMinutes: minutesHeld(items, 'waitlisted'),
    venuesVisited: [...new Set(items.map((s) => s.venue.shortName))],
  }));
}

/**
 * Hours are hours you hold a chair for, so the two statuses are totalled
 * apart. A waitlist place may never come good, and counting it as booked time
 * told an attendee they had a fuller day than the room could give them.
 */
const minutesHeld = (items, status) => items
  .filter((s) => s.reservation === status)
  .reduce((n, s) => n + s.durationMins, 0);

/**
 * Every overlapping pair on one day. The seat rules block two *confirmed*
 * seats in one slot, so what surfaces here is a waitlist place that overlaps
 * something they hold — still worth telling them about.
 */
function clashesIn(items) {
  const clashes = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (toMinutes(a.startsAt) < toMinutes(b.endsAt) && toMinutes(b.startsAt) < toMinutes(a.endsAt)) {
        clashes.push({ type: 'overlap', sessionIds: [a.id, b.id] });
      }
    }
  }
  return clashes;
}
