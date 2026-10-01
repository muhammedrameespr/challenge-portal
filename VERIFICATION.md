# Verification record — 1 October 2026

The SQLite revision is implemented. The previous PostgreSQL draft remains in `server/legacy-postgresql/`; no previous PostgreSQL database was altered or imported. At inspection there was no project database configuration, and `localhost:5432` did not respond. The SQLite demo was seeded separately and must not be described as containing imported PostgreSQL data.

## Commands actually run

- `npm install` for application and development dependencies; root `package-lock.json` retained.
- `npm test` on Node **24.21.0**: **12 UI tests + 35 API/database/session tests passed**, zero failures or skipped tests.
- `npm run build` on Node **24.21.0**: passed; output in `client/dist`.
- `npm audit --omit=dev --audit-level=low`: zero reported runtime dependency vulnerabilities.
- `npm run db:migrate`: passed; rerun reported up to date.
- `npm run db:seed`: created three accounts and three published challenges using locally supplied passwords. Subsequent runs created zero accounts/challenges and preserved existing data.
- `npm run db:inspect`: safe counts and the resolved SQLite path printed successfully.
- `npm run dev`: both Express on 3000 and Vite on 5173 started. `/api/health` through the Vite proxy returned JSON 200; unknown `/api` returned JSON 404.
- Built nested route `/challenges/1` on Express returned HTML 200. Built HTTP headers and cookies do not force HTTPS.
- Foreign key check on the demo database returned zero violations. All three seeded accounts have Argon2id password hashes.
- Searches of active runtime/scripts/migrations found no PostgreSQL adapter/row-lock SQL, and searches of the production client bundle found no server hash fields, session secret settings, or exact flag fixture answer.
- Git ignores local `.env`, SQLite database/sidecars, uploaded files, and verification runtime files.

The installed system Node was 24.19.0. A SHA-256-verified official portable Node 24.21.0 was used for final tests/build and the running development server, without changing the system installation. Its local copy is under ignored `.local/node24`; `.nvmrc` selects 24.21.0 for future setup.

## Browser checks

The built application was exercised against a separate, file-backed SQLite test fixture. Its disposable accounts and progress were kept separate from the real demo database.

- User and Admin login, correct landing pages, and logout worked.
- User dashboard showed three live seeded records.
- `124` displayed the required incorrect-answer result; `123` submitted with Enter displayed the required success result.
- Completion survived a browser reload of the nested challenge route.
- Admin created a draft, left the replacement-answer field empty, published the challenge, and uploaded the harmless TXT sample successfully.
- Desktop layout and the narrow 390-pixel admin layout were inspected; the narrow page had no horizontal overflow.
- The actual development demo rendered its login page through the Vite proxy.

The in-app browser did not expose a download event for the UI's Blob-based download, so a browser-saved file could not be confirmed there. The UI displayed no download error. Automated HTTP tests verified exact sample bytes, forced attachment headers, authentication, hidden challenges, replacement, removal, traversal rejection, missing files, and invalid/oversized uploads. Rehearse the download once in your normal browser before the interview.

## Persistence and safety checks

Automated tests use newly created temporary database and upload paths, explicitly different from the demo paths. They reopen the same file to verify completion and existing-session restoration; concurrently submit correct answers and assert one completion; change publication/hash during Argon2 verification and assert 404/409 without attempts; force a completion write failure and verify transaction rollback; and check role/active status, CSRF/Origin failures, exact strings/types/Unicode, per-user isolation, seed preservation, live WAL backups, and session callbacks/expiry/nonreviving touch.

The real demo contains accounts `admin`, `user1`, and `user2`, three published challenges, and the sample attachment. Use the passwords originally supplied at seed time; later edits or blank seed settings do not reset existing accounts. No test attempts or completions were added to the real demo.
