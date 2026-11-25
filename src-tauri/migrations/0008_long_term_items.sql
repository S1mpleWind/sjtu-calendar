CREATE TABLE long_term_items (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    created_at TEXT NOT NULL,
    archived_at TEXT
);
CREATE INDEX long_term_items_archive ON long_term_items(archived_at, created_at);
