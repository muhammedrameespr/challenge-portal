import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink, stat } from 'node:fs/promises';
import { HttpError } from './validation.js';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export function storagePath(uploadDir, name) {
  if (!/^[a-f0-9-]{36}\.(txt|pdf)$/.test(name ?? '')) throw new HttpError(404, 'FILE_NOT_FOUND', 'Attachment unavailable.');
  const root = path.resolve(uploadDir);
  const candidate = path.resolve(root, name);
  if (path.dirname(candidate) !== root) throw new HttpError(404, 'FILE_NOT_FOUND', 'Attachment unavailable.');
  return candidate;
}
export function validateFile(file) {
  if (!file || !file.buffer || file.size === 0) throw new HttpError(400, 'INVALID_FILE', 'Choose one nonempty TXT or PDF file.');
  if (file.size > MAX_FILE_SIZE) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files must be 5 MiB or smaller.');
  const name = file.originalname.replaceAll('\\', '/').split('/').pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180);
  const ext = path.extname(name).toLowerCase();
  let valid = false;
  if (ext === '.pdf' && file.mimetype === 'application/pdf') {
    valid = /^%PDF-[12]\.[0-9]/.test(file.buffer.subarray(0, 8).toString('latin1'));
  } else if (ext === '.txt' && file.mimetype === 'text/plain') {
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      valid = !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content);
    } catch { valid = false; }
  }
  if (!valid) throw new HttpError(415, 'UNSUPPORTED_FILE', 'Upload valid UTF-8 plain text (.txt) or a PDF (.pdf).');
  return { name: name || `attachment${ext}`, mime: ext === '.pdf' ? 'application/pdf' : 'text/plain', storageName: `${randomUUID()}${ext}`, size: file.size };
}
export async function saveFile(uploadDir, file, metadata) {
  await mkdir(uploadDir, { recursive: true });
  const filePath = storagePath(uploadDir, metadata.storageName);
  // Opening exclusively proves ownership. If opening fails, never remove a file
  // that was already there; if writing fails, remove our own partial upload.
  const handle = await open(filePath, 'wx', 0o600);
  try { await handle.writeFile(file.buffer); await handle.close(); }
  catch (error) {
    await handle.close().catch(() => {});
    await unlink(filePath).catch(() => {});
    throw error;
  }
}
export async function removeFile(uploadDir, name) {
  if (!name) return;
  try { await unlink(storagePath(uploadDir, name)); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Private attachment cleanup failed.'); }
}
export async function existingFile(uploadDir, name) {
  const filePath = storagePath(uploadDir, name);
  try { if (!(await stat(filePath)).isFile()) throw new Error(); }
  catch { throw new HttpError(404, 'FILE_NOT_FOUND', 'Attachment unavailable.'); }
  return filePath;
}
