import type { ModerationQueueItem } from './domain'

export type ModerationEmail = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function renderFlaggedModerationEmail(item: ModerationQueueItem): ModerationEmail {
  const categoryText = item.resultCategories.length > 0 ? item.resultCategories.join(', ') : 'Unspecified category'
  const identity = item.username ? `Member: @${item.username}` : 'Member: unavailable'
  const subject = `FindItViral moderation flag: ${item.contributionType}`
  const text = [
    'FindItViral automated moderation flag',
    `Type: ${item.contributionType}`,
    `Product: ${item.productName}`,
    identity,
    `Categories: ${categoryText}`,
    '',
    'Submitted text:',
    item.textContent || '(No text supplied)',
    '',
    'Review in the owner Admin contribution queue.',
  ].join('\n')
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,sans-serif;color:#1c1917">
  <main style="max-width:680px;margin:0 auto;padding:28px 18px">
    <section style="padding:24px;border:2px solid #991b1b;border-radius:18px;background:#fff7ed;box-shadow:0 6px 0 #7f1d1d">
      <div style="color:#991b1b;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">FindItViral moderation flag</div>
      <h1 style="margin:8px 0;font-size:24px">${escapeHtml(item.contributionType)}</h1>
      <p style="margin:0;color:#57534e">Product: <strong>${escapeHtml(item.productName)}</strong></p>
      <p style="margin:8px 0 0;color:#57534e">${escapeHtml(identity)}</p>
      <p style="margin:8px 0 0;color:#57534e">Categories: <strong>${escapeHtml(categoryText)}</strong></p>
    </section>
    <section style="margin-top:20px;padding:20px;border:1px solid #d6d3d1;border-radius:14px;background:#fff">
      <div style="margin-bottom:7px;color:#57534e;font-size:12px;font-weight:700;text-transform:uppercase">Submitted text</div>
      <div style="white-space:pre-wrap;font-size:15px;line-height:1.55">${escapeHtml(item.textContent || '(No text supplied)')}</div>
    </section>
  </main>
</body></html>`
  return { subject, text, html }
}
