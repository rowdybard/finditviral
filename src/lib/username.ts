export const USERNAME_PATTERN = /^[a-z]{3,24}$/
export const USERNAME_MAX = 24
export const USERNAME_MIN = 3

const BANNED_WORDS = [
  'admin', 'root', 'system', 'moderator', 'mod', 'support',
  'finditviral', 'official', 'staff', 'null', 'undefined',
  'fuck', 'shit', 'ass', 'dick', 'cunt', 'bitch', 'nigger',
  'faggot', 'retard', 'nazi',
]

export function validateUsername(username: string): string | null {
  const clean = normalizeUsername(username)
  if (clean.length < USERNAME_MIN) return 'Username must be at least 3 characters'
  if (clean.length > USERNAME_MAX) return 'Username must be 24 characters or fewer'
  if (!USERNAME_PATTERN.test(clean)) return 'Use letters only'
  for (const word of BANNED_WORDS) {
    if (clean.includes(word)) return 'This username is not allowed'
  }
  return null
}

export function normalizeUsername(username: string): string {
  return username.normalize('NFKC').trim().toLowerCase()
}
