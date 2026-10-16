"use client";

/**
 * Minimal data hooks (no extra dependency). Reads that resolve synchronously (fixtures) render on the
 * first pass, including on the server; live reads show a loading state and then the parsed data.
 * Mutations call invalidate(tag) so every subscribed view refetches.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getApi, type AgentApi } from "./index";
import { isPromise, type MaybePromise } from "./client";

type Listener = () => void;
const versions = new Map<string, number>();
const listeners = new Set<Listener>();

export function invalidate(...tags: string[]) {
  for (const t of tags) versions.set(t, (versions.get(t) ?? 0) + 1);
  listeners.forEach((l) => l());
}

function useTagVersion(tags: string[]): string {
  const key = tags.join("|");
  const get = useCallback(() => tags.map((t) => versions.get(t) ?? 0).join("."), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    () => tags.map(() => 0).join("."),
  );
}

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/**
 * useAgent("receipts", (api) => api.receipts({ limit: 20 }), ["receipts"])
 * `key` identifies the request (include ids), `tags` decide which mutations refresh it.
 */
export function useAgent<T>(key: string, load: (api: AgentApi) => MaybePromise<T>, tags: string[] = [key]): QueryState<T> {
  const version = useTagVersion(tags);
  const loadRef = useRef(load);
  loadRef.current = load;

  const [state, setState] = useState<{ key: string; data?: T; error?: Error; loading: boolean }>(() => {
    // Only the fixture adapter answers synchronously; live reads never start during render
    // (and never on the server, so `next build` does not depend on the agent service).
    if (getApi().mode !== "fixtures") return { key, loading: true };
    try {
      const r = load(getApi());
      if (!isPromise(r)) return { key, data: r, loading: false };
      r.catch(() => undefined);
      return { key, loading: true };
    } catch (e) {
      return { key, error: e as Error, loading: false };
    }
  });
  const [nonce, setNonce] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    // On the first run the synchronous result is already in state.
    if (first.current && !state.loading && state.key === key) {
      first.current = false;
      return;
    }
    first.current = false;
    let r: MaybePromise<T>;
    try {
      r = loadRef.current(getApi());
    } catch (e) {
      setState({ key, error: e as Error, loading: false });
      return;
    }
    if (!isPromise(r)) {
      setState({ key, data: r, loading: false });
      return;
    }
    setState((s) => ({ ...s, key, loading: true }));
    r.then(
      (data) => !cancelled && setState({ key, data, loading: false }),
      (error: Error) => !cancelled && setState((s) => ({ key, data: s.key === key ? s.data : undefined, error, loading: false })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, nonce]);

  return {
    data: state.key === key ? state.data : undefined,
    error: state.error,
    loading: state.loading,
    refetch: () => setNonce((n) => n + 1),
  };
}

/** Mutation helper with pending and error state. */
export function useMutation<A extends unknown[], R>(fn: (api: AgentApi, ...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(undefined);
      try {
        return await fn(getApi(), ...args);
      } catch (e) {
        setError(e as Error);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { run, pending, error, reset: () => setError(undefined) };
}
