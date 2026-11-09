import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterLayout, renderRosterImage } from '../src/lib/roster-image.js'
const names = Array.from({ length: 16 }, (_, i) => `Player ${i+1}`)

test('playing section has every place in three columns; open places are labelled #n', () => {
  const l = rosterLayout(16, names.slice(0, 9), [])
  assert.equal(l.width, 900); assert.equal(l.columns, 3); assert.equal(l.playingRows, 6)
  assert.equal(l.playing.length, 16); assert.equal(l.playing.filter(c => c.open).length, 7)
  assert.deepEqual(l.playing.slice(8, 11).map(c => [c.label, c.open, c.name]), [['9', false, 'Player 9'], ['#10', true, null], ['#11', true, null]])
})
test('no waitlist section when nobody is waitlisted', () => {
  const l = rosterLayout(16, names, [])
  assert.equal(l.showWaitlist, false); assert.equal(l.waitlist.length, 0); assert.equal(l.waitlistRows, 0)
})
test('waitlist shows exactly the waitlisted players, labelled WL1, WL2, ... in order', () => {
  const two = rosterLayout(16, names, ['Dobi', 'Marcus'])
  assert.equal(two.showWaitlist, true)
  assert.deepEqual(two.waitlist.map(c => [c.label, c.name, c.open]), [['WL1', 'Dobi', false], ['WL2', 'Marcus', false]])
  const ten = rosterLayout(16, names, names.slice(0, 10))
  assert.equal(ten.waitlist.length, 10); assert.equal(ten.waitlistRows, 4); assert.equal(ten.waitlist[9].label, 'WL10')
})
test('entries may carry a user ID and photo; plain names still work', () => {
  const photo = { tag: 'bitmap' }
  const l = rosterLayout(4, [{ name: 'Jon', userId: 'u1', photo }, 'Kev'], [])
  assert.equal(l.playing[0].userId, 'u1'); assert.equal(l.playing[0].photo, photo)
  assert.equal(l.playing[1].name, 'Kev'); assert.equal(l.playing[1].photo, null)
})
test('invalid capacities and excessively large images are rejected', () => {
  assert.throws(() => rosterLayout(0, [], [])); assert.throws(() => rosterLayout(201, [], []))
  assert.throws(() => rosterLayout(1, names, [])); assert.throws(() => rosterLayout(16, [], Array(1000).fill('Player')), /too large/)
})

const model = { title: 'Weekly game', date: '27 October 2026', time: '6–9 pm', location: 'CBP1', capacity: 16,
  playing: ['Jon', '李明'], waitlist: [], snapshot: '25 Oct 2026 (Asia/Singapore)' }
function canvas(fail = false) {
  const drawn = [], rects = [], images = [], fills = []
  const ctx = {
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, fill: this.fillStyle }) },
    measureText(s) { return { width: Array.from(s).length * 12 } },
    fillText(s, x, y) { drawn.push({ s, x, y, font: this.font, fill: this.fillStyle }) },
    beginPath() {}, closePath() {}, arc() {}, fill() { fills.push(this.fillStyle) }, stroke() {}, setLineDash() {},
    save() {}, restore() {}, clip() {},
    drawImage(img, x, y, w, h) { if (img.broken) throw new Error('broken'); images.push({ img, x, y, w, h }) },
  }
  return { drawn, rects, images, fills, width: 0, height: 0, getContext() { return ctx },
    toBlob(cb, type) { assert.equal(type, 'image/png'); cb(fail ? null : new Blob(['png'], { type })) } }
}
const strings = c => c.drawn.map(t => t.s)

test('PNG shows header wordmark, names, initials, number badges and open places without private data', async () => {
  const c = canvas(); const blob = await renderRosterImage({ ...model, email: 'secret@example.com', attendance: 'no_show' }, () => c)
  assert.equal(blob.type, 'image/png'); assert.equal(c.width, 900)
  const s = strings(c)
  assert.ok(s.includes('Pickle') && s.includes('Me'))
  assert.ok(c.drawn.some(t => t.s === 'Jon' && t.font === '600 25px system-ui, sans-serif'))
  assert.ok(s.includes('李明')); assert.ok(s.includes('J')); assert.ok(s.includes('1')); assert.ok(s.includes('2'))
  assert.ok(s.includes('#3') && s.includes('#16')); assert.equal(s.filter(x => x === 'Open').length, 14)
  assert.ok(s.includes('14 places open'))
  assert.ok(!s.some(x => /^WAITLIST/.test(x))); assert.ok(!s.some(x => /^WL\d/.test(x)))
  const loc = c.drawn.find(t => t.s === 'CBP1'); const header = c.rects[2]
  assert.ok(header.y + header.h - (loc.y + 25) >= 37)
  const all = s.join(' ')
  assert.ok(!all.includes('secret@example.com')); assert.ok(!all.includes('no_show'))
})
test('full game shows Full and a waitlist section with only the waitlisted players', async () => {
  const c = canvas()
  await renderRosterImage({ ...model, capacity: 2, waitlist: ['Dobi', 'Marcus Lim'] }, () => c)
  const s = strings(c)
  assert.ok(s.includes('Full')); assert.ok(s.includes('WAITLIST  2'))
  assert.ok(s.includes('WL1') && s.includes('WL2') && !s.includes('WL3'))
  assert.ok(s.includes('Dobi') && s.includes('Marcus Lim') && s.includes('ML'))
  assert.ok(!s.includes('Open'))
})
test('photos are drawn in the circle; a photo that fails to draw falls back to initials', async () => {
  const c = canvas(); const photo = { tag: 'ok' }
  await renderRosterImage({ ...model, playing: [{ name: 'Jon', userId: 'u1', photo }, { name: 'Kev Tan', userId: 'u2', photo: { broken: true } }] }, () => c)
  assert.equal(c.images.length, 1); assert.equal(c.images[0].img, photo); assert.equal(c.images[0].w, 68)
  const s = strings(c)
  assert.ok(!s.includes('J')); assert.ok(s.includes('KT'))
})
test('long names wrap to two lines and end with an ellipsis; tall rosters grow', async () => {
  const c = canvas()
  await renderRosterImage({ ...model, title: 'Long title '.repeat(12), location: 'Long court '.repeat(15), playing: ['A'.repeat(40)] }, () => c)
  const pieces = c.drawn.filter(t => /^A+…?$/.test(t.s) && t.font === '600 25px system-ui, sans-serif')
  assert.equal(pieces.length, 2); assert.ok(pieces[1].s.endsWith('…'))
  assert.ok(pieces.every(t => t.font === '600 25px system-ui, sans-serif'))
  const short = canvas(); await renderRosterImage(model, () => short)
  const tall = canvas(); await renderRosterImage({ ...model, capacity: 16, playing: names, waitlist: names.slice(0, 10) }, () => tall)
  assert.ok(tall.height > short.height + 4 * 96 - 1)
})
test('unsupported canvas and failed encoding report errors', async () => {
  await assert.rejects(renderRosterImage(model, () => ({ getContext() { return null } })), /unavailable/)
  await assert.rejects(renderRosterImage(model, () => canvas(true)), /Could not create/)
})
