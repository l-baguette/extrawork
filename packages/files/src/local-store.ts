import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@extrawork/contracts';
import {
  assertSafeKey,
  type ObjectMetadata,
  type ObjectStore,
  type PresignedUpload,
  type UploadRequest,
} from './object-store.js';

/**
 * Filesystem driver for local development, where running MinIO is not always
 * practical. It preserves the security properties that matter for correctness
 * testing: objects are NOT web-served from disk, and every URL is an
 * HMAC-signed, expiring link that the API itself validates before streaming
 * bytes (see `apps/api` `/v1/files/local/*`).
 *
 * `packages/config` refuses to boot with STORAGE_DRIVER=local in production
 * (report §11.3, §9.7 require real private object storage there).
 */

export interface LocalStoreOptions {
  root: string;
  /** Absolute origin of the API that will serve signed reads and writes. */
  publicBaseUrl: string;
  signingSecret: string;
}

export interface LocalSignaturePayload {
  key: string;
  op: 'get' | 'put';
  expiresAt: number;
  contentType?: string;
  maxBytes?: number;
}

export class LocalObjectStore implements ObjectStore {
  constructor(private readonly options: LocalStoreOptions) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const root = path.resolve(this.options.root);
    const full = path.resolve(root, key);
    // Belt and braces: even with assertSafeKey, never escape the root.
    if (!full.startsWith(`${root}${path.sep}`) && full !== root) {
      throw new AppError('VALIDATION_FAILED', { message: 'Invalid storage key' });
    }
    return full;
  }

  sign(payload: LocalSignaturePayload): string {
    const body = JSON.stringify(payload);
    const encoded = Buffer.from(body, 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.options.signingSecret)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${signature}`;
  }

  /** Used by the API route that serves these URLs. */
  verify(token: string): LocalSignaturePayload {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw new AppError('NOT_FOUND');

    const expected = createHmac('sha256', this.options.signingSecret)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('NOT_FOUND');

    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as LocalSignaturePayload;
    if (payload.expiresAt < Date.now()) {
      throw new AppError('NOT_FOUND', { message: 'That link has expired.' });
    }
    return payload;
  }

  async createUpload(command: UploadRequest): Promise<PresignedUpload> {
    const expiresAt = new Date(Date.now() + command.ttlSeconds * 1000);
    const token = this.sign({
      key: command.key,
      op: 'put',
      expiresAt: expiresAt.getTime(),
      contentType: command.contentType,
      maxBytes: command.byteSize,
    });
    return {
      url: `${this.options.publicBaseUrl.replace(/\/+$/, '')}/v1/files/local/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': command.contentType },
      expiresAt,
    };
  }

  async createDownload(key: string, ttlSeconds: number, filename?: string): Promise<string> {
    assertSafeKey(key);
    const token = this.sign({
      key,
      op: 'get',
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    const suffix = filename ? `?filename=${encodeURIComponent(filename)}` : '';
    return `${this.options.publicBaseUrl.replace(/\/+$/, '')}/v1/files/local/${token}${suffix}`;
  }

  async head(key: string): Promise<ObjectMetadata> {
    const full = this.resolve(key);
    try {
      const info = await stat(full);
      const bytes = await readFile(full);
      return {
        key,
        byteSize: info.size,
        contentType: null,
        versionId: null,
        etag: createHash('md5').update(bytes).digest('hex'),
      };
    } catch (error) {
      throw new AppError('NOT_FOUND', { cause: error });
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      throw new AppError('NOT_FOUND', { cause: error });
    }
  }

  async put(key: string, body: Buffer): Promise<{ versionId: string | null; etag: string | null }> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    return { versionId: null, etag: createHash('md5').update(body).digest('hex') };
  }

  async move(fromKey: string, toKey: string): Promise<{ versionId: string | null }> {
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    return { versionId: null };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
