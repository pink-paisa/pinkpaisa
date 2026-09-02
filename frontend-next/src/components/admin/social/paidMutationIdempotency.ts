type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PaidMutationIdentity = {
  actionKey: string;
  draftId: string;
  revision: number | null;
  body: Record<string, unknown>;
};

export type PaidMutationKeyLease = {
  key: string;
  storageSlot: string;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
};

const fingerprintHash = (input: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

const randomInvocationId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const browserSessionStorage = (): StorageLike | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const acquirePaidMutationKey = (
  identity: PaidMutationIdentity,
  storage: StorageLike | null = browserSessionStorage(),
): PaidMutationKeyLease => {
  // Do not include the server revision in the durable browser slot. A paid
  // mutation can commit (incrementing revision) while its HTTP response is
  // lost. After reload, the same action/body must reuse the pending key so the
  // server can return its existing receipt instead of buying the work again.
  const fingerprint = JSON.stringify(canonicalize({
    actionKey: identity.actionKey,
    draftId: identity.draftId,
    body: identity.body,
  }));
  const storageSlot = `pinkpaisa:social-paid:${fingerprintHash(fingerprint)}:${fingerprint.length}`;
  const existing = storage?.getItem(storageSlot)?.trim();
  if (existing) return { key: existing, storageSlot };
  const key = `social-paid:${identity.actionKey}:${identity.draftId}:${randomInvocationId()}`.slice(0, 300);
  try {
    storage?.setItem(storageSlot, key);
  } catch {
    // The key still protects this invocation even when browser storage is unavailable.
  }
  return { key, storageSlot };
};

export const releasePaidMutationKey = (
  lease: PaidMutationKeyLease | null,
  storage: StorageLike | null = browserSessionStorage(),
) => {
  if (!lease) return;
  try {
    storage?.removeItem(lease.storageSlot);
  } catch {
    // A successful response is authoritative; failure to clear browser storage is non-fatal.
  }
};

export const shouldRetainPaidMutationKey = (error: unknown) => {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = "status" in record
    ? Number(record.status)
    : Number.NaN;
  if (!Number.isFinite(status)) return true;
  if (status >= 500) return true;
  if ([408, 425, 429].includes(status)) return true;
  if (status !== 409) return false;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const code = String(data.code || record.code || "").trim();
  return [
    "social_paid_operation_in_progress",
    "social_paid_operation_reconciliation_required",
  ].includes(code);
};
