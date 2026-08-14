import { beforeEach, describe, expect, it } from 'vitest';
import {
  sendAssignment, sendReminder, sendExpiry, sendAccountCreated,
  __sentMessages, __resetMailbox,
} from '../src/lib/email/index.js';

const ctx = {
  ref: 'UT-1042',
  title: 'Verify Amazon Container CTNR-88213',
  description: 'Cross-check the 40ft inbound container manifest against the ASN.',
  priority: 'high' as const,
  status: 'assigned' as const,
  dueAt: new Date('2026-08-14T16:30:00Z'),
  assignedByName: 'Shahzeb Ali',
  assignedToName: 'John Smith',
  taskUrl: 'http://localhost:3000/#task/UT-1042',
};

beforeEach(() => __resetMailbox());

describe('assignment email', () => {
  it('sends one message per recipient', async () => {
    await sendAssignment(['john@utopiabrands.com', 'shahzeb.ali@utopiabrands.com'], ctx);
    expect(__sentMessages).toHaveLength(2);
    expect(__sentMessages.map((m) => m.to).sort())
      .toEqual(['john@utopiabrands.com', 'shahzeb.ali@utopiabrands.com']);
  });

  it('includes every required task detail', async () => {
    await sendAssignment(['john@utopiabrands.com'], ctx);
    const body = __sentMessages[0]!.html;
    expect(body).toContain('UT-1042');
    expect(body).toContain('Verify Amazon Container CTNR-88213');
    expect(body).toContain('Cross-check the 40ft inbound container manifest');
    expect(body).toContain('High');
    expect(body).toContain('Shahzeb Ali');
    expect(body).toContain('http://localhost:3000/#task/UT-1042');
  });

  it('carries the product name and credit footnote', async () => {
    await sendAssignment(['john@utopiabrands.com'], ctx);
    const m = __sentMessages[0]!;
    expect(m.subject).toContain('Utopia Trucking Task Manager');
    expect(m.html).toContain('Created by Rizwan Hanif for Utopia Brands Trucking Team');
  });

  it('always ships a plain-text alternative', async () => {
    await sendAssignment(['john@utopiabrands.com'], ctx);
    expect(__sentMessages[0]!.text.length).toBeGreaterThan(50);
    expect(__sentMessages[0]!.text).toContain('UT-1042');
  });

  it('escapes HTML in a task title', async () => {
    await sendAssignment(['x@utopiabrands.com'], { ...ctx, title: '<img src=x onerror=alert(1)>' });
    expect(__sentMessages[0]!.html).not.toContain('<img src=x');
    expect(__sentMessages[0]!.html).toContain('&lt;img');
  });

  it('deduplicates a repeated recipient', async () => {
    await sendAssignment(['same@utopiabrands.com', 'same@utopiabrands.com'], ctx);
    expect(__sentMessages).toHaveLength(1);
  });
});

describe('reminder email', () => {
  it('states the task is still pending', async () => {
    await sendReminder(['john@utopiabrands.com'], { ...ctx, hoursPending: 26 });
    const m = __sentMessages[0]!;
    expect(m.subject.toLowerCase()).toContain('reminder');
    expect(m.html).toContain('UT-1042');
    expect(m.html.toLowerCase()).toContain('still');
  });
});

describe('expiry email', () => {
  it('states the assigned time has finished and shows the due date', async () => {
    await sendExpiry(['john@utopiabrands.com'], { ...ctx, status: 'overdue' });
    const m = __sentMessages[0]!;
    expect(m.subject.toLowerCase()).toContain('overdue');
    expect(m.html).toContain('UT-1042');
    expect(m.html.toLowerCase()).toContain('finished');
  });
});

describe('account created email', () => {
  it('sends the temporary password only to the new user', async () => {
    await sendAccountCreated({
      user: { id: 'u1', email: 'new@utopiabrands.com', fullName: 'New Hire', role: 'am' } as any,
      tempPassword: 'UtAbc12345',
      createdBy: 'Shahzeb Ali',
    });
    expect(__sentMessages).toHaveLength(1);
    expect(__sentMessages[0]!.to).toBe('new@utopiabrands.com');
    expect(__sentMessages[0]!.html).toContain('UtAbc12345');
    expect(__sentMessages[0]!.html.toLowerCase()).toContain('change');
  });
});
