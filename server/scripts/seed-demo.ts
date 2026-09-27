/**
 * Fills the space with believable demo content so the app can be seen working.
 *
 *   npm run seed:demo
 *
 * Safe to re-run: it clears previously generated demo rows first, so you can
 * reset it at any time with:  npm run seed:demo -- --reset
 */
import sharp from 'sharp';
import { db } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';
import { nowIso, toDayKey } from '../src/lib/time.js';
import { objectKey, storage } from '../src/lib/storage.js';
import { parseTagInput, setTagsForEntry, setTagsForPhoto } from '../src/services/tags.js';
import { clearUserCache } from '../src/services/serialize.js';
import type { Mood } from '../src/types.js';

const reset = process.argv.includes('--reset');

interface DemoPhoto {
  caption: string;
  description?: string;
  date: string;
  collection: string;
  tags: string[];
  favorite?: boolean;
  palette: [string, string, string];
  /** Shapes drawn over the gradient to make each image feel different. */
  motif: 'sun' | 'waves' | 'hills' | 'bokeh' | 'petals' | 'window';
}

const COLLECTIONS = [
  { name: 'Our Adventures', description: "All the places we've been together.", cover: 0 },
  { name: 'Just Us ❤️', description: 'The ordinary days that felt like everything.', cover: 3 },
  { name: 'Trips', description: 'Away from ordinary, together.', cover: 1 },
  { name: 'Special Days', description: 'Birthdays, anniversaries, and one good surprise.', cover: 4 },
];

const ADVENTURES: DemoPhoto[] = [
  { caption: 'Golden hour at the cove', description: 'We stayed until the light went orange and nobody wanted to leave.', date: '2026-09-12', collection: 'Our Adventures', tags: ['travel', 'summer'], favorite: true, palette: ['#f7c9a9', '#e98f6f', '#b15544'], motif: 'sun' },
  { caption: 'The long way round', date: '2026-08-24', collection: 'Our Adventures', tags: ['travel', 'road-trip'], palette: ['#a8c4b0', '#6f9179', '#3f5a49'], motif: 'hills' },
  { caption: 'First swim of the year', date: '2026-07-08', collection: 'Our Adventures', tags: ['summer', 'beach'], palette: ['#bfe0e6', '#6fb3bf', '#3a7d8c'], motif: 'waves' },
  { caption: 'Found this little café', date: '2026-06-19', collection: 'Our Adventures', tags: ['food', 'travel'], palette: ['#e8d5bd', '#c9a97f', '#8f6f4a'], motif: 'window' },
  { caption: 'The hill we gave up on', description: 'We made it to the halfway point and then made a very good decision about lunch.', date: '2026-05-30', collection: 'Our Adventures', tags: ['funny', 'travel'], palette: ['#c9c4e0', '#8f86b8', '#544a7a'], motif: 'hills' },
];

const JUST_US: DemoPhoto[] = [
  { caption: 'Your terrible pancake', description: 'Burnt, but you insisted it was art.', date: '2026-09-21', collection: 'Just Us ❤️', tags: ['funny', 'home'], favorite: true, palette: ['#f7d9c4', '#d99a76', '#9c5f43'], motif: 'sun' },
  { caption: 'Rainy Sunday, no plans', date: '2026-09-14', collection: 'Just Us ❤️', tags: ['home', 'peaceful'], palette: ['#cfd6de', '#95a3b4', '#5c6b7d'], motif: 'bokeh' },
  { caption: 'That blue mug', date: '2026-08-30', collection: 'Just Us ❤️', tags: ['home'], palette: ['#bcd4e0', '#7fa8bd', '#456c85'], motif: 'window' },
  { caption: 'Dancing badly in the kitchen', date: '2026-08-11', collection: 'Just Us ❤️', tags: ['funny', 'home'], favorite: true, palette: ['#f2c9d8', '#cf8fa8', '#8f5470'], motif: 'petals' },
  { caption: 'Late night, just us talking', date: '2026-07-27', collection: 'Just Us ❤️', tags: ['peaceful', 'love'], palette: ['#3f4a63', '#2f3850', '#1b2133'], motif: 'bokeh' },
];

const TRIPS: DemoPhoto[] = [
  { caption: 'Airport, 5am, very tired', date: '2026-09-01', collection: 'Trips', tags: ['travel', 'funny'], palette: ['#d8d4cc', '#a9a49a', '#6b675f'], motif: 'window' },
  { caption: 'The little street we kept walking down', date: '2026-09-03', collection: 'Trips', tags: ['travel'], favorite: true, palette: ['#e3c9a8', '#b98f68', '#7a5c40'], motif: 'hills' },
  { caption: 'Last morning', description: 'Neither of us wanted to check out.', date: '2026-09-06', collection: 'Trips', tags: ['travel', 'emotional'], palette: ['#dfc6d8', '#a98bab', '#6b5070'], motif: 'bokeh' },
];

const SPECIAL: DemoPhoto[] = [
  { caption: 'Your birthday morning', date: '2026-08-17', collection: 'Special Days', tags: ['birthday', 'love'], favorite: true, palette: ['#f6c8d0', '#d3809a', '#8f4a63'], motif: 'petals' },
  { caption: 'The cake that leaned', date: '2026-08-17', collection: 'Special Days', tags: ['birthday', 'funny'], palette: ['#f7dcc0', '#d0a172', '#8a6440'], motif: 'sun' },
  { caption: 'Fireworks from the balcony', date: '2026-01-01', collection: 'Special Days', tags: ['2026', 'celebration'], palette: ['#2f3a55', '#4a5c85', '#1b2233'], motif: 'bokeh' },
  { caption: 'Six months together', date: '2026-03-15', collection: 'Special Days', tags: ['love', '2026'], palette: ['#f3d9dd', '#c58a9a', '#7d4a5c'], motif: 'petals' },
];

const ALL_PHOTOS = [...ADVENTURES, ...JUST_US, ...TRIPS, ...SPECIAL];

interface DemoEntry {
  title: string;
  content: string;
  mood: Mood;
  visibility: 'SHARED' | 'PRIVATE';
  date: string;
  author: 0 | 1;
  collection: string;
  tags: string[];
  favorite?: boolean;
  photoCaptions?: string[];
}

const ENTRIES: DemoEntry[] = [
  {
    title: 'Today was really special',
    content:
      'We woke up late and it did not matter at all.\n\nSpent the whole afternoon doing absolutely nothing productive, and I cannot remember the last time that felt so good. You laughed at something I said that was not even funny, and then you laughed at yourself for laughing.\n\nI am keeping this one.',
    mood: 'LOVED',
    visibility: 'SHARED',
    date: '2026-09-21',
    author: 0,
    collection: 'Just Us ❤️',
    tags: ['love', 'special', '2026'],
    favorite: true,
  },
    {
    title: 'The cove, and the light afterwards',
    content:
      'We got there just before sunset, which is exactly the sort of thing that never happens when you plan it.\n\nThe water was cold and you insisted on swimming anyway. I stood on the rocks and watched you come up grinning.\n\n**Golden hour** is the right word for it. I want to remember that you turned around and looked back at me before we left.',
    mood: 'PEACEFUL',
    visibility: 'SHARED',
    date: '2026-09-12',
    author: 1,
    collection: 'Our Adventures',
    tags: ['travel', 'summer', 'beach'],
    photoCaptions: ['Golden hour at the cove'],
  },
  {
    title: 'A very ordinary Tuesday',
    content:
      'Nothing happened. Work, dinner, that show we keep meaning to finish.\n\nI liked it. There is something nice about a day that asks nothing of you, and about having someone to spend a nothing-day with.',
    mood: 'PEACEFUL',
    visibility: 'SHARED',
    date: '2026-09-18',
    author: 1,
    collection: 'Just Us ❤️',
    tags: ['home', 'peaceful'],
  },
  {
    title: 'Things I am thinking about but not saying out loud',
    content:
      'Writing this down so I stop carrying it around.\n\nThe trip is coming up and I keep doing that thing where I plan every single minute, and then panic. I do not need it to be perfect. I just need it to be us.\n\nKeeping this one to myself for now.',
    mood: 'EMOTIONAL',
    visibility: 'PRIVATE',
    date: '2026-09-23',
    author: 0,
    collection: 'Trips',
    tags: ['feelings'],
  },
  {
    title: 'Happy birthday to my favourite person',
    content:
      'You woke up embarrassed about the cake. You always do.\n\nThank you for another year of tolerating my terrible jokes and my terrible singing. Here is to a year with more airports in it and fewer goodbyes.\n\n> I would pick you again. Every time.',
    mood: 'EXCITED',
    visibility: 'SHARED',
    date: '2026-08-17',
    author: 1,
    collection: 'Special Days',
    tags: ['birthday', 'love'],
    favorite: true,
  },
  {
    title: 'The airport, and how you held my hand too tight',
    content:
      'Five in the morning. Neither of us was fully a person yet.\n\nYou said "this is fine" three times in the taxi, which meant the opposite, and then you held my hand like I was the only solid thing in the room.\n\nIt was.',
    mood: 'FUNNY',
    visibility: 'SHARED',
    date: '2026-09-01',
    author: 0,
    collection: 'Trips',
    tags: ['travel', 'funny'],
  },
  {
    title: 'Six months',
    content: 'Half a year. I cannot quite believe it.\n\nThe thing I am proudest of is not a single big moment. It is that we have kept finding reasons to sit on the kitchen floor with the back door open and talk until it gets cold.',
    mood: 'LOVED',
    visibility: 'SHARED',
    date: '2026-03-15',
    author: 1,
    collection: 'Special Days',
    tags: ['love', '2026'],
  },
  {
    title: 'A list of small things',
    content: '- You still hum when you cook.\n- You always give me the bigger half of the blanket.\n- You read my mind about what to eat roughly 80% of the time.\n\nThat is all. That is the whole list.',
    mood: 'HAPPY',
    visibility: 'SHARED',
    date: '2026-08-30',
    author: 0,
    collection: 'Just Us ❤️',
    tags: ['love', 'home'],
  },
];

interface DemoMessage {
  from: 0 | 1;
  content: string;
  minutesAfter: number;
  collection?: string;
  diaryTitle?: string;
}

const MESSAGES: DemoMessage[] = [
  { from: 0, content: 'Did you eat already? ❤️', minutesAfter: 0 },
  { from: 1, content: 'Not yet hahaha', minutesAfter: 1 },
  { from: 0, content: 'Go eat. Please. Actual food, not crackers.', minutesAfter: 2 },
  { from: 1, content: 'Crackers ARE a food group', minutesAfter: 3 },
  { from: 0, content: 'They are not 😭', minutesAfter: 3 },
  { from: 0, content: 'Also — look at this', minutesAfter: 40, diaryTitle: 'Today was really special' },
  { from: 1, content: 'stop you are going to make me cry at work', minutesAfter: 44 },
  { from: 1, content: 'I love you. now go get a real meal.', minutesAfter: 45 },
  { from: 0, content: 'I love you too 🤍', minutesAfter: 46 },
  { from: 0, content: 'Made it', minutesAfter: 1800, collection: 'Trips' },
  { from: 1, content: 'LOOK AT THE LIGHT', minutesAfter: 1802 },
  { from: 1, content: 'sorry. I am having feelings on a staircase', minutesAfter: 1803 },
];

/** Draws a soft abstract image so every demo photo looks distinct. */
async function renderImage(width: number, height: number, palette: [string, string, string], motif: DemoPhoto['motif']): Promise<Buffer> {
  const [light, mid, dark] = palette;
  const w = width;
  const h = height;

  const overlays: string[] = [];

  const blob = (cx: number, cy: number, r: number, fill: string, opacity: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`;

  switch (motif) {
    case 'sun':
      overlays.push(blob(w * 0.68, h * 0.34, Math.min(w, h) * 0.17, light, 0.85));
      overlays.push(blob(w * 0.68, h * 0.34, Math.min(w, h) * 0.28, light, 0.16));
      overlays.push(`<rect x="0" y="${h * 0.68}" width="${w}" height="${h * 0.32}" fill="${dark}" opacity="0.35"/>`);
      break;
    case 'waves':
      for (let i = 0; i < 5; i++) {
        const y = h * (0.45 + i * 0.11);
        overlays.push(
          `<path d="M0 ${y} Q ${w * 0.25} ${y - h * 0.06} ${w * 0.5} ${y} T ${w} ${y} L ${w} ${h} L 0 ${h} Z" fill="${i % 2 ? dark : mid}" opacity="${0.28 + i * 0.08}"/>`,
        );
      }
      overlays.push(blob(w * 0.28, h * 0.24, Math.min(w, h) * 0.1, light, 0.7));
      break;
    case 'hills':
      overlays.push(`<path d="M0 ${h * 0.72} Q ${w * 0.3} ${h * 0.4} ${w * 0.62} ${h * 0.7} T ${w} ${h * 0.6} L ${w} ${h} L 0 ${h} Z" fill="${dark}" opacity="0.55"/>`);
      overlays.push(`<path d="M0 ${h * 0.86} Q ${w * 0.35} ${h * 0.62} ${w} ${h * 0.84} L ${w} ${h} L 0 ${h} Z" fill="${mid}" opacity="0.7"/>`);
      overlays.push(blob(w * 0.2, h * 0.22, Math.min(w, h) * 0.08, light, 0.8));
      break;
    case 'bokeh':
      for (let i = 0; i < 14; i++) {
        const x = ((i * 97) % 100) / 100;
        const y = ((i * 53) % 100) / 100;
        overlays.push(blob(x * w, y * h, Math.min(w, h) * (0.04 + ((i * 13) % 7) / 60), light, 0.1 + (i % 3) * 0.08));
      }
      break;
    case 'petals':
      for (let i = 0; i < 11; i++) {
        const x = ((i * 71) % 100) / 100;
        const y = ((i * 37) % 100) / 100;
        const r = Math.min(w, h) * 0.07;
        overlays.push(
          `<ellipse cx="${x * w}" cy="${y * h}" rx="${r}" ry="${r * 0.6}" fill="${light}" opacity="0.4" transform="rotate(${(i * 37) % 180} ${x * w} ${y * h})"/>`,
        );
      }
      break;
    case 'window':
      overlays.push(`<rect x="${w * 0.18}" y="${h * 0.12}" width="${w * 0.64}" height="${h * 0.62}" rx="${w * 0.02}" fill="${light}" opacity="0.45"/>`);
      overlays.push(`<line x1="${w * 0.5}" y1="${h * 0.12}" x2="${w * 0.5}" y2="${h * 0.74}" stroke="${dark}" stroke-width="${w * 0.012}" opacity="0.5"/>`);
      overlays.push(`<line x1="${w * 0.18}" y1="${h * 0.43}" x2="${w * 0.82}" y2="${h * 0.43}" stroke="${dark}" stroke-width="${w * 0.012}" opacity="0.5"/>`);
      overlays.push(`<rect x="0" y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="${dark}" opacity="0.4"/>`);
      break;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="${light}"/>
        <stop offset="55%" stop-color="${mid}"/>
        <stop offset="100%" stop-color="${dark}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    ${overlays.join('\n')}
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function main(): Promise<void> {
  const space = db.get<{ id: string }>('SELECT id FROM private_spaces ORDER BY created_at ASC LIMIT 1');
  if (!space) {
    console.error('No space found. Run: npm run seed');
    process.exit(1);
  }

  const members = db.all<{ user_id: string; role: string }>(
    'SELECT user_id, role FROM space_members WHERE space_id = ? ORDER BY joined_at ASC',
    space.id,
  );
  if (members.length < 2) {
    console.error('This space needs two people. Run: npm run seed -- --people');
    process.exit(1);
  }

  const [me, partner] = members as [{ user_id: string; role: string }, { user_id: string; role: string }];

  if (reset) {
    // Only demo rows are removed: tagged with the 'demo' marker below.
    const demoEntries = db.all<{ id: string }>("SELECT id FROM diary_entries WHERE content LIKE '%<!--demo-->%'");
    for (const entry of demoEntries) db.run('DELETE FROM diary_entries WHERE id = ?', entry.id);
    const demoPhotos = db.all<{ id: string }>("SELECT id FROM photos WHERE caption LIKE '%<!--demo-->%'");
    for (const photo of demoPhotos) {
      const row = db.get<{ image_url: string; thumbnail_url: string | null }>(
        'SELECT image_url, thumbnail_url FROM photos WHERE id = ?',
        photo.id,
      );
      db.run('DELETE FROM photos WHERE id = ?', photo.id);
      for (const url of [row?.image_url, row?.thumbnail_url]) {
        if (url) {
          const resolved = storage.resolve(url);
          if (resolved) void storage.remove(resolved.bucket, resolved.key);
        }
      }
    }
    db.run('DELETE FROM collections WHERE description LIKE ?', '%(demo)%');
    db.run('DELETE FROM messages');
    db.run('DELETE FROM message_reads');
    db.run('DELETE FROM message_reactions');
    console.log('Cleared previous demo content.');
  }

  // Collections
  const collectionIds = new Map<string, string>();
  for (const item of COLLECTIONS) {
    const existing = db.get<{ id: string }>(
      'SELECT id FROM collections WHERE space_id = ? AND name = ?',
      space.id,
      item.name,
    );
    const id = existing?.id ?? newId();
    if (!existing) {
      db.run(
        'INSERT INTO collections (id, space_id, created_by, name, description) VALUES (?, ?, ?, ?, ?)',
        id,
        space.id,
        me.user_id,
        item.name,
        `${item.description} (demo)`,
      );
    }
    collectionIds.set(item.name, id);
  }
  console.log(`Collections ready: ${collectionIds.size}`);

  // Photos
  const photoIdsByCaption = new Map<string, string>();
  for (const [index, item] of ALL_PHOTOS.entries()) {
    const buffer = await renderImage(1280, 900, item.palette, item.motif);
    const full = await sharp(buffer).webp({ quality: 84 }).toBuffer();
    const thumb = await sharp(buffer).resize(640, 640, { fit: 'cover', position: 'attention' }).webp({ quality: 76 }).toBuffer();

    const fullKey = objectKey('photo', 'webp');
    const thumbKey = objectKey('thumb', 'webp');
    await storage.put('photos', fullKey, full);
    await storage.put('thumbnails', thumbKey, thumb);

    const owner = index % 3 === 0 ? partner.user_id : me.user_id;
    const id = newId();
    db.run(
      `INSERT INTO photos (id, owner_id, space_id, collection_id, image_url, thumbnail_url,
         caption, description, photo_date, is_favorite, width, height, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      owner,
      space.id,
      collectionIds.get(item.collection) ?? null,
      storage.publicUrl('photos', fullKey),
      storage.publicUrl('thumbnails', thumbKey),
      `${item.caption} <!--demo-->`,
      item.description ?? null,
      item.date,
      item.favorite ? 1 : 0,
      1280,
      900,
      full.byteLength,
    );

    setTagsForPhoto(space.id, owner, id, parseTagInput(item.tags));
    photoIdsByCaption.set(item.caption, id);
  }
  console.log(`Photos created: ${ALL_PHOTOS.length}`);

  // Diary entries
  const entryIdsByTitle = new Map<string, string>();
  for (const entry of ENTRIES) {
    const author = entry.author === 0 ? me.user_id : partner.user_id;
    const id = newId();
    const html = entry.content
      .split('\n\n')
      .map((block) => {
        const lines = block.split('\n');
        if (lines.every((line) => line.trim().startsWith('- '))) {
          return `<ul>${lines.map((line) => `<li>${formatInline(line.trim().slice(2))}</li>`).join('')}</ul>`;
        }
        if (block.startsWith('> ')) return `<blockquote>${formatInline(block.slice(2))}</blockquote>`;
        return `<p>${lines.map(formatInline).join('<br>')}</p>`;
      })
      .join('');

    db.run(
      `INSERT INTO diary_entries (id, author_id, space_id, collection_id, title, content, mood, visibility, entry_date, is_favorite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      author,
      space.id,
      collectionIds.get(entry.collection) ?? null,
      entry.title,
      `${html}<!--demo-->`,
      entry.mood,
      entry.visibility,
      entry.date,
      entry.favorite ? 1 : 0,
    );

    setTagsForEntry(space.id, author, id, parseTagInput(entry.tags));
    entryIdsByTitle.set(entry.title, id);

    for (const caption of entry.photoCaptions ?? []) {
      const photoId = photoIdsByCaption.get(caption);
      if (photoId) {
        db.run('UPDATE photos SET diary_entry_id = ? WHERE id = ?', id, photoId);
      }
    }
  }
  console.log(`Diary entries created: ${ENTRIES.length}`);

  // Collection covers
  for (const [index, item] of COLLECTIONS.entries()) {
    const photo = ALL_PHOTOS[item.cover];
    const photoId = photo ? photoIdsByCaption.get(photo.caption) : undefined;
    if (photoId) {
      db.run('UPDATE collections SET cover_photo_id = ? WHERE id = ?', photoId, collectionIds.get(item.name)!);
    }
    void index;
  }

  // Messages, spread across two evenings
  const base = new Date('2026-09-21T19:20:00.000Z').getTime();
  for (const message of MESSAGES) {
    const sender = message.from === 0 ? me.user_id : partner.user_id;
    const createdAt = new Date(base + message.minutesAfter * 60_000).toISOString();
    const id = newId();

    const sharedDiaryId = message.diaryTitle ? entryIdsByTitle.get(message.diaryTitle) : undefined;
    const sharedCollectionId = message.collection ? collectionIds.get(message.collection) : undefined;
    const type = sharedDiaryId ? 'DIARY' : sharedCollectionId ? 'MEMORY' : 'TEXT';

    db.run(
      `INSERT INTO messages (id, space_id, sender_id, message_type, content, shared_diary_entry_id, shared_collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      space.id,
      sender,
      type,
      message.content,
      sharedDiaryId ?? null,
      sharedCollectionId ?? null,
      createdAt,
      createdAt,
    );

    // Both have read everything, except the last couple from the partner.
    db.run('INSERT INTO message_reads (id, message_id, user_id) VALUES (?, ?, ?)', newId(), id, sender);
  }

  const unread = db.all<{ id: string }>(
    "SELECT id FROM messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 2",
    partner.user_id,
  );
  for (const message of unread) {
    db.run('INSERT INTO message_reads (id, message_id, user_id) VALUES (?, ?, ?)', newId(), message.id, me.user_id);
  }

  // A few reactions and a favourited message.
  const reactionTargets = db.all<{ id: string; sender_id: string }>(
    "SELECT id, sender_id FROM messages WHERE message_type = 'TEXT' ORDER BY created_at ASC LIMIT 20",
  );
  const reactionPlan: Array<[number, string, 0 | 1]> = [
    [0, '❤️', 1],
    [3, '😂', 0],
    [4, '😂', 1],
    [6, '🥹', 1],
    [7, '❤️', 0],
    [10, '❤️', 0],
  ];
  reactionPlan.forEach(([index, emoji, who], order) => {
    const target = reactionTargets[index];
    if (!target) return;
    const reactor = who === 0 ? me.user_id : partner.user_id;
    db.run(
      'INSERT OR IGNORE INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
      newId(),
      target.id,
      reactor,
      emoji,
    );
    void order;
  });

  if (reactionTargets[7]) {
    db.run('UPDATE messages SET is_favorite = 1 WHERE id = ?', reactionTargets[7]!.id);
  }

  clearUserCache();
  db.run('UPDATE users SET last_seen_at = ?, is_online = 0 WHERE id = ?', nowIso(), me.user_id);

  console.log(`\nDemo content ready. ${toDayKey(new Date())}`);
  console.log(`Photos ${ALL_PHOTOS.length} · Entries ${ENTRIES.length} · Collections ${COLLECTIONS.length} · Messages ${MESSAGES.length}\n`);
  db.close();
}

function formatInline(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
}

await main();
