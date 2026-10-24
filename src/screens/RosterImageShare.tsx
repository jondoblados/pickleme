import { useEffect, useRef, useState } from 'react'
import { api, isOrganiser } from '../lib/api'
import { APP_URL } from '../lib/supabase'
import { fmtRange } from '../lib/time'
import { friendlyError } from '../lib/errors'
import { renderRosterImage } from '../lib/roster-image.js'
import { copyText } from '../lib/clipboard'
import { Notice } from '../components/ui'

type Prepared = { file: File; url: string; caption: string; snapshot: string }
export function RosterImageShare({ gameId }: { gameId: string }) {
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const imageUrl = useRef<string | null>(null)
  const request = useRef(0)
  useEffect(() => () => {
    request.current++
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
  }, [gameId])
  function clear() {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    imageUrl.current = null; setPrepared(null)
  }
  async function generate() {
    const id = ++request.current
    clear(); setBusy(true); setError(''); setNotice('')
    try {
      const d = await api.getGame(gameId)
      if (!isOrganiser(d.my_role)) throw new Error('Only this group’s organisers and admins can generate roster images.')
      const tz = d.group.timezone
      const date = new Intl.DateTimeFormat('en-SG', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d.game.starts_at))
      const snapshot = new Intl.DateTimeFormat('en-SG', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) + ` (${tz})`
      const playing = d.roster.filter(r => r.status === 'playing').sort((a,b) => a.position - b.position).map(r => r.display_name)
      const waitlist = d.roster.filter(r => r.status === 'waitlist').sort((a,b) => a.position - b.position).map(r => r.display_name)
      const title = d.game.status === 'cancelled' ? `CANCELLED: ${d.game.title}` : d.game.status === 'closed' ? `REGISTRATION CLOSED: ${d.game.title}` : d.game.title
      const time = `${fmtRange(d.game.starts_at, d.game.ends_at, tz)} (${tz})`
      const blob = await renderRosterImage({ title, date, time, location: d.game.location, capacity: d.game.capacity, playing, waitlist, snapshot })
      if (request.current !== id) return
      const file = new File([blob], `pickleme-roster-${d.game.id}.png`, { type: 'image/png' })
      const url = URL.createObjectURL(file); imageUrl.current = url
      const link = `${APP_URL}?game=${d.game.id}`
      const caption = `${title}\n${date}\n${time}\n${d.game.location}\nPlaying: ${playing.length}/${d.game.capacity} · Waitlist: ${waitlist.length}\nSnapshot: ${snapshot}\n\nLatest list, join or withdraw:\n${link}\n\nThis image is a snapshot and does not update.`
      setPrepared({ file, url, caption, snapshot })
    } catch (e) {
      if (request.current === id) setError(e instanceof Error ? e.message : friendlyError(e))
    } finally { if (request.current === id) setBusy(false) }
  }
  const canShare = !!prepared && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [prepared.file] })
  async function share() {
    if (!prepared) return
    setBusy(true); setError(''); setNotice('')
    try {
      await navigator.share({ files: [prepared.file], text: prepared.caption, title: 'PickleMe game roster' })
      setNotice('Share sheet closed. Check the destination chat; some apps omit the caption. You can copy it below.')
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError('Sharing did not complete. Download the image and copy the caption instead.')
    } finally { setBusy(false) }
  }
  return <section className="share card stack" aria-label="Share roster image">
    <h2>Share roster image</h2>
    <p>Preview a fresh Playing and Waitlist snapshot before sharing it in WhatsApp.</p>
    <p className="small muted">Organisers and admins only. Display names will be visible to recipients and the image can be forwarded. Attendance and email addresses are not included. Images are generated on this device, not published to a public image URL.</p>
    <div className="row wrap"><button className="btn btn-primary" disabled={busy} onClick={generate}>{busy ? 'Working…' : prepared ? 'Refresh image from latest roster' : 'Generate roster preview'}</button></div>
    {error && <Notice tone="error">{error}</Notice>}
    {notice && <p role="status">{notice}</p>}
    {prepared && <>
      <p className="small muted">Snapshot: {prepared.snapshot}. This prepared image will not update automatically.</p>
      <img src={prepared.url} alt="Game roster snapshot with numbered Playing and Waitlist grids" style={{ width: '100%', maxWidth: 600, height: 'auto', display: 'block' }}/>
      <div className="row wrap">
        {canShare && <button className="btn btn-whatsapp" disabled={busy} onClick={share}>Share prepared image…</button>}
        <a className="btn" href={prepared.url} download={prepared.file.name}>Download PNG</a>
        <button className="btn" disabled={busy} onClick={async () => {
          try { setNotice(await copyText(prepared.caption) ? 'Caption and game link copied.' : 'Could not copy. Select the caption below instead.') }
          catch { setNotice('Could not copy. Select the caption below instead.') }
        }}>Copy caption & game link</button>
      </div>
      {!canShare && <p className="small muted">File sharing is unavailable here. Download the PNG, attach it in WhatsApp, and paste the caption.</p>}
      <label className="field"><span>Caption with clickable game link</span><textarea readOnly rows={8} value={prepared.caption}/></label>
    </>}
  </section>
}
