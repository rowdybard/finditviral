import { Link } from 'react-router-dom'
import type { Sighting } from '../types/database'
import { timeAgo, stockLevelLabel, stockLevelColor } from '../lib/utils'
import { formatDistance } from '../lib/distance'

export default function SightingCard({ sighting }: { sighting: Sighting }) {
  return (
    <Link
      to={`/products/${sighting.product?.slug ?? ''}`}
      className="card block transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`badge ${stockLevelColor(sighting.stock_level)}`}>
              {stockLevelLabel(sighting.stock_level)}
            </span>
          </div>
          <h3 className="mt-2 truncate font-semibold text-gray-900">
            {sighting.product?.name ?? 'Unknown product'}
          </h3>
          {sighting.product?.trend && (
            <p className="text-xs text-brand-500">{sighting.product.trend.name}</p>
          )}
          <p className="mt-0.5 truncate text-sm text-gray-600">
            {sighting.store_name}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            {sighting.city && sighting.state && (
              <>
                <span>{sighting.city}, {sighting.state}</span>
                <span>·</span>
              </>
            )}
            {sighting.zip_code && (
              <>
                <span>ZIP {sighting.zip_code}</span>
                <span>·</span>
              </>
            )}
            {sighting.distance_miles !== undefined && (
              <>
                <span className="font-medium text-brand-600">
                  {formatDistance(sighting.distance_miles)} away
                </span>
                <span>·</span>
              </>
            )}
            <span>{timeAgo(sighting.created_at)}</span>
          </div>
          {sighting.profile && (
            <p className="mt-1 text-xs text-gray-400">by @{sighting.profile.username}</p>
          )}
          {sighting.photo_urls && sighting.photo_urls.length > 0 && (
            <div className="mt-2 flex gap-1.5">
              {sighting.photo_urls.slice(0, 3).map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="h-14 w-14 rounded-md border border-gray-200 object-cover"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
