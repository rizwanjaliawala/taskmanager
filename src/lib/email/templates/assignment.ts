import { PRODUCT_NAME, detailRows, esc, fmtDateTime, label, layout, toText } from '../render.js';
import type { TaskEmailContext } from '../index.js';

export function assignmentSubject(c: TaskEmailContext): string {
  return `[${PRODUCT_NAME}] New task assigned: ${c.ref} — ${c.title}`;
}

export function assignmentHtml(c: TaskEmailContext): string {
  return layout({
    heading: `You have been assigned ${c.ref}`,
    intro: `${c.assignedByName} assigned this task to ${c.assignedToName}.`,
    priority: c.priority,
    ctaUrl: c.taskUrl,
    ctaLabel: 'Open the task',
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

export function assignmentText(c: TaskEmailContext): string {
  return toText([
    `You have been assigned ${c.ref}`,
    `${c.assignedByName} assigned this task to ${c.assignedToName}.`,
    '',
    `Task:        ${c.title}`,
    `Reference:   ${c.ref}`,
    `Priority:    ${label(c.priority)}`,
    `Status:      ${label(c.status)}`,
    `Due:         ${fmtDateTime(c.dueAt)}`,
    `Assigned by: ${c.assignedByName}`,
    c.description ? `\n${c.description}` : null,
    '',
    `Open the task: ${c.taskUrl}`,
  ]);
}
