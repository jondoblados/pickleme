import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseCode, isCompleteCode, readPending, writePending, PENDING_TTL_MS } from '../src/lib/otp.js'

test('normaliseCode keeps digits only and caps length', () => {
  assert.equal(normaliseCode(' 123 456 '), '123456')
  assert.equal(normaliseCode('123-456'), '123456')
  assert.equal(normaliseCode('12345678901234'), '1234567890')
  assert.equal(normaliseCode(null), '')
})

test('isCompleteCode accepts 6–10 digits', () => {
  assert.equal(isCompleteCode('12345'), false)
  assert.equal(isCompleteCode('123456'), true)
  assert.equal(isCompleteCode('1234567890'), true)
  assert.equal(isCompleteCode('12345a'), false)
})

test('pending marker round-trips and expires after an hour', () => {
  const now = 1_000_000
  const raw = writePending('a@b.co', now)
  assert.equal(readPending(raw, now + 1000), 'a@b.co')
  assert.equal(readPending(raw, now + PENDING_TTL_MS + 1), null)
  assert.equal(readPending(raw, now - 1), null)
  assert.equal(readPending('not json', now), null)
  assert.equal(readPending(null, now), null)
  assert.equal(readPending(JSON.stringify({ email: 1, at: now }), now), null)
})
