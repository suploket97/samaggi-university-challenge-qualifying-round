import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { fail, handle, ok, readJson, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const BUCKET = "quiz-media";
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/ogg": "ogg",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const storage = getSupabaseAdmin().storage;
  const { error } = await storage.getBucket(BUCKET);
  if (error) {
    const { error: e2 } = await storage.createBucket(BUCKET, { public: true, fileSizeLimit: "50MB" });
    if (e2 && !/already exists/i.test(e2.message)) throw new Error(`Couldn't create the media storage: ${e2.message}`);
  }
  bucketReady = true;
}

/**
 * Returns a one-time signed upload link. The browser uploads the file straight
 * to Supabase Storage, so large audio/video files don't pass through Vercel.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const denied = await requireAdmin();
    if (denied) return denied;
    const { content_type } = await readJson<{ content_type?: string }>(req);
    const ext = TYPES[String(content_type ?? "")];
    if (!ext) return fail(400, "Use a JPG, PNG, WebP or GIF picture, an MP3/M4A/WAV/OGG sound, or an MP4/WebM video");
    await ensureBucket();
    const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
    const storage = getSupabaseAdmin().storage.from(BUCKET);
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Couldn't prepare the upload: ${error?.message ?? "unknown error"}`);
    const publicUrl = storage.getPublicUrl(path).data.publicUrl;
    return ok({ bucket: BUCKET, path, token: data.token, public_url: publicUrl });
  });
}
