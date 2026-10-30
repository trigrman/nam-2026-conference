import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { agendaDays, hoursLabel, promotedSince, statusMap, travelWarnings } from '../../src/lib/agendaDays.js';

const s = (id, startsAt, endsAt) => ({ id, startsAt, endsAt });
const payload = [
  { date: '2026-10-01', sessions: [s(1, '09:00', '10:00'), s(2, '10:15', '11:00'), s(3, '11:30', '12:30')], totalMinutes: 999, waitlistedMinutes: 999 },
  { date: '2026-10-02', sessions: [s(4, '09:00', '09:45')] },
];
const store = (entries) => (id) => entries[id] ?? null;

describe('agendaDays', () => {
  test('totals count confirmed seats only; queued time is totalled apart', () => {
    const [day] = agendaDays(payload, store({ 1: 'confirmed', 2: 'waitlisted', 3: 'confirmed' }));
    assert.equal(day.totalMinutes, 60 + 60);
    assert.equal(day.waitlistedMinutes, 45);
  });

  test('the store wins over the fetched payload: a removed session leaves, an emptied day goes', () => {
    const days = agendaDays(payload, store({ 1: 'confirmed' }));
    assert.deepEqual(days.map((d) => d.date), ['2026-10-01']);
    assert.deepEqual(days[0].sessions.map((x) => x.id), [1]);
  });

  test('sessions come out in time order whatever order they came in', () => {
    const shuffled = [{ date: 'd', sessions: [s(3, '11:30', '12:30'), s(1, '09:00', '10:00')] }];
    const [day] = agendaDays(shuffled, store({ 1: 'confirmed', 3: 'waitlisted' }));
    assert.deepEqual(day.sessions.map((x) => x.id), [1, 3]);
    assert.equal(day.sessions[1].reservation, 'waitlisted');
  });

  test('nothing held means no days at all', () => {
    assert.deepEqual(agendaDays(payload, store({})), []);
    assert.deepEqual(agendaDays(undefined, store({})), []);
  });
});

describe('hoursLabel', () => {
  test('hours and minutes, dropping a zero part', () => {
    assert.equal(hoursLabel(0), '0h');
    assert.equal(hoursLabel(45), '45m');
    assert.equal(hoursLabel(120), '2h');
    assert.equal(hoursLabel(135), '2h 15m');
  });
});

describe('promotedSince', () => {
  const now = [{ id: 1, reservation: 'confirmed' }, { id: 2, reservation: 'waitlisted' }, { id: 3, reservation: 'confirmed' }];

  test('a waitlist place that is now a seat is promoted', () => {
    assert.deepEqual(promotedSince({ 1: 'waitlisted' }, now), [1]);
  });

  test('still queued, already seated, or taken by me since: not promoted', () => {
    assert.deepEqual(promotedSince({ 1: 'confirmed', 2: 'waitlisted' }, now), []);
  });

  test('a first visit has nothing to compare, so nothing is promoted', () => {
    assert.deepEqual(promotedSince(null, now), []);
    assert.deepEqual(promotedSince(undefined, undefined), []);
  });

  test('once the snapshot is refreshed the highlight is gone', () => {
    const seen = { 1: 'waitlisted' };
    assert.deepEqual(promotedSince(seen, now), [1]);
    const days = agendaDays([{ date: 'd', sessions: [s(1, '09:00', '10:00'), s(2, '10:15', '11:00')] }], store({ 1: 'confirmed', 2: 'waitlisted' }));
    const next = statusMap(days);
    assert.deepEqual(next, { 1: 'confirmed', 2: 'waitlisted' });
    assert.deepEqual(promotedSince(next, now), []);
  });
});

describe('travelWarnings', () => {
  const travel = [
    { fromVenueId: 1, toVenueId: 2, mode: 'Shuttle', minutes: 25, costUsd: 0 },
    { fromVenueId: 1, toVenueId: 2, mode: 'Rideshare', minutes: 16, costUsd: 18 },
  ];
  const at = (id, startsAt, endsAt, venueId, walkMinutes = 2) =>
    ({ id, startsAt, endsAt, venue: { id: venueId, name: `V${venueId}` }, room: { walkMinutes } });

  test('a short gap across venues warns on the earlier session, with the trip and the gap', () => {
    const out = travelWarnings([at(1, '09:00', '10:00', 1), at(2, '10:15', '11:00', 2)], travel);
    assert.deepEqual(Object.keys(out), ['1']);
    assert.equal(out[1].fastest.total, 18);
    assert.equal(out[1].gapMinutes, 15);
  });

  test('the same venue, or enough time to get there, warns about nothing', () => {
    assert.deepEqual(travelWarnings([at(1, '09:00', '10:00', 1), at(2, '10:15', '11:00', 1)], travel), {});
    assert.deepEqual(travelWarnings([at(1, '09:00', '10:00', 1), at(2, '11:00', '12:00', 2)], travel), {});
  });

  test('only the fastest mode matters: a gap the rideshare fits is not a warning', () => {
    assert.deepEqual(travelWarnings([at(1, '09:00', '10:00', 1), at(2, '10:20', '11:00', 2)], travel), {});
  });

  test('pairs are taken in time order, and a lone session has no pair', () => {
    const out = travelWarnings([at(2, '10:15', '11:00', 2), at(1, '09:00', '10:00', 1)], travel);
    assert.deepEqual(Object.keys(out), ['1']);
    assert.deepEqual(travelWarnings([at(1, '09:00', '10:00', 1)], travel), {});
  });
});
