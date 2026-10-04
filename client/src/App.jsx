import React, { useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const EXPENSE_CATEGORIES = ['Meat','Vegetables','Sauce ingredients','Gas','Cleaning','Soap','Insecticide','Packaging','Transport','Repairs','Other'];
const STATUS_OPTIONS = ['available','low','finished'];
const SAUCE_LEVELS = ['',0,0.5,1,1.5,2,2.5,3];

function fmtDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function fmtDay(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}
function cap(v) { return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Not recorded'; }
function euro(v) { return `€${Number(v || 0).toFixed(2)}`; }

function Logo({ small = false }) {
  return <img className={small ? 'logo small' : 'logo'} src="/fredas-logo.png" alt="Freda's" />;
}

function Toast({ message, tone = 'info', onClose }) {
  if (!message) return null;
  return <div className={`toast ${tone}`}><span>{message}</span><button onClick={onClose}>×</button></div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('Owner123!');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      setToken(data.token);
      onLogin(data.user);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="login-wrap">
    <form className="login-card" onSubmit={submit}>
      <Logo />
      <h1>Freda’s Operations</h1>
      <p className="sub">Simple daily records for staff, sales, stock and tomorrow’s needs.</p>
      {error && <div className="notice error">{error}</div>}
      <label className="field"><span>Username</span><input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label>
      <label className="field"><span>Password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button className="primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="tiny center">Default demo: owner / Owner123!</div>
    </form>
  </div>;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api('/api/auth/me').then(d => setUser(d.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  function logout() { setToken(null); setUser(null); }
  if (loading) return <div className="app-loading"><Logo /><p>Loading Freda’s…</p></div>;
  if (!user) return <Login onLogin={setUser} />;
  return user.role === 'owner' ? <OwnerApp user={user} onLogout={logout} /> : <WorkerApp user={user} onLogout={logout} />;
}

function OwnerApp({ user, onLogout }) {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(null);
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [needs, setNeeds] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [weekly, setWeekly] = useState(null);
  const [reports, setReports] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [staff, setStaff] = useState([]);
  const [activity, setActivity] = useState([]);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const branch = branches.find(b => b.id === Number(branchId));

  async function loadBranches(preferredId = null) {
    try {
      const d = await api('/api/branches');
      setBranches(d.branches);
      if (d.branches.length) {
        const next = preferredId && d.branches.some(b => b.id === Number(preferredId)) ? Number(preferredId) : (branchId || d.branches[0].id);
        setBranchId(next);
      }
      return d.branches;
    } catch (err) {
      setToast({ message: err.message, tone: 'error' });
      return [];
    }
  }

  useEffect(() => { loadBranches(); }, []);

  async function addBranch() {
    const name = window.prompt('New Freda\'s branch name');
    if (!name?.trim()) return;
    try {
      const d = await api('/api/branches', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      await loadBranches(d.branch.id);
      setToast({ message: `${d.branch.name} branch created. It starts empty.`, tone: 'success' });
    } catch (err) { setToast({ message: err.message, tone: 'error' }); }
  }

  async function refresh() {
    if (!branchId) return;
    setBusy(true);
    try {
      const [o,n,a,w,r,e,s,act] = await Promise.all([
        api(`/api/branches/${branchId}/overview`),
        api(`/api/branches/${branchId}/needs`),
        api(`/api/branches/${branchId}/alerts`),
        api(`/api/branches/${branchId}/reports/weekly`),
        api(`/api/branches/${branchId}/reports?limit=50`),
        api(`/api/branches/${branchId}/expenses`),
        api(`/api/branches/${branchId}/staff`),
        api(`/api/branches/${branchId}/activity`)
      ]);
      setOverview(o); setNeeds(n.needs); setAlerts(a.alerts); setWeekly(w); setReports(r.reports); setExpenses(e.expenses); setStaff(s.staff); setActivity(act.activities);
    } catch (err) { setToast({ message: err.message, tone: 'error' }); }
    finally { setBusy(false); }
  }

  useEffect(() => { refresh(); }, [branchId]);

  async function resolveNeed(id) {
    try { await api(`/api/needs/${id}/resolve`, { method: 'PATCH' }); await refresh(); }
    catch (err) { setToast({ message: err.message, tone: 'error' }); }
  }
  async function updateAlert(id, body) {
    try { await api(`/api/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await refresh(); }
    catch (err) { setToast({ message: err.message, tone: 'error' }); }
  }

  async function addExpense(payload) {
    try {
      await api(`/api/branches/${branchId}/expenses`, { method: 'POST', body: JSON.stringify(payload) });
      setToast({ message: 'Expense saved.', tone: 'success' });
      await refresh();
    } catch (err) { setToast({ message: err.message, tone: 'error' }); throw err; }
  }

  async function addWorker(payload) {
    try {
      await api(`/api/branches/${branchId}/staff`, { method: 'POST', body: JSON.stringify(payload) });
      setToast({ message: 'Worker added.', tone: 'success' });
      await refresh();
    } catch (err) { setToast({ message: err.message, tone: 'error' }); throw err; }
  }

  const nav = [
    ['overview','Overview'],['needs','Tomorrow’s Needs'],['reports','Reports'],['expenses','Expenses'],['staff','Staff']
  ];

  return <div className="shell">
    <aside className="side">
      <Logo />
      <nav className="nav">{nav.map(([key,label]) => <button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</nav>
      <div className="side-bottom"><div className="tiny">Signed in as {user.name}</div><button className="logout" onClick={onLogout}>Log out</button></div>
    </aside>
    <main className="main">
      <div className="topbar">
        <div><h2>{branch?.name || 'Branch'} {tab === 'overview' ? 'overview' : ''}</h2><div className="muted">Monday–Saturday · Sunday closed</div></div>
        <div className="top-actions">
          <button className="secondary" onClick={addBranch}>+ Branch</button>
          <button className="secondary" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
          <select className="branch-select" value={branchId || ''} onChange={e=>setBranchId(Number(e.target.value))}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </div>
      </div>

      {alerts.filter(a=>!a.acknowledged && !a.restocked).map(a => <div className="alert urgent" key={a.id}>
        <div className="alert-icon">!</div><div className="grow"><strong>Urgent stock alert</strong><span>{a.message}</span><div className="need-actions"><button className="mini" onClick={()=>updateAlert(a.id,{acknowledged:true})}>Acknowledge</button><button className="mini green" onClick={()=>updateAlert(a.id,{acknowledged:true,restocked:true})}>Mark restocked</button></div></div>
      </div>)}

      {tab === 'overview' && <Overview overview={overview} needs={needs} weekly={weekly} setTab={setTab} />}
      {tab === 'needs' && <NeedsPage needs={needs} onResolve={resolveNeed} />}
      {tab === 'reports' && <ReportsPage weekly={weekly} reports={reports} branch={branch} />}
      {tab === 'expenses' && <ExpensesPage expenses={expenses} onAdd={addExpense} />}
      {tab === 'staff' && <StaffPage branch={branch} staff={staff} weekly={weekly} activity={activity} onAdd={addWorker} />}
    </main>
    <Toast {...toast} onClose={()=>setToast(null)} />
  </div>;
}

function Overview({ overview, needs, weekly, setTab }) {
  const latest = overview?.latestReport;
  const healthNeeds = overview?.unresolvedNeeds || 0;
  const activeAlerts = overview?.activeAlerts || 0;
  const health = activeAlerts ? 'Urgent attention' : healthNeeds ? 'Needs attention' : latest ? 'All good' : 'No data';
  return <>
    <div className="grid metrics">
      <div className="card"><h3>Branch health</h3><div className="branch-health"><span className={`health-dot ${activeAlerts?'bad':healthNeeds?'warn':latest?'good':''}`}></span><div><div className="metric small">{health}</div><div className="tiny">{latest ? `${healthNeeds} unresolved item(s)` : 'Waiting for first report'}</div></div></div></div>
      <div className="card"><h3>Workers configured</h3><div className="metric">{overview?.staffCount ?? '—'}</div><div className="tiny">For this branch only</div></div>
      <div className="card"><h3>Today’s sales</h3><div className="metric">{latest?.reportDate === new Date().toLocaleDateString('en-CA') ? latest.totalSold : '—'}</div><div className="tiny">Items recorded</div></div>
      <div className="card"><h3>Needs attention</h3><div className="metric">{healthNeeds}</div><div className="tiny">Unresolved items</div></div>
    </div>
    <div className="section two">
      <div className="card"><div className="section-head"><h3>Tomorrow’s Needs</h3><button className="secondary" onClick={()=>setTab('needs')}>View all</button></div>{needs.length ? needs.slice(0,4).map(n=><NeedRow key={n.id} need={n} />) : <Empty text="Nothing needs attention." />}</div>
      <div className="card"><div className="section-head"><h3>Latest end-of-day report</h3><button className="secondary" onClick={()=>setTab('reports')}>Open report</button></div>{latest ? <LatestReport report={latest} /> : <Empty text="No data recorded yet." />}</div>
    </div>
    <div className="section two">
      <div className="card"><div className="section-head"><h3>This week</h3><button className="secondary" onClick={()=>setTab('reports')}>Weekly summary</button></div>{weekly ? <div className="three"><MiniMetric value={weekly.totals.itemsSold} label="items sold"/><MiniMetric value={euro(weekly.totals.expenses)} label="expenses"/><MiniMetric value={`${weekly.totals.staffHours} h`} label="staff hours"/></div> : <Empty text="No weekly records yet." />}</div>
      <div className="card"><h3>Quick actions</h3><div className="split-actions"><button className="primary" onClick={()=>setTab('expenses')}>+ Add Expense</button><button className="secondary" onClick={()=>setTab('needs')}>Tomorrow’s Needs</button><button className="secondary" onClick={()=>setTab('reports')}>Weekly Report</button></div></div>
    </div>
  </>;
}
function MiniMetric({value,label}) { return <div><b>{value}</b><div className="tiny">{label}</div></div>; }
function LatestReport({ report }) { return <div><div className="tiny">{fmtDate(report.submittedAt)} · {report.worker}</div><div className="three report-mini"><div><b>Chicken</b><br/><StatusBadge status={report.chicken.status}/></div><div><b>Beef</b><br/><StatusBadge status={report.beef.status}/></div><div><b>Sales</b><br/><span className="badge gray">{report.totalSold} items</span></div></div><div className="tiny">Shawarma sauce: {report.sauces.shawarma ?? '—'}/3 · Garlic sauce: {report.sauces.garlic ?? '—'}/3</div></div>; }
function StatusBadge({status}) { return <span className={`badge ${status || 'gray'}`}>{cap(status)}</span>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }
function NeedRow({need,onResolve}) { return <div className="need-item"><div className="need-main"><span className={`need-dot ${need.priority}`}></span><div><b>{need.label}</b><div className="tiny">{need.reason}</div></div></div>{onResolve && <button className="mini green" onClick={()=>onResolve(need.id)}>Mark restocked</button>}</div>; }

function NeedsPage({ needs, onResolve }) {
  return <section><div className="section-head"><div><h3>Tomorrow’s Needs</h3><div className="muted">Built automatically from worker end-of-day reports.</div></div></div><div className="card">{needs.length ? needs.map(n=><NeedRow key={n.id} need={n} onResolve={onResolve}/>) : <Empty text="No items needed. Everything reported is currently resolved." />}</div></section>;
}

function ReportsPage({ weekly, reports, branch }) {
  function download() {
    if (!weekly) return;
    const lines = [
      `FREDA'S WEEKLY REPORT - ${branch?.name || ''}`,
      `Week: ${weekly.range.start} to ${weekly.range.end}`,'',
      `Items sold: ${weekly.totals.itemsSold}`,
      `Expenses: ${euro(weekly.totals.expenses)}`,
      `Staff hours: ${weekly.totals.staffHours}`,
      `Top item: ${weekly.topItem ? `${weekly.topItem.name} (${weekly.topItem.quantity})` : '—'}`,'',
      'DAILY REPORTS',
      ...reports.map(r => `${fmtDate(r.submittedAt)} | ${r.worker} | ${r.totalSold} items | Chicken ${cap(r.chicken.status)} | Beef ${cap(r.beef.status)} | Sauces S ${r.sauces.shawarma}/3 G ${r.sauces.garlic}/3`)
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fredas-${branch?.name?.toLowerCase() || 'branch'}-weekly-report.txt`; a.click(); URL.revokeObjectURL(a.href);
  }
  return <section><div className="section-head"><div><h3>Weekly report</h3><div className="muted">Current Monday–Saturday week.</div></div><button className="secondary" onClick={download}>Download weekly report</button></div>
    <div className="card">{weekly ? <><div className="grid report-grid"><MiniMetric value={weekly.totals.itemsSold} label="Items sold"/><MiniMetric value={euro(weekly.totals.expenses)} label="Expenses"/><MiniMetric value={`${weekly.totals.staffHours} h`} label="Staff hours"/><MiniMetric value={weekly.topItem ? `${weekly.topItem.name} · ${weekly.topItem.quantity}` : '—'} label="Top item"/></div><div className="hr"/><b>Latest stock position</b><div className="tiny top-gap">Chicken: {cap(weekly.latestStock?.chicken.status)} · Beef: {cap(weekly.latestStock?.beef.status)} · Shawarma sauce: {weekly.latestStock?.sauces.shawarma ?? '—'}/3 · Garlic sauce: {weekly.latestStock?.sauces.garlic ?? '—'}/3</div></> : <Empty text="No weekly records yet." />}</div>
    <div className="section card"><h3>Daily reports</h3>{reports.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Worker</th><th>Items sold</th><th>Chicken</th><th>Beef</th><th>Sauces</th></tr></thead><tbody>{reports.map(r=><tr key={r.id}><td>{fmtDay(r.submittedAt)}</td><td>{r.worker}</td><td>{r.totalSold}</td><td>{cap(r.chicken.status)}</td><td>{cap(r.beef.status)}</td><td>S {r.sauces.shawarma ?? '—'}/3 · G {r.sauces.garlic ?? '—'}/3</td></tr>)}</tbody></table></div> : <Empty text="No data recorded yet." />}</div>
  </section>;
}

function ExpensesPage({ expenses, onAdd }) {
  const [form,setForm] = useState({ category:'Meat', item:'', amount:'', note:'' });
  const [busy,setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setBusy(true); try { await onAdd({...form, amount:Number(form.amount)}); setForm({category:'Meat',item:'',amount:'',note:''}); } finally { setBusy(false); } }
  const total = expenses.reduce((a,e)=>a+Number(e.amount),0);
  return <section><div className="section-head"><div><h3>Expenses</h3><div className="muted">Only real entries are shown.</div></div><div className="metric small">{euro(total)}</div></div>
    <div className="two"><form className="card" onSubmit={submit}><h3>+ Add Expense</h3><label className="field"><span>Category</span><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{EXPENSE_CATEGORIES.map(x=><option key={x}>{x}</option>)}</select></label><label className="field"><span>Item</span><input required placeholder="Soap, chicken, gas…" value={form.item} onChange={e=>setForm({...form,item:e.target.value})}/></label><label className="field"><span>Amount paid (€)</span><input required type="number" min="0" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label><label className="field"><span>Note</span><textarea rows="2" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><button className="primary" disabled={busy}>{busy?'Saving…':'Save expense'}</button></form>
    <div className="card"><h3>Recent expenses</h3>{expenses.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Item</th><th>Amount</th></tr></thead><tbody>{expenses.map(e=><tr key={e.id}><td>{fmtDay(e.created_at)}</td><td>{e.category}</td><td>{e.item}</td><td>{euro(e.amount)}</td></tr>)}</tbody></table></div> : <Empty text="No expenses recorded yet." />}</div></div>
  </section>;
}

function StaffPage({ branch, staff, weekly, activity, onAdd }) {
  const [open,setOpen]=useState(false); const [form,setForm]=useState({name:'',username:'',password:''}); const [busy,setBusy]=useState(false);
  const summary=weekly?.staffSummary || {};
  async function submit(e){e.preventDefault();setBusy(true);try{await onAdd(form);setForm({name:'',username:'',password:''});setOpen(false);}finally{setBusy(false)}}
  return <section><div className="section-head"><div><h3>Staff & attendance</h3><div className="muted">Each branch has its own staff.</div></div><button className="primary" onClick={()=>setOpen(v=>!v)}>{open?'Cancel':'+ Add worker'}</button></div>
    {open && <form className="card compact-form" onSubmit={submit}><div className="three"><label className="field"><span>Name</span><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="field"><span>Username</span><input required value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label className="field"><span>Temporary password</span><input required minLength="8" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label></div><button className="primary" disabled={busy}>{busy?'Adding…':'Add worker to '+(branch?.name||'branch')}</button></form>}
    <div className="card">{staff.length ? <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Username</th><th>Shifts this week</th><th>Hours this week</th></tr></thead><tbody>{staff.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.username}</td><td>{summary[s.name]?.shifts ?? 0}</td><td>{summary[s.name]?.hours ?? 0} h</td></tr>)}</tbody></table></div> : <Empty text="No workers added yet. This branch starts empty." />}</div>
    <div className="section card"><h3>Recent staff activity</h3>{activity.length ? activity.map(a=><div className="activity-item" key={a.id}><div><b>{a.worker_name}</b><div className="tiny">{a.details || a.action}</div></div><div className="tiny">{fmtDate(a.created_at)}</div></div>) : <Empty text="No activity recorded yet." />}</div>
  </section>;
}

function WorkerApp({ user, onLogout }) {
  const [branch,setBranch]=useState(null); const [menu,setMenu]=useState([]); const [shift,setShift]=useState(null); const [closed,setClosed]=useState(false);
  const [sales,setSales]=useState({}); const [chickenStatus,setChickenStatus]=useState(''); const [beefStatus,setBeefStatus]=useState(''); const [chickenKg,setChickenKg]=useState(''); const [beefKg,setBeefKg]=useState(''); const [shawarmaJars,setShawarmaJars]=useState(''); const [garlicJars,setGarlicJars]=useState(''); const [refillEmpty,setRefillEmpty]=useState(false); const [otherItems,setOtherItems]=useState(''); const [notes,setNotes]=useState(''); const [toast,setToast]=useState(null); const [busy,setBusy]=useState(false);

  async function load() {
    try {
      const [bs,m,a] = await Promise.all([api('/api/branches'),api('/api/menu'),api('/api/attendance/today')]);
      setBranch(bs.branches[0] || null); setMenu(m.items); setShift(a.shift); setClosed(a.closed);
    } catch(err){setToast({message:err.message,tone:'error'});}
  }
  useEffect(()=>{load();},[]);
  const totalSold=useMemo(()=>Object.values(sales).reduce((a,b)=>a+Number(b||0),0),[sales]);

  async function attendance(action) {
    setBusy(true);
    try {
      const path = action==='in'?'/api/attendance/clock-in':action==='out'?'/api/attendance/clock-out':shift?.break_started_at?'/api/attendance/break-end':'/api/attendance/break-start';
      const d=await api(path,{method:'POST'}); setShift(d.shift); setToast({message:action==='in'?'Clocked in.':action==='out'?'Clocked out.':shift?.break_started_at?'Break ended.':'Break started.',tone:'success'});
    } catch(err){setToast({message:err.message,tone:'error'});} finally{setBusy(false)}
  }

  async function submitReport(andClockOut=false) {
    if (!chickenStatus || !beefStatus || shawarmaJars==='' || garlicJars==='') { setToast({message:'Please record Chicken, Beef and both sauce jar levels.',tone:'error'}); return; }
    setBusy(true);
    try {
      await api(`/api/branches/${user.branchId}/reports`,{method:'POST',body:JSON.stringify({sales,chickenStatus,chickenKg,beefStatus,beefKg,shawarmaJars,garlicJars,refillBowlEmpty:refillEmpty,otherItems,notes})});
      if(andClockOut && shift && !shift.clock_out){ const d=await api('/api/attendance/clock-out',{method:'POST'});setShift(d.shift); }
      setToast({message:andClockOut?'Report submitted and you are clocked out.':'End-of-day report submitted.',tone:'success'});
      setSales({});setChickenStatus('');setBeefStatus('');setChickenKg('');setBeefKg('');setShawarmaJars('');setGarlicJars('');setRefillEmpty(false);setOtherItems('');setNotes('');
    } catch(err){setToast({message:err.message,tone:'error'});} finally{setBusy(false)}
  }

  return <div className="worker-wrap">
    <div className="worker-top"><Logo small/><div className="worker-user"><div><b>{user.name}</b><div className="tiny">{branch?.name || ''} branch</div></div><button className="logout auto" onClick={onLogout}>Log out</button></div></div>
    {closed && <div className="alert"><div className="alert-icon">●</div><div><strong>Freda’s is closed today</strong><span>Sunday is not a working day.</span></div></div>}
    <div className="hero"><div><div className="muted">{branch?.name || ''} branch</div><h2>Hello, {user.name}</h2><div className="muted">Today’s shift · Monday–Saturday</div></div><div className="clock-actions"><button className="clock-btn clock-in" disabled={busy||closed||Boolean(shift)} onClick={()=>attendance('in')}>Clock in</button><button className="clock-btn break" disabled={busy||closed||!shift||Boolean(shift.clock_out)} onClick={()=>attendance('break')}>{shift?.break_started_at?'End break':'Start break'}</button><button className="clock-btn clock-out" disabled={busy||closed||!shift||Boolean(shift.clock_out)} onClick={()=>attendance('out')}>Clock out</button></div></div>
    {shift && <div className="notice">Clock in: {fmtDate(shift.clock_in)} {shift.clock_out ? `· Clock out: ${fmtDate(shift.clock_out)}` : shift.break_started_at ? '· On break' : '· Shift active'}</div>}

    <div className="section card"><div className="section-head"><h3>Menu items sold today</h3><span className="muted">{totalSold} items</span></div><div className="item-grid">{menu.map(item=><div className="sale-item" key={item.id}><span>{item.name}</span><div className="counter"><button onClick={()=>setSales({...sales,[item.id]:Math.max(0,(sales[item.id]||0)-1)})}>−</button><b>{sales[item.id]||0}</b><button onClick={()=>setSales({...sales,[item.id]:(sales[item.id]||0)+1})}>+</button></div></div>)}</div></div>

    <div className="section two"><StockCard title="Chicken" status={chickenStatus} setStatus={setChickenStatus} kg={chickenKg} setKg={setChickenKg}/><StockCard title="Beef" status={beefStatus} setStatus={setBeefStatus} kg={beefKg} setKg={setBeefKg}/></div>
    <div className="section two"><SauceCard title="Shawarma sauce" value={shawarmaJars} onChange={setShawarmaJars}/><SauceCard title="Garlic sauce" value={garlicJars} onChange={setGarlicJars}/></div>
    <div className="section card"><div className="section-head"><h3>Close the day</h3><span className="muted">Usually takes 1–2 minutes</span></div><label className="check-row"><input type="checkbox" checked={refillEmpty} onChange={e=>setRefillEmpty(e.target.checked)}/> Refill bowl empty</label><label className="field"><span>Other items needed tomorrow</span><input placeholder="Gas, bread, vegetables, soap…" value={otherItems} onChange={e=>setOtherItems(e.target.value)}/></label><label className="field"><span>Anything management should know?</span><textarea rows="3" placeholder="Optional note" value={notes} onChange={e=>setNotes(e.target.value)}/></label><div className="split-actions"><button className="primary" disabled={busy||closed} onClick={()=>submitReport(false)}>Submit report</button><button className="success" disabled={busy||closed} onClick={()=>submitReport(true)}>Submit & clock out</button></div></div>
    <div className="footer-note">Freda’s secure full-stack system · data is stored on the server.</div>
    <Toast {...toast} onClose={()=>setToast(null)}/>
  </div>;
}

function StockCard({title,status,setStatus,kg,setKg}) { return <div className="card"><div className="section-head"><h3>{title}</h3><span className="muted">Optional kg remaining</span></div><div className="status-row">{STATUS_OPTIONS.map(s=><button key={s} className={`status-option ${status===s?s:''}`} onClick={()=>setStatus(s)}>{cap(s)}</button>)}</div><label className="field"><input type="number" min="0" step="0.5" placeholder="kg remaining (optional)" value={kg} onChange={e=>setKg(e.target.value)}/></label></div>; }
function SauceCard({title,value,onChange}) { return <div className="card"><div className="section-head"><h3>{title}</h3><span className="muted">3 jars total</span></div><label className="field"><span>Jars remaining</span><select value={value} onChange={e=>onChange(e.target.value)}>{SAUCE_LEVELS.map((x,i)=><option key={i} value={x}>{x===''?'Select':x}</option>)}</select></label></div>; }

export default App;
