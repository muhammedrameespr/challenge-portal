CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username varchar(30) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,30}$'),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'USER')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE challenges (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title varchar(100) NOT NULL,
  summary varchar(240) NOT NULL,
  question text NOT NULL,
  answer_hash text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  display_order integer NOT NULL CHECK (display_order BETWEEN 0 AND 9999),
  is_published boolean NOT NULL DEFAULT false,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  attachment_storage_name text,
  attachment_original_name text,
  attachment_mime text,
  attachment_size integer,
  CONSTRAINT challenge_attachment_complete CHECK (
    (attachment_storage_name IS NULL AND attachment_original_name IS NULL
      AND attachment_mime IS NULL AND attachment_size IS NULL)
    OR
    (attachment_storage_name IS NOT NULL AND attachment_original_name IS NOT NULL
      AND attachment_mime IS NOT NULL AND attachment_size IS NOT NULL)
  ),
  CONSTRAINT challenge_attachment_size CHECK (attachment_size BETWEEN 0 AND 5242880),
  CONSTRAINT challenge_attachment_mime CHECK (attachment_mime IN ('text/plain', 'application/pdf'))
);

CREATE INDEX challenges_publication_order_idx ON challenges (is_published, display_order, id);

CREATE TABLE attempts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  challenge_id integer NOT NULL REFERENCES challenges(id),
  is_correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attempts_user_challenge_created_idx ON attempts (user_id, challenge_id, created_at);

CREATE TABLE completions (
  user_id integer NOT NULL REFERENCES users(id),
  challenge_id integer NOT NULL REFERENCES challenges(id),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, challenge_id)
);

-- Fixture identities remain stable even when a challenge's title/content changes.
CREATE TABLE seed_fixtures (
  fixture_key text PRIMARY KEY,
  user_id integer REFERENCES users(id),
  challenge_id integer REFERENCES challenges(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(user_id, challenge_id) = 1)
);
