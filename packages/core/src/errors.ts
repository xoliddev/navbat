export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'SLOT_UNAVAILABLE'
  | 'TOO_SOON'
  | 'OUTSIDE_HORIZON'
  | 'NOT_WORKING'
  | 'SERVICE_NOT_OFFERED'
  | 'CANCEL_WINDOW_PASSED'
  | 'INVALID_TRANSITION'
  | 'REVIEW_NOT_ALLOWED'
  | 'PAYMENT_FAILED';

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  SLOT_UNAVAILABLE: 409,
  TOO_SOON: 422,
  OUTSIDE_HORIZON: 422,
  NOT_WORKING: 422,
  SERVICE_NOT_OFFERED: 422,
  CANCEL_WINDOW_PASSED: 422,
  INVALID_TRANSITION: 409,
  REVIEW_NOT_ALLOWED: 422,
  PAYMENT_FAILED: 402,
};

/** An expected, user-facing failure of a business rule. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return (
    e instanceof DomainError || (typeof e === 'object' && e !== null && (e as Error).name === 'DomainError')
  );
}
