import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { initials } from '../lib/format';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<Size, string> = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-14 w-14 text-sm',
  xl: 'h-20 w-20 text-lg',
};

const TINTS = [
  'bg-rose-100 text-rose-700',
  'bg-sage-100 text-sage-600',
  'bg-sand-100 text-sand-500',
  'bg-rose-50 text-rose-600',
];

function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length]!;
}

interface AvatarProps {
  name: string;
  src?: string | null;
  id?: string;
  size?: Size;
  online?: boolean;
  className?: string;
  showPresence?: boolean;
}

export function Avatar({ name, src, id = name, size = 'md', online, className = '', showPresence = false }: AvatarProps) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {src ? (
        <img
          src={src}
          alt=""
          className={`${SIZES[size]} rounded-full object-cover ring-1 ring-line`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span
          aria-hidden
          className={`${SIZES[size]} ${tintFor(id)} flex items-center justify-center rounded-full font-sans font-medium ring-1 ring-line/70`}
        >
          {initials(name)}
        </span>
      )}

      {showPresence && online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 block rounded-full ring-2 ring-canvas transition-colors ${
            size === 'sm' ? 'h-2.5 w-2.5' : size === 'xl' ? 'h-4 w-4' : 'h-3 w-3'
          } ${online ? 'bg-sage-400' : 'bg-ink-faint/50'}`}
          title={online ? 'Online now' : 'Away'}
        />
      )}
    </span>
  );
}

interface SectionProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, subtitle, action, children, className = '' }: SectionProps) {
  return (
    <section className={`space-y-3 ${className}`}>
      <header className="flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h2 className="font-sans text-lg text-ink">{title}</h2>
          {subtitle && <p className="muted mt-0.5 truncate">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

interface EmptyProps {
  emoji?: string;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}

/** Empty states are meant to feel like an invitation, not an error. */
export function EmptyState({ emoji = '❤️', title, body, action, className = '' }: EmptyProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface/60 px-6 py-14 text-center ${className}`}
    >
      <motion.span
        aria-hidden
        className="mb-4 text-4xl"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        {emoji}
      </motion.span>
      <h3 className="font-sans text-lg text-ink">{title}</h3>
      {body && <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-faint">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface-sunk ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}

export function Loader({ label = 'Gathering your memories…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="relative flex h-10 w-10">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-200/50" />
        <span className="relative inline-flex h-10 w-10 rounded-full bg-rose-100" />
      </span>
      <p className="muted">{label}</p>
    </div>
  );
}

/** A soft, full-bleed scrim used behind the photo viewer. */
export function Backdrop({ onClick, className = '' }: { onClick?: () => void; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClick}
      className={`fixed inset-0 z-40 bg-ink/80 backdrop-blur-md ${className}`}
    />
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
