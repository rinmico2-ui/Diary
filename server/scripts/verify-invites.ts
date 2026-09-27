/**
 * Verifies the invitation-code flow end to end.
 *
 * Requires an EMPTY space (0 members). Run after: npm run reset -- --yes
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
    if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 300)}`);
  }
}

class Client {
  private cookie = '';
  isAuthenticated = false;

  async call(method: string, path: string, body?: unknown) {
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
      if (pair?.startsWith('ols_session=')) {
        this.cookie = pair;
        this.isAuthenticated = true;
      }
    }

    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: response.status, json: json as any };
  }
}

const owner = new Client();
const guest = new Client();
const stranger = new Client();

const stamp = Date.now();
const PASSWORD = 'invitetest-2026';

async function main(): Promise<void> {
  console.log('\nfirst person needs no code');
  const first = await owner.call('POST', '/auth/register', {
    name: 'Inviter',
    email: `inviter-${stamp}@test.local`,
    password: PASSWORD,
  });
  check('first person registers with no invite code', first.status === 201, first.json);
  check('first person becomes the owner', first.json?.role === 'owner', first.json?.role);

  const me = await owner.call('GET', '/auth/me');
  check('space reports no partner yet', me.json?.partner === null, me.json?.partner);

  console.log('\ncreating an invitation');
  const seats = await owner.call('GET', '/invites');
  check('one seat is free', seats.json?.seatsLeft === 1, seats.json);
  check('owner may create a code', seats.json?.canCreate === true, seats.json);

  const created = await owner.call('POST', '/invites', {});
  check('invitation created', created.status === 201, created.json);

  const code: string = created.json?.code ?? '';
  check('code is human readable', /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);

  const listed = await owner.call('GET', '/invites');
  const createdEntry = listed.json?.invites?.find((i: any) => i.id === created.json?.invite?.id);
  check('the new code appears in the list', createdEntry !== undefined, listed.json?.invites);
  check('its status is active', createdEntry?.status === 'active', createdEntry);
  check(
    'the full code is never sent back to the client',
    JSON.stringify(listed.json).includes(code) === false,
    listed.json,
  );
  check('a hint is shown instead', typeof createdEntry?.hint === 'string', createdEntry);

  console.log('\nchecking a code before joining');
  check(
    'valid code passes the checker',
    (await guest.call('POST', '/auth/check-invite', { inviteCode: code })).status === 200,
  );
  check(
    'invalid code is rejected',
    (await guest.call('POST', '/auth/check-invite', { inviteCode: 'NOPE-NOPE-NOPE' })).status === 400,
  );
  check(
    'lowercase code is accepted',
    (await guest.call('POST', '/auth/check-invite', { inviteCode: code.toLowerCase() })).status === 200,
  );
  check(
    'code typed without dashes is accepted',
    (await guest.call('POST', '/auth/check-invite', { inviteCode: code.replace(/-/g, ' ') })).status === 200,
  );
  check(
    'empty code is rejected',
    (await guest.call('POST', '/auth/check-invite', { inviteCode: '' })).status === 400,
  );

  const afterChecking = await owner.call('GET', '/invites');
  const stillActive = afterChecking.json?.invites?.find((i: any) => i.id === created.json?.invite?.id);
  check(
    'checking a code does NOT mark it used',
    stillActive?.status === 'active',
    stillActive,
  );

  console.log('\nrevoking an unused code');
  const second = await owner.call('POST', '/invites', { expiresInHours: 24 });
  const revokeCode: string = second.json?.code ?? '';
  const revokeId: string = second.json?.invite?.id ?? '';
  check('a second code can be created while a seat is free', Boolean(revokeCode), second.json);
  check('expiry is recorded', typeof second.json?.invite?.expiresAt === 'string', second.json?.invite);

  check('owner can revoke an unused code', (await owner.call('DELETE', `/invites/${revokeId}`)).status === 204);

  const afterRevoke = await owner.call('GET', '/invites');
  const revokedEntry = afterRevoke.json?.invites?.find((i: any) => i.id === revokeId);
  check('revoked code shows as revoked', revokedEntry?.status === 'revoked', revokedEntry);
  check(
    'a revoked code is refused at the join gate',
    (await stranger.call('POST', '/auth/check-invite', { inviteCode: revokeCode })).status === 400,
  );
  check('revoking twice is harmless', (await owner.call('DELETE', `/invites/${revokeId}`)).status === 204);

  console.log('\naccess control on the invitation list');
  check('anonymous cannot list invitations', (await stranger.call('GET', '/invites')).status === 401);
  check('anonymous cannot revoke', (await stranger.call('DELETE', `/invites/${revokeId}`)).status === 401);
  check(
    'revoking a code from another space is impossible here',
    (await owner.call('DELETE', '/invites/00000000-0000-4000-8000-000000000000')).status === 404,
  );

  console.log('\njoining with the code');
  const second2 = await guest.call('POST', '/auth/register', {
    name: 'Invitee',
    email: `invitee-${stamp}@test.local`,
    password: PASSWORD,
    inviteCode: code,
  });
  check('second person joins with the code', second2.status === 201, second2.json);
  check('second person is a member, not owner', second2.json?.role === 'member', second2.json?.role);

  const used = await owner.call('GET', '/invites');
  const usedEntry = used.json?.invites?.find((i: any) => i.status === 'used');
  check('code is now marked used', usedEntry !== undefined, used.json?.invites);
  check('used code records who used it', usedEntry?.usedByName === 'Invitee', usedEntry);

  const together = await owner.call('GET', '/auth/me');
  check('they are now partners', together.json?.partner?.name === 'Invitee', together.json?.partner);

  console.log('\nsingle use and capacity');
  check(
    'a used code cannot be reused',
    [400, 409].includes(
      (
        await stranger.call('POST', '/auth/register', {
          name: 'Third',
          email: `third-${stamp}@test.local`,
          password: PASSWORD,
          inviteCode: code,
        })
      ).status,
    ),
  );
  check('no new code once the space is full', (await owner.call('POST', '/invites', {})).status === 409);
  check(
    // 409 is the accurate answer once the space is full; 400 if a seat is open.
    'registering without a code is refused once someone is in',
    [400, 409].includes(
      (
        await stranger.call('POST', '/auth/register', {
          name: 'Fourth',
          email: `fourth-${stamp}@test.local`,
          password: PASSWORD,
        })
      ).status,
    ),
  );
  check(
    'a member cannot create an invitation',
    [403, 409].includes((await guest.call('POST', '/invites', {})).status),
  );
  check('the space still has exactly two members', (await owner.call('GET', '/invites')).json?.seatsLeft === 0);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\ncrashed:', error);
  process.exitCode = 1;
});
