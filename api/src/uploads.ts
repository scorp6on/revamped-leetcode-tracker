import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost, type PresignedPostOptions } from "@aws-sdk/s3-presigned-post";
import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { json } from "./http";

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const UPLOAD_EXPIRES_SECONDS = 300;

// What S3 will accept with the one-time link (#53): this exact key, a JPEG (the browser shrinks
// every image to one first), at most 3 MB, for 5 minutes. Fields are signed as exact matches.
export const uploadPolicy = (bucket: string, key: string): PresignedPostOptions => ({
  Bucket: bucket,
  Key: key,
  Conditions: [["content-length-range", 1, MAX_UPLOAD_BYTES]],
  Fields: {
    "Content-Type": "image/jpeg",
    // The name is random and never reused, so browsers may keep it forever.
    "Cache-Control": "public, max-age=31536000, immutable",
  },
  Expires: UPLOAD_EXPIRES_SECONDS,
});

export interface UploadDeps {
  presign: (key: string) => Promise<{ url: string; fields: Record<string, string> }>;
  newId: () => string;
}

// The browser uploads straight to S3, so image bytes never pass through a Lambda (#52).
export const makeUploadHandler =
  ({ presign, newId }: UploadDeps) =>
  async (): Promise<APIGatewayProxyResultV2> => {
    // An unguessable name (a random UUID) is what keeps the image private (#52).
    const key = `img/${newId()}.jpg`;
    const { url, fields } = await presign(key);
    return json(201, { url, fields, path: `/${key}` });
  };

const s3 = new S3Client({});

export const uploadHandler = makeUploadHandler({
  presign: (key) => createPresignedPost(s3, uploadPolicy(process.env.SITE_BUCKET ?? "", key)),
  newId: randomUUID,
});
