import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Paperclip, ExternalLink } from "lucide-react";
import { extractExcelAttachments, isImageUrl, type ExcelAttachment } from "@/lib/attachments";
import { cn } from "@/lib/utils";

interface Props {
  lineId: string;
  rawData: Record<string, unknown> | null | undefined;
  /** Kept for API compatibility — uploads are no longer supported. */
  canUpload?: boolean;
  className?: string;
}

/**
 * Read-only gallery of image/file links sourced from the daily allocation
 * file (e.g. the "Imagelink" column and any other URL-bearing fields in
 * raw_data). The upload feature has been removed — links come from the feed.
 */
export const AttachmentsGallery = ({ rawData, className }: Props) => {
  const [preview, setPreview] = useState<{ url: string; name: string; isImage: boolean } | null>(null);

  const links: ExcelAttachment[] = extractExcelAttachments(rawData);

  const open = (a: ExcelAttachment) => {
    setPreview({ url: a.url, name: a.label, isImage: isImageUrl(a.url) });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">
          Attachments {links.length > 0 && (
            <span className="text-muted-foreground tabular-nums">({links.length})</span>
          )}
        </span>
        <span className="ml-2 text-[10px] text-muted-foreground italic">from allocation file</span>
      </div>

      {links.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-2">
          No image links in the allocation file for this line
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {links.map((a, i) => (
            <button
              key={`link-${i}`}
              onClick={() => open(a)}
              className="group relative aspect-square rounded border border-border bg-muted/30 hover:border-primary/50 transition-colors overflow-hidden flex flex-col items-center justify-center text-center p-1.5"
              title={`${a.label}: ${a.url}`}
            >
              {isImageUrl(a.url) ? (
                <img src={a.url} alt={a.label} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <>
                  <ExternalLink className="w-5 h-5 text-muted-foreground mb-1" />
                  <span className="text-[9px] text-muted-foreground truncate w-full uppercase">{a.label}</span>
                </>
              )}
              <span className="absolute top-0.5 left-0.5 text-[8px] bg-background/80 backdrop-blur px-1 rounded text-muted-foreground">
                {a.label}
              </span>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium truncate pr-6">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && (
            preview.isImage ? (
              <img src={preview.url} alt={preview.name} className="w-full max-h-[75vh] object-contain rounded" />
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">Preview not available for this file type.</div>
                <Button asChild>
                  <a href={preview.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" /> Open in new tab
                  </a>
                </Button>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
