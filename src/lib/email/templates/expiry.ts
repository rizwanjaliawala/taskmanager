import { PRODUCT_NAME, detailRows, esc, fmtDateTime, label, layout, toText } from '../render.js';
import type { TaskEmailContext } from '../index.js';

export function expirySubject(c: TaskEmailContext): string {
  return `[${PRODUCT_NAME}] Overdue: the assigned time for ${c.ref} has finished`;
}

export function expiryHtml(c: TaskEmailContext): string {
  return layout({
    heading: `The assigned time for ${c.ref} has finished`,
    intro: 'This task reached its due date and time and has not been completed. It is now marked Overdue.',
    priority: c.priority,
    ctaUrl: c.taskUrl,
    ctaLabel: 'Open the overdue task',
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${detailRows([
          ['Task', esc(c.title)],
          ['Reference', esc(c.ref)],
          ['Priority', esc(label(c.priority))],
          ['Status', esc(label(c.status))],
          ['Due', esc(fmtDateTime(c.dueAt))],
          ['Assigned by', esc(c.assignedByName)],
        ])}
      </table>
      ${c.description ? `<p style="margin:18px 0 0;padding:14px 16px;background:#f8fafc;
        border-left:3px solid #cbd5e1;border-radius:6px;font-size:14px;line-height:1.6;color:#334155">
        ${esc(c.description)}</p>` : ''}`,
  });
}

export function expiryText(c: TaskEmailContext): string {
  return toText([
    `The assigned time for ${c.ref} has finished`,
    'This task reached its due date and time and has not been completed. It is now marked Overdue.',
    '',
    `Task:        ${c.title}`,
    `Reference:   ${c.ref}`,
    `Priority:    ${label(c.priority)}`,
    `Status:      ${label(c.status)}`,
    `Due:         ${fmtDateTime(c.dueAt)}`,
    `Assigned by: ${c.assignedByName}`,
    c.description ? `\n${c.description}` : null,
    '',
    `Open the overdue task: ${c.taskUrl}`,
  ]);
}
