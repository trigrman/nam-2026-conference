# Filter the schedule by several tracks at once

## What this changes
On `/schedule` the track pills become toggles: each one switches on and off on
its own, several can be on at once, and each says so with `aria-pressed`. The
list shows the sessions of every selected track and no others. "All" clears the
selection; turning off the last active pill also returns to All. The selection
is one URL key, `?track=a,b`, so it survives a reload, and reaches the API as
`trackSlug=a,b`. A single slug behaves exactly as today. Any selection still
forces the list view (track stays a grid blocker).

## Where
- `server/routes/sessions.js` — `GET /` line `if (trackSlug) …`: split on `,`,
  drop empty parts, and push `t.slug IN (?, ?, …)` with one arg per slug. One
  slug gives `IN (?)`, the same rows as `t.slug = ?`.
- `src/pages/SchedulePage.jsx` — derive `selectedTracks` from `filters.track`
  (`ALL` → `[]`, else `split(',')`); a `toggleTrack(slug)` that adds/removes
  the slug and calls `set('track', next.join(',') || ALL)`; the All pill keeps
  `set('track', ALL)`. In the pill map, `active = selectedTracks.includes(t.slug)`,
  `onClick={() => toggleTrack(t.slug)}`, and `aria-pressed={active}` on every
  track pill and on All (`aria-pressed={selectedTracks.length === 0}`).
  `useFetch` already passes `trackSlug: filters.track` through `qs()` unchanged;
  `BLOCKERS`, `activeKeys`, `clearAll` and `clearBlocker` need no change.
- `tests/api/endpoints.test.js` — add `/sessions?trackSlug=a,b` (first two
  bootstrap tracks) to `filtered()`, and a new test in `Every endpoint answers`
  using the existing `api` harness: the two-track result equals the union of
  each single-track result (same ids, every `track.slug` in the pair), and a
  single slug equals the list filtered client-side from `/sessions`.
- `tests/schedule.spec.js` — one new test, read-only (books nothing, so no data
  lane), using `visit`, `waitForResults`, `conferenceDays` and `API` from
  `tests/helpers.js`; opens `Filters` when visible (mobile), as the
  "switching day" test does; picks two tracks with sessions on the pinned day by
  asking the API.

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Selecting two tracks shows the sessions of both and no others | API: `trackSlug=a,b` ids equal union of `trackSlug=a` and `trackSlug=b` and is larger than either (main returns `[]` for the literal slug `a,b`). Spec: after clicking both pills, every `article` card belongs to one of the two tracks and the count equals the API's | API + spec |
| `result-count` matches the API after adding and after removing a track | Spec: click A → count = API(`a`); click B → count = API(`a,b`); click A off → count = API(`b`) | spec |
| Deselecting the last pill returns to All; All clears every track | Spec: from `a,b` click All → URL has no `track=`, All `aria-pressed=true`; select B then click B off → no `track=` and All pressed | spec |
| Each track pill reports `aria-pressed` | Spec: selected pills `aria-pressed="true"`, others `"false"` (main has no attribute) | spec |
| Selection survives a reload via `?track=a,b` | Spec: URL matches `track=a(%2C\|,)b`; `page.reload()`, both pills still pressed and count unchanged | spec |
| `?track=<one slug>` returns the same sessions as before | API: single-slug result equals `/sessions` filtered by `track.slug`; existing `trackSlug=` entries in `filtered()` stay green | API |
| Works on mobile after opening Filters | The new spec runs in both Playwright projects and clicks `Filters` when visible | spec (mobile) |
| An API test covers `trackSlug=a,b`, a spec covers add and remove | The two tests above | API + spec |

## Decisions
- `?track=<one slug>` already returns the right sessions on main; this build
  proves it is unchanged by comparing it to a client-side filter of the full
  list, rather than to main's output.
- The All pill also gets `aria-pressed` (true when nothing is selected), so the
  whole group reads as toggles.
- Empty parts (`?track=a,,b`) are ignored and an unknown slug simply matches
  nothing; no 400 is returned.
- `/api/speakers?trackSlug` stays single-valued; only `/sessions` learns the
  comma list.

## Out of scope
- Multi-select for venue, level, format or topic.
