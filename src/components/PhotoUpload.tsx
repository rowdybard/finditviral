import { useRef, useState } from 'react'
import { Camera, TrashSimple } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

type Props = {
  photoUrls: string[]
  onChange: (urls: string[]) => void
  maxPhotos?: number
  disabled?: boolean
}

const MAX_FILE_SIZE = 8 * 1024 * 1024

export default function PhotoUpload({
  photoUrls,
  onChange,
  maxPhotos = 4,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previews, setPreviews] = useState<string[]>([])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)

    const remaining = maxPhotos - photoUrls.length
    if (remaining <= 0) {
      setError(`Maximum ${maxPhotos} photos.`)
      return
    }

    const toUpload = Array.from(files).slice(0, remaining)
    const newPreviews: string[] = []
    const newUrls: string[] = []

    for (const file of toUpload) {
      if (!file.type.startsWith('image/')) {
        setError('Only image files are allowed.')
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        setError('Each photo must be under 8 MB.')
        continue
      }

      const previewUrl = URL.createObjectURL(file)
      newPreviews.push(previewUrl)

      setUploading(true)
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id ?? 'anonymous'
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('sighting-photos')
        .upload(fileName, file, { contentType: file.type })

      setUploading(false)

      if (uploadError) {
        setError('Could not upload photo. Please try again.')
        URL.revokeObjectURL(previewUrl)
        continue
      }

      const { data: urlData } = supabase.storage
        .from('sighting-photos')
        .getPublicUrl(fileName)

      newUrls.push(urlData.publicUrl)
    }

    if (newUrls.length > 0) {
      onChange([...photoUrls, ...newUrls])
    }

    setPreviews((prev) => [...prev, ...newPreviews])
  }

  function removePhoto(index: number) {
    const url = photoUrls[index]
    onChange(photoUrls.filter((_, i) => i !== index))

    if (previews[index]) {
      URL.revokeObjectURL(previews[index])
      setPreviews((prev) => prev.filter((_, i) => i !== index))
    }

    if (url) {
      const path = url.split('/sighting-photos/')[1]
      if (path) {
        void supabase.storage.from('sighting-photos').remove([path])
      }
    }
  }

  const slots = Array.from({ length: maxPhotos }, (_, i) => i)

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {slots.map((slot) => {
          const photo = photoUrls[slot]
          const preview = previews[slot]
          if (photo || preview) {
            return (
              <div
                key={slot}
                className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-100"
              >
                <img
                  src={photo || preview}
                  alt={`Photo ${slot + 1}`}
                  className="h-full w-full object-cover"
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removePhoto(slot)}
                    className="absolute right-1 top-1 rounded-lg bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="Remove photo"
                  >
                    <TrashSimple size={16} weight="bold" />
                  </button>
                )}
              </div>
            )
          }
          if (slot === photoUrls.length) {
            return (
              <button
                key={slot}
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled || uploading}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50"
              >
                {uploading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
                ) : (
                  <>
                    <Camera size={22} weight="duotone" />
                    <span className="text-[10px] font-semibold">Add</span>
                  </>
                )}
              </button>
            )
          }
          return (
            <div
              key={slot}
              className="aspect-square rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50"
            />
          )
        })}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
        disabled={disabled}
      />

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}

      <p className="mt-2 text-xs text-gray-400">
        Up to {maxPhotos} photos. JPG, PNG, or WebP. Max 8 MB each.
      </p>
    </div>
  )
}
