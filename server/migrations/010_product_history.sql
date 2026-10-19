CREATE INDEX lines_product_history ON lines(product_id,round_id);
CREATE INDEX lines_unlinked_plu_history ON lines(plu,round_id) WHERE product_id IS NULL;
