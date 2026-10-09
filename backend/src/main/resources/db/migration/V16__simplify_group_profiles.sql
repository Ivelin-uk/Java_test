ALTER TABLE learning_groups ADD COLUMN deleted_at DATETIME(6) NULL;

UPDATE learning_groups SET deleted_at = CURRENT_TIMESTAMP(6) WHERE status = 'deleted';

ALTER TABLE learning_groups DROP COLUMN school_year;
ALTER TABLE learning_groups DROP COLUMN class_label;
ALTER TABLE learning_groups DROP COLUMN status;
