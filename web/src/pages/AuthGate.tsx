import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ApiError } from '../lib/api';
import { Spinner } from '../components/ui';

interface GateProps {
  onSignedIn: () => unknown;
}

export function AuthGate({ onSignedIn }: GateProps) {
  const [mode, setMode] = useState<'login' | 'join'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [codeState, setCodeState] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [codeError, setCodeError] = useState('');
  // The code field is hidden by default: most people arriving here are the
  // first, and an empty box that looks required is a bad invitation to guess.
  const [hasCodeField, setHasCodeField] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    if (key === 'inviteCode') setCodeState('idle');
  };

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string; code?: string } }
          | null;
        throw new ApiError(response.status, payload?.error?.message ?? 'That did not work.', payload?.error?.code);
      }

      await onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

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
            A private world for two people. No one else can see a single thing in here.
          </p>
        </div>

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

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
            >
              {error}
            </motion.p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? <Spinner className="h-4 w-4" /> : mode === 'login' ? 'Come in' : 'Create our space'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-faint">
          {mode === 'login' ? "Don't have an account yet? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'join' : 'login');
              setError(null);
              setCodeState('idle');
              setHasCodeField(false);
            }}
            className="font-medium text-rose-600 underline-offset-4 hover:underline"
          >
            {mode === 'login' ? 'Join the space' : 'Sign in'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
