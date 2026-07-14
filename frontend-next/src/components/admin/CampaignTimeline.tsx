import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StatusBadge } from "./AdminShared";

export type CampaignTask = {
  id: string;
  agent_name: string;
  sequence: number;
  status: string;
  queue_lane?: "fast" | "creative" | "publish" | string;
  available_at?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
  attempt_count: number;
  input_json: unknown;
  output_json: unknown;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type CampaignPublishEvent = {
  id: string;
  action_type: string;
  status: string;
  product_title?: string | null;
  instagram_media_id?: string | null;
  instagram_permalink?: string | null;
  error_message?: string | null;
  readiness_snapshot?: unknown;
  metadata_json?: Record<string, unknown> | null;
  created_at: string | null;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-IN");
};

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="max-h-72 overflow-auto rounded-lg bg-[#fff8fa] p-4 text-xs leading-6 text-[#6b4b57]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

export default function CampaignTimeline({
  events,
  tasks,
}: {
  events: CampaignPublishEvent[];
  tasks: CampaignTask[];
}) {
  return (
    <div className="space-y-4">
      <section className="border border-border bg-background p-4 shadow-sm">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Publish history</p>
        <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
          {!events.length ? (
            <p className="bg-background/50 p-3 text-sm text-muted-foreground">No publish events recorded yet.</p>
          ) : events.map((event) => (
            <div key={event.id} className="border border-border/70 bg-background/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={event.status} />
                  <span className="font-medium">{event.action_type.replace(/_/g, " ")}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
              </div>
              {event.instagram_permalink ? (
                <a href={event.instagram_permalink} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-primary underline-offset-4 hover:underline">
                  {event.instagram_permalink}
                </a>
              ) : null}
              {event.error_message ? <p className="mt-2 text-xs text-rose-700">{event.error_message}</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="border border-border bg-background p-4 shadow-sm">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Agent tasks</p>
        <Accordion type="multiple" className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {tasks.map((task) => (
            <AccordionItem key={task.id} value={task.id} className="border border-border/70 px-4">
              <AccordionTrigger className="py-4 text-left hover:no-underline">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium capitalize">{task.sequence}. {task.agent_name}</p>
                  <StatusBadge status={task.status} />
                  <span className="text-xs text-muted-foreground">Attempts: {task.attempt_count}</span>
                  {task.queue_lane ? <span className="text-xs capitalize text-muted-foreground">Lane: {task.queue_lane}</span> : null}
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <p className="mt-2 text-xs text-muted-foreground">Started: {formatDateTime(task.started_at)} | Heartbeat: {formatDateTime(task.heartbeat_at)} | Finished: {formatDateTime(task.finished_at)}</p>
                {task.error_message ? <p className="mb-3 text-sm text-rose-700">{task.error_message}</p> : null}
                {task.output_json ? <JsonBlock value={task.output_json} /> : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
