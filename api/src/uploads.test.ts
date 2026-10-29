import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, makeUploadHandler, uploadPolicy } from "./uploads";

describe("POST /api/uploads", () => {
  it("hands out a one-time link for a random img/<id>.jpg key and returns the image's path", async () => {
    const keys: string[] = [];
    const handler = makeUploadHandler({
      presign: async (key) => {
        keys.push(key);
        return { url: "https://bucket.s3.amazonaws.com/", fields: { key } };
      },
      newId: () => "0b7c7d8e-1111-4222-8333-944445555666",
    });
    const res = (await handler()) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(201);
    expect(keys).toEqual(["img/0b7c7d8e-1111-4222-8333-944445555666.jpg"]);
    expect(JSON.parse(res.body)).toEqual({
      url: "https://bucket.s3.amazonaws.com/",
      fields: { key: "img/0b7c7d8e-1111-4222-8333-944445555666.jpg" },
      path: "/img/0b7c7d8e-1111-4222-8333-944445555666.jpg",
    });
  });

  it("only lets S3 accept that key, as a JPEG of at most 3 MB, for 5 minutes", () => {
    const policy = uploadPolicy("site-bucket", "img/x.jpg");
    expect(policy).toMatchObject({ Bucket: "site-bucket", Key: "img/x.jpg", Expires: 300 });
    expect(policy.Conditions).toContainEqual(["content-length-range", 1, MAX_UPLOAD_BYTES]);
    expect(policy.Fields).toMatchObject({ "Content-Type": "image/jpeg" });
  });
});
