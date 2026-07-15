import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { useMascotFeed } from '../components/mascot/useMascotFeed'
import Mascot from '../components/mascot/Mascot'
import type { MascotNotification } from '../components/mascot/MascotBubble'

type ToastFn = (title: string, subtitle?: string) => void

const MascotToastContext = createContext<ToastFn | null>(null)

export function MascotToastProvider({ children }: { children: ReactNode }) {
  const { current, dequeue, enqueue, history, unread, markAllRead } = useMascotFeed()

  const toast = useCallback<ToastFn>((title, subtitle = '') => {
    const notification: MascotNotification = {
      id: `local-${crypto.randomUUID()}`,
      type: 'notification',
      title,
      subtitle,
      link: '',
    }
    enqueue(notification)
  }, [enqueue])

  return (
    <MascotToastContext.Provider value={toast}>
      {children}
      <Mascot
        current={current}
        dequeue={dequeue}
        history={history}
        unread={unread}
        markAllRead={markAllRead}
      />
    </MascotToastContext.Provider>
  )
}

export function useMascotToast(): ToastFn {
  const toast = useContext(MascotToastContext)
  if (!toast) {
    throw new Error('useMascotToast must be used within MascotToastProvider')
  }
  return toast
}
