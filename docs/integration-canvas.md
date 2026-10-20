# Canvas integration (Phase 3)

## Source and API basis

The read-only helper source under ignored `references/SJTU-Canvas-Helper` was audited at commit `780001ecb7e0e74d9af44847dbbee1f80f890c94`. It uses the two Canvas origins supported here (`https://oc.sjtu.edu.cn` and `https://jicanvas.com`), `/api/v1/courses`, and `/api/v1/courses/{course_id}/assignments`. The implementation was checked against the [official Canvas API documentation](https://developerdocs.instructure.com/services/canvas), the [assignments API](https://developerdocs.instructure.com/services/canvas/resources/assignments), and the [users API](https://developerdocs.instructure.com/services/canvas/resources/users).

The app verifies a token with `GET /api/v1/users/self`, retrieves active courses from `GET /api/v1/courses?include[]=teachers&include[]=term&enrollment_state=active`, then reads each course's assignments from `GET /api/v1/courses/{id}/assignments?include[]=submission&include[]=overrides&include[]=all_dates`. Requests use HTTPS, `Authorization: Bearer`, `Accept: application/json+canvas-string-ids`, bounded timeouts, and no automatic redirects. Pagination follows the response `Link` header's `rel="next"` URL only when it remains on the configured origin. Page and item bounds stop unexpectedly large results.

## Credentials and cache

The token is entered by the user in Settings and stored with the Windows Credential Manager through the Rust `keyring` Windows backend. It is never put in SQLite, `localStorage`, logs or source control. SQLite stores only the selected Canvas origin, remote course/assignment data, sync metadata and the user's local completion flag.

The calendar reads cached assignments by the last synchronized Canvas user and selected date/timezone without making a request. A complete sync archives no-longer-returned records. A partial course failure updates the successful course responses while preserving older cache rows. Upserts use the remote composite key and preserve `local_completed`.

## User acceptance

Open Settings, choose the instance, enter a personal access token generated in Canvas account settings, and select **安全保存令牌**. Then select **测试连接** to verify the actual account before selecting **立即同步**. The app reports the number of courses/assignments received and any partial failures. No live account has been used during development; automated tests use an isolated local HTTP fixture and SQLite data only.

## Current boundaries

- The host allowlist is limited to the two origins above.
- Assignment `due_at` is used for calendar placement. The API request includes `all_dates` and `overrides`, but section-specific date sets are not yet separately projected.
- Completion checkboxes are local reminders; they do not submit assignments or update Canvas.
- Real login, token validity, service availability and rate limiting require the user's live acceptance. Tokens must not be sent in chat or added to logs.
