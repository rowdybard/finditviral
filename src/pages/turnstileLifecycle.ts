export type AuthMode = 'signin' | 'signup'

export type PendingAction = (token: string) => Promise<void>

export type AuthResult = { error: string | null; needsEmailConfirmation: boolean }

export type AuthCallbacks = {
  signUp: (email: string, password: string, token: string, returnTo: string) => Promise<AuthResult>
  signIn: (email: string, password: string, token: string) => Promise<{ error: string | null }>
  onSuccess: () => void
  onError: (error: string) => void
  onConfirmationPending: () => void
  onResetWidget: () => void
}

export type TurnstileState = {
  widgetId: string | null
  pendingAction: PendingAction | null
  submitting: boolean
  executeCalled: boolean
  resetCalled: boolean
  removeCalled: boolean
}

export function initState(): TurnstileState {
  return {
    widgetId: null,
    pendingAction: null,
    submitting: false,
    executeCalled: false,
    resetCalled: false,
    removeCalled: false,
  }
}

export function renderWidget(state: TurnstileState): TurnstileState {
  return { ...state, widgetId: 'widget-1' }
}

export function validateForm(isSignUp: boolean, password: string, confirmPassword: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (isSignUp && password !== confirmPassword) return 'Passwords do not match.'
  return null
}

export function createPendingAction(
  mode: AuthMode,
  email: string,
  password: string,
  returnTo: string,
  callbacks: AuthCallbacks,
): PendingAction {
  if (mode === 'signup') {
    return async (token: string) => {
      const result = await callbacks.signUp(email, password, token, returnTo)
      if (result.error) {
        callbacks.onError(result.error)
        callbacks.onResetWidget()
        return
      }
      if (result.needsEmailConfirmation) {
        callbacks.onConfirmationPending()
        return
      }
      callbacks.onSuccess()
    }
  }
  return async (token: string) => {
    const result = await callbacks.signIn(email, password, token)
    if (result.error) {
      callbacks.onError(result.error)
      callbacks.onResetWidget()
      return
    }
    callbacks.onSuccess()
  }
}

export function submitForm(
  state: TurnstileState,
  mode: AuthMode,
  email: string,
  password: string,
  confirmPassword: string,
  returnTo: string,
  callbacks: AuthCallbacks,
): { state: TurnstileState; error: string | null } {
  const error = validateForm(mode === 'signup', password, confirmPassword)
  if (error) return { state, error }
  if (state.submitting) return { state, error: null }

  const pendingAction = createPendingAction(mode, email, password, returnTo, callbacks)
  return {
    state: { ...state, submitting: true, pendingAction, executeCalled: true },
    error: null,
  }
}

export function onCallback(state: TurnstileState, token: string): { state: TurnstileState; action: PendingAction | null } {
  const action = state.pendingAction
  return { state: { ...state, pendingAction: null }, action }
}

export function switchMode(state: TurnstileState): TurnstileState {
  return {
    ...initState(),
    removeCalled: state.widgetId !== null,
  }
}

export function cleanup(state: TurnstileState): TurnstileState {
  return {
    ...initState(),
    removeCalled: state.widgetId !== null,
  }
}

export function resetWidget(state: TurnstileState): TurnstileState {
  return { ...state, resetCalled: true }
}
