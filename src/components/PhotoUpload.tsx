import { useEffect, useRef, useState } from 'react'
import { Camera, TrashSimple } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'

type Props = {
  photoUrls: string[]
  onChange: (urls: string[]) => void
  maxPhotos?: number
  disabled?: boolean
}

const MAX_FILE_SIZE = 8 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type UploadingItem = {
  id: string
  previewUrl: string
}

export default function PhotoUpload({
  photoUrls,
  onChange,
  maxPhotos = 4,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const storagePathsRef = useRef<Map<string, string>>(new Map())
  const photoUrlsRef = useRef(photoUrls)
  photoUrlsRef.current = photoUrls
  const uploadingItemsRef = useRef(uploadingItems)
  uploadingItemsRef.current = uploadingItems

  useEffect(() => {
    return () => {
      uploadingItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  const totalSlots = photoUrls.length + uploadingItems.length

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)

    const remaining = maxPhotos - totalSlots
    if (remaining <= 0) {
      setError(`Maximum ${maxPhotos} photos.`)
      return
    }

    const toUpload = Array.from(files).slice(0, remaining)

    const validFiles: File[] = []
    for (const file of toUpload) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError('Only JPG, PNG, and WebP images are allowed.')
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        setError('Each photo must be under 8 MB.')
        continue
      }
      validFiles.push(file)
    }

    if (validFiles.length === 0) return

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setError('You must be signed in to upload photos.')
      return
    }

    setIsUploading(true)

    for (const file of validFiles) {
      const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const previewUrl = URL.createObjectURL(file)
      setUploadingItems((prev) => [...prev, { id, previewUrl }])

      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${userData.user!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('sighting-photos')
        .upload(fileName, file, { contentType: file.type, upsert: true })

      if (uploadError) {
        setError('Could not upload photo. Please try again.')
        URL.revokeObjectURL(previewUrl)
        setUploadingItems((prev) => prev.filter((item) => item.id !== id))
        continue
      }

      const { data: urlData } = supabase.storage
        .from('sighting-photos')
        .getPublicUrl(fileName)

      const publicUrl = urlData.publicUrl
      storagePathsRef.current.set(publicUrl, fileName)

      URL.revokeObjectURL(previewUrl)
      setUploadingItems((prev) => prev.filter((item) => item.id !== id))
      onChange([...photoUrlsRef.current, publicUrl])
    }

    setIsUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function removePhoto(index: number) {
    const url = photoUrls[index]
    onChange(photoUrls.filter((_, i) => i !== index))

    if (url) {
      const path = storagePathsRef.current.get(url)
      if (path) {
        void supabase.storage.from('sighting-photos').remove([path])
        storagePathsRef.current.delete(url)
      }
    }
  }

  const slots = Array.from({ length: maxPhotos }, (_, i) => i)

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {slots.map((slot) => {
          const photo = photoUrls[slot]
          const uploadingItem = uploadingItems[slot - photoUrls.length]
          if (photo) {
            return (
              <div
                key={`photo-${slot}`}
                className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-100"
              >
                <img
                  src={photo}
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
          if (uploadingItem) {
            return (
              <div
                key={`uploading-${uploadingItem.id}`}
                className="relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-100"
              >
                <img
                  src={uploadingItem.previewUrl}
                  alt="Uploading..."
                  className="h-full w-full object-cover opacity-60"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
                </div>
              </div>
            )
          }
          if (slot === totalSlots) {
            return (
              <button
                key={`add-${slot}`}
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled || isUploading}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50"
              >
                {isUploading ? (
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
              key={`empty-${slot}`}
              className="aspect-square rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50"
            />
          )
        })}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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
