import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Megaphone, X, CaretDown, Lightning } from '@phosphor-icons/react'

export default function PostMenu() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  function handleSelect(path: string) {
    setOpen(false)
    navigate(path)
  }

  const options = [
    {
      icon: Eye,
      label: 'Report a sighting',
      description: 'I saw it',
      path: '/sightings/new',
    },
    {
      icon: Megaphone,
      label: 'Share a restock lead',
      description: 'I heard it\u2019s coming',
      path: '/leads/new',
    },
    {
      icon: Lightning,
      label: 'Post a bounty',
      description: 'Help me find it',
      path: '/bounties/new',
    },
  ]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Post"
        className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
      >
        Post
        <CaretDown aria-hidden="true" size={14} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Post menu"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-stone-200 bg-white p-4 shadow-xl sm:absolute sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-72 sm:rounded-2xl sm:border sm:p-2"
          >
            <div className="mb-3 flex items-center justify-between sm:hidden">
              <h2 className="text-lg font-bold text-stone-900">Post</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X size={20} weight="bold" />
              </button>
            </div>
            <ul className="space-y-1">
              {options.map((opt) => (
                <li key={opt.path}>
                  <button
                    type="button"
                    onClick={() => handleSelect(opt.path)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:py-2.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                      <opt.icon aria-hidden="true" size={18} weight="bold" />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-bold text-stone-900">{opt.label}</span>
                      <span className="text-xs text-stone-500">{opt.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  )
}
