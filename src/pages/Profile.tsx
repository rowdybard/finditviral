import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Profile, ProfileContact, Bounty, Sighting, BountyClaim } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'
import { buildReferralLink } from '../lib/referral'
import { trackEvent } from '../lib/analytics'

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>()
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [claims, setClaims] = useState<BountyClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [contactInfo, setContactInfo] = useState('')
  const [savedContactInfo, setSavedContactInfo] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const isOwnProfile = user?.id === profile?.id

  useEffect(() => {
    if (!username) return
    async function load() {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, username, karma, is_pro, created_at')
        .eq('username', username)
        .single()
      if (!profileData) {
        setLoading(false)
        return
      }
      setProfile(profileData as Profile)
      const ownProfile = user?.id === profileData.id

      const [bountiesRes, sightingsRes, claimsRes] = await Promise.all([
        supabase
          .from('bounties')
          .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('user_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('sightings')
          .select('*, product(*), profile:profiles(id, username, karma, is_pro, created_at)')
          .eq('user_id', profileData.id)
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('bounty_claims')
          .select('*, bounty:bounties(*, product(*)), finder:profiles(id, username, karma, is_pro, created_at)')
          .eq('finder_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      setBounties(bountiesRes.data as Bounty[] ?? [])
      setSightings(sightingsRes.data as Sighting[] ?? [])
      setClaims(claimsRes.data as BountyClaim[] ?? [])

      if (ownProfile) {
        const [ownProfileRes, contactRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, username, karma, is_pro, created_at, looking_for, onboarding_completed, preferred_cities')
            .eq('id', profileData.id)
            .single(),
          supabase
            .from('profile_contacts')
            .select('user_id, contact_info, created_at, updated_at')
            .eq('user_id', profileData.id)
            .single(),
        ])
        if (ownProfileRes.data) {
          setProfile(ownProfileRes.data as Profile)
        }
        setSavedContactInfo((contactRes.data as ProfileContact | null)?.contact_info ?? null)
      }

      setLoading(false)
    }
    load()
  }, [username, user?.id])

  async function handleSaveContact() {
    if (!profile) return
    setSaveError(null)
    setSaving(true)
    const nextContactInfo = contactInfo.trim() || null
    const { error } = await supabase
      .from('profile_contacts')
      .upsert(
        { user_id: profile.id, contact_info: nextContactInfo },
        { onConflict: 'user_id' },
      )

    if (error) {
      setSaveError(error.message)
      setSaving(false)
      return
    }

    setSavedContactInfo(nextContactInfo)
    setEditing(false)
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    )
  }

  if (!profile) {
    return (
      <EmptyState
        title="User not found"
        message="This user may not exist."
        action={<Link to="/" className="btn-primary">Go home</Link>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-700">
          {profile.username.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{profile.username}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="h-4 w-4 text-brand-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/></svg>
              {profile.karma} karma
            </span>
          </div>
        </div>
      </div>

      {isOwnProfile && profile.looking_for && (
        <div className="card">
          <h2 className="font-semibold text-gray-900">What you're looking for</h2>
          <p className="mt-2 text-sm text-gray-600">{profile.looking_for}</p>
        </div>
      )}

      {isOwnProfile && profile.preferred_cities && profile.preferred_cities.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900">Your cities</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.preferred_cities.map((city) => (
              <span key={city} className="badge bg-brand-100 text-brand-800">{city}</span>
            ))}
          </div>
        </div>
      )}

      {isOwnProfile && (
        <div className="card">
          <h2 className="font-semibold text-gray-900">Your referral link</h2>
          <p className="mt-1 text-sm text-gray-500">
            Get 1 month free Pro for each friend who signs up (up to 9 months).
          </p>
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1 text-sm"
              type="text"
              value={buildReferralLink(profile.username)}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(buildReferralLink(profile.username)).then(() => {
                  trackEvent('share_referral')
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
              className="btn-secondary text-sm whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {(profile.referral_count ?? 0) > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{profile.referral_count} friend{(profile.referral_count ?? 0) === 1 ? '' : 's'} referred</span>
                <span>{profile.referral_count} / 9</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${Math.min(((profile.referral_count ?? 0) / 9) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
          {profile.is_pro && (
            <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
              ✓ You have 3 months free Pro from the launch promo!
            </p>
          )}
        </div>
      )}

      {isOwnProfile && profile.looking_for && (
        <div className="card">
          <h2 className="font-semibold text-gray-900">What you're looking for</h2>
          <p className="mt-2 text-sm text-gray-600">{profile.looking_for}</p>
        </div>
      )}

      {isOwnProfile && profile.preferred_cities && profile.preferred_cities.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900">Your cities</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.preferred_cities.map((city) => (
              <span key={city} className="badge bg-brand-100 text-brand-800">{city}</span>
            ))}
          </div>
        </div>
      )}

      {isOwnProfile && (
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Contact info</h2>
            {!editing && (
              <button onClick={() => { setContactInfo(savedContactInfo ?? ''); setEditing(true); setSaveError(null) }} className="btn-ghost text-sm">
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <div className="mt-3 space-y-3">
              <input
                className="input"
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                placeholder="Email, Discord, Venmo, etc."
                maxLength={500}
              />
              <p className="text-sm text-gray-500">
                This is shown to bounty posters when they accept your claim. It is never public.
              </p>
              {saveError && (
                <p className="text-sm text-red-600">{saveError}</p>
              )}
              <div className="flex gap-2">
                <button onClick={handleSaveContact} className="btn-primary text-sm" disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="btn-secondary text-sm">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              {savedContactInfo || 'No contact info set. Add one so bounty posters can reach you.'}
            </p>
          )}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Bounties ({bounties.length})</h2>
        {bounties.length > 0 ? (
          <div className="space-y-3">
            {bounties.map((b) => (
              <BountyCard key={b.id} bounty={b} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No bounties posted.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Public Sightings ({sightings.length})</h2>
        {sightings.length > 0 ? (
          <div className="space-y-3">
            {sightings.map((s) => (
              <SightingCard key={s.id} sighting={s} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No public sightings reported.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Claim History ({claims.length})</h2>
        {claims.length > 0 ? (
          <div className="space-y-3">
            {claims.map((c) => (
              <div key={c.id} className="card">
                <div className="flex items-center justify-between">
                  <Link
                    to={`/bounties/${c.bounty_id}`}
                    className="truncate font-medium text-brand-600 hover:text-brand-700"
                  >
                    {c.bounty?.product?.name ?? 'Unknown product'}
                  </Link>
                  <span className={`badge ${
                    c.status === 'accepted' ? 'bg-green-100 text-green-800' :
                    c.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {c.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No claims submitted.</p>
        )}
      </section>
    </div>
  )
}
