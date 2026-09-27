import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { HttpError } from '../lib/errors.js';
import { flattenZodError } from './validate.js';
import { config } from '../config.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist.' } });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(error);

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Some of those details need another look.', details: flattenZodError(error) },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'That file is too large.'
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'Too many files at once.'
          : 'That upload could not be read.';
    res.status(status).json({ error: { code: error.code.toLowerCase(), message } });
    return;
  }

  if (error instanceof Error) {
    if ((error as NodeJS.ErrnoException).code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: { code: 'payload_too_large', message: 'That file is too large.' } });
      return;
    }
  }

  console.error('[unhandled]', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side.',
      ...(config.isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
    },
  });
}

/** Wraps an async handler so rejected promises reach the error handler. */
export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
