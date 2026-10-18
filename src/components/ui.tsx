import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type Toast = { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, text, tone }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 6000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

/** Button that needs a second tap within 4 seconds to confirm a destructive action. */
export function ConfirmButton({ onConfirm, children, confirmText = 'Tap again to confirm', className = 'btn btn-ghost', disabled }:
  { onConfirm: () => void; children: ReactNode; confirmText?: string; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button type="button" disabled={disabled} className={`${className}${armed ? ' is-armed' : ''}`}
      onClick={() => {
        if (armed) { window.clearTimeout(timer.current); setArmed(false); onConfirm(); return }
        setArmed(true); timer.current = window.setTimeout(() => setArmed(false), 4000)
      }}>
      {armed ? confirmText : children}
    </button>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner-wrap" aria-busy="true"><span className="spinner" aria-hidden="true" /><span className="sr-only">{label}</span></div>
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div>
}
