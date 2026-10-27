import test from 'node:test'
import assert from 'node:assert/strict'
import { initials, avatarColour, AVATAR_COLOURS, contrastRatio, cropRect, clampOffset, AVATAR_PATH } from '../src/lib/avatar-core.js'

test('initials from display names', () => {
  assert.equal(initials('Viv N'), 'VN'); assert.equal(initials('Zhi Xuan Tan'), 'ZT'); assert.equal(initials('prem'), 'P')
  assert.equal(initials('Bao.K'), 'BK'); assert.equal(initials('  '), '?'); assert.equal(initials(null), '?'); assert.equal(initials('陈 美'), '陈美')
})
test('colour is stable per user ID and every colour meets WCAG AA with white text', () => {
  const id = '110431d7-2981-4e37-ad48-e7907389ca2a'
  assert.equal(avatarColour(id), avatarColour(id)); assert.ok(AVATAR_COLOURS.includes(avatarColour(id)))
  for (const c of AVATAR_COLOURS) assert.ok(contrastRatio(c, '#ffffff') >= 4.5, `${c} ${contrastRatio(c, '#ffffff').toFixed(2)}`)
})
test('crop stays inside the image', () => {
  const r = cropRect(1200, 800, 240, 1, -100, 0)
  assert.equal(Math.round(r.size), 800); assert.ok(r.x >= 0 && r.x + r.size <= 1200 + 1e-9)
  const z = cropRect(1200, 800, 240, 2, -5000, -5000); assert.ok(z.x + z.size <= 1200 + 1e-9 && z.y + z.size <= 800 + 1e-9)
  const o = clampOffset(1200, 800, 240, 1, 50, 50); assert.deepEqual(o, { ox: 0, oy: 0 })
  const p = clampOffset(1200, 800, 240, 1, -9999, -9999); assert.equal(p.oy, 0); assert.equal(Math.round(p.ox), -120)
})
test('accepted storage paths', () => {
  assert.ok(AVATAR_PATH.test('110431d7-2981-4e37-ad48-e7907389ca2a/' + 'a'.repeat(32) + '.webp'))
  assert.ok(!AVATAR_PATH.test('../x/' + 'a'.repeat(32) + '.webp')); assert.ok(!AVATAR_PATH.test('110431d7-2981-4e37-ad48-e7907389ca2a/x.png'))
})
