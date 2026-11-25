CREATE TABLE weekly_todo_weeks (
    week_start TEXT PRIMARY KEY NOT NULL CHECK(length(week_start) = 10 AND strftime('%w', week_start) = '1')
);
CREATE TABLE weekly_todos (
    id TEXT PRIMARY KEY NOT NULL,
    week_start TEXT NOT NULL REFERENCES weekly_todo_weeks(week_start),
    lineage_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    details TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
    carried_from_week TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(week_start, lineage_id)
);
CREATE INDEX weekly_todos_by_week ON weekly_todos(week_start, created_at);
