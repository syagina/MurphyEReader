import * as electron from 'electron';

export interface SecretStore {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

const PLAIN_PREFIX = 'plain:';

/**
 * Test-only store. The ciphertext is just the plaintext with a `plain:` prefix,
 * which is enough to assert that callers persist ciphertext rather than plaintext.
 */
export function createPlainTestSecretStore(): SecretStore {
  return {
    encrypt(plain: string): string {
      return PLAIN_PREFIX + plain;
    },
    decrypt(cipher: string): string {
      if (!cipher.startsWith(PLAIN_PREFIX)) {
        throw new Error('Invalid test ciphertext: missing "plain:" prefix');
      }
      return cipher.slice(PLAIN_PREFIX.length);
    },
  };
}

/**
 * Production store backed by Electron `safeStorage` (OS keychain). Ciphertext is
 * persisted as base64 in the settings table. Must only be constructed in the main
 * process after `app` is ready; unit tests use `createPlainTestSecretStore` instead.
 */
export function createSafeStorageSecretStore(): SecretStore {
  return {
    encrypt(plain: string): string {
      return electron.safeStorage.encryptString(plain).toString('base64');
    },
    decrypt(cipher: string): string {
      return electron.safeStorage.decryptString(Buffer.from(cipher, 'base64'));
    },
  };
}
