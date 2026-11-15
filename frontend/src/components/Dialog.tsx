import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  variant?: 'confirm' | 'drawer';
}

/**
 * Native <dialog> (modal, focus-trapped, Escape closes). Falls back to the
 * `open` attribute where showModal is unavailable (for example jsdom).
 */
export function Dialog({ open, title, onClose, children, actions, variant = 'confirm' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    // The <dialog> is unmounted as soon as `open` turns false, so focus is given back from this effect's cleanup, not from a branch that
    // runs when the dialog is already gone (CR-72).
    const dialog = ref.current;
    opener.current = document.activeElement;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      const target = opener.current;
      opener.current = null;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={variant}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-quiet" onClick={onClose} aria-label={`Close ${title}`}>
          ✕
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {actions ? <div className="dialog-actions">{actions}</div> : null}
    </dialog>
  );
}
