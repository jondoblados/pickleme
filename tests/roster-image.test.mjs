import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rosterLayout, renderRosterImage } from '../src/lib/roster-image.js'
const names = Array.from({ length: 16 }, (_, i) => `Player ${i+1}`)
test('compact nominal layout is 1100 by 1152 and retains all slots', () => {
  const l = rosterLayout(16, names.slice(0,10), [])
  assert.equal(l.width,1100);assert.equal(l.height,1152)
  assert.equal(l.playing.length,16);assert.equal(l.waitlist.length,8)
  assert.equal(l.playing.filter(c=>c.name===null).length,6)
  assert.deepEqual(l.playing.slice(0,10).map(c=>c.name),names.slice(0,10))
})
test('waitlist expands without dropping names or changing order', () => {
  const l = rosterLayout(16,names,names)
  assert.equal(l.waitlistRows,4);assert.deepEqual(l.waitlist.map(c=>c.name),names)
  assert.equal(l.waitlist[15].number,16)
})
test('non-four-multiple capacities do not invent available places', () => {
  const l = rosterLayout(5,names.slice(0,5),[])
  assert.equal(l.playingRows,2);assert.equal(l.playing.length,5)
})
test('invalid capacities and excessive image size are rejected', () => {
  assert.equal(rosterLayout(1,[],[]).playing[0].name,null)
  assert.throws(()=>rosterLayout(0,[],[]));assert.throws(()=>rosterLayout(201,[],[]))
  assert.throws(()=>rosterLayout(1,names,[]))
  assert.throws(()=>rosterLayout(16,[],Array(1000).fill('Player')),/too large/)
})
const model={title:'Weekly game',date:'27 October 2026',time:'6–9 pm',location:'CBP1',capacity:16,
  playing:['Jon','李明'],waitlist:[],snapshot:'25 Oct 2026 (Asia/Singapore)'}
function canvas(fail=false) {
  const drawn=[];const rects=[]
  const ctx={fillRect(x,y,w,h,fill){rects.push({x,y,w,h})},measureText(s){return {width:Array.from(s).length*14}},
    fillText(s,x,y){drawn.push({s,x,y,font:this.font})}}
  return {drawn,rects,width:0,height:0,getContext(){return ctx},toBlob(cb,type){assert.equal(type,'image/png');cb(fail?null:new Blob(['png'],{type}))}}
}
test('PNG keeps original fonts, header clearance and excludes private data',async()=>{
  const c=canvas();const blob=await renderRosterImage({...model,email:'secret@example.com',attendance:'no_show'},()=>c)
  assert.equal(blob.type,'image/png');assert.equal(c.width,1100);assert.equal(c.height,1152)
  assert.ok(c.drawn.some(t=>t.s==='Jon'&&t.font==='600 26px system-ui, sans-serif'))
  assert.ok(c.drawn.some(t=>t.s==='李明'))
  const loc=c.drawn.find(t=>t.s==='CBP1');const header=c.rects[2]
  assert.ok(header.y+header.h-(loc.y+25)>=37)
  assert.ok(!c.drawn.map(t=>t.s).join(' ').includes('secret@example.com'))
  assert.ok(!c.drawn.map(t=>t.s).join(' ').includes('no_show'))
})
test('wrapped titles, names and locations expand without shrinking fonts',async()=>{
  const c=canvas()
  await renderRosterImage({...model,title:'Long title '.repeat(12),location:'Long location '.repeat(12),playing:['A'.repeat(40)]},()=>c)
  assert.ok(c.height>1152)
  const fragments=c.drawn.filter(t=>/^A+$/.test(t.s))
  assert.ok(fragments.length>1);assert.equal(fragments.map(t=>t.s).join(''),'A'.repeat(40))
  assert.ok(fragments.every(t=>t.font==='600 26px system-ui, sans-serif'))
})
test('unsupported canvas and failed PNG encoding are reported',async()=>{
  await assert.rejects(renderRosterImage(model,()=>({getContext(){return null}})),/unavailable/)
  await assert.rejects(renderRosterImage(model,()=>canvas(true)),/Could not create/)
})
