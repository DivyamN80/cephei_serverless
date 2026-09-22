// Real (not simulated) AES-256-GCM encryption for per-project environment
// variables — see routes/projects.js's /secrets endpoints.
//
// What this does and does not guarantee: values are encrypted at rest with
// a server-held key, and there is deliberately no API route anywhere that
// returns a decrypted value once it's been saved — only the internal
// deploy-simulation code path (simulateBackendDeploy's caller) ever calls
// decryptSecret(). That means nobody can read a saved value through the
// product — not other customers, not an admin browsing the dashboard, not
// a support engineer looking at the database export. It is NOT a
// zero-knowledge / client-side-encryption design: the server holds the key,
// because a real deploy pipeline has to inject the real value into the
// running function. Anyone with production access to both the database
// AND this server's SECRETS_ENCRYPTION_KEY could still decrypt — same
// caveat as every mainstream secrets manager (AWS Secrets Manager, Vercel,
// Render, etc.) that isn't doing client-side E2E encryption.
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size

function getKey() {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('SECRETS_ENCRYPTION_KEY is not set in the environment');
  }
  // Accepts any passphrase string (like JWT_SECRET) rather than requiring
  // an exact 32-byte value — hashed down to a fixed-length AES-256 key.
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecretValue(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecretValue({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// A display-only stand-in for a value that is never sent back to the
// client in the clear — e.g. "••••••••1a2b" style previews shown by real
// secret managers, without ever exposing the plaintext.
export function maskedPreview(plaintext) {
  const str = String(plaintext);
  const tail = str.slice(-4);
  return `${'•'.repeat(8)}${str.length > 4 ? tail : ''}`;
}
