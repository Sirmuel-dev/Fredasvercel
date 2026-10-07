import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';

import {
  all,
  initializeDatabase,
  one,
  pool,
  query,
  transaction
} from './db.js';

import {
  requireAuth,
  requireOwner,
  signToken,
  canAccessBranch
} from './auth.js';

import {
  currentWeekRange,
  hoursBetween,
  isSunday,
  localDateKey,
  nowIso
} from './time.js';

const app = express();
const port = Number(process.env.PORT || 5000);

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  'http://localhost:5173'
)
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error('Origin not allowed by CORS')
      );
    },

    credentials: false
  })
);

app.use(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  })
);

const ready = initializeDatabase();

app.use(
  '/api',
  asyncHandler(async (_req, _res, next) => {
    await ready;
    next();
  })
);

/* =========================================================
   HELPERS
   ========================================================= */

const safeText = (value, max = 500) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

const asNumberOrNull = value =>
  value === '' ||
  value === null ||
  value === undefined
    ? null
    : Number(value);

const validStatus = value =>
  ['available', 'low', 'finished'].includes(value)
    ? value
    : null;

const validDateKey = value =>
  /^\d{4}-\d{2}-\d{2}$/.test(
    String(value || '')
  );

const boolValue = (value, fallback = false) => {
  if (value === undefined) return fallback;

  return Boolean(value);
};

function monthRange(monthValue) {
  const month = safeText(monthValue, 7);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return null;
  }

  const [year, monthNumber] =
    month.split('-').map(Number);

  if (
    monthNumber < 1 ||
    monthNumber > 12
  ) {
    return null;
  }

  const lastDay =
    new Date(
      Date.UTC(
        year,
        monthNumber,
        0
      )
    ).getUTCDate();

  return {
    month,
    start: `${month}-01`,
    end:
      `${month}-${String(lastDay).padStart(2, '0')}`
  };
}

async function assertBranch(req, res) {
  const branchId =
    Number(req.params.branchId);

  if (!Number.isInteger(branchId)) {
    res.status(400).json({
      error: 'Invalid branch'
    });

    return null;
  }

  const branch = await one(
    `
    SELECT
      id,
      name,
      active
    FROM branches
    WHERE id=$1
    `,
    [branchId]
  );

  if (!branch) {
    res.status(404).json({
      error: 'Branch not found'
    });

    return null;
  }

  if (
    !canAccessBranch(
      req.user,
      branchId
    )
  ) {
    res.status(403).json({
      error:
        'You cannot access this branch'
    });

    return null;
  }

  return branch;
}

async function logActivity(
  {
    branchId = null,
    userId = null,
    action,
    details = ''
  },
  client = pool
) {
  await client.query(
    `
    INSERT INTO activity_logs(
      branch_id,
      user_id,
      action,
      details,
      created_at
    )
    VALUES ($1,$2,$3,$4,$5)
    `,
    [
      branchId,
      userId,
      action,
      safeText(details, 1000),
      nowIso()
    ]
  );
}

/* =========================================================
   REPORT HELPERS
   ========================================================= */

async function hydrateReport(
  row,
  client = pool
) {
  if (!row) return null;

  const salesRows = await all(
    `
    SELECT
      mi.id,
      mi.name,
      mi.category,
      rs.quantity
    FROM report_sales rs
    JOIN menu_items mi
      ON mi.id=rs.menu_item_id
    WHERE rs.report_id=$1
    ORDER BY
      mi.sort_order,
      mi.name
    `,
    [row.id],
    client
  );

  const sales =
    Object.fromEntries(
      salesRows.map(item => [
        item.id,
        item.quantity
      ])
    );

  return {
    id: row.id,

    branchId:
      row.branch_id,

    worker:
      row.worker_name,

    userId:
      row.user_id,

    reportDate:
      row.report_date,

    submittedAt:
      row.submitted_at,

    chicken: {
      status:
        row.chicken_status,

      kg:
        row.chicken_kg === null
          ? null
          : Number(
              row.chicken_kg
            )
    },

    beef: {
      status:
        row.beef_status,

      kg:
        row.beef_kg === null
          ? null
          : Number(
              row.beef_kg
            )
    },

    sauces: {
      shawarma:
        row.shawarma_jars === null
          ? null
          : Number(
              row.shawarma_jars
            ),

      garlic:
        row.garlic_jars === null
          ? null
          : Number(
              row.garlic_jars
            )
    },

    refillBowlEmpty:
      Boolean(
        row.refill_bowl_empty
      ),

    otherItems:
      row.other_items || '',

    notes:
      row.notes || '',

    totalSold:
      Number(
        row.total_sold || 0
      ),

    sales,
    salesRows
  };
}

async function latestReport(branchId) {
  const row = await one(
    `
    SELECT
      dr.*,
      u.name AS worker_name
    FROM daily_reports dr
    JOIN users u
      ON u.id=dr.user_id
    WHERE dr.branch_id=$1
    ORDER BY dr.submitted_at DESC
    LIMIT 1
    `,
    [branchId]
  );

  return hydrateReport(row);
}

async function createNeed(
  branchId,
  reportId,
  label,
  reason,
  priority = 'high',
  client = pool
) {
  const existing =
    await one(
      `
      SELECT id
      FROM needs
      WHERE branch_id=$1
        AND label=$2
        AND resolved=FALSE
      `,
      [
        branchId,
        label
      ],
      client
    );

  if (existing) {
    return existing.id;
  }

  const inserted =
    await one(
      `
      INSERT INTO needs(
        branch_id,
        source_report_id,
        label,
        reason,
        priority,
        resolved,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,FALSE,$6
      )
      RETURNING id
      `,
      [
        branchId,
        reportId,
        label,
        reason,
        priority,
        nowIso()
      ],
      client
    );

  return inserted.id;
}

async function processReportNeeds(
  report
) {
  const {
    branchId,
    id: reportId,
    chicken,
    beef,
    sauces,
    refillBowlEmpty,
    otherItems
  } = report;

  if (
    chicken.status === 'low'
  ) {
    await createNeed(
      branchId,
      reportId,
      'Chicken',
      'Chicken was marked LOW.',
      'high'
    );
  }

  if (
    chicken.status === 'finished'
  ) {
    await createNeed(
      branchId,
      reportId,
      'Chicken',
      'Chicken was marked FINISHED.',
      'urgent'
    );
  }

  if (
    beef.status === 'low'
  ) {
    await createNeed(
      branchId,
      reportId,
      'Beef',
      'Beef was marked LOW.',
      'high'
    );
  }

  if (
    beef.status === 'finished'
  ) {
    await createNeed(
      branchId,
      reportId,
      'Beef',
      'Beef was marked FINISHED.',
      'urgent'
    );
  }

  if (
    sauces.shawarma !== null &&
    Number(sauces.shawarma) <= 1
  ) {
    await createNeed(
      branchId,
      reportId,
      'Shawarma Sauce',
      `${sauces.shawarma} jar(s) remaining.`,
      Number(sauces.shawarma) === 0
        ? 'urgent'
        : 'high'
    );
  }

  if (
    sauces.garlic !== null &&
    Number(sauces.garlic) <= 1
  ) {
    await createNeed(
      branchId,
      reportId,
      'Garlic Sauce',
      `${sauces.garlic} jar(s) remaining.`,
      Number(sauces.garlic) === 0
        ? 'urgent'
        : 'high'
    );
  }

  const items =
    safeText(
      otherItems,
      1000
    )
      .split(/[,\n]/)
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, 20);

  for (const item of items) {
    await createNeed(
      branchId,
      reportId,
      item,
      'Requested in the end-of-day report.',
      'normal'
    );
  }

  if (
    refillBowlEmpty &&
    Number(
      sauces.shawarma
    ) <= 1 &&
    Number(
      sauces.garlic
    ) <= 1
  ) {
    const active =
      await one(
        `
        SELECT id
        FROM alerts
        WHERE branch_id=$1
          AND acknowledged=FALSE
          AND restocked=FALSE
          AND message LIKE
            'Urgent sauce stock:%'
        `,
        [branchId]
      );

    if (!active) {
      await query(
        `
        INSERT INTO alerts(
          branch_id,
          source_report_id,
          message,
          acknowledged,
          restocked,
          created_at
        )
        VALUES (
          $1,$2,$3,FALSE,FALSE,$4
        )
        `,
        [
          branchId,
          reportId,
          `Urgent sauce stock: Shawarma Sauce ${sauces.shawarma}/3 jar(s), Garlic Sauce ${sauces.garlic}/3 jar(s), and the refill bowl is empty.`,
          nowIso()
        ]
      );
    }
  }
}

/* =========================================================
   INVENTORY HELPERS
   ========================================================= */

function inventoryStatus(item) {
  const current =
    Number(
      item.current_quantity || 0
    );

  const reorder =
    Number(
      item.reorder_level || 0
    );

  if (current <= 0) {
    return 'out';
  }

  if (
    reorder > 0 &&
    current <= reorder
  ) {
    return 'low';
  }

  return 'good';
}

async function applyInventoryMovement(
  {
    branchId,
    inventoryItemId,
    userId = null,
    quantityChange,
    movementType,
    referenceType = null,
    referenceId = null,
    note = ''
  },
  client = pool
) {
  const item =
    await one(
      `
      SELECT *
      FROM inventory_items
      WHERE id=$1
        AND branch_id=$2
      FOR UPDATE
      `,
      [
        inventoryItemId,
        branchId
      ],
      client
    );

  if (!item) {
    throw new Error(
      'Inventory item not found'
    );
  }

  const change =
    Number(quantityChange);

  if (
    !Number.isFinite(change) ||
    change === 0
  ) {
    throw new Error(
      'Inventory quantity change must not be zero'
    );
  }

  const before =
    Number(
      item.current_quantity || 0
    );

  const after =
    Number(
      (
        before + change
      ).toFixed(3)
    );

  await client.query(
    `
    UPDATE inventory_items
    SET
      current_quantity=$1,
      updated_at=NOW()
    WHERE id=$2
    `,
    [
      after,
      item.id
    ]
  );

  await client.query(
    `
    INSERT INTO stock_movements(
      branch_id,
      inventory_item_id,
      user_id,
      movement_type,
      quantity_change,
      quantity_before,
      quantity_after,
      reference_type,
      reference_id,
      note,
      created_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,$10,$11
    )
    `,
    [
      branchId,
      item.id,
      userId,
      safeText(
        movementType,
        50
      ),
      change,
      before,
      after,
      referenceType,
      referenceId,
      safeText(note, 500),
      nowIso()
    ]
  );

  const reorder =
    Number(
      item.reorder_level || 0
    );

  const alertPattern =
    `Low inventory: ${item.name}%`;

  if (
    after <= 0 ||
    (
      reorder > 0 &&
      after <= reorder
    )
  ) {
    const existing =
      await one(
        `
        SELECT id
        FROM alerts
        WHERE branch_id=$1
          AND acknowledged=FALSE
          AND restocked=FALSE
          AND message LIKE $2
        LIMIT 1
        `,
        [
          branchId,
          alertPattern
        ],
        client
      );

    if (!existing) {
      await client.query(
        `
        INSERT INTO alerts(
          branch_id,
          source_report_id,
          message,
          acknowledged,
          restocked,
          created_at
        )
        VALUES (
          $1,NULL,$2,FALSE,FALSE,$3
        )
        `,
        [
          branchId,
          `Low inventory: ${item.name} has ${after} ${item.unit}(s) remaining. Reorder level: ${reorder}.`,
          nowIso()
        ]
      );
    }

    await createNeed(
      branchId,
      null,
      item.name,
      `Inventory is low: ${after} ${item.unit}(s) remaining.`,
      after <= 0
        ? 'urgent'
        : 'high',
      client
    );
  } else {
    await client.query(
      `
      UPDATE alerts
      SET
        acknowledged=TRUE,
        restocked=TRUE
      WHERE branch_id=$1
        AND restocked=FALSE
        AND message LIKE $2
      `,
      [
        branchId,
        alertPattern
      ]
    );

    await client.query(
      `
      UPDATE needs
      SET
        resolved=TRUE,
        resolved_at=$1
      WHERE branch_id=$2
        AND label=$3
        AND resolved=FALSE
      `,
      [
        nowIso(),
        branchId,
        item.name
      ]
    );
  }

  return {
    ...item,
    current_quantity:
      after
  };
}

/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await one(
      'SELECT 1 AS ok'
    );

    res.json({
      ok: true,
      database: 'postgres'
    });
  })
);

/* =========================================================
   AUTH
   ========================================================= */

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const username =
      safeText(
        req.body.username,
        80
      ).toLowerCase();

    const password =
      String(
        req.body.password || ''
      );

    if (
      !username ||
      !password
    ) {
      return res.status(400).json({
        error:
          'Username and password are required'
      });
    }

    const user =
      await one(
        `
        SELECT
          id,
          username,
          password_hash,
          name,
          role,
          branch_id AS "branchId",
          active
        FROM users
        WHERE LOWER(username)=LOWER($1)
        `,
        [username]
      );

    if (
      !user ||
      !user.active ||
      !await bcrypt.compare(
        password,
        user.password_hash
      )
    ) {
      return res.status(401).json({
        error:
          'Invalid username or password'
      });
    }

    const token =
      signToken(user);

    await logActivity({
      branchId:
        user.branchId,

      userId:
        user.id,

      action:
        'login',

      details:
        `${user.name} signed in`
    });

    res.json({
      token,

      user: {
        id:
          user.id,

        username:
          user.username,

        name:
          user.name,

        role:
          user.role,

        branchId:
          user.branchId
      }
    });
  })
);

app.get(
  '/api/auth/me',
  requireAuth,
  (req, res) => {
    res.json({
      user:
        req.user
    });
  }
);

const changePasswordHandler =
  asyncHandler(
    async (req, res) => {
      const currentPassword =
        String(
          req.body.currentPassword ||
          ''
        );

      const newPassword =
        String(
          req.body.newPassword ||
          ''
        );

      if (!currentPassword) {
        return res.status(400).json({
          error:
            'Current password is required'
        });
      }

      if (
        newPassword.length < 8
      ) {
        return res.status(400).json({
          error:
            'New password must be at least 8 characters'
        });
      }

      if (
        currentPassword ===
        newPassword
      ) {
        return res.status(400).json({
          error:
            'New password must be different from the current password'
        });
      }

      const row =
        await one(
          `
          SELECT password_hash
          FROM users
          WHERE id=$1
          `,
          [req.user.id]
        );

      if (
        !row ||
        !await bcrypt.compare(
          currentPassword,
          row.password_hash
        )
      ) {
        return res.status(401).json({
          error:
            'Current password is incorrect'
        });
      }

      const hash =
        await bcrypt.hash(
          newPassword,
          12
        );

      await query(
        `
        UPDATE users
        SET password_hash=$1
        WHERE id=$2
        `,
        [
          hash,
          req.user.id
        ]
      );

      await logActivity({
        branchId:
          req.user.branchId,

        userId:
          req.user.id,

        action:
          'password_changed',

        details:
          'Password changed'
      });

      res.json({
        ok: true
      });
    }
  );

app.patch(
  '/api/auth/change-password',
  requireAuth,
  requireOwner,
  changePasswordHandler
);

app.post(
  '/api/auth/change-password',
  requireAuth,
  requireOwner,
  changePasswordHandler
);

/* =========================================================
   BRANCHES
   ========================================================= */

app.get(
  '/api/branches',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (
      req.user.role === 'owner'
    ) {
      return res.json({
        branches:
          await all(
            `
            SELECT
              id,
              name,
              active
            FROM branches
            ORDER BY
              active DESC,
              id
            `
          )
      });
    }

    const branch =
      await one(
        `
        SELECT
          id,
          name,
          active
        FROM branches
        WHERE id=$1
          AND active=TRUE
        `,
        [req.user.branchId]
      );

    res.json({
      branches:
        branch
          ? [branch]
          : []
    });
  })
);

app.post(
  '/api/branches',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const name =
      safeText(
        req.body.name,
        80
      );

    if (!name) {
      return res.status(400).json({
        error:
          'Branch name is required'
      });
    }

    try {
      const branch =
        await one(
          `
          INSERT INTO branches(
            name,
            active
          )
          VALUES ($1,TRUE)
          RETURNING *
          `,
          [name]
        );

      await logActivity({
        userId:
          req.user.id,

        action:
          'branch_created',

        details:
          `Created branch ${name}`
      });

      res.status(201).json({
        branch
      });
    } catch (err) {
      if (
        err.code === '23505'
      ) {
        return res.status(409).json({
          error:
            'A branch with that name already exists'
        });
      }

      throw err;
    }
  })
);

app.patch(
  '/api/branches/:branchId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const name =
      req.body.name === undefined
        ? branch.name
        : safeText(
            req.body.name,
            80
          );

    const active =
      req.body.active === undefined
        ? branch.active
        : Boolean(
            req.body.active
          );

    if (!name) {
      return res.status(400).json({
        error:
          'Branch name is required'
      });
    }

    const updated =
      await one(
        `
        UPDATE branches
        SET
          name=$1,
          active=$2
        WHERE id=$3
        RETURNING *
        `,
        [
          name,
          active,
          branch.id
        ]
      );

    await logActivity({
      userId:
        req.user.id,

      branchId:
        branch.id,

      action:
        'branch_updated',

      details:
        `Updated branch ${name}`
    });

    res.json({
      branch:
        updated
    });
  })
);

/* =========================================================
   MENU
   ========================================================= */

app.get(
  '/api/menu',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      items:
        await all(
          `
          SELECT
            id,
            name,
            category,
            sort_order AS "sortOrder"
          FROM menu_items
          WHERE active=TRUE
          ORDER BY
            CASE
              WHEN category='food'
                THEN 1
              WHEN category='drink'
                THEN 2
              ELSE 3
            END,
            sort_order,
            name
          `
        )
    });
  })
);

app.get(
  '/api/branches/:branchId/menu',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const items =
      await all(
        `
        SELECT
          mi.id,
          mi.name,
          mi.category,
          mi.sort_order AS "sortOrder",
          mi.active,

          mil.inventory_item_id
            AS "inventoryItemId",

          mil.stock_per_sale
            AS "stockPerSale",

          ii.name
            AS "inventoryItemName"

        FROM menu_items mi

        LEFT JOIN menu_inventory_links mil
          ON mil.menu_item_id=mi.id
          AND mil.branch_id=$1

        LEFT JOIN inventory_items ii
          ON ii.id=
            mil.inventory_item_id

        ORDER BY
          mi.category,
          mi.sort_order,
          mi.name
        `,
        [branch.id]
      );

    res.json({
      items
    });
  })
);

app.post(
  '/api/menu',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const name =
      safeText(
        req.body.name,
        120
      );

    const category =
      safeText(
        req.body.category || 'food',
        30
      ).toLowerCase();

    const sortOrder =
      Number(
        req.body.sortOrder || 0
      );

    if (!name) {
      return res.status(400).json({
        error:
          'Menu item name is required'
      });
    }

    try {
      const item =
        await one(
          `
          INSERT INTO menu_items(
            name,
            category,
            sort_order,
            active
          )
          VALUES (
            $1,$2,$3,TRUE
          )
          RETURNING *
          `,
          [
            name,
            category,
            sortOrder
          ]
        );

      const branchId =
        Number(
          req.body.branchId
        );

      const inventoryItemId =
        Number(
          req.body.inventoryItemId
        );

      if (
        Number.isInteger(branchId) &&
        Number.isInteger(
          inventoryItemId
        )
      ) {
        await query(
          `
          INSERT INTO menu_inventory_links(
            branch_id,
            menu_item_id,
            inventory_item_id,
            stock_per_sale,
            active
          )
          VALUES (
            $1,$2,$3,$4,TRUE
          )

          ON CONFLICT(
            branch_id,
            menu_item_id
          )

          DO UPDATE SET
            inventory_item_id=
              EXCLUDED.inventory_item_id,
            stock_per_sale=
              EXCLUDED.stock_per_sale,
            active=TRUE
          `,
          [
            branchId,
            item.id,
            inventoryItemId,
            Number(
              req.body.stockPerSale ||
              1
            )
          ]
        );
      }

      await logActivity({
        userId:
          req.user.id,

        action:
          'menu_item_added',

        details:
          `Added menu item ${name}`
      });

      res.status(201).json({
        item
      });
    } catch (err) {
      if (
        err.code === '23505'
      ) {
        return res.status(409).json({
          error:
            'That menu item already exists'
        });
      }

      throw err;
    }
  })
);

app.patch(
  '/api/menu/:menuId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const menuId =
      Number(
        req.params.menuId
      );

    const current =
      await one(
        `
        SELECT *
        FROM menu_items
        WHERE id=$1
        `,
        [menuId]
      );

    if (!current) {
      return res.status(404).json({
        error:
          'Menu item not found'
      });
    }

    const item =
      await one(
        `
        UPDATE menu_items
        SET
          name=$1,
          category=$2,
          sort_order=$3,
          active=$4
        WHERE id=$5
        RETURNING *
        `,
        [
          req.body.name === undefined
            ? current.name
            : safeText(
                req.body.name,
                120
              ),

          req.body.category === undefined
            ? current.category
            : safeText(
                req.body.category,
                30
              ).toLowerCase(),

          req.body.sortOrder === undefined
            ? current.sort_order
            : Number(
                req.body.sortOrder
              ),

          req.body.active === undefined
            ? current.active
            : Boolean(
                req.body.active
              ),

          menuId
        ]
      );

    const branchId =
      Number(
        req.body.branchId
      );

    const inventoryItemId =
      Number(
        req.body.inventoryItemId
      );

    if (
      Number.isInteger(branchId)
    ) {
      if (
        Number.isInteger(
          inventoryItemId
        )
      ) {
        await query(
          `
          INSERT INTO menu_inventory_links(
            branch_id,
            menu_item_id,
            inventory_item_id,
            stock_per_sale,
            active
          )
          VALUES (
            $1,$2,$3,$4,TRUE
          )

          ON CONFLICT(
            branch_id,
            menu_item_id
          )

          DO UPDATE SET
            inventory_item_id=
              EXCLUDED.inventory_item_id,
            stock_per_sale=
              EXCLUDED.stock_per_sale,
            active=TRUE
          `,
          [
            branchId,
            menuId,
            inventoryItemId,
            Number(
              req.body.stockPerSale ||
              1
            )
          ]
        );
      } else if (
        req.body.inventoryItemId === null
      ) {
        await query(
          `
          DELETE
          FROM menu_inventory_links
          WHERE branch_id=$1
            AND menu_item_id=$2
          `,
          [
            branchId,
            menuId
          ]
        );
      }
    }

    await logActivity({
      userId:
        req.user.id,

      action:
        'menu_item_updated',

      details:
        `Updated ${item.name}`
    });

    res.json({
      item
    });
  })
);

app.delete(
  '/api/menu/:menuId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const item =
      await one(
        `
        UPDATE menu_items
        SET active=FALSE
        WHERE id=$1
        RETURNING *
        `,
        [
          Number(
            req.params.menuId
          )
        ]
      );

    if (!item) {
      return res.status(404).json({
        error:
          'Menu item not found'
      });
    }

    await logActivity({
      userId:
        req.user.id,

      action:
        'menu_item_deactivated',

      details:
        `Deactivated ${item.name}`
    });

    res.json({
      ok: true,
      item
    });
  })
);

/* =========================================================
   STAFF
   ========================================================= */

app.get(
  '/api/branches/:branchId/staff',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const includeInactive =
      req.query.includeInactive === '1';

    const staff =
      await all(
        `
        SELECT
          id,
          username,
          name,
          role,
          active,
          branch_id AS "branchId"
        FROM users
        WHERE branch_id=$1
          AND role='worker'
          ${
            includeInactive
              ? ''
              : 'AND active=TRUE'
          }
        ORDER BY
          active DESC,
          name
        `,
        [branch.id]
      );

    res.json({
      branch,
      staff
    });
  })
);

app.post(
  '/api/branches/:branchId/staff',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const name =
      safeText(
        req.body.name,
        80
      );

    const username =
      safeText(
        req.body.username,
        80
      ).toLowerCase();

    const password =
      String(
        req.body.password || ''
      );

    if (
      !name ||
      !username ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          'Name, username and a password of at least 8 characters are required'
      });
    }

    try {
      const hash =
        await bcrypt.hash(
          password,
          12
        );

      const worker =
        await one(
          `
          INSERT INTO users(
            username,
            password_hash,
            name,
            role,
            branch_id,
            active
          )
          VALUES (
            $1,$2,$3,'worker',$4,TRUE
          )
          RETURNING
            id,
            username,
            name,
            role,
            branch_id AS "branchId",
            active
          `,
          [
            username,
            hash,
            name,
            branch.id
          ]
        );

      await logActivity({
        branchId:
          branch.id,

        userId:
          req.user.id,

        action:
          'worker_added',

        details:
          `Added ${name}`
      });

      res.status(201).json({
        worker
      });
    } catch (err) {
      if (
        err.code === '23505'
      ) {
        return res.status(409).json({
          error:
            'That username is already in use'
        });
      }

      throw err;
    }
  })
);

app.patch(
  '/api/staff/:staffId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const staffId =
      Number(
        req.params.staffId
      );

    const worker =
      await one(
        `
        SELECT *
        FROM users
        WHERE id=$1
          AND role='worker'
        `,
        [staffId]
      );

    if (!worker) {
      return res.status(404).json({
        error:
          'Worker not found'
      });
    }

    let branchId =
      worker.branch_id;

    if (
      req.body.branchId !== undefined
    ) {
      branchId =
        Number(
          req.body.branchId
        );

      const branch =
        await one(
          `
          SELECT id
          FROM branches
          WHERE id=$1
          `,
          [branchId]
        );

      if (!branch) {
        return res.status(400).json({
          error:
            'Invalid branch'
        });
      }
    }

    try {
      const updated =
        await one(
          `
          UPDATE users
          SET
            name=$1,
            username=$2,
            branch_id=$3,
            active=$4
          WHERE id=$5
          RETURNING
            id,
            username,
            name,
            role,
            branch_id AS "branchId",
            active
          `,
          [
            req.body.name === undefined
              ? worker.name
              : safeText(
                  req.body.name,
                  80
                ),

            req.body.username === undefined
              ? worker.username
              : safeText(
                  req.body.username,
                  80
                ).toLowerCase(),

            branchId,

            req.body.active === undefined
              ? worker.active
              : Boolean(
                  req.body.active
                ),

            staffId
          ]
        );

      await logActivity({
        branchId:
          updated.branchId,

        userId:
          req.user.id,

        action:
          'worker_updated',

        details:
          `Updated ${updated.name}`
      });

      res.json({
        worker:
          updated
      });
    } catch (err) {
      if (
        err.code === '23505'
      ) {
        return res.status(409).json({
          error:
            'That username is already in use'
        });
      }

      throw err;
    }
  })
);

app.patch(
  '/api/staff/:staffId/reset-password',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const staffId =
      Number(
        req.params.staffId
      );

    const newPassword =
      String(
        req.body.newPassword || ''
      );

    if (
      newPassword.length < 8
    ) {
      return res.status(400).json({
        error:
          'Password must be at least 8 characters'
      });
    }

    const worker =
      await one(
        `
        SELECT
          id,
          name,
          branch_id
        FROM users
        WHERE id=$1
          AND role='worker'
        `,
        [staffId]
      );

    if (!worker) {
      return res.status(404).json({
        error:
          'Worker not found'
      });
    }

    const hash =
      await bcrypt.hash(
        newPassword,
        12
      );

    await query(
      `
      UPDATE users
      SET password_hash=$1
      WHERE id=$2
      `,
      [
        hash,
        staffId
      ]
    );

    await logActivity({
      branchId:
        worker.branch_id,

      userId:
        req.user.id,

      action:
        'worker_password_reset',

      details:
        `Reset password for ${worker.name}`
    });

    res.json({
      ok: true
    });
  })
);

app.delete(
  '/api/staff/:staffId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const staffId =
      Number(
        req.params.staffId
      );

    const worker =
      await one(
        `
        SELECT
          id,
          username,
          name,
          role,
          branch_id AS "branchId",
          active
        FROM users
        WHERE id=$1
        `,
        [staffId]
      );

    if (
      !worker ||
      worker.role !== 'worker'
    ) {
      return res.status(404).json({
        error:
          'Worker not found'
      });
    }

    if (!worker.active) {
      return res.json({
        ok: true,
        worker
      });
    }

    await query(
      `
      UPDATE users
      SET active=FALSE
      WHERE id=$1
      `,
      [worker.id]
    );

    await logActivity({
      branchId:
        worker.branchId,

      userId:
        req.user.id,

      action:
        'worker_removed',

      details:
        `Removed ${worker.name}. Historical records were preserved.`
    });

    res.json({
      ok: true,

      worker: {
        ...worker,
        active: false
      }
    });
  })
);

/* =========================================================
   ATTENDANCE
   ========================================================= */

app.get(
  '/api/attendance/today',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.branchId) {
      return res.json({
        shift: null,
        closed: isSunday()
      });
    }

    const shift =
      await one(
        `
        SELECT *
        FROM attendance
        WHERE user_id=$1
          AND work_date=$2
        `,
        [
          req.user.id,
          localDateKey()
        ]
      );

    res.json({
      shift:
        shift
          ? {
              ...shift,

              hours:
                shift.clock_out
                  ? hoursBetween(
                      shift.clock_in,
                      shift.clock_out,
                      shift.break_minutes
                    )
                  : null
            }
          : null,

      closed:
        isSunday()
    });
  })
);

app.post(
  '/api/attendance/clock-in',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (
      req.user.role === 'owner' ||
      !req.user.branchId
    ) {
      return res.status(403).json({
        error:
          'Worker account required'
      });
    }

    if (isSunday()) {
      return res.status(400).json({
        error:
          'Freida’s is closed on Sunday'
      });
    }

    const date =
      localDateKey();

    const existing =
      await one(
        `
        SELECT *
        FROM attendance
        WHERE user_id=$1
          AND work_date=$2
        `,
        [
          req.user.id,
          date
        ]
      );

    if (existing) {
      return res.status(409).json({
        error:
          existing.clock_out
            ? 'Today’s shift is already completed'
            : 'You are already clocked in'
      });
    }

    const shift =
      await one(
        `
        INSERT INTO attendance(
          user_id,
          branch_id,
          work_date,
          clock_in
        )
        VALUES ($1,$2,$3,$4)
        RETURNING *
        `,
        [
          req.user.id,
          req.user.branchId,
          date,
          nowIso()
        ]
      );

    await logActivity({
      branchId:
        req.user.branchId,

      userId:
        req.user.id,

      action:
        'clock_in',

      details:
        'Clocked in'
    });

    res.status(201).json({
      shift
    });
  })
);

app.post(
  '/api/attendance/break-start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const shift =
      await one(
        `
        SELECT *
        FROM attendance
        WHERE user_id=$1
          AND work_date=$2
          AND clock_out IS NULL
        `,
        [
          req.user.id,
          localDateKey()
        ]
      );

    if (!shift) {
      return res.status(400).json({
        error:
          'Clock in before starting a break'
      });
    }

    if (
      shift.break_started_at
    ) {
      return res.status(409).json({
        error:
          'Break already started'
      });
    }

    const updated =
      await one(
        `
        UPDATE attendance
        SET break_started_at=$1
        WHERE id=$2
        RETURNING *
        `,
        [
          nowIso(),
          shift.id
        ]
      );

    await logActivity({
      branchId:
        req.user.branchId,

      userId:
        req.user.id,

      action:
        'break_start',

      details:
        'Started break'
    });

    res.json({
      shift:
        updated
    });
  })
);

app.post(
  '/api/attendance/break-end',
  requireAuth,
  asyncHandler(async (req, res) => {
    const shift =
      await one(
        `
        SELECT *
        FROM attendance
        WHERE user_id=$1
          AND work_date=$2
          AND clock_out IS NULL
        `,
        [
          req.user.id,
          localDateKey()
        ]
      );

    if (
      !shift ||
      !shift.break_started_at
    ) {
      return res.status(400).json({
        error:
          'No active break'
      });
    }

    const mins =
      Math.max(
        0,
        Math.round(
          (
            Date.now() -
            new Date(
              shift.break_started_at
            ).getTime()
          ) / 60000
        )
      );

    const updated =
      await one(
        `
        UPDATE attendance
        SET
          break_minutes=
            break_minutes+$1,
          break_started_at=NULL
        WHERE id=$2
        RETURNING *
        `,
        [
          mins,
          shift.id
        ]
      );

    await logActivity({
      branchId:
        req.user.branchId,

      userId:
        req.user.id,

      action:
        'break_end',

      details:
        `Ended break (${mins} min)`
    });

    res.json({
      shift:
        updated
    });
  })
);

app.post(
  '/api/attendance/clock-out',
  requireAuth,
  asyncHandler(async (req, res) => {
    const shift =
      await one(
        `
        SELECT *
        FROM attendance
        WHERE user_id=$1
          AND work_date=$2
          AND clock_out IS NULL
        `,
        [
          req.user.id,
          localDateKey()
        ]
      );

    if (!shift) {
      return res.status(400).json({
        error:
          'No active shift'
      });
    }

    let extraBreak = 0;

    if (
      shift.break_started_at
    ) {
      extraBreak =
        Math.max(
          0,
          Math.round(
            (
              Date.now() -
              new Date(
                shift.break_started_at
              ).getTime()
            ) / 60000
          )
        );
    }

    const done =
      await one(
        `
        UPDATE attendance
        SET
          clock_out=$1,
          break_minutes=
            break_minutes+$2,
          break_started_at=NULL
        WHERE id=$3
        RETURNING *
        `,
        [
          nowIso(),
          extraBreak,
          shift.id
        ]
      );

    const hours =
      hoursBetween(
        done.clock_in,
        done.clock_out,
        done.break_minutes
      );

    await logActivity({
      branchId:
        req.user.branchId,

      userId:
        req.user.id,

      action:
        'clock_out',

      details:
        `Clocked out after ${hours} h`
    });

    res.json({
      shift: {
        ...done,
        hours
      }
    });
  })
);

app.get(
  '/api/branches/:branchId/attendance',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const {
      start,
      end
    } =
      currentWeekRange();

    const from =
      safeText(
        req.query.from,
        10
      ) || start;

    const to =
      safeText(
        req.query.to,
        10
      ) || end;

    const rows =
      (
        await all(
          `
          SELECT
            a.*,
            u.name AS worker_name
          FROM attendance a
          JOIN users u
            ON u.id=a.user_id
          WHERE a.branch_id=$1
            AND a.work_date
              BETWEEN $2 AND $3
          ORDER BY
            a.work_date DESC,
            a.clock_in DESC
          `,
          [
            branch.id,
            from,
            to
          ]
        )
      ).map(row => ({
        ...row,

        hours:
          row.clock_out
            ? hoursBetween(
                row.clock_in,
                row.clock_out,
                row.break_minutes
              )
            : null
      }));

    res.json({
      rows,
      from,
      to
    });
  })
);

app.patch(
  '/api/attendance/:attendanceId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const id =
      Number(
        req.params.attendanceId
      );

    const row =
      await one(
        `
        SELECT *
        FROM attendance
        WHERE id=$1
        `,
        [id]
      );

    if (!row) {
      return res.status(404).json({
        error:
          'Attendance record not found'
      });
    }

    const workDate =
      req.body.workDate === undefined
        ? row.work_date
        : safeText(
            req.body.workDate,
            10
          );

    if (
      !validDateKey(
        String(workDate)
          .slice(0, 10)
      )
    ) {
      return res.status(400).json({
        error:
          'Invalid work date'
      });
    }

    const updated =
      await one(
        `
        UPDATE attendance
        SET
          work_date=$1,
          clock_in=$2,
          clock_out=$3,
          break_minutes=$4
        WHERE id=$5
        RETURNING *
        `,
        [
          workDate,

          req.body.clockIn === undefined
            ? row.clock_in
            : req.body.clockIn,

          req.body.clockOut === undefined
            ? row.clock_out
            : req.body.clockOut,

          req.body.breakMinutes === undefined
            ? row.break_minutes
            : Math.max(
                0,
                Number(
                  req.body.breakMinutes
                ) || 0
              ),

          id
        ]
      );

    await logActivity({
      branchId:
        row.branch_id,

      userId:
        req.user.id,

      action:
        'attendance_corrected',

      details:
        `Corrected attendance record ${id}`
    });

    res.json({
      attendance:
        updated
    });
  })
);

/* =========================================================
   DAILY REPORTS + AUTOMATIC DRINK INVENTORY DEDUCTION
   ========================================================= */

app.post(
  '/api/branches/:branchId/reports',
  requireAuth,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    if (
      req.user.role === 'owner'
    ) {
      return res.status(403).json({
        error:
          'Use a worker account to submit a daily report'
      });
    }

    if (isSunday()) {
      return res.status(400).json({
        error:
          'Freida’s is closed on Sunday'
      });
    }

    const reportDate =
      localDateKey();

    const todayAttendance =
      await one(
        `
        SELECT id
        FROM attendance
        WHERE user_id=$1
          AND work_date=$2
        `,
        [
          req.user.id,
          reportDate
        ]
      );

    if (!todayAttendance) {
      return res.status(400).json({
        error:
          'Clock in before submitting the end-of-day report'
      });
    }

    const alreadySubmitted =
      await one(
        `
        SELECT id
        FROM daily_reports
        WHERE branch_id=$1
          AND user_id=$2
          AND report_date=$3
        LIMIT 1
        `,
        [
          branch.id,
          req.user.id,
          reportDate
        ]
      );

    if (alreadySubmitted) {
      return res.status(409).json({
        error:
          'You have already submitted today’s report'
      });
    }

    const chickenStatus =
      validStatus(
        req.body.chickenStatus
      );

    const beefStatus =
      validStatus(
        req.body.beefStatus
      );

    const shawarmaJars =
      asNumberOrNull(
        req.body.shawarmaJars
      );

    const garlicJars =
      asNumberOrNull(
        req.body.garlicJars
      );

    if (
      !chickenStatus ||
      !beefStatus
    ) {
      return res.status(400).json({
        error:
          'Chicken and Beef status are required'
      });
    }

    if (
      shawarmaJars === null ||
      garlicJars === null ||
      shawarmaJars < 0 ||
      shawarmaJars > 3 ||
      garlicJars < 0 ||
      garlicJars > 3
    ) {
      return res.status(400).json({
        error:
          'Sauce jars must be recorded between 0 and 3'
      });
    }

    const sales =
      req.body.sales &&
      typeof req.body.sales === 'object'
        ? req.body.sales
        : {};

    const menu =
      await all(
        `
        SELECT id
        FROM menu_items
        WHERE active=TRUE
        `
      );

    const allowed =
      new Set(
        menu.map(
          item =>
            String(item.id)
        )
      );

    let totalSold = 0;

    const normalizedSales = [];

    for (
      const [key, raw]
      of Object.entries(sales)
    ) {
      if (
        !allowed.has(
          String(key)
        )
      ) {
        continue;
      }

      const qty =
        Math.max(
          0,
          Math.min(
            999,
            Math.floor(
              Number(raw) || 0
            )
          )
        );

      totalSold += qty;

      normalizedSales.push([
        Number(key),
        qty
      ]);
    }

    const submittedAt =
      nowIso();

    const reportId =
      await transaction(
        async client => {
          const result =
            await client.query(
              `
              INSERT INTO daily_reports(
                branch_id,
                user_id,
                report_date,
                submitted_at,
                chicken_status,
                chicken_kg,
                beef_status,
                beef_kg,
                shawarma_jars,
                garlic_jars,
                refill_bowl_empty,
                other_items,
                notes,
                total_sold
              )
              VALUES (
                $1,$2,$3,$4,$5,$6,$7,
                $8,$9,$10,$11,$12,$13,$14
              )
              RETURNING id
              `,
              [
                branch.id,
                req.user.id,
                reportDate,
                submittedAt,
                chickenStatus,
                asNumberOrNull(
                  req.body.chickenKg
                ),
                beefStatus,
                asNumberOrNull(
                  req.body.beefKg
                ),
                shawarmaJars,
                garlicJars,
                Boolean(
                  req.body.refillBowlEmpty
                ),
                safeText(
                  req.body.otherItems,
                  1000
                ),
                safeText(
                  req.body.notes,
                  2000
                ),
                totalSold
              ]
            );

          const id =
            result.rows[0].id;

          for (
            const [
              menuId,
              qty
            ]
            of normalizedSales
          ) {
            await client.query(
              `
              INSERT INTO report_sales(
                report_id,
                menu_item_id,
                quantity
              )
              VALUES ($1,$2,$3)
              `,
              [
                id,
                menuId,
                qty
              ]
            );

            if (qty <= 0) {
              continue;
            }

            const link =
              await one(
                `
                SELECT
                  mil.inventory_item_id,
                  mil.stock_per_sale,
                  mi.name AS menu_name
                FROM menu_inventory_links mil
                JOIN menu_items mi
                  ON mi.id=mil.menu_item_id
                WHERE mil.branch_id=$1
                  AND mil.menu_item_id=$2
                  AND mil.active=TRUE
                `,
                [
                  branch.id,
                  menuId
                ],
                client
              );

            if (link) {
              const deduction =
                Number(qty) *
                Number(
                  link.stock_per_sale ||
                  1
                );

              await applyInventoryMovement(
                {
                  branchId:
                    branch.id,

                  inventoryItemId:
                    link.inventory_item_id,

                  userId:
                    req.user.id,

                  quantityChange:
                    -deduction,

                  movementType:
                    'sale',

                  referenceType:
                    'daily_report',

                  referenceId:
                    id,

                  note:
                    `${qty} ${link.menu_name} sold`
                },
                client
              );
            }
          }

          return id;
        }
      );

    const row =
      await one(
        `
        SELECT
          dr.*,
          u.name AS worker_name
        FROM daily_reports dr
        JOIN users u
          ON u.id=dr.user_id
        WHERE dr.id=$1
        `,
        [reportId]
      );

    const report =
      await hydrateReport(row);

    await processReportNeeds(
      report
    );

    await logActivity({
      branchId:
        branch.id,

      userId:
        req.user.id,

      action:
        'report_submitted',

      details:
        `Submitted end-of-day report (${totalSold} items sold)`
    });

    res.status(201).json({
      report
    });
  })
);

app.get(
  '/api/branches/:branchId/reports',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const limit =
      Math.max(
        1,
        Math.min(
          200,
          Number(
            req.query.limit || 50
          )
        )
      );

    const rows =
      await all(
        `
        SELECT
          dr.*,
          u.name AS worker_name
        FROM daily_reports dr
        JOIN users u
          ON u.id=dr.user_id
        WHERE dr.branch_id=$1
        ORDER BY dr.submitted_at DESC
        LIMIT $2
        `,
        [
          branch.id,
          limit
        ]
      );

    const reports = [];

    for (const row of rows) {
      reports.push(
        await hydrateReport(row)
      );
    }

    res.json({
      reports
    });
  })
);

/* =========================================================
   NEEDS + ALERTS
   ========================================================= */

app.get(
  '/api/branches/:branchId/needs',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const needs =
      await all(
        `
        SELECT *
        FROM needs
        WHERE branch_id=$1
          AND resolved=FALSE
        ORDER BY
          CASE priority
            WHEN 'urgent'
              THEN 1
            WHEN 'high'
              THEN 2
            ELSE 3
          END,
          created_at DESC
        `,
        [branch.id]
      );

    res.json({
      needs
    });
  })
);

app.patch(
  '/api/needs/:needId/resolve',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const need =
      await one(
        `
        SELECT *
        FROM needs
        WHERE id=$1
        `,
        [
          Number(
            req.params.needId
          )
        ]
      );

    if (!need) {
      return res.status(404).json({
        error:
          'Need not found'
      });
    }

    await query(
      `
      UPDATE needs
      SET
        resolved=TRUE,
        resolved_at=$1
      WHERE id=$2
      `,
      [
        nowIso(),
        need.id
      ]
    );

    await logActivity({
      branchId:
        need.branch_id,

      userId:
        req.user.id,

      action:
        'need_resolved',

      details:
        `Resolved ${need.label}`
    });

    res.json({
      ok: true
    });
  })
);

app.get(
  '/api/branches/:branchId/alerts',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const alerts =
      await all(
        `
        SELECT *
        FROM alerts
        WHERE branch_id=$1
          AND restocked=FALSE
        ORDER BY created_at DESC
        `,
        [branch.id]
      );

    res.json({
      alerts
    });
  })
);

app.patch(
  '/api/alerts/:alertId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const alert =
      await one(
        `
        SELECT *
        FROM alerts
        WHERE id=$1
        `,
        [
          Number(
            req.params.alertId
          )
        ]
      );

    if (!alert) {
      return res.status(404).json({
        error:
          'Alert not found'
      });
    }

    const acknowledged =
      req.body.acknowledged
        ? true
        : Boolean(
            alert.acknowledged
          );

    const restocked =
      req.body.restocked
        ? true
        : Boolean(
            alert.restocked
          );

    await query(
      `
      UPDATE alerts
      SET
        acknowledged=$1,
        restocked=$2
      WHERE id=$3
      `,
      [
        acknowledged,
        restocked,
        alert.id
      ]
    );

    if (
      restocked &&
      alert.message.startsWith(
        'Urgent sauce stock:'
      )
    ) {
      await query(
        `
        UPDATE needs
        SET
          resolved=TRUE,
          resolved_at=$1
        WHERE branch_id=$2
          AND resolved=FALSE
          AND label IN (
            'Shawarma Sauce',
            'Garlic Sauce'
          )
        `,
        [
          nowIso(),
          alert.branch_id
        ]
      );
    }

    await logActivity({
      branchId:
        alert.branch_id,

      userId:
        req.user.id,

      action:
        restocked
          ? 'alert_restocked'
          : 'alert_acknowledged',

      details:
        alert.message
    });

    res.json({
      ok: true
    });
  })
);

/* =========================================================
   SUPPLIERS
   ========================================================= */

app.get(
  '/api/branches/:branchId/suppliers',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const includeInactive =
      req.query.includeInactive === '1';

    const suppliers =
      await all(
        `
        SELECT
          s.*,

          (
            SELECT COUNT(*)::int
            FROM purchases p
            WHERE p.supplier_id=s.id
              AND p.status<>'voided'
          ) AS purchase_count,

          (
            SELECT COALESCE(
              SUM(p.total_amount),
              0
            )
            FROM purchases p
            WHERE p.supplier_id=s.id
              AND p.status<>'voided'
          ) AS purchase_total

        FROM suppliers s

        WHERE s.branch_id=$1
          ${
            includeInactive
              ? ''
              : 'AND s.active=TRUE'
          }

        ORDER BY
          s.active DESC,
          s.name
        `,
        [branch.id]
      );

    res.json({
      suppliers
    });
  })
);

app.post(
  '/api/branches/:branchId/suppliers',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const name =
      safeText(
        req.body.name,
        160
      );

    if (!name) {
      return res.status(400).json({
        error:
          'Supplier name is required'
      });
    }

    try {
      const supplier =
        await one(
          `
          INSERT INTO suppliers(
            branch_id,
            name,
            company_code,
            vat_code,
            contact_person,
            phone,
            email,
            address,
            supplies,
            notes,
            active
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,TRUE
          )
          RETURNING *
          `,
          [
            branch.id,
            name,
            safeText(
              req.body.companyCode,
              80
            ) || null,
            safeText(
              req.body.vatCode,
              80
            ) || null,
            safeText(
              req.body.contactPerson,
              120
            ) || null,
            safeText(
              req.body.phone,
              80
            ) || null,
            safeText(
              req.body.email,
              160
            ) || null,
            safeText(
              req.body.address,
              300
            ) || null,
            safeText(
              req.body.supplies,
              500
            ) || null,
            safeText(
              req.body.notes,
              1500
            ) || null
          ]
        );

      await logActivity({
        branchId:
          branch.id,

        userId:
          req.user.id,

        action:
          'supplier_added',

        details:
          `Added supplier ${name}`
      });

      res.status(201).json({
        supplier
      });
    } catch (err) {
      if (
        err.code === '23505'
      ) {
        return res.status(409).json({
          error:
            'That supplier already exists for this branch'
        });
      }

      throw err;
    }
  })
);

app.patch(
  '/api/suppliers/:supplierId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const id =
      Number(
        req.params.supplierId
      );

    const current =
      await one(
        `
        SELECT *
        FROM suppliers
        WHERE id=$1
        `,
        [id]
      );

    if (!current) {
      return res.status(404).json({
        error:
          'Supplier not found'
      });
    }

    const supplier =
      await one(
        `
        UPDATE suppliers
        SET
          name=$1,
          company_code=$2,
          vat_code=$3,
          contact_person=$4,
          phone=$5,
          email=$6,
          address=$7,
          supplies=$8,
          notes=$9,
          active=$10,
          updated_at=NOW()
        WHERE id=$11
        RETURNING *
        `,
        [
          req.body.name === undefined
            ? current.name
            : safeText(
                req.body.name,
                160
              ),

          req.body.companyCode === undefined
            ? current.company_code
            : safeText(
                req.body.companyCode,
                80
              ) || null,

          req.body.vatCode === undefined
            ? current.vat_code
            : safeText(
                req.body.vatCode,
                80
              ) || null,

          req.body.contactPerson === undefined
            ? current.contact_person
            : safeText(
                req.body.contactPerson,
                120
              ) || null,

          req.body.phone === undefined
            ? current.phone
            : safeText(
                req.body.phone,
                80
              ) || null,

          req.body.email === undefined
            ? current.email
            : safeText(
                req.body.email,
                160
              ) || null,

          req.body.address === undefined
            ? current.address
            : safeText(
                req.body.address,
                300
              ) || null,

          req.body.supplies === undefined
            ? current.supplies
            : safeText(
                req.body.supplies,
                500
              ) || null,

          req.body.notes === undefined
            ? current.notes
            : safeText(
                req.body.notes,
                1500
              ) || null,

          req.body.active === undefined
            ? current.active
            : Boolean(
                req.body.active
              ),

          id
        ]
      );

    await logActivity({
      branchId:
        current.branch_id,

      userId:
        req.user.id,

      action:
        'supplier_updated',

      details:
        `Updated supplier ${supplier.name}`
    });

    res.json({
      supplier
    });
  })
);

app.delete(
  '/api/suppliers/:supplierId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const supplier =
      await one(
        `
        UPDATE suppliers
        SET
          active=FALSE,
          updated_at=NOW()
        WHERE id=$1
        RETURNING *
        `,
        [
          Number(
            req.params.supplierId
          )
        ]
      );

    if (!supplier) {
      return res.status(404).json({
        error:
          'Supplier not found'
      });
    }

    await logActivity({
      branchId:
        supplier.branch_id,

      userId:
        req.user.id,

      action:
        'supplier_deactivated',

      details:
        `Deactivated supplier ${supplier.name}`
    });

    res.json({
      ok: true,
      supplier
    });
  })
);

/* =========================================================
   INVENTORY
   ========================================================= */

app.get(
  '/api/branches/:branchId/inventory',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const includeInactive =
      req.query.includeInactive === '1';

    const inventory =
      await all(
        `
        SELECT
          ii.*,
          s.name
            AS supplier_name

        FROM inventory_items ii

        LEFT JOIN suppliers s
          ON s.id=
            ii.preferred_supplier_id

        WHERE ii.branch_id=$1
          ${
            includeInactive
              ? ''
              : 'AND ii.active=TRUE'
          }

        ORDER BY
          ii.active DESC,
          ii.category,
          ii.name
        `,
        [branch.id]
      );

    res.json({
      inventory:
        inventory.map(
          item => ({
            ...item,

            current_quantity:
              Number(
                item.current_quantity ||
                0
              ),

            reorder_level:
              Number(
                item.reorder_level ||
                0
              ),

            last_unit_cost:
              item.last_unit_cost === null
                ? null
                : Number(
                    item.last_unit_cost
                  ),

            status:
              inventoryStatus(item)
          })
        )
    });
  })
);

app.post(
  '/api/branches/:branchId/inventory',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const name =
      safeText(
        req.body.name,
        160
      );

    const category =
      safeText(
        req.body.category ||
        'Other',
        80
      );

    const unit =
      safeText(
        req.body.unit ||
        'piece',
        40
      );

    const openingQuantity =
      Number(
        req.body.currentQuantity ||
        0
      );

    const reorderLevel =
      Number(
        req.body.reorderLevel ||
        0
      );

    if (!name) {
      return res.status(400).json({
        error:
          'Inventory item name is required'
      });
    }

    if (
      !Number.isFinite(
        openingQuantity
      ) ||
      !Number.isFinite(
        reorderLevel
      )
    ) {
      return res.status(400).json({
        error:
          'Invalid inventory quantity'
      });
    }

    try {
      const item =
        await one(
          `
          INSERT INTO inventory_items(
            branch_id,
            name,
            category,
            unit,
            current_quantity,
            reorder_level,
            preferred_supplier_id,
            last_unit_cost,
            active
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,TRUE
          )
          RETURNING *
          `,
          [
            branch.id,
            name,
            category,
            unit,
            openingQuantity,
            reorderLevel,
            asNumberOrNull(
              req.body.preferredSupplierId
            ),
            asNumberOrNull(
              req.body.lastUnitCost
            )
          ]
        );

      if (
        openingQuantity !== 0
      ) {
        await query(
          `
          INSERT INTO stock_movements(
            branch_id,
            inventory_item_id,
            user_id,
            movement_type,
            quantity_change,
            quantity_before,
            quantity_after,
            reference_type,
            reference_id,
            note,
            created_at
          )
          VALUES (
            $1,$2,$3,'opening',
            $4,0,$4,'opening',
            NULL,$5,$6
          )
          `,
          [
            branch.id,
            item.id,
            req.user.id,
            openingQuantity,
            'Opening inventory quantity',
            nowIso()
          ]
        );
      }

      await logActivity({
        branchId:
          branch.id,

        userId:
          req.user.id,

        action:
          'inventory_item_added',

        details:
          `Added inventory item ${name}`
      });

      res.status(201).json({
        item
      });
    } catch (err) {
      if (
        err.code === '23505'
      ) {
        return res.status(409).json({
          error:
            'That inventory item already exists'
        });
      }

      throw err;
    }
  })
);

app.patch(
  '/api/inventory/:inventoryId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const id =
      Number(
        req.params.inventoryId
      );

    const current =
      await one(
        `
        SELECT *
        FROM inventory_items
        WHERE id=$1
        `,
        [id]
      );

    if (!current) {
      return res.status(404).json({
        error:
          'Inventory item not found'
      });
    }

    const item =
      await one(
        `
        UPDATE inventory_items
        SET
          name=$1,
          category=$2,
          unit=$3,
          reorder_level=$4,
          preferred_supplier_id=$5,
          last_unit_cost=$6,
          active=$7,
          updated_at=NOW()
        WHERE id=$8
        RETURNING *
        `,
        [
          req.body.name === undefined
            ? current.name
            : safeText(
                req.body.name,
                160
              ),

          req.body.category === undefined
            ? current.category
            : safeText(
                req.body.category,
                80
              ),

          req.body.unit === undefined
            ? current.unit
            : safeText(
                req.body.unit,
                40
              ),

          req.body.reorderLevel === undefined
            ? current.reorder_level
            : Number(
                req.body.reorderLevel
              ),

          req.body.preferredSupplierId === undefined
            ? current.preferred_supplier_id
            : asNumberOrNull(
                req.body.preferredSupplierId
              ),

          req.body.lastUnitCost === undefined
            ? current.last_unit_cost
            : asNumberOrNull(
                req.body.lastUnitCost
              ),

          req.body.active === undefined
            ? current.active
            : Boolean(
                req.body.active
              ),

          id
        ]
      );

    await logActivity({
      branchId:
        current.branch_id,

      userId:
        req.user.id,

      action:
        'inventory_item_updated',

      details:
        `Updated inventory item ${item.name}`
    });

    res.json({
      item
    });
  })
);

app.post(
  '/api/inventory/:inventoryId/adjust',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const inventoryId =
      Number(
        req.params.inventoryId
      );

    const item =
      await one(
        `
        SELECT *
        FROM inventory_items
        WHERE id=$1
        `,
        [inventoryId]
      );

    if (!item) {
      return res.status(404).json({
        error:
          'Inventory item not found'
      });
    }

    let change;

    if (
      req.body.newQuantity !== undefined
    ) {
      const target =
        Number(
          req.body.newQuantity
        );

      if (
        !Number.isFinite(target)
      ) {
        return res.status(400).json({
          error:
            'Invalid inventory quantity'
        });
      }

      change =
        target -
        Number(
          item.current_quantity ||
          0
        );
    } else {
      change =
        Number(
          req.body.quantityChange
        );
    }

    if (
      !Number.isFinite(change) ||
      change === 0
    ) {
      return res.status(400).json({
        error:
          'Quantity change must not be zero'
      });
    }

    const movementType =
      safeText(
        req.body.movementType ||
        'adjustment',
        50
      );

    const updated =
      await transaction(
        async client => {
          return applyInventoryMovement(
            {
              branchId:
                item.branch_id,

              inventoryItemId:
                item.id,

              userId:
                req.user.id,

              quantityChange:
                change,

              movementType,

              referenceType:
                'manual',

              referenceId:
                null,

              note:
                safeText(
                  req.body.note ||
                  'Manual inventory adjustment',
                  500
                )
            },
            client
          );
        }
      );

    await logActivity({
      branchId:
        item.branch_id,

      userId:
        req.user.id,

      action:
        'inventory_adjusted',

      details:
        `${item.name}: ${change > 0 ? '+' : ''}${change} ${item.unit}`
    });

    res.json({
      item:
        updated
    });
  })
);

app.delete(
  '/api/inventory/:inventoryId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const item =
      await one(
        `
        UPDATE inventory_items
        SET
          active=FALSE,
          updated_at=NOW()
        WHERE id=$1
        RETURNING *
        `,
        [
          Number(
            req.params.inventoryId
          )
        ]
      );

    if (!item) {
      return res.status(404).json({
        error:
          'Inventory item not found'
      });
    }

    await query(
      `
      UPDATE menu_inventory_links
      SET active=FALSE
      WHERE inventory_item_id=$1
      `,
      [item.id]
    );

    await logActivity({
      branchId:
        item.branch_id,

      userId:
        req.user.id,

      action:
        'inventory_item_deactivated',

      details:
        `Deactivated ${item.name}`
    });

    res.json({
      ok: true,
      item
    });
  })
);

app.get(
  '/api/branches/:branchId/stock-movements',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const limit =
      Math.max(
        1,
        Math.min(
          500,
          Number(
            req.query.limit ||
            200
          )
        )
      );

    const movements =
      await all(
        `
        SELECT
          sm.*,
          ii.name AS item_name,
          ii.unit,
          COALESCE(
            u.name,
            'System'
          ) AS recorded_by

        FROM stock_movements sm

        JOIN inventory_items ii
          ON ii.id=
            sm.inventory_item_id

        LEFT JOIN users u
          ON u.id=
            sm.user_id

        WHERE sm.branch_id=$1

        ORDER BY
          sm.created_at DESC

        LIMIT $2
        `,
        [
          branch.id,
          limit
        ]
      );

    res.json({
      movements
    });
  })
);

/* =========================================================
   PURCHASES
   ========================================================= */

app.get(
  '/api/branches/:branchId/purchases',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const purchases =
      await all(
        `
        SELECT
          p.*,
          s.name
            AS supplier_name,
          COALESCE(
            u.name,
            'System'
          ) AS recorded_by

        FROM purchases p

        LEFT JOIN suppliers s
          ON s.id=
            p.supplier_id

        LEFT JOIN users u
          ON u.id=
            p.created_by_user_id

        WHERE p.branch_id=$1

        ORDER BY
          p.purchase_date DESC,
          p.created_at DESC
        `,
        [branch.id]
      );

    for (
      const purchase of purchases
    ) {
      purchase.items =
        await all(
          `
          SELECT
            pi.*,
            ii.name
              AS inventory_name
          FROM purchase_items pi
          LEFT JOIN inventory_items ii
            ON ii.id=
              pi.inventory_item_id
          WHERE pi.purchase_id=$1
          ORDER BY pi.id
          `,
          [purchase.id]
        );
    }

    res.json({
      purchases
    });
  })
);

app.post(
  '/api/branches/:branchId/purchases',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const purchaseDate =
      safeText(
        req.body.purchaseDate ||
        localDateKey(),
        10
      );

    if (
      !validDateKey(
        purchaseDate
      )
    ) {
      return res.status(400).json({
        error:
          'Purchase date must be in YYYY-MM-DD format'
      });
    }

    const supplierId =
      asNumberOrNull(
        req.body.supplierId
      );

    if (supplierId !== null) {
      const supplier =
        await one(
          `
          SELECT id
          FROM suppliers
          WHERE id=$1
            AND branch_id=$2
          `,
          [
            supplierId,
            branch.id
          ]
        );

      if (!supplier) {
        return res.status(400).json({
          error:
            'Invalid supplier'
        });
      }
    }

    const items =
      Array.isArray(
        req.body.items
      )
        ? req.body.items
        : [];

    if (!items.length) {
      return res.status(400).json({
        error:
          'Add at least one purchase item'
      });
    }

    let computedSubtotal = 0;

    const normalizedItems =
      items.map(item => {
        const quantity =
          asNumberOrNull(
            item.quantity
          );

        const unitCost =
          asNumberOrNull(
            item.unitCost
          );

        const lineTotal =
          asNumberOrNull(
            item.lineTotal
          ) ??
          (
            quantity !== null &&
            unitCost !== null
              ? Number(
                  (
                    quantity *
                    unitCost
                  ).toFixed(2)
                )
              : null
          );

        if (
          lineTotal !== null
        ) {
          computedSubtotal +=
            Number(lineTotal);
        }

        return {
          itemName:
            safeText(
              item.itemName ||
              item.name,
              160
            ),

          inventoryItemId:
            asNumberOrNull(
              item.inventoryItemId
            ),

          quantity,

          unit:
            safeText(
              item.unit,
              40
            ) || null,

          unitCost,

          lineTotal,

          addToInventory:
            Boolean(
              item.addToInventory
            )
        };
      });

    if (
      normalizedItems.some(
        item => !item.itemName
      )
    ) {
      return res.status(400).json({
        error:
          'Every purchase item needs a name'
      });
    }

    const subtotal =
      asNumberOrNull(
        req.body.subtotal
      ) ??
      Number(
        computedSubtotal.toFixed(2)
      );

    const vatAmount =
      asNumberOrNull(
        req.body.vatAmount
      ) ?? 0;

    const totalAmount =
      asNumberOrNull(
        req.body.totalAmount
      ) ??
      Number(
        (
          subtotal +
          vatAmount
        ).toFixed(2)
      );

    const purchase =
      await transaction(
        async client => {
          const created =
            await one(
              `
              INSERT INTO purchases(
                branch_id,
                supplier_id,
                created_by_user_id,
                purchase_date,
                invoice_number,
                subtotal,
                vat_amount,
                total_amount,
                payment_method,
                reference_number,
                notes,
                status
              )
              VALUES (
                $1,$2,$3,$4,$5,$6,
                $7,$8,$9,$10,$11,
                'completed'
              )
              RETURNING *
              `,
              [
                branch.id,
                supplierId,
                req.user.id,
                purchaseDate,
                safeText(
                  req.body.invoiceNumber,
                  100
                ) || null,
                subtotal,
                vatAmount,
                totalAmount,
                safeText(
                  req.body.paymentMethod,
                  80
                ) || null,
                safeText(
                  req.body.referenceNumber,
                  120
                ) || null,
                safeText(
                  req.body.notes,
                  1500
                ) || null
              ],
              client
            );

          for (
            const item
            of normalizedItems
          ) {
            await client.query(
              `
              INSERT INTO purchase_items(
                purchase_id,
                inventory_item_id,
                item_name,
                quantity,
                unit,
                unit_cost,
                line_total,
                add_to_inventory
              )
              VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,$8
              )
              `,
              [
                created.id,
                item.inventoryItemId,
                item.itemName,
                item.quantity,
                item.unit,
                item.unitCost,
                item.lineTotal,
                item.addToInventory
              ]
            );

            if (
              item.addToInventory &&
              item.inventoryItemId &&
              item.quantity &&
              item.quantity > 0
            ) {
              await applyInventoryMovement(
                {
                  branchId:
                    branch.id,

                  inventoryItemId:
                    item.inventoryItemId,

                  userId:
                    req.user.id,

                  quantityChange:
                    item.quantity,

                  movementType:
                    'purchase',

                  referenceType:
                    'purchase',

                  referenceId:
                    created.id,

                  note:
                    `Purchase ${safeText(req.body.invoiceNumber, 100) || `#${created.id}`}`
                },
                client
              );

              if (
                item.unitCost !== null
              ) {
                await client.query(
                  `
                  UPDATE inventory_items
                  SET
                    last_unit_cost=$1,
                    updated_at=NOW()
                  WHERE id=$2
                  `,
                  [
                    item.unitCost,
                    item.inventoryItemId
                  ]
                );
              }
            }
          }

          return created;
        }
      );

    await logActivity({
      branchId:
        branch.id,

      userId:
        req.user.id,

      action:
        'purchase_added',

      details:
        `Purchase ${purchase.invoice_number || `#${purchase.id}`} · €${Number(totalAmount).toFixed(2)}`
    });

    res.status(201).json({
      purchase
    });
  })
);

app.patch(
  '/api/purchases/:purchaseId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const id =
      Number(
        req.params.purchaseId
      );

    const current =
      await one(
        `
        SELECT *
        FROM purchases
        WHERE id=$1
        `,
        [id]
      );

    if (!current) {
      return res.status(404).json({
        error:
          'Purchase not found'
      });
    }

    const purchaseDate =
      req.body.purchaseDate === undefined
        ? current.purchase_date
        : safeText(
            req.body.purchaseDate,
            10
          );

    if (
      !validDateKey(
        String(purchaseDate)
          .slice(0, 10)
      )
    ) {
      return res.status(400).json({
        error:
          'Invalid purchase date'
      });
    }

    const updated =
      await one(
        `
        UPDATE purchases
        SET
          supplier_id=$1,
          purchase_date=$2,
          invoice_number=$3,
          subtotal=$4,
          vat_amount=$5,
          total_amount=$6,
          payment_method=$7,
          reference_number=$8,
          notes=$9,
          updated_at=NOW()
        WHERE id=$10
        RETURNING *
        `,
        [
          req.body.supplierId === undefined
            ? current.supplier_id
            : asNumberOrNull(
                req.body.supplierId
              ),

          purchaseDate,

          req.body.invoiceNumber === undefined
            ? current.invoice_number
            : safeText(
                req.body.invoiceNumber,
                100
              ) || null,

          req.body.subtotal === undefined
            ? current.subtotal
            : asNumberOrNull(
                req.body.subtotal
              ),

          req.body.vatAmount === undefined
            ? current.vat_amount
            : asNumberOrNull(
                req.body.vatAmount
              ),

          req.body.totalAmount === undefined
            ? current.total_amount
            : Number(
                req.body.totalAmount
              ),

          req.body.paymentMethod === undefined
            ? current.payment_method
            : safeText(
                req.body.paymentMethod,
                80
              ) || null,

          req.body.referenceNumber === undefined
            ? current.reference_number
            : safeText(
                req.body.referenceNumber,
                120
              ) || null,

          req.body.notes === undefined
            ? current.notes
            : safeText(
                req.body.notes,
                1500
              ) || null,

          id
        ]
      );

    await logActivity({
      branchId:
        current.branch_id,

      userId:
        req.user.id,

      action:
        'purchase_updated',

      details:
        `Updated purchase ${current.invoice_number || `#${id}`}`
    });

    res.json({
      purchase:
        updated
    });
  })
);

app.delete(
  '/api/purchases/:purchaseId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const id =
      Number(
        req.params.purchaseId
      );

    const purchase =
      await one(
        `
        SELECT *
        FROM purchases
        WHERE id=$1
        `,
        [id]
      );

    if (!purchase) {
      return res.status(404).json({
        error:
          'Purchase not found'
      });
    }

    if (
      purchase.status === 'voided'
    ) {
      return res.json({
        ok: true,
        purchase
      });
    }

    await transaction(
      async client => {
        const movements =
          await all(
            `
            SELECT *
            FROM stock_movements
            WHERE reference_type='purchase'
              AND reference_id=$1
              AND movement_type='purchase'
            ORDER BY id
            `,
            [id],
            client
          );

        for (
          const movement
          of movements
        ) {
          await applyInventoryMovement(
            {
              branchId:
                movement.branch_id,

              inventoryItemId:
                movement.inventory_item_id,

              userId:
                req.user.id,

              quantityChange:
                -Number(
                  movement.quantity_change
                ),

              movementType:
                'purchase_void',

              referenceType:
                'purchase_void',

              referenceId:
                id,

              note:
                `Reversal of voided purchase ${purchase.invoice_number || `#${id}`}`
            },
            client
          );
        }

        await client.query(
          `
          UPDATE purchases
          SET
            status='voided',
            updated_at=NOW()
          WHERE id=$1
          `,
          [id]
        );
      }
    );

    await logActivity({
      branchId:
        purchase.branch_id,

      userId:
        req.user.id,

      action:
        'purchase_voided',

      details:
        `Voided purchase ${purchase.invoice_number || `#${id}`}`
    });

    res.json({
      ok: true
    });
  })
);

/* =========================================================
   EXPENSES / SERVICES
   ========================================================= */

app.get(
  '/api/branches/:branchId/expenses',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const expenses =
      await all(
        `
        SELECT
          e.*,
          u.name
            AS recorded_by,
          s.name
            AS supplier_name

        FROM expenses e

        JOIN users u
          ON u.id=e.user_id

        LEFT JOIN suppliers s
          ON s.id=e.supplier_id

        WHERE e.branch_id=$1

        ORDER BY
          e.expense_date DESC,
          e.created_at DESC

        LIMIT 500
        `,
        [branch.id]
      );

    res.json({
      expenses
    });
  })
);

app.post(
  '/api/branches/:branchId/expenses',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const category =
      safeText(
        req.body.category,
        80
      );

    const item =
      safeText(
        req.body.item,
        160
      );

    const amount =
      Number(
        req.body.amount
      );

    const expenseDate =
      safeText(
        req.body.expenseDate ||
        req.body.purchaseDate ||
        localDateKey(),
        10
      );

    if (
      !category ||
      !item ||
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      return res.status(400).json({
        error:
          'Category, item and a valid amount are required'
      });
    }

    if (
      !validDateKey(
        expenseDate
      )
    ) {
      return res.status(400).json({
        error:
          'Expense date must be in YYYY-MM-DD format'
      });
    }

    const expense =
      await one(
        `
        INSERT INTO expenses(
          branch_id,
          user_id,
          supplier_id,
          expense_date,
          category,
          item,
          quantity,
          unit,
          unit_cost,
          amount,
          invoice_number,
          payment_method,
          note,
          created_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,
          $12,$13,$14
        )
        RETURNING *
        `,
        [
          branch.id,
          req.user.id,
          asNumberOrNull(
            req.body.supplierId
          ),
          expenseDate,
          category,
          item,
          asNumberOrNull(
            req.body.quantity
          ),
          safeText(
            req.body.unit,
            40
          ) || null,
          asNumberOrNull(
            req.body.unitCost
          ),
          amount,
          safeText(
            req.body.invoiceNumber,
            100
          ) || null,
          safeText(
            req.body.paymentMethod,
            80
          ) || null,
          safeText(
            req.body.note,
            1000
          ) || null,
          nowIso()
        ]
      );

    await logActivity({
      branchId:
        branch.id,

      userId:
        req.user.id,

      action:
        'expense_added',

      details:
        `${item} €${amount.toFixed(2)} · ${expenseDate}`
    });

    res.status(201).json({
      expense
    });
  })
);

app.patch(
  '/api/expenses/:expenseId',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const id =
      Number(
        req.params.expenseId
      );

    const current =
      await one(
        `
        SELECT *
        FROM expenses
        WHERE id=$1
        `,
        [id]
      );

    if (!current) {
      return res.status(404).json({
        error:
          'Expense not found'
      });
    }

    const expenseDate =
      req.body.expenseDate === undefined
        ? current.expense_date
        : safeText(
            req.body.expenseDate,
            10
          );

    const updated =
      await one(
        `
        UPDATE expenses
        SET
          supplier_id=$1,
          expense_date=$2,
          category=$3,
          item=$4,
          quantity=$5,
          unit=$6,
          unit_cost=$7,
          amount=$8,
          invoice_number=$9,
          payment_method=$10,
          note=$11
        WHERE id=$12
        RETURNING *
        `,
        [
          req.body.supplierId === undefined
            ? current.supplier_id
            : asNumberOrNull(
                req.body.supplierId
              ),

          expenseDate,

          req.body.category === undefined
            ? current.category
            : safeText(
                req.body.category,
                80
              ),

          req.body.item === undefined
            ? current.item
            : safeText(
                req.body.item,
                160
              ),

          req.body.quantity === undefined
            ? current.quantity
            : asNumberOrNull(
                req.body.quantity
              ),

          req.body.unit === undefined
            ? current.unit
            : safeText(
                req.body.unit,
                40
              ) || null,

          req.body.unitCost === undefined
            ? current.unit_cost
            : asNumberOrNull(
                req.body.unitCost
              ),

          req.body.amount === undefined
            ? current.amount
            : Number(
                req.body.amount
              ),

          req.body.invoiceNumber === undefined
            ? current.invoice_number
            : safeText(
                req.body.invoiceNumber,
                100
              ) || null,

          req.body.paymentMethod === undefined
            ? current.payment_method
            : safeText(
                req.body.paymentMethod,
                80
              ) || null,

          req.body.note === undefined
            ? current.note
            : safeText(
                req.body.note,
                1000
              ) || null,

          id
        ]
      );

    await logActivity({
      branchId:
        current.branch_id,

      userId:
        req.user.id,

      action:
        'expense_updated',

      details:
        `Updated expense ${current.item}`
    });

    res.json({
      expense:
        updated
    });
  })
);

/* =========================================================
   ACTIVITY
   ========================================================= */

app.get(
  '/api/branches/:branchId/activity',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const activities =
      await all(
        `
        SELECT
          a.*,
          COALESCE(
            u.name,
            'System'
          ) AS worker_name
        FROM activity_logs a
        LEFT JOIN users u
          ON u.id=a.user_id
        WHERE a.branch_id=$1
        ORDER BY a.created_at DESC
        LIMIT 100
        `,
        [branch.id]
      );

    res.json({
      activities
    });
  })
);

/* =========================================================
   OWNER OVERVIEW
   ========================================================= */

app.get(
  '/api/branches/:branchId/overview',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const staff =
      await one(
        `
        SELECT
          COUNT(*)::int AS c
        FROM users
        WHERE branch_id=$1
          AND role='worker'
          AND active=TRUE
        `,
        [branch.id]
      );

    const report =
      await latestReport(
        branch.id
      );

    const needs =
      await one(
        `
        SELECT
          COUNT(*)::int AS c
        FROM needs
        WHERE branch_id=$1
          AND resolved=FALSE
        `,
        [branch.id]
      );

    const alerts =
      await one(
        `
        SELECT
          COUNT(*)::int AS c
        FROM alerts
        WHERE branch_id=$1
          AND acknowledged=FALSE
          AND restocked=FALSE
        `,
        [branch.id]
      );

    const suppliers =
      await one(
        `
        SELECT
          COUNT(*)::int AS c
        FROM suppliers
        WHERE branch_id=$1
          AND active=TRUE
        `,
        [branch.id]
      );

    const inventory =
      await all(
        `
        SELECT *
        FROM inventory_items
        WHERE branch_id=$1
          AND active=TRUE
        `,
        [branch.id]
      );

    const lowStockCount =
      inventory.filter(
        item =>
          inventoryStatus(item) !==
          'good'
      ).length;

    res.json({
      branch,

      staffCount:
        staff.c,

      latestReport:
        report,

      unresolvedNeeds:
        needs.c,

      activeAlerts:
        alerts.c,

      supplierCount:
        suppliers.c,

      inventoryCount:
        inventory.length,

      lowStockCount
    });
  })
);

/* =========================================================
   WEEKLY / MONTHLY REPORTS
   ========================================================= */

async function buildRangeSummary(
  branch,
  start,
  end
) {
  const reportRows =
    await all(
      `
      SELECT
        dr.*,
        u.name AS worker_name
      FROM daily_reports dr
      JOIN users u
        ON u.id=dr.user_id
      WHERE dr.branch_id=$1
        AND dr.report_date
          BETWEEN $2 AND $3
      ORDER BY dr.submitted_at DESC
      `,
      [
        branch.id,
        start,
        end
      ]
    );

  const reports = [];

  for (
    const row
    of reportRows
  ) {
    reports.push(
      await hydrateReport(row)
    );
  }

  const expenses =
    await all(
      `
      SELECT
        e.*,
        u.name AS recorded_by,
        s.name AS supplier_name

      FROM expenses e

      JOIN users u
        ON u.id=e.user_id

      LEFT JOIN suppliers s
        ON s.id=e.supplier_id

      WHERE e.branch_id=$1
        AND e.expense_date
          BETWEEN $2 AND $3

      ORDER BY
        e.expense_date DESC,
        e.created_at DESC
      `,
      [
        branch.id,
        start,
        end
      ]
    );

  const purchases =
    await all(
      `
      SELECT
        p.*,
        s.name AS supplier_name

      FROM purchases p

      LEFT JOIN suppliers s
        ON s.id=p.supplier_id

      WHERE p.branch_id=$1
        AND p.purchase_date
          BETWEEN $2 AND $3
        AND p.status<>'voided'

      ORDER BY
        p.purchase_date DESC,
        p.created_at DESC
      `,
      [
        branch.id,
        start,
        end
      ]
    );

  const attendance =
    (
      await all(
        `
        SELECT
          a.*,
          u.name AS worker_name
        FROM attendance a
        JOIN users u
          ON u.id=a.user_id
        WHERE a.branch_id=$1
          AND a.work_date
            BETWEEN $2 AND $3
        ORDER BY
          a.work_date,
          u.name
        `,
        [
          branch.id,
          start,
          end
        ]
      )
    ).map(row => ({
      ...row,

      hours:
        row.clock_out
          ? hoursBetween(
              row.clock_in,
              row.clock_out,
              row.break_minutes
            )
          : 0
    }));

  const menuTotals =
    new Map();

  reports.forEach(
    report => {
      report.salesRows.forEach(
        sale => {
          menuTotals.set(
            sale.name,
            (
              menuTotals.get(
                sale.name
              ) || 0
            ) +
              Number(
                sale.quantity
              )
          );
        }
      );
    }
  );

  const topItem =
    [...menuTotals.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0] || null;

  const staffSummary = {};

  attendance.forEach(
    row => {
      if (
        !staffSummary[
          row.worker_name
        ]
      ) {
        staffSummary[
          row.worker_name
        ] = {
          shifts: 0,
          hours: 0
        };
      }

      if (row.clock_out) {
        staffSummary[
          row.worker_name
        ].shifts += 1;
      }

      staffSummary[
        row.worker_name
      ].hours +=
        row.hours || 0;
    }
  );

  Object.values(
    staffSummary
  ).forEach(summary => {
    summary.hours =
      Number(
        summary.hours.toFixed(2)
      );
  });

  const expenseCategories = {};

  expenses.forEach(
    expense => {
      expenseCategories[
        expense.category
      ] =
        Number(
          (
            (
              expenseCategories[
                expense.category
              ] || 0
            ) +
            Number(
              expense.amount
            )
          ).toFixed(2)
        );
    }
  );

  const purchaseTotal =
    Number(
      purchases.reduce(
        (sum, purchase) =>
          sum +
          Number(
            purchase.total_amount ||
            0
          ),
        0
      ).toFixed(2)
    );

  return {
    branch,

    range: {
      start,
      end
    },

    totals: {
      itemsSold:
        reports.reduce(
          (sum, report) =>
            sum +
            report.totalSold,
          0
        ),

      expenses:
        Number(
          expenses.reduce(
            (sum, expense) =>
              sum +
              Number(
                expense.amount
              ),
            0
          ).toFixed(2)
        ),

      purchases:
        purchaseTotal,

      staffHours:
        Number(
          attendance.reduce(
            (sum, shift) =>
              sum +
              Number(
                shift.hours || 0
              ),
            0
          ).toFixed(2)
        ),

      reports:
        reports.length,

      shifts:
        attendance.filter(
          shift =>
            shift.clock_out
        ).length
    },

    topItem:
      topItem
        ? {
            name:
              topItem[0],

            quantity:
              topItem[1]
          }
        : null,

    latestStock:
      reports[0] || null,

    staffSummary,
    expenseCategories,
    reports,
    expenses,
    purchases,
    attendance
  };
}

app.get(
  '/api/branches/:branchId/reports/weekly',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const {
      start,
      end
    } =
      currentWeekRange();

    res.json(
      await buildRangeSummary(
        branch,
        start,
        end
      )
    );
  })
);

app.get(
  '/api/branches/:branchId/reports/monthly',
  requireAuth,
  requireOwner,
  asyncHandler(async (req, res) => {
    const branch =
      await assertBranch(
        req,
        res
      );

    if (!branch) return;

    const requestedMonth =
      safeText(
        req.query.month,
        7
      ) ||
      localDateKey()
        .slice(0, 7);

    const range =
      monthRange(
        requestedMonth
      );

    if (!range) {
      return res.status(400).json({
        error:
          'Month must be in YYYY-MM format'
      });
    }

    const summary =
      await buildRangeSummary(
        branch,
        range.start,
        range.end
      );

    res.json({
      ...summary,
      month:
        range.month
    });
  })
);

/* =========================================================
   ERROR HANDLING
   ========================================================= */

app.use(
  (
    err,
    _req,
    res,
    _next
  ) => {
    console.error(err);

    if (
      err.message ===
      'Origin not allowed by CORS'
    ) {
      return res.status(403).json({
        error:
          'Origin not allowed'
      });
    }

    if (
      err.message ===
      'Inventory item not found'
    ) {
      return res.status(404).json({
        error:
          err.message
      });
    }

    res.status(500).json({
      error:
        err.message ||
        'Server error'
    });
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

ready
  .then(() => {
    app.listen(
      port,
      () => {
        console.log(
          `Freida's API running on http://localhost:${port}`
        );
      }
    );
  })
  .catch(err => {
    console.error(
      'Database initialization failed:',
      err
    );

    process.exit(1);
  });