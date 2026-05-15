import { supabase } from "@/integrations/supabase/client";

export interface UploadedAttachment {
  id: string;
  line_id: string;
  storage_path: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  created_at: string;
}

export interface ExcelAttachment {
  source: "excel";
  url: string;
  label: string;
}

export interface DbAttachment {
  source: "uploaded";
  id: string;
  filename: string;
  mime_type: string | null;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

export type Attachment = ExcelAttachment | DbAttachment;

const URL_RE = /https?:\/\/[^\s,;]+/gi;

/** Find every http(s) URL in raw_data values (any header). */
export const extractExcelAttachments = (raw: Record<string, unknown> | null | undefined): ExcelAttachment[] => {
  if (!raw || typeof raw !== "object") return [];
  const out: ExcelAttachment[] = [];
  const seen = new Set<string>();
  for (const [key, val] of Object.entries(raw)) {
    if (val == null) continue;
    const s = String(val);
    const matches = s.match(URL_RE);
    if (!matches) continue;
    for (const url of matches) {
      const clean = url.replace(/[).,;]+$/, "");
      if (seen.has(clean)) continue;
      seen.add(clean);
      out.push({ source: "excel", url: clean, label: key });
    }
  }
  return out;
};

export const isImageMime = (mime?: string | null): boolean =>
  !!mime && mime.startsWith("image/");

export const isImageUrl = (url: string): boolean =>
  /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);

/** Get a short-lived signed URL for a private storage object. */
export const getSignedUrl = async (path: string, expires = 3600): Promise<string | null> => {
  const { data, error } = await supabase.storage
    .from("expense-attachments")
    .createSignedUrl(path, expires);
  if (error || !data) return null;
  return data.signedUrl;
};
