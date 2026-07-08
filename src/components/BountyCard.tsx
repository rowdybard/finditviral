import { Link } from 'react-router-dom'
import type { Bounty } from '../types/database'
import { formatReward, timeAgo, statusColor, statusLabel } from '../lib/utils'
import { formatDistance } from '../lib/distance'

export default function BountyCard({ bounty }: { bounty: Bounty }) {
  return (
    <Link
      to={`/bounties/${bounty.id}`}
      className="card block transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="badge bg-brand-100 text-brand-800">
              {formatReward(bounty.reward_amount)}
            </span>
            <span className={`badge ${statusColor(bounty.status)}`}>
              {statusLabel(bounty.status)}
            </span>
          </div>
          <h3 className="mt-2 truncate font-semibold text-gray-900">
            {bounty.product?.name ?? 'Unknown product'}
          </h3>
          <p className="mt-0.5 truncate text-sm text-gray-500">
            {bounty.notes || 'No additional notes'}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            <span>ZIP {bounty.zip_code}</span>
            <span>·</span>
            <span>{bounty.radius_miles}mi radius</span>
            {bounty.distance_miles !== undefined && (
              <>
                <span>·</span>
                <span className="font-medium text-brand-600">
                  {formatDistance(bounty.distance_miles)} away
                </span>
              </>
            )}
            <span>·</span>
            <span>{timeAgo(bounty.created_at)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
