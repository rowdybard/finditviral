import { type ReactNode } from 'react'

export default function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-stone-300">{icon}</div>}
      <h3 className="text-base font-semibold text-stone-700">{title}</h3>
      <p className="mt-1 text-sm text-stone-500">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
