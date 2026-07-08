import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Profile, Bounty, Sighting } from '../types/database'
import BountyCard from '../components/BountyCard'
import SightingCard from '../components/SightingCard'
import EmptyState from '../components/EmptyState'

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>()
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [sightings, setSightings] = useState<Sighting[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [contactInfo, setContactInfo] = useState('')
  const [saving, setSaving] = useState(false)

  const isOwnProfile = user?.id === profile?.id

  useEffect(() => {
    if (!username) return
    async function load() {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single()
      if (!profileData) {
        setLoading(false)
        return
      }
      setProfile(profileData as Profile)

      const [bountiesRes, sightingsRes] = await Promise.all([
        supabase
          .from('bounties')
          .select('*, product(*), profile:profiles(*)')
          .eq('user_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('sightings')
          .select('*, product(*), profile:profiles(*)')
          .eq('user_id', profileData.id)
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      setBounties(bountiesRes.data as Bounty[] ?? [])
      setSightings(sightingsRes.data as Sighting[] ?? [])
      setLoading(false)
    }
    load()
  }, [username])

  async function handleSaveContact() {
    if (!profile) return
    setSaving(true)
    await supabase
      .from('profiles')
      .update({ contact_info: contactInfo.trim() || null })
      .eq('id', profile.id)
    setProfile({ ...profile, contact_info: contactInfo.trim() || null })
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
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{profile.username}</h1>
            {profile.is_pro && (
              <span className="rounded bg-gradient-to-r from-brand-500 to-purple-500 px-1.5 py-0.5 text-xs font-bold text-white">
                PRO
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="h-4 w-4 text-brand-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/></svg>
              {profile.karma} karma
            </span>
          </div>
        </div>
      </div>

      {isOwnProfile && (
        <div className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Contact info</h2>
            {!editing && (
              <button onClick={() => { setContactInfo(profile.contact_info ?? ''); setEditing(true) }} className="btn-ghost text-sm">
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
                maxLength={200}
              />
              <p className="text-xs text-gray-500">
                This is shown to bounty posters when they accept your claim. It is never public.
              </p>
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
              {profile.contact_info || 'No contact info set. Add one so bounty posters can reach you.'}
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
    </div>
  )
}
