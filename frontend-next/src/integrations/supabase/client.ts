/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Supabase compatibility shim.
 * Exports a `supabase` object with the same API surface used throughout the app,
 * but routes all calls to the Express/MongoDB backend.
 *
 * Supported:
 *   supabase.from(table)         → QueryBuilder (select/insert/update/delete/eq/order/limit/single)
 *   supabase.storage.from(bucket) → StorageBuilder (upload/getPublicUrl)
 *   supabase.functions.invoke()  → POST /api/phonepe/*
 *   supabase.rpc()               → POST /api/polls/:id/vote
 *   supabase.channel()           → polling-based realtime shim
 *   supabase.removeChannel()     → clear polling interval
 */
import { API_URL, authHeaders, routeFor } from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────

function j(body: unknown) {
  return JSON.stringify(body);
}

async function doFetch(url: string, opts: RequestInit = {}): Promise<{ data: any; error: any }> {
  try {
    const res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers: { ...authHeaders(), ...(opts.headers as Record<string, string> || {}) },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: json ?? { message: res.statusText } };
    return { data: json, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

// ── QueryBuilder ──────────────────────────────────────────────

class QueryBuilder {
  private _table: string;
  private _filters: [string, unknown][] = [];
  private _method: "GET" | "POST" | "PUT" | "DELETE" = "GET";
  private _body: unknown = null;
  private _orderField: string | null = null;
  private _orderAsc = true;
  private _limitVal: number | null = null;
  private _isSingle = false;

  constructor(table: string) {
    this._table = table;
  }

  select(_cols = "*") { return this; }

  eq(field: string, value: unknown) {
    this._filters.push([field, value]);
    return this;
  }

  order(field: string, opts?: { ascending?: boolean }) {
    this._orderField = field;
    this._orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number) { this._limitVal = n; return this; }

  single() { this._isSingle = true; return this; }

  insert(data: unknown) {
    this._method = "POST";
    this._body = data;
    return this;
  }

  update(data: unknown) {
    this._method = "PUT";
    this._body = data;
    return this;
  }

  delete() { this._method = "DELETE"; return this; }

  private _getId() {
    return this._filters.find(([k]) => k === "id")?.[1];
  }

  private _buildUrl(): string {
    const route = this._table === "order_items"
      ? this._buildOrderItemsUrl()
      : routeFor(this._table);
    let base = `${API_URL}${route}`;

    if (this._method !== "GET" && this._method !== "POST") {
      const id = this._getId();
      if (id) base += `/${id}`;
    }

    if (this._method === "GET") {
      const params = new URLSearchParams();
      for (const [k, v] of this._filters) {
        params.set(k, String(v));
      }
      if (this._orderField) {
        params.set("_sort", this._orderField);
        params.set("_order", this._orderAsc ? "asc" : "desc");
      }
      if (this._limitVal !== null) params.set("_limit", String(this._limitVal));
      const qs = params.toString();
      if (qs) base += `?${qs}`;
    }

    return base;
  }

  private _buildOrderItemsUrl(): string {
    const orderId = this._filters.find(([k]) => k === "order_id")?.[1];
    if (orderId) return `/orders/${orderId}/items`;
    return "/orders";
  }

  async _execute(): Promise<{ data: any; error: any }> {
    const url = this._buildUrl();
    const opts: RequestInit = { method: this._method };
    if (this._body) opts.body = j(this._body);

    const result = await doFetch(url, opts);

    if (this._isSingle && result.data) {
      result.data = Array.isArray(result.data)
        ? (result.data[0] ?? null)
        : result.data;
    }

    return result;
  }

  // Make the builder awaitable: `await supabase.from("x").select(...)`
  then(resolve: (val: { data: any; error: any }) => void, reject?: (err: unknown) => void) {
    return this._execute().then(resolve, reject);
  }

  catch(reject: (err: unknown) => void) {
    return this._execute().catch(reject);
  }
}

// ── Storage shim ──────────────────────────────────────────────

class StorageObjectRef {
  private _bucket: string;

  constructor(bucket: string) {
    this._bucket = bucket;
  }

  async upload(path: string, file: File, _opts?: object): Promise<{ data: { path: string } | null; error: any }> {
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(`${API_URL}/uploads/image`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { data: null, error: err };
      }
      const json = await res.json();
      // Store full URL in "path" so getPublicUrl returns it directly
      return { data: { path: json.url }, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  getPublicUrl(path: string): { data: { publicUrl: string } } {
    // If already a full URL (from our upload shim), return as-is
    if (path.startsWith("http")) {
      return { data: { publicUrl: path } };
    }
    // Construct URL from server base
    const base = API_URL.replace("/api", "");
    return { data: { publicUrl: `${base}/uploads/${path}` } };
  }
}

// ── Realtime channel shim (polling) ──────────────────────────

type ChangeEvent = "INSERT" | "UPDATE" | "DELETE";

interface ChannelSubscription {
  event: ChangeEvent;
  table: string;
  filter?: string;
  callback: (payload: { new: any; old: any }) => void;
}

class RealtimeChannel {
  private _name: string;
  private _subscriptions: ChannelSubscription[] = [];
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _lastFetch: Record<string, any[]> = {};

  constructor(name: string) {
    this._name = name;
  }

  on(
    _type: string,
    config: { event: ChangeEvent; schema: string; table: string; filter?: string },
    callback: (payload: any) => void
  ) {
    this._subscriptions.push({ event: config.event, table: config.table, filter: config.filter, callback });
    return this;
  }

  subscribe() {
    // Poll every 5 seconds for changes
    this._intervalId = setInterval(() => this._poll(), 5000);
    return this;
  }

  private async _poll() {
    for (const sub of this._subscriptions) {
      try {
        const route = routeFor(sub.table);
        const url = `${API_URL}${route}?_sort=createdAt&_order=desc&_limit=20`;
        const res = await fetch(url, {
          credentials: "include",
          headers: authHeaders(),
        });
        if (!res.ok) continue;
        const items: any[] = await res.json();
        const prev = this._lastFetch[sub.table] ?? [];
        this._lastFetch[sub.table] = items;

        if (prev.length === 0) continue; // first fetch, skip

        if (sub.event === "INSERT") {
          const prevIds = new Set(prev.map((x) => x.id ?? x._id));
          for (const item of items) {
            if (!prevIds.has(item.id ?? item._id)) {
              sub.callback({ new: item, old: null });
            }
          }
        } else if (sub.event === "UPDATE") {
          const prevMap = Object.fromEntries(prev.map((x) => [x.id ?? x._id, x]));
          for (const item of items) {
            const id = item.id ?? item._id;
            const old = prevMap[id];
            if (old && JSON.stringify(old) !== JSON.stringify(item)) {
              sub.callback({ new: item, old });
            }
          }
        } else if (sub.event === "DELETE") {
          const currIds = new Set(items.map((x) => x.id ?? x._id));
          for (const old of prev) {
            if (!currIds.has(old.id ?? old._id)) {
              sub.callback({ new: null, old });
            }
          }
        }
      } catch {
        // Swallow polling errors silently
      }
    }
  }

  unsubscribe() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

// ── Functions shim ────────────────────────────────────────────

const functions = {
  invoke: async (
    fnName: string,
    options?: { body?: unknown }
  ): Promise<{ data: any; error: any }> => {
    const routeMap: Record<string, string> = {
      "create-phonepe-order": "/phonepe/create-order",
      "verify-phonepe-payment": "/phonepe/verify-payment",
    };
    const route = routeMap[fnName] ?? `/${fnName}`;
    return doFetch(`${API_URL}${route}`, {
      method: "POST",
      body: j(options?.body ?? {}),
    });
  },
};

// ── RPC shim ──────────────────────────────────────────────────

async function rpc(fnName: string, params?: Record<string, unknown>): Promise<{ data: any; error: any }> {
  if (fnName === "cast_vote") {
    const pollId = params?.p_poll_id as string;
    return doFetch(`${API_URL}/polls/${pollId}/vote`, {
      method: "POST",
      body: j(params),
    });
  }
  // Generic fallback
  return doFetch(`${API_URL}/rpc/${fnName}`, {
    method: "POST",
    body: j(params ?? {}),
  });
}

// ── Channel registry ─────────────────────────────────────────

const _channels = new Map<string, RealtimeChannel>();

// ── Main supabase export ──────────────────────────────────────

export const supabase = {
  from: (table: string) => new QueryBuilder(table),

  storage: {
    from: (bucket: string) => new StorageObjectRef(bucket),
  },

  functions,

  rpc,

  channel: (name: string) => {
    const ch = new RealtimeChannel(name);
    _channels.set(name, ch);
    return ch;
  },

  removeChannel: (channel: RealtimeChannel) => {
    channel.unsubscribe();
    for (const [k, v] of _channels.entries()) {
      if (v === channel) _channels.delete(k);
    }
  },
};

// Default export for any code that does `import supabase from ...`
export default supabase;
