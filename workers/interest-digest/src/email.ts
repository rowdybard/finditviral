import {
  DigestContractError,
  MAX_RENDERED_BODY_BYTES,
  type DigestClaim,
  type DigestEmailContent,
  type DigestItem,
} from './domain'
import { DIGEST_TIME_ZONE } from './schedule'

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const occurredAtFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
})

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return `${monthNames[month - 1]} ${day}, ${year}`
}

function sourceLabel(source: DigestItem['source']): string {
  return source === 'early_access' ? 'Early-access request' : 'New-member interest'
}

function renderTextItem(item: DigestItem, index: number): string {
  const identity = [
    item.email ? `Email: ${item.email}` : null,
    item.username ? `Username: ${item.username}` : null,
  ].filter((value): value is string => value !== null)

  return [
    `${index + 1}. ${sourceLabel(item.source)}`,
    `Submitted: ${occurredAtFormatter.format(new Date(item.occurredAt))} ET`,
    ...identity,
    'Interest:',
    item.interest,
  ].join('\n')
}

function renderHtmlItem(item: DigestItem, index: number): string {
  const identity = [
    item.email ? `<div><strong>Email:</strong> ${escapeHtml(item.email)}</div>` : '',
    item.username ? `<div><strong>Username:</strong> ${escapeHtml(item.username)}</div>` : '',
  ].join('')

  return `
    <section style="margin:0 0 18px;padding:18px;border:1px solid #d6d3d1;border-radius:14px;background:#ffffff;box-shadow:0 3px 0 #e7e5e4">
      <div style="margin-bottom:8px;color:#57534e;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${index + 1}. ${escapeHtml(sourceLabel(item.source))}</div>
      <div style="margin-bottom:10px;color:#78716c;font-size:13px">${escapeHtml(occurredAtFormatter.format(new Date(item.occurredAt)))} ET</div>
      <div style="margin-bottom:12px;color:#292524;font-size:14px;line-height:1.5">${identity}</div>
      <div style="margin-bottom:5px;color:#57534e;font-size:12px;font-weight:700;text-transform:uppercase">Interest</div>
      <div style="white-space:pre-wrap;color:#1c1917;font-size:15px;line-height:1.55">${escapeHtml(item.interest)}</div>
    </section>`
}

export function renderDigestEmail(claim: DigestClaim): DigestEmailContent {
  const dateLabel = formatLocalDate(claim.runLocalDate)
  const countLabel = `${claim.items.length} ${claim.items.length === 1 ? 'submission' : 'submissions'}`
  const subject = `FindItViral interest digest - ${dateLabel}`
  const text = [
    'FindItViral interest digest',
    `${countLabel} through 8:00 AM America/Detroit on ${dateLabel}.`,
    '',
    claim.items.map(renderTextItem).join('\n\n---\n\n'),
    '',
    `Digest run: ${claim.runId}`,
  ].join('\n')
  const htmlItems = claim.items.map(renderHtmlItem).join('')
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;color:#1c1917">
    <main style="max-width:680px;margin:0 auto;padding:28px 18px">
      <header style="margin-bottom:20px;padding:24px;border:2px solid #292524;border-radius:18px;background:#fff7ed;box-shadow:0 6px 0 #292524">
        <div style="margin-bottom:7px;color:#ea580c;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">FindItViral | Greater Lansing</div>
        <h1 style="margin:0 0 8px;font-size:26px;line-height:1.15">Interest digest</h1>
        <p style="margin:0;color:#57534e;font-size:15px;line-height:1.5">${escapeHtml(countLabel)} through 8:00 AM America/Detroit on ${escapeHtml(dateLabel)}.</p>
      </header>
      ${htmlItems}
      <footer style="padding:8px 4px;color:#78716c;font-size:11px">Digest run ${escapeHtml(claim.runId)}</footer>
    </main>
  </body>
</html>`

  const renderedBytes = new TextEncoder().encode(`${text}\n${html}`).byteLength
  if (renderedBytes > MAX_RENDERED_BODY_BYTES) {
    throw new DigestContractError('rendered digest exceeds the safe email body limit')
  }

  return { subject, text, html }
}
