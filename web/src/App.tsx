import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'sonner';
import { useSession } from './lib/useSession';
import type { Session } from './lib/types';
import { useApi } from './lib/hooks';
import { AddMemoryProvider, useAddMemory } from './lib/addMemory';
import { getSocket, useConnectionState, useRealtime } from './lib/socket';
import { BottomNav, SideNav, type NavItem } from './components/Nav';
import { NotificationsBell } from './components/NotificationsBell';
import { Loader } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './pages/AuthGate';
import { HomePage } from './pages/Home';
import { MessagesPage } from './pages/Messages';
import { DiaryPage } from './pages/Diary';
import { DiaryEntryPage } from './pages/DiaryEntry';
import { MemoriesPage } from './pages/Memories';
import { CollectionsPage, CollectionDetailPage } from './pages/Collections';
import { FavoritesPage } from './pages/Favorites';
import { TimelinePage } from './pages/Timeline';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter
      // Opt in to the v7 behaviours now so the console stays clean and the
      // upgrade is a version bump rather than a behaviour change.
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: '#ffffff',
            border: '1px solid #eadfd6',
            borderRadius: '1rem',
            color: '#2f2723',
            fontSize: '0.875rem',
          },
        }}
      />
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </BrowserRouter>
  );
}

function Root() {
  const { session, status, refresh, signOut } = useSession();
  const location = useLocation();

  // Unread counts live here so the badges work on every page.
  const summary = useApi<{ unreadCount: number; lastMessage: { content: string | null; senderId: string; createdAt: string } | null }>(
    session ? '/messages/summary' : null,
  );

  useEffect(() => {
    if (session) getSocket();
  }, [session]);

  if (status === 'loading') return <Loader label="Opening your space…" />;

  if (status === 'anonymous' || status === 'forbidden') {
    return <AuthGate onSignedIn={refresh} />;
  }

  if (!session) return <Loader />;

  const items: NavItem[] = [
    { to: '/', label: 'Home', emoji: '🏠' },
    { to: '/messages', label: 'Messages', emoji: '💬', badge: summary.data?.unreadCount },
    { to: '/diary', label: 'Diary', emoji: '📖' },
    { to: '/memories', label: 'Memories', emoji: '📸' },
    { to: '/collections', label: 'Collections', emoji: '📁' },
  ];

  return (
    <AddMemoryProvider>
      <Shell
        items={items}
        isChat={location.pathname === '/messages'}
        session={session}
        onUnreadChanged={summary.reload}
      >
        <Routes>
          <Route path="/" element={<HomePage session={session} />} />
          <Route path="/messages" element={<MessagesPage session={session} />} />
          <Route path="/diary" element={<DiaryPage session={session} />} />
          <Route path="/diary/:id" element={<DiaryEntryPage session={session} />} />
          <Route path="/memories" element={<MemoriesPage session={session} />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/collections/:id" element={<CollectionDetailPage />} />
          <Route path="/favorites" element={<FavoritesPage session={session} />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage session={session} onSignOut={signOut} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </AddMemoryProvider>
  );
}

/** Nav rail, bottom bar and a gentle page transition around the routes. */
function Shell({
  items,
  isChat,
  session,
  onUnreadChanged,
  children,
}: {
  items: NavItem[];
  isChat: boolean;
  session: Session;
  onUnreadChanged: () => void;
  children: React.ReactNode;
}) {
  const { open } = useAddMemory();
  const navigate = useNavigate();
  const connection = useConnectionState();
  const location = useLocation();

  // Keep the nav badge honest: it must tick up when they write and clear when
  // you read — on every page, not just at boot. Shell only mounts once signed
  // in, so this never tries to open a socket on the login screen.
  useRealtime('message:created', onUnreadChanged);
  useRealtime('message:read', onUnreadChanged);

  return (
    <div className="min-h-dvh">
      <SideNav items={items} session={session} onAdd={() => open('photos')} />

      {/* Present on every route except the conversation itself, where the
          thread is already on screen and the header has no room for it. */}
      {!isChat && <NotificationsBell session={session} />}

      <AnimatePresence mode="wait">
        <motion.main
          key={isChat ? 'chat' : `page-${location.pathname}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className={isChat ? '' : 'sm:pl-64 lg:pl-72'}
        >
          {children}
        </motion.main>
      </AnimatePresence>

      <BottomNav items={items} onAdd={() => open('photos')} />

      {connection !== 'online' && <ConnectionBanner state={connection} />}

      {/* Secondary destinations, reachable on desktop without crowding the rail. */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-20 hidden flex-col items-end gap-2 sm:flex">
        {(
          [
            { to: '/favorites', emoji: '❤️', label: 'Favorites' },
            { to: '/timeline', emoji: '📅', label: 'Timeline' },
            { to: '/search', emoji: '🔍', label: 'Search' },
            { to: '/settings', emoji: '⚙️', label: 'Settings' },
          ] as const
        ).map((item) => (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            aria-label={item.label}
            title={item.label}
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-base shadow-card transition-transform hover:scale-105 active:scale-95"
          >
            {item.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConnectionBanner({ state }: { state: 'connecting' | 'online' | 'offline' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed left-1/2 top-3 z-40 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-1.5 text-xs text-ink-soft shadow-card"
    >
      {state === 'connecting' ? 'Reconnecting…' : 'Offline — your memories are safe'}
    </motion.div>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="page py-24 text-center">
      <p className="text-4xl" aria-hidden>
        🌙
      </p>
      <h1 className="mt-4 font-sans text-xl">This page does not exist</h1>
      <p className="mt-2 text-sm text-ink-faint">Everything worth finding is on the home page.</p>
      <button type="button" className="btn-primary mt-6" onClick={() => navigate('/')}>
        Back home
      </button>
    </div>
  );
}
