ALTER TABLE rotation_rechecks DROP CONSTRAINT rotation_rechecks_method_check;
ALTER TABLE rotation_rechecks ADD CONSTRAINT rotation_rechecks_method_check CHECK(method IS NULL OR method IN('camera','manual','photo','no_ean','product_check'));
