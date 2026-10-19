import { useSyncExternalStore } from "react";

let pendingWrites = 0;
const listeners = new Set<() => void>();

export const getPendingWriteCount = () => pendingWrites;

export function subscribePendingWrites(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingWriteCount() {
  return useSyncExternalStore(subscribePendingWrites, getPendingWriteCount);
}

/** Keep non-React-Query saves visible to navigation and refresh controls. */
export async function withPendingWrite<T>(operation: () => Promise<T>): Promise<T> {
  pendingWrites++;
  listeners.forEach(listener => listener());
  try {
    return await operation();
  } finally {
    pendingWrites--;
    listeners.forEach(listener => listener());
  }
}
