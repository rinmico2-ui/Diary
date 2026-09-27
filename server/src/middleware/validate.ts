import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and *replaces* the given request segment with the parsed result, so
 * handlers only ever see values that match the schema. Unknown keys are stripped
 * by zod, which means a client cannot smuggle extra fields into a query.
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === 'query') {
        // req.query has only a getter in Express 5 style; assign defensively.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      } else {
        req[source] = parsed as never;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(badRequest('Some of those details need another look.', flattenZodError(error)));
      }
      next(error);
    }
  };
}

export function flattenZodError(error: ZodError): Record<string, string[]> {
  const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const out: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages) out[key] = messages;
  }
  return out;
}

export type { z };
