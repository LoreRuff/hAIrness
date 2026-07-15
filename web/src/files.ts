import { nanoid } from "nanoid";
import type { Attachment } from "../types";

const TEXT_EXT = /\.(md|txt|ts|tsx|js|jsx|py|json|jsonc|yaml|yml|toml|csv|html|css|sh|sql|rs|go|c|cpp|h|java|xml|ini|conf|log|env\.example)$/i;
const MAX_IMAGE = 5 * 1024 * 1024;   // 5 MB
const MAX_TEXT = 300 * 1024;         // 300 KB

function isTextLike(f: File): boolean {
  return f.type.startsWith("text/")
    || ["application/json", "application/xml", "application/javascript", "application/x-yaml"].includes(f.type)
    || TEXT_EXT.test(f.name);
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

export async function fileToAttachment(f: File): Promise<Attachment | { error: string }> {
  if (f.type.startsWith("image/")) {
    if (f.size > MAX_IMAGE) return { error: `${f.name}: image > 5MB` };
    return { id: nanoid(8), kind: "image", name: f.name, mime: f.type, dataUrl: await readAsDataUrl(f) };
  }
  if (isTextLike(f)) {
    if (f.size > MAX_TEXT) return { error: `${f.name}: text file > 300KB` };
    return { id: nanoid(8), kind: "text", name: f.name, mime: f.type || "text/plain", text: await f.text() };
  }
  return { error: `${f.name}: unsupported type (${f.type || "unknown"})` };
}
