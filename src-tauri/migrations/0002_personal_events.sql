CREATE TABLE personal_events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'event' CHECK (category IN ('event', 'deadline')),
    start_local TEXT NOT NULL,
    end_local TEXT NOT NULL,
    timezone TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
    rrule TEXT,
    color TEXT NOT NULL DEFAULT '#4f46e5',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX personal_events_active_start ON personal_events(start_local) WHERE deleted_at IS NULL;

CREATE TABLE recurrence_exceptions (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL REFERENCES personal_events(id) ON DELETE CASCADE,
    original_start_local TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cancelled', 'override')),
    override_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (event_id, original_start_local),
    CHECK ((kind = 'cancelled' AND override_json IS NULL) OR (kind = 'override' AND override_json IS NOT NULL))
);

CREATE INDEX recurrence_exceptions_event ON recurrence_exceptions(event_id);
