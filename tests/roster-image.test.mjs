import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterLayout, renderRosterImage } from '../src/lib/roster-image.js'
const names = Array.from({ length: 16 }, (_, i) => `Player ${i+1}`)
test('16 playing cells and 8 waitlist cells with six available places', () => {
  const l = rosterLayout(16, names.slice(0,10), [])
  assert.equal(l.playing.length,16); assert.equal(l.waitlist.length,8)
  assert.equal(l.playing.filter(c=>c.name===null).length,6)
  assert.deepEqual(l.playing.slice(0,10).map(c=>c.name),names.slice(0,10))
})
test('waitlist expands without dropping names and preserves queue numbers', () => {
  const l = rosterLayout(16,names,names)
  assert.equal(l.waitlistRows,4); assert.deepEqual(l.waitlist.map(c=>c.name),names)
  assert.equal(l.waitlist[15].number,16)
})
test('non-multiple-of-four capacities have no false available places', () => {
  const l = rosterLayout(5,names.slice(0,5),[])
  assert.equal(l.playingRows,2);assert.equal(l.playing.length,5)
})
test('zero registrations, capacity limits and oversized image', () => {
  assert.equal(rosterLayout(1,[],[]).playing[0].name,null)
  assert.throws(()=>rosterLayout(0,[],[]));assert.throws(()=>rosterLayout(201,[],[]))
  assert.throws(()=>rosterLayout(1,names,[]))
  assert.throws(()=>rosterLayout(16,[],Array(1000).fill('Player')),/too large/)
})
const model = { title: 'Weekly game', date: '27 October 2026', time: '6–9 pm', location: 'CBP1', capacity:16,
  playing:['Long player name '.repeat(3),'李明','<script>alert(1)</script>'],waitlist:[],snapshot:'24 Oct 2026 (Asia/Singapore)' }
function canvas(fail=false) {
  const drawn=[]
  const ctx={fillRect(){},measureText(s){return {width:Array.from(s).length*14}},fillText(s){drawn.push(s)}}
  return {drawn,width:0,height:0,getContext(){return ctx},toBlob(cb,type){assert.equal(type,'image/png');cb(fail?null:new Blob(['png'],{type}))}}
}
test('renders PNG with wrapped Unicode names and snapshot, without private fields',async()=>{
  const c=canvas();const blob=await renderRosterImage({...model,email:'secret@example.com',attendance:'no_show'},()=>c)
  assert.equal(blob.type,'image/png');assert.equal(c.width,1200)
  assert.ok(c.drawn.some(s=>s.includes('Snapshot:')))
  assert.ok(c.drawn.includes('李明'))
  assert.ok(!c.drawn.join(' ').includes('secret@example.com'))
  assert.ok(!c.drawn.join(' ').includes('no_show'))
})
test('reports unsupported canvas and failed PNG encoding', async()=>{
  await assert.rejects(renderRosterImage(model,()=>({getContext(){return null}})),/unavailable/)
  await assert.rejects(renderRosterImage(model,()=>canvas(true)),/Could not create/)
})
