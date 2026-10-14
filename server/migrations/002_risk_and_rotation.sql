ALTER TABLE products ADD COLUMN risk TEXT NOT NULL DEFAULT 'normal' CHECK (risk IN ('high','normal','low'));
ALTER TABLE lines ADD COLUMN risk TEXT NOT NULL DEFAULT 'normal' CHECK (risk IN ('high','normal','low'));
ALTER TABLE lines DROP CONSTRAINT lines_status_check;
ALTER TABLE lines ADD CONSTRAINT lines_status_check CHECK (status IS NULL OR status IN ('okay','out_of_date','not_stickered','rotation_issue'));
