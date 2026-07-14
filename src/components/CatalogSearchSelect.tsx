import { MagnifyingGlass, MapPin, Package, X } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { searchProducts, searchStores } from '../lib/launchApi'
import type { ProductSearchResult, StoreSearchResult } from '../types/database'

export type CatalogSelection = {
  id: string
  label: string
  detail: string
  slug?: string
}

type Props = {
  kind: 'product' | 'store'
  label: string
  value: CatalogSelection | null
  onChange: (value: CatalogSelection | null) => void
  onSuggest?: (query: string) => void
  required?: boolean
  disabled?: boolean
}

function toProductSelection(product: ProductSearchResult): CatalogSelection {
  return {
    id: product.id,
    slug: product.slug,
    label: product.name,
    detail: [product.trend_name, product.availability_status].filter(Boolean).join(' · '),
  }
}

function toStoreSelection(store: StoreSearchResult): CatalogSelection {
  return {
    id: store.id,
    slug: store.slug,
    label: store.store_name || store.retailer_name,
    detail: `${store.address_line1}, ${store.city}, ${store.state} ${store.zip_code}`,
  }
}

export default function CatalogSearchSelect({
  kind,
  label,
  value,
  onChange,
  onSuggest,
  required = false,
  disabled = false,
}: Props) {
  const inputId = useId()
  const requestNumber = useRef(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogSelection[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    if (value || query.trim().length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    const currentRequest = ++requestNumber.current
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      const response = kind === 'product'
        ? await searchProducts(query)
        : await searchStores(query)

      if (currentRequest !== requestNumber.current) return
      setLoading(false)
      if (response.error) {
        setResults([])
        setError(`Could not search ${kind === 'product' ? 'products' : 'locations'}.`)
        return
      }
      setError(null)
      setResults(
        kind === 'product'
          ? ((response.data ?? []) as ProductSearchResult[]).map(toProductSelection)
          : ((response.data ?? []) as StoreSearchResult[]).map(toStoreSelection),
      )
      setActiveIndex(-1)
      setOpen(true)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [kind, query, value])

  function select(result: CatalogSelection) {
    onChange(result)
    setQuery('')
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || query.trim().length < 2) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((prev) => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < results.length) {
        event.preventDefault()
        select(results[activeIndex])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
      setActiveIndex(-1)
    }
  }

  const statusMessage = loading
    ? 'Searching…'
    : error
      ? error
      : results.length === 0 && query.trim().length >= 2
        ? 'No matches found.'
        : ''

  return (
    <div className="relative">
      <label className="label" htmlFor={inputId}>
        {label}{required ? ' *' : ''}
      </label>

      {value ? (
        <div className="flex min-h-11 items-center gap-3 rounded-lg border border-gray-300 bg-white px-3.5 py-2">
          {kind === 'product'
            ? <Package aria-hidden="true" className="shrink-0 text-brand-600" size={20} weight="bold" />
            : <MapPin aria-hidden="true" className="shrink-0 text-brand-600" size={20} weight="fill" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">{value.label}</p>
            <p className="truncate text-xs text-gray-500">{value.detail}</p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label={`Clear selected ${kind}`}
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            <X aria-hidden="true" size={18} weight="bold" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <MagnifyingGlass
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={18}
            />
            <input
              id={inputId}
              className="input pl-10"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onKeyDown={handleKeyDown}
              placeholder={kind === 'product' ? 'Search products…' : 'Search stores and boutiques…'}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${inputId}-results`}
              aria-activedescendant={activeIndex >= 0 ? `${inputId}-opt-${activeIndex}` : undefined}
              required={required}
              disabled={disabled}
            />
          </div>

          <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>

          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="mt-1 text-xs text-gray-500">Type at least 2 characters.</p>
          )}

          {open && query.trim().length >= 2 && (
            <div
              id={`${inputId}-results`}
              role="listbox"
              className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-xl"
            >
              {loading && <p className="px-3 py-3 text-sm text-gray-500">Searching…</p>}
              {!loading && error && <p className="px-3 py-3 text-sm text-red-600">{error}</p>}
              {!loading && !error && results.map((result, index) => (
                <button
                  key={result.id}
                  id={`${inputId}-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex ? 'true' : 'false'}
                  className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-brand-50 focus:bg-brand-50 focus:outline-none ${index === activeIndex ? 'bg-brand-50' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(result)}
                >
                  <span className="block text-sm font-semibold text-gray-900">{result.label}</span>
                  <span className="block truncate text-xs text-gray-500">{result.detail}</span>
                </button>
              ))}
              {!loading && !error && results.length === 0 && (
                <p className="px-3 py-3 text-sm text-gray-500">No matches found.</p>
              )}
              {!loading && !error && onSuggest && (
                <button
                  type="button"
                  className="mt-1 block w-full rounded-lg border-t border-gray-100 px-3 py-2.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpen(false)
                    onSuggest(query.trim())
                  }}
                >
                  Can't find it? Suggest {kind === 'product' ? 'a product' : 'a location'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
