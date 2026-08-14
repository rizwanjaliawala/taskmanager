import { PRODUCT_NAME, esc, fmtDateTime, label, layout, toText } from '../render.js';
import type { TaskPriority, TaskStatus } from '../../../db/schema.js';

export type DigestTask = {
  ref: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: Date | null;
  isOverdue: boolean;
  taskUrl: string;
};

export type DigestContext = {
  recipientName: string;
  weekOf: Date;
  overdue: DigestTask[];
  dueThisWeek: DigestTask[];
  otherOpen: DigestTask[];
  completedLastWeek: number;
  appUrl: string;
};

const weekLabel = (d: Date) =>
  d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function digestSubject(c: DigestContext): string {
  const open = c.overdue.length + c.dueThisWeek.length + c.otherOpen.length;
  const overdueNote = c.overdue.length ? `, ${c.overdue.length} overdue` : '';
  return `[${PRODUCT_NAME}] Your week: ${open} open task${open === 1 ? '' : 's'}${overdueNote}`;
}

/** One block of tasks. Returns '' when empty so a section can be omitted entirely. */
function section(heading: string, tasks: DigestTask[], accent: string): string {
  if (!tasks.length) return '';

  const rows = tasks.map((t) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eef2f7">
        <a href="${esc(t.taskUrl)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:14px">
          ${esc(t.title)}
        </a>
        <div style="margin-top:3px;font-size:12px;color:#64748b">
          ${esc(t.ref)} &middot; ${esc(label(t.priority))} &middot; ${esc(label(t.status))}
          &middot; ${esc(fmtDateTime(t.dueAt))}
        </div>
      </td>
    </tr>`).join('');

  return `
    <div style="margin:22px 0 0">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${accent}">
        ${esc(heading)} (${tasks.length})
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">
        ${rows}
      </table>
    </div>`;
}

export function digestHtml(c: DigestContext): string {
  const open = c.overdue.length + c.dueThisWeek.length + c.otherOpen.length;

  const intro = open === 0
    ? `Nothing is open on your board. ${c.completedLastWeek} task${c.completedLastWeek === 1 ? '' : 's'} closed last week.`
    : `${open} task${open === 1 ? '' : 's'} open, ${c.completedLastWeek} closed last week.`;

  return layout({
    heading: `Your week — ${weekLabel(c.weekOf)}`,
    intro,
    // Red when something has already slipped, otherwise the neutral accent.
    priority: c.overdue.length ? 'critical' : 'medium',
    ctaUrl: c.appUrl,
    ctaLabel: 'Open the task manager',
    body:
      section('Overdue', c.overdue, '#ef4444') +
      section('Due this week', c.dueThisWeek, '#f59e0b') +
      section('Also open', c.otherOpen, '#64748b'),
  });
}

export function digestText(c: DigestContext): string {
  const line = (t: DigestTask) =>
    `  ${t.ref}  ${t.title} — ${label(t.priority)}, due ${fmtDateTime(t.dueAt)}`;

  const block = (heading: string, tasks: DigestTask[]) =>
    tasks.length ? [`${heading} (${tasks.length})`, ...tasks.map(line), ''] : [];

  const open = c.overdue.length + c.dueThisWeek.length + c.otherOpen.length;

  return toText([
    `Your week — ${weekLabel(c.weekOf)}`,
    `${open} open, ${c.completedLastWeek} closed last week.`,
    '',
    ...block('OVERDUE', c.overdue),
    ...block('DUE THIS WEEK', c.dueThisWeek),
    ...block('ALSO OPEN', c.otherOpen),
    `Open the task manager: ${c.appUrl}`,
  ]);
}
