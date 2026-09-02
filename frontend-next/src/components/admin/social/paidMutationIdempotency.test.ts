import { describe, expect, it } from "vitest";
import {
  acquirePaidMutationKey,
  releasePaidMutationKey,
  shouldRetainPaidMutationKey,
} from "./paidMutationIdempotency";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

describe("paid Social Manager mutation idempotency", () => {
  it("reuses one key for the same action and payload until a definitive result", () => {
    const storage = memoryStorage();
    const identity = {
      actionKey: "regenerate-copy",
      draftId: "draft-1",
      revision: 4,
      body: { scope: "caption", instructions: "Tighten this sentence" },
    };
    const first = acquirePaidMutationKey(identity, storage);
    const second = acquirePaidMutationKey({ ...identity, body: { instructions: "Tighten this sentence", scope: "caption" } }, storage);
    expect(second.key).toBe(first.key);

    releasePaidMutationKey(first, storage);
    const third = acquirePaidMutationKey(identity, storage);
    expect(third.key).not.toBe(first.key);
  });

  it("retains an uncertain attempt but rotates after the server confirms that paid operation failed", () => {
    const storage = memoryStorage();
    const identity = {
      actionKey: "duplicate",
      draftId: "draft-2",
      revision: 7,
      body: {},
    };
    const first = acquirePaidMutationKey(identity, storage);
    expect(shouldRetainPaidMutationKey(new Error("network response lost"))).toBe(true);
    expect(shouldRetainPaidMutationKey({ status: 503 })).toBe(true);
    expect(acquirePaidMutationKey(identity, storage).key).toBe(first.key);
    expect(acquirePaidMutationKey({ ...identity, revision: 8 }, storage).key).toBe(first.key);
    const terminal = { status: 409, data: { code: "social_paid_operation_failed" } };
    expect(shouldRetainPaidMutationKey(terminal)).toBe(false);
    releasePaidMutationKey(first, storage);
    expect(acquirePaidMutationKey(identity, storage).key).not.toBe(first.key);

    expect(shouldRetainPaidMutationKey({ status: 409, data: { code: "social_paid_operation_in_progress" } })).toBe(true);
    expect(shouldRetainPaidMutationKey({ status: 409, data: { code: "social_paid_operation_reconciliation_required" } })).toBe(true);
    expect(shouldRetainPaidMutationKey({ status: 409, data: { code: "social_paid_operation_idempotency_conflict" } })).toBe(false);
    expect(shouldRetainPaidMutationKey({ status: 422 })).toBe(false);
  });
});
