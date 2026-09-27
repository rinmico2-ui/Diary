import { AnimatePresence, motion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** 'auto' fills the height on desktop and slides up from the bottom on mobile. */
  size?: 'auto' | 'tall' | 'wide';
}

const SIZES = {
  auto: 'sm:max-w-lg',
  tall: 'sm:max-w-2xl',
  wide: 'sm:max-w-4xl',
} as const;

/**
 * The app's only modal surface. On phones it behaves like a native sheet;
 * on desktop it becomes a centred card. Escape and backdrop both close it.
 */
export function Sheet({ open, onClose, title, children, size = 'auto' }: SheetProps) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-ink/50 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.985 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
            }}
            className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] border border-line
                        bg-canvas shadow-float sm:rounded-card ${SIZES[size]}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/80 px-5 py-4 backdrop-blur">
              <h2 className="font-sans text-lg text-ink">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="btn-ghost -mr-2 h-9 w-9 rounded-full p-0 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warm' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

/** Used before anything irreversible, phrased in this app's gentle voice. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Yes, go ahead',
  cancelLabel = 'Never mind',
  tone = 'warm',
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-5">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-ink/55 backdrop-blur-sm"
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-sm rounded-card border border-line bg-canvas p-6 text-center shadow-float"
          >
            <h3 className="font-sans text-lg text-ink">{title}</h3>
            <div className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="btn-secondary" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={tone === 'danger' ? 'btn bg-ink text-canvas hover:bg-ink-soft' : 'btn-primary'}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Lightweight dropdown anchored to its trigger. */
export function Menu({
  trigger,
  children,
  align = 'right',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={`absolute z-40 mt-2 min-w-[13rem] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-float ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-ink-soft hover:bg-rose-50 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
