export interface ThrottledEmitter<T> {
  /** Emits immediately when idle; otherwise keeps only the latest value. */
  push(value: T): void;
  /** Cancels any pending timer and emits the kept value, if there is one. */
  flush(): void;
}

/**
 * Leading-edge throttle. The first value of a window is emitted at once, later
 * values collapse into the latest one, and a trailing timer flushes it.
 */
export function createThrottledEmitter<T>(
  emit: (value: T) => void,
  intervalMs: number,
): ThrottledEmitter<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | undefined;
  let hasPending = false;

  const flushPending = (): void => {
    if (!hasPending) {
      return;
    }
    const value = pending as T;
    pending = undefined;
    hasPending = false;
    emit(value);
  };

  return {
    push(value: T): void {
      if (timer === null) {
        emit(value);
        timer = setTimeout(() => {
          timer = null;
          flushPending();
        }, intervalMs);
        return;
      }
      pending = value;
      hasPending = true;
    },
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flushPending();
    },
  };
}
