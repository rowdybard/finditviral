import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { supabase } from '../lib/supabase'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  photoPath: string
  onUnavailable?: () => void
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|blob:)/i.test(value)
}

export default function SightingPhoto({ photoPath, onUnavailable, ...imageProps }: Props) {
  const onUnavailableRef = useRef(onUnavailable)
  onUnavailableRef.current = onUnavailable
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    isDirectImageUrl(photoPath) ? photoPath : null,
  )

  useEffect(() => {
    let cancelled = false

    if (isDirectImageUrl(photoPath)) {
      setResolvedUrl(photoPath)
      return () => {
        cancelled = true
      }
    }

    setResolvedUrl(null)
    void supabase.storage
      .from('sighting-photos')
      .createSignedUrl(photoPath, 300)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data?.signedUrl) {
          onUnavailableRef.current?.()
          return
        }
        setResolvedUrl(data.signedUrl)
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current?.()
      })

    return () => {
      cancelled = true
    }
  }, [photoPath])

  return <img {...imageProps} src={resolvedUrl ?? undefined} />
}
