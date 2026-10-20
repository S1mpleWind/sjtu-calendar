CREATE TABLE canvas_courses (
    instance_url TEXT NOT NULL,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    name TEXT NOT NULL,
    course_code TEXT NOT NULL DEFAULT '',
    term_name TEXT,
    workflow_state TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    synced_at TEXT NOT NULL,
    PRIMARY KEY (instance_url, user_id, course_id)
);

CREATE TABLE canvas_assignments (
    instance_url TEXT NOT NULL,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    course_name TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    lock_at TEXT,
    html_url TEXT NOT NULL DEFAULT '',
    workflow_state TEXT,
    submitted_at TEXT,
    remote_grade TEXT,
    remote_updated_at TEXT,
    local_completed INTEGER NOT NULL DEFAULT 0 CHECK (local_completed IN (0, 1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    synced_at TEXT NOT NULL,
    PRIMARY KEY (instance_url, user_id, course_id, assignment_id),
    FOREIGN KEY (instance_url, user_id, course_id)
        REFERENCES canvas_courses(instance_url, user_id, course_id) ON DELETE CASCADE
);

CREATE INDEX canvas_assignments_deadline
    ON canvas_assignments(instance_url, user_id, due_at)
    WHERE archived = 0 AND due_at IS NOT NULL;

CREATE TABLE canvas_sync_state (
    instance_url TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('idle', 'succeeded', 'partial', 'failed')),
    last_sync_at TEXT,
    last_success_at TEXT,
    course_count INTEGER NOT NULL DEFAULT 0,
    assignment_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT,
    PRIMARY KEY (instance_url, user_id)
);
