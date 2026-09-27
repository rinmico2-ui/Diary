import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { attachPrincipal } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { messagesRouter } from './routes/messages.js';
import { diaryRouter } from './routes/diary.js';
import { photosRouter } from './routes/photos.js';
import { collectionsRouter } from './routes/collections.js';
import { invitesRouter } from './routes/invites.js';
import { uploadRouter } from './routes/upload.js';
import { appRouter } from './routes/app.js';
import { mediaRouter } from './routes/media.js';

export function isOriginAllowed(origin: string): boolean {
  if (config.corsOrigins.includes(origin)) return true;

  // In development the Vite dev server will pick a different port whenever
  // 5173 is taken, so any loopback port on http is treated as our own client.
  if (!config.isProduction) {
    try {
      const url = new URL(origin);
      const isLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
      if (isLoopback && (url.protocol === 'http:' || url.protocol === 'https:')) return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function createApp() {
  const app = express();

  // Behind a reverse proxy in production, so rate limiting and IPs are accurate.
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Media is served same-origin from our own API; CSP is set for the app shell.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser clients send no Origin header.
        if (!origin) return callback(null, true);
        if (isOriginAllowed(origin)) return callback(null, true);
        // Must be an HttpError: a plain Error would be reported as a 500 and
        // make a rejected origin look like a server fault.
        callback(
          new HttpError(403, 'This request came from an address the space does not trust.', 'origin_not_allowed'),
        );
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Resolves the session once, for every route below.
  app.use(attachPrincipal);

  app.use('/api', apiLimiter);

  // Media must be reachable before the general limiter for large photo loads.
  app.use('/media', mediaRouter);

  app.use('/api/auth', authRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/diary', diaryRouter);
  app.use('/api/photos', photosRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/invites', invitesRouter);
  app.use('/api/uploads', uploadRouter);
  app.use('/api', appRouter);

  // In production this same process serves the built client, so the app runs on
  // one origin. That is also what the httpOnly session cookie wants — no CORS
  // and no cross-site cookie edge cases in the live app.
  if (config.isProduction) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        maxAge: '1h',
        setHeaders(res, filePath) {
          // The shell must be revalidated or clients get pinned to an old
          // bundle; /assets/* is content-hashed and safe to cache.
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );

    // Deep links like /diary/<id> are client routes, so hand them the shell.
    // API, media and bundle assets fall through to the real 404 handler —
    // returning HTML for a missing .js would show up as a module parse error.
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/media') ||
        req.path.startsWith('/socket.io') ||
        req.path.startsWith('/assets/')
      ) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'), (error) => {
        if (error) next();
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
