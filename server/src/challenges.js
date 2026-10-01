import { HttpError } from './validation.js';
import { verifySecret } from './hash.js';

// Explicit selections prevent hashes or private storage paths from entering response objects.
export const safeColumns = `c.id, c.title, c.summary, c.question, c.difficulty, c.display_order,
 c.is_published, c.created_at, c.updated_at, c.attachment_original_name, c.attachment_size`;
export const progressSql = `CASE WHEN EXISTS (SELECT 1 FROM completions cp WHERE cp.challenge_id=c.id AND cp.user_id=@userId)
 THEN 'completed' WHEN EXISTS (SELECT 1 FROM attempts a WHERE a.challenge_id=c.id AND a.user_id=@userId)
 THEN 'attempted' ELSE 'not_started' END AS status`;
export function safeChallenge(row, { detail = false, admin = false } = {}) {
  const result = { id: row.id, title: row.title, summary: row.summary, difficulty: row.difficulty,
    displayOrder: row.display_order, status: row.status ?? 'not_started' };
  if (detail) {
    result.question = row.question;
    result.attachment = row.attachment_original_name ? { name: row.attachment_original_name,
      sizeBytes: row.attachment_size, downloadUrl: `/api/challenges/${row.id}/attachment` } : null;
  }
  if (admin) Object.assign(result, { isPublished: Boolean(row.is_published), createdAt: row.created_at, updatedAt: row.updated_at });
  return result;
}
export async function submitAttempt(db, userId, challengeId, answer, verifyAnswer = verifySecret) {
  const read = db.prepare('SELECT answer_hash, is_published FROM challenges WHERE id=?');
  const snapshot = read.get(challengeId);
  if (!snapshot?.is_published) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found.');
  // Hash work yields the event loop; no SQLite transaction or write lock is held.
  const correct = await verifyAnswer(snapshot.answer_hash, answer);
  return db.transaction(() => {
    const current = read.get(challengeId);
    if (!current?.is_published) throw new HttpError(404, 'NOT_FOUND', 'Challenge not found.');
    if (current.answer_hash !== snapshot.answer_hash) throw new HttpError(409, 'CHALLENGE_CHANGED', 'Challenge changed. Refresh and try again.');
    const account = db.prepare('SELECT role, is_active FROM users WHERE id=?').get(userId);
    if (!account?.is_active) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    if (account.role !== 'USER') throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this action.');
    db.prepare('INSERT INTO attempts (user_id, challenge_id, is_correct) VALUES (?,?,?)').run(userId, challengeId, correct ? 1 : 0);
    if (correct) db.prepare('INSERT INTO completions (user_id, challenge_id) VALUES (?,?) ON CONFLICT(user_id, challenge_id) DO NOTHING').run(userId, challengeId);
    const completed = db.prepare('SELECT 1 FROM completions WHERE user_id=? AND challenge_id=?').get(userId, challengeId);
    return { correct, message: correct ? 'Success! Correct answer.' : 'Fail. Incorrect answer. Try again.', status: completed ? 'completed' : 'attempted' };
  }).immediate();
}
