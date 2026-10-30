import { expect } from '@playwright/test';

/**
 * Shared helpers for verification tests.
 *
 * The app has no auth: whichever attendee is selected in the header is the
 * active user, and that choice lives in localStorage under `orbit:currentUserId`.
 */

/**
 * The API the suite talks to. PORT lets a second checkout run its own server
 * (with its own ORBIT_DB) without the two suites writing to each other's data.
 */
export const API = `http://localhost:${process.env.PORT ?? 3001}/api`;

export const ATTENDEES = {
  jonas: 1,      // VIP, big plan, has cross-town clashes
  andy: 2,      // Speaker — presenting 3 sessions
  kenji: 3,      // Standard, small plan
  sofia: 4,      // VIP, biggest plan
  marcus: 5,     // Standard, smallest plan
  abraham: 6,      // Speaker — presenting 2 sessions
};

/**
 * Day 1 is whatever date the database was seeded on, so tests must ask rather
 * than hard-code. Cached per worker.
 */
let cachedDays = null;
export async function conferenceDays() {
  if (!cachedDays) {
    const res = await fetch(`${API}/bootstrap`);
    cachedDays = (await res.json()).days.map((d) => d.date);
  }
  return cachedDays;
}

/** `await momentOn(0, '10:30')` → a clock value inside day 1's 10:15 slot. */
export async function momentOn(dayIndex, time) {
  const days = await conferenceDays();
  return `${days[dayIndex]}T${time}`;
}

export const MID_SESSION_TIME = '10:30';   // inside the 10:15 slot

/** Open a route as a given attendee, optionally with the clock pinned. */
export async function visit(page, path = '/', { as = ATTENDEES.jonas, at = null } = {}) {
  await page.addInitScript(({ id, clockAt }) => {
    window.localStorage.setItem('orbit:currentUserId', String(id));
    if (clockAt) window.localStorage.setItem('orbit:clockAt', clockAt);
    else window.localStorage.removeItem('orbit:clockAt');
  }, { id: as, clockAt: at });
  await page.goto(path);
  await expect(page.getByRole('banner')).toBeVisible();
}

/** Fail the test if the page logged a console error or threw. */
export function failOnPageErrors(page, errors = []) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Wait for a list to finish loading (skeletons gone, count rendered). */
export async function waitForResults(page, testId = 'result-count') {
  await expect(page.getByTestId(testId)).not.toHaveText(/Loading/, { timeout: 10_000 });
}

/**
 * Clear an attendee's seats for one day.
 *
 * Seat state is real and persists across runs, so a test that books something
 * will hit the overlap guard on its next run unless it tidies up. Call this
 * before any test that adds a session.
 */
export async function clearAgendaFor(request, userId, day) {
  const res = await request.get(`${API}/users/${userId}/schedule`);
  const plan = await res.json();
  const onDay = (plan.days ?? []).find((d) => d.date === day);
  for (const session of onDay?.sessions ?? []) {
    await request.delete(`${API}/users/${userId}/reservations/${session.id}`);
  }
}

/**
 * Who may book what, in one place.
 *
 * Every spec file runs in parallel, every test inside a file runs in parallel
 * (`fullyParallel`), and the desktop and mobile projects run at the same time.
 * So each test that writes seat state gets its own lane: an attendee on a day
 * that no other concurrently running test books for that attendee. The overlap
 * guard is per attendee, so that is what keeps one test's booking from turning
 * another's click into a conflict dialog.
 *
 * Lanes with a `slot` and an exact seat-count assertion own that whole slot on
 * day 3 — nothing else may book the six slots `seats.count`/`seats.reload`/
 * `seats.twice` use there. A lane that only needs a clean day (no count
 * assertion) may take day 3's one remaining slot instead, same as any other day.
 *
 * Read-only fixture to leave alone: Jonas and Kenji on day 2 (the promotion
 * fixture).
 * Lanes marked `clean` are days the seed leaves empty for that attendee, so the
 * test may clear the whole day; everywhere else, release only what you booked.
 */
const { jonas, andy, kenji, sofia, marcus, abraham } = ATTENDEES;
export const LANES = {
  'seats.count':      { desktop: { user: jonas, day: 2, slot: '09:00' },  mobile: { user: andy, day: 2, slot: '11:30' } },
  'seats.reload':     { desktop: { user: sofia, day: 2, slot: '13:30' },  mobile: { user: abraham, day: 2, slot: '10:15' } },
  'seats.twice':      { desktop: { user: jonas, day: 2, slot: '14:45' },  mobile: { user: andy, day: 2, slot: '16:00' } },
  // Fails a reserve and a release on purpose. Each pane shares its attendee and day 0 only
  // with lanes that pin other slots, and the seed leaves that slot free for that attendee.
  'seats.failure-toast': { desktop: { user: marcus, day: 0, slot: '10:15' }, mobile: { user: abraham, day: 0, slot: '13:30' } },
  'seats.waitlist':   { desktop: { user: kenji, day: 0 },                 mobile: { user: sofia, day: 3 } },
  // Slots pinned only so 'attendance.rating-toast' below can share this
  // attendee and day (a real seat lane, so it never sets its own slot
  // otherwise) — this test's own pick is dynamic and ignores them.
  'seats.queue':      { desktop: { user: marcus, day: 0, slot: '13:30' }, mobile: { user: abraham, day: 0, slot: '10:15' } },
  'conflict.ui':      { desktop: { user: kenji, day: 3, clean: true },    mobile: { user: andy, day: 3, clean: true } },
  'conflict.api':     { desktop: { user: abraham, day: 3 },                 mobile: { user: jonas, day: 3 } },
  'schedule.grid':    { desktop: { user: sofia, day: 1 },                 mobile: { user: marcus, day: 1 } },
  // read-only: it books nothing, and needs a day the seed sells sessions out on
  'schedule.seats':   { desktop: { user: kenji, day: 1, readOnly: true }, mobile: { user: marcus, day: 0, readOnly: true } },
  'session.add':      { desktop: { user: sofia, day: 0 },                 mobile: { user: andy, day: 0 } },
  // marcus/day 3 desktop and jonas/day 0 mobile are each used by no other lane,
  // so concurrent tests cannot collide on these attendee+day pairs.
  'switcher.live-count': { desktop: { user: marcus, day: 3 }, mobile: { user: jonas, day: 0, clean: true } },
  // Check-ins and ratings only — no seat is booked, so agenda: false lets these
  // share a day with booking lanes (see lanes.test.js). The slot is the one
  // unattendedFor() picks its session from.
  'attendance.checkin-toast': { desktop: { user: kenji, day: 2, slot: '09:00', agenda: false },  mobile: { user: andy, day: 2, slot: '09:00', agenda: false } },
  // Rates for real, so it must land on day index 0 — `today` — per
  // smoke.spec.js's "no session in the future carries a rating".
  'attendance.rating-toast':  { desktop: { user: marcus, day: 0, slot: '09:00', agenda: false }, mobile: { user: abraham, day: 0, slot: '09:00', agenda: false } },
  // My Agenda: one confirmed seat in `agenda.page`'s slot, one waitlist place in the late
  // one, checked into and rated for real (so day 0, and a fresh seed per run). Both
  // attendees hold nothing in these slots in the seed and no other pane pins them.
  'agenda.page':      { desktop: { user: marcus, day: 0, slot: '16:00' },  mobile: { user: abraham, day: 0, slot: '11:30' } },
  // Books two sessions in consecutive slots (one pair across venues, one within), whichever
  // the seed leaves free; no other lane uses these attendees on day 1.
  'agenda.travel':    { desktop: { user: andy, day: 1 },                   mobile: { user: jonas, day: 1 } },
  'agenda.page-late': { desktop: { user: marcus, day: 0, slot: '17:15' },  mobile: { user: abraham, day: 0, slot: '17:15' } },
};

/**
 * The picture a pull request shows, taken by the test that proves the change —
 * it already drives the app to exactly the state worth seeing. A no-op unless
 * PR_SHOTS is set, so the suite and the gate never write files; ship's PR step
 * re-runs the one test with PR_SHOTS=1 and uploads what lands in
 * `.screenshots/pr/`. On #64 the PR agent spent 20 turns rebuilding that state
 * with a script of its own.
 */
export async function shotForPR(page, name) {
  if (!process.env.PR_SHOTS) return;
  // A file name with spaces breaks the PR's markdown image link (#94).
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.screenshot({ path: `.screenshots/pr/${slug}-${page.viewportSize()?.width ?? 0}w.png` });
}

/** `await laneFor('seats.count', testInfo)` → `{ user, day: '2026-…', slot }`. */
export async function laneFor(name, testInfo) {
  const lane = LANES[name][testInfo.project.name];
  const days = await conferenceDays();
  return { ...lane, day: days[lane.day] };
}

/**
 * Sessions on `day` this attendee can book without touching their seeded plan
 * or meeting the overlap guard: they hold nothing — seat or waitlist place — on
 * the session or anywhere in its slot. Sorted by start time, keynotes and
 * socials left out. Release what you book and the next run picks the same one.
 */
export async function bookableFor(request, userId, day) {
  const me = await (await request.get(`${API}/users/${userId}`)).json();
  const all = await (await request.get(`${API}/sessions`)).json();
  const byId = new Map(all.map((s) => [s.id, s]));
  const mine = me.reservations.map((r) => byId.get(r.sessionId)).filter(Boolean);
  const overlaps = (a, b) => a.day === b.day && a.startsAt < b.endsAt && b.startsAt < a.endsAt;

  return all
    .filter((s) => s.day === day && !s.isKeynote && s.format !== 'Social')
    .filter((s) => !mine.some((m) => overlaps(m, s)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id - b.id);
}
