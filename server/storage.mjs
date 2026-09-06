/**
 * S3-compatible object storage (MinIO / R2 / AWS). Optional until S3_* env is set.
 */
import { PutObjectCommand, GetObjectCommand, S3Client, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

/** @type {S3Client | null} */
let client = null;

export function objectStorageConfigured() {
  return Boolean(
    String(process.env.S3_ENDPOINT || "").trim() &&
      String(process.env.S3_ACCESS_KEY || "").trim() &&
      String(process.env.S3_SECRET_KEY || "").trim() &&
      String(process.env.S3_BUCKET || "").trim(),
  );
}

function getClient() {
  if (!objectStorageConfigured()) return null;
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "0",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
    });
  }
  return client;
}

export function objectBucket() {
  return String(process.env.S3_BUCKET || "").trim();
}

export async function storageHealth() {
  if (!objectStorageConfigured()) return { ok: false, configured: false };
  const s3 = getClient();
  const bucket = objectBucket();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, configured: true, bucket };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Bucket missing — try create once for local MinIO
    if (/NotFound|NoSuchBucket|404/i.test(msg) || err?.$metadata?.httpStatusCode === 404) {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        return { ok: true, configured: true, bucket, created: true };
      } catch (createErr) {
        return {
          ok: false,
          configured: true,
          bucket,
          error: createErr instanceof Error ? createErr.message : String(createErr),
        };
      }
    }
    return { ok: false, configured: true, bucket, error: msg };
  }
}

/**
 * @param {string} key
 * @param {Buffer | Uint8Array | string} body
 * @param {string} [contentType]
 */
export async function putObject(key, body, contentType = "application/octet-stream") {
  const s3 = getClient();
  if (!s3) throw new Error("Object storage is not configured (S3_*)");
  await s3.send(
    new PutObjectCommand({
      Bucket: objectBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { bucket: objectBucket(), key };
}

/**
 * @param {string} key
 * @returns {Promise<{ body: Buffer, contentType: string }>}
 */
export async function getObject(key) {
  const s3 = getClient();
  if (!s3) throw new Error("Object storage is not configured (S3_*)");
  const out = await s3.send(new GetObjectCommand({ Bucket: objectBucket(), Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return {
    body: Buffer.concat(chunks),
    contentType: out.ContentType || "application/octet-stream",
  };
}
