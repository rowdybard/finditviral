import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_TURNSTILE_CONFIG,
  TurnstileActionLifecycle,
  TurnstileRequestCancelledError,
  TurnstileTokenRequestController,
} from './turnstileLifecycle'

describe('Turnstile auth lifecycle', () => {
  it('configures Auth to generate a token only when execute is called', () => {
    expect(AUTH_TURNSTILE_CONFIG).toMatchObject({
      execution: 'execute',
      appearance: 'always',
      action: 'turnstile-spin-v1',
    })
  })

  it('does nothing on construction and executes only after a token request', () => {
    const execute = vi.fn()
    const controller = new TurnstileTokenRequestController()

    expect(execute).not.toHaveBeenCalled()
    void controller.request(execute)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('delivers the first callback token to auth exactly once', async () => {
    const execute = vi.fn()
    const auth = vi.fn()
    const controller = new TurnstileTokenRequestController()
    const authRequest = controller.request(execute).then(auth)

    expect(controller.resolve('fresh-token')).toBe(true)
    expect(controller.resolve('duplicate-token')).toBe(false)
    await authRequest

    expect(auth).toHaveBeenCalledTimes(1)
    expect(auth).toHaveBeenCalledWith('fresh-token')
  })

  it('rejects a second submit while verification is pending', async () => {
    const execute = vi.fn()
    const controller = new TurnstileTokenRequestController()
    const firstRequest = controller.request(execute)
    const secondRequest = controller.request(execute)

    await expect(secondRequest).rejects.toThrow('already in progress')
    expect(execute).toHaveBeenCalledTimes(1)

    const cancelled = expect(firstRequest).rejects.toBeInstanceOf(TurnstileRequestCancelledError)
    controller.cancel()
    await cancelled
  })

  it('cancels a stale callback when the widget is removed or the mode changes', async () => {
    const controller = new TurnstileTokenRequestController()
    const request = controller.request(() => undefined)
    const cancelled = expect(request).rejects.toBeInstanceOf(TurnstileRequestCancelledError)

    expect(controller.cancel()).toBe(true)
    expect(controller.resolve('stale-token')).toBe(false)
    await cancelled
  })

  it('invalidates an auth result after the widget lifecycle changes', () => {
    const lifecycle = new TurnstileActionLifecycle()
    const signInGeneration = lifecycle.activate()

    expect(lifecycle.isCurrent(signInGeneration)).toBe(true)
    expect(lifecycle.invalidate(signInGeneration)).toBe(true)
    expect(lifecycle.isCurrent(signInGeneration)).toBe(false)

    const signUpGeneration = lifecycle.activate()
    expect(lifecycle.isCurrent(signUpGeneration)).toBe(true)
    expect(lifecycle.invalidate(signInGeneration)).toBe(false)
  })

  it('clears pending state when Turnstile execute throws so a retry can start', async () => {
    const controller = new TurnstileTokenRequestController()

    await expect(controller.request(() => { throw new Error('execute failed') })).rejects.toThrow('execute failed')
    expect(controller.hasPendingRequest).toBe(false)

    const retry = controller.request(() => undefined)
    controller.resolve('retry-token')
    await expect(retry).resolves.toBe('retry-token')
  })
})
