import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
}

export interface Fetcher<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  reload: () => void;
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

/**
 * Small data hook. Deliberately not a caching library — this app has six
 * surfaces and a refetch-on-focus is exactly the right amount of machinery.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): Fetcher<T> {
  const [state, setState] = useState<State<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
    refreshing: false,
  });
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null, refreshing: false });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({
      ...current,
      loading: current.data === null,
      refreshing: current.data !== null,
      error: null,
    }));

    api
      .get<T>(path, controller.signal)
      .then((data) => {
        if (controller.signal.aborted || !mounted.current) return;
        setState({ data, loading: false, error: null, refreshing: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          data: null,
          loading: false,
          refreshing: false,
          error: error instanceof Error ? error.message : 'That did not load.',
        });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const setData = useCallback((updater: T | ((current: T | null) => T | null)) => {
    setState((current) => ({
      ...current,
      data:
        typeof updater === 'function'
          ? (updater as (c: T | null) => T | null)(current.data)
          : updater,
    }));
  }, []);

  return { ...state, reload, setData };
}

/** Debounces a rapidly changing value (search boxes, resize handlers). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/** Runs a callback when the user has stopped typing for `delay` ms. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const timer = useRef<number | null>(null);
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => saved.current(...args), delay);
    },
    [delay],
  );
}
