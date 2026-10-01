import argon2 from 'argon2';

export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

export function hashSecret(value) {
  return argon2.hash(value, ARGON2_OPTIONS);
}

export function verifySecret(hash, value) {
  // Keep input bytes exact: no trimming, case conversion, or normalization.
  return argon2.verify(hash, value);
}
