import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Cifra un texto usando AES-256-GCM.
 * Retorna un string en formato base64: "iv:authTag:ciphertext"
 */
export function encrypt(plaintext: string): string {
  const key = Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return `${config.TOKEN_ENCRYPTION_KEY_ID}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Descifra un string generado por encrypt().
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  const keyId = parts.length === 4 ? parts.shift()! : 'legacy';
  const previous = JSON.parse(config.TOKEN_PREVIOUS_KEYS) as Record<
    string,
    string
  >;
  const hex =
    keyId === config.TOKEN_ENCRYPTION_KEY_ID
      ? config.TOKEN_ENCRYPTION_KEY
      : (previous[keyId] ??
        (keyId === 'legacy' ? config.TOKEN_ENCRYPTION_KEY : undefined));
  if (!hex) throw new Error('Unknown encryption key version');
  const key = Buffer.from(hex, 'hex');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
