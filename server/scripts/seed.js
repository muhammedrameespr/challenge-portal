import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, serverRoot, validateSeedPassword } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { hashSecret } from '../src/hash.js';

const accounts = [
  { key: 'demo:admin', username: 'admin', role: 'ADMIN', passwordKey: 'admin', envKey: 'SEED_ADMIN_PASSWORD' },
  { key: 'demo:user1', username: 'user1', role: 'USER', passwordKey: 'user1', envKey: 'SEED_USER1_PASSWORD' },
  { key: 'demo:user2', username: 'user2', role: 'USER', passwordKey: 'user2', envKey: 'SEED_USER2_PASSWORD' },
];

// These intentionally public demonstration answers are server seed fixtures.
const challenges = [
  {
    key: 'demo:challenge1', title: 'Challenge 1: Find the code',
    summary: 'Download the sample file and find its three-character code.',
    question: 'Download the attached challenge-1.txt file.\nFind the three-character code and enter it exactly below.',
    answer: '123', difficulty: 'easy', order: 1,
  },
  {
    key: 'demo:challenge2', title: 'Challenge 2: Capital letters',
    summary: 'Practice matching the capitalization of a short greeting.',
    question: 'Enter the five-letter English greeting in uppercase.\nCapitalization matters.',
    answer: 'HELLO', difficulty: 'easy', order: 2,
  },
  {
    key: 'demo:challenge3', title: 'Challenge 3: Build a flag',
    summary: 'Combine a flag prefix, braces, and the supplied message.',
    question: 'Build a flag using this format: the word flag followed by curly braces.\nInside the braces, put demo_success. Do not add spaces.',
    answer: 'flag{demo_success}', difficulty: 'medium', order: 3,
  },
];

export async function seed(db, config) {
  const fixture = db.prepare('SELECT user_id, challenge_id FROM seed_fixtures WHERE fixture_key = ?');
  const byUsername = db.prepare('SELECT id FROM users WHERE username = ?');
  const accountHashes = new Map();
  const answerHashes = new Map();
  let preparedAttachment;
  let attachmentCommitted = false;

  try {
    // Argon2 and filesystem I/O happen before the short synchronous transaction.
    for (const account of accounts) {
      if (!fixture.get(account.key) && !byUsername.get(account.username)) {
        const password = validateSeedPassword(config.seedPasswords?.[account.passwordKey], account.envKey);
        accountHashes.set(account.key, await hashSecret(password));
      }
    }
    for (const challenge of challenges) {
      if (!fixture.get(challenge.key)) answerHashes.set(challenge.key, await hashSecret(challenge.answer));
    }
    if (!fixture.get(challenges[0].key)) {
      await mkdir(config.uploadDir, { recursive: true });
      const bytes = await readFile(path.join(serverRoot, 'samples', 'challenge-1.txt'));
      const storageName = `${randomUUID()}.txt`;
      const filePath = path.join(config.uploadDir, storageName);
      const file = await open(filePath, 'wx');
      preparedAttachment = { storageName, filePath, size: bytes.length };
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
    }

    const result = db.transaction(() => {
      const stats = { accountsCreated: 0, challengesCreated: 0 };
      const userIds = new Map();
      const addAccount = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
      const addUserFixture = db.prepare('INSERT INTO seed_fixtures (fixture_key, user_id) VALUES (?, ?)');
      const addChallengeFixture = db.prepare('INSERT INTO seed_fixtures (fixture_key, challenge_id) VALUES (?, ?)');

      for (const account of accounts) {
        const existing = fixture.get(account.key);
        if (existing) {
          userIds.set(account.key, existing.user_id);
          continue;
        }
        let id = byUsername.get(account.username)?.id;
        if (!id) {
          const hash = accountHashes.get(account.key);
          if (!hash) throw new Error('Seed account changed during preparation; retry the seed command.');
          id = Number(addAccount.run(account.username, hash, account.role).lastInsertRowid);
          stats.accountsCreated += 1;
        }
        // Adopt an existing username without changing its password, role, or state.
        addUserFixture.run(account.key, id);
        userIds.set(account.key, id);
      }

      const addChallenge = db.prepare(`INSERT INTO challenges (
        title, summary, question, answer_hash, difficulty, display_order, is_published, created_by,
        attachment_storage_name, attachment_original_name, attachment_mime, attachment_size
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`);
      for (const challenge of challenges) {
        if (fixture.get(challenge.key)) continue;
        const hash = answerHashes.get(challenge.key);
        if (!hash) throw new Error('Seed challenge changed during preparation; retry the seed command.');
        const attachment = challenge.key === challenges[0].key ? preparedAttachment : null;
        const id = Number(addChallenge.run(
          challenge.title, challenge.summary, challenge.question, hash, challenge.difficulty,
          challenge.order, userIds.get('demo:admin'), attachment?.storageName ?? null,
          attachment ? 'challenge-1.txt' : null, attachment ? 'text/plain' : null, attachment?.size ?? null,
        ).lastInsertRowid);
        addChallengeFixture.run(challenge.key, id);
        if (attachment) attachmentCommitted = true;
        stats.challengesCreated += 1;
      }
      return stats;
    }).immediate();
    return result;
  } catch (error) {
    attachmentCommitted = false;
    throw error;
  } finally {
    // A competing seed may have inserted the fixture while hashing was running.
    if (preparedAttachment && !attachmentCommitted) {
      await unlink(preparedAttachment.filePath).catch(() => {});
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  try {
    const config = loadConfig();
    db = createDatabase(config);
    const result = await seed(db, config);
    console.log(`Seed complete: ${result.accountsCreated} account(s) and ${result.challengesCreated} challenge(s) created. Existing data preserved.`);
  } catch (error) {
    if ((!db && !error.code) || error.message.startsWith('SEED_')) console.error(error.message);
    else console.error('Seed failed. Run migrations first and check local database, storage permissions, and seed password settings.');
    process.exitCode = 1;
  } finally {
    if (db?.open) db.close();
  }
}
