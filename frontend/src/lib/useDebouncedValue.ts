import { useCallback, useEffect, useRef, useState } from 'react';

/** `value`, delayed until it has stopped changing for `delayMs`; `flush` applies the latest value immediately. */
export function useDebouncedValue<T>(value: T, delayMs: number): [T, () => void] {
  const [debounced, setDebounced] = useState(value);
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  const flush = useCallback(() => setDebounced(latest.current), []);
  return [debounced, flush];
}
