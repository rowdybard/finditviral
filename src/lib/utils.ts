export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function timeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export function formatReward(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function stockLevelLabel(level: string): string {
  switch (level) {
    case 'in_stock':
      return 'HIGH'
    case 'low':
      return 'MEDIUM'
    case 'none':
      return 'LOW'
    default:
      return level
  }
}

export function stockLevelColor(level: string): string {
  switch (level) {
    case 'in_stock':
      return 'bg-green-100 text-green-800'
    case 'low':
      return 'bg-yellow-100 text-yellow-800'
    case 'none':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'claimed':
      return 'Claimed'
    case 'closed':
      return 'Closed'
    case 'pending':
      return 'Pending'
    case 'accepted':
      return 'Accepted'
    case 'rejected':
      return 'Rejected'
    default:
      return status
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'open':
    case 'accepted':
      return 'bg-green-100 text-green-800'
    case 'claimed':
    case 'pending':
      return 'bg-yellow-100 text-yellow-800'
    case 'closed':
    case 'rejected':
      return 'bg-gray-100 text-gray-600'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}
