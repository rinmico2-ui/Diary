/**
 * Creates the private space and, optionally, the two accounts.
 *
 *   npm run seed                 -> create the space only
 *   npm run seed -- --people     -> also create the two demo accounts
 *
 * Demo credentials are printed once so they can be changed right away.
 */
import { db } from '../src/db/index.js';

db.migrate();
import { config } from '../src/config.js';
import { newId } from '../src/lib/ids.js';
import { hashPassword } from '../src/lib/password.js';
import type { SpaceRow } from '../src/types.js';

const withPeople = process.argv.includes('--people');
const DEMO_PASSWORD = 'ourlittle2026';

function ensureSpace(): string {
  const existing = db.get<SpaceRow>('SELECT * FROM private_spaces ORDER BY created_at ASC LIMIT 1');
  if (existing) {
    console.log(`Space already exists: ${existing.name} (${existing.id})`);
    return existing.id;
  }

  const id = newId();
  db.run('INSERT INTO private_spaces (id, name) VALUES (?, ?)', id, config.spaceName);
  console.log(`Created space: ${config.spaceName} (${id})`);
  return id;
}

function memberCount(spaceId: string): number {
  return db.count('SELECT COUNT(*) AS value FROM space_members WHERE space_id = ?', spaceId);
}

async function addPerson(
  spaceId: string,
  name: string,
  email: string,
  password: string,
  role: 'owner' | 'member',
): Promise<boolean> {
  if (db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', email)) {
    console.log(`- ${name} already has an account, skipping.`);
    return false;
  }

  const userId = newId();
  const passwordHash = await hashPassword(password);

  db.run(
    'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
    userId,
    name,
    email,
    passwordHash,
  );
  db.run(
    'INSERT INTO space_members (id, space_id, user_id, role) VALUES (?, ?, ?, ?)',
    newId(),
    spaceId,
    userId,
    role,
  );
  db.run('INSERT INTO user_settings (user_id) VALUES (?)', userId);

  console.log(`- Added ${name} <${email}>`);
  return true;
}

const spaceId = ensureSpace();

if (withPeople) {
  if (memberCount(spaceId) >= 2) {
    console.log('The space already has its two people. Nothing to add.');
  } else {
    const hasOwner = memberCount(spaceId) > 0;
    const people = hasOwner
      ? [{ name: 'Her', email: 'her@ourlittlespace.app' }]
      : [
          { name: 'You', email: 'you@ourlittlespace.app' },
          { name: 'Her', email: 'her@ourlittlespace.app' },
        ];

    for (const person of people) {
      await addPerson(spaceId, person.name, person.email, DEMO_PASSWORD, hasOwner ? 'member' : 'owner');
    }

    console.log('\n  Demo sign-in — change these right away:');
    console.log('  you@ourlittlespace.app  /  ' + DEMO_PASSWORD);
    console.log('  her@ourlittlespace.app  /  ' + DEMO_PASSWORD);
    console.log('');
  }
}

db.close();
