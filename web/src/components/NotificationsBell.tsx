import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useRealtime } from '../lib/socket';
import { toasts } from '../lib/toast';
import { relativeTime } from '../lib/format';
import type { NotificationItem, Session } from '../lib/types';
import { Avatar } from './ui';

interface NotificationsBellProps {
  session: Session;
}

/**
 * The bell and everything that follows from a new notification: the unread
 * badge, the desktop popup, and the in-app toast.
 *
 * It lives in the app shell rather than a single page, because a notification
 * you can only see on the home screen is barely a notification at all.
 */
export function NotificationsBell({ session }: NotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  // Fetched unconditionally — gating this on `open` would zero the badge every
  // time the panel collapses, which is exactly how the count went missing.
  const { data, reload } = useApi<{ notifications: NotificationItem[]; unread: number }>(
    '/notifications?limit=20',
  );

  useEffect(() => {
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;
    setPermission(await Notification.requestPermission());
  };

  /**
   * Decide how loudly to announce one notification.
   *
   * Desktop popup when the browser allows it and you couldn't already be
   * reading the thread; otherwise an in-app toast when you're on another page.
   * On the conversation itself the message is already on screen, so we stay
   * quiet.
   */
  const announce = (item: NotificationItem) => {
    const onConversation = window.location.pathname.startsWith('/messages');
    const canPop =
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      session.settings.browserNotifications;

    if (canPop && (document.hidden || !onConversation)) {
      new Notification(item.title, {
        body: item.preview ?? 'Open Our Little Space to see it',
        icon: '/favicon.svg',
        // Coalesce instead of stacking when several arrive together.
        tag: item.id,
      });
      return;
    }

    if (!onConversation) {
      toasts.info(item.preview ? `${item.title} — ${item.preview}` : item.title);
    }
  };

  // `notify()` only ever targets the recipient, so this never fires for your
  // own actions.
  useRealtime('notification:created', () => {
    reload();
    void api
      .get<{ notifications: NotificationItem[] }>('/notifications?limit=1')
      .then((result) => {
        const newest = result.notifications[0];
        if (newest && !newest.isRead) announce(newest);
      })
      .catch(() => undefined);
  });

  const markOne = async (item: NotificationItem) => {
    if (!item.isRead) await api.post('/notifications/read', { ids: [item.id] }).catch(() => undefined);
    reload();
  };

  const markAll = async () => {
    await api.post('/notifications/read', {}).catch(() => undefined);
    reload();
  };

  const unread = data?.unread ?? 0;

  return (
    <div ref={rootRef} className="fixed right-4 top-4 z-30 sm:right-6 sm:top-6">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-lg shadow-card transition-shadow hover:shadow-lift"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white ring-2 ring-canvas">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18 }}
          className="absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="font-sans text-ink">Notifications</p>
            {permission === 'default' && (
              <button type="button" onClick={() => void requestPermission()} className="shrink-0 text-xs text-rose-600 hover:underline">
                Enable pop-ups
              </button>
            )}
            {permission === 'granted' && !session.settings.browserNotifications && (
              <span className="shrink-0 text-xs text-ink-faint">Pop-ups off</span>
            )}
            {permission === 'denied' && (
              <span className="shrink-0 text-xs text-ink-faint">Blocked by browser</span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {!data && <p className="px-4 py-6 text-center text-sm text-ink-faint">Loading…</p>}
            {data && data.notifications.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-ink-faint">Nothing waiting for you.</p>
            )}
            {data?.notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  void markOne(item);
                  navigate(hrefFor(item));
                }}
                className="flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-sunk"
              >
                {item.actor ? (
                  <Avatar name={item.actor.name} src={item.actor.profileImage} id={item.actor.id} size="sm" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-50 text-sm">
                    🔔
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{item.title}</span>
                  {item.preview && <span className="block truncate text-xs text-ink-faint">{item.preview}</span>}
                  <span className="mt-0.5 block text-[11px] text-ink-faint/80">{relativeTime(item.createdAt)}</span>
                </span>
                {!item.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />}
              </button>
            ))}
          </div>

          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAll()}
              className="w-full border-t border-line px-4 py-2.5 text-xs text-rose-600 transition-colors hover:bg-rose-50"
            >
              Mark all as read
            </button>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** Where does this notification want to take you? */
function hrefFor(item: NotificationItem): string {
  const { kind, id } = item.target;
  if (!kind || !id) return '/';
  if (kind === 'message') return `/messages?replyTo=${encodeURIComponent(id)}`;
  if (kind === 'diary') return `/diary/${encodeURIComponent(id)}`;
  if (kind === 'collection') return `/collections/${encodeURIComponent(id)}`;
  return '/memories';
}
