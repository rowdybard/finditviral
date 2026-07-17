import {
  Clock,
  Eye,
  MapPin,
  Storefront,
  Trash,
  PencilSimple,
  UserCircle,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Sighting } from '../types/database'
import { timeAgo } from '../lib/utils'
import ShareButton from './ShareButton'
import SightingPhoto from './SightingPhoto'
import SightingVerificationControls from './SightingVerificationControls'
import { updateSighting } from '../lib/launchApi'
import { useMascotToast } from '../contexts/MascotToastContext'
import StatusExplanation from './StatusExplanation'

const stockThemes = {
  in_stock: {
    rail: 'bg-green-600',
    text: 'text-green-700',
    dot: 'bg-green-600 border-green-600',
    accent: 'green' as const,
    filledDots: 5,
    label: 'IN STOCK',
  },
  low_stock: {
    rail: 'bg-amber-400',
    text: 'text-amber-700',
    dot: 'bg-amber-400 border-amber-500',
    accent: 'yellow' as const,
    filledDots: 3,
    label: 'LOW STOCK',
  },
  sold_out: {
    rail: 'bg-red-600',
    text: 'text-red-600',
    dot: 'bg-red-600 border-red-600',
    accent: 'red' as const,
    filledDots: 1,
    label: 'SOLD OUT',
  },
  unknown: {
    rail: 'bg-stone-400',
    text: 'text-stone-500',
    dot: 'bg-stone-400 border-stone-500',
    accent: 'yellow' as const,
    filledDots: 0,
    label: 'UNKNOWN',
  },
}

export default function SightingCard({ sighting, onDelete }: { sighting: Sighting; onDelete?: (id: string) => void }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [notes, setNotes] = useState(sighting.notes ?? '')
  const [quantity, setQuantity] = useState(sighting.quantity?.toString() ?? '')
  const [availabilityValue, setAvailabilityValue] = useState(sighting.availability ?? 'unknown')
  const toast = useMascotToast()
  const productName = sighting.product?.name ?? sighting.product_name ?? 'Unknown product'
  const productPath = `/products/${sighting.product?.slug ?? sighting.product_slug ?? ''}`
  const availability = sighting.availability
    ?? (sighting.stock_level === 'in_stock' ? 'in_stock' : sighting.stock_level === 'low' ? 'low_stock' : 'unknown')
  const theme = stockThemes[availability]
  const availabilityLabel = theme.label
  const location = [sighting.city, sighting.state].filter(Boolean).join(', ')
  const photoUrl = photoFailed ? undefined : sighting.photo_urls?.[0]
  const shareText = `${availabilityLabel} availability spotted for ${productName} at ${sighting.store_name}${location ? ` in ${location}` : ''}.`

  async function saveEdit() {
    setSaving(true)
    setEditError(null)
    const parsedQuantity = quantity.trim() ? Number(quantity) : null
    if (parsedQuantity !== null && (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99)) {
      setEditError('Quantity must be a whole number from 1 to 99.')
      setSaving(false)
      return
    }
    const { error } = await updateSighting({ sightingId: sighting.id, notes: notes.trim() || null, quantity: parsedQuantity, availability: availabilityValue })
    if (error) {
      setEditError(error.message)
      setSaving(false)
      return
    }
    window.location.reload()
  }

  return (
    <article
      id={`sighting-${sighting.id}`}
      className="group mb-1.5 mr-1.5 grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border-2 border-stone-950 bg-[#fffdf7] shadow-[6px_6px_0_0_#1c1917] transition-[transform,box-shadow] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_0_#1c1917]"
      data-testid="sighting-card"
    >
      <div className={`flex flex-col items-center justify-between py-3 text-white ${theme.rail}`}>
        <span className={`rotate-180 text-sm font-black tracking-[0.18em] [writing-mode:vertical-rl] ${availability === 'low_stock' ? 'text-stone-950' : ''}`}>
          SIGHTING
        </span>
        <Eye
          aria-hidden="true"
          className={availability === 'low_stock' ? 'text-stone-950' : ''}
          size={24}
          weight="bold"
        />
      </div>

      <div className="min-w-0">
        <Link
          to={productPath}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-600"
          aria-label={`View ${productName}`}
        >
          <div className={`grid min-w-0 gap-4 p-3 sm:p-4 ${photoUrl ? 'sm:grid-cols-[8.5rem_minmax(0,1fr)_8rem]' : 'sm:grid-cols-[8.5rem_minmax(0,1fr)]'}`}>
            <div className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-center shadow-[2px_2px_0_0_#d6d3d1]">
              <p className="text-[11px] font-black uppercase tracking-[0.1em] text-stone-700">Stock</p>
              <p className={`mt-2 font-black leading-none tracking-tight text-xl sm:text-2xl ${theme.text}`}>
                {availabilityLabel}
              </p>
              <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <span
                    key={index}
                    className={`h-3.5 w-3.5 rounded-full border-2 ${index < theme.filledDots ? theme.dot : 'border-stone-300 bg-transparent'}`}
                  />
                ))}
              </div>
            </div>

            <div className="min-w-0 py-0.5">
              <h3 className="text-xl font-black leading-tight tracking-tight text-stone-950 sm:text-2xl">
                {productName}
              </h3>
              {sighting.product?.trend && (
                <>
                  <p className="mt-0.5 text-sm font-semibold text-stone-600">
                    {sighting.product.trend.name}
                  </p>
                  <span className="mt-2 inline-flex rounded border border-brand-400 bg-brand-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-stone-900">
                    Trend: {sighting.product.trend.name}
                  </span>
                </>
              )}
              <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug text-stone-700">
                {sighting.notes || `Spotted locally at ${sighting.store_name}. Tap through for the full product trail.`}
              </p>
            </div>

            {photoUrl && (
              <SightingPhoto
                photoPath={photoUrl}
                alt={`${productName} at ${sighting.store_name}`}
                onError={() => setPhotoFailed(true)}
                onUnavailable={() => setPhotoFailed(true)}
                className="h-28 w-full rounded-lg border-2 border-stone-900 object-cover shadow-[3px_3px_0_0_#1c1917] sm:h-full sm:min-h-28"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-300 px-3 py-1.5 text-xs font-bold text-stone-600 sm:px-4">
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden="true" size={14} weight="fill" className={theme.text} />
              <span className="truncate">{sighting.store_name}{location ? `, ${location}` : ''}</span>
            </span>
            <span className="text-stone-300" aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" size={14} weight="bold" className={theme.text} />
              {timeAgo(sighting.seen_at ?? sighting.created_at)}
            </span>
          </div>
        </Link>

        {editing && (
          <div className="space-y-3 border-t border-stone-300 bg-stone-50 p-3 sm:p-4">
            <label className="label">Notes<textarea className="input mt-1 min-h-20" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="label">Quantity<input className="input mt-1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
              <label className="label">Availability<select className="input mt-1" value={availabilityValue} onChange={(event) => setAvailabilityValue(event.target.value as typeof availabilityValue)}><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="sold_out">Sold out</option><option value="unknown">Unknown</option></select></label>
            </div>
            {editError && <p className="text-sm font-bold text-red-700">{editError}</p>}
            <div className="flex gap-2"><button type="button" className="btn-primary text-sm" disabled={saving} onClick={() => void saveEdit()}>{saving ? 'Saving…' : 'Save changes'}</button><button type="button" className="btn-secondary text-sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        )}

        <SightingVerificationControls sighting={sighting} />
        <div className="px-3 pb-2 sm:px-4"><StatusExplanation status={sighting.freshness_status === 'possibly_outdated' ? 'possibly_gone' : sighting.moderation_status} isOwner={sighting.is_owner} /></div>

        <footer className="flex min-h-12 items-center justify-between gap-2 border-t border-stone-300 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-stone-900">
            {sighting.profile ? (
              <>
                <UserCircle aria-hidden="true" size={22} weight="fill" />
                <span className="truncate">@{sighting.profile.username}</span>
              </>
            ) : (
              <>
                <Storefront aria-hidden="true" size={20} weight="bold" />
                <span>Local spotter</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {sighting.is_owner && (
              <button type="button" className="btn-ghost" title="Edit sighting" onClick={() => { setEditing((value) => !value); if (!editing) toast('Editing resets verifications', 'Heads up! Editing your sighting will reset all community verifications.') }}><PencilSimple size={17} aria-hidden="true" /></button>
            )}
            {sighting.edited_at && <span className="text-xs font-bold text-stone-500">Edited {timeAgo(sighting.edited_at)}</span>}
            {onDelete && sighting.is_owner && (
              <button
                type="button"
                className="btn-ghost text-red-700"
                title="Delete sighting"
                disabled={deleting}
                onClick={() => {
                  if (window.confirm('Delete this sighting? This cannot be undone.')) {
                    setDeleting(true)
                    onDelete(sighting.id)
                  }
                }}
              >
                <Trash size={17} aria-hidden="true" />
              </button>
            )}
            <ShareButton
              title={`Sighting: ${productName}`}
              text={shareText}
              path={`${productPath}#sighting-${sighting.id}`}
              accent={theme.accent}
            />
          </div>
        </footer>
      </div>
    </article>
  )
}
