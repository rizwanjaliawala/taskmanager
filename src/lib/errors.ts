export type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'ACCOUNT_INACTIVE'
  | 'USER_EXISTS'
  | 'USER_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'INVALID_ASSIGNMENT'
  | 'INVALID_STATUS_TRANSITION'
  | 'SELF_ACTION_FORBIDDEN'
  | 'LAST_MANAGER'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'EMAIL_FAILED'
  | 'DATABASE_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  ACCOUNT_INACTIVE: 403,
  USER_EXISTS: 409,
  USER_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  INVALID_ASSIGNMENT: 422,
  INVALID_STATUS_TRANSITION: 422,
  SELF_ACTION_FORBIDDEN: 422,
  LAST_MANAGER: 422,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  EMAIL_FAILED: 502,
  DATABASE_ERROR: 500,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const unauthorized = (m = 'Authentication required') => new AppError('UNAUTHORIZED', m);
export const forbidden = (m = 'You do not have permission to perform this action') =>
  new AppError('FORBIDDEN', m);
export const notFound = (m = 'Resource not found') => new AppError('NOT_FOUND', m);
