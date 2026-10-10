// Vercel Serverless Function — receives a workout and writes it to Notion.
// Lives at:  /api/log   (because the file is api/log.js)
// Secrets come from environment variables set in the Vercel dashboard:
//   NOTION_TOKEN        -> your Notion integration secret (starts with "ntn_")
//   NOTION_DATABASE_ID  -> the 32-char id of your Notion database
//
// Structure: ONE ROW PER SET. In Notion, group the view by Date to see each
// session as its own block, with per-session totals in the group footer.
//
// Columns required in your Notion database (names must match exactly):
//   Name        — Title (text) — auto-filled with e.g. "Back Squat — Set 1"
//   Exercise    — Select       — auto-creates options as new exercises come in
//   Date        — Date
//   Set #       — Number
//   Weight (kg) — Number
//   Reps        — Number
//   Volume (kg) — Number

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const TOKEN = process.env.NOTION_TOKEN;
  if (!TOKEN) {
    res.status(500).json({ error: 'Server is missing NOTION_TOKEN' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Archive (delete) or un-archive (undo) existing rows by page id.
  if (body && body.action === 'archive' && Array.isArray(body.pageIds)) {
    const archived = body.archived !== false; // default true = trash it
    try {
      for (const id of body.pageIds) {
        const r = await fetch('https://api.notion.com/v1/pages/' + id, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ archived }),
        });
        if (!r.ok) { const detail = await r.text(); console.error('Notion archive error', r.status, detail); res.status(502).json({ error: 'Notion archive failed', detail }); return; }
      }
      res.status(200).json({ ok: true, archived: body.pageIds.length });
      return;
    } catch (e) { res.status(500).json({ error: 'Archive failed', detail: String(e) }); return; }
  }

  // Fetch all rows from the database and return a simplified list (for "Pull from Notion").
  if (body && body.action === 'fetch') {
    const DB = body.databaseId && String(body.databaseId).trim();
    if (!DB) { res.status(400).json({ error: 'No database id provided' }); return; }
    const txt = pr => (pr && pr.rich_text && pr.rich_text[0] && pr.rich_text[0].plain_text) || '';
    const ttl = pr => (pr && pr.title && pr.title[0] && pr.title[0].plain_text) || '';
    const sel = pr => (pr && pr.select && pr.select.name) || '';
    const dt  = pr => (pr && pr.date && pr.date.start) || '';
    const n2  = pr => (pr && typeof pr.number === 'number') ? pr.number : 0;
    try {
      const rows = [];
      let cursor = undefined, more = true;
      while (more) {
        const body2 = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] };
        if (cursor) body2.start_cursor = cursor;
        const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify(body2),
        });
        if (!r.ok) { const detail = await r.text(); res.status(502).json({ error: 'Notion query failed', detail }); return; }
        const data = await r.json();
        (data.results || []).forEach(pg => {
          const p = pg.properties || {};
          rows.push({
            pageId: pg.id,
            session: txt(p['Session']),
            date: dt(p['Date']),
            exercise: sel(p['Exercise']) || ttl(p['Name']).replace(/ \u2014 Set \d+$/, ''),
            setNo: n2(p['Set #']),
            weight: n2(p['Weight (kg)']),
            reps: n2(p['Reps']),
            mins: n2(p['Duration (min)']),
            km: n2(p['Distance (km)']),
            tag: sel(p['Workout Type']),
          });
        });
        more = data.has_more; cursor = data.next_cursor;
      }
      res.status(200).json({ ok: true, rows });
      return;
    } catch (e) { res.status(500).json({ error: 'Fetch failed', detail: String(e) }); return; }
  }

  const { date, exercises, databaseId, sessionId, tag } = body || {};
  if (!date || !Array.isArray(exercises) || exercises.length === 0) {
    res.status(400).json({ error: 'Expected { date, exercises[] }' });
    return;
  }

  // The database is provided by the app — each person sets their own. No default.
  const DB = databaseId && String(databaseId).trim();
  if (!DB) {
    res.status(400).json({ error: 'No Notion database set. Open Notion settings and add your database ID.' });
    return;
  }

  const num = v => Number(v) || 0;
  // Reuse a complete upload when a prior request reached Notion but its response
  // was lost. Keep older revisions for the client to archive after the new rows
  // are safely present.
  const expected = exercises.flatMap(ex => (Array.isArray(ex.sets) ? ex.sets : []).map((set, index) => ({
    date, exercise: ex.name || 'Exercise', setNo: index + 1, tag: tag && String(tag).trim() || '',
    cardio: ex.type === 'cardio', weight: num(set.weight), reps: num(set.reps),
    mins: num(set.mins), km: num(set.km)
  })));
  let existing = [];
  if (sessionId) {
    try {
      let cursor;
      do {
        const query = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'descending' }], filter: { property: 'Session', rich_text: { equals: String(sessionId) } } };
        if (cursor) query.start_cursor = cursor;
        const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify(query)
        });
        if (!r.ok) { res.status(502).json({ error: 'Notion session lookup failed', detail: await r.text() }); return; }
        const data = await r.json();
        existing.push(...(data.results || []));
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);
    } catch (e) { res.status(500).json({ error: 'Notion session lookup failed', detail: String(e) }); return; }
  }
  const sameRow = (page, row) => {
    const p = page.properties || {};
    const number = name => p[name]?.number;
    const cardio = number('Duration (min)') != null || number('Distance (km)') != null;
    return p['Date']?.date?.start === row.date &&
      (p['Exercise']?.select?.name || '') === row.exercise &&
      number('Set #') === row.setNo &&
      (p['Workout Type']?.select?.name || '') === row.tag && cardio === row.cardio &&
      num(number('Weight (kg)')) === row.weight && num(number('Reps')) === row.reps &&
      num(number('Duration (min)')) === row.mins && num(number('Distance (km)')) === row.km;
  };
  const unused = [...existing], matching = [];
  for (const row of expected) {
    const match = unused.findIndex(page => sameRow(page, row));
    if (match < 0) break;
    matching.push(...unused.splice(match, 1));
  }
  if (matching.length === expected.length && expected.length) {
    res.status(200).json({ ok: true, created: 0, ids: matching.map(page => page.id), priorIds: unused.map(page => page.id) });
    return;
  }
  const priorIds = existing.map(page => page.id);
  let created = 0;
  const ids = [];
  // If Notion rejects a later set, attempt to remove rows created earlier
  // during this request before reporting the failure.
  async function rollbackCreatedRows() {
    for (const id of ids) {
      try {
        const rollback = await fetch('https://api.notion.com/v1/pages/' + id, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ archived: true }),
        });
        if (!rollback.ok) console.error('Notion rollback rejected', id, rollback.status);
      } catch (e) { console.error('Notion rollback failed', id, e); }
    }
  }

  try {
    for (const ex of exercises) {
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      for (let i = 0; i < sets.length; i++) {
        const isCardio = ex.type === 'cardio';
        const weight = num(sets[i].weight);
        const reps   = num(sets[i].reps);
        const mins   = num(sets[i].mins);
        const km     = num(sets[i].km);
        const name   = ex.name || 'Exercise';

        const resp = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parent: { database_id: DB },
            properties: {
              'Name':        { title:  [{ text: { content: `${name} — Set ${i + 1}` } }] },
              'Session':     { rich_text: sessionId ? [{ text: { content: String(sessionId) } }] : [] },
              'Workout Type': { select: (tag && String(tag).trim()) ? { name: String(tag).trim() } : null },
              'Exercise':    { select: { name } },
              'Date':        { date:   { start: date } },
              'Set #':       { number: i + 1 },
              'Weight (kg)':    { number: isCardio ? null : weight },
              'Reps':           { number: isCardio ? null : reps },
              'Volume (kg)':    { number: isCardio ? null : weight * reps },
              'Duration (min)': { number: isCardio ? mins : null },
              'Distance (km)':  { number: (isCardio && km) ? km : null },
            },
          }),
        });

        if (!resp.ok) {
          const detail = await resp.text();
          console.error('Notion error', resp.status, detail);
          await rollbackCreatedRows();
          res.status(502).json({ error: 'Notion rejected the request', detail, createdSoFar: created });
          return;
        }
        try { const d = await resp.json(); if (d && d.id) ids.push(d.id); } catch (e) {}
        created++;
      }
    }

    res.status(200).json({ ok: true, created, ids, priorIds });
  } catch (e) {
    await rollbackCreatedRows();
    res.status(500).json({ error: 'Sync failed', detail: String(e) });
  }
}
