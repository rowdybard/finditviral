import { useViewerLocation } from '../contexts/ViewerLocationContext'

export default function UseMyZipButton({ onUse }: { onUse: (zipCode: string) => void }) {
  const { zipCode, source, loading } = useViewerLocation()
  if (loading || source !== 'profile') return null
  return <button type="button" className="mt-1 text-xs font-bold text-brand-700 underline underline-offset-2" onClick={() => onUse(zipCode)}>Use my ZIP ({zipCode})</button>
}
