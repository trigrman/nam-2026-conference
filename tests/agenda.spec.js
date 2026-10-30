import { test, expect } from '@playwright/test';
import { API, visit, conferenceDays, laneFor, bookableFor, ATTENDEES, shotForPR } from './helpers.js';

/** "2h 15m" / "45m" / "2h" → minutes. */
const minutesOf = (text) => {
  const h = /(\d+)h/.exec(text);
  const m = /(\d+)m/.exec(text);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
};

test.describe('My Agenda', () => {
  test('lists my conference day by day, and lets me check in, rate and remove from it', async ({ page, request }, testInfo) => {
    const { user, day, slot } = await laneFor('agenda.page', testInfo);
    const late = await laneFor('agenda.page-late', testInfo);
    const me = await (await request.get(`${API}/users/${user}`)).json();
    const been = new Set(me.checkIns ?? []);

    // A: an open talk in the lane's slot to sit in. B: a full one in its late slot, so I am only queued.
    const a = (await bookableFor(request, user, day)).find((s) => s.startsAt === slot && s.seatsLeft > 3 && !been.has(s.id));
    const b = (await bookableFor(request, user, late.day)).find((s) => s.startsAt === late.slot && s.isFull);
    expect(a, `no open session at ${slot}`).toBeTruthy();
    expect(b, `no full session at ${late.slot}`).toBeTruthy();

    const put = (s) => request.put(`${API}/users/${user}/reservations/${s.id}`);
    try {
      // Booked latest first: the page must still read in time order.
      expect((await (await put(b)).json()).status).toBe('waitlisted');
      expect((await (await put(a)).json()).status).toBe('confirmed');

      await visit(page, '/my-agenda', { as: user, at: `${day}T07:00` });
      const row = (s) => page.getByTestId('agenda-session').filter({ hasText: s.title });
      await expect(row(a)).toBeVisible();

      // day by day, in time order, with where and who
      const titles = await page.getByTestId('agenda-session').locator('h3').allTextContents();
      expect(titles.indexOf(a.title)).toBeGreaterThanOrEqual(0);
      expect(titles.indexOf(a.title)).toBeLessThan(titles.indexOf(b.title));
      await expect(page.getByTestId('agenda-day').first()).toBeVisible();
      await expect(row(a)).toContainText(a.startsAt);
      await expect(row(a)).toContainText(a.room.name);
      await expect(row(a)).toContainText(a.venue.name);
      for (const sp of a.speakers) await expect(row(a)).toContainText(sp.name);

      // booked hours are chairs held; the queue is totalled apart
      const aDuration = (Number(a.endsAt.slice(0, 2)) * 60 + Number(a.endsAt.slice(3))) - (Number(a.startsAt.slice(0, 2)) * 60 + Number(a.startsAt.slice(3)));
      const bDuration = (Number(b.endsAt.slice(0, 2)) * 60 + Number(b.endsAt.slice(3))) - (Number(b.startsAt.slice(0, 2)) * 60 + Number(b.startsAt.slice(3)));
      const dayBlock = page.getByTestId('agenda-day').filter({ has: row(a) });
      await expect(dayBlock.getByTestId('agenda-waitlisted-hours')).toContainText(/\d/);
      const waitlisted = minutesOf(await dayBlock.getByTestId('agenda-waitlisted-hours').textContent());
      const booked = minutesOf(await dayBlock.getByTestId('agenda-booked-hours').textContent());
      expect(waitlisted).toBeGreaterThanOrEqual(bDuration);
      expect(booked).toBeGreaterThanOrEqual(aDuration);

      // every row says Seated or Waitlisted, matching the reservation
      await expect(row(a).getByTestId('agenda-status')).toHaveText('Seated');
      await expect(row(b).getByTestId('agenda-status')).toHaveText('Waitlisted');
      await expect(page.getByTestId('agenda-promoted')).toHaveCount(0);

      // a place that was queued when I last looked and is a seat now is flagged once.
      // (Another attendee's release is what promotes in life; here the remembered
      // state is set to what it would have been, so no shared session is disturbed.)
      const seenKey = `orbit:agendaSeen:${user}`;
      await page.evaluate(([k, id]) => localStorage.setItem(k, JSON.stringify({ [id]: 'waitlisted' })), [seenKey, a.id]);
      await page.reload();
      await expect(row(a).getByTestId('agenda-promoted')).toHaveText('You got a seat');
      await expect(row(a).getByTestId('agenda-status')).toHaveText('Seated');
      await expect(page.getByTestId('agenda-promoted')).toHaveCount(1);
      await shotForPR(page, 'you got a seat on my agenda');
      await page.reload();
      await expect(row(a).getByTestId('agenda-status')).toHaveText('Seated');
      await expect(page.getByTestId('agenda-promoted')).toHaveCount(0);

      // before the doors open: no check-in, and waitlist places never get one
      await expect(row(a).getByTestId('check-in')).toHaveCount(0);
      await expect(row(b).getByTestId('attendance-panel')).toHaveCount(0);

      // in the window: check in from this page
      await visit(page, '/my-agenda', { as: user, at: `${day}T${a.startsAt}` });
      await row(a).getByTestId('check-in').click();
      await expect(row(a).getByTestId('checked-in')).toBeVisible();

      // once over: rate from this page; the queue place still has neither
      await visit(page, '/my-agenda', { as: user, at: `${day}T23:59` });
      await row(a).getByRole('radio', { name: '4 stars', exact: true }).click();
      await row(a).getByTestId('submit-rating').click();
      await expect(page.getByTestId('toaster')).toContainText('Rating saved');
      await expect(row(b).getByTestId('attendance-panel')).toHaveCount(0);
      await shotForPR(page, 'my agenda by day');

      // a phone has no sideways scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      // removing frees the seat and takes the row off without a reload
      const before = (await (await request.get(`${API}/sessions/${a.id}`)).json()).seatsTaken;
      await row(a).getByTestId('agenda-remove').click();
      await expect(row(a)).toHaveCount(0);
      expect((await (await request.get(`${API}/sessions/${a.id}`)).json()).seatsTaken).toBe(before - 1);

      // another attendee's agenda, from the switcher
      const jonas = await (await request.get(`${API}/users/${ATTENDEES.jonas}/schedule`)).json();
      const days = await conferenceDays();
      const theirs = jonas.days.find((d) => d.date === days[2]).sessions[0];
      await page.getByRole('button', { name: /Switch attendee/ }).click();
      await page.getByRole('option', { name: /Jonas Claesson/ }).click();
      await expect(page.getByTestId('agenda-session').filter({ hasText: theirs.title })).toBeVisible();
      await expect(row(b)).toHaveCount(0);

      // nothing booked: say so, and point at the schedule
      await page.route(`**/api/users/${ATTENDEES.andy}/schedule`, (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: ATTENDEES.andy }, days: [] }),
      }));
      await page.getByRole('button', { name: /Switch attendee/ }).click();
      await page.getByRole('option', { name: /Andy Vays/ }).click();
      await expect(page.getByTestId('agenda-empty')).toBeVisible();
      await expect(page.getByTestId('agenda-empty').getByRole('link')).toHaveAttribute('href', '/schedule');
      await expect(page.getByTestId('agenda-session')).toHaveCount(0);
    } finally {
      await request.delete(`${API}/users/${user}/reservations/${a.id}`);
      await request.delete(`${API}/users/${user}/reservations/${b.id}`);
    }
  });

  test('warns between back-to-back sessions at venues too far apart, and only then', async ({ page, request }, testInfo) => {
    const { user, day } = await laneFor('agenda.travel', testInfo);
    const open = (await bookableFor(request, user, day)).filter((s) => s.seatsLeft > 0 && !s.isFull);
    const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    // consecutive slots: the next session starting after `s` ends, 30 minutes on
    const next = (s, pred) => open.find((t) => t.startsAt > s.endsAt && mins(t.startsAt) - mins(s.endsAt) <= 30 && pred(t));
    const far = open.map((a) => [a, next(a, (t) => t.venue.id !== a.venue.id && t.room.walkMinutes >= 13)]).find(([, b]) => b);
    expect(far, 'no cross-venue pair in consecutive slots').toBeTruthy();
    const [a, b] = far;
    const c = next(a, (t) => t.venue.id === a.venue.id && t.id !== b.id && t.startsAt === b.startsAt);
    expect(c, 'no same-venue session in the same later slot').toBeTruthy();

    const put = (s) => request.put(`${API}/users/${user}/reservations/${s.id}`);
    try {
      expect((await (await put(a)).json()).status).toBe('confirmed');
      expect((await (await put(b)).json()).status).toBe('confirmed');

      // a moment before anything has started: the warning is about the plan, not the clock
      await visit(page, '/my-agenda', { as: user, at: `${day}T07:00` });
      // the seeded plan may carry its own warnings: look only at the one directly under `a`
      const warning = page.getByTestId('agenda-session').filter({ hasText: a.title })
        .locator('xpath=following-sibling::*[1][@data-testid="agenda-travel-warning"]');
      const gap = mins(b.startsAt) - mins(a.endsAt);
      await expect(warning).toHaveCount(1);
      await expect(warning).toContainText(`${a.venue.name} to ${b.venue.name} takes`);
      await expect(warning).toContainText(`you have ${gap}`);
      expect(Number(/takes (\d+) min/.exec(await warning.textContent())[1])).toBeGreaterThan(gap);
      await shotForPR(page, 'travel warning between two far-apart sessions');

      // removing one of the pair takes the warning with it, no reload
      await page.getByTestId('agenda-session').filter({ hasText: b.title }).getByTestId('agenda-remove').click();
      await expect(page.getByTestId('agenda-session').filter({ hasText: b.title })).toHaveCount(0);
      await expect(warning).toHaveCount(0);

      // the same gap at the first session's own venue: nothing to warn about
      expect((await (await put(c)).json()).status).toBe('confirmed');
      await page.reload();
      await expect(page.getByTestId('agenda-session').filter({ hasText: c.title })).toBeVisible();
      await expect(warning).toHaveCount(0);
    } finally {
      for (const s of [a, b, c]) await request.delete(`${API}/users/${user}/reservations/${s.id}`);
    }
  });
});
