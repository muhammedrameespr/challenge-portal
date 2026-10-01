CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (
    length(username) BETWEEN 3 AND 30 AND username NOT GLOB '*[^a-z0-9_]*'
  ),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE challenges (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 100),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 240),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 5000),
  answer_hash TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  display_order INTEGER NOT NULL CHECK (display_order BETWEEN 0 AND 9999),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  attachment_storage_name TEXT,
  attachment_original_name TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  CONSTRAINT challenge_attachment_complete CHECK (
    (attachment_storage_name IS NULL AND attachment_original_name IS NULL
      AND attachment_mime IS NULL AND attachment_size IS NULL)
    OR
    (attachment_storage_name IS NOT NULL AND attachment_original_name IS NOT NULL
      AND attachment_mime IS NOT NULL AND attachment_size IS NOT NULL)
  ),
  CONSTRAINT challenge_attachment_size CHECK (attachment_size BETWEEN 0 AND 5242880),
  CONSTRAINT challenge_attachment_mime CHECK (attachment_mime IN ('text/plain', 'application/pdf'))
) STRICT;

CREATE INDEX challenges_publication_order_idx ON challenges (is_published, display_order, id);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  challenge_id INTEGER NOT NULL REFERENCES challenges(id),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX attempts_user_challenge_created_idx ON attempts (user_id, challenge_id, created_at);

CREATE TABLE completions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  challenge_id INTEGER NOT NULL REFERENCES challenges(id),
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, challenge_id)
) STRICT;

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- Fixture identities remain stable even when a challenge's title/content changes.
CREATE TABLE seed_fixtures (
  fixture_key TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER REFERENCES users(id),
  challenge_id INTEGER REFERENCES challenges(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((user_id IS NULL) <> (challenge_id IS NULL))
) STRICT;
