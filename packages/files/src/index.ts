import type { Env } from '@extrawork/config';
import { LocalObjectStore } from './local-store.js';
import type { ObjectStore } from './object-store.js';
import { S3ObjectStore } from './s3-store.js';
import { StructuralScanner, type MalwareScanner } from './scanner.js';

export * from './object-store.js';
export * from './s3-store.js';
export * from './local-store.js';
export * from './validation.js';
export * from './scanner.js';

/** Chooses the storage driver from configuration. */
export function createObjectStore(env: Env): ObjectStore {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3ObjectStore({
      bucket: env.STORAGE_BUCKET,
      region: env.STORAGE_REGION,
      ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
      ...(env.STORAGE_ACCESS_KEY_ID ? { accessKeyId: env.STORAGE_ACCESS_KEY_ID } : {}),
      ...(env.STORAGE_SECRET_ACCESS_KEY ? { secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY } : {}),
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    });
  }
  return new LocalObjectStore({
    root: env.STORAGE_LOCAL_ROOT,
    publicBaseUrl: env.API_PUBLIC_URL,
    signingSecret: env.STORAGE_URL_SECRET,
  });
}

export function createScanner(): MalwareScanner {
  return new StructuralScanner();
}
