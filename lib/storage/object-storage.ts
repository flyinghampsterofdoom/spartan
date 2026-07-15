import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export class ObjectStorageConfigurationError extends Error {
  constructor() { super("Attachment storage is not configured."); this.name = "ObjectStorageConfigurationError"; }
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string, metadata?: Record<string, string>): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType?: string }>;
  delete(key: string): Promise<void>;
}

let storage: ObjectStorage | undefined;

export function isObjectStorageConfigured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}

export function getObjectStorage(): ObjectStorage {
  if (storage) return storage;
  if (!isObjectStorageConfigured()) throw new ObjectStorageConfigurationError();
  const bucket = process.env.R2_BUCKET_NAME!;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  storage = {
    async put(key, body, contentType, metadata) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error("Stored object has no body.");
      return { body: await result.Body.transformToByteArray(), contentType: result.ContentType };
    },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
  return storage;
}

export function setObjectStorageForTests(value: ObjectStorage | undefined) { storage = value; }
