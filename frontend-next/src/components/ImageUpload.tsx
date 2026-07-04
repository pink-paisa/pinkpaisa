import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X, Loader2, ImagePlus, Link } from "lucide-react";
import { toast } from "sonner";

type Props = {
  value: string;
  onChange: (url: string) => void;
  additionalImages?: string[];
  onAdditionalChange?: (urls: string[]) => void;
  bucket?: string;
  folder?: string;
  error?: string | null;
  additionalError?: string | null;
};

const ImageUpload = ({
  value,
  onChange,
  additionalImages = [],
  onAdditionalChange,
  bucket = "product-images",
  folder = "products",
  error,
  additionalError,
}: Props) => {
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [showAdditionalUrlInput, setShowAdditionalUrlInput] = useState(false);
  const [additionalUrlValue, setAdditionalUrlValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const additionalRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File): Promise<string | null> => {
    const ext = file.name.split(".").pop();
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) { toast.error("Upload failed: " + error.message); return null; }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleFeatured = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await upload(file);
    if (url) onChange(url);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleAdditional = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !onAdditionalChange) return;
    setUploading(true);
    const urls: string[] = [];
    for (const file of Array.from(files)) {
      const url = await upload(file);
      if (url) urls.push(url);
    }
    onAdditionalChange([...additionalImages, ...urls]);
    setUploading(false);
    if (additionalRef.current) additionalRef.current.value = "";
  };

  const handlePasteUrl = () => {
    const trimmed = urlValue.trim();
    if (!trimmed) { toast.error("Please enter a URL"); return; }
    try { new URL(trimmed); } catch { toast.error("Invalid URL"); return; }
    onChange(trimmed);
    setUrlValue("");
    setShowUrlInput(false);
  };

  const removeAdditional = (idx: number) => {
    if (!onAdditionalChange) return;
    onAdditionalChange(additionalImages.filter((_, i) => i !== idx));
  };

  const handlePasteAdditionalUrl = () => {
    const trimmed = additionalUrlValue.trim();
    if (!trimmed) { toast.error("Please enter a URL"); return; }
    try { new URL(trimmed); } catch { toast.error("Invalid URL"); return; }
    if (!onAdditionalChange) return;
    onAdditionalChange([...additionalImages, trimmed]);
    setAdditionalUrlValue("");
    setShowAdditionalUrlInput(false);
  };

  return (
    <div className="space-y-3">
      {/* Featured image */}
      <div>
        <p className="text-sm font-medium mb-1.5">Featured Image</p>
        {value ? (
          <div className="relative inline-block">
            <img src={value} alt="Featured" className="h-24 w-24 rounded-lg object-cover border border-border" />
            <button onClick={() => onChange("")} className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow-sm hover:brightness-110"><X className="h-3 w-3" /></button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={`flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-accent/30 text-muted-foreground transition-colors hover:border-primary hover:text-primary ${error ? "border-destructive text-destructive" : "border-border"}`}
              >
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Upload className="h-5 w-5" /><span className="text-[10px]">Upload</span></>}
              </button>
              <button
                onClick={() => setShowUrlInput(!showUrlInput)}
                className={`flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-accent/30 text-muted-foreground transition-colors hover:border-primary hover:text-primary ${error ? "border-destructive text-destructive" : "border-border"}`}
              >
                <Link className="h-5 w-5" />
                <span className="text-[10px]">Paste URL</span>
              </button>
            </div>
            {showUrlInput && (
              <div className="flex gap-2 max-w-sm">
                <Input
                  placeholder="https://example.com/image.jpg"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handlePasteUrl()}
                  className="text-xs"
                />
                <Button size="sm" onClick={handlePasteUrl} className="shrink-0">Add</Button>
              </div>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFeatured} />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      {/* Additional images */}
      {onAdditionalChange && (
        <div>
          <p className="text-sm font-medium mb-1.5">Additional Images</p>
          <div className="flex flex-wrap gap-2">
            {additionalImages.map((url, i) => (
              <div key={i} className="relative">
                <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-border" />
                <button onClick={() => removeAdditional(i)} className="absolute -top-1 -right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow-sm hover:brightness-110"><X className="h-2.5 w-2.5" /></button>
              </div>
            ))}
            <button
              onClick={() => additionalRef.current?.click()}
              disabled={uploading}
              className={`flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed bg-accent/30 text-muted-foreground transition-colors hover:border-primary hover:text-primary ${additionalError ? "border-destructive text-destructive" : "border-border"}`}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ImagePlus className="h-4 w-4" /><span className="text-[9px]">Add</span></>}
            </button>
            <button
              onClick={() => setShowAdditionalUrlInput(!showAdditionalUrlInput)}
              className={`flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed bg-accent/30 text-muted-foreground transition-colors hover:border-primary hover:text-primary ${additionalError ? "border-destructive text-destructive" : "border-border"}`}
            >
              <Link className="h-4 w-4" />
              <span className="text-[9px]">URL</span>
            </button>
          </div>
          {showAdditionalUrlInput && (
            <div className="mt-2 flex gap-2 max-w-sm">
              <Input
                placeholder="https://example.com/gallery-image.jpg"
                value={additionalUrlValue}
                onChange={(e) => setAdditionalUrlValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePasteAdditionalUrl()}
                className="text-xs"
              />
              <Button size="sm" onClick={handlePasteAdditionalUrl} className="shrink-0">Add</Button>
            </div>
          )}
          <input ref={additionalRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAdditional} />
          {additionalError ? <p className="mt-2 text-xs text-destructive">{additionalError}</p> : null}
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
