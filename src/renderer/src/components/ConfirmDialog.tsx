import { useEffect, useId, useRef } from 'react';
import { useConfirmStore } from '../stores/confirm';

/**
 * Hosts the first queued confirmation. Mounted once at the App root so every
 * panel uses the same in-renderer dialog instead of Electron's native modal.
 */
export function ConfirmDialog(): React.JSX.Element | null {
  const request = useConfirmStore((state) => state.requests[0] ?? null);
  const resolve = useConfirmStore((state) => state.resolve);
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (request === null) {
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();
    // The close path is shared by buttons, Escape and the overlay, so focus
    // restoration belongs to the request's teardown rather than each handler.
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous !== null && previous.isConnected) {
        previous.focus();
      }
    };
  }, [request?.id]);

  useEffect(() => {
    if (request === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      resolve(request.id, false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [request, resolve]);

  if (request === null) {
    return null;
  }

  const confirmClass =
    request.tone === 'danger'
      ? 'primary-button confirm-dialog-confirm danger'
      : 'primary-button confirm-dialog-confirm';

  return (
    <div
      className="confirm-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          resolve(request.id, false);
        }
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 className="confirm-dialog-title" id={titleId}>
          {request.title}
        </h2>
        <p className="confirm-dialog-message" id={messageId}>
          {request.message}
        </p>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="secondary-button confirm-dialog-cancel"
            onClick={() => resolve(request.id, false)}
          >
            {request.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            className={confirmClass}
            onClick={() => resolve(request.id, true)}
          >
            {request.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}
