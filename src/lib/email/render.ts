import { env } from '../env.js';

export const PRODUCT_NAME = 'Utopia Trucking Task Manager';
export const CREDIT_LINE = 'Created by Rizwan Hanif for Utopia Brands Trucking Team';

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmtDateTime(d: Date | null): string {
  if (!d) return 'No due date';
  return d.toLocaleString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  });
}

const LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
  assigned: 'Pending', progress: 'In Progress', hold: 'On Hold',
  completed: 'Completed', overdue: 'Overdue', cancelled: 'Cancelled',
};
export const label = (k: string): string => LABELS[k] ?? k;

/*
 * The eight organizational roles, spelled exactly as the business named them.
 * "DM", "Sr. AM" and "Sr Executive" are the org's own abbreviations — do not expand
 * them into guesses like "District Manager"; nobody here knows what the D stands for,
 * and an email that renames someone's job title is worse than one that abbreviates it.
 * Note "Sr Executive" carries no period, unlike "Sr. Manager" and "Sr. AM".
 */
const ROLE_LABELS: Record<string, string> = {
  director: 'Director',
  sr_manager: 'Sr. Manager',
  manager: 'Manager',
  dm: 'DM',
  sr_am: 'Sr. AM',
  am: 'AM',
  sr_executive: 'Sr Executive',
  executive: 'Executive',
};
export const roleLabel = (r: string): string => ROLE_LABELS[r] ?? r;

const ACCENT: Record<string, string> = {
  low: '#64748b', medium: '#3b82f6', high: '#f59e0b', critical: '#ef4444',
};

export function detailRows(rows: [string, string][]): string {
  return rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 0;color:#64748b;font-size:13px;width:130px">${esc(k)}</td>
      <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600">${v}</td>
    </tr>`).join('');
}

/** Table-based layout with inline styles — the only thing mail clients render reliably. */
export function layout(opts: {
  heading: string; intro: string; priority?: string; body: string;
  ctaUrl: string; ctaLabel: string;
}): string {
  const accent = ACCENT[opts.priority ?? 'medium'] ?? '#3b82f6';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="height:4px;background:${accent}"></td></tr>
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700">
            ${esc(PRODUCT_NAME)}
          </div>
          <h1 style="margin:12px 0 8px;font-size:21px;line-height:1.3;color:#0f172a">${esc(opts.heading)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569">${esc(opts.intro)}</p>
        </td></tr>
        <tr><td style="padding:0 32px">${opts.body}</td></tr>
        <tr><td style="padding:24px 32px 32px">
          <a href="${esc(opts.ctaUrl)}"
             style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;
                    padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">
            ${esc(opts.ctaLabel)}
          </a>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
            ${esc(PRODUCT_NAME)} &middot; <a href="${esc(env.APP_URL)}" style="color:#64748b">${esc(env.APP_URL)}</a><br/>
            ${esc(CREDIT_LINE)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function toText(lines: (string | null)[]): string {
  return [...lines.filter(Boolean), '', PRODUCT_NAME, CREDIT_LINE].join('\n');
}
