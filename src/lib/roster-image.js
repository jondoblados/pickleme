const C = { ink: '#14382b', muted: '#647269', green: '#e5f1e8', lime: '#d9f280' }
export function rosterLayout(capacity, playing, waitlist) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200 || playing.length > capacity) throw new Error('Invalid playing capacity.')
  const cells = (names, count) => Array.from({ length: count }, (_, i) => ({ number: i + 1, name: names[i] ?? null }))
  const playingRows = Math.ceil(capacity / 4)
  const waitlistRows = Math.max(2, Math.ceil(waitlist.length / 4))
  const height = 630 + playingRows * 92 + waitlistRows * 77
  if (height > 16000) throw new Error('This roster is too large for one image. Use the game link instead; no names have been omitted.')
  return { width: 1100, height, playing: cells(playing, capacity), waitlist: cells(waitlist, waitlistRows * 4), playingRows, waitlistRows }
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
  const canvas = makeCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image generation is unavailable in this browser.')
  const setFont = (size, weight = 400) => { ctx.font = `${weight} ${size}px system-ui, sans-serif` }
  const wrap = (value, size, width, weight = 400) => { setFont(size, weight); return lines(ctx, value, width) }
  const title = wrap(model.title, 44, 984, 700)
  const date = wrap(model.date, 29, 984, 600)
  const time = wrap(model.time, 27, 984)
  const location = wrap(model.location || 'Location not specified', 25, 984)
  const dateTop = 156 + (title.length - 1) * 51
  const timeTop = dateTop + date.length * 36 + 8
  const locationTop = timeTop + time.length * 34 + 7
  const headerBottom = locationTop + location.length * 32 + 37
  const gridTop = headerBottom + 74
  const cellWidth = 238.5
  const measureRows = (cells, waiting) => {
    const rows = []
    for (let i = 0; i < cells.length; i += 4) {
      const row = cells.slice(i, i + 4).map(cell => ({ ...cell,
        label: wrap(cell.name ?? (waiting ? '—' : 'Available'), 26, cellWidth - 26, cell.name !== null ? 600 : 400) }))
      const nameTop = waiting ? 30 : 34
      const height = Math.max(waiting ? 67 : 82, ...row.map(cell => nameTop + 26 + (cell.label.length - 1) * 33 + (waiting ? 11 : 14)))
      rows.push({ cells: row, height, nameTop })
    }
    return rows
  }
  const playingRows = measureRows(layout.playing, false)
  const waitingRows = measureRows(layout.waitlist, true)
  const playingEnd = gridTop + playingRows.reduce((sum, row) => sum + row.height + 10, 0)
  const waitTop = playingEnd + 64
  const waitEnd = waitTop + waitingRows.reduce((sum, row) => sum + row.height + 10, 0)
  const snapshot = wrap(`Snapshot: ${model.snapshot}`, 24, 984, 600)
  const latest = wrap('Open the game link for the latest list and to join or withdraw.', 24, 984)
  const note = wrap('Signup order runs left to right. This image does not update.', 23, 984)
  const snapshotTop = waitEnd + 31
  const latestTop = snapshotTop + snapshot.length * 31 + 8
  const noteTop = latestTop + latest.length * 31 + 6
  const height = noteTop + note.length * 30 + 45
  if (height > 16000) throw new Error('This roster is too large for one image. Use the game link instead; no names have been omitted.')
  canvas.width = layout.width; canvas.height = height
  ctx.textBaseline = 'top'
  const rect = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
  const text = (value, x, y, size, fill = C.ink, weight = 400) => {
    setFont(size, weight); ctx.fillStyle = fill; ctx.fillText(String(value), x, y)
  }
  const drawLines = (parts, x, y, size, fill = C.ink, weight = 400) => {
    parts.forEach((part, i) => text(part, x, y + i * (size + 7), size, fill, weight))
  }
  const rightText = (value, y, size) => { setFont(size); text(value, 1042 - ctx.measureText(value).width, y, size, C.muted) }
  rect(0, 0, canvas.width, canvas.height, '#f4f1e8')
  rect(24, 24, 1052, canvas.height - 48, '#ffffff')
  rect(24, 24, 1052, headerBottom - 24, C.ink)
  text('PickleMe', 58, 43, 36, C.lime, 700)
  drawLines(title, 58, 94, 44, '#ffffff', 700)
  drawLines(date, 58, dateTop, 29, '#ffffff', 600)
  drawLines(time, 58, timeTop, 27, '#ffffff')
  drawLines(location, 58, locationTop, 25, '#ffffff')
  text(`PLAYING  ${model.playing.length} / ${model.capacity}`, 58, headerBottom + 22, 31, C.ink, 700)
  rightText(`${model.capacity - model.playing.length} places available`, headerBottom + 27, 25)
  const drawRows = (rows, top, waiting) => {
    let y = top
    for (const row of rows) {
      row.cells.forEach((cell, column) => {
        const x = 58 + column * (cellWidth + 10)
        rect(x, y, cellWidth, row.height, cell.name !== null ? C.green : waiting ? '#faf8f1' : '#f6f7f2')
        text(`${waiting ? 'W' : ''}${cell.number}`, x + 13, y + (waiting ? 5 : 6), 22, C.muted, 600)
        drawLines(cell.label, x + 13, y + row.nameTop, 26, cell.name !== null ? C.ink : C.muted, cell.name !== null ? 600 : 400)
      })
      y += row.height + 10
    }
  }
  drawRows(playingRows, gridTop, false)
  text(`WAITLIST  ${model.waitlist.length}`, 58, playingEnd + 11, 31, C.ink, 700)
  if (!model.waitlist.length) rightText('Nobody waiting', playingEnd + 17, 25)
  drawRows(waitingRows, waitTop, true)
  rect(58, waitEnd + 13, 984, 2, '#d9dfd6')
  drawLines(snapshot, 58, snapshotTop, 24, C.muted, 600)
  drawLines(latest, 58, latestTop, 24)
  drawLines(note, 58, noteTop, 23, C.muted)
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob); else reject(new Error('Could not create the PNG. Please try again.'))
  }, 'image/png'))
}
