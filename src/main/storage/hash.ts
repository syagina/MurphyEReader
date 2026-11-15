import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Streams a file through SHA-256 and returns the lowercase 64-character hex
 * digest. Chunked reads keep large PDFs out of memory.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}
