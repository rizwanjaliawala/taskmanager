import { PRODUCT_NAME, detailRows, esc, fmtDateTime, label, layout, toText } from '../render.js';
import type { TaskEmailContext } from '../index.js';

export function reminderSubject(c: TaskEmailContext & { hoursPending: number }): string {
  return `[${PRODUCT_NAME}] Reminder: ${c.ref} is still pending`;
}

export function reminderHtml(c: TaskEmailContext & { hoursPending: number }): string {
  return layout({
    heading: `${c.ref} is still pending`,
    intro: `This task is still open and has been pending for ${Math.round(c.hoursPending)} hours. It is due ${fmtDateTime(c.dueAt)}.`,
    priority: c.priority,
    ctaUrl: c.taskUrl,
    ctaLabel: 'Update the task',
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

export function reminderText(c: TaskEmailContext & { hoursPending: number }): string {
  return toText([
    `${c.ref} is still pending`,
    `This task is still open and has been pending for ${Math.round(c.hoursPending)} hours. It is due ${fmtDateTime(c.dueAt)}.`,
    '',
    `Task:        ${c.title}`,
    `Reference:   ${c.ref}`,
    `Priority:    ${label(c.priority)}`,
    `Status:      ${label(c.status)}`,
    `Due:         ${fmtDateTime(c.dueAt)}`,
    `Assigned by: ${c.assignedByName}`,
    c.description ? `\n${c.description}` : null,
    '',
    `Update the task: ${c.taskUrl}`,
  ]);
}
