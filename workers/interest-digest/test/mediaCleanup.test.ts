import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deletePhotoPaths,
  listOrphanPhotoPaths,
  parseOrphanPhotoPaths,
  processOrphanPhotoCleanup,
} from '../src/mediaCleanup'

const config = { url: 'https://project.supabase.co', secretKey: `sb_secret_${'x'.repeat(24)}` }

afterEach(() => vi.unstubAllGlobals())

describe('orphan sighting-photo cleanup', () => {
  it('validates and deduplicates paths from the service-only RPC', () => {
    expect(parseOrphanPhotoPaths([
      { object_name: 'user/drafts/one/photo.jpg' },
      { object_name: 'user/drafts/one/photo.jpg' },
    ])).toEqual(['user/drafts/one/photo.jpg'])
    expect(() => parseOrphanPhotoPaths([{ object_name: '../secret' }])).toThrow(/unsafe path/)
  })

  it('passes the 91-day cutoff and bounded limit to the RPC', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ object_name: 'user/photo.jpg' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const scheduledTime = Date.parse('2026-07-16T12:00:00Z')

    await expect(listOrphanPhotoPaths(config, scheduledTime)).resolves.toEqual(['user/photo.jpg'])
    const request = fetchMock.mock.calls[0]
    expect(request[0]).toBe('https://project.supabase.co/rest/v1/rpc/list_orphan_sighting_photo_paths')
    expect(JSON.parse(request[1].body)).toEqual({
      p_older_than: '2026-04-16T12:00:00.000Z',
      p_limit: 100,
    })
  })

  it('deletes through the Storage API and never through SQL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deletePhotoPaths(config, ['user/photo.jpg'])).resolves.toBe(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://project.supabase.co/storage/v1/object/sighting-photos')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'DELETE',
      body: JSON.stringify({ prefixes: ['user/photo.jpg'] }),
    })
  })

  it('does not call Storage when no orphan objects are returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(processOrphanPhotoCleanup(config, Date.now())).resolves.toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
