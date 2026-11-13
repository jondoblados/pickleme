import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSgd, parseSgd, shareCents, costLine, buildMobile, checkPayNowMobile, normalizeMobile, formatMobile, visibleFrom, COUNTRY_CODES }
  from '../src/lib/fees.js'

test('SGD formatting uses two decimals and thousands separators', () => {
  assert.equal(formatSgd(4800), 'SGD 48.00'); assert.equal(formatSgd(437), 'SGD 4.37')
  assert.equal(formatSgd(5), 'SGD 0.05'); assert.equal(formatSgd(120000), 'SGD 1,200.00'); assert.equal(formatSgd(null), '')
})
test('fee input: blank means no fee, amounts parse to cents, junk and out-of-range are invalid', () => {
  assert.equal(parseSgd(''), null); assert.equal(parseSgd('  '), null)
  assert.equal(parseSgd('48'), 4800); assert.equal(parseSgd('48.5'), 4850); assert.equal(parseSgd('$48.50'), 4850)
  assert.equal(parseSgd('SGD 1,200'), 120000); assert.equal(parseSgd('0.01'), 1); assert.equal(parseSgd('9999.99'), 999999)
  for (const bad of ['0', '0.00', '10000', '48.555', 'abc', '-5', '4 8 . 0 0x']) assert.ok(Number.isNaN(parseSgd(bad)), bad)
})
test('shares round up to the cent and need at least one player (matches private.share_cents)', () => {
  assert.equal(shareCents(4800, 11), 437); assert.equal(shareCents(4800, 8), 600); assert.equal(shareCents(4801, 4), 1201)
  assert.equal(shareCents(4800, 0), null); assert.equal(shareCents(null, 4), null)
})
test('cost line: live estimate, nobody yet, final, and no fee', () => {
  const live = { total_cents: 4800, share_cents: 600, share_if_full_cents: 400, basis: 8, final: false }
  assert.equal(costLine(live), 'Court fee: SGD 48.00 total · about SGD 6.00 each (8 playing; changes with sign-ups)')
  assert.equal(costLine(live, { short: true }), 'SGD 48.00 · ≈ SGD 6.00 each (8 playing)')
  const none = { ...live, share_cents: null, basis: 0 }
  assert.equal(costLine(none), 'Court fee: SGD 48.00 total · split between players (SGD 4.00 each if all places fill)')
  assert.equal(costLine(none, { short: true }), 'SGD 48.00 · per player shown after sign-ups')
  assert.equal(costLine({ ...live, final: true, share_cents: 1600, basis: 3 }), 'Court fee: SGD 48.00 total · SGD 16.00 each (final, 3 paying)')
  assert.equal(costLine(null), null)
})
test('confirmation numbers: any country code, picker default +65, typed + or 00 overrides the picker', () => {
  assert.equal(COUNTRY_CODES[0].code, '+65')
  assert.deepEqual(buildMobile('+65', '9876 5432'), { ok: true, mobile: '+6598765432' })
  assert.deepEqual(buildMobile('+63', '917 123 4567'), { ok: true, mobile: '+639171234567' })
  assert.deepEqual(buildMobile('+63', '0917 123 4567'), { ok: true, mobile: '+639171234567' }, 'trunk 0 dropped')
  assert.deepEqual(buildMobile('+65', '+44 7700 900123'), { ok: true, mobile: '+447700900123' })
  assert.deepEqual(buildMobile('+65', '0060 12-345 6789'), { ok: true, mobile: '+60123456789' })
  for (const bad of ['', 'abc', '123', '+0 1234 5678']) assert.equal(buildMobile('+65', bad).ok, false, bad)
  assert.equal(normalizeMobile(' (+65) 9876-5432 '), '+6598765432')
})
test('PayNow payee numbers must be Singapore mobiles', () => {
  assert.deepEqual(checkPayNowMobile('9123 4567'), { ok: true, mobile: '+6591234567' })
  assert.deepEqual(checkPayNowMobile('+65 8123 4567'), { ok: true, mobile: '+6581234567' })
  for (const bad of ['6123 4567', '+63 917 123 4567', '912345678', '']) assert.equal(checkPayNowMobile(bad).ok, false, bad)
})
test('numbers are shown grouped for reading', () => {
  assert.equal(formatMobile('+6591234567'), '+65 9123 4567'); assert.equal(formatMobile('+639171234567'), '+63 917 123 4567')
  assert.equal(formatMobile(null), '')
})
test('visible-from is 1 or 2 weeks (in hours) before the start; null when visible now', () => {
  const start = '2027-01-14T11:00:00.000Z'
  assert.equal(visibleFrom('week_before', start), '2027-01-07T11:00:00.000Z')
  assert.equal(visibleFrom('two_weeks_before', start), '2026-12-31T11:00:00.000Z')
  assert.equal(visibleFrom('now', start), null)
})
