/**
 * End-to-end verification of the privacy boundary and the core flows.
 * Run against a live server:  npx tsx scripts/verify.ts
 */
import fs from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

/** Reads the real invite code so the suite still works after it is rotated. */
function readInviteCode(): string {
  if (process.env.INVITE_CODE) return process.env.INVITE_CODE;
  try {
    const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    return /^INVITE_CODE=(.*)$/m.exec(env)?.[1]?.trim() ?? 'our-little-space';
  } catch {
    return 'our-little-space';
  }
}

const INVITE = readInviteCode();

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
    if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 400)}`);
  }
}

class Client {
  private cookie = '';

  constructor(readonly label: string) {}

  async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: any; headers: Headers }> {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) {
      const pair = raw.split(';')[0];
      if (pair?.startsWith('ols_session=')) this.cookie = pair;
    }

    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: response.status, json, headers: response.headers };
  }

  get isAuthenticated(): boolean {
    return this.cookie.length > 0;
  }
}

async function main(): Promise<void> {
  console.log(`\nVerifying ${BASE}\n`);

  const you = new Client('you');
  const her = new Client('her');
  const stranger = new Client('stranger');

  console.log('health + registration');
  const health = await you.call('GET', '/api/health');
  check('health endpoint responds', health.status === 200);

  // Generate a unique email so repeated runs do not collide.
  const stamp = Date.now();
  const youEmail = `verify-you-${stamp}@test.local`;
  const herEmail = `verify-her-${stamp}@test.local`;
  const thirdEmail = `verify-third-${stamp}@test.local`;
  const password = 'verify-pass-2026';

  const badInvite = await stranger.call('POST', '/api/auth/register', {
    name: 'Stranger',
    email: thirdEmail,
    password,
    inviteCode: 'wrong-code',
  });
  check('registration rejects a wrong invite code', badInvite.status === 403, badInvite.json);

  const registerYou = await you.call('POST', '/api/auth/register', {
    name: 'Verifier One',
    email: youEmail,
    password,
    inviteCode: INVITE,
  });
  // The seed already filled the space, so a third seat must be refused.
  check('space refuses a third member', registerYou.status === 409, registerYou.json);

  const loginYou = await you.call('POST', '/api/auth/login', { email: 'you@ourlittlespace.app', password: 'ourlittle2026' });
  check('owner can sign in', loginYou.status === 200, loginYou.json);
  check('session cookie issued', you.isAuthenticated);

  const loginHer = await her.call('POST', '/api/auth/login', { email: 'her@ourlittlespace.app', password: 'ourlittle2026' });
  check('partner can sign in', loginHer.status === 200, loginHer.json);

  const wrongPassword = await stranger.call('POST', '/api/auth/login', {
    email: 'you@ourlittlespace.app',
    password: 'not-the-password',
  });
  check('wrong password is rejected', wrongPassword.status === 401);

  console.log('\nauthentication is required');
  const anon = await stranger.call('GET', '/api/home');
  check('anonymous cannot read the home feed', anon.status === 401, anon.json);

  const anonPhotos = await stranger.call('GET', '/api/photos');
  check('anonymous cannot list photos', anonPhotos.status === 401, anonPhotos.json);

  const anonDiary = await stranger.call('GET', '/api/diary');
  check('anonymous cannot list diary entries', anonDiary.status === 401, anonDiary.json);

  console.log('\nme + space identity');
  const me = await you.call('GET', '/api/auth/me');
  check('me returns the profile', me.status === 200 && me.json.user?.email === 'you@ourlittlespace.app', me.json);
  const meHer = await her.call('GET', '/api/auth/me');
  check('both accounts share one space', me.json?.space?.id === meHer.json?.space?.id, {
    you: me.json?.space?.id,
    her: meHer.json?.space?.id,
  });
  check('partner is visible to each other', Boolean(me.json?.partner?.id) && Boolean(meHer.json?.partner?.id));

  console.log('\ncollections');
  const createdCollection = await you.call('POST', '/api/collections', {
    name: 'Our Adventures',
    description: 'All the places we have been together.',
  });
  check('collection created', createdCollection.status === 201, createdCollection.json);
  const collectionId = createdCollection.json?.collection?.id;

  const herCollections = await her.call('GET', '/api/collections');
  check(
    'partner sees the shared collection',
    herCollections.status === 200 &&
      herCollections.json.collections.some((c: any) => c.id === collectionId),
    herCollections.json,
  );

  const detail = await her.call('GET', `/api/collections/${collectionId}`);
  check('collection detail loads for partner', detail.status === 200, detail.json);

  console.log('\ndiary visibility — the core privacy promise');
  const privateEntry = await you.call('POST', '/api/diary', {
    title: 'My private thoughts',
    content: '<p>Only I should ever read this.</p>',
    visibility: 'PRIVATE',
    mood: 'PEACEFUL',
  });
  check('private entry created', privateEntry.status === 201, privateEntry.json);
  const privateId = privateEntry.json?.entry?.id;

  const sharedEntry = await you.call('POST', '/api/diary', {
    title: 'Today was special',
    content: '<p>Shared with you.</p>',
    visibility: 'SHARED',
    mood: 'LOVED',
    collectionId,
  });
  check('shared entry created', sharedEntry.status === 201, sharedEntry.json);
  const sharedId = sharedEntry.json?.entry?.id;

  const herDiary = await her.call('GET', '/api/diary');
  check('partner can list the diary', herDiary.status === 200, herDiary.json);
  const herIds = (herDiary.json?.items ?? []).map((e: any) => e.id);
  check('partner sees the SHARED entry', herIds.includes(sharedId), herDiary.json);
  check('partner does NOT see the PRIVATE entry', !herIds.includes(privateId), { herIds, privateId });

  // Direct access by a known id must also be refused — not just hidden in lists.
  const directRead = await her.call('GET', `/api/diary/${privateId}`);
  check('direct fetch of a private entry is refused', directRead.status === 404, directRead.json);

  // A visible entry that the partner is not allowed to change is a 403, while an
  // entry they cannot even see is a 404 — the distinction above proves it.
  const herEdit = await her.call('PATCH', `/api/diary/${sharedId}`, { title: 'hijacked' });
  check("partner cannot edit someone else's entry", herEdit.status === 403, herEdit.json);

  const herEditPrivate = await her.call('PATCH', `/api/diary/${privateId}`, { title: 'hijacked' });
  check("invisible entry is 404, not 403 (no existence leak)", herEditPrivate.status === 404, herEditPrivate.json);

  const herDelete = await her.call('DELETE', `/api/diary/${privateId}`);
  check('partner cannot delete a private entry', herDelete.status === 404, herDelete.json);

  const youSeePrivate = await you.call('GET', `/api/diary/${privateId}`);
  check('author can still read their private entry', youSeePrivate.status === 200, youSeePrivate.json);

  // Search must not leak private content either.
  const herSearch = await her.call('GET', `/api/search?q=${encodeURIComponent('private thoughts')}`);
  const herSearchIds = (herSearch.json?.diaryEntries ?? []).map((e: any) => e.id);
  check('search does not leak private entries', !herSearchIds.includes(privateId), herSearchIds);

  console.log('\ncollection statistics respect visibility');
  const herDetail = await her.call('GET', `/api/collections/${collectionId}`);
  const herDiaryCount = herDetail.json?.collection?.diaryCount;
  check('partner collection diary count excludes private entries', herDiaryCount === 1, {
    herDiaryCount,
  });

  console.log('\nmessaging');
  const message = await you.call('POST', '/api/messages', { type: 'TEXT', content: 'Did you eat already? ❤️' });
  check('text message sent', message.status === 201, message.json);
  const messageId = message.json?.message?.id;

  const herMessages = await her.call('GET', '/api/messages');
  const herMessageIds = (herMessages.json?.messages ?? []).map((m: any) => m.id);
  check('partner receives the message in real time feed', herMessageIds.includes(messageId), herMessages.json);

  const herSummary = await her.call('GET', '/api/messages/summary');
  const unreadBefore = herSummary.json?.unreadCount ?? 0;
  check('partner has an unread message', unreadBefore >= 1, herSummary.json);

  const readReceipt = await her.call('POST', '/api/messages/read', { messageIds: [messageId] });
  check('partner can mark the message read', readReceipt.status === 200, readReceipt.json);

  // Compared as a delta so the suite can be re-run against an existing space.
  const herSummaryAfter = await her.call('GET', '/api/messages/summary');
  check(
    'unread count drops by exactly one',
    herSummaryAfter.json?.unreadCount === unreadBefore - 1,
    { before: unreadBefore, after: herSummaryAfter.json?.unreadCount },
  );

  const reply = await her.call('POST', '/api/messages', {
    type: 'TEXT',
    content: 'Not yet hahaha',
    replyToMessageId: messageId,
  });
  check('reply works', reply.status === 201 && reply.json?.message?.replyTo?.id === messageId, reply.json);

  const edited = await you.call('PATCH', `/api/messages/${messageId}`, { content: 'Did you eat already? ❤️ (edited)' });
  check('author can edit a message', edited.status === 200 && edited.json?.message?.isEdited, edited.json);

  const youEditReply = await you.call('PATCH', `/api/messages/${reply.json?.message?.id}`, { content: 'nope' });
  check('cannot edit the partner message', youEditReply.status === 403, youEditReply.json);

  const reaction = await her.call('POST', `/api/messages/${messageId}/reactions`, { emoji: '❤️' });
  check('reaction added', reaction.status === 200 && reaction.json?.added, reaction.json);

  console.log('\nmemory sharing into chat');
  const sharePhoto = await you.call('POST', '/api/messages', {
    type: 'MEMORY',
    sharedCollectionId: collectionId,
  });
  check('collection shared into chat', sharePhoto.status === 201, sharePhoto.json);
  check(
    'shared collection card carries stats',
    sharePhoto.json?.message?.sharedCollection?.id === collectionId,
    sharePhoto.json?.message?.sharedCollection,
  );

  const shareDiary = await you.call('POST', '/api/messages', { type: 'DIARY', sharedDiaryEntryId: sharedId });
  check('diary entry shared into chat', shareDiary.status === 201, shareDiary.json);

  // Sharing a private entry into chat must be impossible.
  const sharePrivate = await her.call('POST', '/api/messages', {
    type: 'DIARY',
    sharedDiaryEntryId: privateId,
  });
  check('cannot share a private entry you cannot see', sharePrivate.status === 403, sharePrivate.json);

  console.log('\nfavorites');
  const favDiary = await you.call('PATCH', `/api/diary/${sharedId}/favorite`, { favorite: true });
  check('diary favorited', favDiary.status === 200 && favDiary.json?.entry?.isFavorite, favDiary.json);

  const favMessage = await you.call('PATCH', `/api/messages/${messageId}/favorite`, { favorite: true });
  check('message favorited', favMessage.status === 200, favMessage.json);

  const favorites = await you.call('GET', '/api/favorites');
  check('favorites feed includes the entry', favorites.status === 200 && favorites.json.diaryEntries.some((e: any) => e.id === sharedId), favorites.json);
  check('favorites feed includes the message', favorites.json?.messages?.some((m: any) => m.id === messageId));

  console.log('\ntags + search');
  const tagged = await you.call('PATCH', `/api/diary/${sharedId}`, { tags: ['birthday', '2026', 'special'] });
  check('tags saved', tagged.status === 200 && tagged.json?.entry?.tags?.includes('birthday'), tagged.json?.entry?.tags);

  const searchBirthday = await her.call('GET', '/api/search?q=birthday');
  check('search finds the tag', searchBirthday.json?.tags?.some((t: any) => t.name === 'birthday'), searchBirthday.json?.tags);
  check('tag search surfaces the entry', searchBirthday.json?.diaryEntries?.some((e: any) => e.id === sharedId));

  console.log('\ntimeline');
  const timeline = await you.call('GET', '/api/timeline?months=3');
  check('timeline returns months', timeline.status === 200 && Array.isArray(timeline.json?.months), timeline.json);
  const hasMessages = (timeline.json?.months ?? []).some((m: any) => m.totals.messages > 0);
  check('timeline counts messages', hasMessages, timeline.json?.months?.[0]?.totals);

  console.log('\nvalidation + rate limiting');
  const emptyTitle = await you.call('POST', '/api/diary', { title: '   ', content: 'x' });
  check('empty title is rejected', emptyTitle.status === 400, emptyTitle.json);

  const badCollection = await you.call('POST', '/api/diary', {
    title: 'x',
    collectionId: '00000000-0000-4000-8000-000000000000',
  });
  check('unknown collection is rejected', badCollection.status === 400, badCollection.json);

  const xss = await you.call('POST', '/api/diary', {
    title: 'x',
    content: '<p>hi</p><script>alert(1)</script>',
  });
  check('script tags in content are rejected', xss.status === 400, xss.json);

  const badInvite2 = await stranger.call('POST', '/api/auth/login', { email: 'x@y.z', password: 'a' });
  check('malformed login payload is rejected', badInvite2.status === 400, badInvite2.json);

  console.log('\ncollection deletion keeps its memories');
  const collectionForDelete = await you.call('POST', '/api/collections', { name: 'To Delete' });
  const deleteId = collectionForDelete.json?.collection?.id;
  const entryInIt = await you.call('POST', '/api/diary', {
    title: 'Should survive',
    content: '<p>keep me</p>',
    visibility: 'SHARED',
    collectionId: deleteId,
  });
  const keptEntryId = entryInIt.json?.entry?.id;

  const deleted = await you.call('DELETE', `/api/collections/${deleteId}`);
  check('collection deleted', deleted.status === 200 && deleted.json?.deleted, deleted.json);
  check('response reports kept diary entries', deleted.json?.keptDiaryEntries === 1, deleted.json);

  const survivor = await her.call('GET', `/api/diary/${keptEntryId}`);
  check('diary entry survives the collection deletion', survivor.status === 200, survivor.json);
  check('surviving entry is no longer filed', survivor.json?.entry?.collection === null, survivor.json?.entry?.collection);

  console.log('\nphoto upload pipeline');
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 210, g: 160, b: 140 } },
  })
    .jpeg()
    .toBuffer();

  const form = new FormData();
  form.append('photos', new Blob([jpeg], { type: 'image/jpeg' }), 'memory.jpg');
  const notAnImage = Buffer.from('this is definitely not a photo');
  form.append('photos', new Blob([notAnImage], { type: 'image/jpeg' }), 'fake.jpg');

  const upload = await fetch(`${BASE}/api/uploads/photos`, {
    method: 'POST',
    headers: { cookie: you.cookie },
    body: form,
  });
  const uploadJson = (await upload.json()) as any;
  check('photo upload accepted', upload.status === 201, uploadJson);
  check('a non-photo file is rejected but the good one survives', uploadJson?.uploads?.length === 1, uploadJson);
  check('the bad file is reported back', uploadJson?.failed?.length === 1, uploadJson?.failed);
  check('upload is re-encoded to webp', uploadJson?.uploads?.[0]?.attachment?.mimeType === 'image/webp', uploadJson?.uploads?.[0]);
  check('a thumbnail was generated', Boolean(uploadJson?.uploads?.[0]?.attachment?.thumbnailUrl), uploadJson?.uploads?.[0]);

  const attachmentId = uploadJson?.uploads?.[0]?.attachment?.id;
  const thumbnailUrl = uploadJson?.uploads?.[0]?.attachment?.thumbnailUrl;
  const fullUrl = uploadJson?.uploads?.[0]?.attachment?.url;

  const photo = await you.call('POST', '/api/photos', {
    url: fullUrl,
    thumbnailUrl,
    width: uploadJson?.uploads?.[0]?.attachment?.width ?? 900,
    height: uploadJson?.uploads?.[0]?.attachment?.height ?? 600,
    sizeBytes: uploadJson?.uploads?.[0]?.attachment?.sizeBytes ?? 1000,
    mimeType: 'image/webp',
    caption: 'Our beach trip',
    collectionId,
  });
  check('photo record created', photo.status === 201, photo.json);
  const photoId = photo.json?.photo?.id;

  const herPhoto = await her.call('GET', '/api/photos');
  check('partner sees the shared photo', herPhoto.json?.items?.some((p: any) => p.id === photoId), herPhoto.json);
  check('photo carries its collection', herPhoto.json?.items?.find((p: any) => p.id === photoId)?.collection?.id === collectionId);

  const mediaAnon = await fetch(`${BASE}${thumbnailUrl ?? ''}`);
  check('media is not world-readable', mediaAnon.status === 401, mediaAnon.status);

  const mediaYou = await fetch(`${BASE}${thumbnailUrl ?? ''}`, { headers: { cookie: you.cookie } });
  check('media is readable by a signed-in member', mediaYou.status === 200, mediaYou.status);

  const collectionAfterUpload = await her.call('GET', `/api/collections/${collectionId}`);
  check('collection photo count updated', collectionAfterUpload.json?.collection?.photoCount === 1, collectionAfterUpload.json?.collection);

  console.log('\nvoice messages');
  const voiceForm = new FormData();
  const webm = Buffer.from('fake-webm-bytes-for-pipeline-test');
  voiceForm.append('audio', new Blob([webm], { type: 'audio/webm' }), 'note.webm');
  voiceForm.append('durationSeconds', '3.5');
  const voiceUpload = await fetch(`${BASE}/api/uploads/voice`, {
    method: 'POST',
    headers: { cookie: you.cookie },
    body: voiceForm,
  });
  const voiceJson = (await voiceUpload.json()) as any;
  check('voice upload accepted', voiceUpload.status === 201, voiceJson);

  const voiceMessage = await you.call('POST', '/api/messages', {
    type: 'VOICE',
    attachmentId: voiceJson?.attachment?.id,
  });
  check('voice message sent', voiceMessage.status === 201, voiceMessage.json);
  check(
    'voice message carries its attachment',
    voiceMessage.json?.message?.attachment?.kind === 'VOICE',
    voiceMessage.json?.message?.attachment,
  );

  const badAudio = new FormData();
  badAudio.append('audio', new Blob([Buffer.from('x')], { type: 'application/x-msdownload' }), 'evil.exe');
  const badAudioUpload = await fetch(`${BASE}/api/uploads/voice`, {
    method: 'POST',
    headers: { cookie: you.cookie },
    body: badAudio,
  });
  check('non-audio voice upload rejected', badAudioUpload.status === 400, badAudioUpload.status);

  const herCannotDelete = await her.call('DELETE', `/api/photos/${photoId}`);
  check("partner cannot delete someone else's photo", herCannotDelete.status === 403, herCannotDelete.json);

  const photoMove = await you.call('POST', '/api/photos/move', {
    photoIds: [photoId].filter(Boolean),
    collectionId: null,
  });
  check('photo can be moved out of a collection', photoMove.json?.moved === 1, photoMove.json);

  console.log('\ncleanup');
  if (photoId) await you.call('DELETE', `/api/photos/${photoId}`);
  if (attachmentId) await you.call('DELETE', `/api/uploads/${attachmentId}`);
  await you.call('DELETE', `/api/diary/${keptEntryId}`);
  await you.call('DELETE', `/api/diary/${sharedId}`);
  await you.call('DELETE', `/api/diary/${privateId}`);
  await you.call('DELETE', `/api/collections/${collectionId}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nverification crashed:', error);
  process.exitCode = 1;
});
