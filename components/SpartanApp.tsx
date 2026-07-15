"use client";

import { useMemo, useState } from "react";

type View = "dashboard" | "projects" | "schedule" | "time" | "punch" | "team" | "reports";
type ClockState = "ready" | "working" | "lunch" | "done";

const nav: { id: View; label: string; glyph: string }[] = [
  { id: "dashboard", label: "Overview", glyph: "⌂" },
  { id: "projects", label: "Projects", glyph: "▱" },
  { id: "schedule", label: "Schedule", glyph: "□" },
  { id: "time", label: "Time", glyph: "◷" },
  { id: "punch", label: "Punch", glyph: "✓" },
  { id: "team", label: "Team", glyph: "◎" },
  { id: "reports", label: "Reports", glyph: "↗" },
];

const projects = [
  { name: "Smith Residence", code: "S-1042", meta: "3427 Hawthorne Ave · Portland", stage: "Active", stageClass: "active", people: 8, hours: 1843, progress: 77, punch: 12 },
  { name: "Johnson Remodel", code: "J-1038", meta: "118 SE Alder St · Lake Oswego", stage: "Active", stageClass: "active", people: 5, hours: 926, progress: 62, punch: 7 },
  { name: "Mercer Offices", code: "M-1051", meta: "620 SW Fifth Ave · Portland", stage: "Punch", stageClass: "punch", people: 3, hours: 2118, progress: 92, punch: 24 },
];

const scheduleRows = [
  { initials: "JM", name: "Jake Morrison", role: "Carpenter", cells: ["Smith", "Smith", "Smith", "Johnson", "OFF"] },
  { initials: "CR", name: "Carlos Ruiz", role: "Painter", cells: ["Smith", "Smith", "Mercer", "Mercer", "Mercer"] },
  { initials: "MT", name: "Mike Taylor", role: "Carpenter", cells: ["Johnson", "Johnson", "Johnson", "PTO", "PTO"] },
  { initials: "SK", name: "Sam Kim", role: "Laborer", cells: ["Smith", "Smith", "Smith", "Smith", "Smith"] },
];

function Brand() {
  return <div className="brand"><span className="brand-mark">S</span><span>SPARTAN</span></div>;
}

export function SpartanApp({ userName, roleName, organizationName, canAdmin, isPlatformAdmin }: { userName: string; roleName: string; organizationName: string; canAdmin: boolean; isPlatformAdmin: boolean }) {
  const [view, setView] = useState<View>("dashboard");
  const [clock, setClock] = useState<ClockState>("working");
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [search, setSearch] = useState("");
  const filteredProjects = useMemo(() => projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase())), [search]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function nextClockAction() {
    if (clock === "ready") { setClock("working"); notify("Clocked in to Smith Residence"); }
    else if (clock === "working") { setClock("lunch"); notify("Lunch started"); }
    else if (clock === "lunch") { setClock("working"); notify("Lunch ended"); }
  }

  const title = nav.find(item => item.id === view)?.label ?? "Overview";

  return (
    <div className="app-shell">
      <aside className={mobileNav ? "sidebar open" : "sidebar"}>
        <Brand />
        <nav aria-label="Primary navigation">
          <p className="nav-kicker">Workspace</p>
          {nav.map(item => item.id === "projects" || item.id === "schedule" || item.id === "time" || item.id === "punch" || item.id === "team"
            ? <a key={item.id} className="nav-item" href={item.id === "projects" ? "/projects" : item.id === "schedule" ? "/schedule" : item.id === "time" ? "/time" : item.id === "punch" ? "/punch" : "/employees"}><span>{item.glyph}</span>{item.label}{item.id === "punch" && <em>14</em>}</a>
            : <button key={item.id} className={view === item.id ? "nav-item selected" : "nav-item"} onClick={() => { setView(item.id); setMobileNav(false); }}><span>{item.glyph}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-foot">
          <div className="help-card"><span>?</span><div><strong>Need a hand?</strong><small>Spartan field guide</small></div></div>
          <div className="profile-mini"><span className="avatar amber">{userName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{userName}</strong><small>{roleName} · {organizationName}</small></div></div>
          <div className="account-links"><a href="/account">Account & sessions</a>{canAdmin && <a href="/settings">Company settings</a>}{isPlatformAdmin && <a href="/platform-admin">Platform admin</a>}<form action="/api/auth/logout" method="post"><button type="submit">Log out</button></form></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(v => !v)} aria-label="Toggle navigation">☰</button>
          <div><span className="mobile-brand">SPARTAN / </span><strong>{title}</strong></div>
          <div className="top-actions"><button className="icon-button" aria-label="Search" onClick={() => notify("Search is ready")}>⌕</button><button className="icon-button notification" aria-label="Notifications">♢<span /></button><span className="avatar amber">JR</span></div>
        </header>

        {view === "dashboard" && <Dashboard clock={clock} nextClockAction={nextClockAction} setClock={setClock} notify={notify} />}
        {view === "projects" && <Projects search={search} setSearch={setSearch} items={filteredProjects} notify={notify} />}
        {view === "schedule" && <Schedule weekOffset={weekOffset} setWeekOffset={setWeekOffset} notify={notify} />}
        {view === "time" && <TimeView clock={clock} nextClockAction={nextClockAction} setClock={setClock} notify={notify} />}
        {view === "team" && <Team notify={notify} />}
        {view === "reports" && <Reports notify={notify} />}
      </main>
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
      {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

function Dashboard({ clock, nextClockAction, setClock, notify }: { clock: ClockState; nextClockAction: () => void; setClock: (s: ClockState) => void; notify: (s: string) => void }) {
  return <div className="page dashboard-page">
    <section className="welcome"><div><p className="eyebrow">Tuesday, July 14</p><h1>Good morning, Justin.</h1><p>Here’s what’s moving across your jobsites today.</p></div><button className="primary" onClick={() => notify("New item menu opened")}>＋ New item</button></section>

    <section className="metrics" aria-label="Today at a glance">
      <Metric label="Scheduled today" value="16" detail="across 4 jobsites" icon="◎" />
      <Metric label="Clocked in" value="12" detail="2 currently on lunch" icon="◷" tone="green" />
      <Metric label="Open punch items" value="43" detail="14 need attention" icon="✓" tone="orange" />
      <Metric label="Unapproved time" value="9" detail="through Jul 13" icon="!" tone="red" />
    </section>

    <section className="grid two-one">
      <div className="panel today-panel">
        <div className="panel-head"><div><span className="section-mark">TODAY’S CREW</span><h2>Who’s working</h2></div><button className="text-button" onClick={() => notify("Opening company schedule")}>Full schedule →</button></div>
        {[{n:"Justin Interior Crew",p:"Smith Residence",c:"6 workers",t:"7:00 AM – 3:30 PM",i:"JI",tone:"navy"},{n:"Mercer Finish Crew",p:"Mercer Offices",c:"3 workers",t:"6:30 AM – 3:00 PM",i:"MF",tone:"rust"},{n:"Jake Morrison",p:"Johnson Remodel",c:"Individual assignment",t:"1:00 PM – 4:00 PM",i:"JM",tone:"olive"}].map((row, idx) => <div className="crew-row" key={row.n}><span className={`crew-badge ${row.tone}`}>{row.i}</span><div className="crew-main"><strong>{row.n}</strong><span>{row.c}</span></div><div className="crew-job"><strong>{row.p}</strong><span>{idx === 0 ? "3427 Hawthorne Ave" : idx === 1 ? "620 SW Fifth Ave" : "118 SE Alder St"}</span></div><time>{row.t}</time><button aria-label={`Open ${row.n}`} onClick={() => notify(`${row.n} selected`)}>›</button></div>)}
      </div>
      <div className="panel clock-card">
        <div className="clock-top"><span className="section-mark">YOUR DAY</span><span className={clock === "lunch" ? "live lunch" : "live"}><i />{clock === "lunch" ? "ON LUNCH" : clock === "done" ? "COMPLETE" : "CLOCKED IN"}</span></div>
        <div className="job-icon">▥</div><h2>Smith Residence</h2><p>3427 Hawthorne Ave</p><div className="time-running">{clock === "done" ? "8h 14m" : "4:18:42"}<small>{clock === "done" ? "PAID HOURS" : "ELAPSED TODAY"}</small></div>
        <div className="clock-meta"><span><small>Clocked in</small><strong>7:08 AM</strong></span><span><small>Scheduled</small><strong>7:00–3:30</strong></span></div>
        {clock !== "done" && <button className={clock === "lunch" ? "primary clock-action" : "secondary clock-action"} onClick={nextClockAction}>{clock === "lunch" ? "End lunch" : "Start lunch"}</button>}
        {clock !== "done" && <button className="text-button danger-link" onClick={() => { setClock("done"); notify("Clocked out at 3:22 PM"); }}>Clock out</button>}
      </div>
    </section>

    <section className="grid two-one lower-grid">
      <div className="panel">
        <div className="panel-head"><div><span className="section-mark">PROJECT HEALTH</span><h2>Active jobs</h2></div><button className="text-button" onClick={() => notify("Opening projects")}>View all →</button></div>
        <div className="project-table"><div className="table-header"><span>Project</span><span>Team</span><span>Progress</span><span>Punch</span></div>{projects.map(p => <div className="project-row" key={p.code}><div><strong>{p.name}</strong><span>{p.code} · {p.meta.split(" · ")[0]}</span></div><span>{p.people}</span><div className="progress-wrap"><span><i style={{width:`${p.progress}%`}} /></span><b>{p.progress}%</b></div><span className={p.punch > 20 ? "count hot" : "count"}>{p.punch}</span></div>)}</div>
      </div>
      <div className="panel alerts"><div className="panel-head"><div><span className="section-mark">NEEDS ATTENTION</span><h2>Alerts</h2></div><span className="alert-total">6</span></div>
        <Alert icon="◷" title="2 missing clock-outs" meta="Yesterday · Timekeeping" color="red" onClick={() => notify("Timekeeping alerts opened")} />
        <Alert icon="✓" title="3 items need review" meta="Mercer Offices · Punch" color="orange" onClick={() => notify("Punch reviews opened")} />
        <Alert icon="↻" title="1 correction request" meta="Jake Morrison · 2h ago" color="blue" onClick={() => notify("Correction request opened")} />
      </div>
    </section>
  </div>;
}

function Metric({ label, value, detail, icon, tone = "navy" }: {label:string;value:string;detail:string;icon:string;tone?:string}) { return <div className="metric"><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><b className={`metric-icon ${tone}`}>{icon}</b></div>; }
function Alert({icon,title,meta,color,onClick}:{icon:string;title:string;meta:string;color:string;onClick:()=>void}) { return <button className="alert-row" onClick={onClick}><span className={`alert-icon ${color}`}>{icon}</span><span><strong>{title}</strong><small>{meta}</small></span><b>›</b></button>; }

function Projects({ search, setSearch, items, notify }: { search:string;setSearch:(s:string)=>void;items:typeof projects;notify:(s:string)=>void }) { return <div className="page"><PageTitle eyebrow="PORTFOLIO" title="Projects" detail="Manage jobsites, teams, labor, and closeout work." action="New project" onAction={() => notify("New project form opened")} /><div className="toolbar"><label className="search">⌕<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search projects…" /></label><button className="filter">Active projects⌄</button></div><div className="project-cards">{items.map(p=><button className="project-card" key={p.code} onClick={()=>notify(`${p.name} opened`)}><div className="project-card-top"><span className={`status-pill ${p.stageClass}`}>{p.stage}</span><span>{p.code}</span></div><h2>{p.name}</h2><p>{p.meta}</p><div className="project-card-stats"><span><small>WORKERS</small><strong>{p.people}</strong></span><span><small>LABOR HRS</small><strong>{p.hours.toLocaleString()}</strong></span><span><small>OPEN PUNCH</small><strong>{p.punch}</strong></span></div><div className="project-progress"><span><i style={{width:`${p.progress}%`}} /></span><b>{p.progress}%</b></div></button>)}</div></div>; }

function Schedule({weekOffset,setWeekOffset,notify}:{weekOffset:number;setWeekOffset:(n:number)=>void;notify:(s:string)=>void}) { const label=weekOffset===0?"July 13–17, 2026":weekOffset<0?"July 6–10, 2026":"July 20–24, 2026"; return <div className="page"><PageTitle eyebrow="PLANNED LABOR" title="Company schedule" detail="Assign crews and people across every active job." action="Add assignment" onAction={()=>notify("Assignment editor opened")} /><div className="schedule-controls"><div><button onClick={()=>setWeekOffset(weekOffset-1)}>‹</button><strong>{label}</strong><button onClick={()=>setWeekOffset(weekOffset+1)}>›</button></div><button className="filter" onClick={()=>setWeekOffset(0)}>Today</button></div><div className="schedule-grid"><div className="schedule-head"><span>Employee</span>{["MON 13","TUE 14","WED 15","THU 16","FRI 17"].map(d=><span key={d}>{d}</span>)}</div>{scheduleRows.map(r=><div className="schedule-line" key={r.name}><div><span className="avatar slate">{r.initials}</span><span><strong>{r.name}</strong><small>{r.role}</small></span></div>{r.cells.map((c,i)=><button key={i} className={c==="PTO"?"assignment pto":c==="OFF"?"assignment off":c==="Smith"?"assignment smith":c==="Mercer"?"assignment mercer":"assignment johnson"} onClick={()=>notify(`${r.name} · ${c}`)}><strong>{c}</strong>{!['PTO','OFF'].includes(c)&&<small>7:00–3:30</small>}</button>)}</div>)}</div></div>; }

function TimeView({clock,nextClockAction,setClock,notify}:{clock:ClockState;nextClockAction:()=>void;setClock:(s:ClockState)=>void;notify:(s:string)=>void}) { return <div className="page"><PageTitle eyebrow="ACTUAL LABOR" title="Timekeeping" detail="Review today’s activity and resolve exceptions." action="Manual entry" onAction={()=>notify("Manual time entry opened")} /><div className="time-layout"><div className="panel employee-clock"><span className="section-mark">TODAY’S JOB</span><div className="job-hero"><span className="job-icon">▥</span><div><h2>Smith Residence</h2><p>7:00 AM–3:30 PM · Jake Morrison, foreman</p></div></div><div className="big-clock">{clock==="ready"?"—:—":clock==="done"?"8h 14m":"4:18:42"}</div><p className="clock-caption">{clock==="lunch"?"Lunch in progress":clock==="done"?"Shift complete":"Since 7:08 AM"}</p>{clock!=="done"&&<button className="primary jumbo" onClick={nextClockAction}>{clock==="ready"?"Clock in":clock==="lunch"?"End lunch":"Start lunch"}</button>}{clock!=="ready"&&clock!=="done"&&<button className="secondary jumbo" onClick={()=>{setClock("done");notify("Shift submitted for review")}}>Clock out</button>}</div><div className="panel"><div className="panel-head"><div><span className="section-mark">TEAM STATUS</span><h2>Live time</h2></div><span className="status-pill active">12 working</span></div>{["Jake Morrison|Smith Residence|7:03 AM|working","Carlos Ruiz|Smith Residence|6:58 AM|lunch","Mike Taylor|Johnson Remodel|7:14 AM|working","Sam Kim|Smith Residence|7:07 AM|working"].map(s=>{const [n,p,t,state]=s.split('|');return <div className="live-row" key={n}><span className="avatar slate">{n.split(' ').map(x=>x[0]).join('')}</span><div><strong>{n}</strong><small>{p}</small></div><time>{t}</time><span className={`live ${state}`}><i />{state}</span></div>})}</div></div></div>; }

function Team({notify}:{notify:(s:string)=>void}) { return <div className="page"><PageTitle eyebrow="PEOPLE & CREWS" title="Team" detail="Manage employees, permissions, crews, and wage history." action="Add employee" onAction={()=>notify("Employee form opened")} /><div className="team-grid">{[{n:"Jake Morrison",r:"Foreman",c:"Justin Interior Crew",s:"On job",i:"JM"},{n:"Carlos Ruiz",r:"Employee",c:"Justin Interior Crew",s:"On job",i:"CR"},{n:"Mike Taylor",r:"Employee",c:"Mercer Finish Crew",s:"On job",i:"MT"},{n:"Sam Kim",r:"Employee",c:"Justin Interior Crew",s:"On job",i:"SK"},{n:"Dana Brooks",r:"Manager",c:"Operations",s:"Active",i:"DB"},{n:"Olivia Chen",r:"Viewer",c:"Office",s:"Active",i:"OC"}].map(e=><button className="team-card" key={e.n} onClick={()=>notify(`${e.n}'s profile opened`)}><span className="avatar large slate">{e.i}</span><div><h3>{e.n}</h3><p>{e.r}</p></div><span className="status-pill active">{e.s}</span><small>{e.c}</small></button>)}</div></div>; }

function Reports({notify}:{notify:(s:string)=>void}) { function download(){const csv="Employee,Date,Project,Regular Hours,Overtime Hours,Wage\nJake Morrison,2026-07-13,Smith Residence,8,0.5,31.00\nCarlos Ruiz,2026-07-13,Smith Residence,8,0,28.00\n";const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='spartan-payroll-july-13.csv';a.click();notify('Payroll CSV exported');} return <div className="page"><PageTitle eyebrow="LABOR INTELLIGENCE" title="Reports & export" detail="Turn planned and actual labor into payroll-ready information." action="Export payroll CSV" onAction={download} /><div className="report-grid"><div className="panel"><span className="section-mark">PROJECT LABOR</span><h2>Smith Residence</h2><p className="muted">July 1–14, 2026</p><div className="labor-big"><span><small>Scheduled</small><strong>1,796h</strong></span><span><small>Actual</small><strong>1,843h</strong></span><span><small>Variance</small><strong className="negative">+47h</strong></span></div><div className="bar-chart">{[42,68,55,82,73,61,88,77,64,91].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div></div><div className="panel"><span className="section-mark">PAY PERIOD</span><h2>July 1–15</h2><div className="report-stat"><span>Regular hours</span><strong>1,264.0</strong></div><div className="report-stat"><span>Overtime hours</span><strong>46.5</strong></div><div className="report-stat"><span>Labor cost</span><strong>$39,842</strong></div><button className="primary full" onClick={download}>Export payroll CSV</button></div></div></div>; }

function PageTitle({eyebrow,title,detail,action,onAction}:{eyebrow:string;title:string;detail:string;action:string;onAction:()=>void}) { return <section className="welcome page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></div><button className="primary" onClick={onAction}>＋ {action}</button></section>; }
