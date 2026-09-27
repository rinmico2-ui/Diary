import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { ConfirmDialog } from './Sheet';
import { Spinner } from './ui';
import { relativeTime } from '../lib/format';
import { toasts } from '../lib/toast';

export interface Invite {
  id: string;
  hint: string;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedByName: string | null;
  revokedAt: string | null;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

interface InvitesResponse {
  invites: Invite[];
  seatsLeft: number;
  canCreate: boolean;
}

const STATUS_COPY: Record<Invite['status'], { label: string; tone: string }> = {
  active: { label: 'Waiting to be used', tone: 'bg-sage-100 text-sage-600' },
  used: { label: 'Used', tone: 'bg-surface-sunk text-ink-faint' },
  expired: { label: 'Expired', tone: 'bg-surface-sunk text-ink-faint' },
  revoked: { label: 'Cancelled', tone: 'bg-rose-50 text-rose-600' },
};

/**
 * Creating and revoking the single-use code that lets the second person in.
 * The code is shown exactly once, because only its hash is stored.
 */
export function InvitePanel({ onCopied }: { onCopied?: () => void }) {
  const { data, loading, reload } = useApi<InvitesResponse>('/invites');
  const [fresh, setFresh] = useState<{ code: string; expiresAt: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState<number | 'never'>('never');
  const [revoking, setRevoking] = useState<Invite | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const body = expiresInHours === 'never' ? {} : { expiresInHours };
      const result = await api.post<{ code: string; invite: Invite }>('/invites', body);
      setFresh({ code: result.code, expiresAt: result.invite.expiresAt });
      reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not create an invitation.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toasts.success('Code copied. Send it to them ❤️');
      onCopied?.();
    } catch {
      toasts.warn('Copying failed — select the code and copy it manually.');
    }
  };

  const revoke = async (invite: Invite) => {
    try {
      await api.delete(`/invites/${invite.id}`);
      toasts.success('Invitation cancelled.');
      reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not cancel that.');
    } finally {
      setRevoking(null);
    }
  };

  // Somebody is already here: nothing left to invite.
  if (loading && !data) {
    return (
      <section className="card p-5 sm:p-6">
        <h2 className="font-sans text-lg text-ink">Invitation</h2>
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-faint">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      </section>
    );
  }

  if (data && data.seatsLeft === 0) {
    return (
      <section className="card p-5 sm:p-6">
        <h2 className="font-sans text-lg text-ink">Invitation</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Both seats are taken. This space holds two people and there is no way to add anyone else.
        </p>
        <p className="mt-3 text-xs text-ink-faint">💛 You two are all set.</p>
      </section>
    );
  }

  const active = (data?.invites ?? []).filter((i) => i.status === 'active');
  const past = (data?.invites ?? []).filter((i) => i.status !== 'active');

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="font-sans text-lg text-ink">Invitation</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
        There is one seat left. Create a code and send it to the one person you want to let in.
      </p>

      <div className="mt-4 space-y-2">
        <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
          <span>Code expires</span>
          <select
            className="field w-auto py-1.5 text-sm"
            value={expiresInHours}
            onChange={(event) =>
              setExpiresInHours(event.target.value === 'never' ? 'never' : Number(event.target.value))
            }
            aria-label="When the code expires"
          >
            <option value="never">Never</option>
            <option value={1}>In 1 hour</option>
            <option value={24}>In 24 hours</option>
            <option value={168}>In a week</option>
          </select>
        </label>

        <button type="button" onClick={create} disabled={busy || !data?.canCreate} className="btn-primary w-full">
          {busy ? <Spinner className="h-4 w-4" /> : '✨ Create an invite code'}
        </button>
      </div>

      {/* Shown once. Only a hash is stored, so it cannot be displayed again. */}
      <AnimatePresence>
        {fresh && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4"
          >
            <p className="text-xs font-medium text-rose-700">Send them this code</p>
            <p className="mt-2 select-all break-all font-sans text-2xl tracking-widest text-ink">{fresh.code}</p>
            {fresh.expiresAt && (
              <p className="mt-1 text-xs text-ink-faint">Expires {relativeTime(fresh.expiresAt)}</p>
            )}

            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={() => copy(fresh.code)}>
                📋 Copy code
              </button>
              <button type="button" className="btn-secondary" onClick={() => setFresh(null)}>
                Done
              </button>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Copy it now — for your security only a fingerprint of this code is kept, so it cannot be shown again.
              If you lose it, cancel this one and make another.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {active.length > 0 && (
        <ul className="mt-4 space-y-2">
          {active.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-sm text-ink">••••-{invite.hint}</p>
                <p className="text-xs text-ink-faint">
                  Created {relativeTime(invite.createdAt)}
                  {invite.expiresAt ? ` · expires ${relativeTime(invite.expiresAt)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRevoking(invite)}
                className="shrink-0 text-xs text-ink-faint transition-colors hover:text-rose-600"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-soft">
            {past.length} older code{past.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {past.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 text-xs text-ink-faint">
                <span className="truncate">••••-{invite.hint}</span>
                <span className={`shrink-0 rounded-pill px-2 py-0.5 ${STATUS_COPY[invite.status].tone}`}>
                  {STATUS_COPY[invite.status].label}
                  {invite.usedByName ? ` by ${invite.usedByName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Cancel this invitation?"
        body={
          <>
            The code ending <strong className="text-ink">••••-{revoking?.hint}</strong> will stop working straight
            away. You can always make a new one.
          </>
        }
        confirmLabel="Cancel the code"
        tone="danger"
        onConfirm={() => {
          if (revoking) void revoke(revoking);
        }}
        onCancel={() => setRevoking(null)}
      />
    </section>
  );
}
