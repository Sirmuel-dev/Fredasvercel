import React, { useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const EXPENSE_CATEGORIES = [
  'Meat',
  'Vegetables',
  'Sauce ingredients',
  'Gas',
  'Cleaning',
  'Soap',
  'Insecticide',
  'Packaging',
  'Transport',
  'Repairs',
  'Utilities',
  'Services',
  'Other'
];

const INVENTORY_CATEGORIES = [
  'Meat',
  'Vegetables',
  'Sauces',
  'Bread',
  'Drinks',
  'Packaging',
  'Cleaning',
  'Gas',
  'Other'
];

const UNITS = [
  'piece',
  'bottle',
  'can',
  'jar',
  'pack',
  'box',
  'kg',
  'g',
  'litre',
  'ml',
  'cylinder'
];

const STATUS_OPTIONS = [
  'available',
  'low',
  'finished'
];

const SAUCE_LEVELS = [
  '',
  0,
  0.5,
  1,
  1.5,
  2,
  2.5,
  3
];

function todayKey() {
  const d = new Date();

  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}

function currentMonthKey() {
  return todayKey().slice(0, 7);
}

function fmtDate(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat(
    'en-GB',
    {
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  ).format(new Date(value));
}

function fmtDay(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat(
    'en-GB',
    {
      dateStyle: 'medium'
    }
  ).format(new Date(value));
}

function cap(value) {
  if (!value) return 'Not recorded';

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function euro(value) {
  return `€${Number(value || 0).toFixed(2)}`;
}

function numberValue(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function Logo({ small = false }) {
  return (
    <img
      className={small ? 'logo small' : 'logo'}
      src="/Freida’s Retro Orange Splash Logo.png"
      alt="Freida's"
    />
  );
}

function Toast({
  message,
  tone = 'info',
  onClose
}) {
  if (!message) return null;

  return (
    <div className={`toast ${tone}`}>
      <span>{message}</span>

      <button onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="empty">
      {text}
    </div>
  );
}

function MiniMetric({
  value,
  label
}) {
  return (
    <div>
      <b>{value}</b>

      <div className="tiny">
        {label}
      </div>
    </div>
  );
}

/* =========================================================
   LOGIN
   ========================================================= */

function Login({ onLogin }) {
  const [username, setUsername] =
    useState('owner');

  const [password, setPassword] =
    useState('');

  const [error, setError] =
    useState('');

  const [busy, setBusy] =
    useState(false);

  async function submit(e) {
    e.preventDefault();

    setError('');
    setBusy(true);

    try {
      const data =
        await api(
          '/api/auth/login',
          {
            method: 'POST',

            body:
              JSON.stringify({
                username,
                password
              })
          }
        );

      setToken(data.token);

      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form
        className="login-card"
        onSubmit={submit}
      >
        <Logo />

        <h1>
          Freida’s Operations
        </h1>

        <p className="sub">
          Staff, sales, stock,
          suppliers and operations.
        </p>

        {error && (
          <div className="notice error">
            {error}
          </div>
        )}

        <label className="field">
          <span>Username</span>

          <input
            value={username}
            onChange={e =>
              setUsername(
                e.target.value
              )
            }
            autoComplete="username"
          />
        </label>

        <label className="field">
          <span>Password</span>

          <input
            type="password"
            value={password}
            onChange={e =>
              setPassword(
                e.target.value
              )
            }
            autoComplete="current-password"
          />
        </label>

        <button
          className="primary wide"
          disabled={busy}
        >
          {busy
            ? 'Signing in…'
            : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [user, setUser] =
    useState(null);

  const [loading, setLoading] =
    useState(
      Boolean(getToken())
    );

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    api('/api/auth/me')
      .then(data =>
        setUser(data.user)
      )
      .catch(() =>
        setToken(null)
      )
      .finally(() =>
        setLoading(false)
      );
  }, []);

  function logout() {
    setToken(null);
    setUser(null);
  }

  if (loading) {
    return (
      <div className="app-loading">
        <Logo />

        <p>
          Loading Freida’s…
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onLogin={setUser}
      />
    );
  }

  return user.role === 'owner'
    ? (
      <OwnerApp
        user={user}
        onLogout={logout}
      />
    )
    : (
      <WorkerApp
        user={user}
        onLogout={logout}
      />
    );
}

/* =========================================================
   OWNER APP
   ========================================================= */

function OwnerApp({
  user,
  onLogout
}) {
  const [branches, setBranches] =
    useState([]);

  const [branchId, setBranchId] =
    useState(null);

  const [tab, setTab] =
    useState('overview');

  const [overview, setOverview] =
    useState(null);

  const [needs, setNeeds] =
    useState([]);

  const [alerts, setAlerts] =
    useState([]);

  const [weekly, setWeekly] =
    useState(null);

  const [reports, setReports] =
    useState([]);

  const [expenses, setExpenses] =
    useState([]);

  const [staff, setStaff] =
    useState([]);

  const [activity, setActivity] =
    useState([]);

  const [suppliers, setSuppliers] =
    useState([]);

  const [inventory, setInventory] =
    useState([]);

  const [movements, setMovements] =
    useState([]);

  const [purchases, setPurchases] =
    useState([]);

  const [menu, setMenu] =
    useState([]);

  const [toast, setToast] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const branch =
    branches.find(
      b =>
        b.id === Number(branchId)
    );

  async function loadBranches(
    preferredId = null
  ) {
    try {
      const data =
        await api(
          '/api/branches'
        );

      setBranches(
        data.branches || []
      );

      const active =
        (data.branches || [])
          .filter(
            item =>
              item.active !== false
          );

      if (active.length) {
        const preferred =
          Number(preferredId);

        const current =
          Number(branchId);

        const next =
          preferred &&
          active.some(
            b =>
              b.id === preferred
          )
            ? preferred
            : current &&
              active.some(
                b =>
                  b.id === current
              )
              ? current
              : active[0].id;

        setBranchId(next);
      }

      return data.branches || [];
    } catch (err) {
      setToast({
        message:
          err.message,
        tone: 'error'
      });

      return [];
    }
  }

  useEffect(() => {
    loadBranches();
  }, []);

  async function refresh() {
    if (!branchId) return;

    setBusy(true);

    try {
      const [
        overviewData,
        needsData,
        alertsData,
        weeklyData,
        reportsData,
        expensesData,
        staffData,
        activityData,
        suppliersData,
        inventoryData,
        movementsData,
        purchasesData,
        menuData
      ] =
        await Promise.all([
          api(
            `/api/branches/${branchId}/overview`
          ),

          api(
            `/api/branches/${branchId}/needs`
          ),

          api(
            `/api/branches/${branchId}/alerts`
          ),

          api(
            `/api/branches/${branchId}/reports/weekly`
          ),

          api(
            `/api/branches/${branchId}/reports?limit=100`
          ),

          api(
            `/api/branches/${branchId}/expenses`
          ),

          api(
            `/api/branches/${branchId}/staff?includeInactive=1`
          ),

          api(
            `/api/branches/${branchId}/activity`
          ),

          api(
            `/api/branches/${branchId}/suppliers?includeInactive=1`
          ),

          api(
            `/api/branches/${branchId}/inventory?includeInactive=1`
          ),

          api(
            `/api/branches/${branchId}/stock-movements?limit=200`
          ),

          api(
            `/api/branches/${branchId}/purchases`
          ),

          api(
            `/api/branches/${branchId}/menu`
          )
        ]);

      setOverview(
        overviewData
      );

      setNeeds(
        needsData.needs || []
      );

      setAlerts(
        alertsData.alerts || []
      );

      setWeekly(
        weeklyData
      );

      setReports(
        reportsData.reports || []
      );

      setExpenses(
        expensesData.expenses || []
      );

      setStaff(
        staffData.staff || []
      );

      setActivity(
        activityData.activities || []
      );

      setSuppliers(
        suppliersData.suppliers || []
      );

      setInventory(
        inventoryData.inventory || []
      );

      setMovements(
        movementsData.movements || []
      );

      setPurchases(
        purchasesData.purchases || []
      );

      setMenu(
        menuData.items || []
      );
    } catch (err) {
      setToast({
        message:
          err.message,
        tone: 'error'
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [branchId]);

  async function addBranch() {
    const name =
      window.prompt(
        'New Freida’s branch name'
      );

    if (!name?.trim()) {
      return;
    }

    try {
      const data =
        await api(
          '/api/branches',
          {
            method: 'POST',

            body:
              JSON.stringify({
                name:
                  name.trim()
              })
          }
        );

      await loadBranches(
        data.branch.id
      );

      setToast({
        message:
          `${data.branch.name} branch created.`,
        tone:
          'success'
      });
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function resolveNeed(id) {
    try {
      await api(
        `/api/needs/${id}/resolve`,
        {
          method:
            'PATCH'
        }
      );

      await refresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function updateAlert(
    id,
    body
  ) {
    try {
      await api(
        `/api/alerts/${id}`,
        {
          method:
            'PATCH',

          body:
            JSON.stringify(
              body
            )
        }
      );

      await refresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  const nav = [
    ['overview', 'Overview'],
    ['inventory', 'Inventory'],
    ['purchases', 'Purchases'],
    ['suppliers', 'Suppliers'],
    ['expenses', 'Expenses / Services'],
    ['needs', 'Tomorrow’s Needs'],
    ['reports', 'Reports'],
    ['staff', 'Staff'],
    ['menu', 'Menu'],
    ['settings', 'Settings']
  ];

  return (
    <div className="shell">
      <aside className="side">
        <Logo />

        <nav className="nav">
          {nav.map(
            ([key, label]) => (
              <button
                key={key}
                className={
                  tab === key
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setTab(key)
                }
              >
                {label}
              </button>
            )
          )}
        </nav>

        <div className="side-bottom">
          <div className="tiny">
            Signed in as{' '}
            {user.name}
          </div>

          <button
            className="logout"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h2>
              {branch?.name ||
                'Branch'}
              {tab === 'overview'
                ? ' overview'
                : ''}
            </h2>

            <div className="muted">
              Freida’s Operations
            </div>
          </div>

          <div className="top-actions">
            <button
              className="secondary"
              onClick={addBranch}
            >
              + Branch
            </button>

            <button
              className="secondary"
              onClick={refresh}
              disabled={busy}
            >
              {busy
                ? 'Refreshing…'
                : 'Refresh'}
            </button>

            <select
              className="branch-select"
              value={
                branchId || ''
              }
              onChange={e =>
                setBranchId(
                  Number(
                    e.target.value
                  )
                )
              }
            >
              {branches
                .filter(
                  item =>
                    item.active !==
                    false
                )
                .map(
                  branch => (
                    <option
                      key={
                        branch.id
                      }
                      value={
                        branch.id
                      }
                    >
                      {branch.name}
                    </option>
                  )
                )}
            </select>
          </div>
        </div>

        {alerts
          .filter(
            alert =>
              !alert.acknowledged &&
              !alert.restocked
          )
          .map(
            alert => (
              <div
                className="alert urgent"
                key={alert.id}
              >
                <div className="alert-icon">
                  !
                </div>

                <div className="grow">
                  <strong>
                    Attention required
                  </strong>

                  <span>
                    {alert.message}
                  </span>

                  <div className="need-actions">
                    <button
                      className="mini"
                      onClick={() =>
                        updateAlert(
                          alert.id,
                          {
                            acknowledged:
                              true
                          }
                        )
                      }
                    >
                      Acknowledge
                    </button>

                    <button
                      className="mini green"
                      onClick={() =>
                        updateAlert(
                          alert.id,
                          {
                            acknowledged:
                              true,

                            restocked:
                              true
                          }
                        )
                      }
                    >
                      Mark restocked
                    </button>
                  </div>
                </div>
              </div>
            )
          )}

        {tab === 'overview' && (
          <Overview
            overview={overview}
            needs={needs}
            weekly={weekly}
            setTab={setTab}
          />
        )}

        {tab === 'inventory' && (
          <InventoryPage
            branchId={branchId}
            inventory={inventory}
            suppliers={suppliers}
            movements={movements}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}

        {tab === 'purchases' && (
          <PurchasesPage
            branchId={branchId}
            purchases={purchases}
            suppliers={suppliers}
            inventory={inventory}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}

        {tab === 'suppliers' && (
          <SuppliersPage
            branchId={branchId}
            suppliers={suppliers}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}

        {tab === 'expenses' && (
          <ExpensesPage
            branchId={branchId}
            expenses={expenses}
            suppliers={suppliers}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}

        {tab === 'needs' && (
          <NeedsPage
            needs={needs}
            onResolve={
              resolveNeed
            }
          />
        )}

        {tab === 'reports' && (
          <ReportsPage
            branchId={branchId}
            weekly={weekly}
            reports={reports}
            branch={branch}
          />
        )}

        {tab === 'staff' && (
          <StaffPage
            branch={branch}
            staff={staff}
            weekly={weekly}
            activity={activity}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}

        {tab === 'menu' && (
          <MenuPage
            branchId={branchId}
            items={menu}
            inventory={inventory}
            onRefresh={refresh}
            setToast={setToast}
          />
        )}

        {tab === 'settings' && (
          <SettingsPage
            branch={branch}
            onBranchesChanged={
              loadBranches
            }
          />
        )}
      </main>

      <Toast
        {...toast}
        onClose={() =>
          setToast(null)
        }
      />
    </div>
  );
}

/* =========================================================
   OVERVIEW
   ========================================================= */

function Overview({
  overview,
  needs,
  weekly,
  setTab
}) {
  const latest =
    overview?.latestReport;

  const healthNeeds =
    overview?.unresolvedNeeds || 0;

  const activeAlerts =
    overview?.activeAlerts || 0;

  const health =
    activeAlerts
      ? 'Urgent attention'
      : healthNeeds
        ? 'Needs attention'
        : latest
          ? 'All good'
          : 'No data';

  return (
    <>
      <div className="grid metrics">
        <div className="card">
          <h3>
            Branch health
          </h3>

          <div className="branch-health">
            <span
              className={`health-dot ${
                activeAlerts
                  ? 'bad'
                  : healthNeeds
                    ? 'warn'
                    : latest
                      ? 'good'
                      : ''
              }`}
            />

            <div>
              <div className="metric small">
                {health}
              </div>

              <div className="tiny">
                {healthNeeds}{' '}
                unresolved item(s)
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>
            Workers
          </h3>

          <div className="metric">
            {overview?.staffCount ??
              '—'}
          </div>

          <div className="tiny">
            Active workers
          </div>
        </div>

        <div className="card">
          <h3>
            Inventory
          </h3>

          <div className="metric">
            {overview?.inventoryCount ??
              '—'}
          </div>

          <div className="tiny">
            {
              overview?.lowStockCount ??
              0
            }{' '}
            low/out of stock
          </div>
        </div>

        <div className="card">
          <h3>
            Suppliers
          </h3>

          <div className="metric">
            {overview?.supplierCount ??
              '—'}
          </div>

          <div className="tiny">
            Active suppliers
          </div>
        </div>
      </div>

      <div className="section two">
        <div className="card">
          <div className="section-head">
            <h3>
              Tomorrow’s Needs
            </h3>

            <button
              className="secondary"
              onClick={() =>
                setTab('needs')
              }
            >
              View all
            </button>
          </div>

          {needs.length
            ? needs
                .slice(0, 5)
                .map(
                  need => (
                    <NeedRow
                      key={
                        need.id
                      }
                      need={
                        need
                      }
                    />
                  )
                )
            : (
              <Empty text="Nothing needs attention." />
            )}
        </div>

        <div className="card">
          <div className="section-head">
            <h3>
              Latest end-of-day report
            </h3>

            <button
              className="secondary"
              onClick={() =>
                setTab(
                  'reports'
                )
              }
            >
              Open report
            </button>
          </div>

          {latest
            ? (
              <LatestReport
                report={
                  latest
                }
              />
            )
            : (
              <Empty text="No reports recorded yet." />
            )}
        </div>
      </div>

      <div className="section two">
        <div className="card">
          <h3>
            This week
          </h3>

          {weekly
            ? (
              <div className="three">
                <MiniMetric
                  value={
                    weekly
                      .totals
                      .itemsSold
                  }
                  label="items sold"
                />

                <MiniMetric
                  value={euro(
                    weekly
                      .totals
                      .expenses
                  )}
                  label="expenses"
                />

                <MiniMetric
                  value={euro(
                    weekly
                      .totals
                      .purchases
                  )}
                  label="purchases"
                />
              </div>
            )
            : (
              <Empty text="No weekly data yet." />
            )}
        </div>

        <div className="card">
          <h3>
            Quick actions
          </h3>

          <div className="split-actions">
            <button
              className="primary"
              onClick={() =>
                setTab(
                  'purchases'
                )
              }
            >
              + Purchase
            </button>

            <button
              className="secondary"
              onClick={() =>
                setTab(
                  'inventory'
                )
              }
            >
              Inventory
            </button>

            <button
              className="secondary"
              onClick={() =>
                setTab(
                  'suppliers'
                )
              }
            >
              Suppliers
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function LatestReport({
  report
}) {
  return (
    <div>
      <div className="tiny">
        {fmtDate(
          report.submittedAt
        )}
        {' · '}
        {report.worker}
      </div>

      <div className="three report-mini">
        <div>
          <b>Chicken</b>

          <br />

          <StatusBadge
            status={
              report.chicken.status
            }
          />
        </div>

        <div>
          <b>Beef</b>

          <br />

          <StatusBadge
            status={
              report.beef.status
            }
          />
        </div>

        <div>
          <b>Sales</b>

          <br />

          <span className="badge gray">
            {report.totalSold}{' '}
            items
          </span>
        </div>
      </div>

      <div className="tiny">
        Shawarma sauce:{' '}
        {report.sauces.shawarma ??
          '—'}
        /3 · Garlic sauce:{' '}
        {report.sauces.garlic ??
          '—'}
        /3
      </div>
    </div>
  );
}

function StatusBadge({
  status
}) {
  return (
    <span
      className={`badge ${
        status || 'gray'
      }`}
    >
      {cap(status)}
    </span>
  );
}

function NeedRow({
  need,
  onResolve
}) {
  return (
    <div className="need-item">
      <div className="need-main">
        <span
          className={`need-dot ${
            need.priority
          }`}
        />

        <div>
          <b>
            {need.label}
          </b>

          <div className="tiny">
            {need.reason}
          </div>
        </div>
      </div>

      {onResolve && (
        <button
          className="mini green"
          onClick={() =>
            onResolve(
              need.id
            )
          }
        >
          Mark resolved
        </button>
      )}
    </div>
  );
}

/* =========================================================
   INVENTORY
   ========================================================= */

function InventoryPage({
  branchId,
  inventory,
  suppliers,
  movements,
  onRefresh,
  setToast
}) {
  const initialForm = {
    name: '',
    category: 'Drinks',
    unit: 'piece',
    currentQuantity: '',
    reorderLevel: '',
    preferredSupplierId: ''
  };

  const [form, setForm] =
    useState(initialForm);

  const [busy, setBusy] =
    useState(false);

  async function addItem(e) {
    e.preventDefault();

    setBusy(true);

    try {
      await api(
        `/api/branches/${branchId}/inventory`,
        {
          method: 'POST',

          body:
            JSON.stringify({
              ...form,

              currentQuantity:
                Number(
                  form.currentQuantity ||
                  0
                ),

              reorderLevel:
                Number(
                  form.reorderLevel ||
                  0
                ),

              preferredSupplierId:
                form.preferredSupplierId
                  ? Number(
                      form.preferredSupplierId
                    )
                  : null
            })
        }
      );

      setForm(
        initialForm
      );

      setToast({
        message:
          'Inventory item added.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function adjust(item) {
    const raw =
      window.prompt(
        `Current ${item.name}: ${item.current_quantity} ${item.unit}\n\nEnter the NEW total quantity:`
      );

    if (
      raw === null ||
      raw === ''
    ) {
      return;
    }

    const newQuantity =
      Number(raw);

    if (
      !Number.isFinite(
        newQuantity
      )
    ) {
      setToast({
        message:
          'Enter a valid quantity.',
        tone:
          'error'
      });

      return;
    }

    const note =
      window.prompt(
        'Reason for adjustment:',
        'Stock count correction'
      ) || '';

    try {
      await api(
        `/api/inventory/${item.id}/adjust`,
        {
          method: 'POST',

          body:
            JSON.stringify({
              newQuantity,
              movementType:
                'adjustment',
              note
            })
        }
      );

      setToast({
        message:
          `${item.name} stock updated.`,
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function addWaste(item) {
    const raw =
      window.prompt(
        `How much ${item.name} was wasted?`
      );

    if (
      raw === null ||
      raw === ''
    ) {
      return;
    }

    const quantity =
      Number(raw);

    if (
      !Number.isFinite(
        quantity
      ) ||
      quantity <= 0
    ) {
      return;
    }

    const note =
      window.prompt(
        'Reason for waste:',
        'Waste / spoilage'
      ) || '';

    try {
      await api(
        `/api/inventory/${item.id}/adjust`,
        {
          method: 'POST',

          body:
            JSON.stringify({
              quantityChange:
                -quantity,

              movementType:
                'waste',

              note
            })
        }
      );

      setToast({
        message:
          'Waste recorded.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function editItem(item) {
    const name =
      window.prompt(
        'Item name:',
        item.name
      );

    if (!name) return;

    const reorder =
      window.prompt(
        'Reorder level:',
        item.reorder_level
      );

    if (reorder === null) {
      return;
    }

    try {
      await api(
        `/api/inventory/${item.id}`,
        {
          method: 'PATCH',

          body:
            JSON.stringify({
              name,

              reorderLevel:
                Number(reorder)
            })
        }
      );

      setToast({
        message:
          'Inventory item updated.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  const activeInventory =
    inventory.filter(
      item =>
        item.active !== false
    );

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Inventory
          </h3>

          <div className="muted">
            Current stock for this
            branch.
          </div>
        </div>
      </div>

      <form
        className="card compact-form"
        onSubmit={addItem}
      >
        <h3>
          + Add inventory item
        </h3>

        <div className="three">
          <label className="field">
            <span>
              Item
            </span>

            <input
              required
              value={
                form.name
              }
              onChange={e =>
                setForm({
                  ...form,
                  name:
                    e.target.value
                })
              }
              placeholder="Coca-Cola, chicken, bread..."
            />
          </label>

          <label className="field">
            <span>
              Category
            </span>

            <select
              value={
                form.category
              }
              onChange={e =>
                setForm({
                  ...form,
                  category:
                    e.target.value
                })
              }
            >
              {INVENTORY_CATEGORIES.map(
                category => (
                  <option
                    key={
                      category
                    }
                  >
                    {category}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="field">
            <span>
              Unit
            </span>

            <select
              value={
                form.unit
              }
              onChange={e =>
                setForm({
                  ...form,
                  unit:
                    e.target.value
                })
              }
            >
              {UNITS.map(
                unit => (
                  <option
                    key={unit}
                  >
                    {unit}
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <div className="three">
          <label className="field">
            <span>
              Opening quantity
            </span>

            <input
              type="number"
              step="0.001"
              min="0"
              value={
                form.currentQuantity
              }
              onChange={e =>
                setForm({
                  ...form,
                  currentQuantity:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Reorder level
            </span>

            <input
              type="number"
              step="0.001"
              min="0"
              value={
                form.reorderLevel
              }
              onChange={e =>
                setForm({
                  ...form,
                  reorderLevel:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Preferred supplier
            </span>

            <select
              value={
                form.preferredSupplierId
              }
              onChange={e =>
                setForm({
                  ...form,
                  preferredSupplierId:
                    e.target.value
                })
              }
            >
              <option value="">
                None
              </option>

              {suppliers
                .filter(
                  s =>
                    s.active !==
                    false
                )
                .map(
                  supplier => (
                    <option
                      key={
                        supplier.id
                      }
                      value={
                        supplier.id
                      }
                    >
                      {
                        supplier.name
                      }
                    </option>
                  )
                )}
            </select>
          </label>
        </div>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'Adding…'
            : 'Add inventory item'}
        </button>
      </form>

      <div className="section card">
        <h3>
          Current stock
        </h3>

        {activeInventory.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Item
                    </th>
                    <th>
                      Category
                    </th>
                    <th>
                      Current
                    </th>
                    <th>
                      Reorder
                    </th>
                    <th>
                      Supplier
                    </th>
                    <th>
                      Status
                    </th>
                    <th>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {activeInventory.map(
                    item => (
                      <tr
                        key={
                          item.id
                        }
                      >
                        <td>
                          <b>
                            {
                              item.name
                            }
                          </b>
                        </td>

                        <td>
                          {
                            item.category
                          }
                        </td>

                        <td>
                          {
                            Number(
                              item.current_quantity
                            )
                          }{' '}
                          {
                            item.unit
                          }
                        </td>

                        <td>
                          {
                            Number(
                              item.reorder_level
                            )
                          }
                        </td>

                        <td>
                          {
                            item.supplier_name ||
                            '—'
                          }
                        </td>

                        <td>
                          <span
                            className={`badge ${
                              item.status ===
                              'good'
                                ? 'available'
                                : item.status ===
                                  'low'
                                  ? 'low'
                                  : 'finished'
                            }`}
                          >
                            {item.status ===
                            'good'
                              ? 'In stock'
                              : item.status ===
                                'low'
                                ? 'Low'
                                : 'Out'}
                          </span>
                        </td>

                        <td>
                          <div className="need-actions">
                            <button
                              className="mini"
                              onClick={() =>
                                adjust(
                                  item
                                )
                              }
                            >
                              Adjust
                            </button>

                            <button
                              className="mini"
                              onClick={() =>
                                addWaste(
                                  item
                                )
                              }
                            >
                              Waste
                            </button>

                            <button
                              className="mini"
                              onClick={() =>
                                editItem(
                                  item
                                )
                              }
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No inventory items yet." />
          )}
      </div>

      <div className="section card">
        <h3>
          Stock movement history
        </h3>

        {movements.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Date
                    </th>
                    <th>
                      Item
                    </th>
                    <th>
                      Type
                    </th>
                    <th>
                      Change
                    </th>
                    <th>
                      Before
                    </th>
                    <th>
                      After
                    </th>
                    <th>
                      Recorded by
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {movements.map(
                    movement => (
                      <tr
                        key={
                          movement.id
                        }
                      >
                        <td>
                          {fmtDate(
                            movement.created_at
                          )}
                        </td>

                        <td>
                          {
                            movement.item_name
                          }
                        </td>

                        <td>
                          {cap(
                            movement.movement_type
                          )}
                        </td>

                        <td>
                          {Number(
                            movement.quantity_change
                          ) > 0
                            ? '+'
                            : ''}
                          {
                            Number(
                              movement.quantity_change
                            )
                          }{' '}
                          {
                            movement.unit
                          }
                        </td>

                        <td>
                          {
                            Number(
                              movement.quantity_before
                            )
                          }
                        </td>

                        <td>
                          {
                            Number(
                              movement.quantity_after
                            )
                          }
                        </td>

                        <td>
                          {
                            movement.recorded_by
                          }
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No stock movements recorded yet." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   SUPPLIERS
   ========================================================= */

function SuppliersPage({
  branchId,
  suppliers,
  onRefresh,
  setToast
}) {
  const empty = {
    name: '',
    companyCode: '',
    vatCode: '',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    supplies: '',
    notes: ''
  };

  const [form, setForm] =
    useState(empty);

  const [busy, setBusy] =
    useState(false);

  async function submit(e) {
    e.preventDefault();

    setBusy(true);

    try {
      await api(
        `/api/branches/${branchId}/suppliers`,
        {
          method: 'POST',

          body:
            JSON.stringify(
              form
            )
        }
      );

      setForm(empty);

      setToast({
        message:
          'Supplier added.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function editSupplier(
    supplier
  ) {
    const name =
      window.prompt(
        'Supplier name:',
        supplier.name
      );

    if (!name) return;

    const phone =
      window.prompt(
        'Phone:',
        supplier.phone || ''
      );

    if (phone === null) {
      return;
    }

    const supplies =
      window.prompt(
        'What do they supply?',
        supplier.supplies || ''
      );

    if (
      supplies === null
    ) {
      return;
    }

    try {
      await api(
        `/api/suppliers/${supplier.id}`,
        {
          method: 'PATCH',

          body:
            JSON.stringify({
              name,
              phone,
              supplies
            })
        }
      );

      setToast({
        message:
          'Supplier updated.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function deactivate(
    supplier
  ) {
    if (
      !window.confirm(
        `Deactivate ${supplier.name}? Historical purchases will remain.`
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/suppliers/${supplier.id}`,
        {
          method:
            'DELETE'
        }
      );

      setToast({
        message:
          'Supplier deactivated.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Suppliers
          </h3>

          <div className="muted">
            Suppliers and service
            providers used by
            Freida’s.
          </div>
        </div>
      </div>

      <form
        className="card compact-form"
        onSubmit={submit}
      >
        <h3>
          + Add supplier
        </h3>

        <div className="three">
          <label className="field">
            <span>
              Supplier name
            </span>

            <input
              required
              value={
                form.name
              }
              onChange={e =>
                setForm({
                  ...form,
                  name:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Company code
            </span>

            <input
              value={
                form.companyCode
              }
              onChange={e =>
                setForm({
                  ...form,
                  companyCode:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              VAT code
            </span>

            <input
              value={
                form.vatCode
              }
              onChange={e =>
                setForm({
                  ...form,
                  vatCode:
                    e.target.value
                })
              }
            />
          </label>
        </div>

        <div className="three">
          <label className="field">
            <span>
              Contact person
            </span>

            <input
              value={
                form.contactPerson
              }
              onChange={e =>
                setForm({
                  ...form,
                  contactPerson:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Phone
            </span>

            <input
              value={
                form.phone
              }
              onChange={e =>
                setForm({
                  ...form,
                  phone:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Email
            </span>

            <input
              type="email"
              value={
                form.email
              }
              onChange={e =>
                setForm({
                  ...form,
                  email:
                    e.target.value
                })
              }
            />
          </label>
        </div>

        <label className="field">
          <span>
            Address
          </span>

          <input
            value={
              form.address
            }
            onChange={e =>
              setForm({
                ...form,
                address:
                  e.target.value
              })
            }
          />
        </label>

        <label className="field">
          <span>
            What they supply
          </span>

          <input
            placeholder="Chicken, beef, drinks, cleaning service..."
            value={
              form.supplies
            }
            onChange={e =>
              setForm({
                ...form,
                supplies:
                  e.target.value
              })
            }
          />
        </label>

        <label className="field">
          <span>
            Notes
          </span>

          <textarea
            rows="2"
            value={
              form.notes
            }
            onChange={e =>
              setForm({
                ...form,
                notes:
                  e.target.value
              })
            }
          />
        </label>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'Saving…'
            : 'Save supplier'}
        </button>
      </form>

      <div className="section card">
        <h3>
          Supplier records
        </h3>

        {suppliers.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Supplier
                    </th>
                    <th>
                      Supplies
                    </th>
                    <th>
                      Contact
                    </th>
                    <th>
                      Address
                    </th>
                    <th>
                      Purchases
                    </th>
                    <th>
                      Status
                    </th>
                    <th>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {suppliers.map(
                    supplier => (
                      <tr
                        key={
                          supplier.id
                        }
                      >
                        <td>
                          <b>
                            {
                              supplier.name
                            }
                          </b>

                          {supplier.vat_code && (
                            <div className="tiny">
                              VAT:{' '}
                              {
                                supplier.vat_code
                              }
                            </div>
                          )}
                        </td>

                        <td>
                          {
                            supplier.supplies ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            supplier.phone ||
                            supplier.email ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            supplier.address ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            supplier.purchase_count ||
                            0
                          }
                          {' · '}
                          {euro(
                            supplier.purchase_total
                          )}
                        </td>

                        <td>
                          {
                            supplier.active
                              ? 'Active'
                              : 'Inactive'
                          }
                        </td>

                        <td>
                          <div className="need-actions">
                            <button
                              className="mini"
                              onClick={() =>
                                editSupplier(
                                  supplier
                                )
                              }
                            >
                              Edit
                            </button>

                            {supplier.active && (
                              <button
                                className="mini"
                                onClick={() =>
                                  deactivate(
                                    supplier
                                  )
                                }
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No suppliers yet." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   PURCHASES
   ========================================================= */

function PurchasesPage({
  branchId,
  purchases,
  suppliers,
  inventory,
  onRefresh,
  setToast
}) {
  const blankItem = {
    itemName: '',
    inventoryItemId: '',
    quantity: '',
    unit: 'piece',
    unitCost: '',
    lineTotal: '',
    addToInventory: true
  };

  const [form, setForm] =
    useState({
      purchaseDate:
        todayKey(),

      supplierId:
        '',

      invoiceNumber:
        '',

      vatAmount:
        '',

      paymentMethod:
        '',

      notes:
        '',

      items: [
        {
          ...blankItem
        }
      ]
    });

  const [busy, setBusy] =
    useState(false);

  const calculatedSubtotal =
    form.items.reduce(
      (total, item) => {
        const quantity =
          Number(
            item.quantity || 0
          );

        const unitCost =
          Number(
            item.unitCost || 0
          );

        const manual =
          item.lineTotal === ''
            ? null
            : Number(
                item.lineTotal
              );

        return (
          total +
          (
            manual !== null
              ? manual
              : quantity *
                unitCost
          )
        );
      },
      0
    );

  const calculatedTotal =
    calculatedSubtotal +
    Number(
      form.vatAmount || 0
    );

  function updateItem(
    index,
    key,
    value
  ) {
    setForm(
      current => ({
        ...current,

        items:
          current.items.map(
            (item, i) =>
              i === index
                ? {
                    ...item,
                    [key]:
                      value
                  }
                : item
          )
      })
    );
  }

  function addLine() {
    setForm(
      current => ({
        ...current,

        items: [
          ...current.items,
          {
            ...blankItem
          }
        ]
      })
    );
  }

  function removeLine(index) {
    if (
      form.items.length === 1
    ) {
      return;
    }

    setForm(
      current => ({
        ...current,

        items:
          current.items.filter(
            (_, i) =>
              i !== index
          )
      })
    );
  }

  async function submit(e) {
    e.preventDefault();

    setBusy(true);

    try {
      await api(
        `/api/branches/${branchId}/purchases`,
        {
          method: 'POST',

          body:
            JSON.stringify({
              ...form,

              supplierId:
                form.supplierId
                  ? Number(
                      form.supplierId
                    )
                  : null,

              subtotal:
                calculatedSubtotal,

              totalAmount:
                calculatedTotal,

              vatAmount:
                Number(
                  form.vatAmount ||
                  0
                ),

              items:
                form.items.map(
                  item => ({
                    ...item,

                    inventoryItemId:
                      item.inventoryItemId
                        ? Number(
                            item.inventoryItemId
                          )
                        : null,

                    quantity:
                      item.quantity ===
                      ''
                        ? null
                        : Number(
                            item.quantity
                          ),

                    unitCost:
                      item.unitCost ===
                      ''
                        ? null
                        : Number(
                            item.unitCost
                          ),

                    lineTotal:
                      item.lineTotal ===
                      ''
                        ? null
                        : Number(
                            item.lineTotal
                          )
                  })
                )
            })
        }
      );

      setToast({
        message:
          'Purchase saved.',
        tone:
          'success'
      });

      setForm({
        purchaseDate:
          todayKey(),

        supplierId:
          '',

        invoiceNumber:
          '',

        vatAmount:
          '',

        paymentMethod:
          '',

        notes:
          '',

        items: [
          {
            ...blankItem
          }
        ]
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function voidPurchase(
    purchase
  ) {
    if (
      !window.confirm(
        `Void purchase ${
          purchase.invoice_number ||
          '#' + purchase.id
        }?`
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/purchases/${purchase.id}`,
        {
          method:
            'DELETE'
        }
      );

      setToast({
        message:
          'Purchase voided.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Purchases
          </h3>

          <div className="muted">
            Record new and
            historical supplier
            purchases.
          </div>
        </div>
      </div>

      <form
        className="card"
        onSubmit={submit}
      >
        <h3>
          + Record purchase
        </h3>

        <div className="three">
          <label className="field">
            <span>
              Purchase date
            </span>

            <input
              type="date"
              required
              value={
                form.purchaseDate
              }
              onChange={e =>
                setForm({
                  ...form,
                  purchaseDate:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Supplier
            </span>

            <select
              value={
                form.supplierId
              }
              onChange={e =>
                setForm({
                  ...form,
                  supplierId:
                    e.target.value
                })
              }
            >
              <option value="">
                No supplier
              </option>

              {suppliers
                .filter(
                  s =>
                    s.active !==
                    false
                )
                .map(
                  supplier => (
                    <option
                      key={
                        supplier.id
                      }
                      value={
                        supplier.id
                      }
                    >
                      {
                        supplier.name
                      }
                    </option>
                  )
                )}
            </select>
          </label>

          <label className="field">
            <span>
              Invoice number
            </span>

            <input
              value={
                form.invoiceNumber
              }
              onChange={e =>
                setForm({
                  ...form,
                  invoiceNumber:
                    e.target.value
                })
              }
            />
          </label>
        </div>

        <div className="hr" />

        <h3>
          Items
        </h3>

        {form.items.map(
          (item, index) => (
            <div
              className="card"
              key={index}
            >
              <div className="three">
                <label className="field">
                  <span>
                    Item
                  </span>

                  <input
                    required
                    value={
                      item.itemName
                    }
                    onChange={e =>
                      updateItem(
                        index,
                        'itemName',
                        e.target.value
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>
                    Inventory item
                  </span>

                  <select
                    value={
                      item.inventoryItemId
                    }
                    onChange={e => {
                      const id =
                        e.target.value;

                      updateItem(
                        index,
                        'inventoryItemId',
                        id
                      );

                      const selected =
                        inventory.find(
                          inv =>
                            inv.id ===
                            Number(id)
                        );

                      if (
                        selected
                      ) {
                        updateItem(
                          index,
                          'unit',
                          selected.unit
                        );
                      }
                    }}
                  >
                    <option value="">
                      Not linked
                    </option>

                    {inventory
                      .filter(
                        inv =>
                          inv.active !==
                          false
                      )
                      .map(
                        inv => (
                          <option
                            key={
                              inv.id
                            }
                            value={
                              inv.id
                            }
                          >
                            {
                              inv.name
                            }
                          </option>
                        )
                      )}
                  </select>
                </label>

                <label className="field">
                  <span>
                    Unit
                  </span>

                  <select
                    value={
                      item.unit
                    }
                    onChange={e =>
                      updateItem(
                        index,
                        'unit',
                        e.target.value
                      )
                    }
                  >
                    {UNITS.map(
                      unit => (
                        <option
                          key={
                            unit
                          }
                        >
                          {unit}
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>

              <div className="three">
                <label className="field">
                  <span>
                    Quantity
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={
                      item.quantity
                    }
                    onChange={e =>
                      updateItem(
                        index,
                        'quantity',
                        e.target.value
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>
                    Unit cost €
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={
                      item.unitCost
                    }
                    onChange={e =>
                      updateItem(
                        index,
                        'unitCost',
                        e.target.value
                      )
                    }
                  />
                </label>

                <label className="field">
                  <span>
                    Line total €
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      item.lineTotal
                    }
                    onChange={e =>
                      updateItem(
                        index,
                        'lineTotal',
                        e.target.value
                      )
                    }
                    placeholder="Auto if blank"
                  />
                </label>
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={
                    item.addToInventory
                  }
                  onChange={e =>
                    updateItem(
                      index,
                      'addToInventory',
                      e.target.checked
                    )
                  }
                />

                Add this quantity
                to current inventory
              </label>

              {form.items.length >
                1 && (
                <button
                  type="button"
                  className="mini"
                  onClick={() =>
                    removeLine(
                      index
                    )
                  }
                >
                  Remove line
                </button>
              )}
            </div>
          )
        )}

        <button
          type="button"
          className="secondary"
          onClick={addLine}
        >
          + Another item
        </button>

        <div className="three top-gap">
          <label className="field">
            <span>
              VAT €
            </span>

            <input
              type="number"
              min="0"
              step="0.01"
              value={
                form.vatAmount
              }
              onChange={e =>
                setForm({
                  ...form,
                  vatAmount:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Payment method
            </span>

            <select
              value={
                form.paymentMethod
              }
              onChange={e =>
                setForm({
                  ...form,
                  paymentMethod:
                    e.target.value
                })
              }
            >
              <option value="">
                Select
              </option>

              <option>
                Cash
              </option>

              <option>
                Card
              </option>

              <option>
                Bank transfer
              </option>

              <option>
                Credit
              </option>
            </select>
          </label>

          <div className="card">
            <div className="tiny">
              Total
            </div>

            <div className="metric small">
              {euro(
                calculatedTotal
              )}
            </div>
          </div>
        </div>

        <label className="field">
          <span>
            Notes
          </span>

          <textarea
            rows="2"
            value={
              form.notes
            }
            onChange={e =>
              setForm({
                ...form,
                notes:
                  e.target.value
              })
            }
          />
        </label>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'Saving…'
            : 'Save purchase'}
        </button>
      </form>

      <div className="section card">
        <h3>
          Purchase history
        </h3>

        {purchases.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Date
                    </th>
                    <th>
                      Supplier
                    </th>
                    <th>
                      Invoice
                    </th>
                    <th>
                      Items
                    </th>
                    <th>
                      Total
                    </th>
                    <th>
                      Status
                    </th>
                    <th>
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {purchases.map(
                    purchase => (
                      <tr
                        key={
                          purchase.id
                        }
                      >
                        <td>
                          {fmtDay(
                            purchase.purchase_date
                          )}
                        </td>

                        <td>
                          {
                            purchase.supplier_name ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            purchase.invoice_number ||
                            '—'
                          }
                        </td>

                        <td>
                          {(purchase.items ||
                            [])
                            .map(
                              item =>
                                item.item_name
                            )
                            .join(
                              ', '
                            ) ||
                            '—'}
                        </td>

                        <td>
                          {euro(
                            purchase.total_amount
                          )}
                        </td>

                        <td>
                          {cap(
                            purchase.status
                          )}
                        </td>

                        <td>
                          {purchase.status !==
                            'voided' && (
                            <button
                              className="mini"
                              onClick={() =>
                                voidPurchase(
                                  purchase
                                )
                              }
                            >
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No purchases recorded yet." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   EXPENSES / SERVICES
   ========================================================= */

function ExpensesPage({
  branchId,
  expenses,
  suppliers,
  onRefresh,
  setToast
}) {
  const initial = {
    expenseDate:
      todayKey(),

    supplierId:
      '',

    category:
      'Gas',

    item:
      '',

    quantity:
      '',

    unit:
      'piece',

    unitCost:
      '',

    amount:
      '',

    invoiceNumber:
      '',

    paymentMethod:
      '',

    note:
      ''
  };

  const [form, setForm] =
    useState(initial);

  const [busy, setBusy] =
    useState(false);

  const total =
    expenses.reduce(
      (sum, item) =>
        sum +
        Number(
          item.amount || 0
        ),
      0
    );

  async function submit(e) {
    e.preventDefault();

    setBusy(true);

    try {
      await api(
        `/api/branches/${branchId}/expenses`,
        {
          method: 'POST',

          body:
            JSON.stringify({
              ...form,

              supplierId:
                form.supplierId
                  ? Number(
                      form.supplierId
                    )
                  : null,

              quantity:
                form.quantity === ''
                  ? null
                  : Number(
                      form.quantity
                    ),

              unitCost:
                form.unitCost === ''
                  ? null
                  : Number(
                      form.unitCost
                    ),

              amount:
                Number(
                  form.amount
                )
            })
        }
      );

      setForm(initial);

      setToast({
        message:
          'Expense saved.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Expenses & Services
          </h3>

          <div className="muted">
            Gas, repairs,
            transport, services and
            other non-stock costs.
          </div>
        </div>

        <div className="metric small">
          {euro(total)}
        </div>
      </div>

      <form
        className="card"
        onSubmit={submit}
      >
        <h3>
          + Add expense
        </h3>

        <div className="three">
          <label className="field">
            <span>
              Date
            </span>

            <input
              type="date"
              required
              value={
                form.expenseDate
              }
              onChange={e =>
                setForm({
                  ...form,
                  expenseDate:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Supplier /
              service provider
            </span>

            <select
              value={
                form.supplierId
              }
              onChange={e =>
                setForm({
                  ...form,
                  supplierId:
                    e.target.value
                })
              }
            >
              <option value="">
                None
              </option>

              {suppliers.map(
                supplier => (
                  <option
                    key={
                      supplier.id
                    }
                    value={
                      supplier.id
                    }
                  >
                    {
                      supplier.name
                    }
                  </option>
                )
              )}
            </select>
          </label>

          <label className="field">
            <span>
              Category
            </span>

            <select
              value={
                form.category
              }
              onChange={e =>
                setForm({
                  ...form,
                  category:
                    e.target.value
                })
              }
            >
              {EXPENSE_CATEGORIES.map(
                category => (
                  <option
                    key={
                      category
                    }
                  >
                    {category}
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <div className="three">
          <label className="field">
            <span>
              Item / service
            </span>

            <input
              required
              placeholder="Gas refill, repair, transport..."
              value={
                form.item
              }
              onChange={e =>
                setForm({
                  ...form,
                  item:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Amount €
            </span>

            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={
                form.amount
              }
              onChange={e =>
                setForm({
                  ...form,
                  amount:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Invoice / receipt
            </span>

            <input
              value={
                form.invoiceNumber
              }
              onChange={e =>
                setForm({
                  ...form,
                  invoiceNumber:
                    e.target.value
                })
              }
            />
          </label>
        </div>

        <label className="field">
          <span>
            Note
          </span>

          <textarea
            rows="2"
            value={
              form.note
            }
            onChange={e =>
              setForm({
                ...form,
                note:
                  e.target.value
              })
            }
          />
        </label>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'Saving…'
            : 'Save expense'}
        </button>
      </form>

      <div className="section card">
        <h3>
          Expense history
        </h3>

        {expenses.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Date
                    </th>
                    <th>
                      Supplier
                    </th>
                    <th>
                      Category
                    </th>
                    <th>
                      Item
                    </th>
                    <th>
                      Amount
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {expenses.map(
                    expense => (
                      <tr
                        key={
                          expense.id
                        }
                      >
                        <td>
                          {fmtDay(
                            expense.expense_date
                          )}
                        </td>

                        <td>
                          {
                            expense.supplier_name ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            expense.category
                          }
                        </td>

                        <td>
                          {
                            expense.item
                          }
                        </td>

                        <td>
                          {euro(
                            expense.amount
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No expenses recorded yet." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   NEEDS
   ========================================================= */

function NeedsPage({
  needs,
  onResolve
}) {
  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Tomorrow’s Needs
          </h3>

          <div className="muted">
            Generated from worker
            reports and inventory.
          </div>
        </div>
      </div>

      <div className="card">
        {needs.length
          ? needs.map(
              need => (
                <NeedRow
                  key={need.id}
                  need={need}
                  onResolve={
                    onResolve
                  }
                />
              )
            )
          : (
            <Empty text="Nothing currently needs attention." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   REPORTS
   ========================================================= */

function ReportsPage({
  branchId,
  weekly,
  reports,
  branch
}) {
  const [month, setMonth] =
    useState(
      currentMonthKey()
    );

  const [monthly, setMonthly] =
    useState(null);

  const [loading, setLoading] =
    useState(false);

  useEffect(() => {
    if (!branchId) return;

    setLoading(true);

    api(
      `/api/branches/${branchId}/reports/monthly?month=${month}`
    )
      .then(setMonthly)
      .catch(() =>
        setMonthly(null)
      )
      .finally(() =>
        setLoading(false)
      );
  }, [
    branchId,
    month
  ]);

  function downloadWeekly() {
    if (!weekly) return;

    const lines = [
      `FREIDA'S WEEKLY REPORT - ${branch?.name || ''}`,

      `Week: ${weekly.range.start} to ${weekly.range.end}`,

      '',

      `Items sold: ${weekly.totals.itemsSold}`,

      `Expenses: ${euro(weekly.totals.expenses)}`,

      `Purchases: ${euro(weekly.totals.purchases)}`,

      `Staff hours: ${weekly.totals.staffHours}`,

      `Top item: ${
        weekly.topItem
          ? `${weekly.topItem.name} (${weekly.topItem.quantity})`
          : '—'
      }`
    ];

    const blob =
      new Blob(
        [
          lines.join(
            '\n'
          )
        ],
        {
          type:
            'text/plain'
        }
      );

    const a =
      document.createElement(
        'a'
      );

    a.href =
      URL.createObjectURL(
        blob
      );

    a.download =
      `freidas-${branch?.name?.toLowerCase() || 'branch'}-weekly-report.txt`;

    a.click();

    URL.revokeObjectURL(
      a.href
    );
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Reports
          </h3>

          <div className="muted">
            Daily, weekly and
            monthly history.
          </div>
        </div>

        <button
          className="secondary"
          onClick={
            downloadWeekly
          }
        >
          Download weekly report
        </button>
      </div>

      <div className="card">
        <h3>
          This week
        </h3>

        {weekly
          ? (
            <div className="grid report-grid">
              <MiniMetric
                value={
                  weekly.totals
                    .itemsSold
                }
                label="Items sold"
              />

              <MiniMetric
                value={euro(
                  weekly.totals
                    .expenses
                )}
                label="Expenses"
              />

              <MiniMetric
                value={euro(
                  weekly.totals
                    .purchases
                )}
                label="Purchases"
              />

              <MiniMetric
                value={`${weekly.totals.staffHours} h`}
                label="Staff hours"
              />
            </div>
          )
          : (
            <Empty text="No weekly records yet." />
          )}
      </div>

      <div className="section card">
        <div className="section-head">
          <h3>
            Monthly report
          </h3>

          <input
            type="month"
            value={month}
            onChange={e =>
              setMonth(
                e.target.value
              )
            }
          />
        </div>

        {loading
          ? (
            <div className="empty">
              Loading monthly
              report…
            </div>
          )
          : monthly
            ? (
              <>
                <div className="grid report-grid">
                  <MiniMetric
                    value={
                      monthly
                        .totals
                        .itemsSold
                    }
                    label="Items sold"
                  />

                  <MiniMetric
                    value={euro(
                      monthly
                        .totals
                        .expenses
                    )}
                    label="Expenses"
                  />

                  <MiniMetric
                    value={euro(
                      monthly
                        .totals
                        .purchases
                    )}
                    label="Purchases"
                  />

                  <MiniMetric
                    value={`${monthly.totals.staffHours} h`}
                    label="Staff hours"
                  />
                </div>

                <div className="tiny top-gap">
                  Top item:{' '}
                  {monthly.topItem
                    ? `${monthly.topItem.name} (${monthly.topItem.quantity})`
                    : '—'}
                </div>
              </>
            )
            : (
              <Empty text="No monthly data." />
            )}
      </div>

      <div className="section card">
        <h3>
          Daily reports
        </h3>

        {reports.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Date
                    </th>
                    <th>
                      Worker
                    </th>
                    <th>
                      Items sold
                    </th>
                    <th>
                      Chicken
                    </th>
                    <th>
                      Beef
                    </th>
                    <th>
                      Sauces
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {reports.map(
                    report => (
                      <tr
                        key={
                          report.id
                        }
                      >
                        <td>
                          {fmtDay(
                            report.submittedAt
                          )}
                        </td>

                        <td>
                          {
                            report.worker
                          }
                        </td>

                        <td>
                          {
                            report.totalSold
                          }
                        </td>

                        <td>
                          {cap(
                            report.chicken.status
                          )}
                        </td>

                        <td>
                          {cap(
                            report.beef.status
                          )}
                        </td>

                        <td>
                          S{' '}
                          {report.sauces.shawarma ??
                            '—'}
                          /3 · G{' '}
                          {report.sauces.garlic ??
                            '—'}
                          /3
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No daily reports yet." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   STAFF
   ========================================================= */

function StaffPage({
  branch,
  staff,
  weekly,
  activity,
  onRefresh,
  setToast
}) {
  const [open, setOpen] =
    useState(false);

  const [form, setForm] =
    useState({
      name: '',
      username: '',
      password: ''
    });

  const [busy, setBusy] =
    useState(false);

  const summary =
    weekly?.staffSummary || {};

  async function addWorker(e) {
    e.preventDefault();

    setBusy(true);

    try {
      await api(
        `/api/branches/${branch.id}/staff`,
        {
          method: 'POST',

          body:
            JSON.stringify(
              form
            )
        }
      );

      setForm({
        name: '',
        username: '',
        password: ''
      });

      setOpen(false);

      setToast({
        message:
          'Worker added.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function editWorker(
    worker
  ) {
    const name =
      window.prompt(
        'Worker name:',
        worker.name
      );

    if (!name) return;

    const username =
      window.prompt(
        'Username:',
        worker.username
      );

    if (!username) return;

    try {
      await api(
        `/api/staff/${worker.id}`,
        {
          method: 'PATCH',

          body:
            JSON.stringify({
              name,
              username
            })
        }
      );

      setToast({
        message:
          'Worker updated.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function resetPassword(
    worker
  ) {
    const password =
      window.prompt(
        `New password for ${worker.name}:\nMinimum 8 characters.`
      );

    if (!password) return;

    try {
      await api(
        `/api/staff/${worker.id}/reset-password`,
        {
          method: 'PATCH',

          body:
            JSON.stringify({
              newPassword:
                password
            })
        }
      );

      setToast({
        message:
          `${worker.name}'s password was reset.`,
        tone:
          'success'
      });
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function removeWorker(
    worker
  ) {
    if (
      !window.confirm(
        `Remove ${worker.name}? Their old reports, attendance and sales will remain.`
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/staff/${worker.id}`,
        {
          method:
            'DELETE'
        }
      );

      setToast({
        message:
          `${worker.name} removed.`,
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function reactivate(
    worker
  ) {
    try {
      await api(
        `/api/staff/${worker.id}`,
        {
          method:
            'PATCH',

          body:
            JSON.stringify({
              active:
                true
            })
        }
      );

      setToast({
        message:
          `${worker.name} reactivated.`,
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Staff & Attendance
          </h3>

          <div className="muted">
            Full owner control
            over worker accounts.
          </div>
        </div>

        <button
          className="primary"
          onClick={() =>
            setOpen(
              value =>
                !value
            )
          }
        >
          {open
            ? 'Cancel'
            : '+ Add worker'}
        </button>
      </div>

      {open && (
        <form
          className="card compact-form"
          onSubmit={addWorker}
        >
          <div className="three">
            <label className="field">
              <span>
                Name
              </span>

              <input
                required
                value={
                  form.name
                }
                onChange={e =>
                  setForm({
                    ...form,
                    name:
                      e.target.value
                  })
                }
              />
            </label>

            <label className="field">
              <span>
                Username
              </span>

              <input
                required
                value={
                  form.username
                }
                onChange={e =>
                  setForm({
                    ...form,
                    username:
                      e.target.value
                  })
                }
              />
            </label>

            <label className="field">
              <span>
                Temporary password
              </span>

              <input
                required
                minLength="8"
                value={
                  form.password
                }
                onChange={e =>
                  setForm({
                    ...form,
                    password:
                      e.target.value
                  })
                }
              />
            </label>
          </div>

          <button
            className="primary"
            disabled={busy}
          >
            Add worker
          </button>
        </form>
      )}

      <div className="card">
        {staff.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Worker
                    </th>
                    <th>
                      Username
                    </th>
                    <th>
                      Status
                    </th>
                    <th>
                      Shifts
                    </th>
                    <th>
                      Hours
                    </th>
                    <th>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {staff.map(
                    worker => (
                      <tr
                        key={
                          worker.id
                        }
                      >
                        <td>
                          {
                            worker.name
                          }
                        </td>

                        <td>
                          {
                            worker.username
                          }
                        </td>

                        <td>
                          {
                            worker.active
                              ? 'Active'
                              : 'Inactive'
                          }
                        </td>

                        <td>
                          {
                            summary[
                              worker.name
                            ]?.shifts ??
                            0
                          }
                        </td>

                        <td>
                          {
                            summary[
                              worker.name
                            ]?.hours ??
                            0
                          }{' '}
                          h
                        </td>

                        <td>
                          <div className="need-actions">
                            <button
                              className="mini"
                              onClick={() =>
                                editWorker(
                                  worker
                                )
                              }
                            >
                              Edit
                            </button>

                            <button
                              className="mini"
                              onClick={() =>
                                resetPassword(
                                  worker
                                )
                              }
                            >
                              Password
                            </button>

                            {worker.active
                              ? (
                                <button
                                  className="mini"
                                  onClick={() =>
                                    removeWorker(
                                      worker
                                    )
                                  }
                                >
                                  Remove
                                </button>
                              )
                              : (
                                <button
                                  className="mini green"
                                  onClick={() =>
                                    reactivate(
                                      worker
                                    )
                                  }
                                >
                                  Reactivate
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No workers added yet." />
          )}
      </div>

      <div className="section card">
        <h3>
          Recent activity
        </h3>

        {activity.length
          ? activity.map(
              item => (
                <div
                  className="activity-item"
                  key={
                    item.id
                  }
                >
                  <div>
                    <b>
                      {
                        item.worker_name
                      }
                    </b>

                    <div className="tiny">
                      {
                        item.details ||
                        item.action
                      }
                    </div>
                  </div>

                  <div className="tiny">
                    {fmtDate(
                      item.created_at
                    )}
                  </div>
                </div>
              )
            )
          : (
            <Empty text="No activity recorded yet." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   MENU MANAGEMENT
   ========================================================= */

function MenuPage({
  branchId,
  items,
  inventory,
  onRefresh,
  setToast
}) {
  const [form, setForm] =
    useState({
      name: '',
      category: 'food',
      inventoryItemId: '',
      stockPerSale: 1
    });

  const [busy, setBusy] =
    useState(false);

  async function addMenuItem(e) {
    e.preventDefault();

    setBusy(true);

    try {
      await api(
        '/api/menu',
        {
          method: 'POST',

          body:
            JSON.stringify({
              ...form,

              branchId,

              inventoryItemId:
                form.inventoryItemId
                  ? Number(
                      form.inventoryItemId
                    )
                  : null,

              stockPerSale:
                Number(
                  form.stockPerSale ||
                  1
                )
            })
        }
      );

      setForm({
        name: '',
        category: 'food',
        inventoryItemId: '',
        stockPerSale: 1
      });

      setToast({
        message:
          'Menu item added.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function editItem(item) {
    const name =
      window.prompt(
        'Menu item name:',
        item.name
      );

    if (!name) return;

    try {
      await api(
        `/api/menu/${item.id}`,
        {
          method: 'PATCH',

          body:
            JSON.stringify({
              name,

              category:
                item.category,

              branchId
            })
        }
      );

      setToast({
        message:
          'Menu item updated.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  async function deactivate(
    item
  ) {
    if (
      !window.confirm(
        `Remove ${item.name} from the active worker menu?`
      )
    ) {
      return;
    }

    try {
      await api(
        `/api/menu/${item.id}`,
        {
          method:
            'DELETE'
        }
      );

      setToast({
        message:
          'Menu item deactivated.',
        tone:
          'success'
      });

      await onRefresh();
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Menu Management
          </h3>

          <div className="muted">
            Food and drinks shown
            to workers.
          </div>
        </div>
      </div>

      <form
        className="card compact-form"
        onSubmit={
          addMenuItem
        }
      >
        <h3>
          + Add menu item
        </h3>

        <div className="three">
          <label className="field">
            <span>
              Name
            </span>

            <input
              required
              value={
                form.name
              }
              onChange={e =>
                setForm({
                  ...form,
                  name:
                    e.target.value
                })
              }
            />
          </label>

          <label className="field">
            <span>
              Type
            </span>

            <select
              value={
                form.category
              }
              onChange={e =>
                setForm({
                  ...form,
                  category:
                    e.target.value
                })
              }
            >
              <option value="food">
                Food
              </option>

              <option value="drink">
                Drink
              </option>
            </select>
          </label>

          <label className="field">
            <span>
              Inventory link
            </span>

            <select
              value={
                form.inventoryItemId
              }
              onChange={e =>
                setForm({
                  ...form,
                  inventoryItemId:
                    e.target.value
                })
              }
            >
              <option value="">
                None
              </option>

              {inventory
                .filter(
                  item =>
                    item.active !==
                    false
                )
                .map(
                  item => (
                    <option
                      key={
                        item.id
                      }
                      value={
                        item.id
                      }
                    >
                      {
                        item.name
                      }
                    </option>
                  )
                )}
            </select>
          </label>
        </div>

        <label className="field">
          <span>
            Inventory removed per
            sale
          </span>

          <input
            type="number"
            min="0"
            step="0.001"
            value={
              form.stockPerSale
            }
            onChange={e =>
              setForm({
                ...form,
                stockPerSale:
                  e.target.value
              })
            }
          />
        </label>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'Adding…'
            : 'Add menu item'}
        </button>
      </form>

      <div className="section card">
        <h3>
          Menu items
        </h3>

        {items.length
          ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Item
                    </th>
                    <th>
                      Type
                    </th>
                    <th>
                      Inventory link
                    </th>
                    <th>
                      Stock per sale
                    </th>
                    <th>
                      Status
                    </th>
                    <th>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {items.map(
                    item => (
                      <tr
                        key={
                          item.id
                        }
                      >
                        <td>
                          {
                            item.name
                          }
                        </td>

                        <td>
                          {cap(
                            item.category
                          )}
                        </td>

                        <td>
                          {
                            item.inventoryItemName ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            item.stockPerSale ||
                            '—'
                          }
                        </td>

                        <td>
                          {
                            item.active
                              ? 'Active'
                              : 'Inactive'
                          }
                        </td>

                        <td>
                          <div className="need-actions">
                            <button
                              className="mini"
                              onClick={() =>
                                editItem(
                                  item
                                )
                              }
                            >
                              Edit
                            </button>

                            {item.active && (
                              <button
                                className="mini"
                                onClick={() =>
                                  deactivate(
                                    item
                                  )
                                }
                              >
                                Deactivate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
          : (
            <Empty text="No menu items." />
          )}
      </div>
    </section>
  );
}

/* =========================================================
   SETTINGS / OWNER PRIVILEGES
   ========================================================= */

function SettingsPage({
  branch,
  onBranchesChanged
}) {
  const [form, setForm] =
    useState({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState('');

  async function changePassword(
    e
  ) {
    e.preventDefault();

    setMessage('');

    if (
      form.newPassword.length <
      8
    ) {
      setMessage(
        'New password must be at least 8 characters.'
      );

      return;
    }

    if (
      form.newPassword !==
      form.confirmPassword
    ) {
      setMessage(
        'New passwords do not match.'
      );

      return;
    }

    setBusy(true);

    try {
      await api(
        '/api/auth/change-password',
        {
          method:
            'PATCH',

          body:
            JSON.stringify({
              currentPassword:
                form.currentPassword,

              newPassword:
                form.newPassword
            })
        }
      );

      setMessage(
        'Password changed successfully.'
      );

      setForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (err) {
      setMessage(
        err.message
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameBranch() {
    const name =
      window.prompt(
        'Branch name:',
        branch?.name || ''
      );

    if (!name) return;

    try {
      await api(
        `/api/branches/${branch.id}`,
        {
          method:
            'PATCH',

          body:
            JSON.stringify({
              name
            })
        }
      );

      setMessage(
        'Branch updated.'
      );

      await onBranchesChanged(
        branch.id
      );
    } catch (err) {
      setMessage(
        err.message
      );
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h3>
            Owner Settings
          </h3>

          <div className="muted">
            Account and branch
            administration.
          </div>
        </div>
      </div>

      <form
        className="card"
        onSubmit={
          changePassword
        }
      >
        <h3>
          Change owner password
        </h3>

        {message && (
          <div className="notice">
            {message}
          </div>
        )}

        <label className="field">
          <span>
            Current password
          </span>

          <input
            type="password"
            required
            value={
              form.currentPassword
            }
            onChange={e =>
              setForm({
                ...form,
                currentPassword:
                  e.target.value
              })
            }
          />
        </label>

        <label className="field">
          <span>
            New password
          </span>

          <input
            type="password"
            required
            minLength="8"
            value={
              form.newPassword
            }
            onChange={e =>
              setForm({
                ...form,
                newPassword:
                  e.target.value
              })
            }
          />
        </label>

        <label className="field">
          <span>
            Confirm password
          </span>

          <input
            type="password"
            required
            minLength="8"
            value={
              form.confirmPassword
            }
            onChange={e =>
              setForm({
                ...form,
                confirmPassword:
                  e.target.value
              })
            }
          />
        </label>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'Changing…'
            : 'Change Password'}
        </button>
      </form>

      <div className="section card">
        <h3>
          Branch management
        </h3>

        <div className="tiny">
          Current branch
        </div>

        <div className="metric small">
          {branch?.name || '—'}
        </div>

        <div className="top-gap">
          <button
            className="secondary"
            onClick={
              renameBranch
            }
          >
            Rename branch
          </button>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   WORKER APP
   ========================================================= */

function WorkerApp({
  user,
  onLogout
}) {
  const [branch, setBranch] =
    useState(null);

  const [menu, setMenu] =
    useState([]);

  const [shift, setShift] =
    useState(null);

  const [closed, setClosed] =
    useState(false);

  const [sales, setSales] =
    useState({});

  const [
    chickenStatus,
    setChickenStatus
  ] =
    useState('');

  const [
    beefStatus,
    setBeefStatus
  ] =
    useState('');

  const [
    chickenKg,
    setChickenKg
  ] =
    useState('');

  const [
    beefKg,
    setBeefKg
  ] =
    useState('');

  const [
    shawarmaJars,
    setShawarmaJars
  ] =
    useState('');

  const [
    garlicJars,
    setGarlicJars
  ] =
    useState('');

  const [
    refillEmpty,
    setRefillEmpty
  ] =
    useState(false);

  const [
    otherItems,
    setOtherItems
  ] =
    useState('');

  const [notes, setNotes] =
    useState('');

  const [toast, setToast] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  async function load() {
    try {
      const [
        branchesData,
        menuData,
        attendanceData
      ] =
        await Promise.all([
          api(
            '/api/branches'
          ),

          api(
            '/api/menu'
          ),

          api(
            '/api/attendance/today'
          )
        ]);

      setBranch(
        branchesData.branches[0] ||
        null
      );

      setMenu(
        menuData.items || []
      );

      setShift(
        attendanceData.shift
      );

      setClosed(
        attendanceData.closed
      );
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    }
  }

  useEffect(() => {
    load();
  }, []);

  const totalSold =
    useMemo(
      () =>
        Object.values(
          sales
        ).reduce(
          (sum, quantity) =>
            sum +
            Number(
              quantity || 0
            ),
          0
        ),
      [sales]
    );

  async function attendance(
    action
  ) {
    setBusy(true);

    try {
      const path =
        action === 'in'
          ? '/api/attendance/clock-in'
          : action === 'out'
            ? '/api/attendance/clock-out'
            : shift?.break_started_at
              ? '/api/attendance/break-end'
              : '/api/attendance/break-start';

      const data =
        await api(
          path,
          {
            method: 'POST'
          }
        );

      setShift(
        data.shift
      );

      setToast({
        message:
          action === 'in'
            ? 'Clocked in.'
            : action === 'out'
              ? 'Clocked out.'
              : shift?.break_started_at
                ? 'Break ended.'
                : 'Break started.',

        tone:
          'success'
      });
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(
    andClockOut = false
  ) {
    if (
      !chickenStatus ||
      !beefStatus ||
      shawarmaJars === '' ||
      garlicJars === ''
    ) {
      setToast({
        message:
          'Please record Chicken, Beef and both sauce jar levels.',
        tone:
          'error'
      });

      return;
    }

    setBusy(true);

    try {
      await api(
        `/api/branches/${user.branchId}/reports`,
        {
          method:
            'POST',

          body:
            JSON.stringify({
              sales,
              chickenStatus,
              chickenKg,
              beefStatus,
              beefKg,
              shawarmaJars,
              garlicJars,
              refillBowlEmpty:
                refillEmpty,
              otherItems,
              notes
            })
        }
      );

      if (
        andClockOut &&
        shift &&
        !shift.clock_out
      ) {
        const data =
          await api(
            '/api/attendance/clock-out',
            {
              method:
                'POST'
            }
          );

        setShift(
          data.shift
        );
      }

      setToast({
        message:
          andClockOut
            ? 'Report submitted and you are clocked out.'
            : 'End-of-day report submitted.',

        tone:
          'success'
      });

      setSales({});
      setChickenStatus('');
      setBeefStatus('');
      setChickenKg('');
      setBeefKg('');
      setShawarmaJars('');
      setGarlicJars('');
      setRefillEmpty(false);
      setOtherItems('');
      setNotes('');
    } catch (err) {
      setToast({
        message:
          err.message,
        tone:
          'error'
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="worker-wrap">
      <div className="worker-top">
        <Logo small />

        <div className="worker-user">
          <div>
            <b>
              {user.name}
            </b>

            <div className="tiny">
              {branch?.name ||
                ''}{' '}
              branch
            </div>
          </div>

          <button
            className="logout auto"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      </div>

      {closed && (
        <div className="alert">
          <div className="alert-icon">
            ●
          </div>

          <div>
            <strong>
              Freida’s is closed
              today
            </strong>

            <span>
              Sunday is not a
              working day.
            </span>
          </div>
        </div>
      )}

      <div className="hero">
        <div>
          <div className="muted">
            {branch?.name ||
              ''}{' '}
            branch
          </div>

          <h2>
            Hello, {user.name}
          </h2>

          <div className="muted">
            Today’s shift ·
            Monday–Saturday
          </div>
        </div>

        <div className="clock-actions">
          <button
            className="clock-btn clock-in"
            disabled={
              busy ||
              closed ||
              Boolean(shift)
            }
            onClick={() =>
              attendance('in')
            }
          >
            Clock in
          </button>

          <button
            className="clock-btn break"
            disabled={
              busy ||
              closed ||
              !shift ||
              Boolean(
                shift.clock_out
              )
            }
            onClick={() =>
              attendance(
                'break'
              )
            }
          >
            {shift?.break_started_at
              ? 'End break'
              : 'Start break'}
          </button>

          <button
            className="clock-btn clock-out"
            disabled={
              busy ||
              closed ||
              !shift ||
              Boolean(
                shift.clock_out
              )
            }
            onClick={() =>
              attendance('out')
            }
          >
            Clock out
          </button>
        </div>
      </div>

      {shift && (
        <div className="notice">
          Clock in:{' '}
          {fmtDate(
            shift.clock_in
          )}

          {shift.clock_out
            ? ` · Clock out: ${fmtDate(shift.clock_out)}`
            : shift.break_started_at
              ? ' · On break'
              : ' · Shift active'}
        </div>
      )}

      <div className="section card">
        <div className="section-head">
          <h3>
            Menu items sold today
          </h3>

          <span className="muted">
            {totalSold} items
          </span>
        </div>

        <div className="item-grid">
          {menu.map(
            item => (
              <div
                className="sale-item"
                key={item.id}
              >
                <span>
                  {item.name}

                  {item.category ===
                    'drink' && (
                    <small className="tiny">
                      {' '}
                      · Drink
                    </small>
                  )}
                </span>

                <div className="counter">
                  <button
                    onClick={() =>
                      setSales({
                        ...sales,

                        [item.id]:
                          Math.max(
                            0,
                            (
                              sales[
                                item.id
                              ] || 0
                            ) - 1
                          )
                      })
                    }
                  >
                    −
                  </button>

                  <b>
                    {sales[
                      item.id
                    ] || 0}
                  </b>

                  <button
                    onClick={() =>
                      setSales({
                        ...sales,

                        [item.id]:
                          (
                            sales[
                              item.id
                            ] || 0
                          ) + 1
                      })
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <div className="section two">
        <StockCard
          title="Chicken"
          status={
            chickenStatus
          }
          setStatus={
            setChickenStatus
          }
          kg={chickenKg}
          setKg={
            setChickenKg
          }
        />

        <StockCard
          title="Beef"
          status={
            beefStatus
          }
          setStatus={
            setBeefStatus
          }
          kg={beefKg}
          setKg={
            setBeefKg
          }
        />
      </div>

      <div className="section two">
        <SauceCard
          title="Shawarma sauce"
          value={
            shawarmaJars
          }
          onChange={
            setShawarmaJars
          }
        />

        <SauceCard
          title="Garlic sauce"
          value={
            garlicJars
          }
          onChange={
            setGarlicJars
          }
        />
      </div>

      <div className="section card">
        <div className="section-head">
          <h3>
            Close the day
          </h3>

          <span className="muted">
            Usually takes 1–2
            minutes
          </span>
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={
              refillEmpty
            }
            onChange={e =>
              setRefillEmpty(
                e.target.checked
              )
            }
          />

          Refill bowl empty
        </label>

        <label className="field">
          <span>
            Other items needed
            tomorrow
          </span>

          <input
            placeholder="Gas, bread, vegetables, soap…"
            value={
              otherItems
            }
            onChange={e =>
              setOtherItems(
                e.target.value
              )
            }
          />
        </label>

        <label className="field">
          <span>
            Anything management
            should know?
          </span>

          <textarea
            rows="3"
            placeholder="Optional note"
            value={notes}
            onChange={e =>
              setNotes(
                e.target.value
              )
            }
          />
        </label>

        <div className="split-actions">
          <button
            className="primary"
            disabled={
              busy ||
              closed
            }
            onClick={() =>
              submitReport(
                false
              )
            }
          >
            Submit report
          </button>

          <button
            className="success"
            disabled={
              busy ||
              closed
            }
            onClick={() =>
              submitReport(
                true
              )
            }
          >
            Submit & clock out
          </button>
        </div>
      </div>

      <div className="footer-note">
        Freida’s secure
        operations system · data
        is stored on the server.
      </div>

      <Toast
        {...toast}
        onClose={() =>
          setToast(null)
        }
      />
    </div>
  );
}

function StockCard({
  title,
  status,
  setStatus,
  kg,
  setKg
}) {
  return (
    <div className="card">
      <div className="section-head">
        <h3>
          {title}
        </h3>

        <span className="muted">
          Optional kg remaining
        </span>
      </div>

      <div className="status-row">
        {STATUS_OPTIONS.map(
          option => (
            <button
              key={option}
              className={`status-option ${
                status === option
                  ? option
                  : ''
              }`}
              onClick={() =>
                setStatus(
                  option
                )
              }
            >
              {cap(option)}
            </button>
          )
        )}
      </div>

      <label className="field">
        <input
          type="number"
          min="0"
          step="0.5"
          placeholder="kg remaining (optional)"
          value={kg}
          onChange={e =>
            setKg(
              e.target.value
            )
          }
        />
      </label>
    </div>
  );
}

function SauceCard({
  title,
  value,
  onChange
}) {
  return (
    <div className="card">
      <div className="section-head">
        <h3>
          {title}
        </h3>

        <span className="muted">
          3 jars total
        </span>
      </div>

      <label className="field">
        <span>
          Jars remaining
        </span>

        <select
          value={value}
          onChange={e =>
            onChange(
              e.target.value
            )
          }
        >
          {SAUCE_LEVELS.map(
            (level, index) => (
              <option
                key={index}
                value={level}
              >
                {level === ''
                  ? 'Select'
                  : level}
              </option>
            )
          )}
        </select>
      </label>
    </div>
  );
}

export default App;