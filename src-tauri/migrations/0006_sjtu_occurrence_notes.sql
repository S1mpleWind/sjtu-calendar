CREATE TABLE course_occurrence_notes (
    meeting_id TEXT NOT NULL REFERENCES course_meetings(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 24),
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, week_number)
);
