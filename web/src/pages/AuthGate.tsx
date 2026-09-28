import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ApiError } from '../lib/api';
import { Spinner } from '../components/ui';

interface GateProps {
  onSignedIn: () => unknown;
}

type Mode = 'login' | 'join' | 'forgot' | 'reset';

/** The sign-in screens are not routes, so the URL picks the screen for us —
 *  which is how the link inside a reset email lands on the right form. */
function modeFromPath(pathname: string): Mode {
  if (pathname.startsWith('/reset-password')) return 'reset';
  if (pathname.startsWith('/forgot-password')) return 'forgot';
  return 'login';
}

type TokenState = 'checking' | 'ok' | 'bad' | 'missing';

export function AuthGate({ onSignedIn }: GateProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>(() => modeFromPath(location.pathname));
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [resetForm, setResetForm] = useState({ newPassword: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [codeState, setCodeState] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [codeError, setCodeError] = useState('');
  // The code field is hidden by default: most people arriving here are the
  // first, and an empty box that looks required is a bad invitation to guess.
  const [hasCodeField, setHasCodeField] = useState(false);
  const [sent, setSent] = useState<{ message: string } | null>(null);

  const resetToken =
    modeFromPath(location.pathname) === 'reset'
      ? (new URLSearchParams(location.search).get('token') ?? '').trim()
      : '';

  const [tokenState, setTokenState] = useState<TokenState>(() =>
    modeFromPath(location.pathname) === 'reset' ? (resetToken ? 'checking' : 'missing') : 'ok',
  );

  // Keeps the browser back/forward buttons honest when the URL names a screen.
  useEffect(() => {
    setMode((current) => {
      const fromPath = modeFromPath(location.pathname);
      if (fromPath !== 'login') return fromPath;
      return current === 'reset' || current === 'forgot' ? 'login' : current;
    });
  }, [location.pathname]);

  // Tell the person straight away when a link is dead, before they invent a
  // password and only then discover it was pointless.
  useEffect(() => {
    if (mode !== 'reset') return;
    if (!resetToken) {
      setTokenState('missing');
      return;
    }

    let cancelled = false;
    setTokenState('checking');
    fetch(`/api/auth/reset-password/${encodeURIComponent(resetToken)}`, { credentials: 'include' })
      .then((response) => {
        if (!cancelled) setTokenState(response.ok ? 'ok' : 'bad');
      })
      .catch(() => {
        if (!cancelled) setTokenState('bad');
      });

    return () => {
      cancelled = true;
    };
  }, [mode, resetToken]);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    if (key === 'inviteCode') setCodeState('idle');
  };

  function goTo(next: Mode) {
    const path = next === 'forgot' ? '/forgot-password' : '/';
    setMode(next);
    setError(null);
    setSent(null);
    setCodeState('idle');
    setHasCodeField(false);
    if (location.pathname !== path) navigate(path);
  }

  /** Confirms a code before the person bothers typing a full password. */
  async function checkCode() {
    setChecking(true);
    setCodeState('idle');
    try {
      const response = await fetch('/api/auth/check-invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteCode: form.inviteCode }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;

      if (!response.ok) {
        setCodeState('bad');
        setCodeError(payload?.error?.message ?? 'That code did not work.');
        return;
      }
      setCodeState('ok');
    } catch {
      setCodeState('bad');
      setCodeError('Could not reach the server. Try again in a moment.');
    } finally {
      setChecking(false);
    }
  }

  async function post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string; code?: string } }
        | null;
      throw new ApiError(response.status, payload?.error?.message ?? 'That did not work.', payload?.error?.code);
    }

    return response;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', form);
      await onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await post('/api/auth/forgot-password', { email: form.email });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      setSent({ message: payload?.message ?? 'If an account uses that email, a reset link is on its way.' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (resetForm.newPassword !== resetForm.confirm) {
      setError('Both passwords need to match.');
      return;
    }

    setBusy(true);
    try {
      await post('/api/auth/reset-password', { token: resetToken, newPassword: resetForm.newPassword });
      await onSignedIn();
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className="rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
    >
      {error}
    </motion.p>
  );

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <motion.span
            aria-hidden
            className="inline-block text-4xl"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          >
            ❤️
          </motion.span>
          <h1 className="mt-4 font-sans text-[1.75rem] leading-tight">Our Little Space</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-faint">
            {mode === 'forgot'
              ? 'Let us get you back inside your space.'
              : mode === 'reset'
                ? 'One last step and you are back in.'
                : 'A private world for two people. No one else can see a single thing in here.'}
          </p>
        </div>

        {mode === 'forgot' ? (
          sent ? (
            <div className="card space-y-4 p-6 text-center">
              <span aria-hidden className="text-3xl">
                💌
              </span>
              <p className="text-sm leading-relaxed text-ink-soft">{sent.message}</p>
              <p className="text-xs leading-relaxed text-ink-faint">
                The link works once and expires in 30 minutes. Nothing arrives? Check the spam folder, or
                make sure SMTP is set in <span className="font-medium">server/.env</span>.
              </p>
              <button type="button" onClick={() => goTo('login')} className="btn-secondary w-full">
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submitForgot} className="card space-y-4 p-6">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className="field"
                  value={form.email}
                  onChange={update('email')}
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>

              {errorBox}

              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <Spinner className="h-4 w-4" /> : 'Send reset link'}
              </button>
            </form>
          )
        ) : mode === 'reset' ? (
          tokenState === 'checking' ? (
            <div className="card p-6 text-center">
              <Spinner className="mx-auto h-5 w-5" />
              <p className="mt-3 text-sm text-ink-faint">Checking your link…</p>
            </div>
          ) : tokenState === 'missing' || tokenState === 'bad' ? (
            <div className="card space-y-4 p-6 text-center">
              <span aria-hidden className="text-3xl">
                ⌛
              </span>
              <p className="text-sm leading-relaxed text-ink-soft">
                {tokenState === 'missing'
                  ? 'This page needs a reset link to open it.'
                  : 'That reset link is not valid or has expired. Ask for a new one.'}
              </p>
              <button type="button" onClick={() => goTo('forgot')} className="btn-secondary w-full">
                Send a new link
              </button>
            </div>
          ) : (
            <form onSubmit={submitReset} className="card space-y-4 p-6">
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  className="field"
                  value={resetForm.newPassword}
                  onChange={(event) => setResetForm((c) => ({ ...c, newPassword: event.target.value }))}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  required
                  minLength={10}
                />
                <p className="mt-1.5 text-[11px] text-ink-faint">At least 10 characters, with a letter and a number.</p>
              </div>

              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  className="field"
                  value={resetForm.confirm}
                  onChange={(event) => setResetForm((c) => ({ ...c, confirm: event.target.value }))}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  required
                />
              </div>

              {errorBox}

              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? <Spinner className="h-4 w-4" /> : 'Set new password'}
              </button>
            </form>
          )
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-6">
            {mode === 'join' && (
              <div>
                <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  Your name
                </label>
                <input
                  id="name"
                  className="field"
                  value={form.name}
                  onChange={update('name')}
                  autoComplete="name"
                  placeholder="What should we call you?"
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={form.email}
                onChange={update('email')}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="field"
                value={form.password}
                onChange={update('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••••"
                required
              />
              {mode === 'join' && (
                <p className="mt-1.5 text-[11px] text-ink-faint">At least 10 characters, with a letter and a number.</p>
              )}
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => goTo('forgot')}
                  className="mt-1.5 text-xs font-medium text-rose-600 underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>

            {mode === 'join' && hasCodeField && (
              <div>
                <label htmlFor="invite" className="mb-1.5 block text-xs font-medium text-ink-soft">
                  Invitation code
                </label>
                <div className="flex gap-2">
                  <input
                    id="invite"
                    className="field font-sans tracking-widest uppercase"
                    value={form.inviteCode}
                    onChange={update('inviteCode')}
                    placeholder="XXXX-XXXX-XXXX"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={checkCode}
                    disabled={checking || form.inviteCode.trim().length === 0}
                    className="btn-secondary shrink-0"
                  >
                    {checking ? <Spinner className="h-4 w-4" /> : 'Check'}
                  </button>
                </div>

                {codeState === 'ok' && (
                  <p className="mt-2 text-xs text-sage-600">✓ That code works. Welcome in ❤️</p>
                )}
                {codeState === 'bad' && <p className="mt-2 text-xs text-rose-600">{codeError}</p>}
              </div>
            )}

            {mode === 'join' && !hasCodeField && (
              <div className="rounded-2xl border border-dashed border-line bg-surface/60 px-4 py-3 text-center">
                <p className="text-xs leading-relaxed text-ink-faint">
                  Setting up your space? You are the first one here, so no code is needed.
                </p>
                <button
                  type="button"
                  onClick={() => setHasCodeField(true)}
                  className="mt-1.5 text-xs font-medium text-rose-600 underline-offset-4 hover:underline"
                >
                  I have an invitation code
                </button>
              </div>
            )}

            {errorBox}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? <Spinner className="h-4 w-4" /> : mode === 'login' ? 'Come in' : 'Create our space'}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-ink-faint">
          {mode === 'reset' || mode === 'forgot' ? (
            <>
              Remembered it?{' '}
              <button
                type="button"
                onClick={() => goTo('login')}
                className="font-medium text-rose-600 underline-offset-4 hover:underline"
              >
                Back to sign in
              </button>
            </>
          ) : mode === 'login' ? (
            <>
              Don't have an account yet?{' '}
              <button
                type="button"
                onClick={() => goTo('join')}
                className="font-medium text-rose-600 underline-offset-4 hover:underline"
              >
                Join the space
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => goTo('login')}
                className="font-medium text-rose-600 underline-offset-4 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </motion.div>
    </div>
  );
}
