import { fileTypeFromBuffer } from "file-type";
import { AppError } from "./security.js";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export type Attachment = {
  content: Buffer;
  mime: string;
  name: string;
  kind: "image" | "audio" | "video" | "document";
};
const allowed = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "application/pdf",
]);
export async function validateMedia(
  content: Buffer,
  name: string,
): Promise<Attachment> {
  if (!content.length || content.length > MAX_MEDIA_BYTES)
    throw new AppError(400, "Escolha um arquivo de até 10 MB.");
  const detected = await fileTypeFromBuffer(content.subarray(0, 8192)).catch(
    () => undefined,
  );
  if (!detected || !allowed.has(detected.mime))
    throw new AppError(
      400,
      "Formato não aceito. Use imagem JPG, PNG, WebP ou GIF; PDF; áudio MP3, OGG ou WAV; ou vídeo MP4.",
    );
  const kind = detected.mime.startsWith("image/")
    ? "image"
    : detected.mime.startsWith("audio/")
      ? "audio"
      : detected.mime.startsWith("video/")
        ? "video"
        : "document";
  return {
    content,
    mime: detected.mime,
    kind,
    name:
      name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) ||
      `arquivo.${detected.ext}`,
  };
}
