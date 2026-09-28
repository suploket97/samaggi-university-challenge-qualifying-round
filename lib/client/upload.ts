"use client";
import { api } from "./api";
import { getBrowserSupabase } from "./realtime";

export type MediaKind = "image" | "audio" | "video";

export function kindOf(type: string): MediaKind | null {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return null;
}

/**
 * Shrinks large photos before upload: at most 1600px on the long side, JPEG.
 * Small PNGs and GIFs are kept as they are (transparency, animation).
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  if (file.type === "image/png" && file.size < 1_500_000) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That picture couldn't be opened. Try a JPG or PNG."));
      el.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 1_200_000 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // transparent areas become white rather than black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Uploads a picture, sound or video and returns its public URL. */
export async function uploadMedia(file: File): Promise<{ url: string; kind: MediaKind }> {
  const kind = kindOf(file.type);
  if (!kind) throw new Error("Choose a picture, sound or video file.");
  if (file.size > 50 * 1024 * 1024) throw new Error("That file is over 50 MB. Use a shorter clip or a smaller file.");
  const body = kind === "image" ? await prepareImage(file) : file;
  const contentType = body.type || file.type;
  const signed = await api<{ bucket: string; path: string; token: string; public_url: string }>("/api/admin/upload", {
    method: "POST",
    json: { content_type: contentType },
  });
  const sb = await getBrowserSupabase();
  if (!sb) throw new Error("Storage isn't configured. Check the Supabase settings.");
  const { error } = await sb.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, body, { contentType });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { url: signed.public_url, kind };
}
