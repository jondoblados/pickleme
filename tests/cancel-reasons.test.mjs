import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANCEL_REASONS, checkCancelReason, presetText, cancelNoteAuthor, cancelNoteLine } from '../src/lib/cancel-reasons.js'

test('pulldown has the five agreed reasons plus Other, with codes the database accepts', () => {
  assert.deepEqual(CANCEL_REASONS.map(r => r.code), ['rain', 'lightning', 'venue', 'players', 'organiser', 'other'])
  assert.deepEqual(CANCEL_REASONS.map(r => r.label), ['Rain / wet courts', 'Lightning risk', 'Venue unavailable',
    'Not enough players', 'Organiser unavailable', 'Other (type a reason)'])
  assert.equal(CANCEL_REASONS.at(-1).text, '')
})
test('a reason is required, trimmed and limited to 200 characters', () => {
  assert.equal(checkCancelReason('', 'Rain').ok, false)
  assert.equal(checkCancelReason('rain', '  ').ok, false)
  assert.equal(checkCancelReason('rain', 'ab').ok, false)
  assert.equal(checkCancelReason('other', 'x'.repeat(201)).ok, false)
  assert.deepEqual(checkCancelReason('rain', '  Wet courts  '), { ok: true, text: 'Wet courts' })
})
test('choosing a reason fills the note, but never overwrites custom text', () => {
  assert.equal(presetText('rain', ''), 'Rain / wet courts.')
  assert.equal(presetText('venue', 'Rain / wet courts.'), 'Venue unavailable.')
  assert.equal(presetText('other', 'Rain / wet courts.'), '')
  assert.equal(presetText('venue', 'Heavy rain, see you next week'), 'Heavy rain, see you next week')
})
test('note author shows name and role; WhatsApp line reads as a note', () => {
  const c = { reason: 'Rain / wet courts.', note_by_name: 'Jon', note_by_role: 'admin' }
  assert.equal(cancelNoteAuthor(c), 'Jon (Admin)')
  assert.equal(cancelNoteAuthor({ ...c, note_by_role: 'organiser' }), 'Jon (Organiser)')
  assert.equal(cancelNoteAuthor({ ...c, note_by_role: 'player' }), 'Jon')
  assert.equal(cancelNoteAuthor({ note_by_name: null }), 'An organiser')
  assert.equal(cancelNoteLine(c), 'Note from Jon (Admin): Rain / wet courts.')
  assert.equal(cancelNoteLine({ ...c, reason: null }), null)
  assert.equal(cancelNoteLine(null), null)
})
