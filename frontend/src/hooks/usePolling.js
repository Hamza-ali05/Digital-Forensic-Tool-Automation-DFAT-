import { useCallback, useEffect, useRef, useState } from "react";

import usePageVisibility from "hooks/usePageVisibility";

/**
 * Poll ``fetchFunction`` on an interval while enabled.
 * Skips overlapping ticks and pauses when the browser tab is hidden.
 *
 * @param {Function} fetchFunction Async fetcher (no args).
 * @param {number} intervalMs Poll interval in milliseconds.
 * @param {boolean} [enabled=true] When false, polling is paused.
 */
export default function usePolling(fetchFunction, intervalMs, enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(Boolean(enabled));
  const pageVisible = usePageVisibility();

  const fnRef = useRef(fetchFunction);
  fnRef.current = fetchFunction;
  const intervalRef = useRef(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const tick = useCallback(async (isInitial) => {
    if (inFlightRef.current) return undefined;
    inFlightRef.current = true;
    if (isInitial && mountedRef.current) {
      setLoading(true);
    }
    try {
      const result = await fnRef.current();
      const payload =
        result &&
        typeof result === "object" &&
        Object.prototype.hasOwnProperty.call(result, "data") &&
        Object.prototype.hasOwnProperty.call(result, "status") &&
        Object.prototype.hasOwnProperty.call(result, "config")
          ? result.data
          : result;
      if (mountedRef.current) {
        setData(payload);
        setError(null);
        setLoading(false);
      }
      return payload;
    } catch (err) {
      if (mountedRef.current) {
        setError(err);
        setLoading(false);
      }
      return undefined;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    clearTimer();
    setIsPolling(false);
  }, [clearTimer]);

  const startPolling = useCallback(() => {
    setIsPolling(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  useEffect(() => {
    clearTimer();

    if (!enabled || !isPolling || !pageVisible) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      if (!cancelled) {
        await tick(true);
      }
    })();

    const ms = Math.max(250, Number(intervalMs) || 5000);
    intervalRef.current = window.setInterval(() => {
      tick(false);
    }, ms);

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [enabled, isPolling, intervalMs, pageVisible, tick, clearTimer]);

  return {
    data,
    loading,
    error,
    isPolling: Boolean(enabled && isPolling && pageVisible),
    stopPolling,
    startPolling,
  };
}
