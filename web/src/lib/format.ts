/** Date and time formatting that keeps the tone warm rather than corporate. */

const DAY_MS = 86_400_000;

export function todayKey(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", "Tuesday", then a date once it is far enough away. */
export function friendlyDay(input: string | Date, now = new Date()): string {
  const value = typeof input === 'string' ? new Date(input.length === 10 ? `${input}T00:00:00` : input) : input;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(value)) / DAY_MS);

  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return value.toLocaleDateString(undefined, { weekday: 'long' });

  const sameYear = value.getFullYear() === now.getFullYear();
  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function shortDay(input: string | Date, now = new Date()): string {
  const value = typeof input === 'string' ? new Date(input.length === 10 ? `${input}T00:00:00` : input) : input;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(value)) / DAY_MS);

  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';

  const sameYear = value.getFullYear() === now.getFullYear();
  return value.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Chat timestamp: time for today, "Yesterday 21:04", otherwise a date + time. */
export function messageTime(input: string, now = new Date()): string {
  const value = new Date(input);
  const time = value.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (friendlyDay(value, now) === 'Today') return time;
  if (friendlyDay(value, now) === 'Yesterday') return `Yesterday ${time}`;

  const sameYear = value.getFullYear() === now.getFullYear();
  return `${value.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })} ${time}`;
}

export function clockTime(input: string): string {
  return new Date(input).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function monthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  if (!year || !monthIndex) return month;
  return new Date(year, monthIndex - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** "just now", "12m", "3h", "Tue" — used for presence and last seen. */
export function relativeTime(input: string | null, now = new Date()): string {
  if (!input) return '';
  const value = new Date(input).getTime();
  const diff = Math.max(0, now.getTime() - value);

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function longDate(input: string): string {
  const value = new Date(input.length === 10 ? `${input}T00:00:00` : input);
  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function duration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Groups diary content into paragraphs for the simple read view. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
