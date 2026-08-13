import bcrypt from 'bcryptjs';
import { AppError } from './errors.js';

const COST = 12;
const MIN_LENGTH = 8;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function assertPasswordPolicy(plain: string): void {
  if (typeof plain !== 'string' || plain.length < MIN_LENGTH) {
    throw new AppError('VALIDATION_ERROR', `Password must be at least ${MIN_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) {
    throw new AppError('VALIDATION_ERROR', 'Password must contain at least one letter and one digit');
  }
}
