import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RootRoute } from './App'

const auth = vi.hoisted(() => ({
  value: { user: null as { id: string } | null, loading: false },
}))

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => auth.value,
}))

vi.mock('./pages/EarlyAccess', () => ({ default: () => <div>Public landing</div> }))

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/home" element={<div>Signed-in home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RootRoute', () => {
  beforeEach(() => {
    auth.value = { user: null, loading: false }
  })

  it('redirects a restored authenticated session to home', () => {
    auth.value = { user: { id: 'member-1' }, loading: false }

    renderRoot()

    expect(screen.getByText('Signed-in home')).toBeInTheDocument()
  })

  it('keeps anonymous visitors on the public landing page', () => {
    renderRoot()

    expect(screen.getByText('Public landing')).toBeInTheDocument()
  })

  it('waits for session restoration before choosing a root destination', () => {
    auth.value = { user: null, loading: true }

    renderRoot()

    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('Public landing')).not.toBeInTheDocument()
  })
})
