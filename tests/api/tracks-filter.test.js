import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './harness.js';

/** `trackSlug` takes one slug or several, comma-separated. */

let api;
let close;
let day;
let slugs;

before(async () => {
  const started = await startApi();
  api = started.api;
  close = started.close;
  const boot = await api.json('/bootstrap');
  day = boot.days[0].date;
  slugs = boot.tracks.map((t) => t.slug);
});
after(async () => { await close(); });

const trackSet = (list) => new Set(list.map((s) => s.track.slug));

describe('GET /sessions?trackSlug=a,b', () => {
  test('two tracks list both and no others', async () => {
    const [a, b] = slugs;
    const list = await api.json(`/sessions?day=${day}&trackSlug=${a},${b}`);
    assert.deepEqual([...trackSet(list)].sort(), [a, b].sort());
    const countA = (await api.json(`/sessions?day=${day}&trackSlug=${a}`)).length;
    const countB = (await api.json(`/sessions?day=${day}&trackSlug=${b}`)).length;
    assert.equal(list.length, countA + countB);
  });

  test('one slug returns what it always did', async () => {
    const [a] = slugs;
    const list = await api.json(`/sessions?day=${day}&trackSlug=${a}`);
    assert.ok(list.length > 0);
    assert.deepEqual([...trackSet(list)], [a]);
  });

  test('an unknown slug among known ones matches nothing extra', async () => {
    const [a] = slugs;
    const one = await api.json(`/sessions?day=${day}&trackSlug=${a}`);
    const mixed = await api.json(`/sessions?day=${day}&trackSlug=${a},nope`);
    assert.equal(mixed.length, one.length);
    assert.deepEqual(await api.json(`/sessions?day=${day}&trackSlug=nope`), []);
  });
});
