import type { PostgrestError } from '@supabase/supabase-js'

export type MappedError = {
  message: string
  code: string | null
  step?: number
}

const HINT_TO_MESSAGE: Record<string, string> = {
  ONBOARDING_AUTH_REQUIRED: 'You must be signed in to complete onboarding.',
  ONBOARDING_ALREADY_COMPLETED: 'Onboarding has already been completed.',
  ONBOARDING_PROFILE_NOT_FOUND: 'Profile not found. Please try signing in again.',
  USERNAME_INVALID: 'Username must be 3–20 letters only.',
  USERNAME_UNAVAILABLE: 'That username is taken. Try another one.',
  ZIP_INVALID: 'Enter a supported Greater Lansing ZIP code.',
  LOOKING_FOR_TOO_LONG: 'Please keep your interests under 500 characters.',
  CITY_INVALID: 'Please select at least one valid Greater Lansing city.',
  REFERRALS_UNAVAILABLE: 'Referrals are unavailable during beta.',
  DRAFT_UNSUPPORTED_FIELD: 'This form contains unsupported fields. Please refresh and try again.',
  DRAFT_UNSUPPORTED_VERSION: 'This form version is unsupported. Please refresh and try again.',
  INVALID_SCOPE: 'Please choose a valid scope.',
  INVALID_LOCATION: 'Please choose a valid Greater Lansing ZIP code and radius.',
  INVALID_BOUNTY_DETAILS: 'Some bounty details are invalid. Please check your submission.',
  INVALID_STORE: 'Invalid store details. Please check your submission.',
  INVALID_PRODUCT: 'Invalid product details. Please check your submission.',
  INVALID_SUGGESTION: 'Invalid suggestion details. Please check your submission.',
  PRODUCT_UNAVAILABLE: 'That product is no longer available.',
  STORE_UNAVAILABLE: 'That store is no longer available.',
  STORE_OUT_OF_SCOPE: 'This store is not in the bounty scope.',
  BOUNTY_CLOSED: 'This bounty is no longer accepting claims.',
  BOUNTY_UNAVAILABLE: 'This bounty is unavailable.',
  UNAUTHORIZED: 'You do not have permission to do that.',
  INVALID_CLAIM: 'Invalid claim details. Please check your submission.',
}

const MESSAGE_TO_FALLBACK: Record<string, { message: string; step?: number }> = {
  'Permanent authenticated account required': { message: 'You must be signed in to complete onboarding.' },
  'Onboarding has already been completed': { message: 'Onboarding has already been completed.' },
  'Username must be 3-20 letters only': { message: 'Username must be 3–20 letters only.', step: 0 },
  'Username must be 3-24 letters only': { message: 'Username must be 3–20 letters only.', step: 0 },
  username_unavailable: { message: 'That username is taken. Try another one.', step: 0 },
  'ZIP code must be in the Greater Lansing beta area': { message: 'Enter a supported Greater Lansing ZIP code.', step: 1 },
  'Looking for must be 500 characters or fewer': { message: 'Please keep your interests under 500 characters.', step: 2 },
  'Please select at least one valid Greater Lansing city': { message: 'Please select at least one valid Greater Lansing city.', step: 1 },
  'Referrals are unavailable during beta': { message: 'Referrals are unavailable during beta.' },
}

const CONTRIBUTION_ERROR_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /product.*unavailable/i, message: 'That product is no longer available.' },
  { pattern: /store.*unavailable/i, message: 'That store is no longer available.' },
  { pattern: /invalid.*availability/i, message: 'Please choose a valid availability option.' },
  { pattern: /quantity.*between/i, message: 'Quantity must be between 1 and 999.' },
  { pattern: /future/i, message: 'The sighting time cannot be in the future.' },
  { pattern: /notes.*too long/i, message: 'Notes are too long. Please shorten them.' },
  { pattern: /ZIP radius/i, message: 'Please choose a valid Greater Lansing ZIP code and radius.' },
  { pattern: /valid store/i, message: 'Please choose a valid store.' },
  { pattern: /valid stores/i, message: 'Please choose valid stores.' },
  { pattern: /valid retailer/i, message: 'Please choose valid retailers.' },
  { pattern: /at least one store/i, message: 'Please choose at least one store.' },
  { pattern: /at least one retailer/i, message: 'Please choose at least one retailer.' },
  { pattern: /invalid scope/i, message: 'Please choose a valid scope.' },
  { pattern: /invalid bounty details/i, message: 'Some bounty details are invalid. Please check your submission.' },
  { pattern: /draft.*needs.*review/i, message: 'This draft still needs admin review. Please wait for approval.' },
  { pattern: /rate limit/i, message: 'You are submitting too quickly. Please wait and try again.' },
  { pattern: /owner only|app_owner/i, message: 'Only the app owner can perform this action.' },
  { pattern: /cannot claim your own/i, message: 'You cannot claim your own bounty.' },
  { pattern: /not open/i, message: 'This bounty is no longer accepting claims.' },
]

const ERROR_CODE_MESSAGES: Record<string, string> = {
  '42901': 'You are doing that too fast. Please wait a moment and try again.',
  '22023': 'Some details are invalid. Please check your submission and try again.',
  '42501': 'You do not have permission to do that.',
}

export function mapContributionError(error: PostgrestError | null): string {
  if (!error) return 'Something went wrong. Please try again.'

  const hint = error.hint ?? ''
  if (hint && hint in HINT_TO_MESSAGE) return HINT_TO_MESSAGE[hint]

  const code = error.code ?? ''
  if (ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code]

  const message = error.message ?? ''
  for (const { pattern, message: mapped } of CONTRIBUTION_ERROR_PATTERNS) {
    if (pattern.test(message)) return mapped
  }

  console.error('[errorMap] Unmapped contribution error:', { code, message: error.message, details: error.details })
  return 'Something went wrong. Please try again.'
}

export function errorMap(error: PostgrestError): MappedError {
  const hint = error.hint ?? null
  const message = error.message ?? ''

  if (hint && hint in HINT_TO_MESSAGE) {
    const mapped = HINT_TO_MESSAGE[hint]
    const fallback = MESSAGE_TO_FALLBACK[message] ?? MESSAGE_TO_FALLBACK[hint]
    return {
      message: mapped,
      code: hint,
      step: fallback?.step,
    }
  }

  if (message in MESSAGE_TO_FALLBACK) {
    const fallback = MESSAGE_TO_FALLBACK[message]
    return {
      message: fallback.message,
      code: hint,
      step: fallback.step,
    }
  }

  return {
    message: 'Something went wrong. Please try again.',
    code: hint,
  }
}

const AUTH_ERROR_MAP: Record<string, string> = {
  'already registered': 'An account may already exist for that email. Try signing in.',
  'Invalid login credentials': 'Incorrect email or password. Please try again.',
  'Email not confirmed': 'Please confirm your email before signing in.',
  'User already registered': 'An account may already exist for that email. Try signing in.',
  'Password should be at least': 'Password must be at least 8 characters.',
  'captcha': 'CAPTCHA verification failed. Please try again.',
  'rate limit': 'Too many attempts. Please wait a moment and try again.',
  'overloaded': 'The service is busy. Please try again in a moment.',
}

export function mapAuthError(error: string, isSignUp: boolean): string {
  const lower = error.toLowerCase()
  for (const [key, message] of Object.entries(AUTH_ERROR_MAP)) {
    if (lower.includes(key.toLowerCase())) return message
  }
  if (isSignUp && lower.includes('already')) {
    return 'An account may already exist for that email. Try signing in.'
  }
  return 'Something went wrong. Please try again.'
}
