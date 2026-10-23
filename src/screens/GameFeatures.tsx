import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { api, isOrganiser } from '../lib/api'
import { friendlyError } from '../lib/errors'
import type { Route } from '../lib/route'
import { Notice, Spinner, useToast } from '../components/ui'
import { GamePage } from './GamePage'

type Preview = { title: string; group_id: string; group_name: string; member: boolean; can_join: boolean }
type Status = 'unmarked' | 'present' | 'no_show' | 'excused'
type AttendanceRow = { user_id: string; name: string; status: Status; marked_at: string | null }
type Attendance = { started: boolean; ended: boolean; cancelled: boolean; rows: AttendanceRow[] }
type ReportRow = AttendanceRow & { game_id: string; game: string; starts_at: string }
const labels: Record<Status,string> = { unmarked: 'Unmarked', present: 'Present', no_show: 'No-show', excused: 'Excused' }
async function rpc<T>(name: string, args: Record<string,unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name,args)
  if(error) throw error
  return data as T
}

export function GameFeatures({ gameId,userId,go,onJoined }: {
  gameId: string; userId: string; go: (r: Route)=>void; onJoined: ()=>Promise<void>
}) {
  const [preview,setPreview]=useState<Preview|null>(null)
  const [organiser,setOrganiser]=useState(false)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const toast=useToast()
  const load=useCallback(async()=>{
    try {
      const p=await rpc<Preview>('preview_shared_game',{p_game_id:gameId})
      setPreview(p)
      setOrganiser(p.member ? isOrganiser((await api.getGame(gameId)).my_role) : false)
      setError('')
    } catch(e) { setError(friendlyError(e)) }
  },[gameId])
  useEffect(()=>{setPreview(null);setOrganiser(false);void load()},[load])
  async function join() {
    setBusy(true)
    try {
      const r=await rpc<{status:string;position:number}>('join_shared_game',{p_game_id:gameId})
      await onJoined();await load()
      toast(r.status==='playing' ? `You're playing — #${r.position}` : `Waitlist — #${r.position}`)
    } catch(e) {setError(friendlyError(e))}
    finally {setBusy(false)}
  }
  if(!preview) return error ? <Notice tone="error">{error}</Notice> : <Spinner/>
  if(!preview.member) return <section className="stack card">
    <h1 className="display">{preview.title}</h1><p>{preview.group_name}</p>
    <p>Join this group and add your name to the game. If the game is full, you will join the waitlist in order.</p>
    <p className="small muted">Joining makes your display name and registration visible to this group's members. A place is assigned only when you join, not when you sign in.</p>
    {error && <Notice tone="error">{error}</Notice>}
    <button className="btn btn-primary" disabled={busy || !preview.can_join} onClick={join}>{busy?'Joining…':'Join group & game'}</button>
    {!preview.can_join && <p>Registration is closed or the game has started. Ask an organiser for a group invite if you still need access.</p>}
    <button className="btn btn-ghost" onClick={()=>go({name:'home'})}>All games</button>
  </section>
  return <div className="stack-lg"><GamePage gameId={gameId} userId={userId} go={go}/>
    {organiser && <AttendancePanel gameId={gameId} groupId={preview.group_id}/>}</div>
}

function saveCsv(name:string,headers:string[],rows:unknown[][]) {
  const cell=(v:unknown)=>{
    let s=String(v??'')
    if(/^[\s]*[=+@-]/.test(s)) s="'"+s
    return '"'+s.replace(/"/g,'""')+'"'
  }
  const blob=new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob);const a=document.createElement('a')
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}

function AttendancePanel({gameId,groupId}:{gameId:string;groupId:string}) {
  const [data,setData]=useState<Attendance|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [from,setFrom]=useState(()=>new Date(Date.now()-90*86400000).toISOString().slice(0,10))
  const [to,setTo]=useState(()=>new Date().toISOString().slice(0,10))
  const [threshold,setThreshold]=useState(2)
  const [report,setReport]=useState<ReportRow[]|null>(null)
  const load=useCallback(async()=>{
    try {setData(await rpc<Attendance>('get_game_attendance',{p_game_id:gameId}));setError('')}
    catch(e){setError(friendlyError(e))}
  },[gameId])
  useEffect(()=>{
    void load()
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible') void load()},30000)
    window.addEventListener('focus',load)
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',load)}
  },[load])
  async function mark(userId:string,status:Status){
    setBusy(true)
    try {await rpc('mark_game_attendance',{p_game_id:gameId,p_user_id:userId,p_status:status});await load();setReport(null)}
    catch(e){setError(friendlyError(e))} finally{setBusy(false)}
  }
  async function generate(){
    setBusy(true);setError('')
    try {setReport(await rpc<ReportRow[]>('attendance_report',{p_group_id:groupId,p_from:from,p_to:to}))}
    catch(e){setError(friendlyError(e))} finally{setBusy(false)}
  }
  const people=new Map<string,{id:string;name:string;present:number;no_show:number;excused:number;unmarked:number}>()
  for(const r of report??[]) {
    const p=people.get(r.user_id)??{id:r.user_id,name:r.name,present:0,no_show:0,excused:0,unmarked:0}
    p[r.status]++;people.set(r.user_id,p)
  }
  const repeat=[...people.values()].filter(p=>p.no_show>=threshold).sort((a,b)=>b.no_show-a.no_show||a.name.localeCompare(b.name))
  return <section className="card stack" aria-label="Attendance and reports">
    <h2>Attendance & reports</h2>
    <p className="small muted">Admins and organisers only. The playing list at game start is kept separately from attendance. Unmarked players are not no-shows. No-shows can be recorded only after the game ends.</p>
    {error && <Notice tone="error">{error}</Notice>}
    <button className="btn btn-sm" disabled={busy} onClick={load}>Refresh attendance</button>
    {!data ? <Spinner/> : data.cancelled ? <p>Attendance is unavailable for cancelled games.</p>
    : !data.started ? <p>Attendance opens when the game starts.</p> : <>
      <p>{data.rows.filter(r=>r.status==='present').length} present · {data.rows.filter(r=>r.status==='no_show').length} no-show · {data.rows.filter(r=>r.status==='excused').length} excused · {data.rows.filter(r=>r.status==='unmarked').length} unmarked</p>
      {data.rows.length===0 && <p>No expected players recorded.</p>}
      {data.rows.map(r=><label className="field" key={r.user_id}><span>{r.name}</span>
        <select aria-label={`Attendance for ${r.name}`} value={r.status} disabled={busy} onChange={e=>mark(r.user_id,e.target.value as Status)}>
          {(Object.keys(labels) as Status[]).map(s=><option key={s} value={s} disabled={s==='no_show'&&!data.ended}>{labels[s]}</option>)}
        </select></label>)}
      <button className="btn" onClick={()=>saveCsv('game-attendance.csv',['User ID','Name','Attendance','Marked at'],data.rows.map(r=>[r.user_id,r.name,labels[r.status],r.marked_at]))}>Export this game's attendance</button>
    </>}
    <h3>Group attendance report</h3>
    <p className="small muted">Dates use the group's timezone. Reports include captured playing lists only; cancelled games and waitlisted players are excluded. Older games are not automatically classified as no-shows.</p>
    <div className="row wrap">
      <label className="field"><span>From</span><input type="date" value={from} onChange={e=>{setFrom(e.target.value);setReport(null)}}/></label>
      <label className="field"><span>Through</span><input type="date" value={to} onChange={e=>{setTo(e.target.value);setReport(null)}}/></label>
      <label className="field"><span>Repeat no-shows: at least</span><input type="number" min="2" max="100" value={threshold} onChange={e=>setThreshold(Math.max(2,Number(e.target.value)||2))}/></label>
    </div>
    <button className="btn" disabled={busy||!from||!to||to<from} onClick={generate}>Generate report</button>
    {report && <>
      <p>{report.length} player-game records · {people.size} players · {repeat.length} players with at least {threshold} recorded no-shows.</p>
      <button className="btn" onClick={()=>saveCsv('attendance-report.csv',['Game ID','Game','Start (UTC)','User ID','Name','Attendance','Marked at'],report.map(r=>[r.game_id,r.game,r.starts_at,r.user_id,r.name,labels[r.status],r.marked_at]))}>Export attendance CSV</button>
      <h3>Repeat no-shows</h3>
      {repeat.length ? <ul>{repeat.map(p=><li key={p.id}>{p.name}: {p.no_show} no-shows · {p.present} attended · {p.excused} excused · {p.unmarked} unmarked</li>)}</ul> : <p>No players meet this threshold in the selected period.</p>}
      <button className="btn" onClick={()=>saveCsv('repeat-no-shows.csv',['User ID','Name','No-shows','Present','Excused','Unmarked','From','Through'],repeat.map(p=>[p.id,p.name,p.no_show,p.present,p.excused,p.unmarked,from,to]))}>Export repeat-no-show CSV</button>
    </>}
  </section>
}
