/**
 * Empties the private space so a real pair of people can sign up from scratch.
 *
 *   npm run reset              -> asks for confirmation
 *   npm run reset -- --yes     -> just do it
 *
 * Keeps the space itself (it must exist for anyone to register), but removes
 * both accounts, every message, memory, photo file, collection and tag.
 */
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { db } from '../src/db/index.js';
import { config } from '../src/config.js';
import { clearUserCache } from '../src/services/serialize.js';

const skipPrompt = process.argv.includes('--yes');

async function confirm(): Promise<boolean> {
  if (skipPrompt) return true;
  if (!process.stdin.isTTY) {
    console.log('\n  This deletes both accounts and every memory.');
    console.log('  Re-run with --yes to confirm: npm run reset -- --yes\n');
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    '\n  This deletes BOTH accounts and every message, photo and diary entry.\n  Type "reset" to confirm: ',
  );
  rl.close();
  return answer.trim().toLowerCase() === 'reset';
}

/** Deletes every file in a storage bucket, so no orphans are left behind. */
function emptyBucket(bucket: keyof typeof config.storagePaths): number {
  const root = config.storagePaths[bucket];
  if (!fs.existsSync(root)) return 0;

  let removed = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
        fs.rmdirSync(full);
      } else {
        fs.rmSync(full, { force: true });
        removed++;
      }
    }
  };

  walk(root);
  return removed;
}

async function main(): Promise<void> {
  const space = db.get<{ id: string; name: string }>('SELECT * FROM private_spaces ORDER BY created_at ASC LIMIT 1');
  if (!space) {
    console.error('No space exists yet. Run: npm run seed');
    process.exit(1);
  }

  const memberCount = db.count('SELECT COUNT(*) AS value FROM space_members WHERE space_id = ?', space.id);
  const photoCount = db.count('SELECT COUNT(*) AS value FROM photos WHERE space_id = ?', space.id);
  const messageCount = db.count('SELECT COUNT(*) AS value FROM messages WHERE space_id = ?', space.id);

  console.log(`\n  Space:  ${space.name}`);
  console.log(`  Members: ${memberCount}`);
  console.log(`  Photos:  ${photoCount}`);
  console.log(`  Messages: ${messageCount}`);

  if (memberCount === 0) {
    console.log('\n  The space is already empty. Nothing to do.\n');
    db.close();
    return;
  }

  if (!(await confirm())) {
    console.log('\n  Cancelled. Nothing was changed.\n');
    db.close();
    return;
  }

  const filesBefore = (Object.keys(config.storagePaths) as Array<keyof typeof config.storagePaths>).reduce(
    (total, bucket) => total + emptyBucket(bucket),
    0,
  );

  // Order matters only for readability: children before parents, though the
  // ON DELETE CASCADE clauses would handle it anyway.
  db.transaction(() => {
    db.run('DELETE FROM notifications');
    db.run('DELETE FROM message_reactions');
    db.run('DELETE FROM message_reads');
    db.run('DELETE FROM messages');
    db.run('DELETE FROM photos');
    db.run('DELETE FROM diary_entries');
    db.run('DELETE FROM memory_tags');
    db.run('DELETE FROM tags');
    db.run('DELETE FROM collections');
    db.run('DELETE FROM attachments');
    db.run('DELETE FROM sessions');
    db.run('DELETE FROM user_settings');
    db.run('DELETE FROM space_members');
    db.run('DELETE FROM invite_codes');
    db.run('DELETE FROM users');
  });

  clearUserCache();

  const remaining = db.count('SELECT COUNT(*) AS value FROM space_members WHERE space_id = ?', space.id);
  if (remaining !== 0) {
    console.error('\n  Something is wrong: the space is not empty. Aborting.\n');
    process.exit(1);
  }

  console.log(`\n  Cleared ${memberCount} account(s) and ${filesBefore} stored file(s).`);
  console.log('\n  The space is now empty and waiting for two people.');
  console.log(`  Invite code: ${config.inviteCode}\n`);
  console.log('  Next:');
  console.log('    1. Sign up yourself at http://localhost:5173  (you become the owner)');
  console.log('    2. Send the invite code to her');
  console.log('    3. She signs up with the same code');
  console.log('    4. Optional: npm run seed:demo   to fill it with example memories\n');

  db.close();
}

await main();
