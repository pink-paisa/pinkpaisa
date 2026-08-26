import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, Library, Loader2, Music2, RefreshCw, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { API_URL, apiFetch } from "@/lib/api";
import { SocialAudioTrack, SocialDraft } from "./types";

const API_BASE = "/social-media-manager/admin/audio-library";

const text = (value: unknown) => typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function normalizeTrack(value: unknown): SocialAudioTrack {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: text(row.id || row._id),
    title: text(row.title),
    source: text(row.source),
    originalFilename: text(row.original_filename || row.originalFilename),
    streamPath: text(row.stream_path || row.streamPath),
    checksumSha256: text(row.checksum_sha256 || row.checksumSha256),
    mimeType: text(row.mime_type || row.mimeType),
    extension: text(row.extension),
    fileSizeBytes: number(row.file_size_bytes || row.fileSizeBytes),
    durationSeconds: number(row.duration_seconds || row.durationSeconds),
    audioCodec: text(row.audio_codec || row.audioCodec),
    licenseStatus: text(row.license_status || row.licenseStatus),
    licenseReference: text(row.license_reference || row.licenseReference),
    rightsConfirmed: row.rights_confirmed === true || row.rightsConfirmed === true,
    rightsConfirmationStatement: text(row.rights_confirmation_statement || row.rightsConfirmationStatement),
    rightsConfirmedAt: text(row.rights_confirmed_at || row.rightsConfirmedAt) || null,
    active: row.is_active !== false && row.active !== false,
    usable: row.usable === true,
    createdAt: text(row.created_at || row.createdAt) || null,
  };
}

const fileSize = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  : `${Math.max(Math.round(bytes / 1024), 1)} KB`;

type Props = {
  draft?: SocialDraft | null;
  showUploader?: boolean;
  busy?: boolean;
  onApplyToReel?: (trackId: string) => void;
};

export const SocialAudioLibrary = ({ draft = null, showUploader = false, busy = false, onApplyToReel }: Props) => {
  const [tracks, setTracks] = useState<SocialAudioTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState(draft?.audioTrackId || "");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await apiFetch<{ items?: unknown[] }>(API_BASE);
      setTracks((response.items || []).map(normalizeTrack));
      setLastLoadedAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load the licensed audio library";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelectedId(draft?.audioTrackId || ""); }, [draft?.audioTrackId]);

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!data.get("audio")) return toast.error("Choose an MP3, M4A, WAV, or OGG file");
    if (data.get("rights_confirmed") !== "true") return toast.error("Confirm that Pink Paisa may use this audio");
    setUploading(true);
    try {
      const response = await apiFetch<{ message?: string; track?: unknown }>(API_BASE, { method: "POST", body: data });
      toast.success(response.message || "Licensed audio uploaded");
      form.reset();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload this audio track");
    } finally {
      setUploading(false);
    }
  };

  const revoke = async (track: SocialAudioTrack) => {
    const reason = window.prompt(`Why are you revoking “${track.title}”? Affected Reels and Video Feeds will be blocked and returned to review.`);
    if (reason === null) return;
    if (!reason.trim()) return toast.error("A revocation reason is required");
    try {
      await apiFetch(`${API_BASE}/${encodeURIComponent(track.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.success("Track revoked; affected Reel renders are blocked");
      if (selectedId === track.id) setSelectedId("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke this track");
    }
  };

  const draftFormat = String(draft?.primary.format || "").toUpperCase();
  const isVideoDraft = ["REEL", "VIDEO_FEED"].includes(draftFormat);
  const formatLabel = draftFormat === "VIDEO_FEED" ? "Video Feed" : "Reel";
  const selected = tracks.find((track) => track.id === selectedId);

  return (
    <Card className="rounded-3xl shadow-none">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Library className="h-5 w-5" /> Licensed social-video audio</CardTitle>
            <CardDescription>Local, administrator-uploaded tracks only. Pink Paisa never scrapes or imports trending audio from third-party pages.</CardDescription>
          </div>
          <p className="text-xs text-muted-foreground">{loading ? "Updating automatically…" : `Last updated ${lastLoadedAt ? new Date(lastLoadedAt).toLocaleString("en-IN") : "not recorded"}`}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError ? <Alert variant="destructive" className="rounded-2xl"><AlertTitle>Audio library could not be loaded</AlertTitle><AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3"><span>{loadError}</span><Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-3.5 w-3.5" /> Try again</Button></AlertDescription></Alert> : null}
        {isVideoDraft && onApplyToReel ? (
          <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
            <div>
              <Label htmlFor="reel-audio-track">Audio for this {formatLabel} draft</Label>
              <p className="mt-1 text-xs text-muted-foreground">Selecting a track rebuilds the MP4 from the approved scene plan and resets human approval.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select id="reel-audio-track" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">No uploaded track — silent / add approved Instagram-native audio manually</option>
                {tracks.filter((track) => track.usable).map((track) => <option key={track.id} value={track.id}>{track.title} · {track.licenseStatus.replace(/_/g, " ")}</option>)}
              </select>
              <Button type="button" onClick={() => onApplyToReel(selectedId)} disabled={busy || selectedId === (draft?.audioTrackId || "")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />} Select & rebuild {formatLabel}
              </Button>
            </div>
            {selected ? <p className="text-xs text-muted-foreground">Selected: {selected.title} · SHA-256 {selected.checksumSha256.slice(0, 12)}… · rights confirmed {selected.rightsConfirmedAt ? new Date(selected.rightsConfirmedAt).toLocaleDateString("en-IN") : "by admin"}</p> : null}
          </div>
        ) : null}

        {showUploader ? (
          <form className="grid gap-4 rounded-2xl border border-border p-4 lg:grid-cols-2" onSubmit={(event) => void upload(event)}>
            <div className="lg:col-span-2">
              <p className="font-medium">Upload a rights-cleared track</p>
              <p className="mt-1 text-xs text-muted-foreground">Maximum 25 MB and 15 minutes. The server verifies extension, MIME, file signature, codec, duration, checksum, and guarded local path.</p>
            </div>
            <div className="space-y-2"><Label htmlFor="audio-title">Track title</Label><Input id="audio-title" name="title" required maxLength={180} /></div>
            <div className="space-y-2"><Label htmlFor="audio-source">Creator / source</Label><Input id="audio-source" name="source" required maxLength={1000} placeholder="Creator, commissioned library, or owned recording" /></div>
            <div className="space-y-2">
              <Label htmlFor="audio-license-status">Rights status</Label>
              <select id="audio-license-status" name="license_status" defaultValue="LICENSED" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="LICENSED">Licensed</option><option value="OWNED">Owned</option><option value="PUBLIC_DOMAIN">Public domain</option><option value="ADMIN_APPROVED">Administrator approved</option>
              </select>
            </div>
            <div className="space-y-2"><Label htmlFor="audio-license-reference">Licence/source reference</Label><Input id="audio-license-reference" name="license_reference" maxLength={2000} placeholder="Agreement, invoice, licence URL, or internal record" /></div>
            <div className="space-y-2 lg:col-span-2"><Label htmlFor="audio-rights-statement">Rights confirmation statement</Label><Textarea id="audio-rights-statement" name="rights_confirmation_statement" required maxLength={2000} placeholder="I verified that Pink Paisa may edit and publish this track with organic social content." /></div>
            <div className="space-y-2 lg:col-span-2"><Label htmlFor="audio-file">Audio file</Label><Input id="audio-file" name="audio" type="file" required accept=".mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/wav,audio/ogg" /></div>
            <label className="flex items-start gap-2 text-sm lg:col-span-2"><input name="rights_confirmed" value="true" type="checkbox" required className="mt-1" /><span>I personally confirm that Pink Paisa has the recorded right to use this audio. This confirmation and my administrator identity will be audited.</span></label>
            <div className="lg:col-span-2"><Button type="submit" disabled={uploading}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Validate and upload</Button></div>
          </form>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between"><p className="font-medium">Approved library ({tracks.length})</p><Badge variant="outline"><ShieldCheck className="mr-1 h-3 w-3" /> Rights-gated</Badge></div>
          {!tracks.length && !loading ? <Alert><Music2 className="h-4 w-4" /><AlertTitle>No licensed tracks uploaded</AlertTitle><AlertDescription>Reels and Video Feeds remain silent, or an administrator can complete the documented Instagram-native audio step manually.</AlertDescription></Alert> : null}
          {tracks.map((track) => (
            <div key={track.id} className="grid gap-3 rounded-2xl border border-border p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(240px,1fr)_auto] lg:items-center">
              <div className="min-w-0"><p className="truncate font-medium">{track.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{track.source}</p><div className="mt-2 flex flex-wrap gap-1.5"><Badge variant="secondary">{track.licenseStatus.replace(/_/g, " ")}</Badge><Badge variant="outline">{track.extension.replace(".", "").toUpperCase()}</Badge><Badge variant="outline">{Math.round(track.durationSeconds)} sec · {fileSize(track.fileSizeBytes)}</Badge></div></div>
              <div>{track.streamPath ? <audio controls preload="metadata" crossOrigin="use-credentials" src={`${API_URL}${track.streamPath}`} className="h-10 w-full" /> : null}<p className="mt-1 truncate text-[10px] text-muted-foreground">SHA-256 {track.checksumSha256}</p></div>
              <div className="flex items-center gap-2">{track.usable ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}{showUploader ? <Button type="button" size="sm" variant="ghost" onClick={() => void revoke(track)}><Trash2 className="h-4 w-4" /> Revoke</Button> : null}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
