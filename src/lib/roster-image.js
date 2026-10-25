const C = { ink: '#14382b', muted: '#647269', green: '#e5f1e8', lime: '#d9f280' }
const WIDTH = 900, LEFT = 48, RIGHT = 852, CONTENT = RIGHT - LEFT, COLS = 3, GAP = 10
export function rosterLayout(capacity, playing, waitlist) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200 || playing.length > capacity) throw new Error('Invalid playing capacity.')
  const cells = (names, count, waiting) => Array.from({ length: count }, (_, i) => ({ number: i + 1, name: names[i] ?? null, waiting }))
  const playingCells = cells(playing, capacity, false)
  const waitingCells = cells(waitlist, Math.max(8, waitlist.length), true)
  const combined = [...playingCells, ...waitingCells]
  const rows = Math.ceil(combined.length / COLS)
  const height = 584 + rows * 92
  if (height > 16000) throw new Error('This roster is too large for one image. Use the game link instead; no names have been omitted.')
  return { width: WIDTH, height, columns: COLS, rows, cells: combined, playing: playingCells, waitlist: waitingCells }
}
function lines(ctx, value, width) {
  const result = []; let current = ''
  for (const char of Array.from(String(value))) {
    if (current && ctx.measureText(current + char).width > width) { result.push(current); current = '' }
    current += char
  }
  if (current) result.push(current)
  return result.length ? result : ['']
}
export async function renderRosterImage(model, makeCanvas = () => document.createElement('canvas')) {
  const layout = rosterLayout(model.capacity, model.playing, model.waitlist)
  const canvas = makeCanvas(), ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image generation is unavailable in this browser.')
  const setFont = (size, weight = 400) => { ctx.font = `${weight} ${size}px system-ui, sans-serif` }
  const wrap = (value, size, width, weight = 400) => { setFont(size, weight); return lines(ctx, value, width) }
  const title = wrap(model.title, 44, CONTENT, 700)
  const date = wrap(model.date, 29, CONTENT, 600)
  const time = wrap(model.time, 27, CONTENT)
  const location = wrap(model.location || 'Location not specified', 25, CONTENT)
  const dateTop = 156 + (title.length - 1) * 51
  const timeTop = dateTop + date.length * 36 + 8
  const locationTop = timeTop + time.length * 34 + 7
  const headerBottom = locationTop + location.length * 32 + 37
  const gridTop = headerBottom + 74
  const cellWidth = (CONTENT - GAP * (COLS - 1)) / COLS
  const rows = []
  for (let i = 0; i < layout.cells.length; i += COLS) {
    const cells = layout.cells.slice(i, i + COLS).map(cell => ({ ...cell,
      label: wrap(cell.name ?? (cell.waiting ? '—' : 'Available'), 26, cellWidth - 26, cell.name !== null ? 600 : 400) }))
    rows.push({ cells, height: Math.max(82, ...cells.map(cell => 74 + (cell.label.length - 1) * 33)) })
  }
  const gridEnd = gridTop + rows.reduce((sum, row) => sum + row.height + GAP, 0)
  const snapshot = wrap(`Snapshot: ${model.snapshot}`, 24, CONTENT, 600)
  const latest = wrap('Open the game link for the latest list and to join or withdraw.', 24, CONTENT)
  const note = wrap('Signup order runs left to right. This image does not update.', 23, CONTENT)
  const snapshotTop = gridEnd + 46
  const latestTop = snapshotTop + snapshot.length * 31 + 8
  const noteTop = latestTop + latest.length * 31 + 6
  const height = noteTop + note.length * 30 + 47
  if (height > 16000) throw new Error('This roster is too large for one image. Use the game link instead; no names have been omitted.')
  canvas.width = WIDTH; canvas.height = height; ctx.textBaseline = 'top'
  const rect = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
  const text = (value, x, y, size, fill = C.ink, weight = 400) => {
    setFont(size, weight); ctx.fillStyle = fill; ctx.fillText(String(value), x, y)
  }
  const drawLines = (parts, x, y, size, fill = C.ink, weight = 400) => {
    parts.forEach((part, i) => text(part, x, y + i * (size + 7), size, fill, weight))
  }
  rect(0, 0, WIDTH, height, '#f4f1e8')
  rect(20, 24, WIDTH - 40, height - 48, '#ffffff')
  rect(20, 24, WIDTH - 40, headerBottom - 24, C.ink)
  text('PickleMe', LEFT, 43, 36, C.lime, 700)
  drawLines(title, LEFT, 94, 44, '#ffffff', 700)
  drawLines(date, LEFT, dateTop, 29, '#ffffff', 600)
  drawLines(time, LEFT, timeTop, 27, '#ffffff')
  drawLines(location, LEFT, locationTop, 25, '#ffffff')
  text(`PLAYING  ${model.playing.length} / ${model.capacity}`, LEFT, headerBottom + 22, 31, C.ink, 700)
  const waitHeading = `WAITLIST  ${model.waitlist.length}`
  setFont(25); text(waitHeading, RIGHT - ctx.measureText(waitHeading).width, headerBottom + 27, 25, C.muted)
  let y = gridTop
  for (const row of rows) {
    row.cells.forEach((cell, column) => {
      const x = LEFT + column * (cellWidth + GAP)
      rect(x, y, cellWidth, row.height, cell.waiting ? '#faf8f1' : cell.name !== null ? C.green : '#f6f7f2')
      text(cell.waiting ? `W${cell.number} · Waitlist` : String(cell.number), x + 13, y + 6, 22, C.muted, 600)
      drawLines(cell.label, x + 13, y + 34, 26, cell.name !== null ? C.ink : C.muted, cell.name !== null ? 600 : 400)
    })
    y += row.height + GAP
  }
  rect(LEFT, gridEnd + 27, CONTENT, 2, '#d9dfd6')
  drawLines(snapshot, LEFT, snapshotTop, 24, C.muted, 600)
  drawLines(latest, LEFT, latestTop, 24)
  drawLines(note, LEFT, noteTop, 23, C.muted)
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob); else reject(new Error('Could not create the PNG. Please try again.'))
  }, 'image/png'))
}
