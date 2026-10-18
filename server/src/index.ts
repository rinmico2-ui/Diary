import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { createRealtimeServer } from './realtime/socket.js';
import { db } from './db/index.js';
import { purgeExpiredSessions } from './lib/session.js';
import { purgeExpiredPasswordResetTokens } from './lib/passwordReset.js';

db.migrate();
try {
  db.sync();
} catch {
  /* remote sync is best effort; local file still works */
}

// Handy on hosts where you cannot open a shell (a free PaaS, for example):
// with LOG_ACCOUNTS=1 the account list appears in the deploy logs.
if (config.logAccounts) {
  const accounts = db.all<{ email: string; name: string; created_at: string }>(
    'SELECT email, name, created_at FROM users ORDER BY created_at',
  );
  console.log(`\n  Accounts (${accounts.length}):`);
  for (const account of accounts) console.log(`   - ${account.name} <${account.email}>`);
  console.log('');
}

const app = createApp();
const server = http.createServer(app);
createRealtimeServer(server);

// Expired sessions and reset tokens are swept hourly so neither table grows forever.
const sweep = setInterval(
  () => {
    try {
      purgeExpiredSessions();
      purgeExpiredPasswordResetTokens();
    } catch (error) {
      console.error('[session sweep]', error);
    }
  },
  60 * 60 * 1000,
);
sweep.unref();

// A second `npm run dev` is the most likely thing to go wrong, so explain it
// in plain language instead of dumping a Node stack trace.
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n  Port ${config.port} is already in use — another copy of the server is probably running.\n` +
        `  Stop it first (Ctrl+C in that terminal, or run: npm run stop)\n` +
        `  Or use a different port by setting PORT in server/.env\n`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(config.port, () => {
  console.log(`\n  ${config.spaceName}`);
  console.log(`  API      http://localhost:${config.port}/api`);
  console.log(`  Client   ${config.webOrigin}`);
  console.log(`  Database ${config.databaseUrl ? '(configured remote database)' : config.databasePath}`);
  console.log(`  Storage  ${config.storageDir}`);
  console.log(`  Mode     ${config.env}\n`);
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received, closing gracefully.`);
  clearInterval(sweep);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  // Do not hang forever if a socket refuses to close.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
