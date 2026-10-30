import { Router } from 'express';
import { db } from '../db.js';
import { SESSION_SELECT, hydrateSessions, toSession, toSpeaker } from '../lib/query.js';
import { seatState } from '../lib/seats.js';
import { baseUrlFor, sessionCalendar } from '../lib/ical.js';

export const sessionsRouter = Router();

const getSession = db.prepare(`${SESSION_SELECT} WHERE s.id = ?`);
const speakersOn = db.prepare(`
  SELECT sp.*, ss.role FROM session_speakers ss
  JOIN speakers sp ON sp.id = ss.speaker_id WHERE ss.session_id = ?`);
const tagsOn = db.prepare(`
  SELECT tg.name, tg.slug, tg.kind FROM session_tags st
  JOIN tags tg ON tg.id = st.tag_id WHERE st.session_id = ? ORDER BY tg.kind, tg.name`);
const reviewsOn = db.prepare(`
  SELECT rt.stars, rt.comment, rt.created_at, u.name, u.initials, u.accent, u.image_url, u.job_title, u.company
  FROM ratings rt JOIN users u ON u.id = rt.user_id
  WHERE rt.session_id = ? AND rt.comment IS NOT NULL ORDER BY rt.created_at DESC`);
/** Other sessions in the same room, same day — "what else is in this room". */
const alsoInRoom = db.prepare(`${SESSION_SELECT}
  WHERE s.room_id = ? AND s.day = ? AND s.id != ? ORDER BY s.starts_at`);
/** Same slot, different room — the "what am I giving up" list. */
const competingWith = db.prepare(`${SESSION_SELECT}
  WHERE s.day = ? AND s.starts_at = ? AND s.id != ? ORDER BY s.avg_rating DESC LIMIT 6`);

/**
 * GET /api/sessions
 * Filters: day, trackSlug, tagSlug, venueId, roomId, level, format, speakerId, q, reservedBy, followedBy
 * Sort:    time (default) | rating | popularity
 */
sessionsRouter.get('/', (req, res) => {
  const { day, trackSlug, tagSlug, venueId, roomId, level, format, speakerId, q, reservedBy, followedBy, sort } = req.query;
  const where = [];
  const args = [];

  if (day) { where.push('s.day = ?'); args.push(day); }
  if (trackSlug) {
    // comma-separated: ?trackSlug=a,b. One slug is the same query as before.
    const slugs = String(trackSlug).split(',').filter(Boolean);
    if (slugs.length) { where.push(`t.slug IN (${slugs.map(() => '?').join(', ')})`); args.push(...slugs); }
  }
  if (venueId) { where.push('v.id = ?'); args.push(venueId); }
  if (roomId) { where.push('r.id = ?'); args.push(roomId); }
  if (level) { where.push('s.level = ?'); args.push(level); }
  if (format) { where.push('s.format = ?'); args.push(format); }
  if (q) {
    where.push(`(s.title LIKE ? OR s.abstract LIKE ? OR s.subtitle LIKE ?
      OR EXISTS (SELECT 1 FROM session_speakers ss JOIN speakers sp ON sp.id = ss.speaker_id
                 WHERE ss.session_id = s.id AND sp.name LIKE ?))`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (tagSlug) {
    where.push('EXISTS (SELECT 1 FROM session_tags st JOIN tags tg ON tg.id = st.tag_id WHERE st.session_id = s.id AND tg.slug = ?)');
    args.push(tagSlug);
  }
  if (speakerId) {
    where.push('EXISTS (SELECT 1 FROM session_speakers ss WHERE ss.session_id = s.id AND ss.speaker_id = ?)');
    args.push(speakerId);
  }
  if (followedBy) {
    // sessions given by anyone this attendee follows
    where.push(`EXISTS (
      SELECT 1 FROM session_speakers ss
      JOIN speaker_follows sf ON sf.speaker_id = ss.speaker_id
      WHERE ss.session_id = s.id AND sf.user_id = ?)`);
    args.push(followedBy);
  }
  if (reservedBy) {
    where.push('EXISTS (SELECT 1 FROM reservations r WHERE r.session_id = s.id AND r.user_id = ?)');
    args.push(reservedBy);
  }

  const orderBy = sort === 'rating' ? 's.avg_rating DESC, s.rating_count DESC'
    : sort === 'popularity' ? '(CAST(s.seats_taken AS REAL) / s.capacity) DESC'
    : 's.day, s.starts_at, r.name';

  const sql = `${SESSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`;
  res.json(hydrateSessions(db.prepare(sql).all(...args)));
});

sessionsRouter.get('/:id.ics', (req, res) => {
  const ics = sessionCalendar(Number(req.params.id), baseUrlFor(req));
  if (!ics) return res.status(404).json({ error: 'Session not found' });
  res.type('text/calendar').set('Content-Disposition', `attachment; filename="orbit-${req.params.id}.ics"`).send(ics);
});

sessionsRouter.get('/:id', (req, res) => {
  const row = getSession.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Session not found' });

  const speakers = speakersOn.all(row.id).map((s) => toSpeaker(s, { role: s.role }));
  const tags = tagsOn.all(row.id);

  const reviews = reviewsOn.all(row.id)
    .map((r) => ({
      stars: r.stars, comment: r.comment, createdAt: r.created_at,
      author: { name: r.name, initials: r.initials, accent: r.accent, imageUrl: r.image_url, jobTitle: r.job_title, company: r.company },
    }));

  const seats = seatState(row.id, req.query.userId ? Number(req.query.userId) : null);

  res.json({
    ...toSession(row, { speakers, tags }),
    seats,
    reviews,
    alsoInRoom: alsoInRoom.all(row.room_id, row.day, row.id).map((r) => toSession(r)),
    competing: competingWith.all(row.day, row.starts_at, row.id).map((r) => toSession(r)),
  });
});
