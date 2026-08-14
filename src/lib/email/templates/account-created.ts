import { env } from '../../env.js';
import { PRODUCT_NAME, detailRows, esc, layout, toText } from '../render.js';
import type { PublicUser } from '../../serialize.js';

const ROLE_LABELS: Record<string, string> = {
  director: 'Director',
  sr_manager: 'Senior Manager',
  manager: 'Manager',
  dm: 'District Manager',
  sr_am: 'Senior Account Manager',
  am: 'Account Manager',
  sr_executive: 'Senior Executive',
  executive: 'Executive',
};
export const roleLabel = (r: string): string => ROLE_LABELS[r] ?? r;

type AccountCreatedInput = { user: PublicUser; tempPassword: string; createdBy: string };

export function accountCreatedSubject(): string {
  return `[${PRODUCT_NAME}] Your account is ready`;
}

export function accountCreatedHtml({ user, tempPassword, createdBy }: AccountCreatedInput): string {
  return layout({
    heading: `Welcome to ${PRODUCT_NAME}`,
    intro: `${createdBy} created an account for you. Sign in with the temporary password below — you will be asked to change it immediately.`,
    ctaUrl: env.APP_URL,
    ctaLabel: 'Sign in',
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${detailRows([
          ['Email', esc(user.email)],
          ['Temporary password', `<code>${esc(tempPassword)}</code>`],
          ['Role', esc(roleLabel(user.role))],
        ])}
      </table>`,
  });
}

export function accountCreatedText({ user, tempPassword, createdBy }: AccountCreatedInput): string {
  return toText([
    `Welcome to ${PRODUCT_NAME}`,
    `${createdBy} created an account for you. Sign in with the temporary password below — you will be asked to change it immediately.`,
    '',
    `Email:               ${user.email}`,
    `Temporary password:  ${tempPassword}`,
    `Role:                ${roleLabel(user.role)}`,
    '',
    `Sign in: ${env.APP_URL}`,
  ]);
}
