import { useRef, useState } from 'react'

const MAX_PHOTOS = 3

export default function PhotoUpload({
  isPro,
  photoUrls,
  onChange,
}: {
  isPro: boolean
  photoUrls: string[]
  onChange: (urls: string[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  if (!isPro) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
        <svg className="mx-auto h-8 w-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L6 21" />
        </svg>
        <p className="mt-2 text-sm font-medium text-gray-600">Pro members can add photos</p>
        <p className="mt-1 text-xs text-gray-400">Upgrade to attach up to 3 photos to your sightings.</p>
      </div>
    )
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    setError(null)

    const remaining = MAX_PHOTOS - photoUrls.length
    if (remaining <= 0) {
      setError(`Maximum ${MAX_PHOTOS} photos allowed.`)
      return
    }

    const toAdd = Array.from(files).slice(0, remaining)
    const newUrls: string[] = []

    for (const file of toAdd) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files are allowed.')
        continue
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('Each photo must be under 5MB.')
        continue
      }
      newUrls.push(URL.createObjectURL(file))
    }

    if (newUrls.length > 0) {
      onChange([...photoUrls, ...newUrls])
    }
  }

  function removePhoto(index: number) {
    const url = photoUrls[index]
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    onChange(photoUrls.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="label">Photos (optional)</label>
        <span className="text-xs text-gray-400">{photoUrls.length} / {MAX_PHOTOS}</span>
      </div>

      {photoUrls.length > 0 && (
        <div className="flex gap-2">
          {photoUrls.map((url, i) => (
            <div key={i} className="relative">
              <img
                src={url}
                alt={`Photo ${i + 1}`}
                className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(i)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow-sm hover:bg-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {photoUrls.length < MAX_PHOTOS && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-6 text-gray-400 transition-colors hover:border-brand-300 hover:bg-brand-50"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          <span className="mt-1 text-xs font-medium">Add photos</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      <p className="text-xs text-gray-400">
        Up to {MAX_PHOTOS} photos, 5MB each. JPG, PNG, or WebP.
      </p>
    </div>
  )
}
