import { useEffect, useRef } from "react";

type CampaignPollingOptions = {
  enabled?: boolean;
  detailEnabled?: boolean;
  pollList: () => void | Promise<void>;
  pollDetail: () => void | Promise<void>;
  listIntervalMs?: number;
  detailIntervalMs?: number;
};

export function useCampaignPolling({
  enabled = true,
  detailEnabled = false,
  pollList,
  pollDetail,
  listIntervalMs = 10000,
  detailIntervalMs = 3000,
}: CampaignPollingOptions) {
  const listRef = useRef(pollList);
  const detailRef = useRef(pollDetail);

  useEffect(() => {
    listRef.current = pollList;
    detailRef.current = pollDetail;
  }, [pollList, pollDetail]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void listRef.current();
    }, listIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, listIntervalMs]);

  useEffect(() => {
    if (!enabled || !detailEnabled) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void detailRef.current();
    }, detailIntervalMs);
    return () => window.clearInterval(timer);
  }, [detailEnabled, detailIntervalMs, enabled]);
}
