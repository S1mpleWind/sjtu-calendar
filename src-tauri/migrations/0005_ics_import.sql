ALTER TABLE personal_events ADD COLUMN import_source TEXT;
ALTER TABLE personal_events ADD COLUMN import_key TEXT;
CREATE UNIQUE INDEX personal_events_import_identity
    ON personal_events(import_source, import_key)
    WHERE import_source IS NOT NULL AND import_key IS NOT NULL AND deleted_at IS NULL;
