import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Nav';
import { Avatar, Spinner } from '../components/ui';
import { ConfirmDialog } from '../components/Sheet';
import { InvitePanel } from '../components/InvitePanel';
import { api, upload } from '../lib/api';
import type { Session, UserSettings } from '../lib/types';
import { toasts } from '../lib/toast';

export function SettingsPage({ session, onSignOut }: { session: Session; onSignOut: () => Promise<void> }) {
  const [settings, setSettings] = useState<UserSettings>(session.settings);
  const [name, setName] = useState(session.user.name);
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const navigate = useNavigate();

  const updateSetting = async (key: keyof UserSettings, value: boolean) => {
    const previous = settings;
    setSettings((current) => ({ ...current, [key]: value }));
    try {
      await api.patch('/auth/settings', { [key]: value });
    } catch {
      setSettings(previous);
      toasts.error('That setting did not save.');
    }
  };

  const saveProfile = async () => {
    if (!name.trim()) {
      toasts.warn('Your name cannot be empty.');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/auth/profile', { name: name.trim() });
      toasts.success('Saved. ✨');
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const form = new FormData();
    form.append('photos', file, file.name);
    try {
      const { promise } = upload<{ uploads: Array<{ attachment: { url: string } }> }>('/uploads/photos', form);
      const result = await promise;
      const url = result.uploads[0]?.attachment.url;
      if (!url) throw new Error('That upload did not work.');
      await api.patch('/auth/profile', { profileImage: url });
      toasts.success('Photo updated. ✨');
      window.location.reload();
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'Could not update your photo.');
    }
  };

  const changePassword = async () => {
    if (!passwords.current || !passwords.next) {
      toasts.warn('Fill in both password fields.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      setPasswords({ current: '', next: '' });
      toasts.success('Password changed. Other devices were signed out.');
    } catch (error) {
      toasts.error(error instanceof Error ? error.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page max-w-2xl">
      <PageHeader eyebrow="⚙️ Settings" title="Your space" />

      <div className="space-y-4">
        <section className="card p-5 sm:p-6">
          <h2 className="font-sans text-lg text-ink">You</h2>

          <div className="mt-4 flex items-center gap-4">
            <label className="cursor-pointer">
              <Avatar name={name} src={session.user.profileImage} id={session.user.id} size="xl" />
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadAvatar(file);
                }}
              />
            </label>
            <div className="min-w-0 flex-1">
              <p className="muted">Tap your photo to change it</p>
              <p className="mt-1 truncate text-sm text-ink-soft">{session.user.email}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                In {session.space.name} since {new Date(session.user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="profile-name" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Display name
              </label>
              <input
                id="profile-name"
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
              />
            </div>
            <button type="button" onClick={saveProfile} disabled={busy} className="btn-primary sm:mb-0">
              {busy ? <Spinner className="h-4 w-4" /> : 'Save'}
            </button>
          </div>
        </section>

        {session.partner ? (
          <section className="card p-5 sm:p-6">
            <h2 className="font-sans text-lg text-ink">Your other half</h2>
            <div className="mt-4 flex items-center gap-3">
              <Avatar
                name={session.partner.name}
                src={session.partner.profileImage}
                id={session.partner.id}
                size="md"
                showPresence
                online={session.partner.isOnline}
              />
              <div>
                <p className="text-sm text-ink">{session.partner.name}</p>
                <p className="text-xs text-ink-faint">
                  {session.partner.isOnline ? 'Online now' : 'Away'}
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Both seats are taken, so there is no way to invite anyone else. This space is just the two of you.
            </p>
          </section>
        ) : (
          <>
            <InvitePanel />

            <section className="card p-5 sm:p-6">
              <h2 className="font-sans text-lg text-ink">Waiting for the second person</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                You are the only one here so far. Create a code above and send it to them — they will land straight in
                this space, and everything you write will be waiting.
              </p>
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-ink-faint">
                <li>💬 You can start writing and adding photos now; they appear the moment they join.</li>
                <li>🔒 Nothing you write is visible to anyone until they are actually in the space.</li>
              </ul>
            </section>
          </>
        )}

        <section className="card p-5 sm:p-6">
          <h2 className="font-sans text-lg text-ink">Notifications</h2>
          <div className="mt-4 space-y-4">
            <Toggle
              label="In-app notifications"
              body="Show a quiet badge when something new arrives."
              checked={settings.notificationsEnabled}
              onChange={(value) => void updateSetting('notificationsEnabled', value)}
            />
            <Toggle
              label="Browser notifications"
              body="Let your browser nudge you when the tab is in the background."
              checked={settings.browserNotifications}
              onChange={(value) => void updateSetting('browserNotifications', value)}
            />
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="font-sans text-lg text-ink">Presence</h2>
          <div className="mt-4 space-y-4">
            <Toggle
              label="Show when I'm online"
              body="Lets the other person see your online dot."
              checked={settings.showOnlineStatus}
              onChange={(value) => void updateSetting('showOnlineStatus', value)}
            />
            <Toggle
              label="Show my last seen"
              body="Lets them see when you were last around."
              checked={settings.showLastSeen}
              onChange={(value) => void updateSetting('showLastSeen', value)}
            />
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="font-sans text-lg text-ink">Password</h2>
          <p className="mt-1 text-sm text-ink-faint">Changing it signs out your other devices.</p>

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="current-password" className="mb-1.5 block text-xs font-medium text-ink-soft">
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                className="field"
                value={passwords.current}
                onChange={(event) => setPasswords((current) => ({ ...current, current: event.target.value }))}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor="next-password" className="mb-1.5 block text-xs font-medium text-ink-soft">
                New password
              </label>
              <input
                id="next-password"
                type="password"
                className="field"
                value={passwords.next}
                onChange={(event) => setPasswords((current) => ({ ...current, next: event.target.value }))}
                autoComplete="new-password"
                placeholder="At least 10 characters, with a number"
              />
            </div>
            <button type="button" onClick={changePassword} disabled={busy} className="btn-secondary">
              {busy ? <Spinner className="h-4 w-4" /> : 'Change password'}
            </button>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <h2 className="font-sans text-lg text-ink">Privacy</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>🔒 Every request is checked against your space on the server.</li>
            <li>🔒 Diary entries marked “Only me” are never sent to the other person.</li>
            <li>🔒 Photos and voice notes cannot be opened without a valid session.</li>
            <li>🔒 There are no public pages, no followers, and no sharing outside this space.</li>
          </ul>
        </section>

        <button type="button" onClick={() => setConfirmSignOut(true)} className="btn-secondary w-full">
          Sign out
        </button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        body="You can come back any time with your email and password."
        confirmLabel="Sign out"
        onConfirm={async () => {
          setConfirmSignOut(false);
          await onSignOut();
          navigate('/');
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}

function Toggle({
  label,
  body,
  checked,
  onChange,
}: {
  label: string;
  body: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">{body}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-rose-500' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[1.4rem]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
