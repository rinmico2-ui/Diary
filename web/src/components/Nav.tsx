import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Avatar } from './ui';
import type { Session } from '../lib/types';
import { relativeTime } from '../lib/format';

export interface NavItem {
  to: string;
  label: string;
  emoji: string;
  badge?: number;
}

/** Mobile bottom bar: five destinations, thumb-reachable. */
export function BottomNav({ items, onAdd }: { items: NavItem[]; onAdd: () => void }) {
  const { pathname } = useLocation();

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/92 backdrop-blur-xl sm:hidden">
        <div className="safe-bottom grid grid-cols-6 items-end px-1 pb-1 pt-1.5">
          {items.slice(0, 3).map((item) => (
            <BottomLink key={item.to} item={item} active={isActive(pathname, item.to)} />
          ))}

          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a memory"
            className="group flex flex-col items-center justify-center gap-0.5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500 text-xl text-white shadow-lift transition-transform active:scale-90">
              ＋
            </span>
            <span className="text-[10px] font-medium text-rose-600">Add</span>
          </button>

          {items.slice(3, 5).map((item) => (
            <BottomLink key={item.to} item={item} active={isActive(pathname, item.to)} />
          ))}
        </div>
      </nav>
      {items.length > 5 && null}
    </>
  );
}

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <NavLink
      to={item.to}
      className="relative flex flex-col items-center justify-center gap-0.5 py-1"
      aria-current={active ? 'page' : undefined}
    >
      <span className="relative flex h-7 w-10 items-center justify-center">
        {active && (
          <motion.span
            layoutId="bottom-nav-pill"
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="absolute inset-0 rounded-full bg-rose-100/80"
          />
        )}
        <span className="relative text-lg leading-none">{item.emoji}</span>

        {item.badge !== undefined && item.badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {item.badge > 9 ? '9+' : item.badge}
          </span>
        )}
      </span>
      <span className={`text-[10px] ${active ? 'font-medium text-rose-700' : 'text-ink-faint'}`}>{item.label}</span>
    </NavLink>
  );
}

/** Desktop rail — quiet, mostly out of the way. */
export function SideNav({ items, session, onAdd }: { items: NavItem[]; session: Session; onAdd: () => void }) {
  const { pathname } = useLocation();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-canvas/80 px-4 py-6 backdrop-blur-xl sm:flex lg:w-72">
      <div className="px-2">
        <p className="font-sans text-xl leading-tight text-ink">{session.space.name}</p>
        <p className="muted mt-0.5">A private little world</p>
      </div>

      <button type="button" onClick={onAdd} className="btn-primary mt-6 w-full">
        ＋ Add memory
      </button>

      <nav className="mt-6 flex flex-1 flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
                active ? 'bg-rose-50 font-medium text-rose-700' : 'text-ink-soft hover:bg-surface-sunk'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="text-lg leading-none">{item.emoji}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <PartnerCard session={session} />
    </aside>
  );
}

function PartnerCard({ session }: { session: Session }) {
  const partner = session.partner;
  if (!partner) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface/70 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={partner.name} src={partner.profileImage} id={partner.id} size="md" showPresence online={partner.isOnline} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{partner.name}</p>
          <p className="truncate text-xs text-ink-faint">
            {partner.isOnline ? 'Online now' : partner.lastSeenAt ? `Last seen ${relativeTime(partner.lastSeenAt)}` : 'Away'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Floating add button for tablet and desktop, above the content. */
export function FloatingAdd({ onClick, label = 'Add Memory' }: { onClick: () => void; label?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 320);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={false}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.9, y: visible ? 0 : 10 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
      className="fixed bottom-6 right-5 z-30 flex h-14 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-canvas shadow-float transition-transform active:scale-95 sm:hidden"
      aria-label={label}
    >
      <span className="text-lg leading-none">＋</span>
      {label}
    </motion.button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="muted mb-1">{eyebrow}</p>}
        <h1 className="heading-xl">{title}</h1>
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
