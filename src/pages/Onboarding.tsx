import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { validateUsername, normalizeUsername } from '../lib/username'
import { getStoredReferrer, buildReferralLink } from '../lib/referral'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'

const STEPS = ['Username', 'Location', 'Interests', 'Referral'] as const

export default function Onboarding() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [zipCode, setZipCode] = useState('')
  const [lookingFor, setLookingFor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const referrer = getStoredReferrer()

  const checkUsername = useCallback(async (value: string) => {
    const clean = normalizeUsername(value)
    if (!clean) {
      setUsernameStatus('idle')
      return
    }
    const validationError = validateUsername(clean)
    if (validationError) {
      setUsernameStatus('invalid')
      return
    }
    setUsernameStatus('checking')
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', clean)
        .maybeSingle()
      if (data && data.id !== user?.id) {
        setUsernameStatus('taken')
      } else {
        setUsernameStatus('available')
      }
    } catch {
      setUsernameStatus('idle')
    }
  }, [user?.id])

  useEffect(() => {
    const timer = setTimeout(() => checkUsername(username), 400)
    return () => clearTimeout(timer)
  }, [username, checkUsername])

  async function handleFinish() {
    if (!user) return
    setSubmitting(true)
    setError(null)

    const cleanUsername = normalizeUsername(username)
    const validationError = validateUsername(cleanUsername)
    if (validationError) {
      setError(validationError)
      setSubmitting(false)
      setStep(0)
      return
    }

    try {
      const { error: rpcError } = await supabase.rpc('complete_onboarding', {
        p_username: cleanUsername,
        p_zip_code: zipCode.trim() || null,
        p_looking_for: lookingFor.trim() || null,
        p_referrer_username: referrer || null,
      })

      if (rpcError) {
        const msg = rpcError.message
        if (msg.includes('taken') || msg.includes('23505')) {
          setError('That username is taken. Try another one.')
          setStep(0)
        } else if (msg.includes('Username must be')) {
          setError(msg)
          setStep(0)
        } else {
          setError('Something went wrong. Please try again.')
        }
        setSubmitting(false)
        return
      }

      await refreshProfile()
      navigate('/home', { replace: true })
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  function handleNext(e: FormEvent) {
    e.preventDefault()
    if (step === 0) {
      const cleanUsername = normalizeUsername(username)
      const validationError = validateUsername(cleanUsername)
      if (validationError) {
        setError(validationError)
        return
      }
      if (usernameStatus === 'taken') {
        setError('That username is taken. Try another one.')
        return
      }
      if (usernameStatus !== 'available') {
        setError('Please wait for username validation.')
        return
      }
    }
    setError(null)
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      handleFinish()
    }
  }

  function handleSkip() {
    setError(null)
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      handleFinish()
    }
  }

  const referralLink = profile?.username
    ? buildReferralLink(profile.username)
    : buildReferralLink(normalizeUsername(username) || 'your-username')

  function copyReferralLink() {
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!user) {
    navigate('/auth', { replace: true })
    return null
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <div aria-hidden="true" className="h-1.5 w-full bg-brand-500" />

      <header className="mx-auto flex w-full max-w-md items-center justify-center px-5 py-6">
        <span className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-stone-900">
          <span className={`grid h-9 w-9 place-items-center rounded-lg border-2 border-stone-900 bg-white ${TOY_SHADOW_SM}`}>
            <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
          </span>
          FindItViral
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-16">
        {/* Progress indicator */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`h-2 rounded-full transition-all ${
                i === step ? 'w-8 bg-brand-500' : i < step ? 'w-2 bg-brand-300' : 'w-2 bg-stone-200'
              }`}
              aria-label={`Step ${i + 1}: ${label}`}
            />
          ))}
        </div>

        <div className={`rounded-2xl border-2 border-stone-900 bg-white p-6 sm:p-8 ${TOY_SHADOW}`}>
          {/* Step 0: Username */}
          {step === 0 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 1 of 4</p>
                <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Welcome! Pick your username</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  This is the name others see when you post bounties or sightings.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="onboarding-username">
                  Username
                </label>
                <input
                  id="onboarding-username"
                  className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null) }}
                  placeholder="e.g. bargainhunter"
                  required
                  maxLength={20}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <div className="mt-2 min-h-5 text-sm">
                  {usernameStatus === 'checking' && (
                    <span className="text-stone-500">Checking availability...</span>
                  )}
                  {usernameStatus === 'available' && (
                    <span className="font-medium text-green-600">✓ Available!</span>
                  )}
                  {usernameStatus === 'taken' && (
                    <span className="font-medium text-red-600">That username is taken.</span>
                  )}
                  {usernameStatus === 'invalid' && (
                    <span className="font-medium text-red-600">3-20 chars, letters/numbers/underscore only.</span>
                  )}
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={usernameStatus !== 'available'}
                className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                Continue
              </button>
            </form>
          )}

          {/* Step 1: Location */}
          {step === 1 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 2 of 4</p>
                <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Where are you hunting?</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  We'll show you bounties and sightings near you.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="onboarding-zip">
                  ZIP code
                </label>
                <input
                  id="onboarding-zip"
                  className="w-full rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder="12345"
                  maxLength={5}
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={handleSkip} className="flex-1 rounded-lg border-2 border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-600 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2">
                  Skip for now
                </button>
                <button
                  type="submit"
                  className={`flex-1 rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2`}
                >
                  Continue
                </button>
              </div>
            </form>
          )}

          {/* Step 2: What are you looking for */}
          {step === 2 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 3 of 4</p>
                <h1 className="mt-2 text-2xl font-extrabold text-stone-900">What are you trying to find?</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Tell us what products you're hunting for. This helps us build the right features for you.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-800" htmlFor="onboarding-looking-for">
                  What products are you looking for?
                </label>
                <textarea
                  id="onboarding-looking-for"
                  className="min-h-24 w-full resize-y rounded-lg border-2 border-stone-300 bg-white px-3.5 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={lookingFor}
                  onChange={(e) => setLookingFor(e.target.value)}
                  placeholder="e.g. I'm looking for limited edition snacks, viral TikTok products, sold-out skincare items..."
                  maxLength={500}
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={handleSkip} className="flex-1 rounded-lg border-2 border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-600 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2">
                  Skip for now
                </button>
                <button
                  type="submit"
                  className={`flex-1 rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2`}
                >
                  Continue
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Referral link */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 4 of 4</p>
                <h1 className="mt-2 text-2xl font-extrabold text-stone-900">Your referral link</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Share this link with friends. You get <span className="font-bold">1 month free Pro</span> for each friend who signs up — up to 9 months!
                </p>
              </div>

              <div className="rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-sm font-medium text-brand-800">
                  You already have <span className="font-bold">3 months free Pro</span> from our launch promo!
                </p>
                <p className="mt-1 text-xs text-brand-600">
                  Refer 9 friends for a full year of Pro — completely free.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-800">Your referral link</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border-2 border-stone-300 bg-stone-50 px-3.5 py-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    type="text"
                    value={referralLink}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    onClick={copyReferralLink}
                    className="rounded-lg border-2 border-stone-900 bg-stone-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleFinish}
                disabled={submitting}
                className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold text-stone-950 ${TOY_SHADOW_SM} transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {submitting ? 'Setting up your account...' : 'Go to dashboard'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
