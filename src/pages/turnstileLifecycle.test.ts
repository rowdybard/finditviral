import { describe, expect, it, vi } from 'vitest'
import {
  initState,
  renderWidget,
  submitForm,
  onCallback,
  switchMode,
  type AuthCallbacks,
} from './turnstileLifecycle'

function makeCallbacks(overrides: Partial<AuthCallbacks> = {}): AuthCallbacks {
  return {
    signUp: vi.fn().mockResolvedValue({ error: null, needsEmailConfirmation: false }),
    signIn: vi.fn().mockResolvedValue({ error: null }),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onConfirmationPending: vi.fn(),
    onResetWidget: vi.fn(),
    ...overrides,
  }
}

describe('Turnstile lifecycle', () => {
  it('loading the page does not call signIn or signUp', () => {
    const state = initState()
    const callbacks = makeCallbacks()
    expect(state.executeCalled).toBe(false)
    expect(state.pendingAction).toBeNull()
    expect(callbacks.signUp).not.toHaveBeenCalled()
    expect(callbacks.signIn).not.toHaveBeenCalled()
  })

  it('clicking Create account executes Turnstile before signUp', () => {
    const state = renderWidget(initState())
    const callbacks = makeCallbacks()
    const result = submitForm(state, 'signup', 'a@b.com', 'password123', 'password123', '/home', callbacks)
    expect(result.state.executeCalled).toBe(true)
    expect(result.state.pendingAction).not.toBeNull()
    expect(callbacks.signUp).not.toHaveBeenCalled()
  })

  it('signUp receives the callback token exactly once', async () => {
    const state = renderWidget(initState())
    const callbacks = makeCallbacks()
    const { state: afterSubmit } = submitForm(state, 'signup', 'a@b.com', 'password123', 'password123', '/home', callbacks)
    const { action } = onCallback(afterSubmit)
    expect(action).not.toBeNull()
    await action!('test-token-123')
    expect(callbacks.signUp).toHaveBeenCalledTimes(1)
    expect(callbacks.signUp).toHaveBeenCalledWith('a@b.com', 'password123', 'test-token-123', '/home')
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(1)
  })

  it('switching sign-in/signup invalidates the previous token', () => {
    const state = renderWidget(initState())
    const callbacks = makeCallbacks()
    const { state: afterSubmit } = submitForm(state, 'signup', 'a@b.com', 'password123', 'password123', '/home', callbacks)
    expect(afterSubmit.pendingAction).not.toBeNull()
    const switched = switchMode(afterSubmit)
    expect(switched.pendingAction).toBeNull()
    expect(switched.widgetId).toBeNull()
    expect(switched.removeCalled).toBe(true)
    expect(switched.submitting).toBe(false)
  })

  it('failed signup resets the widget', async () => {
    const state = renderWidget(initState())
    const callbacks = makeCallbacks({
      signUp: vi.fn().mockResolvedValue({ error: 'captcha_failed', needsEmailConfirmation: false }),
    })
    const { state: afterSubmit } = submitForm(state, 'signup', 'a@b.com', 'password123', 'password123', '/home', callbacks)
    const { action } = onCallback(afterSubmit)
    await action!('test-token-456')
    expect(callbacks.onError).toHaveBeenCalledWith('captcha_failed')
    expect(callbacks.onResetWidget).toHaveBeenCalledTimes(1)
    expect(callbacks.onSuccess).not.toHaveBeenCalled()
  })
})
