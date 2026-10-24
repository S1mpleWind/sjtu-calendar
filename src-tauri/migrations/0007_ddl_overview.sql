ALTER TABLE personal_events ADD COLUMN include_in_overview INTEGER NOT NULL DEFAULT 0 CHECK (include_in_overview IN (0, 1));

-- Existing local deadlines are already explicit deadline items.
UPDATE personal_events SET include_in_overview = 1 WHERE category = 'deadline';

CREATE TABLE personal_event_completion (
    event_id TEXT NOT NULL REFERENCES personal_events(id) ON DELETE CASCADE,
    original_start_local TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (event_id, original_start_local)
);
