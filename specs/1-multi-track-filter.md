# Filter the schedule by several tracks at once

## What this changes
On `/schedule` the track pills become toggles. Several can be on at once and the list shows sessions in any of them; no pill on means all tracks, and **All** clears the selection. The selection is `?track=a,b` in the URL, so it survives a reload, and any track filter still forces list view. Each pill carries `aria-pressed`.

## Where
- `server/routes/sessions.js` — the `trackSlug` line in `GET /`: split the string on commas and push `t.slug IN (?, ?)`; one value gives the same query as today. Test in `tests/api/endpoints.test.js` is left unchanged; the new API check goes in a new `tests/api/tracks-filter.test.js` using `tests/api/harness.js`.
- `src/pages/SchedulePage.jsx` — `filters.track` stays the raw comma string (so `qs()`, `BLOCKERS`, `activeKeys` and `clearBlocker` keep working); the track pills (around the `Track` heading) toggle a slug in or out of that list via `set('track', …)`, drop the key when empty, and add `aria-pressed`. The **All** pill is pressed when nothing is selected.
- `tests/schedule.spec.js` — a new spec using `visit`, `waitForResults`, `API` from `tests/helpers.js`; it needs no seats, so no data lane. It picks two tracks from `/bootstrap` that have sessions on one day, clicks both pills, then un-clicks one, comparing `result-count` to `/sessions?day=…&trackSlug=a,b` each time. It opens the Filters rail first on mobile.

## How it will be proved
| Done when | Check | Layer |
| --- | --- | --- |
| Two tracks list both and no others; count matches API for `trackSlug=a,b` | API returns only sessions of tracks a and b with both present; spec compares `result-count` | API + spec |
| Turning one off narrows to the remaining track, count matches API | spec toggles one pill off and re-checks | spec |
| **All** clears every selected track | spec clicks All; URL has no `track`, count equals the unfiltered API count | spec |
| Single-track link behaves as today; endpoints test passes | `tests/api/endpoints.test.js` unchanged and green; API test that one slug equals the old result | API |
| Each pill exposes `aria-pressed` | spec asserts `aria-pressed` true/false on pills | spec |
| Selection survives a reload | spec reloads and asserts the same pills pressed and count | spec |

## Decisions
- Clicking a pill while nothing is selected selects just that track, rather than "all but that one" — OK?
- Unknown slugs in `?track=` simply match nothing, as today — OK?
