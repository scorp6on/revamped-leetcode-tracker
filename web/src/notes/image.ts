import { api } from "../api";

export const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

// Scales so the longest side is at most `max`, keeping the shape; small images are never enlarged.
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Phone photos are often 3–5 MB; this brings them to a few hundred KB before upload (#51).
export async function shrinkToJpeg(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That image format can't be read here. Try a PNG or JPEG.");
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency; a white ground keeps transparent screenshots readable.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the image."))), "image/jpeg", JPEG_QUALITY),
  );
}

// Asks the API for a one-time link, then sends the image straight to S3 (#52). Returns /img/<id>.jpg.
export async function uploadImage(jpeg: Blob): Promise<string> {
  const res = await api("/api/uploads", { method: "POST" });
  if (!res.ok) throw new Error("Couldn't start the upload.");
  const { url, fields, path } = (await res.json()) as { url: string; fields: Record<string, string>; path: string };

  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", jpeg); // S3 requires the file to come last
  const put = await fetch(url, { method: "POST", body: form });
  if (!put.ok) throw new Error(put.status === 400 ? "That image is too large." : "The upload failed. Try again.");
  return path;
}
