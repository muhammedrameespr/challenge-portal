# Challenge Portal

A local interview demo with React, Vite, React Router, plain CSS, Node.js 24 LTS, Express 5, and a persistent SQLite database accessed through `better-sqlite3`. Users solve published challenges; admins manage questions, exact answers, publication, and one private TXT/PDF attachment per challenge. Sessions and progress survive a server restart.

This project follows the revised SQLite requirements in `WEBSITE_REQUIREMENTS.md`. No database service, database password, pgAdmin, cloud account, or public deployment is needed.

## Local setup

Use a current patched **Node.js 24 LTS** installation. Run commands in the project root. `npm install` installs both client and server dependencies; the root lockfile pins their versions.

```powershell
node --version
npm install
```

Copy `server/.env.example` to `server/.env` **only if the latter does not already exist**. Preserve any local values already configured. In PowerShell:

```powershell
if (-not (Test-Path -LiteralPath server/.env)) {
  Copy-Item -LiteralPath server/.env.example -Destination server/.env
}
```

Edit `server/.env` locally. Choose the three demo account passwords yourself; do not paste them into chat or commit them. Each must contain 8–128 characters. Generate a session secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into `SESSION_SECRET`. Keep it stable between restarts so existing session cookies remain valid. The application rejects empty, unchanged placeholder, and malformed secret settings.

```powershell
npm run db:migrate
npm run db:seed
npm run db:inspect
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite runs on port 5173 and proxies `/api` to Express on port 3000. The browser uses relative `/api` URLs. `Ctrl+C` stops the development processes.

The seed creates these application accounts:

| Username | Role | Local password setting |
| --- | --- | --- |
| `admin` | ADMIN | `SEED_ADMIN_PASSWORD` |
| `user1` | USER | `SEED_USER1_PASSWORD` |
| `user2` | USER | `SEED_USER2_PASSWORD` |

There is no signup or role picker. The server obtains the current role and active status from the database on each protected request. Published demo challenge answers are documented in `DEMO_GUIDE.md`.

## Environment settings

Every server command loads `server/.env` from its absolute project location, regardless of the terminal's current directory. Already-set process environment variables take precedence over the file. Relative storage paths always resolve against `server/`, not the project root.

| Setting | Default/example | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production`. Does not independently turn on HTTPS. |
| `PORT` | `3000` | Express port, 1–65535. Keep 3000 for the supplied Vite proxy. |
| `APP_ORIGIN` | `http://localhost:5173` | Exact permitted browser origin for mutations. Use `http://localhost:3000` for the built demo. No path, query, or credentials. |
| `DB_FILE` | `./data/challenge_portal.sqlite` | Persistent private SQLite file. Its parent directory is created automatically. `:memory:`, SQLite URI paths, and paths inside `client/` are rejected. |
| `SESSION_SECRET` | Locally generated hex/base64 | At least 32 random bytes, represented as hex, base64, or base64url. No placeholder values. Changing it invalidates existing cookies. |
| `UPLOAD_DIR` | `./storage` | Private local attachment directory. Must be outside `client/`. |
| `SEED_ADMIN_PASSWORD` | Locally chosen | Initial password for missing `admin` fixture; 8–128 characters. |
| `SEED_USER1_PASSWORD` | Locally chosen | Initial password for missing `user1` fixture; 8–128 characters. |
| `SEED_USER2_PASSWORD` | Locally chosen | Initial password for missing `user2` fixture; 8–128 characters. |
| `LOGIN_WINDOW_MS` | `900000` | Login rate window in milliseconds; allowed range 1000–86400000. |
| `LOGIN_MAX` | `10` | Maximum logins per window, enforced by IP and by normalized username; allowed range 1–10000. |
| `ANSWER_WINDOW_MS` | `60000` | Answer rate window in milliseconds; allowed range 1000–86400000. |
| `ANSWER_MAX` | `20` | Maximum submissions per user per window; allowed range 1–10000. |

`DB_FILE=./data/challenge_portal.sqlite` resolves to `<project>/server/data/challenge_portal.sqlite`; `UPLOAD_DIR=./storage` resolves to `<project>/server/storage`. Neither file storage area is web-served. `npm run db:inspect` reports the resolved database path, safe table names, and row counts; it does not print session data, hashes, or answers.

Password environment values are needed when creating missing seed accounts. Rerunning seed preserves existing passwords, roles, active flags, edited challenge content, attachments, attempts, and completions. Changing a seed password setting does **not** reset an existing account password. No reset or account-management feature is included.

Secure cookies, Helmet HSTS, and `upgrade-insecure-requests` follow the HTTP/HTTPS protocol in `APP_ORIGIN`. Local HTTP remains usable with `NODE_ENV=production`. Proxy trust is deliberately disabled for this local single-server setup; there is no wildcard CORS. Do not add frontend `VITE_` variables for server secrets.

## Built interview demo

Stop the development processes. In `server/.env`, set:

```dotenv
NODE_ENV=production
APP_ORIGIN=http://localhost:3000
```

Keep the same `DB_FILE`, `UPLOAD_DIR`, and `SESSION_SECRET`. Then run:

```powershell
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). Express serves `client/dist` and the API. Refresh a nested route such as `/challenges/1` or `/admin/challenges/1/edit`; React routes load through the Express 5 compatible fallback. Unknown `/api` routes return a JSON 404. To return to development, restore `NODE_ENV=development` and `APP_ORIGIN=http://localhost:5173`.

Use the same hostname consistently; `localhost` and `127.0.0.1` have different origins and cookies. Do not run development and built servers on port 3000 simultaneously.

## Commands

| Command | Action |
| --- | --- |
| `npm install` | Install all root-managed dependencies and retain `package-lock.json`. |
| `npm run dev` | Start Express and Vite together. |
| `npm run build` | Build React into `client/dist`. |
| `npm start` | Start the Express local demo server. |
| `npm run db:migrate` | Apply tracked SQL migrations without resetting data. |
| `npm run db:seed` | Insert missing demo fixtures only. |
| `npm run db:inspect` | Show safe database table counts and the resolved file path. |
| `npm run db:backup -- ./data/backups/interview.sqlite` | Create a consistent SQLite backup; refuse an existing destination. |
| `npm test` | Run UI tests, then API, database, and session-store tests. |
| `npm run test:ui` | Run focused React behavior tests. |
| `npm run test:api` | Run file-backed SQLite acceptance and session/database tests. |

## Testing and verification

See [VERIFICATION.md](VERIFICATION.md) for actual test/build results, the browser walkthrough, and the download verification limitation.

```powershell
npm test
npm run build
```

No test database setup or demo credentials are required. Tests create a dedicated temporary directory, an explicit file-backed `DB_FILE`, separate upload storage, a random session secret, and disposable test account passwords. Before opening the database they verify that its resolved path differs from the configured demo database. Cleanup closes stores and connections, verifies the exact owned temporary path, and removes only that directory. Tests never truncate, reset, or open the demo database. Real SQLite, Argon2, prepared SQL, sessions, and HTTP routes are used.

API coverage includes guest/role bypasses, deactivated accounts, strict answer types and unchanged text, Unicode comparison, CSRF/Origin failures, concurrent duplicate success, independent progress, hiding/republishing, answer-edit history, upload/download validation, attachment preservation after rejection, safe response fields, rate limits, logout, and persistence after closing/reopening the file and application. Race tests change visibility or the answer hash while asynchronous verification is pending. A trigger forces a completion-write error to prove the attempt rolls back and the response is a retryable service error.

Session tests cover restoration, expiry, maxAge, `touch` without revival, destruction, cleanup timers, JSON errors, database errors, and exactly-once callbacks. Database tests cover path isolation, repeatable migrations, missing seed-password failure, schema constraints, and consistent live WAL backups. The browser rehearsal is described in `DEMO_GUIDE.md`; automated component tests do not replace a visual browser check.

## Implementation and API contracts

```text
client/src/                 React routes, forms, authentication, API client, CSS
server/src/                 Express application, validation, hashes, files, database, session store
server/migrations/          Versioned SQLite SQL
server/scripts/             Migrate, seed, inspect, backup
server/samples/             Harmless source sample attachment
server/data/                Private persistent SQLite file and WAL/SHM sidecars (ignored)
server/storage/             Private uploaded files (ignored)
tests/                      Real API, database, and session-store acceptance tests
```

The server stores only Argon2id password and expected-answer hashes. A user answer is a single-line string of 1–200 characters, rejects whitespace-only input, and is otherwise verified unchanged. Expected answers authored by an admin additionally reject leading/trailing whitespace. Submitted answers and passwords are never logged or stored as plaintext. The intentionally public demo answers exist only in server seed/sample content and the demo guide.

Answer verification awaits Argon2 before entering a short synchronous `BEGIN IMMEDIATE` transaction. The transaction rechecks publication and the answer-hash snapshot, inserts the attempt, inserts a unique completion with `ON CONFLICT(user_id, challenge_id) DO NOTHING`, reads final progress, and commits before sending success. A hidden challenge yields 404; a changed answer yields 409 with “Challenge changed. Refresh and try again.” Failed writes yield a retryable service error. Later wrong attempts never remove completion.

Every database connection enables foreign keys, WAL, and a 5000 ms busy timeout. Use one Express process and persistent local disk. SQLite work is synchronous and suited to this small demo; do not run the database from a network share.

| Endpoint | Access and behavior |
| --- | --- |
| `GET /api/health` | Public health; 503 if the database cannot be read. |
| `GET /api/auth/csrf` | Public session-bound token; `no-store`. |
| `POST /api/auth/login` | Username/password; rotates session and CSRF token. |
| `GET /api/auth/me` | Signed-in safe user `{ id, username, role }`. |
| `POST /api/auth/logout` | Destroys session; 204. |
| `GET /api/challenges` | Published summaries and the signed-in user's progress. |
| `GET /api/challenges/:id` | Published detail and safe attachment metadata. |
| `POST /api/challenges/:id/attempts` | USER only, JSON `{ "answer": "text" }`; no extra body fields. |
| `GET /api/challenges/:id/attachment` | Authorized download; ADMIN may download drafts. |
| `GET /api/admin/challenges` | ADMIN list including drafts. |
| `GET /api/admin/challenges/:id` | ADMIN editable metadata, never an answer/hash. |
| `POST /api/admin/challenges` | ADMIN create; 201, draft by default. |
| `PATCH /api/admin/challenges/:id` | ADMIN allowlisted metadata, answer, and visibility updates. |
| `POST /api/admin/challenges/:id/attachment` | ADMIN multipart with one `file` field; replaces safely. |
| `DELETE /api/admin/challenges/:id/attachment` | ADMIN removes attachment; 204. |

All mutations require both the configured `Origin` and `X-CSRF-Token`. Responses use `{ user }`, `{ challenges }`, or `{ challenge }` envelopes as applicable. Login also returns `csrfToken`. Errors use `{ error: { code, message } }`. Valid answers return `{ correct, message, status }`; invalid input returns 400. The frontend fetches fresh anonymous CSRF tokens at initialization, logout, and expiry, and adopts the new token returned by login.

Session cookies are HttpOnly, SameSite=Lax, path `/`, and have an eight-hour expiry. The tested SQLite store persists JSON session data, touches only existing unexpired sessions, and periodically removes expired rows. Authentication and authenticated responses use `Cache-Control: no-store`.

TXT uploads require valid UTF-8 plain text without binary/NUL content; PDFs require a PDF signature. Only one TXT/PDF of at most 5 MiB is accepted. Files receive random server filenames, sanitized display names, and forced-download headers. Upload handling runs after authorization, and a failed replacement preserves the old file. Files are never executed or extracted.

## Backup and data preservation

Use the provided SQLite backup API command while the database is live:

```powershell
npm run db:backup -- ./data/backups/interview.sqlite
```

The destination resolves against `server/`. Existing destinations, the source database itself, and destinations inside `client/` are rejected. Omit the destination for a timestamped private backup. Do not copy only the main `.sqlite` file while WAL is active: recent committed data may be in its `-wal` sidecar. Keep `.sqlite`, `-wal`, `-shm`, `.env`, and uploads out of version control.

Back up `UPLOAD_DIR` alongside the database, pausing content edits while coordinating both copies. To restore, stop the application, preserve the current database and storage, place the selected backup at a new private path, restore the matching attachment directory, update `DB_FILE`/`UPLOAD_DIR`, and restart. Keep the matching session secret to retain unexpired sessions, or change it intentionally to require a fresh login. Never delete existing data simply to rerun seed.

The earlier PostgreSQL draft is retained under `server/legacy-postgresql/` for reference and is not used by any active script. The switch did not import PostgreSQL records; existing PostgreSQL databases were not modified. Any previously used PostgreSQL instance needs a separate data migration if records must be retained. Sign in again after switching database engines.

## Common errors

| Symptom | Check/action |
| --- | --- |
| `SESSION_SECRET must ...` | Generate 32 random bytes locally and replace the placeholder in `server/.env`. |
| `SEED_*_PASSWORD must ...` | Set the missing account's local password (8–128 characters), then rerun seed. Existing accounts are unchanged. |
| Cannot open database | Check the resolved `DB_FILE`, writable parent folder, local disk, and permissions. |
| `no such table` or unhealthy database | Use the intended `DB_FILE` and run `npm run db:migrate`. |
| Database locked / retryable service error | Close competing writer tools, use one server process, and retry after cooldown. Keep transactions short. |
| Native module load/install failure | Confirm Node 24 and matching OS/CPU. Reinstall dependencies under that runtime; ensure package downloads are allowed. Do not substitute an in-memory database. |
| Login always fails | Check the username and the password originally seeded. Changing `.env` later does not reset the stored password. |
| Login works but the next call returns 401 | Keep hostname/origin consistent; verify cookie protocol, stable session secret, and writable database. |
| Mutation returns 403 | Confirm account role, exact `APP_ORIGIN`, and fresh session CSRF token. Reload after changing origin or logging in. |
| 409 during submission | The admin changed the answer during verification. Refresh the question and retry. |
| 429 | Wait for the displayed `Retry-After` interval; do not repeatedly submit during cooldown. |
| Port already in use | Stop the earlier development/built process before starting another. |
| Vite API/network error | Start both processes with `npm run dev`; keep the backend on port 3000 and calls relative to `/api`. |
| Built nested route does not load | Run `npm run build`, then `npm start`; open port 3000. |
| Download unavailable | Confirm challenge visibility and that the private stored file exists; preserve attachments with backups. |

Public hosting is outside this local demo. No payments, virtual machines, VPNs, scores, leaderboards, timers, emails, or public registration are included.
