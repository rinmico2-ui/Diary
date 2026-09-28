/** Error carrying an HTTP status so route handlers can `throw` instead of branching. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'This belongs to a space you are not part of.') => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'We could not find that.') => new HttpError(404, message, 'not_found');
export const conflict = (message: string) => new HttpError(409, message, 'conflict');
export const tooLarge = (message: string) => new HttpError(413, message, 'payload_too_large');
export const rateLimited = (message = 'Slow down a moment, please.') => new HttpError(429, message, 'rate_limited');
export const serviceUnavailable = (message: string) => new HttpError(503, message, 'service_unavailable');
export const tooManySpaces = (message: string) => new HttpError(409, message, 'space_is_full');
