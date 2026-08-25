import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// Derives a stable 32-byte AES key from AUTOMATION_ENCRYPTION_KEY via SHA-256
// so the env var can be any string (a passphrase, `openssl rand -base64 32`
// output, anything) rather than requiring an exact-length/encoding value.
function getKey() {
  const raw = process.env.AUTOMATION_ENCRYPTION_KEY;
  if (!raw) throw new Error('AUTOMATION_ENCRYPTION_KEY is not set — required to store per-user automation credentials');
  return createHash('sha256').update(raw).digest();
}

/**
 * Encrypts a secret (a user's GitHub token, a generated webhook secret) for
 * storage at rest — installations.js never writes plaintext credentials to
 * the database. AES-256-GCM: iv + auth tag + ciphertext, base64-packed.
 */
export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptSecret(payload) {
  const key = getKey();
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
