import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import FormDraftStatus from './FormDraftStatus'

describe('FormDraftStatus', () => {
  it('announces restored drafts and offers explicit discard', () => {
    const html = renderToStaticMarkup(<FormDraftStatus status="restored" hasDraft onDiscard={() => undefined} />)
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Draft restored on this device.')
    expect(html).toContain('Discard device draft')
  })

  it('offers both choices for a cross-tab conflict', () => {
    const html = renderToStaticMarkup(
      <FormDraftStatus status="saved" hasConflict onRestoreConflict={() => undefined} onKeepCurrent={() => undefined} />,
    )
    expect(html).toContain('Restore that version')
    expect(html).toContain('Keep this version')
  })
})
