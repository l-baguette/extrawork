import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '@extrawork/contracts';
import {
  assertSafeKey,
  type DownloadOptions,
  type ObjectMetadata,
  type ObjectStore,
  type PresignedUpload,
  type UploadRequest,
} from './object-store.js';

/**
 * S3-compatible driver (AWS S3, MinIO, Cloudflare R2, Backblaze B2).
 *
 * Report §9.7: buckets are private and the application issues short-lived
 * signed URLs. No method here ever makes an object public.
 */

export interface S3StoreOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StoreOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async createUpload(command: UploadRequest): Promise<PresignedUpload> {
    assertSafeKey(command.key);
    const put = new PutObjectCommand({
      Bucket: this.bucket,
      Key: command.key,
      ContentType: command.contentType,
      ContentLength: command.byteSize,
    });
    const url = await getSignedUrl(this.client, put, { expiresIn: command.ttlSeconds });
    return {
      url,
      method: 'PUT',
      headers: {
        'Content-Type': command.contentType,
        'Content-Length': String(command.byteSize),
      },
      expiresAt: new Date(Date.now() + command.ttlSeconds * 1000),
    };
  }

  async createDownload(
    key: string,
    ttlSeconds: number,
    filename?: string,
    options: DownloadOptions = {},
  ): Promise<string> {
    assertSafeKey(key);
    const name = (filename ?? 'file').replace(/["\\\r\n]/g, '');
    const get = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Forces a download rather than inline rendering of an untrusted file
      // (report §12.2 "restrict serving headers").
      ...(filename || options.forceDownload
        ? { ResponseContentDisposition: `attachment; filename="${name}"` }
        : {}),
      // S3 cannot be asked for `X-Content-Type-Options` per URL, so the
      // equivalent is to override the type itself: opaque bytes are never
      // sniffed into something renderable (spec 2026-10-12, D10).
      ...(options.forceDownload ? { ResponseContentType: 'application/octet-stream' } : {}),
    });
    return getSignedUrl(this.client, get, { expiresIn: ttlSeconds });
  }

  async head(key: string): Promise<ObjectMetadata> {
    assertSafeKey(key);
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        byteSize: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
        versionId: result.VersionId ?? null,
        etag: result.ETag ?? null,
      };
    } catch (error) {
      throw new AppError('NOT_FOUND', {
        message: 'That stored object could not be found.',
        cause: error,
      });
    }
  }

  async get(key: string, maxBytes?: number): Promise<Buffer> {
    assertSafeKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new AppError('NOT_FOUND');
    if (maxBytes !== undefined && (result.ContentLength ?? 0) > maxBytes) {
      (result.Body as { destroy?: () => void }).destroy?.();
      throw new AppError('FILE_TOO_LARGE', {
        details: { maxBytes, actualBytes: result.ContentLength },
      });
    }
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
      throw new AppError('FILE_TOO_LARGE', {
        details: { maxBytes, actualBytes: bytes.byteLength },
      });
    }
    return bytes;
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ versionId: string | null; etag: string | null }> {
    assertSafeKey(key);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { versionId: result.VersionId ?? null, etag: result.ETag ?? null };
  }

  async move(fromKey: string, toKey: string): Promise<{ versionId: string | null }> {
    assertSafeKey(fromKey);
    assertSafeKey(toKey);
    const copy = await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(fromKey)}`,
        Key: toKey,
      }),
    );
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fromKey }));
    return { versionId: copy.VersionId ?? null };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.head(key);
      return true;
    } catch {
      return false;
    }
  }
}
