CREATE TABLE rotation_rechecks(
 id TEXT PRIMARY KEY,
 origin_line_id TEXT NOT NULL REFERENCES lines(id),
 due_date TEXT NOT NULL,
 created TEXT NOT NULL,
 verified_at TEXT,
 verified_by TEXT REFERENCES members(id),
 method TEXT CHECK(method IS NULL OR method IN('camera','manual','photo')),
 status TEXT CHECK(status IS NULL OR status IN('okay','rotation_issue')),
 checked_at TEXT,
 checked_by TEXT REFERENCES members(id),
 UNIQUE(origin_line_id,due_date)
);
CREATE INDEX rotation_rechecks_due ON rotation_rechecks(status,due_date);
INSERT INTO rotation_rechecks(id,origin_line_id,due_date,created)
 SELECT l.id || ':recheck:' || to_char(((r.finished::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),
 l.id,to_char(((r.finished::timestamptz AT TIME ZONE 'Europe/London')::date + 1),'YYYY-MM-DD'),r.finished
 FROM lines l JOIN rounds r ON r.id=l.round_id
 WHERE r.mode='daily' AND r.finished IS NOT NULL AND l.status='rotation_issue'
 ON CONFLICT DO NOTHING;
