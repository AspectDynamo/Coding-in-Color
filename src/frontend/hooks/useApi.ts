import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '@frontend/services/api';

interface QueryState<T> {
  key: string | null;
  data: T | undefined;
  error: ApiRequestError | Error | null;
}

export interface QueryResult<T> {
  /** Data for the current key (or the previous key's data while loading when keepPrevious). */
  data: T | undefined;
  error: ApiRequestError | Error | null;
  /** True until the current key has resolved (success or error). */
  loading: boolean;
  /** True while any request is in flight (initial, key change, manual or polled refetch). */
  fetching: boolean;
  refetch: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

/**
 * Minimal query hook. `key` identifies the request (null = disabled); a new key refetches.
 * Stale responses are ignored. Optional polling pauses while the tab is hidden.
 */
export function useQuery<T>(
  key: string | null,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: { keepPrevious?: boolean; pollMs?: number } = {},
): QueryResult<T> {
  const [state, setState] = useState<QueryState<T>>({ key: null, data: undefined, error: null });
  const [nonce, setNonce] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    let live = true;
    let counted = false;
    Promise.resolve()
      .then(() => {
        if (!live) throw new DOMException('Aborted', 'AbortError');
        counted = true;
        setInFlight((n) => n + 1);
        return fnRef.current(ctrl.signal);
      })
      .then(
        (data) => {
          if (live) setState({ key, data, error: null });
        },
        (error: unknown) => {
          if (!live || (error instanceof DOMException && error.name === 'AbortError')) return;
          setState((prev) => ({
            key,
            data: prev.key === key ? prev.data : undefined,
            error: error instanceof Error ? error : new Error('Request failed'),
          }));
        },
      )
      .finally(() => {
        if (counted) setInFlight((n) => Math.max(0, n - 1));
      });
    return () => {
      live = false;
      ctrl.abort();
    };
  }, [key, nonce]);

  const pollMs = opts.pollMs;
  useEffect(() => {
    if (!pollMs || key === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNonce((n) => n + 1);
    }, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, key]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (updater: (prev: T | undefined) => T | undefined) =>
      setState((s) => ({ ...s, data: updater(s.data) })),
    [],
  );

  const current = state.key === key;
  return {
    data: current || opts.keepPrevious ? state.data : undefined,
    error: current ? state.error : null,
    loading: key !== null && !current,
    fetching: inFlight > 0,
    refetch,
    setData,
  };
}

export interface MutationResult<A, R> {
  run: (args: A) => Promise<R>;
  loading: boolean;
  error: ApiRequestError | Error | null;
  reset: () => void;
}

/** Mutation helper: tracks loading/error; `run` rethrows so callers can branch on error codes. */
export function useMutation<A, R>(fn: (args: A) => Promise<R>): MutationResult<A, R> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const run = useCallback(async (args: A) => {
    setLoading(true);
    setError(null);
    try {
      return await fnRef.current(args);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Request failed'));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  const reset = useCallback(() => setError(null), []);
  return { run, loading, error, reset };
}
