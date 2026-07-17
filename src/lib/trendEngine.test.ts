import { describe, expect, it } from 'vitest'
import { researchRunErrorMessage } from './trendEngine'

describe('researchRunErrorMessage', () => {
  it('provides safe remediation for OpenAI authentication errors', () => {
    expect(researchRunErrorMessage('OPENAI_RESEARCH_AUTH_FAILED')).toBe('OpenAI authentication failed. Update the Worker API key.')
  })

  it('keeps unknown run errors visible to administrators', () => {
    expect(researchRunErrorMessage('OPENAI_RESEARCH_UPSTREAM_ERROR')).toBe('Research failed: OPENAI_RESEARCH_UPSTREAM_ERROR')
  })
})
