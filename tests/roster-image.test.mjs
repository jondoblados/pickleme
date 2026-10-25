import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterLayout, renderRosterImage } from '../src/lib/roster-image.js'
const names = Array.from({ length: 16 }, (_, i) => `Player ${i+1}`)
test('900px layout has three columns and eight rows for 16 playing plus 8 waitlist slots', () => {
  const l=rosterLayout(16,names.slice(0,10),[])
  assert.equal(l.width,900);assert.equal(l.columns,3);assert.equal(l.rows,8);assert.equal(l.height,1320)
  assert.equal(l.cells.length,24);assert.equal(l.playing.length,16);assert.equal(l.waitlist.length,8)
  assert.equal(l.playing.filter(c=>c.name===null).length,6)
})
test('mixed sixth row is Playing 16, W1, W2 with explicit status',()=>{
  const row=rosterLayout(16,names,[]).cells.slice(15,18)
  assert.deepEqual(row.map(c=>[c.number,c.waiting]),[[16,false],[1,true],[2,true]])
})
test('overflow waitlist and other capacities preserve every real slot and order',()=>{
  const l=rosterLayout(16,names,names)
  assert.equal(l.rows,11);assert.equal(l.cells.length,32)
  assert.deepEqual(l.waitlist.map(c=>c.name),names)
  const small=rosterLayout(5,names.slice(0,5),[])
  assert.equal(small.playing.length,5);assert.equal(small.cells.length,13);assert.equal(small.rows,5)
})
test('invalid capacities and excessively large images are rejected',()=>{
  assert.throws(()=>rosterLayout(0,[],[]));assert.throws(()=>rosterLayout(201,[],[]))
  assert.throws(()=>rosterLayout(1,names,[]));assert.throws(()=>rosterLayout(16,[],Array(1000).fill('Player')),/too large/)
})
const model={title:'Weekly game',date:'27 October 2026',time:'6–9 pm',location:'CBP1',capacity:16,
  playing:['Jon','李明'],waitlist:[],snapshot:'25 Oct 2026 (Asia/Singapore)'}
function canvas(fail=false){
  const drawn=[];const rects=[]
  const ctx={fillRect(x,y,w,h){rects.push({x,y,w,h})},measureText(s){return {width:Array.from(s).length*12}},
    fillText(s,x,y){drawn.push({s,x,y,font:this.font})}}
  return {drawn,rects,width:0,height:0,getContext(){return ctx},toBlob(cb,type){assert.equal(type,'image/png');cb(fail?null:new Blob(['png'],{type}))}}
}
test('PNG retains original fonts, waitlist labels and header clearance without private data',async()=>{
  const c=canvas();const blob=await renderRosterImage({...model,email:'secret@example.com',attendance:'no_show'},()=>c)
  assert.equal(blob.type,'image/png');assert.equal(c.width,900)
  assert.ok(c.drawn.some(t=>t.s==='Jon'&&t.font==='600 26px system-ui, sans-serif'))
  assert.ok(c.drawn.some(t=>t.s==='李明'));assert.ok(c.drawn.some(t=>t.s==='W8 · Waitlist'))
  const loc=c.drawn.find(t=>t.s==='CBP1');const header=c.rects[2]
  assert.ok(header.y+header.h-(loc.y+25)>=37)
  const all=c.drawn.map(t=>t.s).join(' ')
  assert.ok(!all.includes('secret@example.com'));assert.ok(!all.includes('no_show'))
})
test('long text expands rows and preserves names at 26px',async()=>{
  const c=canvas()
  await renderRosterImage({...model,title:'Long title '.repeat(12),location:'Long court '.repeat(15),playing:['A'.repeat(40)]},()=>c)
  const pieces=c.drawn.filter(t=>/^A+$/.test(t.s))
  assert.ok(c.height>1320);assert.ok(pieces.length>1)
  assert.equal(pieces.map(t=>t.s).join(''),'A'.repeat(40))
  assert.ok(pieces.every(t=>t.font==='600 26px system-ui, sans-serif'))
})
test('unsupported canvas and failed encoding report errors',async()=>{
  await assert.rejects(renderRosterImage(model,()=>({getContext(){return null}})),/unavailable/)
  await assert.rejects(renderRosterImage(model,()=>canvas(true)),/Could not create/)
})
