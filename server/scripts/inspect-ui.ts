/**
 * Signs in as both people and prints what each side can actually see.
 * This is a quick sanity check that the demo data looks right through the API.
 *
 *   npx tsx scripts/inspect-ui.ts
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

class Session {
  private cookie = '';

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0];
      if (pair?.startsWith('ols_session=')) this.cookie = pair;
    }
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

const me = new Session();
const partner = new Session();

await me.call('POST', '/auth/login', { email: 'you@ourlittlespace.app', password: 'ourlittle2026' });
await partner.call('POST', '/auth/login', { email: 'her@ourlittlespace.app', password: 'ourlittle2026' });

const home = await me.call<any>('GET', '/home');
console.log('\nHOME');
console.log('  greeting      ', home.greeting);
console.log('  counts        ', JSON.stringify(home.counts));
console.log('  unread        ', home.unreadMessages);
console.log('  partner       ', home.partner?.name, home.partner?.isOnline ? '(online)' : '');

const meDiary = await me.call<any>('GET', '/diary?limit=50');
const partnerDiary = await partner.call<any>('GET', '/diary?limit=50');
const mine = meDiary.items.filter((e: any) => e.visibility === 'PRIVATE');
const leaked = partnerDiary.items.filter((e: any) => mine.some((m: any) => m.id === e.id));

console.log('\nDIARY');
console.log('  mine sees       ', meDiary.total);
console.log('  partner sees    ', partnerDiary.total);
console.log('  private entries ', mine.length);
console.log('  leaked to partner', leaked.length, leaked.length === 0 ? '✓' : '✗ PROBLEM');

const photos = await me.call<any>('GET', '/photos?limit=100');
console.log('\nPHOTOS');
console.log('  total       ', photos.total);
console.log('  with thumbs ', photos.items.filter((p: any) => p.thumbnailUrl).length);
const first = photos.items[0];
if (first) {
  const media = await fetch(`${BASE}${first.thumbnailUrl}`, { headers: { cookie: (me as any).cookie } });
  console.log('  sample      ', first.caption?.replace(' <!--demo-->', ''));
  console.log('  media fetch ', media.status, media.headers.get('content-type'));
}

const collections = await me.call<any>('GET', '/collections');
console.log('\nCOLLECTIONS');
for (const c of collections.collections) {
  console.log(`  ${c.name.padEnd(16)} ${c.photoCount} photos · ${c.diaryCount} entries · cover ${c.coverThumbnailUrl ? '✓' : '✗'}`);
}

const messages = await me.call<any>('GET', '/messages?limit=50');
console.log('\nMESSAGES');
console.log('  count   ', messages.messages.length);
console.log('  types   ', [...new Set(messages.messages.map((m: any) => m.type))].join(', '));
console.log('  with reactions', messages.messages.filter((m: any) => m.reactions.length > 0).length);

const search = await me.call<any>('GET', '/search?q=beach');
console.log('\nSEARCH "beach"');
console.log('  total', search.total, `(${search.photos.length} photos, ${search.diaryEntries.length} entries)`);

const timeline = await me.call<any>('GET', '/timeline?months=12');
console.log('\nTIMELINE');
console.log('  months with activity', timeline.months.length);
console.log('  newest month       ', timeline.months[0]?.month, JSON.stringify(timeline.months[0]?.totals));

const favorites = await me.call<any>('GET', '/favorites');
console.log('\nFAVORITES');
console.log('  photos', favorites.photos.length, '· entries', favorites.diaryEntries.length, '· messages', favorites.messages.length);

console.log('');
