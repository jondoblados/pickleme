import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Avatar } from '../components/Avatar'
import { ConfirmButton, Notice, useToast } from '../components/ui'
import { AvatarError, decodeImage, removeAvatar, renderAvatar, saveAvatar } from '../lib/avatar'
import { clampOffset, cropRect } from '../lib/avatar-core.js'
import { friendlyError } from '../lib/errors'

const VIEW = 240

/** FR-016: add, change or remove your profile photo. Visible only to people in your groups. */
export function ProfilePhoto({ userId, name, path, onChanged }:
  { userId: string; name: string | null; path: string | null; onChanged: () => void | Promise<void> }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [img, setImg] = useState<ImageBitmap | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ ox: 0, oy: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function centre(bmp: ImageBitmap, z: number) {
    const scale = (VIEW / Math.min(bmp.width, bmp.height)) * z
    return clampOffset(bmp.width, bmp.height, VIEW, z, (VIEW - bmp.width * scale) / 2, (VIEW - bmp.height * scale) / 2)
  }

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const bmp = await decodeImage(file)
      // Preview from a re-encoded copy so orientation matches what will be saved.
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height
      c.getContext('2d')!.drawImage(bmp, 0, 0)
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9))
      if (!blob) throw new AvatarError("This photo couldn't be read. Try a JPEG or PNG, or take a screenshot of it.")
      setImg(bmp); setZoom(1); setOff(centre(bmp, 1)); setPreview(URL.createObjectURL(blob))
    } catch (e) { setError(e instanceof AvatarError ? e.message : friendlyError(e)) }
    if (input.current) input.current.value = ''
  }

  function cancel() { setImg(null); setPreview(null); setError(null) }

  function onZoom(z: number) {
    if (!img) return
    // Zoom around the centre of the viewport.
    const before = cropRect(img.width, img.height, VIEW, zoom, off.ox, off.oy)
    const cx = before.x + before.size / 2, cy = before.y + before.size / 2
    const scale = (VIEW / Math.min(img.width, img.height)) * z
    setZoom(z); setOff(clampOffset(img.width, img.height, VIEW, z, VIEW / 2 - cx * scale, VIEW / 2 - cy * scale))
  }
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ...off }
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || !img) return
    const d = drag.current
    setOff(clampOffset(img.width, img.height, VIEW, zoom, d.ox + e.clientX - d.x, d.oy + e.clientY - d.y))
  }
  function nudge(dx: number, dy: number) { if (img) setOff(clampOffset(img.width, img.height, VIEW, zoom, off.ox + dx, off.oy + dy)) }

  async function save() {
    if (!img) return
    setBusy(true); setError(null)
    try {
      await saveAvatar(userId, await renderAvatar(img, cropRect(img.width, img.height, VIEW, zoom, off.ox, off.oy)))
      cancel(); await onChanged(); toast('Photo updated.')
    } catch (e) { setError(e instanceof AvatarError ? e.message : friendlyError(e)) }
    setBusy(false)
  }
  async function remove() {
    setBusy(true); setError(null)
    try { await removeAvatar(); await onChanged(); toast('Photo removed.') }
    catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  const scale = img ? (VIEW / Math.min(img.width, img.height)) * zoom : 1
  return (
    <div className="card stack profile-photo">
      <h2>Profile photo</h2>
      {!img ? <>
        <div className="row photo-row">
          <Avatar userId={userId} name={name} path={path} size={88} />
          <div className="stack photo-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>{path ? 'Change photo' : 'Add photo'}</button>
            {path && <ConfirmButton className="btn btn-ghost" confirmText="Remove photo?" disabled={busy} onConfirm={remove}>Remove photo</ConfirmButton>}
          </div>
        </div>
        <p className="small muted">Only people in your groups can see your photo. Without one, they see your initials.</p>
      </> : <>
        <p className="small muted">Drag to position, and use the slider to zoom.</p>
        <div className="crop-view" style={{ width: VIEW, height: VIEW }} role="img" aria-label="Photo crop preview"
          tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
          onKeyDown={e => { const k = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key]; if (k) { e.preventDefault(); nudge(k[0], k[1]) } }}>
          {preview && <img src={preview} alt="" draggable={false}
            style={{ width: img.width * scale, height: img.height * scale, transform: `translate(${off.ox}px, ${off.oy}px)` }} />}
        </div>
        <label className="field"><span>Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={e => onZoom(Number(e.target.value))} /></label>
        <div className="row wrap">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save photo'}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      </>}
      <input ref={input} type="file" accept="image/*" hidden onChange={e => void pick(e.target.files?.[0])} />
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}
