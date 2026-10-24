const C = { ink: '#14382b', muted: '#647269', green: '#e5f1e8', lime: '#d9f280', line: '#d9dfd6' }
export function rosterLayout(capacity, playing, waitlist) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200 || playing.length > capacity) throw new Error('Invalid playing capacity.')
  const cells = (names, count) => Array.from({ length: count }, (_, i) => ({ number: i + 1, name: names[i] ?? null }))
  const playingSlots = Math.ceil(capacity / 4) * 4
  const waitingSlots = Math.max(8, Math.ceil(waitlist.length / 4) * 4)
  const height = 780 + (playingSlots / 4 + waitingSlots / 4) * 154
  if (height > 16000) throw new Error('This roster is too large for one image. Use the game link instead; no names have been omitted.')
  return { width: 1200, height,
    playing: cells(playing, capacity), waitlist: cells(waitlist, waitingSlots),
    playingRows: playingSlots / 4, waitlistRows: waitingSlots / 4 }
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
  const canvas = makeCanvas(); canvas.width = layout.width; canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image generation is unavailable in this browser.')
  const rect = (x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h) }
  const text = (s, x, y, size = 28, fill = C.ink, weight = 400) => {
    ctx.fillStyle = fill; ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillText(String(s), x, y)
  }
  const wrap = (s, x, y, size, width, fill = C.ink, weight = 400) => {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`
    const parts = lines(ctx, s, width)
    for (const [i, part] of parts.entries()) text(part, x, y + i * (size + 7), size, fill, weight)
    return parts.length * (size + 7)
  }
  rect(0, 0, canvas.width, canvas.height, '#f4f1e8')
  rect(32, 32, 1136, canvas.height - 64, '#ffffff')
  rect(32, 32, 1136, 360, C.ink)
  text('PickleMe', 72, 87, 36, C.lime, 700)
  let titleSize = 44
  ctx.font = `700 ${titleSize}px system-ui, sans-serif`
  while (lines(ctx, model.title, 1048).length > 2 && titleSize > 24) {
    titleSize -= 2; ctx.font = `700 ${titleSize}px system-ui, sans-serif`
  }
  wrap(model.title, 72, 147, titleSize, 1048, '#ffffff', 700)
  text(model.date, 72, 261, 29, '#ffffff', 600)
  text(model.time, 72, 305, 27, '#ffffff')
  let locationSize = 25
  ctx.font = `400 ${locationSize}px system-ui, sans-serif`
  while (ctx.measureText(model.location).width > 1048 && locationSize > 12) {
    locationSize--; ctx.font = `400 ${locationSize}px system-ui, sans-serif`
  }
  text(model.location || 'Location not specified', 72, 354, locationSize, '#ffffff')
  text(`PLAYING  ${model.playing.length} / ${model.capacity}`, 72, 449, 31, C.ink, 700)
  text(`${model.capacity - model.playing.length} places available`, 780, 449, 25, C.muted)
  const grid = (cells, top, waiting) => {
    for (const [i, cell] of cells.entries()) {
      const x = 72 + (i % 4) * 266; const y = top + Math.floor(i / 4) * 154
      rect(x, y, 254, 142, cell.name !== null ? C.green : waiting ? '#faf8f1' : '#f7f8f3')
      text(`${waiting ? 'W' : ''}${cell.number}`, x + 16, y + 30, 22, C.muted, 600)
      const label = cell.name ?? (waiting ? '—' : 'Available')
      let size = 26; ctx.font = `600 ${size}px system-ui, sans-serif`
      while (lines(ctx, label, 222).length > 3 && size > 14) { size--; ctx.font = `600 ${size}px system-ui, sans-serif` }
      wrap(label, x + 16, y + 66, size, 222, cell.name !== null ? C.ink : C.muted, cell.name !== null ? 600 : 400)
    }
  }
  grid(layout.playing, 485, false)
  const waitTop = 485 + layout.playingRows * 154 + 72
  text(`WAITLIST  ${model.waitlist.length}`, 72, waitTop - 25, 31, C.ink, 700)
  if (!model.waitlist.length) text('Nobody waiting', 840, waitTop - 25, 25, C.muted)
  grid(layout.waitlist, waitTop, true)
  const footer = waitTop + layout.waitlistRows * 154 + 32
  text(`Snapshot: ${model.snapshot}`, 72, footer, 24, C.muted, 600)
  text('Open the game link for the latest list and to join or withdraw.', 72, footer + 43, 24)
  text('Signup order runs left to right. This image does not update.', 72, footer + 83, 23, C.muted)
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob); else reject(new Error('Could not create the PNG. Please try again.'))
  }, 'image/png'))
}
