import type { EncryptedPayload } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** `base64Key` must be 32 random bytes encoded as base64 (AES-256), e.g. from `openssl rand -base64 32`. */
async function importKey(base64Key: string): Promise<CryptoKey> {
  const bytes = fromBase64(base64Key);
  if (bytes.length !== 32) throw new Error("ENCRYPTION_KEY must encode exactly 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function importHmacKey(base64Key: string): Promise<CryptoKey> {
  const bytes = fromBase64(base64Key);
  if (bytes.length !== 32) throw new Error("ENCRYPTION_KEY must encode exactly 32 bytes");
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function encrypt(base64Key: string, plaintext: string): Promise<EncryptedPayload> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return { iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) };
}

export async function decrypt(base64Key: string, payload: EncryptedPayload): Promise<string> {
  const key = await importKey(base64Key);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.data),
  );

  return decoder.decode(plaintext);
}

export async function digestPin(base64Key: string, pin: string): Promise<string> {
  const key = await importHmacKey(base64Key);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`pin:${pin}`));
  return toBase64(new Uint8Array(digest));
}
