import { setMascotPrefs, useMascotPrefs } from './mascotPrefs'

export default function MascotRestoreButton() {
  const prefs = useMascotPrefs()
  if (!prefs.hidden) return null
  return (
    <button
      onClick={() => setMascotPrefs({ hidden: false })}
      className="ml-2 font-semibold text-brand-600 underline hover:text-brand-700"
    >
      Show Scout
    </button>
  )
}
