CREATE TABLE academic_terms (
    id TEXT PRIMARY KEY NOT NULL,
    source_system TEXT NOT NULL CHECK (source_system IN ('undergraduate', 'graduate')),
    academic_year TEXT NOT NULL,
    term_code TEXT NOT NULL CHECK (term_code IN ('1', '2', '3')),
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    week_count INTEGER NOT NULL CHECK (week_count BETWEEN 1 AND 24),
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_system, academic_year, term_code)
);

CREATE TABLE sjtu_courses (
    id TEXT PRIMARY KEY NOT NULL,
    term_id TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    source_system TEXT NOT NULL CHECK (source_system IN ('undergraduate', 'graduate')),
    name TEXT NOT NULL,
    teacher TEXT NOT NULL DEFAULT '',
    default_location TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    remote_fingerprint TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    remote_updated_at TEXT,
    synced_at TEXT NOT NULL,
    UNIQUE (term_id, source_system, external_id)
);

CREATE TABLE course_meetings (
    id TEXT PRIMARY KEY NOT NULL,
    course_id TEXT NOT NULL REFERENCES sjtu_courses(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    start_section INTEGER NOT NULL CHECK (start_section BETWEEN 1 AND 14),
    end_section INTEGER NOT NULL CHECK (end_section BETWEEN start_section AND 14),
    start_local_time TEXT NOT NULL,
    end_local_time TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    week_numbers_json TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    teacher TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    remote_fingerprint TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    UNIQUE (course_id, weekday, start_section, end_section, week_numbers_json, location)
);

CREATE INDEX course_meetings_weekday ON course_meetings(weekday, start_section, end_section) WHERE archived = 0;

CREATE TABLE sjtu_sync_state (
    source_system TEXT NOT NULL CHECK (source_system IN ('undergraduate', 'graduate')),
    term_id TEXT NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('idle', 'succeeded', 'partial', 'failed')),
    last_sync_at TEXT,
    last_success_at TEXT,
    course_count INTEGER NOT NULL DEFAULT 0,
    meeting_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT,
    PRIMARY KEY (source_system, term_id)
);
