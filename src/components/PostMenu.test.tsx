import { describe, expect, it } from 'vitest'

const postMenuOptions = [
  { label: 'Report a sighting', path: '/sightings/new' },
  { label: 'Share a restock lead', path: '/leads/new' },
  { label: 'Post a bounty', path: '/bounties/new' },
]

describe('PostMenu options', () => {
  it('provides three post options with correct paths', () => {
    expect(postMenuOptions).toHaveLength(3)
    expect(postMenuOptions.map(o => o.path)).toEqual(['/sightings/new', '/leads/new', '/bounties/new'])
  })

  it('includes a restock lead option', () => {
    expect(postMenuOptions.some(o => o.label.includes('restock lead'))).toBe(true)
  })

  it('includes a sighting option', () => {
    expect(postMenuOptions.some(o => o.label.includes('sighting'))).toBe(true)
  })

  it('includes a bounty option', () => {
    expect(postMenuOptions.some(o => o.label.includes('bounty'))).toBe(true)
  })
})
