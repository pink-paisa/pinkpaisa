import { Activity, Clock3 } from "lucide-react";

type QueueLaneHealth = {
  concurrency: number;
  queued: number;
  running: number;
  failed: number;
  oldest_queued_at?: string | null;
  oldest_queue_age_seconds: number;
};

export type CampaignQueueHealthData = {
  status: "healthy" | "stale" | string;
  worker: {
    worker_id: string;
    heartbeat_at: string;
    heartbeat_age_seconds: number;
  } | null;
  lanes: Record<string, QueueLaneHealth>;
  checked_at: string;
};

const formatAge = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

export default function CampaignQueueHealth({ health }: { health: CampaignQueueHealthData | null }) {
  const healthy = health?.status === "healthy";
  const lanes = Object.entries(health?.lanes || {});

  return (
    <div className="border-y border-border bg-card px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${healthy ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Marketing worker {healthy ? "healthy" : "stale"}</p>
            <p className="text-xs text-muted-foreground">
              {health?.worker ? `Heartbeat ${formatAge(health.worker.heartbeat_age_seconds)} ago` : "No worker heartbeat recorded"}
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {lanes.map(([name, lane]) => (
            <div key={name} className="min-w-40 border-l border-border pl-3 text-xs">
              <p className="font-semibold capitalize text-foreground">{name}</p>
              <p className="mt-1 text-muted-foreground">{lane.running} running / {lane.queued} queued / {lane.failed} failed</p>
              {lane.oldest_queue_age_seconds > 0 ? (
                <p className="mt-1 flex items-center gap-1 text-amber-700"><Clock3 className="h-3 w-3" /> Oldest {formatAge(lane.oldest_queue_age_seconds)}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
