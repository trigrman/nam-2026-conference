import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { attendedSession, clearAgenda, overlaps, startApi } from './harness.js';

/**
 * The agenda payload — `GET /api/users/:id/schedule`.
 *
 * Hours mean hours you hold a chair for, so a day's totals are split: a
 * confirmed seat counts towards `totalMinutes`, a waitlist place towards
 * `waitlistedMinutes`. My Agenda renders both from this shape, so proving the
 * split here is what stops the page and the API telling different stories.
 */

let api;
let close;

before(async () => { ({ api, close } = await startApi()); });
after(() => close());

describe('A day on the schedule', () => {
  test('counts confirmed minutes and waitlisted minutes apart', async () => {
    const user = 5;
    await clearAgenda(api, user);

    const sessions = await api.json('/sessions');
    const seat = sessions.find((s) => !s.isFull && s.seatsLeft > 2 && !s.isKeynote);
    assert.ok(seat, 'the seed should leave a session with seats to spare');
    // Not overlapping the seat: the clash guard runs before the room is found
    // full, so an overlapping sold-out session would be refused, not queued.
    const queue = sessions.find((s) => s.isFull && s.day === seat.day && !overlaps(s, seat));
    assert.ok(queue, 'the seed should sell out a session on that same day');

    const taken = await api.put(`/users/${user}/reservations/${seat.id}`, {});
    assert.equal(taken.body.status, 'confirmed');
    const queued = await api.put(`/users/${user}/reservations/${queue.id}`, {});
    assert.equal(queued.body.status, 'waitlisted');

    const { days } = await api.json(`/users/${user}/schedule`);
    const day = days.find((d) => d.date === seat.day);

    assert.equal(day.totalMinutes, seat.durationMins);
    assert.equal(day.waitlistedMinutes, queue.durationMins);

    // both still listed, each with the status it is held under
    const held = new Map(day.sessions.map((s) => [s.id, s.reservation]));
    assert.equal(held.get(seat.id), 'confirmed');
    assert.equal(held.get(queue.id), 'waitlisted');
  });
});

describe('Backups for a waitlisted place', () => {
  test('a queued session lists up to three open sessions in its slot; a seated one lists none', async () => {
    const user = 6;
    await clearAgenda(api, user);

    const sessions = await api.json('/sessions');
    const queue = sessions.find((s) => s.isFull && !s.isKeynote && s.format !== 'Social');
    assert.ok(queue, 'the seed should sell out a session');
    const seat = sessions.find((s) => !s.isFull && s.seatsLeft > 2 && !s.isKeynote && s.format !== 'Social' && !overlaps(s, queue));
    assert.ok(seat, 'the seed should leave an open session clear of the queued one');

    assert.equal((await api.put(`/users/${user}/reservations/${seat.id}`, {})).body.status, 'confirmed');
    assert.equal((await api.put(`/users/${user}/reservations/${queue.id}`, {})).body.status, 'waitlisted');

    const { days } = await api.json(`/users/${user}/schedule`);
    const held = new Map(days.flatMap((d) => d.sessions).map((s) => [s.id, s]));

    const backups = held.get(queue.id).backups;
    assert.ok(Array.isArray(backups) && backups.length > 0, 'a waitlisted place should get backups');
    assert.ok(backups.length <= 3);
    for (const b of backups) {
      assert.equal(b.day, queue.day);
      assert.equal(b.startsAt, queue.startsAt);
      assert.ok(b.seatsLeft > 0 && !b.isFull, 'a full session is never suggested');
      assert.ok(!held.has(b.id), 'nothing already held is offered');
    }

    assert.equal(held.get(seat.id).backups, undefined, 'a seated session carries no backups');

    // adding one takes a seat in it
    const added = await api.put(`/users/${user}/reservations/${backups[0].id}`, {});
    assert.equal(added.body.status, 'confirmed');
  });
});

describe('Attendance on the schedule', () => {
  /*
   * My Agenda marks every session that is over as rated, checked in or
   * missed, on every day — so the agenda payload has to say, per session,
   * whether this attendee checked in and what they gave it.
   */
  test('carries checkedIn and myStars for each session held', async () => {
    const { userId, session, stars } = await attendedSession(api);
    const { days } = await api.json(`/users/${userId}/schedule`);
    const all = days.flatMap((d) => d.sessions);

    const attended = all.find((s) => s.id === session.id);
    assert.ok(attended, 'the attended session should be on their agenda');
    assert.equal(attended.checkedIn, true);
    assert.equal(attended.myStars, stars);

    // The seed only checks people in on Day 1 morning, so a later day is untouched.
    const future = all.find((s) => s.day > session.day);
    assert.ok(future, 'the seed should give them a session on a later day');
    assert.equal(future.checkedIn, false);
    assert.equal(future.myStars, null);
  });
});
