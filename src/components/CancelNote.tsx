import { useId, useState, type FormEvent } from 'react'
import type { Cancellation, CancelReasonCode } from '../lib/api'
import { CANCEL_REASONS, CANCEL_REASON_MAX, cancelNoteAuthor, checkCancelReason, presetText } from '../lib/cancel-reasons.js'
import { fmtShortDay, fmtTime } from '../lib/time'

function IconInfo() {
  return <svg className="cancel-note-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v6" /><circle cx="12" cy="7.6" r=".6" fill="currentColor" /></svg>
}

/** FR-019: the organiser's cancellation reason, shown to everyone as an information note. */
export function CancelNote({ cancellation, tz, canEdit, onEdit }: {
  cancellation: Cancellation | null | undefined; tz: string; canEdit: boolean; onEdit: () => void
}) {
  const c = cancellation
  const when = c?.note_at ?? c?.cancelled_at
  return (
    <section className="cancel-note" role="note" aria-label="Cancellation note">
      <IconInfo />
      <div className="cancel-note-body">
        <p className="cancel-note-title">Game cancelled</p>
        {c?.reason
          ? <>
              <p className="cancel-note-reason">{c.reason}</p>
              <p className="small cancel-note-by">
                — {cancelNoteAuthor(c)}{when && <> · {fmtShortDay(when, tz)}, {fmtTime(when, tz)}</>}{c.edited && ' · edited'}
              </p>
            </>
          : <p className="small cancel-note-by">No reason was given for this cancellation.</p>}
        {canEdit && <button type="button" className="link cancel-note-edit" onClick={onEdit}>{c?.reason ? 'Edit note' : 'Add a reason'}</button>}
      </div>
    </section>
  )
}

/** Pulldown of common reasons plus an editable note. Used to cancel a game and to edit the note later. */
export function CancelReasonForm({ mode, initial, busy, onSubmit, onClose }: {
  mode: 'cancel' | 'edit'
  initial?: Cancellation | null
  busy: boolean
  onSubmit: (code: CancelReasonCode, text: string) => void
  onClose: () => void
}) {
  const id = useId()
  const [code, setCode] = useState<CancelReasonCode | ''>(initial?.reason_code ?? '')
  const [text, setText] = useState(initial?.reason ?? '')
  const [touched, setTouched] = useState(false)
  const check = code ? checkCancelReason(code, text) : { ok: false as const, error: 'Choose a reason.' }
  const left = CANCEL_REASON_MAX - text.trim().length

  function submit(e: FormEvent) {
    e.preventDefault(); setTouched(true)
    if (check.ok && code) onSubmit(code, check.text)
  }
  return (
    <form className="cancel-form stack" onSubmit={submit} aria-label={mode === 'cancel' ? 'Cancel game' : 'Edit cancellation note'}>
      <p className="small">{mode === 'cancel'
        ? 'Players will see this note on the game page and in the games list. Cancelling is permanent.'
        : 'Players will see the updated note straight away.'}</p>
      <label className="field" htmlFor={`${id}-code`}>Reason
        <select id={`${id}-code`} value={code} required disabled={busy}
          onChange={e => { const next = e.target.value as CancelReasonCode; setCode(next); setText(t => presetText(next, t)) }}>
          <option value="" disabled>Choose a reason…</option>
          {CANCEL_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-text`}>Note to players
        <textarea id={`${id}-text`} rows={3} maxLength={CANCEL_REASON_MAX + 20} value={text} disabled={busy || !code}
          placeholder={code ? 'e.g. Heavy rain this evening — courts are wet. See you next week.' : 'Choose a reason first'}
          aria-describedby={`${id}-hint`} onChange={e => setText(e.target.value)} onBlur={() => setTouched(true)} />
        <small id={`${id}-hint`} className={left < 0 ? 'cancel-form-over' : 'muted'}>
          {touched && !check.ok ? check.error : `You can edit the text. ${left} characters left.`}
        </small>
      </label>
      <div className="row wrap">
        <button type="submit" className={mode === 'cancel' ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy || !check.ok}>
          {busy ? 'Saving…' : mode === 'cancel' ? 'Cancel game' : 'Save note'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{mode === 'cancel' ? 'Keep game' : 'Close'}</button>
      </div>
    </form>
  )
}
