import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, keysDeep } from './harness.js';

/**
 * Every endpoint, once, with every filter it accepts.
 *
 * The other files in here prove the *rules*. This one is breadth: it walks the
 * whole surface so a route that starts 500ing, drops a field, or leaks a
 * `snake_case` column cannot hide behind the routes a rule test happens to
 * touch. If you add an endpoint or a filter, add it here — the list at the
 * bottom of this file is meant to be read against `server/routes/`.
 */

let api;
let close;
let days;
let ids;

before(async () => {
  const started = await startApi();
  api = started.api;
  close = started.close;

  const boot = await api.json('/bootstrap');
  days = boot.days.map((d) => d.date);

  const sessions = await api.json('/sessions');
  const speakers = await api.json('/speakers');
  ids = {
    session: sessions[0].id,
    keynote: sessions.find((s) => s.isKeynote).id,
    speaker: speakers[0].id,
    user: boot.users[0].id,
    venue: boot.venues[0].id,
    room: boot.rooms[0].id,
    track: boot.tracks[0].slug,
    track2: boot.tracks[1].slug,
    topic: boot.tags.find((t) => t.kind === 'topic').slug,
    level: boot.levels[0].name,
    format: boot.formats[0].name,
    cuisine: boot.cuisines[0],
  };
});

after(async () => { await close(); });

/** Every GET that should answer 200 with JSON, and nothing snake_case in it. */
function readable() {
  return [
    '/bootstrap',
    '/venues',
    '/vendors',
    '/sponsors',
    '/announcements',
    `/live?day=${days[0]}&time=11:00`,
    '/sessions',
    '/speakers',
    '/users',
    `/sessions/${ids.session}`,
    `/sessions/${ids.keynote}`,
    `/speakers/${ids.speaker}`,
    `/users/${ids.user}`,
    `/users/${ids.user}/schedule`,
    `/users/${ids.user}/today?day=${days[0]}&time=11:00`,
    `/users/${ids.user}/attendance/${ids.session}`,
    `/users/${ids.user}/reservations/${ids.session}`,
  ];
}

/** Every filter and sort the two list endpoints accept. */
function filtered() {
  return [
    `/sessions?day=${days[1]}`,
    `/sessions?trackSlug=${ids.track}`,
    `/sessions?trackSlug=${ids.track},${ids.track2}`,
    `/sessions?tagSlug=${ids.topic}`,
    `/sessions?venueId=${ids.venue}`,
    `/sessions?roomId=${ids.room}`,
    `/sessions?level=${encodeURIComponent(ids.level)}`,
    `/sessions?format=${encodeURIComponent(ids.format)}`,
    `/sessions?speakerId=${ids.speaker}`,
    '/sessions?q=agent',
    `/sessions?reservedBy=${ids.user}`,
    `/sessions?followedBy=${ids.user}`,
    '/sessions?sort=rating',
    '/sessions?sort=popularity',
    `/sessions?day=${days[1]}&trackSlug=${ids.track}&sort=rating`,
    '/speakers?featured=true',
    '/speakers?firstTime=true',
    `/speakers?day=${days[0]}`,
    `/speakers?trackSlug=${ids.track}`,
    '/speakers?q=a',
    '/speakers?country=Japan',
    `/vendors?venueId=${ids.venue}`,
    `/vendors?cuisine=${encodeURIComponent(ids.cuisine)}`,
    '/vendors?dietary=vegan',
    '/vendors?q=coffee',
  ];
}

describe('Every endpoint answers', () => {
  test('each read returns 200 and JSON', async () => {
    for (const path of readable()) {
      const res = await api.get(path);
      assert.equal(res.status, 200, `GET ${path} → ${res.status}`);
      assert.ok(res.type.includes('json'), `GET ${path} is ${res.type}`);
    }
  });

  test('no read leaks a snake_case key, at any depth', async () => {
    for (const path of readable()) {
      const snake = [...keysDeep(await api.json(path))].filter((k) => /[a-z]_[a-z]/.test(k));
      assert.deepEqual(snake, [], `GET ${path} leaked ${snake.join(', ')}`);
    }
  });

  test('every filter and sort is accepted and narrows nothing into an error', async () => {
    const all = (await api.json('/sessions')).length;
    for (const path of filtered()) {
      const res = await api.get(path);
      assert.equal(res.status, 200, `GET ${path} → ${res.status}`);
      assert.ok(Array.isArray(res.body), `GET ${path} did not return a list`);
      assert.ok(res.body.length <= all, `GET ${path} returned more than the unfiltered list`);
    }
  });

  test('trackSlug takes several tracks: the union of each, and one slug is unchanged', async () => {
    const [a, b] = [ids.track, ids.track2];
    const idsOf = (list) => list.map((s) => s.id).sort();
    const onlyA = await api.json(`/sessions?trackSlug=${a}`);
    const onlyB = await api.json(`/sessions?trackSlug=${b}`);
    const both = await api.json(`/sessions?trackSlug=${a},${b}`);
    assert.ok(onlyA.length > 0 && onlyB.length > 0);
    assert.deepEqual(idsOf(both), idsOf([...onlyA, ...onlyB]));
    assert.ok(both.length > onlyA.length && both.length > onlyB.length);
    assert.ok(both.every((s) => [a, b].includes(s.track.slug)));
    // empty parts are ignored
    assert.deepEqual(idsOf(await api.json(`/sessions?trackSlug=${a},,${b},`)), idsOf(both));
    // a single slug equals filtering the full list
    const all = await api.json('/sessions');
    assert.deepEqual(idsOf(onlyA), idsOf(all.filter((s) => s.track.slug === a)));
  });

  test('the health check reports ok and the session count', async () => {
    const res = await api.get('/health');
    assert.equal(res.status, 200, `GET /health → ${res.status}`);
    assert.deepEqual(res.body, { ok: true, sessions: (await api.json('/sessions')).length });
  });

  test('the two calendar feeds are calendars, not JSON', async () => {
    for (const path of [`/sessions/${ids.session}.ics`, `/users/${ids.user}/agenda.ics`]) {
      const res = await api.get(path);
      assert.equal(res.status, 200, `GET ${path} → ${res.status}`);
      assert.ok(res.type.includes('text/calendar'), `GET ${path} is ${res.type}`);
      assert.ok(res.text.startsWith('BEGIN:VCALENDAR'), `GET ${path} is not a calendar`);
    }
  });

  test('an unknown id is a 404 with an error message, never a 500', async () => {
    const missing = [
      '/sessions/999999',
      '/speakers/999999',
      '/users/999999',
      '/users/999999/schedule',
      `/users/999999/today?day=${days[0]}&time=11:00`,
      `/users/${ids.user}/attendance/999999`,
      `/users/${ids.user}/reservations/999999`,
      '/sessions/999999.ics',
      '/users/999999/agenda.ics',
      '/nothing-here',
    ];
    for (const path of missing) {
      const res = await api.get(path);
      assert.equal(res.status, 404, `GET ${path} → ${res.status}`);
      assert.ok(res.body.error, `GET ${path} gave no error message`);
    }
  });

  test('a write to an unknown attendee is refused before it reaches the database', async () => {
    const writes = [
      () => api.put(`/users/999999/reservations/${ids.session}`, { day: days[0], time: '08:00' }),
      () => api.put(`/users/999999/checkins/${ids.session}`, { day: days[0], time: '08:00' }),
      () => api.put(`/users/999999/follows/${ids.speaker}`, {}),
      () => api.put(`/users/${ids.user}/follows/999999`, {}),
    ];
    for (const write of writes) {
      const res = await write();
      assert.equal(res.status, 404, `write → ${res.status}: ${res.text}`);
      assert.match(res.body.error, /not found/i);
    }
  });

  test('the whole surface is covered by this file', async () => {
    // Read the routers and assert every path we mount is exercised above, so
    // adding an endpoint without a test fails here rather than going unnoticed.
    const { readFileSync, readdirSync } = await import('node:fs');
    const mounted = readdirSync('server/routes')
      .flatMap((file) => [...readFileSync(`server/routes/${file}`, 'utf8')
        .matchAll(/Router\.(get|put|delete)\('([^']*)'/g)]
        .map((m) => `${m[1].toUpperCase()} ${file.replace('.js', '')}${m[2]}`));

    // Paths this file or its siblings drive. Keep in step with server/routes/.
    const covered = [
      'GET meta/bootstrap', 'GET meta/venues', 'GET meta/vendors', 'GET meta/sponsors',
      'GET meta/announcements', 'GET meta/live',
      'GET sessions/', 'GET sessions/:id', 'GET sessions/:id.ics',
      'GET speakers/', 'GET speakers/:id',
      'GET users/', 'GET users/:id', 'GET users/:id/today', 'GET users/:id/schedule',
      'GET users/:id/agenda.ics', 'GET users/:id/attendance/:sessionId',
      'GET users/:id/reservations/:sessionId',
      'PUT users/:id/reservations/:sessionId', 'PUT users/:id/checkins/:sessionId',
      'PUT users/:id/ratings/:sessionId', 'PUT users/:id/follows/:speakerId',
      'DELETE users/:id/reservations/:sessionId', 'DELETE users/:id/follows/:speakerId',
    ];

    const missing = mounted.filter((route) => !covered.includes(route));
    assert.deepEqual(missing, [], `untested endpoints: ${missing.join(', ')}`);
  });
});
