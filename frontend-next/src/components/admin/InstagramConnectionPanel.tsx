import { Button } from "@/components/ui/button";
import { StatusBadge } from "./AdminShared";
import { Link2, Link2Off, RefreshCcw } from "lucide-react";

type InstagramConnection = {
  status: string;
  is_connected: boolean;
  login_type?: string | null;
  account_type?: string | null;
  facebook_page_name?: string | null;
  instagram_username?: string | null;
  instagram_name?: string | null;
  profile_picture_url?: string | null;
  last_connected_at?: string | null;
  last_error?: string | null;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
};

const InstagramConnectionPanel = ({
  connection,
  loading,
  onConnect,
  onDisconnect,
}: {
  connection: InstagramConnection | null;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) => {
  const isConnected = Boolean(connection?.is_connected);

  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Instagram connection</p>
          <h3 className="mt-2 font-serif text-2xl">One-click posting setup</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your Instagram professional account once, then publish straight from the review screen.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={connection?.status || "disconnected"} />
          {isConnected ? (
            <>
              <Button variant="outline" className="rounded-2xl" onClick={onConnect} disabled={loading}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Reconnect
              </Button>
              <Button variant="outline" className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50" onClick={onDisconnect} disabled={loading}>
                <Link2Off className="mr-2 h-4 w-4" /> Disconnect
              </Button>
            </>
          ) : (
            <Button className="rounded-2xl" onClick={onConnect} disabled={loading}>
              <Link2 className="mr-2 h-4 w-4" /> Connect Instagram
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Instagram</p>
          <div className="mt-3 flex items-center gap-3">
            {connection?.profile_picture_url ? (
              <img src={connection.profile_picture_url} alt="Instagram profile" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-full bg-secondary" />
            )}
            <div>
              <p className="font-medium">{connection?.instagram_name || "Not connected"}</p>
              <p className="text-sm text-muted-foreground">{connection?.instagram_username ? `@${connection.instagram_username}` : "—"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Connection mode</p>
          <p className="mt-3 font-medium">
            {connection?.login_type === "instagram_business_login"
              ? "Business Login for Instagram"
              : (connection?.facebook_page_name || "—")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{connection?.account_type || "Instagram professional"}</p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Last connected</p>
          <p className="mt-3 font-medium">{formatDateTime(connection?.last_connected_at)}</p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Latest error</p>
          <p className="mt-3 text-sm text-muted-foreground">{connection?.last_error || "No connection errors"}</p>
        </div>
      </div>
    </div>
  );
};

export default InstagramConnectionPanel;
