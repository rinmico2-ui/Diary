import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface FavoriteButtonProps {
  isFavorite: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const SIZES = { sm: 'h-7 w-7 text-sm', md: 'h-9 w-9 text-base', lg: 'h-11 w-11 text-lg' } as const;

/**
 * The heart animates its own little burst so favouriting feels like a moment
 * rather than a state change.
 */
export function FavoriteButton({ isFavorite, onToggle, size = 'md', className = '', label }: FavoriteButtonProps) {
  const [burst, setBurst] = useState(0);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (!isFavorite) setBurst((n) => n + 1);
          onToggle();
        }}
        aria-pressed={isFavorite}
        aria-label={label ?? (isFavorite ? 'Remove from favorites' : 'Add to favorites')}
        className={`${SIZES[size]} flex items-center justify-center rounded-full transition-all duration-200
                    active:scale-90 ${
                      isFavorite
                        ? 'text-rose-500 hover:bg-rose-50'
                        : 'text-ink-faint/70 hover:bg-rose-50/80 hover:text-rose-400'
                    }`}
      >
        {isFavorite ? '❤️' : '🤍'}
      </button>

      {burst > 0 && (
        <span key={burst} aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <motion.span
            initial={{ opacity: 0.9, scale: 0.4 }}
            animate={{ opacity: 0, scale: 1.9 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="absolute text-2xl"
          >
            ❤️
          </motion.span>
        </span>
      )}
    </span>
  );
}

interface ChipProps {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  as?: 'button' | 'span';
}

export function Chip({ children, onClick, active, className = '', as }: ChipProps) {
  const classes = `${active ? 'chip chip-active' : 'chip'} ${onClick ? 'hover:border-rose-300 hover:bg-rose-50' : ''} ${className}`;
  if (as === 'span' || !onClick) {
    return <span className={classes}>{children}</span>;
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  );
}

export function TagRow({ tags, onRemove }: { tags: string[]; onRemove?: (tag: string) => void }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-pill bg-rose-50 px-2.5 py-0.5 text-[11px] text-rose-700"
        >
          #{tag}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(tag)}
              aria-label={`Remove tag ${tag}`}
              className="text-rose-400 transition-colors hover:text-rose-600"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

interface VisibilityPillProps {
  visibility: 'PRIVATE' | 'SHARED';
  className?: string;
}

export function VisibilityPill({ visibility, className = '' }: VisibilityPillProps) {
  return visibility === 'PRIVATE' ? (
    <span className={`inline-flex items-center gap-1 rounded-pill bg-surface-sunk px-2.5 py-0.5 text-[11px] text-ink-soft ${className}`}>
      🔒 Only me
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 rounded-pill bg-rose-50 px-2.5 py-0.5 text-[11px] text-rose-700 ${className}`}>
      ❤️ Both of us
    </span>
  );
}
