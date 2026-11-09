// FR-012 roster image, FR-018 layout: avatar circles with names in three columns, separate Playing and Waitlist sections.
import { avatarColour, initials } from './avatar-core.js'

const C = { ink: '#14382b', muted: '#647269', lime: '#d9f280', ball: '#d9f24a', amber: '#8a5a00',
  openRing: '#9fb3a7', openFill: '#f4f8f5', openText: '#4c6b5b', openName: '#8a978f', divider: '#d9dfd6' }
// Fonts match the app (--display and --body in styles.css); loaded by index.html from Google Fonts.
const BRAND_FONT = "'Bricolage Grotesque', 'Figtree', system-ui, sans-serif"
const BODY_FONT = "'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** Make sure the app fonts are ready before drawing; falls back silently if it can't load in time. */
async function loadBrandFont(timeoutMs = 3000) {
  if (typeof document === 'undefined' || !document.fonts?.load) return
  try {
    const faces = ["800 36px 'Bricolage Grotesque'", "400 24px 'Figtree'", "600 24px 'Figtree'", "700 24px 'Figtree'"]
    await Promise.race([Promise.all(faces.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, timeoutMs))])
  } catch { /* fall back to Figtree / system font */ }
}

const WIDTH = 900, LEFT = 48, RIGHT = 852, CONTENT = RIGHT - LEFT, COLS = 3, COL_GAP = 18
const CELL_W = (CONTENT - COL_GAP * (COLS - 1)) / COLS
const AV = 68, NAME_X = AV + 18, NAME_W = CELL_W - NAME_X, NAME_SIZE = 25, NAME_LINE = 30
const ROW_H = 84, ROW_GAP = 12, MAX_HEIGHT = 16000
const TOO_LARGE = 'This roster is too large for one image. Use the game link instead; no names have been omitted.'

/** Accepts plain names (older callers) or { name, userId, photo } entries. */
function entry(value) {
  if (value && typeof value === 'object') return { name: String(value.name ?? ''), userId: value.userId ?? null, photo: value.photo ?? null }
  return { name: String(value ?? ''), userId: null, photo: null }
}

const rowsFor = n => Math.ceil(n / COLS)
const sectionHeight = n => n ? rowsFor(n) * ROW_H + (rowsFor(n) - 1) * ROW_GAP : 0

/** Pure layout: every playing place (filled or open) and exactly the waitlisted players, three per row. */
export function rosterLayout(capacity, playing, waitlist) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200 || playing.length > capacity) throw new Error('Invalid playing capacity.')
  const playingCells = Array.from({ length: capacity }, (_, i) =>
    i < playing.length ? { number: i + 1, label: String(i + 1), open: false, waiting: false, ...entry(playing[i]) }
      : { number: i + 1, label: `#${i + 1}`, open: true, waiting: false, name: null, userId: null, photo: null })
  const waitlistCells = waitlist.map((w, i) => ({ number: i + 1, label: `WL${i + 1}`, open: false, waiting: true, ...entry(w) }))
  const playingRows = rowsFor(playingCells.length), waitlistRows = rowsFor(waitlistCells.length)
  // Estimate with a one-line title/date/time/location header; the renderer recomputes with real text sizes.
  const height = 330 + 74 + sectionHeight(playingCells.length) + (waitlistCells.length ? 130 + sectionHeight(waitlistCells.length) : 0) + 200
  if (height > MAX_HEIGHT) throw new Error(TOO_LARGE)
  return { width: WIDTH, height, columns: COLS, rows: playingRows + waitlistRows, playingRows, waitlistRows,
    playing: playingCells, waitlist: waitlistCells, showWaitlist: waitlistCells.length > 0 }
}

/** Word-aware wrapping; a single word wider than the line is broken by character. */
function lines(ctx, value, width) {
  const fits = s => ctx.measureText(s).width <= width
  const result = []; let current = ''
  for (const word of String(value).split(/\s+/).filter(Boolean)) {
    const joined = current ? `${current} ${word}` : word
    if (fits(joined)) { current = joined; continue }
    if (current) { result.push(current); current = '' }
    if (fits(word)) { current = word; continue }
    for (const char of Array.from(word)) {
      if (current && !fits(current + char)) { result.push(current); current = '' }
      current += char
    }
  }
  if (current) result.push(current)
  return result.length ? result : ['']
}

/** Wrap to at most `max` lines; shorten the last with an ellipsis rather than dropping the name. */
function clamp(ctx, value, width, max) {
  const all = lines(ctx, value, width)
  if (all.length <= max) return all
  const kept = all.slice(0, max)
  let last = kept[max - 1]
  while (last && ctx.measureText(last + '…').width > width) last = Array.from(last).slice(0, -1).join('')
  kept[max - 1] = last + '…'
  return kept
}

export async function renderRosterImage(model, makeCanvas = () => document.createElement('canvas')) {
  const layout = rosterLayout(model.capacity, model.playing, model.waitlist)
  const canvas = makeCanvas(), ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image generation is unavailable in this browser.')
  await loadBrandFont()
  const setFont = (size, weight = 400, family = BODY_FONT) => { ctx.font = `${weight} ${size}px ${family}` }
  const wrap = (value, size, width, weight = 400, family = BODY_FONT) => { setFont(size, weight, family); return lines(ctx, value, width) }
  const title = wrap(model.title, 44, CONTENT, 800, BRAND_FONT)
  const date = wrap(model.date, 29, CONTENT, 600)
  const time = wrap(model.time, 27, CONTENT)
  const location = wrap(model.location || 'Location not specified', 25, CONTENT)
  const dateTop = 156 + (title.length - 1) * 51
  const timeTop = dateTop + date.length * 36 + 8
  const locationTop = timeTop + time.length * 34 + 7
  const headerBottom = locationTop + location.length * 32 + 37
  const playingTop = headerBottom + 80
  const playingEnd = playingTop + sectionHeight(layout.playing.length)
  const waitHeadTop = playingEnd + 58
  const waitTop = waitHeadTop + 58
  const gridEnd = layout.showWaitlist ? waitTop + sectionHeight(layout.waitlist.length) : playingEnd
  const snapshot = wrap(`Snapshot: ${model.snapshot}`, 24, CONTENT, 600)
  const latest = wrap('Open the game link for the latest list and to join or withdraw.', 24, CONTENT)
  const note = wrap('Signup order runs left to right. This image does not update.', 23, CONTENT)
  const snapshotTop = gridEnd + 50
  const latestTop = snapshotTop + snapshot.length * 31 + 8
  const noteTop = latestTop + latest.length * 31 + 6
  const height = noteTop + note.length * 30 + 47
  if (height > MAX_HEIGHT) throw new Error(TOO_LARGE)
  canvas.width = WIDTH; canvas.height = height; ctx.textBaseline = 'top'

  const rect = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
  const text = (value, x, y, size, fill = C.ink, weight = 400, family = BODY_FONT) => {
    setFont(size, weight, family); ctx.fillStyle = fill; ctx.fillText(String(value), x, y)
  }
  const width = (value, size, weight = 400, family = BODY_FONT) => { setFont(size, weight, family); return ctx.measureText(String(value)).width }
  const centred = (value, cx, y, size, fill, weight) => text(value, cx - width(value, size, weight) / 2, y, size, fill, weight)
  const drawLines = (parts, x, y, size, fill = C.ink, weight = 400, step = size + 7, family = BODY_FONT) => {
    parts.forEach((part, i) => text(part, x, y + i * step, size, fill, weight, family))
  }
  const circle = (cx, cy, r, fill, stroke, lineWidth = 0, dash = null) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath()
    if (fill) { ctx.fillStyle = fill; ctx.fill() }
    if (stroke) {
      ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke
      if (dash && ctx.setLineDash) ctx.setLineDash(dash)
      ctx.stroke()
      if (dash && ctx.setLineDash) ctx.setLineDash([])
    }
  }
  const pill = (x, y, w, h, fill, border) => {
    const r = h / 2
    ctx.beginPath()
    ctx.arc(x + r, y + r, r + 2, Math.PI / 2, Math.PI * 1.5); ctx.arc(x + w - r, y + r, r + 2, Math.PI * 1.5, Math.PI / 2); ctx.closePath()
    ctx.fillStyle = border; ctx.fill()
    ctx.beginPath()
    ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); ctx.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI / 2); ctx.closePath()
    ctx.fillStyle = fill; ctx.fill()
  }
  const ballIcon = (x, y, size) => {
    const s = size / 32
    circle(x + 16 * s, y + 16 * s, 15 * s, C.ball)
    for (const [cx, cy, r] of [[11, 11, 2], [20, 9.5, 2], [16, 16, 2], [10, 20, 2], [21.5, 19.5, 2], [15.5, 24, 1.6]]) circle(x + cx * s, y + cy * s, r * s, C.ink)
  }

  const drawCell = (cell, x, y) => {
    const cx = x + AV / 2, cy = y + ROW_H / 2
    const ay = cy - AV / 2
    if (cell.open) {
      circle(cx, cy, AV / 2 - 1.5, C.openFill, C.openRing, 3, [7, 5])
      centred(cell.label, cx, cy - 11, 21, C.openText, 700)
      text('Open', x + NAME_X, cy - 13, 22, C.openName)
      return
    }
    let drewPhoto = false
    if (cell.photo) {
      try {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, AV / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
        ctx.drawImage(cell.photo, x, ay, AV, AV); drewPhoto = true
      } catch { drewPhoto = false } finally { ctx.restore() }
    }
    if (!drewPhoto) {
      circle(cx, cy, AV / 2, avatarColour(cell.userId ?? cell.name))
      centred(initials(cell.name), cx, cy - 13, 25, '#ffffff', 700)
    }
    const badgeW = Math.max(30, width(cell.label, 15, 700) + 14), badgeH = 24
    const bx = x + AV + 4 - badgeW, by = ay + AV - badgeH + 4
    pill(bx, by, badgeW, badgeH, cell.waiting ? C.amber : C.ink, '#ffffff')
    centred(cell.label, bx + badgeW / 2, by + 4, 15, cell.waiting ? '#ffffff' : C.lime, 700)
    setFont(NAME_SIZE, 600)
    const name = clamp(ctx, cell.name || 'Player', NAME_W, 2)
    drawLines(name, x + NAME_X, cy - (name.length * NAME_LINE) / 2 + 1, NAME_SIZE, C.ink, 600, NAME_LINE)
  }
  const drawGrid = (cells, top) => cells.forEach((cell, i) =>
    drawCell(cell, LEFT + (i % COLS) * (CELL_W + COL_GAP), top + Math.floor(i / COLS) * (ROW_H + ROW_GAP)))

  rect(0, 0, WIDTH, height, '#f4f1e8')
  rect(20, 24, WIDTH - 40, height - 48, '#ffffff')
  rect(20, 24, WIDTH - 40, headerBottom - 24, C.ink)
  ballIcon(LEFT, 40, 42)
  // Same wordmark as the app header: Bricolage Grotesque 800, "Pickle" in white, "Me" in ball lime.
  if ('letterSpacing' in ctx) ctx.letterSpacing = '-0.72px'
  text('Pickle', LEFT + 54, 42, 36, '#ffffff', 800, BRAND_FONT)
  text('Me', LEFT + 54 + width('Pickle', 36, 800, BRAND_FONT), 42, 36, C.ball, 800, BRAND_FONT)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  drawLines(title, LEFT, 94, 44, '#ffffff', 800, 51, BRAND_FONT)
  drawLines(date, LEFT, dateTop, 29, '#ffffff', 600)
  drawLines(time, LEFT, timeTop, 27, '#ffffff')
  drawLines(location, LEFT, locationTop, 25, '#ffffff')

  const free = model.capacity - model.playing.length
  text(`PLAYING  ${model.playing.length} / ${model.capacity}`, LEFT, headerBottom + 24, 31, C.ink, 800, BRAND_FONT)
  const status = free ? `${free} ${free === 1 ? 'place' : 'places'} open` : 'Full'
  text(status, RIGHT - width(status, 25), headerBottom + 29, 25, C.muted)
  drawGrid(layout.playing, playingTop)

  if (layout.showWaitlist) {
    rect(LEFT, playingEnd + 28, CONTENT, 2, C.divider)
    text(`WAITLIST  ${model.waitlist.length}`, LEFT, waitHeadTop, 31, C.amber, 800, BRAND_FONT)
    const hint = 'In order — first in line gets the next place'
    text(hint, RIGHT - width(hint, 22), waitHeadTop + 7, 22, C.muted)
    drawGrid(layout.waitlist, waitTop)
  }

  rect(LEFT, gridEnd + 27, CONTENT, 2, C.divider)
  drawLines(snapshot, LEFT, snapshotTop, 24, C.muted, 600)
  drawLines(latest, LEFT, latestTop, 24)
  drawLines(note, LEFT, noteTop, 23, C.muted)
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob); else reject(new Error('Could not create the PNG. Please try again.'))
  }, 'image/png'))
}
