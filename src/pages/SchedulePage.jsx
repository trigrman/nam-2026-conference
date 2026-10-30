import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConference, useFetch } from '../lib/store.jsx';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import * as api from '../lib/api.js';
import { accent } from '../lib/accents.js';
import { agendaSummary, dayLabel, plural, shortDay } from '../lib/format.js';
import { SessionCard } from '../components/SessionCard.jsx';
import { ScheduleGrid } from '../components/ScheduleGrid.jsx';
import { SearchInput, Select } from '../components/FilterBar.jsx';
import { Button, EmptyState, ErrorState, SectionHeader, Skeleton, cx } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';

const ALL = 'all';
const VIEWS = [
  { value: 'grid', label: 'Grid', icon: 'grid' },
  { value: 'list', label: 'List', icon: 'layers' },
];

export function SchedulePage() {
  const { days, tracks, venues, formats, levels, tags, reservations, clock } = useConference();
  useDocumentTitle('Schedule');
  const [params, setParams] = useSearchParams();
  const [railOpen, setRailOpen] = useState(false);

  const filters = {
    day: params.get('day') ?? (days.some((d) => d.date === clock.day) ? clock.day : days[0]?.date),
    track: params.get('track') ?? ALL,
    venue: params.get('venue') ?? ALL,
    level: params.get('level') ?? ALL,
    format: params.get('format') ?? ALL,
    tag: params.get('tag') ?? ALL,
    q: params.get('q') ?? '',
  };
  // A horizontally scrolling matrix is a poor default on a phone, so the grid
  // is only the default where there is room for it. An explicit ?view= wins.
  const wide = useMediaQuery('(min-width: 1024px)');
  const requestedView = params.get('view') ?? (wide ? 'grid' : 'list');

  const selectedTracks = filters.track === ALL ? [] : filters.track.split(',').filter(Boolean);
  const toggleTrack = (slug) => {
    const next = selectedTracks.includes(slug) ? selectedTracks.filter((s) => s !== slug) : [...selectedTracks, slug];
    set('track', next.join(',') || ALL);
  };

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const { data, loading, error, reload } = useFetch(
    () => api.getSessions({
      day: filters.day,
      trackSlug: filters.track,
      venueId: filters.venue,
      level: filters.level,
      format: filters.format,
      tagSlug: filters.tag,
      q: filters.q,
    }),
    [filters.day, filters.track, filters.venue, filters.level, filters.format, filters.tag, filters.q],
  );

  const sessions = data ?? [];
  const activeKeys = ['track', 'venue', 'level', 'format', 'tag', 'q'].filter((k) => filters[k] && filters[k] !== ALL);
  // Keep a view the user chose, never the list a filter forced.
  const clearAll = () => {
    const next = new URLSearchParams({ day: filters.day });
    if (params.get('view')) next.set('view', params.get('view'));
    setParams(next);
  };

  /*
   * The grid is a whole-day view: rooms across, time down. A venue filter just
   * drops columns, which is fine. Any *content* filter leaves scattered cells
   * in a mostly empty matrix, so the grid is genuinely unavailable — and the
   * toggle must say so rather than staying lit while the list renders.
   */
  const BLOCKERS = [
    ['q', 'a search'],
    ['track', 'a track filter'],
    ['tag', 'a topic filter'],
    ['level', 'a level filter'],
    ['format', 'a format filter'],
  ];
  const blocker = BLOCKERS.find(([key]) => filters[key] && filters[key] !== ALL);
  const clearBlocker = () => {
    const next = new URLSearchParams(params);
    BLOCKERS.forEach(([key]) => next.delete(key));
    next.set('view', 'grid');
    setParams(next, { replace: true });
  };

  const view = blocker ? 'list' : requestedView;
  const showGrid = view === 'grid';

  const slots = useMemo(() => {
    const map = new Map();
    for (const s of sessions) {
      if (!map.has(s.startsAt)) map.set(s.startsAt, []);
      map.get(s.startsAt).push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sessions]);

  const topicTags = tags.filter((t) => t.kind === 'topic');
  const bookedToday = sessions.filter((s) => reservations.has(s.id)).length;
  const dayPhrase = filters.day === clock.day
    ? 'today'
    : `on ${days.find((d) => d.date === filters.day)?.label ?? filters.day}`;

  const rail = (
    <div className="space-y-3 lg:space-y-5">
      <SearchInput
        value={filters.q}
        onChange={(v) => set('q', v)}
        placeholder="Search sessions…"
        data-testid="search-input"
      />

      <div className="hidden rounded-xl border border-hairline bg-raised p-3 lg:block">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">My agenda</span>
          <Link to="/my-agenda" className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200">
            Open →
          </Link>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-2xl leading-none" data-testid="starred-count">{reservations.size}</span>
          <span className="text-[11px] text-muted">{agendaSummary(reservations.size, bookedToday, dayPhrase)}</span>
        </div>
      </div>

      <div>
        <h3 className="sr-only text-[11px] font-semibold uppercase tracking-wider text-faint lg:not-sr-only lg:mb-2 lg:block">Day</h3>
        <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-1">
          {days.map((d) => {
            const active = d.date === filters.day;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => set('day', d.date)}
                data-testid={`tab-${d.date}`}
                aria-pressed={active}
                className={cx(
                  'flex items-baseline justify-center rounded-lg border px-1 py-1.5 text-center transition-colors lg:justify-between lg:px-3 lg:py-2 lg:text-left',
                  active ? 'border-violet-400/50 bg-violet-500/15 text-ink'
                    : 'border-hairline bg-raised text-muted hover:bg-overlay hover:text-ink',
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  {d.label}<span className="hidden lg:inline"> · {shortDay(d.date)}</span>
                  {d.date === clock.day && (
                    <span className="size-1.5 animate-pulse-dot rounded-full bg-rose-400" title="Today" />
                  )}
                </span>
                <span className="hidden font-mono text-[10px] text-faint lg:inline">{d.sessionCount}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="sr-only text-[11px] font-semibold uppercase tracking-wider text-faint lg:not-sr-only lg:mb-2 lg:block">Track</h3>
        <div className="hide-scrollbar flex flex-nowrap gap-1.5 overflow-x-auto lg:flex-wrap">
          <button type="button" onClick={() => set('track', ALL)} aria-pressed={selectedTracks.length === 0}
            className={cx('shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              selectedTracks.length === 0 ? 'border-white/25 bg-overlay text-ink' : 'border-hairline text-muted hover:text-ink')}>
            All
          </button>
          {tracks.map((t) => {
            const a = accent(t.color);
            const active = selectedTracks.includes(t.slug);
            return (
              <button key={t.id} type="button" onClick={() => toggleTrack(t.slug)} aria-pressed={active}
                className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  active ? a.chip : 'border-hairline text-muted hover:text-ink')}>
                <span className={cx('size-1.5 rounded-full', a.dot)} />
                {t.shortName ?? t.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        <Select label="Venue" value={filters.venue} onChange={(v) => set('venue', v)}
          options={[{ value: ALL, label: 'Both venues' }, ...venues.map((v) => ({ value: String(v.id), label: v.shortName }))]} />
        <Select label="Level" value={filters.level} onChange={(v) => set('level', v)}
          options={[{ value: ALL, label: 'Any level' }, ...levels.map((l) => ({ value: l.name, label: l.name }))]} />
        <Select label="Format" value={filters.format} onChange={(v) => set('format', v)}
          options={[{ value: ALL, label: 'Any format' }, ...formats.map((f) => ({ value: f.name, label: f.name }))]} />
        <Select label="Topic" value={filters.tag} onChange={(v) => set('tag', v)}
          options={[{ value: ALL, label: 'Any topic' }, ...topicTags.map((t) => ({ value: t.slug, label: t.name }))]} />
      </div>

      {activeKeys.length > 0 && (
        <Button size="sm" variant="ghost" onClick={clearAll} className="w-full">
          <Icon name="close" className="size-3.5" />
          Clear {plural(activeKeys.length, 'filter')}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Programme"
        title="The schedule"
        description={<span className="hidden sm:inline">{`${days.reduce((n, d) => n + d.sessionCount, 0)} sessions over ${plural(days.length, 'day')}. Adding one takes a seat and lands it in your agenda.`}</span>}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-hairline bg-raised p-0.5" role="tablist" aria-label="Schedule view">
              {VIEWS.map((v) => {
                const disabled = v.value === 'grid' && Boolean(blocker);
                return (
                  <button
                    key={v.value}
                    type="button"
                    role="tab"
                    aria-selected={view === v.value}
                    aria-disabled={disabled}
                    disabled={disabled}
                    title={disabled ? `Grid shows a whole day — not available with ${blocker[1]}` : undefined}
                    onClick={() => set('view', v.value)}
                    data-testid={`view-${v.value}`}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                      view === v.value && !disabled ? 'bg-overlay text-ink' : 'text-muted hover:text-ink',
                      disabled && 'cursor-not-allowed opacity-40 hover:text-muted',
                    )}
                  >
                    <Icon name={v.icon} className="size-3.5" />
                    {v.label}
                  </button>
                );
              })}
            </div>
            <Button size="sm" className="lg:hidden" onClick={() => setRailOpen((o) => !o)}>
              <Icon name="filter" className="size-3.5" />
              Filters{activeKeys.length ? ` (${activeKeys.length})` : ''}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className={cx('lg:sticky lg:top-24 lg:block lg:self-start', railOpen ? 'block' : 'hidden')}
          aria-label="Schedule filters">
          <div className="card p-3 lg:p-4">{rail}</div>
        </aside>

        <div className="min-w-0 space-y-5">
          {/* The day being shown is the most important fact on this screen. */}
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-display text-2xl leading-none sm:text-3xl">
                {dayLabel(filters.day)}
              </h2>
              {filters.day === clock.day && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                  <span className="size-1.5 animate-pulse-dot rounded-full bg-rose-400" />
                  Today
                </span>
              )}
              <span className="text-xs text-muted" data-testid="result-count">
                {loading ? 'Loading…' : plural(sessions.length, 'session')}
              </span>
            </div>
            {blocker && !loading && (
              <button
                type="button"
                onClick={clearBlocker}
                data-testid="grid-blocked-notice"
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-3 py-1 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/15"
              >
                <Icon name="info" className="size-3" />
                Grid shows a whole day — not available with {blocker[1]}. Show whole day
              </button>
            )}
          </div>

          {error && <ErrorState error={error} onRetry={reload} />}
          {loading && <Skeleton className="h-[32rem]" />}

          {!loading && !error && sessions.length === 0 && (
            <EmptyState
              title={filters.q ? `No sessions match “${filters.q}”` : 'No sessions match'}
              description="Try widening the filters — or clearing them entirely."
              action={<Button size="sm" onClick={clearAll}>Clear filters</Button>}
            />
          )}

          {!loading && sessions.length > 0 && showGrid && <ScheduleGrid sessions={sessions} />}

          {!loading && sessions.length > 0 && !showGrid && slots.map(([time, items]) => (
            <section key={time} className="card overflow-hidden" data-testid={`slot-${time}`}>
              <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
                <div className="flex items-baseline gap-3">
                  <h2 className="font-mono text-base font-bold text-ink">{time}</h2>
                  <span className="text-xs text-faint">–&nbsp;{items[0]?.endsAt}</span>
                </div>
                <span className="text-[11px] font-medium text-faint">{plural(items.length, 'session')}</span>
              </header>
              <div className="grid grid-flow-row-dense grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-3 p-3 sm:p-4">
                {items.map((s) => <SessionCard key={s.id} session={s} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
