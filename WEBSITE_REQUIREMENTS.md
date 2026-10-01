# Challenge Portal Website Plan

## 01 Project overview

Build a working interview demo with a username and password login, Admin and User roles, a challenge list, downloadable challenge attachments, exact answer checking, and saved user progress. This document defines the UI, server, SQLite database, integration, testing, and delivery requirements for a focused one-day implementation.

**Selected stack:** React with Vite, Node.js with Express, and SQLite using better-sqlite3. SQLite saves data in a private local file accessed by the server. No pgAdmin, database service, database username, or database password is required. This SQLite revision replaces the earlier PostgreSQL plan.

**Project name:** Challenge Portal. The interaction is inspired by challenge platforms such as TryHackMe. Use an original interface and sample content. This is a question-and-answer challenge portal; it does not require virtual machines, hacking environments, VPN connections, or execution of uploaded files.

### The required example

1. A user logs in and sees the published challenges.
2. The user opens Challenge 1 and reads a question.
3. An attached file can be downloaded. The application does not process or execute it.
4. The user types an answer into a text field and presses Submit answer.
5. When the expected answer is `123`, submitting exactly `123` shows success. Submitting `124` shows fail and allows another attempt.
6. A successful challenge stays completed after refresh, logout, login, and server restart.

### Scope decisions for the first version

One challenge has one question, one expected text answer, and at most one optional attachment. A question can contain several lines. The answer uses one text field; multiple separately graded questions and multiline answers are future extensions. All published challenges are available immediately, ordered by the admin; completing Challenge 1 is not required to open Challenge 2.

### Quick guide in Manglish

`WEBSITE_REQUIREMENTS.md` project folder-il vekkanam. `CODEX_START_PROMPT.txt`-ile prompt Codex-il paste cheyyanam. Athu UI, server, SQL migrations, sample data, tests, README enniva undaakkanulla instruction aanu. SQLite use cheyyunnathukondu database password venda. Demo login passwords local `.env` file-il set cheyyuka. Ee file documentation aanu. Project code already undenkil `CODEX_SQLITE_SWITCH_PROMPT.txt` same project chat-il kodukkuka.

<!-- pagebreak -->

## 02 Roles and user journeys

### Access matrix

| Feature | Guest | User | Admin |
|---|---|---|---|
| Open login page | Yes | Redirect | Redirect |
| Read published challenges | No | Yes | Yes for preview |
| Download published attachment | No | Yes | Yes |
| Submit answer and save own progress | No | Yes | No |
| Create and edit challenges | No | No | Yes |
| Publish or hide challenges | No | No | Yes |
| Read draft challenges | No | No | Yes |
| View another user's progress | No | No | Outside MVP |

The server determines the role from the authenticated user record. The login form has no role picker. UI route protection improves the experience; every protected API must also enforce access independently.

### User journey

Login page -> enter username and password -> server authenticates -> challenge dashboard -> select a card -> read question and optionally download file -> submit answer -> receive success or fail feedback -> return to dashboard with updated progress -> logout.

If authentication expires, clear the signed-in UI state and return to login. Do not show protected content while the application is still checking the session. Preserve a safe internal return path if useful; do not redirect to arbitrary external URLs.

### Admin journey

Login -> admin challenge list -> create draft -> enter title, summary, question, expected answer, difficulty, and display order -> optionally upload a file -> preview -> publish. Editing or hiding a challenge updates what users can access without restarting the server.

### Accounts and progress

Seed one Admin and two Users for the demo. Two users make it possible to prove that progress belongs to the signed-in account. Self-registration, account management screens, email verification, and password reset are outside the one-day scope.

A challenge is **Not started** when the user has no valid submissions, **Attempted** after at least one wrong answer, and **Completed** after a correct answer. A later wrong submission never removes completion. Dashboard totals count published challenges only.

<!-- pagebreak -->

## 03 User interface requirements

### Pages and navigation

| Route | Content and behavior |
|---|---|
| `/login` | Product name, username, password, show password control, Sign in button, and inline error |
| `/challenges` | Signed-in username, logout, progress count, and published challenge cards |
| `/challenges/:id` | Back link, title, difficulty, question, attachment, answer field, Submit answer, and result |
| `/admin/challenges` | Admin challenge table and Create challenge button |
| `/admin/challenges/new` | Challenge creation form |
| `/admin/challenges/:id/edit` | Challenge edit form, preview, attachment actions, and publish status |

Choose a clean dark interface with a charcoal background, readable white text, and restrained green accents. Keep content centered with a maximum width around 1100 px. Use one column on mobile and up to three challenge cards per row on desktop. The appearance can be simple; login, submission, and persistence take priority over animation.

### Challenge cards

Each card shows title, short summary, Easy/Medium/Hard difficulty, and progress state. Include an Open challenge action. Order by display order, then ID. For the small demo, no pagination, category system, leaderboard, or search is required.

### Challenge detail

Render the question as plain text and preserve line breaks. Display the attachment name and size beside a Download file button; omit this block when no attachment exists. Use a text input, never a numeric input: `00123` and `123` are different answers. Show the hint: “Match the answer exactly, including capitalization and spaces.”

Disable Submit answer while a request is running. Keep result text beside the form, not only in a temporary toast. Use a visible label and keyboard submission. Announce result changes to assistive technology and use text/icons as well as color.

### Required UI messages

**Correct:** “Success! Correct answer.” **Wrong:** “Fail. Incorrect answer. Try again.” **Empty:** “Enter an answer.”

**Login failure:** “Invalid username or password.” **Session expiry:** “Please sign in again.” **Empty list:** “No challenges available yet.”

**Request or database failure:** “Could not check your answer. Please retry.” Keep this distinct from incorrect-answer feedback.

<!-- pagebreak -->

## 04 Admin interface and content rules

### Challenge form

| Field | Rule |
|---|---|
| Title | Required, 3 to 100 characters |
| Summary | Required, 1 to 240 characters |
| Question | Required, 1 to 5000 characters; plain text with line breaks |
| Expected answer | Required on create; 1 to 200 characters; exact, case sensitive, single line |
| Difficulty | `easy`, `medium`, or `hard` |
| Display order | Integer from 0 to 9999; duplicates allowed with ID as tie-breaker |
| Published | Boolean; new challenges default to draft |
| Attachment | Optional; one TXT or PDF file, at most 5 MiB |

Reject whitespace-only required fields. For expected answers, reject leading or trailing whitespace in the admin form and API so accidental spaces cannot become hidden requirements. Internal spaces are allowed. This authoring rule does not trim users' submitted answers.

On edit, the expected answer field starts empty and is labelled “New expected answer - leave blank to keep current.” The UI omits `expectedAnswer` when unchanged. If that property is sent as an empty string, the API rejects it. Never return an existing expected answer or its hash to the browser, including the admin browser.

Create and edit metadata using JSON. Upload an attachment in a separate request after the challenge has an ID. The upload endpoint replaces the previous file only after validation and successful storage. Show upload progress or a busy state and a useful error; a failed upload must not destroy the previous attachment.

### Visibility and history

Publish exposes the challenge to users. Hide makes it unavailable to users, including direct detail, download, and answer requests. Retain attempts and completions when hidden. When republished, the same users see their previous completion again.

Editing a question or replacing its answer does not erase existing completion. Show this note in the admin form. To require everyone to solve a substantially changed task, create a new challenge. Hard delete, scoring changes, and progress resets are outside the MVP.

### Demo content

Seed three published challenges with known demo answers: `123`, `HELLO`, and `flag{demo_success}`. Challenge 1 asks the user to enter the three-character code supplied in its sample text; attach a harmless `challenge-1.txt`. These intentionally public demo answers belong in the seed script and demo guide, not a real production challenge bank.

<!-- pagebreak -->

## 05 Architecture and project structure

### Components

| Component | Choice | Responsibility |
|---|---|---|
| Browser UI | React, Vite, React Router, CSS | Forms, navigation, challenge views, feedback |
| HTTP server | Node.js 24 LTS, Express 5 | Authentication, permissions, validation, answer checking, downloads |
| Data access | `better-sqlite3` with prepared SQL | Persistent local database and transactions |
| Database | SQLite | Users, challenges, attempts, completions, sessions |
| Authentication | `express-session`, SQLite Store | Server sessions stored in the same private database |
| Hashing | `argon2` | Password and expected-answer hashes |
| Validation and uploads | Zod, Multer, Helmet, rate limiting | Request schemas, limited uploads, HTTP controls |

Use the latest patched Node 24 LTS available at implementation time and compatible package versions. Commit the package lockfile. The chosen Node baseline meets the documented Vite and Express minimums [1-3]. No ORM, Docker, separate auth provider, or external storage account is required for the local demo.

### Request path

Browser -> React UI -> `/api` -> Express middleware -> service -> private SQLite file. Files travel through an authorized Express download endpoint. Use one Express process and a local persistent disk for this demo. Keep SQL access on the server; do not expose the database file through a web route.

### Required folder layout

```text
challenge-portal/
  client/src/       pages, components, auth, api, styles
  client/vite.config.js
  server/src/       app, routes, middleware, services, db
  server/migrations/
  server/scripts/  migrate and seed commands
  server/data/     private SQLite database and sidecar files
  server/storage/  private uploaded files
  server/.env.example
  tests/           API and essential UI tests
  package.json     root scripts for all common actions
  README.md
  DEMO_GUIDE.md
```

In development, Vite runs at `http://localhost:5173` and proxies `/api` to Express at `http://localhost:3000`. The browser always calls relative `/api` URLs. In the built local demo, Express serves both `client/dist` and `/api` from port 3000. Register API routes before the React fallback and use Express 5 compatible routing.

<!-- pagebreak -->

## 06 SQLite data model

Use versioned SQL migrations. IDs are `INTEGER PRIMARY KEY`. Store application timestamps as UTC ISO-8601 `TEXT`. Boolean fields are `INTEGER` constrained to 0 or 1; convert them to/from JSON booleans at the API boundary. SQLite does not enforce a declared VARCHAR length; validate lengths explicitly [9].

| Table | Required fields and constraints |
|---|---|
| `users` | `id` PK; `username` TEXT unique not null; `password_hash` TEXT not null; `role` TEXT constrained to ADMIN or USER; `is_active` INTEGER default 1; `created_at` TEXT |
| `challenges` | `id` PK; TEXT `title`, `summary`, `question`, `answer_hash`, `difficulty`; INTEGER `display_order` and `is_published` default 0; `created_by` FK users; TEXT `created_at`, `updated_at` |
| Attachment fields on `challenges` | Nullable `attachment_storage_name`, `attachment_original_name`, `attachment_mime` as TEXT and `attachment_size` INTEGER; all four null or all populated; size at most 5242880 bytes |
| `attempts` | `id` PK; `user_id` FK users; `challenge_id` FK challenges; `is_correct` INTEGER; `created_at` TEXT; never store raw submitted answers |
| `completions` | `user_id` and `challenge_id` both NOT NULL foreign keys; `completed_at` TEXT; composite primary key on user and challenge |
| `sessions` | `sid` TEXT primary key NOT NULL; `data` TEXT serialized JSON NOT NULL; `expires_at` INTEGER NOT NULL as epoch milliseconds; expiry index |

Make required application fields NOT NULL. Add CHECK constraints for 0/1 booleans, easy/medium/hard difficulty, and display order from 0 to 9999. Store usernames in lowercase with 3 to 30 letters, digits, or underscores. Never normalize passwords or submitted answers.

### Connection and transaction rules

Resolve `DB_FILE` against `server/` and create its parent directory. Enable `foreign_keys=ON` on every connection before migrations or transactions, set `journal_mode=WAL`, and use a 5000 ms busy timeout. Bind values through prepared statements. Foreign keys prevent accidental deletion of referenced rows [4, 12].

Insert an attempt and any completion in one short synchronous transaction. Use `ON CONFLICT(user_id, challenge_id) DO NOTHING` for completion only. Do not use broad INSERT OR IGNORE to hide other constraint failures. Never await inside a better-sqlite3 transaction; Section 09 defines the hash-verification sequence [4].

### Progress and seed rules

Index attempts by `(user_id, challenge_id, created_at)` and published challenges by `(is_published, display_order, id)`. Compute status for the signed-in user only; Completed takes priority over Attempted. Totals include published challenges only.

Seed missing fixtures using stable seed identities. Repeating seed must not reset passwords, overwrite edits, duplicate challenges, or clear attempts/completions. Keep the real demo database on disk; an in-memory database cannot prove restart persistence.

<!-- pagebreak -->

## 07 Authentication and read APIs

Use JSON for API bodies except attachment uploads. Set `Cache-Control: no-store` for authenticated API responses. Return only explicitly selected safe fields, never `SELECT *` objects from database rows.

| Method and endpoint | Access | Response or behavior |
|---|---|---|
| `GET /api/health` | Public | 200 with basic status; 503 if database unavailable; no secrets |
| `GET /api/auth/csrf` | Public | Create/reuse session and return a CSRF token |
| `POST /api/auth/login` | Public with CSRF | Accept username and password; return safe user and fresh CSRF token |
| `GET /api/auth/me` | Signed in | Return id, username, and role |
| `POST /api/auth/logout` | Signed in with CSRF | Destroy session, clear cookie, return 204 |
| `GET /api/challenges` | Signed in | Published challenge summaries and own status for Users |
| `GET /api/challenges/:id` | Signed in | Published challenge detail and safe attachment metadata |
| `GET /api/challenges/:id/attachment` | Signed in | Download published attachment; Admin may download drafts |

### Authentication contract

Login accepts `{ "username": "user1", "password": "..." }`. A successful response is `{ "user": { "id": 2, "username": "user1", "role": "USER" }, "csrfToken": "..." }`. Missing, inactive, and wrong-password accounts receive the same 401 message. Apply login rate limiting.

Hash passwords with Argon2id. Suggested minimum configuration is 19456 KiB memory, two iterations, and parallelism one; use stronger settings if the environment supports them comfortably [6]. Seed passwords come from local environment values. Enforce 8 to 128 characters for these local demo account passwords. This length policy is a project decision.

Regenerate the session after successful login, store the user ID, and issue a new CSRF token. Await session persistence before responding. Read the current user's active flag and role from SQLite on protected requests.

### Safe challenge response

Return `id`, `title`, `summary`, `difficulty`, `status`, and `displayOrder` for lists. Details also contain `question` and nullable attachment `{ name, sizeBytes, downloadUrl }`. User-specific fields are for the signed-in User; Admin preview need not return progress. Omit expected answers, hashes, internal storage paths, and other users' data.

Use 401 for no valid session, 403 for the wrong role, and 404 for missing or unpublished user-facing challenges. API errors use `{ "error": { "code": "...", "message": "..." } }`.

<!-- pagebreak -->

## 08 Submission and admin APIs

### Answer submission

`POST /api/challenges/:id/attempts` requires a User session and CSRF token. The only permitted body field is `answer`, containing a string. Derive the user ID, correctness, and completion from server state.

```json
{ "answer": "123" }
```

A correct result uses HTTP 200:

```json
{
  "correct": true,
  "message": "Success! Correct answer.",
  "status": "completed"
}
```

A wrong but valid answer also uses HTTP 200, with `correct: false` and `message: "Fail. Incorrect answer. Try again."`. Its status is `attempted` unless the user previously completed that challenge; then the status remains `completed`. Do not return the expected answer in either response.

### Admin endpoints

| Method and endpoint | Behavior |
|---|---|
| `GET /api/admin/challenges` | List published and draft challenges |
| `GET /api/admin/challenges/:id` | Get editable safe metadata; no expected answer or hash |
| `POST /api/admin/challenges` | Validate metadata and expectedAnswer; hash answer; create; return 201 |
| `PATCH /api/admin/challenges/:id` | Update allowlisted fields; omitted expectedAnswer preserves hash |
| `POST /api/admin/challenges/:id/attachment` | One multipart field named file; validate and attach/replace |
| `DELETE /api/admin/challenges/:id/attachment` | Remove reference and stored file safely; return 204 |

Every admin endpoint requires an Admin session. Every mutation also requires CSRF validation. Publish and hide use PATCH with `isPublished`. Do not expose a hard-delete challenge endpoint in the MVP.

### Validation and failures

Return 400 for malformed input, 409 when a challenge changes during verification, 413 for an oversized file, 415 for an unsupported upload type, 429 for a rate limit, and a generic 500 or 503 for an internal or unavailable-service error. Do not expose SQL, stack traces, filesystem paths, or credentials. Unknown `/api` routes return a JSON 404 rather than the React HTML page.

Enforce login limits such as 10 requests per 15 minutes per IP and username, and answer limits such as 20 per minute per user. These are configurable demo defaults. Show the retry interval from `Retry-After` when present. Retries remain available after cooldown.

<!-- pagebreak -->

## 09 Exact answer checking and persistence

### Comparison contract

| Expected answer | Submitted value | Required result |
|---|---|---|
| `123` | string `123` | Success |
| `123` | string `124` | Fail |
| `123` | string `0123` | Fail |
| `123` | string with a space before or after `123` | Fail |
| `HELLO` | string `hello` | Fail |
| `123` | JSON number 123, null, array, or object | 400 validation error |
| Any | Empty, whitespace-only, over 200 characters, or newline | 400 validation error |

Use Argon2id to hash the expected answer on challenge creation or replacement. Verify the submitted string against that hash on the server. Use the same hashing library as password authentication. Do not trim, lowercase, parse as a number, apply Unicode normalization, or otherwise change the submitted answer before verification. Do not compare against a frontend copy.

### Submission algorithm

1. Verify session, User role, CSRF, rate limit, challenge ID, and answer schema.
2. Read the published challenge and its answer-hash snapshot. If missing or hidden, return 404.
3. Await Argon2 verification outside any database transaction.
4. Run a synchronous `db.transaction(callback).immediate()` operation. Reload the challenge inside it; abort with 404 if hidden or missing, or 409 if the hash changed. Record no attempt in either case.
5. Insert one attempt using the server-derived user ID and correctness; never store the answer text.
6. On success, insert completion using `ON CONFLICT(user_id, challenge_id) DO NOTHING`.
7. Read the final completion state and return it from the transaction callback. Send HTTP success only after commit. Throw on error so the transaction rolls back.

Do not use async transaction callbacks or PostgreSQL row-lock syntax. On 409, show “Challenge changed. Refresh and try again.” On `SQLITE_BUSY` or failed writes, show a retryable service error. A retried request may add another attempt, but cannot duplicate completion [4].

### UI synchronization

After submission, display the returned feedback and refresh the challenge/progress data. On page reload, derive state from the API again. Browser storage may hold preferences but must not be the source of truth for authentication, answers, or completion.

If a request fails or its result is uncertain, show “Could not check your answer. Please retry.” Do not turn an infrastructure problem into a failed answer. A later refresh can recover a completion that was committed before the connection was interrupted.

<!-- pagebreak -->

## 10 Session and file integration rules

### Sessions and CSRF

Use persistent SQLite sessions through a tested `express-session.Store` adapter as specified in Section 11. Configure `resave: false`, `saveUninitialized: false`, an eight-hour expiry, an HttpOnly cookie, and `SameSite=Lax`. Set Secure for HTTPS deployments; local HTTP needs Secure disabled. Cookie path is `/`, with no broad domain override. Configure proxy trust only for the actual deployment topology [5].

Store a random CSRF token in the server session. On initialization and after logout/session expiry, the UI fetches it from `/api/auth/csrf` with `Cache-Control: no-store`. Keep it in memory and send it in `X-CSRF-Token` for every mutation, including login and uploads. Replace it with the fresh token returned after login. Validate the allowed Origin for mutations too. SameSite alone is not the entire CSRF control [7].

The development proxy and single-origin built app keep integration simple. There is no need for wildcard CORS. If origins are separated later, explicitly allow the UI origin, configure credentials on both sides, and reassess cookie and CSRF settings.

### Attachments

Allow one TXT or PDF upload per challenge and at most 5 MiB. Authenticate and authorize before invoking multipart handling. Use patched upload middleware, enforce limits while receiving the body, and reject unexpected fields or multiple files.

Do not trust filename extensions or the browser's MIME type alone. Require a valid PDF signature for PDFs; permit only validated plain-text content for TXT and reject binary/NUL content. Generate a random storage filename. Store the original filename only as sanitized display metadata. Files live under private server storage, outside `client/public` and `client/dist` [8].

Download by challenge ID after checking access and publication. Resolve only the stored server filename, ensure the resolved path stays under the configured storage directory, and force `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`. Do not extract archives, execute files, or provide inline HTML previews.

When replacing a file, keep the old file until the new file and metadata are saved successfully. Remove new temporary files on failure, then clean up the old file after success. The application only transfers attachments; it does not solve, grade, or inspect challenge content beyond basic upload validation.

### Secret boundaries

Keep `.env`, private uploads, SQLite database and sidecar files, session secrets, and real answers out of source control and logs. No database or auth secret may use a frontend `VITE_` variable. Never log request bodies for login, answer, or challenge-answer updates.

<!-- pagebreak -->

## 11 SQLite setup and sessions

### Local preparation

Install a supported Node.js 24 LTS build and the project dependencies. better-sqlite3 opens a local file; no separate database installation, pgAdmin, port, or database password is needed. Use compatible patched package versions and a persistent writable local folder.

1. Copy `server/.env.example` to `server/.env` and fill the local values below.
2. Run `npm run db:migrate`. It creates the data directory/database when missing and applies tracked migrations without deleting existing rows.
3. Run `npm run db:seed`, then `npm run dev`. Demo account passwords are application login passwords, not database credentials.
4. Confirm `server/data/challenge_portal.sqlite` exists. Run `npm run db:inspect` to show safe table names and row counts; never print session data, hashes, or answers.

### Required server environment template

```dotenv
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://localhost:5173
DB_FILE=./data/challenge_portal.sqlite
SESSION_SECRET=replace_with_random_secret
UPLOAD_DIR=./storage
SEED_ADMIN_PASSWORD=choose_a_local_demo_password
SEED_USER1_PASSWORD=choose_a_local_demo_password
SEED_USER2_PASSWORD=choose_a_local_demo_password
```

Load `server/.env` consistently and resolve data/upload paths against `server/`, even when root scripts start the app. Generate SESSION_SECRET with at least 32 random bytes. Keep it stable across restarts. Ignore `.env`, private uploads, database files, `-wal`, and `-shm` sidecars in Git.

### Session store contract

Implement a small adapter extending `express-session.Store` on the configured SQLite connection. Use the sessions schema in Section 06. Implement `get`, `set`, `destroy`, and `touch`, with callbacks called exactly once and database/JSON errors passed to them. `get` must treat expired rows as missing [5, 10].

Serialize session data as JSON and derive expiry from the cookie's expiry or maxAge. `touch` updates only existing, unexpired rows and preserves their data; it cannot revive expired or destroyed sessions. Periodically delete expired rows; unref and clear the timer during shutdown/tests. Close the database after the server stops. Test restoration, expiry, touch, and logout.

### Storage and backup

Keep this single-server demo on a local disk, not a network share or temporary hosting filesystem. Use SQLite's backup API for a live database; copying only the main file while WAL is active can omit recent changes. If deployed later, back up the database and attachment directory together [4, 13].

<!-- pagebreak -->

## 12 Build commands and integration sequence

These commands are the required interface for the generated project. They become runnable after Codex creates the application and its package scripts; this documentation package is not itself the application.

### First run from the generated project root

```text
npm install
```

Copy `server/.env.example` to `server/.env` and fill in local settings. The migration creates the local SQLite database automatically. Then run:

```text
npm run db:migrate
npm run db:seed
npm run dev
```

`dev` must start both frontend and backend. Open `http://localhost:5173`. The migrations include the SQLite session table and expiry index. Migrations must record which changes ran and be safe to rerun. The seed script creates missing demo fixtures without destructive resets.

### Build and run the interview demo

Stop development processes, set `APP_ORIGIN=http://localhost:3000` and `NODE_ENV=production` for the built local demo, and run:

```text
npm run build
npm start
```

Open `http://localhost:3000`. Cookie Secure must follow the configured HTTP/HTTPS origin. For local HTTP, also disable Helmet's HSTS and `upgrade-insecure-requests` settings so it does not upgrade localhost to HTTPS [11]. Public deployments must use HTTPS. Refresh a nested route such as `/challenges/1` and confirm the React application loads correctly.

### Build in vertical slices

First implement SQLite migrations, repeatable seed, and health check. Next connect session login and logout to the real UI. Then implement the challenge list and detail using actual database rows. Add submission verification and persisted progress next; this is the central interview requirement. Add admin editing, publishing, and uploads after that complete path works.

Finish with the essential tests, a production build, and a clean-start rehearsal. Use real APIs from the first working screen. Hardcoded UI fixtures may be temporary during layout work, but the final app must not rely on mock login, mock submissions, or simulated persistence.

### Required handover

Deliver source, SQL migrations, repeatable seed, `.env.example`, lockfile, README, test instructions, and DEMO_GUIDE. Record actual commands and verified results. Keep local credentials outside the repository. Public hosting is a later step and needs HTTPS, persistent SQLite and attachment storage, secrets configuration, and backups.

<!-- pagebreak -->

## 13 Acceptance tests and completion criteria

Use isolated temporary SQLite files, with an explicit test `DB_FILE` and separate upload folder. Never reset the demo database; use a file-backed test database for restart checks. Implement focused API tests for permissions, validation, matching, and persistence, plus a short browser walkthrough.

| ID | Check | Expected evidence |
|---|---|---|
| A01 | Admin and User login | Correct landing page and role; generic error for invalid login |
| A02 | Open protected API as guest | 401, no protected data |
| A03 | Call admin API as User | 403, no database change |
| A04 | Login as user1 | Three seeded published challenges appear |
| A05 | Open Challenge 1 | Question, attachment metadata, and text answer input appear |
| A06 | Submit 124 then 123 | First fails with retry; second succeeds |
| A07 | Submit spaces, wrong case, leading zero | Exact-match cases behave as documented |
| A08 | Send number, empty, oversized answer | 400; no attempt/completion saved |
| A09 | Refresh and login again | Completion persists |
| A10 | Restart server with same secret and DB | Completion and unexpired session remain |
| A11 | Login as user2 | user1 completion does not transfer |
| A12 | Repeat correct submission concurrently | One completion row; no server error |
| A13 | Submit wrong after earlier success | Feedback is fail, saved status stays completed |
| A14 | Create, edit, publish, hide as Admin | User list/detail reflect changes; hidden routes return 404 |
| A15 | Download attachment | Correct file downloads; guest denied; missing file handled |
| A16 | Invalid or oversized upload | Rejected; previous attachment remains usable |
| A17 | Omit CSRF token or use wrong token | Mutation rejected without side effects |
| A18 | Inspect user API responses and bundle | No expected answers, hashes, or server credentials |
| A19 | Force write failure in isolated test DB | Service error; no false success or partial completion |
| A20 | Logout then call protected API | Session is unusable; 401 |

Run `npm test` and `npm run build`. The test launcher must create a dedicated temporary `DB_FILE`, verify its resolved path differs from the demo database, and clean up only its own files. Report actual test results and any untested browser behavior.

The MVP is complete when the core user journey, admin challenge management, saved progress, protected attachment download, and these essential checks work against SQLite. Screenshots alone are not proof of server integration.

<!-- pagebreak -->

## 14 One day plan and interview demonstration

### Implementation budget

| Time | Deliverable |
|---|---|
| Hour 0 to 1 | Environment, project structure, SQLite file setup |
| Hour 1 to 3 | Schema, seed, login, sessions, role checks |
| Hour 3 to 5 | Challenge list/detail, answer checking, completion |
| Hour 5 to 7 | Admin forms, publishing, protected attachments |
| Hour 7 to 9 | UI integration, failure states, focused tests |
| Hour 9 to 10 | Build, README, clean start, interview rehearsal |
| Remaining buffer | Installation issues and fixes; optional polish only after essentials |

This is a target for a focused implementation with working local tools and coding assistance, not a delivery guarantee. Defer leaderboards, points, timers, badges, payments, public signup, emails, complex user management, cloud infrastructure, and virtual labs.

### Five minute demonstration

Show User login and three challenges. Open Challenge 1, download its file, enter `124` to demonstrate fail, then `123` to demonstrate success. Refresh and show completion. Sign in as user2 to show separate progress. Sign in as Admin, create or edit a challenge, and publish it. Finish by showing the server routes and `npm run db:inspect` table counts without revealing secrets. A database viewer is optional.

### Troubleshooting map

| Symptom | First check |
|---|---|
| Cannot open database | Resolved DB_FILE, parent directory, and write permissions |
| Database is locked | Short transactions, configured timeout, other open writers |
| No such table | Correct DB_FILE selected and migrations completed |
| Login succeeds but next call gets 401 | Cookie settings, consistent localhost hostname, session save/store |
| Mutation gets 403 | Role and CSRF token; refresh token after login |
| CORS or network error | Browser calls relative /api and Vite proxy targets server |
| Nested page reload gives 404 | Express static serving and React fallback order |
| File download fails | Stored file exists, private path resolves, challenge is published |

<!-- pagebreak -->

## 15 Using this plan with Codex and references

### Start or update the implementation

Place the updated `WEBSITE_REQUIREMENTS.md` in the project. For a new build, paste `CODEX_START_PROMPT.txt`. For an existing project, paste `CODEX_SQLITE_SWITCH_PROMPT.txt` in its current chat. This SQLite requirement supersedes the earlier PostgreSQL instruction; preserve existing UI and completed work.

If an earlier database contains data, inspect it before conversion. Keep the old database intact. Import accessible records with their IDs, relationships, existing hashes, and attachment references; verify the result. If the old database is unavailable, build the SQLite demo and clearly report that old data has not been transferred. Require fresh login after a database switch.

### Follow up for integration

```text
Read the updated WEBSITE_REQUIREMENTS.md and existing project.
Connect React, Express, and the persistent SQLite database.
Check DB_FILE resolution, migrations, sessions, the /api proxy,
exact answer checking, protected downloads, and saved progress.
Preserve existing work and data. Fix the issue and run tests.
Do not introduce PostgreSQL or fake persistence.
```

### Official implementation references

The UI, endpoints, limits, and workflow are this project's specification. Recheck package compatibility during implementation.

| Ref | Primary documentation |
|---|---|
| 1 | Node.js releases - https://nodejs.org/en/about/previous-releases |
| 2 | Vite setup - https://vite.dev/guide/ |
| 3 | Express 5 routing - https://expressjs.com/en/guide/migrating-5/ |
| 4 | better-sqlite3 API - https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md |
| 5 | Express sessions - https://expressjs.com/en/resources/middleware/session/ |
| 6 | Password storage - https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| 7 | CSRF prevention - https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html |
| 8 | File upload controls - https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html |
| 9 | SQLite types - https://www.sqlite.org/datatype3.html |
| 10 | Session Store methods - https://github.com/expressjs/session#session-store-implementation |
| 11 | Helmet defaults - https://helmetjs.github.io/ |
| 12 | SQLite foreign keys - https://www.sqlite.org/foreignkeys.html |
| 13 | SQLite WAL behavior - https://www.sqlite.org/wal.html |
