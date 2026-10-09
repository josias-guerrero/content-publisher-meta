import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt } from './crypto.js';
import crypto from 'node:crypto';
import { config } from '../config.js';

describe('Crypto Utility', () => {
  beforeAll(() => {
    // Generate a valid key for tests if not provided
    if (
      !config.TOKEN_ENCRYPTION_KEY ||
      config.TOKEN_ENCRYPTION_KEY.length !== 64
    ) {
      config.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    }
  });

  it('should encrypt and decrypt correctly', () => {
    const plaintext = 'test-token-12345';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':').length).toBe(4); // keyId:iv:authTag:ciphertext

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should generate different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-token';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it('should throw an error for invalid encrypted format', () => {
    expect(() => decrypt('invalid-format-string')).toThrow(
      'Invalid encrypted text format',
    );
  });

  it('should fail decryption if auth tag is modified', () => {
    const plaintext = 'secret-data';
    const encrypted = encrypt(plaintext);

    const parts = encrypted.split(':');
    // Modify auth tag
    const fakeAuthTag = crypto.randomBytes(16).toString('base64');
    const corrupted = `${parts[0]}:${parts[1]}:${fakeAuthTag}:${parts[3]}`;

    expect(() => decrypt(corrupted)).toThrow(); // Should throw auth tag validation error
  });
});

it('reads legacy ciphertext and rotates versioned keys without loss', () => {
  const saved = {
    key: config.TOKEN_ENCRYPTION_KEY,
    id: config.TOKEN_ENCRYPTION_KEY_ID,
    previous: config.TOKEN_PREVIOUS_KEYS,
  };
  const encrypted = encrypt('preserved');
  expect(decrypt(encrypted.split(':').slice(1).join(':'))).toBe('preserved');
  try {
    config.TOKEN_PREVIOUS_KEYS = JSON.stringify({
      [saved.id]: saved.key,
      legacy: saved.key,
    });
    config.TOKEN_ENCRYPTION_KEY_ID = 'v2';
    config.TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(decrypt(encrypted)).toBe('preserved');
    expect(decrypt(encrypt(decrypt(encrypted)))).toBe('preserved');
  } finally {
    config.TOKEN_ENCRYPTION_KEY = saved.key;
    config.TOKEN_ENCRYPTION_KEY_ID = saved.id;
    config.TOKEN_PREVIOUS_KEYS = saved.previous;
  }
});
