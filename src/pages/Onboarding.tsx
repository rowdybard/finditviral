import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../lib/analytics'
import { activeMarket } from '../lib/market'
import { supabase } from '../lib/supabase'
import { USERNAME_MAX, normalizeUsername, validateUsername } from '../lib/username'

const TOY_SHADOW = 'shadow-[4px_4px_0_0_#1c1917]'
const TOY_SHADOW_SM = 'shadow-[2px_2px_0_0_#1c1917]'
const STEPS = ['Username', 'Location', 'Interests'] as const

export default function Onboarding() {
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [zipCode, setZipCode] = useState('')
  const [preferredCities, setPreferredCities] = useState<string[]>([])
  const [lookingFor, setLookingFor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkUsername = useCallback(async (value: string) => {
    const clean = normalizeUsername(value)
    if (!clean) {
      setUsernameStatus('idle')
      return
    }
    if (validateUsername(clean)) {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    const { data, error: queryError } = await supabase.rpc('is_username_available', {
      p_username: clean,
    })

    if (queryError) {
      setUsernameStatus('idle')
    } else {
      setUsernameStatus(data === true ? 'available' : 'taken')
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void checkUsername(username), 400)
    return () => clearTimeout(timer)
  }, [username, checkUsername])

  useEffect(() => {
    if (!user) navigate('/auth', { replace: true })
  }, [user, navigate])

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
    if (!/^[0-9]{5}$/.test(zipCode.trim())) {
      setError('Enter a supported Greater Lansing ZIP code.')
      setSubmitting(false)
      setStep(1)
      return
    }
    if (preferredCities.length < 1) {
      setError('Please select at least one city.')
      setSubmitting(false)
      setStep(1)
      return
    }

    const { error: rpcError } = await supabase.rpc('complete_onboarding', {
      p_username: cleanUsername,
      p_zip_code: zipCode.trim(),
      p_looking_for: lookingFor.trim() || null,
      p_referrer_username: null,
      p_preferred_cities: preferredCities,
    })

    if (rpcError) {
      const message = rpcError.message
      const usernameConflict = message === 'username_unavailable'
        || rpcError.details?.includes('username_claim_policy') === true
      if (message.includes('already been completed') || message.includes('55006')) {
        await refreshProfile()
        navigate('/home', { replace: true })
        return
      }
      if (usernameConflict) {
        setError('That username is taken. Try another one.')
        setStep(0)
      } else if (message.includes('ZIP')) {
        setError('That ZIP code is outside the Greater Lansing beta area.')
        setStep(1)
      } else if (message.includes('Greater Lansing city')) {
        setError('Please select at least one Greater Lansing city.')
        setStep(1)
      } else if (message.includes('500 characters')) {
        setError('Looking for must be 500 characters or fewer.')
        setStep(2)
      } else {
        setError('Something went wrong. Please try again.')
      }
      setSubmitting(false)
      return
    }

    await refreshProfile()
    trackEvent('complete_onboarding', {
      has_zip: true,
      city_count: preferredCities.length,
    })
    navigate('/home', { replace: true })
  }

  function handleNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step === 0) {
      const validationError = validateUsername(normalizeUsername(username))
      if (validationError) {
        setError(validationError)
        return
      }
      if (usernameStatus !== 'available') {
        setError(usernameStatus === 'taken' ? 'That username is taken.' : 'Please wait for username validation.')
        return
      }
    }
    if (step === 1) {
      if (!/^[0-9]{5}$/.test(zipCode)) {
        setError('Enter a supported Greater Lansing ZIP code.')
        return
      }
      if (preferredCities.length < 1) {
        setError('Please select at least one city.')
        return
      }
    }

    setError(null)
    if (step < STEPS.length - 1) setStep((value) => value + 1)
    else void handleFinish()
  }

  if (!user) return null

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      <div aria-hidden="true" className="h-1.5 w-full bg-brand-500" />
      <header className="mx-auto flex w-full max-w-md items-center justify-center px-5 py-6">
        <span className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight">
          <span className={`grid h-9 w-9 place-items-center rounded-lg border-2 border-stone-900 bg-white ${TOY_SHADOW_SM}`}>
            <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6" />
          </span>
          FindItViral
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-16">
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((label, index) => (
            <div
              key={label}
              className={`h-2 rounded-full transition-all ${index === step ? 'w-8 bg-brand-500' : index < step ? 'w-2 bg-brand-300' : 'w-2 bg-stone-200'}`}
              aria-label={`Step ${index + 1}: ${label}`}
            />
          ))}
        </div>

        <div className={`rounded-2xl border-2 border-stone-900 bg-white p-6 sm:p-8 ${TOY_SHADOW}`}>
          {step === 0 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 1 of 3</p>
                <h1 className="mt-2 text-2xl font-extrabold">Set up your account</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">{activeMarket.onboardingHelp}</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="onboarding-username">Username</label>
                <input
                  id="onboarding-username"
                  className="w-full rounded-lg border-2 border-stone-300 px-3.5 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={username}
                  onChange={(event) => { setUsername(normalizeUsername(event.target.value)); setError(null) }}
                  placeholder="e.g. bargainhunter"
                  required
                  maxLength={USERNAME_MAX}
                  autoComplete="off"
                  autoCapitalize="off"
                  pattern="[A-Za-z]+"
                  spellCheck={false}
                />
                <div className="mt-2 min-h-5 text-sm">
                  {usernameStatus === 'checking' && <span className="text-stone-500">Checking availability…</span>}
                  {usernameStatus === 'available' && <span className="font-medium text-green-700">✓ Available</span>}
                  {usernameStatus === 'taken' && <span className="font-medium text-red-700">That username is taken.</span>}
                  {usernameStatus === 'invalid' && <span className="font-medium text-red-700">Use 3–24 letters only.</span>}
                </div>
              </div>
              {error && <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
              <button type="submit" disabled={usernameStatus !== 'available'} className={`w-full rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold ${TOY_SHADOW_SM} disabled:cursor-not-allowed disabled:opacity-60`}>Continue</button>
            </form>
          )}

          {step === 1 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 2 of 3</p>
                <h1 className="mt-2 text-2xl font-extrabold">Where are you shopping?</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">{activeMarket.onboardingLocationHelp}</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="onboarding-zip">ZIP code</label>
                <input
                  id="onboarding-zip"
                  className="w-full rounded-lg border-2 border-stone-300 px-3.5 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  value={zipCode}
                  onChange={(event) => setZipCode(event.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder={activeMarket.defaultZip}
                  maxLength={5}
                  required
                />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Which cities are you interested in?</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {activeMarket.cities.map((city) => {
                    const checked = preferredCities.includes(city)
                    return (
                      <label key={city} className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium ${checked ? 'border-brand-500 bg-brand-50 text-brand-900' : 'border-stone-300 text-stone-700'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setPreferredCities((cities) => checked ? cities.filter((value) => value !== city) : [...cities, city])
                            setError(null)
                          }}
                          className="h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
                        />
                        {city}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {error && <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setStep(0); setError(null) }} className="flex-1 rounded-lg border-2 border-stone-300 bg-white px-4 py-3 text-sm font-bold">Back</button>
                <button type="submit" className={`flex-1 rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold ${TOY_SHADOW_SM}`}>Continue</button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleNext} className="space-y-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">Step 3 of 3</p>
                <h1 className="mt-2 text-2xl font-extrabold">What are you trying to find?</h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">This optional note helps other local shoppers understand what you are hunting.</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="onboarding-looking-for">Products of interest</label>
                <textarea
                  id="onboarding-looking-for"
                  className="min-h-28 w-full resize-y rounded-lg border-2 border-stone-300 px-3.5 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  value={lookingFor}
                  onChange={(event) => setLookingFor(event.target.value)}
                  placeholder="Limited snacks, collectibles, viral drinks, trending toys…"
                  maxLength={500}
                />
              </div>
              {error && <p role="alert" className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setStep(1); setError(null) }} className="flex-1 rounded-lg border-2 border-stone-300 bg-white px-4 py-3 text-sm font-bold">Back</button>
                <button type="submit" disabled={submitting} className={`flex-1 rounded-lg border-2 border-stone-900 bg-brand-500 px-4 py-3 text-sm font-bold ${TOY_SHADOW_SM} disabled:cursor-not-allowed disabled:opacity-60`}>{submitting ? 'Saving…' : 'Finish setup'}</button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
