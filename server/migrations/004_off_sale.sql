ALTER TABLE lines DROP CONSTRAINT lines_status_check;
ALTER TABLE lines ADD CONSTRAINT lines_status_check CHECK(status IS NULL OR status IN('okay','out_of_date','not_stickered','rotation_issue','off_sale'));
ALTER TABLE rotation_rechecks DROP CONSTRAINT rotation_rechecks_status_check;
ALTER TABLE rotation_rechecks ADD CONSTRAINT rotation_rechecks_status_check CHECK(status IS NULL OR status IN('okay','rotation_issue','off_sale'));
