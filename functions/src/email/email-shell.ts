import type { SendEmailInput } from './types.js';

export type ContributorJourneyState = 'invited' | 'turn' | 'missed' | 'complete';

export interface EmailCopy {
  text: string;
  html: string;
}

interface EmailAction {
  label: string;
  url: string;
}

interface ContributorEmailShellInput {
  to: string;
  subject: string;
  preheader: string;
  appOrigin: string;
  idempotencyKey: string;
  journeyState: ContributorJourneyState;
  eyebrow: string;
  headline: string;
  displayName: string;
  paragraphs: EmailCopy[];
  detail?: EmailCopy[];
  primaryAction: EmailAction;
  secondary?: {
    heading: string;
    paragraphs: EmailCopy[];
    action?: EmailAction;
  };
  closing?: EmailCopy[];
}

interface AdminEmailShellInput {
  to: string;
  subject: string;
  preheader: string;
  appOrigin: string;
  idempotencyKey: string;
  headline: string;
  paragraphs: EmailCopy[];
  actions: EmailAction[];
  plainText: string;
}

const JOURNEY = {
  invited: {
    path: '/email/journey/journey-invited@2x.jpg',
    alt: 'pirate beginning the journey with a treasure map and ship waiting',
  },
  turn: {
    path: '/email/journey/journey-turn@2x.jpg',
    alt: 'pirate sailing through a dangerous voyage',
  },
  missed: {
    path: '/email/journey/journey-missed@2x.jpg',
    alt: 'pirate stranded after a shipwreck',
  },
  complete: {
    path: '/email/journey/journey-complete@2x.jpg',
    alt: 'pirate reaching the end of the journey for one tiny treasure',
  },
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";
const INK = '#171717';
const PAPER = '#f5f1e8';
const WHITE = '#ffffff';
const MUTED = '#6d6a63';
const BORDER = '#c9c3b8';
const ACCENT = '#ff4938';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character);
}

export function copy(value: string): EmailCopy {
  return { text: value, html: escapeHtml(value) };
}

function safeAbsoluteUrl(appOrigin: string, path: string): string {
  const origin = new URL(appOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin without credentials.');
  }
  return new URL(path, origin).toString();
}

export function contributorJourneyImage(
  appOrigin: string,
  state: ContributorJourneyState,
): { url: string; alt: string; path: string } {
  const journey = JOURNEY[state];
  return { url: safeAbsoluteUrl(appOrigin, journey.path), alt: journey.alt, path: journey.path };
}

function renderParagraphs(paragraphs: EmailCopy[]): string {
  return paragraphs.map(({ html }) => (
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK}">${html}</p>`
  )).join('');
}

function renderButton(action: EmailAction, secondary = false): string {
  const background = secondary ? WHITE : INK;
  const color = secondary ? INK : WHITE;
  const border = `1px solid ${INK}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr><td bgcolor="${background}" style="border:${border}"><a href="${escapeHtml(action.url)}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 20px;font-family:${FONT};font-size:15px;font-weight:700;color:${color};text-decoration:none">${escapeHtml(action.label)}</a></td></tr></table>`;
}

function renderJourney(input: ContributorEmailShellInput): string {
  const image = contributorJourneyImage(input.appOrigin, input.journeyState);
  return `<img src="${escapeHtml(image.url)}" width="600" height="200" alt="${escapeHtml(image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:${INK};font-family:${FONT};font-size:14px;line-height:1.4">`;
}

function renderOuter(content: string, preheader: string, appOrigin: string): string {
  const homepage = safeAbsoluteUrl(appOrigin, '/');
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:${PAPER};color:${INK}">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="width:100%;background:${PAPER}">
      <tr><td align="center" style="padding:24px 12px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" style="width:100%;max-width:600px;background:${WHITE};border:1px solid ${BORDER}">
          <tr><td style="padding:28px 28px 20px">
            <p style="margin:0;font-family:${FONT};font-size:22px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${INK}">who touched this</p>
            <p style="margin:5px 0 0;font-family:${FONT};font-size:13px;line-height:1.4;color:${MUTED}">one website. one contributor at a time.</p>
          </td></tr>
          ${content}
          <tr><td style="padding:20px 28px 28px;border-top:1px solid ${BORDER}">
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED}">who touched this · <a href="${escapeHtml(homepage)}" style="color:${INK}">whotouchedthis.website</a><br>need help? <a href="mailto:hello@whotouchedthis.website" style="color:${INK}">hello@whotouchedthis.website</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderContributorEmail(input: ContributorEmailShellInput): SendEmailInput {
  const name = input.displayName.trim();
  if (!name || name.length > 50) throw new Error('Contributor display name is invalid.');
  const detail = input.detail?.length
    ? `<div style="margin:4px 0 20px;padding:16px 16px 1px;background:${PAPER};border-left:4px solid ${ACCENT}">${renderParagraphs(input.detail)}</div>`
    : '';
  const secondary = input.secondary
    ? `<div style="margin-top:28px;padding:20px;background:${PAPER};border:1px solid ${BORDER}"><p style="margin:0 0 12px;font-family:${FONT};font-size:19px;line-height:1.3;font-weight:800;color:${INK}">${escapeHtml(input.secondary.heading)}</p>${renderParagraphs(input.secondary.paragraphs)}${input.secondary.action ? renderButton(input.secondary.action, true) : ''}</div>`
    : '';
  const closing = input.closing?.length
    ? `<div style="margin-top:20px">${renderParagraphs(input.closing)}</div>`
    : '';
  const html = renderOuter(`
          <tr><td style="padding:0">${renderJourney(input)}</td></tr>
          <tr><td style="padding:28px">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.3;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${ACCENT}">${escapeHtml(input.eyebrow)}</p>
            <h1 style="margin:0 0 24px;font-family:${FONT};font-size:30px;line-height:1.12;letter-spacing:-.02em;color:${INK}">${escapeHtml(input.headline)}</h1>
            <p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK}">hello ${escapeHtml(name)},</p>
            ${renderParagraphs(input.paragraphs)}${detail}${renderButton(input.primaryAction)}${secondary}${closing}
          </td></tr>`, input.preheader, input.appOrigin);

  const textSections = [
    input.eyebrow,
    input.headline,
    '',
    `hello ${name},`,
    '',
    ...input.paragraphs.flatMap(({ text }) => [text, '']),
    ...(input.detail ?? []).flatMap(({ text }) => [text, '']),
    `${input.primaryAction.label}: ${input.primaryAction.url}`,
  ];
  if (input.secondary) {
    textSections.push('', input.secondary.heading, '');
    for (const paragraph of input.secondary.paragraphs) textSections.push(paragraph.text, '');
    if (input.secondary.action) {
      textSections.push(`${input.secondary.action.label}: ${input.secondary.action.url}`);
    }
  }
  if (input.closing?.length) {
    textSections.push('');
    for (const paragraph of input.closing) textSections.push(paragraph.text, '');
  }
  textSections.push('', 'need help?', 'hello@whotouchedthis.website');

  return {
    to: input.to,
    subject: input.subject,
    html,
    text: textSections.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    idempotencyKey: input.idempotencyKey,
  };
}

export function renderAdminEmail(input: AdminEmailShellInput): SendEmailInput {
  const actions = input.actions.map((action, index) => renderButton(action, index > 0)).join('');
  const html = renderOuter(`
          <tr><td style="padding:28px">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.3;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${ACCENT}">admin notice</p>
            <h1 style="margin:0 0 24px;font-family:${FONT};font-size:26px;line-height:1.15;color:${INK}">${escapeHtml(input.headline)}</h1>
            ${renderParagraphs(input.paragraphs)}${actions}
          </td></tr>`, input.preheader, input.appOrigin);
  return {
    to: input.to,
    subject: input.subject,
    html,
    text: input.plainText,
    idempotencyKey: input.idempotencyKey,
  };
}
