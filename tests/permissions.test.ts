import { describe, expect, it } from 'vitest';
import { can } from '../src/lib/permissions.js';
import type { AuthUser } from '../src/lib/auth.js';
import { ROLES } from '../src/db/schema.js';

const mk = (role: AuthUser['role'], id = 'u-self'): AuthUser => ({
  id, email: `${id}@utopiabrands.com`, fullName: 'Test', role,
  isActive: true, mustChangePassword: false, teamId: 't1',
});

const manager = mk('manager', 'u-manager');
const director = mk('director', 'u-director');
const executive = mk('executive', 'u-exec');

const task = { createdBy: 'u-creator', assignedTo: 'u-assignee' };

describe('user management — Manager only', () => {
  for (const action of ['user:create', 'user:update', 'user:activate', 'user:deactivate', 'team:manage'] as const) {
    it(`allows a Manager to ${action}`, () => {
      expect(can(manager, action)).toBe(true);
    });

    it(`denies every non-Manager role ${action}`, () => {
      for (const role of ROLES.filter((r) => r !== 'manager')) {
        expect(can(mk(role), action)).toBe(false);
      }
    });
  }

  it('denies a Director user:create — rank does not grant user management', () => {
    expect(can(director, 'user:create')).toBe(false);
  });

  it('denies an inactive Manager everything', () => {
    const inactive = { ...manager, isActive: false };
    expect(can(inactive, 'user:create')).toBe(false);
    expect(can(inactive, 'task:view')).toBe(false);
  });
});

describe('flat task access — single team', () => {
  for (const action of ['task:list', 'task:view', 'task:create', 'task:assign', 'task:comment', 'user:list'] as const) {
    it(`allows every role to ${action}`, () => {
      for (const role of ROLES) expect(can(mk(role), action, task)).toBe(true);
    });
  }
});

describe('task mutation — creator, assignee or Manager', () => {
  for (const action of ['task:edit', 'task:delete', 'task:changeStatus', 'task:complete'] as const) {
    it(`allows the creator to ${action}`, () => {
      expect(can(mk('executive', 'u-creator'), action, task)).toBe(true);
    });

    it(`allows the assignee to ${action}`, () => {
      expect(can(mk('executive', 'u-assignee'), action, task)).toBe(true);
    });

    it(`allows a Manager who is neither to ${action}`, () => {
      expect(can(manager, action, task)).toBe(true);
    });

    it(`denies an unrelated non-Manager ${action}`, () => {
      expect(can(mk('director', 'u-bystander'), action, task)).toBe(false);
      expect(can(executive, action, task)).toBe(false);
    });

    it(`denies ${action} when no resource is supplied`, () => {
      expect(can(executive, action)).toBe(false);
    });
  }
});

describe('password change — self only', () => {
  it('allows a user to change their own password', () => {
    expect(can(executive, 'password:change', { userId: 'u-exec' })).toBe(true);
  });

  it("denies a Manager changing another user's password", () => {
    expect(can(manager, 'password:change', { userId: 'u-exec' })).toBe(false);
  });

  it('denies a Director changing another password', () => {
    expect(can(director, 'password:change', { userId: 'u-exec' })).toBe(false);
  });
});

describe('notifications — owner only', () => {
  it('allows the owner to read their notification', () => {
    expect(can(executive, 'notification:read', { userId: 'u-exec' })).toBe(true);
  });

  it('denies a Manager reading another user notification', () => {
    expect(can(manager, 'notification:read', { userId: 'u-exec' })).toBe(false);
  });
});
