import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { rateLimited } from '../lib/errors.js';
import { clientIp } from './auth.js';

function build(options: Partial<Options> & { max: number; windowMs?: number; message: string }) {
  const { max, windowMs, message, ...rest } = options;
  return rateLimit({
    windowMs: windowMs ?? config.rateLimitWindowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Rate limit per account when signed in, otherwise per IP, so two people
    // sharing a household connection never lock each other out.
    keyGenerator: (req: Request) => req.userId ?? clientIp(req) ?? 'anonymous',
    handler: (_req: Request, _res: Response, next) => next(rateLimited(message)),
    ...rest,
  });
}

export const apiLimiter = build({
  max: config.apiRateLimitMax,
  message: 'You are moving a little fast. Give it a second.',
});

export const authLimiter = build({
  max: config.authRateLimitMax,
  message: 'Too many attempts. Please wait a minute and try again.',
  skipSuccessfulRequests: true,
});

export const uploadLimiter = build({
  max: config.uploadRateLimitMax,
  message: 'That is a lot of uploads at once. Let us catch our breath.',
});
