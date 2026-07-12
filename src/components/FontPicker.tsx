import { useState } from 'react'
import { applyFont, FONT_OPTIONS, getStoredFontId } from '../lib/fonts'

export default function FontPicker() {
  const [fontId, setFontId] = useState(() => getStoredFontId())

  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor="font-picker" className="text-xs font-semibold text-stone-500">
        Font
      </label>
      <select
        id="font-picker"
        value={fontId}
        onChange={(event) => {
          setFontId(event.target.value)
          void applyFont(event.target.value)
        }}
        className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      >
        {FONT_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}
