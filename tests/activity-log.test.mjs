import {test} from 'node:test'
import assert from 'node:assert/strict'
import {activityLabel,activityChanges,activityCsv} from '../src/lib/activity-log.js'
test('withdrawal and organiser removal have distinct labels',()=>{
  assert.equal(activityLabel('withdrew'),'Withdrew');assert.equal(activityLabel('removed'),'Removed player')
  assert.equal(activityLabel('future_action'),'future_action')
})
test('change details preserve before/after zero and empty values',()=>{
  assert.deepEqual(activityChanges({changes:{capacity:{before:0,after:16},notes:{before:'',after:'new'}}}),[
    {field:'capacity',before:0,after:16},{field:'notes',before:'',after:'new'}])
  assert.deepEqual(activityChanges({}),[])
})
test('CSV escapes quotes and keeps bigint IDs as strings',()=>{
  const csv=activityCsv([{id:'9007199254740993',created_at:'2026-10-26T03:00:00Z',actor_name:'A "quoted" name',action:'joined',details:{}}])
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('"9007199254740993"'))
  assert.ok(csv.includes('"A ""quoted"" name"'))
})
test('CSV neutralises formula and control-character name prefixes',()=>{
  for(const actor_name of ['=SUM(1,2)',' +formula','@attack','-1','\t=1','\rnew']) {
    const csv=activityCsv([{id:'1',actor_name,action:'joined',details:{}}])
    assert.ok(csv.includes('"\''+actor_name.replace(/"/g,'""')+'"'))
  }
})
test('empty export still has headers; unknown identity does not pretend to know actor',()=>{
  assert.ok(activityCsv([]).includes('Event ID'))
  assert.ok(activityCsv([{id:'1',action:'joined'}]).includes('System or unknown'))
})

test('activityTarget falls back to the masked email for unconfirmed sign-ups', async () => {
  const { activityTarget } = await import('../src/lib/activity-log.js')
  assert.equal(activityTarget({ target_name: 'Viv N', target_user_id: 'u' }), 'Viv N')
  assert.equal(activityTarget({ target_name: null, target_user_id: 'u', details: { masked_email: 'ec•••@yahoo.com.sg' } }), 'ec•••@yahoo.com.sg')
  assert.equal(activityTarget({ target_name: null, target_user_id: 'u', details: {} }), 'Unknown player')
  assert.equal(activityTarget({ target_name: null, target_user_id: null, details: {} }), null)
})
