# Challenge Portal interview demo

Use the current SQLite application and a local browser. The three demo account passwords are the values you chose privately in `server/.env`; this guide intentionally contains no credentials.

## Prepare

1. Verify Node.js 24 LTS and install dependencies with `npm install`.
2. Fill missing local settings in `server/.env`: a generated session secret and `SEED_ADMIN_PASSWORD`, `SEED_USER1_PASSWORD`, `SEED_USER2_PASSWORD`.
3. Run `npm run db:migrate`, `npm run db:seed`, and `npm run db:inspect`.
4. Run `npm test` and `npm run build`.
5. For the built demo, set `NODE_ENV=production` and `APP_ORIGIN=http://localhost:3000`, then run `npm start` and open [http://localhost:3000](http://localhost:3000). For development, use `NODE_ENV=development`, `APP_ORIGIN=http://localhost:5173`, and `npm run dev`.

Do not delete the database or rerun a destructive reset before presenting. Seed safely inserts missing fixtures; it preserves earlier edits and progress. If you previously solved a challenge, its status will already be Completed, even when you demonstrate a wrong answer.

## Five-minute walkthrough

1. **Sign in as `user1`.** Show the username, three published challenge cards, difficulties, and progress. Authentication has no role selector.
2. **Open “Challenge 1: Find the code”.** Read the multiline question, download `challenge-1.txt`, and open the harmless text file. Enter `124`: “Fail. Incorrect answer. Try again.” Enter `123`: “Success! Correct answer.” The result remains beside the form.
3. **Show persistence.** Return to the list and refresh; the challenge remains Completed. Sign out and sign in again. If time permits, stop and restart the server with the same database and secret, then reload; unexpired sessions and completion remain.
4. **Sign in as `user2`.** Explain that this account's progress is independent. An existing completion on `user1` does not complete the challenge for `user2`.
5. **Sign in as `admin`.** Create a draft with one question and one expected answer. Preview it, add an optional TXT/PDF attachment, and publish it. Return as a User and show the new challenge. Hide it and show that its direct URL is unavailable to Users; republish to recover prior completion.
6. **Show the architecture.** React calls relative `/api` routes; Express verifies answers with Argon2id and stores attempts, unique completions, and sessions in SQLite. Run `npm run db:inspect` for safe table counts. Keep `.env`, hashes, and session data off the shared screen.

## Intentionally public demo answers

| Seed challenge | Correct answer | Examples that fail |
| --- | --- | --- |
| Challenge 1: Find the code | `123` | `124`, `0123`, ` 123`, `123 ` |
| Challenge 2: Capital letters | `HELLO` | `hello`, `Hello` |
| Challenge 3: Build a flag | `flag{demo_success}` | `FLAG{demo_success}`, `flag{demo_success} ` |

These are demo fixtures, not production secrets. Answers are exact case-sensitive strings. The answer input is single-line text; whitespace is not trimmed and numeric JSON input is rejected. Empty, whitespace-only, multiline, and over-200-character input is invalid. Existing completion survives later wrong answers and admin edits.

## Admin form rehearsal

Create a short original challenge using title, summary, multiline question, expected answer, difficulty, and display order. New challenges start as drafts unless published is selected. Title is 3–100 characters, summary 1–240, question 1–5000, expected answer 1–200, and order 0–9999. Whitespace-only fields and expected answers with outer whitespace are rejected.

On edit, leave “New expected answer — leave blank to keep current” empty to preserve the existing answer. Neither the prior answer nor its hash is returned to the browser. Replacing an answer or question preserves completion and attempt history; create a new challenge when everyone should solve a new task.

Attach one `.txt` or `.pdf` up to 5 MiB. Try an invalid file and show that the previous attachment remains available. Downloads are authorized by challenge ID and forced as attachments; private random storage filenames never appear in the API. Remove the attachment through the admin form to show that the download block disappears.

## Browser checks before presenting

- Use the keyboard to sign in, navigate, type an answer, submit with Enter, and sign out; confirm labels and visible focus.
- Check the login show-password control and generic invalid-login message.
- Check a narrow window: one column, readable text, reachable buttons, and no clipped forms.
- Refresh `/challenges/1` in the built app; verify it loads and restores the session.
- Confirm success/wrong feedback persists, submissions disable while busy, and progress refreshes.
- Open an admin URL as a User and a protected URL after logout; verify access is denied or redirected.
- Stop the server while a challenge is open and submit once; the UI must show “Could not check your answer. Please retry.” Restart and retry. Do not present that service error as an incorrect answer.
- Use the browser Network panel to inspect challenge responses: no expected-answer/hash fields, database paths, or other users' progress. Inspect ordinary response fields only; do not reveal session tokens on a shared display.

## Automated evidence

`npm test` runs focused React tests and a real file-backed SQLite acceptance suite. The suite covers A01–A20 API behavior, exact matching including Unicode, CSRF and roles, concurrent attempts, history, downloads, failed upload preservation, actual file close/reopen, session lifecycle, rate limits, and rollback on a forced database write failure. Additional tests cover live WAL backups and safe database paths. Each test database and upload directory is created in an owned temporary folder, distinct from the demo database.

The write-failure test installs a failing trigger only in its disposable test database; it does not sabotage the demo. Race tests change a challenge during asynchronous answer verification and prove 404/409 results save no attempt. `npm run build` verifies the production client bundle; use the browser checks above to verify the actual local presentation.

## Recovery during the interview

If sign-in fails, use the original locally seeded password; rerunning seed or editing the environment will not change an existing password. If a request gets 403, check that `APP_ORIGIN` matches the browser port and reload to refresh the CSRF session. For 429, wait for the retry interval. For a service error, confirm the server is running and the private database is writable, then retry.

For a consistent database backup, use `npm run db:backup -- ./data/backups/interview.sqlite` with a new destination and preserve the matching upload directory. Keep the database, attachments, and stable session secret between restarts. No external database installation or internet connection is needed once dependencies are installed.
