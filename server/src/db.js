import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is required. Use the Supabase connection string from Project Settings > Database > Connect.'
  );
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 1),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

export async function query(text, params = [], client = pool) {
  return client.query(text, params);
}

export async function one(text, params = [], client = pool) {
  const result = await client.query(text, params);
  return result.rows[0] || null;
}

export async function all(text, params = [], client = pool) {
  const result = await client.query(text, params);
  return result.rows;
}

export async function transaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const value = await fn(client);

    await client.query('COMMIT');

    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const schema = `
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','worker')),
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
ON users(LOWER(username));

/* =========================================================
   SUPPLIERS
   ========================================================= */

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  name TEXT NOT NULL,

  company_code TEXT,
  vat_code TEXT,

  contact_person TEXT,
  phone TEXT,
  email TEXT,

  address TEXT,

  supplies TEXT,

  notes TEXT,

  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_branch_name_lower
ON suppliers(branch_id, LOWER(name));

/* =========================================================
   INVENTORY
   ========================================================= */

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  name TEXT NOT NULL,

  category TEXT NOT NULL DEFAULT 'Other',

  unit TEXT NOT NULL DEFAULT 'piece',

  current_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,

  reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0,

  preferred_supplier_id INTEGER
    REFERENCES suppliers(id) ON DELETE SET NULL,

  last_unit_cost NUMERIC(12,4),

  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_branch_name_lower
ON inventory_items(branch_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_inventory_branch_active
ON inventory_items(branch_id, active);

/* =========================================================
   MENU
   ========================================================= */

CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,

  name TEXT NOT NULL UNIQUE,

  category TEXT NOT NULL DEFAULT 'food',

  sort_order INTEGER NOT NULL DEFAULT 0,

  active BOOLEAN NOT NULL DEFAULT TRUE
);

/*
  This connects a menu item to stock for a specific branch.

  For example:

  Vilnius + Coca-Cola
  -> Coca-Cola inventory
  -> 1 bottle/can removed for every 1 sold.
*/
CREATE TABLE IF NOT EXISTS menu_inventory_links (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  menu_item_id INTEGER NOT NULL
    REFERENCES menu_items(id) ON DELETE CASCADE,

  inventory_item_id INTEGER NOT NULL
    REFERENCES inventory_items(id) ON DELETE CASCADE,

  stock_per_sale NUMERIC(14,3) NOT NULL DEFAULT 1,

  active BOOLEAN NOT NULL DEFAULT TRUE,

  UNIQUE(branch_id, menu_item_id)
);

/* =========================================================
   ATTENDANCE
   ========================================================= */

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,

  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  work_date DATE NOT NULL,

  clock_in TIMESTAMPTZ NOT NULL,

  clock_out TIMESTAMPTZ,

  break_started_at TIMESTAMPTZ,

  break_minutes INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, work_date)
);

/* =========================================================
   DAILY REPORTS
   ========================================================= */

CREATE TABLE IF NOT EXISTS daily_reports (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  report_date DATE NOT NULL,

  submitted_at TIMESTAMPTZ NOT NULL,

  chicken_status TEXT
    CHECK(chicken_status IN ('available','low','finished')),

  chicken_kg NUMERIC,

  beef_status TEXT
    CHECK(beef_status IN ('available','low','finished')),

  beef_kg NUMERIC,

  shawarma_jars NUMERIC,

  garlic_jars NUMERIC,

  refill_bowl_empty BOOLEAN NOT NULL DEFAULT FALSE,

  other_items TEXT,

  notes TEXT,

  total_sold INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_sales (
  report_id INTEGER NOT NULL
    REFERENCES daily_reports(id) ON DELETE CASCADE,

  menu_item_id INTEGER NOT NULL
    REFERENCES menu_items(id) ON DELETE CASCADE,

  quantity INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY(report_id, menu_item_id)
);

/* =========================================================
   PURCHASES
   ========================================================= */

CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  supplier_id INTEGER
    REFERENCES suppliers(id) ON DELETE SET NULL,

  created_by_user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL,

  purchase_date DATE NOT NULL,

  invoice_number TEXT,

  subtotal NUMERIC(12,2),

  vat_amount NUMERIC(12,2),

  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

  payment_method TEXT,

  reference_number TEXT,

  notes TEXT,

  status TEXT NOT NULL DEFAULT 'completed',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_supplier_invoice
ON purchases(branch_id, supplier_id, invoice_number)
WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_branch_date
ON purchases(branch_id, purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,

  purchase_id INTEGER NOT NULL
    REFERENCES purchases(id) ON DELETE CASCADE,

  inventory_item_id INTEGER
    REFERENCES inventory_items(id) ON DELETE SET NULL,

  item_name TEXT NOT NULL,

  quantity NUMERIC(14,3),

  unit TEXT,

  unit_cost NUMERIC(12,4),

  line_total NUMERIC(12,2),

  add_to_inventory BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
ON purchase_items(purchase_id);

/* =========================================================
   EXISTING EXPENSES

   We keep this because not every expense is an inventory
   purchase. Examples:
   Repairs
   Transport
   Cleaning service
   Gas
   etc.
   ========================================================= */

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  user_id INTEGER NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,

  supplier_id INTEGER
    REFERENCES suppliers(id) ON DELETE SET NULL,

  expense_date DATE NOT NULL,

  category TEXT NOT NULL,

  item TEXT NOT NULL,

  quantity NUMERIC(14,3),

  unit TEXT,

  unit_cost NUMERIC(12,4),

  amount NUMERIC(12,2) NOT NULL,

  invoice_number TEXT,

  payment_method TEXT,

  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   NEEDS
   ========================================================= */

CREATE TABLE IF NOT EXISTS needs (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  source_report_id INTEGER
    REFERENCES daily_reports(id) ON DELETE SET NULL,

  label TEXT NOT NULL,

  reason TEXT NOT NULL,

  priority TEXT NOT NULL
    CHECK(priority IN ('normal','high','urgent')),

  resolved BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL,

  resolved_at TIMESTAMPTZ
);

/* =========================================================
   ALERTS
   ========================================================= */

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  source_report_id INTEGER
    REFERENCES daily_reports(id) ON DELETE SET NULL,

  message TEXT NOT NULL,

  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,

  restocked BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL
);

/* =========================================================
   STOCK MOVEMENT HISTORY
   ========================================================= */

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER NOT NULL
    REFERENCES branches(id) ON DELETE CASCADE,

  inventory_item_id INTEGER NOT NULL
    REFERENCES inventory_items(id) ON DELETE CASCADE,

  user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL,

  movement_type TEXT NOT NULL,

  quantity_change NUMERIC(14,3) NOT NULL,

  quantity_before NUMERIC(14,3) NOT NULL,

  quantity_after NUMERIC(14,3) NOT NULL,

  reference_type TEXT,

  reference_id INTEGER,

  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item
ON stock_movements(inventory_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_branch
ON stock_movements(branch_id, created_at DESC);

/* =========================================================
   ACTIVITY LOG
   ========================================================= */

CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,

  branch_id INTEGER
    REFERENCES branches(id) ON DELETE SET NULL,

  user_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL,

  action TEXT NOT NULL,

  details TEXT,

  created_at TIMESTAMPTZ NOT NULL
);

/* =========================================================
   EXISTING INDEXES
   ========================================================= */

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date
ON attendance(branch_id, work_date);

CREATE INDEX IF NOT EXISTS idx_reports_branch_date
ON daily_reports(branch_id, report_date);

CREATE INDEX IF NOT EXISTS idx_expenses_branch_date
ON expenses(branch_id, expense_date);

CREATE INDEX IF NOT EXISTS idx_needs_branch_resolved
ON needs(branch_id, resolved);

CREATE INDEX IF NOT EXISTS idx_alerts_branch
ON alerts(branch_id, acknowledged, restocked);
`;

/* =========================================================
   HELPERS
   ========================================================= */

async function ensureBranch(name) {
  await query(
    `
    INSERT INTO branches(name)
    VALUES ($1)
    ON CONFLICT(name) DO NOTHING
    `,
    [name]
  );

  return one(
    `
    SELECT id, name, active
    FROM branches
    WHERE name=$1
    `,
    [name]
  );
}

async function ensureUser({
  username,
  password,
  name,
  role,
  branchId = null
}) {
  const existing = await one(
    `
    SELECT
      id,
      username,
      name,
      role,
      branch_id AS "branchId",
      active
    FROM users
    WHERE LOWER(username)=LOWER($1)
    `,
    [username]
  );

  if (existing) {
    return existing;
  }

  const hash = await bcrypt.hash(password, 12);

  return one(
    `
    INSERT INTO users(
      username,
      password_hash,
      name,
      role,
      branch_id
    )
    VALUES ($1,$2,$3,$4,$5)
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
      role,
      branchId
    ]
  );
}

async function ensureSupplier({
  branchId,
  name,
  companyCode = null,
  vatCode = null,
  contactPerson = null,
  phone = null,
  email = null,
  address = null,
  supplies = null,
  notes = null
}) {
  const existing = await one(
    `
    SELECT *
    FROM suppliers
    WHERE branch_id=$1
      AND LOWER(name)=LOWER($2)
    `,
    [branchId, name]
  );

  if (existing) {
    /*
      Keep the existing record but fill empty fields when
      we have better information available.
    */
    return one(
      `
      UPDATE suppliers
      SET
        company_code=COALESCE(company_code,$1),
        vat_code=COALESCE(vat_code,$2),
        contact_person=COALESCE(contact_person,$3),
        phone=COALESCE(phone,$4),
        email=COALESCE(email,$5),
        address=COALESCE(address,$6),
        supplies=COALESCE(supplies,$7),
        notes=COALESCE(notes,$8),
        updated_at=NOW()
      WHERE id=$9
      RETURNING *
      `,
      [
        companyCode,
        vatCode,
        contactPerson,
        phone,
        email,
        address,
        supplies,
        notes,
        existing.id
      ]
    );
  }

  return one(
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
      notes
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
    )
    RETURNING *
    `,
    [
      branchId,
      name,
      companyCode,
      vatCode,
      contactPerson,
      phone,
      email,
      address,
      supplies,
      notes
    ]
  );
}

async function ensureInventoryItem({
  branchId,
  name,
  category,
  unit,
  reorderLevel = 0,
  preferredSupplierId = null
}) {
  const existing = await one(
    `
    SELECT *
    FROM inventory_items
    WHERE branch_id=$1
      AND LOWER(name)=LOWER($2)
    `,
    [branchId, name]
  );

  if (existing) {
    return existing;
  }

  return one(
    `
    INSERT INTO inventory_items(
      branch_id,
      name,
      category,
      unit,
      current_quantity,
      reorder_level,
      preferred_supplier_id
    )
    VALUES (
      $1,$2,$3,$4,0,$5,$6
    )
    RETURNING *
    `,
    [
      branchId,
      name,
      category,
      unit,
      reorderLevel,
      preferredSupplierId
    ]
  );
}

async function ensureMenuItem({
  name,
  category = 'food',
  sortOrder = 0
}) {
  const existing = await one(
    `
    SELECT *
    FROM menu_items
    WHERE LOWER(name)=LOWER($1)
    `,
    [name]
  );

  if (existing) {
    return one(
      `
      UPDATE menu_items
      SET
        category=$1,
        sort_order=$2
      WHERE id=$3
      RETURNING *
      `,
      [
        category,
        sortOrder,
        existing.id
      ]
    );
  }

  return one(
    `
    INSERT INTO menu_items(
      name,
      category,
      sort_order
    )
    VALUES ($1,$2,$3)
    RETURNING *
    `,
    [
      name,
      category,
      sortOrder
    ]
  );
}

async function ensureMenuInventoryLink({
  branchId,
  menuItemId,
  inventoryItemId,
  stockPerSale = 1
}) {
  return one(
    `
    INSERT INTO menu_inventory_links(
      branch_id,
      menu_item_id,
      inventory_item_id,
      stock_per_sale,
      active
    )
    VALUES ($1,$2,$3,$4,TRUE)

    ON CONFLICT(branch_id,menu_item_id)

    DO UPDATE SET
      inventory_item_id=EXCLUDED.inventory_item_id,
      stock_per_sale=EXCLUDED.stock_per_sale,
      active=TRUE

    RETURNING *
    `,
    [
      branchId,
      menuItemId,
      inventoryItemId,
      stockPerSale
    ]
  );
}

/* =========================================================
   HISTORICAL PURCHASE IMPORT

   This does NOT increase current inventory because these are
   old purchases that may already have been consumed.
   ========================================================= */

async function ensureHistoricalPurchase({
  branchId,
  supplierId,
  createdByUserId,
  purchaseDate,
  invoiceNumber,
  subtotal,
  vatAmount,
  totalAmount,
  notes,
  items = []
}) {
  let purchase = null;

  if (invoiceNumber) {
    purchase = await one(
      `
      SELECT *
      FROM purchases
      WHERE branch_id=$1
        AND supplier_id=$2
        AND invoice_number=$3
      `,
      [
        branchId,
        supplierId,
        invoiceNumber
      ]
    );
  }

  if (!purchase) {
    purchase = await one(
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
        notes,
        status
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,'completed'
      )
      RETURNING *
      `,
      [
        branchId,
        supplierId,
        createdByUserId,
        purchaseDate,
        invoiceNumber,
        subtotal,
        vatAmount,
        totalAmount,
        notes
      ]
    );
  }

  const existingItems = await one(
    `
    SELECT COUNT(*)::int AS count
    FROM purchase_items
    WHERE purchase_id=$1
    `,
    [purchase.id]
  );

  if (existingItems.count === 0) {
    for (const item of items) {
      await query(
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
          $1,$2,$3,$4,$5,$6,$7,FALSE
        )
        `,
        [
          purchase.id,
          item.inventoryItemId || null,
          item.itemName,
          item.quantity ?? null,
          item.unit || null,
          item.unitCost ?? null,
          item.lineTotal ?? null
        ]
      );
    }
  }

  return purchase;
}

/* =========================================================
   SAFE MIGRATIONS

   These modify an existing Freida's database without deleting
   existing operational records.
   ========================================================= */

async function applySafeMigrations() {
  /*
    BRANCHES
  */
  await query(`
    ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS active
    BOOLEAN NOT NULL DEFAULT TRUE
  `);

  /*
    USERS
  */
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS active
    BOOLEAN NOT NULL DEFAULT TRUE
  `);

  /*
    MENU CATEGORY
  */
  await query(`
    ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS category
    TEXT NOT NULL DEFAULT 'food'
  `);

  await query(`
    UPDATE menu_items
    SET category='food'
    WHERE category IS NULL
       OR TRIM(category)=''
  `);

  /*
    EXISTING EXPENSE PURCHASE DATE
  */
  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS expense_date DATE
  `);

  await query(`
    UPDATE expenses
    SET expense_date=created_at::date
    WHERE expense_date IS NULL
  `);

  await query(`
    ALTER TABLE expenses
    ALTER COLUMN expense_date SET NOT NULL
  `);

  /*
    EXPENSE SUPPLIER/PURCHASE INFORMATION
  */
  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS supplier_id INTEGER
    REFERENCES suppliers(id)
    ON DELETE SET NULL
  `);

  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS quantity NUMERIC(14,3)
  `);

  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS unit TEXT
  `);

  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,4)
  `);

  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS invoice_number TEXT
  `);

  await query(`
    ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS payment_method TEXT
  `);

  /*
    USE THE NEW FREIDA'S SPELLING.
  */
  const oldMenuItem = await one(`
    SELECT id
    FROM menu_items
    WHERE name='Freda’s Soul bulvytės'
  `);

  const newMenuItem = await one(`
    SELECT id
    FROM menu_items
    WHERE name='Freida’s Soul bulvytės'
  `);

  if (oldMenuItem && !newMenuItem) {
    await query(`
      UPDATE menu_items
      SET name='Freida’s Soul bulvytės'
      WHERE name='Freda’s Soul bulvytės'
    `);
  }

  /*
    INDEXES THAT REQUIRE NEW COLUMNS
  */
  await query(`
    CREATE INDEX IF NOT EXISTS idx_menu_items_category
    ON menu_items(category, active)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_expenses_supplier
    ON expenses(supplier_id)
  `);
}

/* =========================================================
   SEED DATA
   ========================================================= */

export async function seedDatabase() {
  /* -------------------------
     BRANCHES
     ------------------------- */

  const vilnius =
    await ensureBranch('Vilnius');

  await ensureBranch('Kaunas');

  await ensureBranch('Klaipėda');

  /* -------------------------
     USERS
     ------------------------- */

  const owner =
    await ensureUser({
      username: 'owner',

      password:
        process.env.SEED_OWNER_PASSWORD ||
        'Owner123!',

      name: 'Owner',

      role: 'owner'
    });

  await ensureUser({
    username: 'samuel',

    password:
      process.env.SEED_WORKER_PASSWORD ||
      'Worker123!',

    name: 'Samuel',

    role: 'worker',

    branchId: vilnius.id
  });

  await ensureUser({
    username: 'clemence',

    password:
      process.env.SEED_WORKER_PASSWORD ||
      'Worker123!',

    name: 'Clemence',

    role: 'worker',

    branchId: vilnius.id
  });

  /* =========================================================
     REAL SUPPLIERS FROM THE INVOICES YOU PROVIDED
     ========================================================= */

  const vilne =
    await ensureSupplier({
      branchId: vilnius.id,

      name: 'UAB Vilnė',

      address:
        'Kirtimų g. 67D-101, Vilnius',

      supplies:
        'Chicken, beef and other meat products',

      notes:
        'Existing Freida’s meat supplier. Historical invoice images supplied by the owner include invoice VL154941 dated 18 September 2026.'
    });

  const sanitex =
    await ensureSupplier({
      branchId: vilnius.id,

      name: 'UAB SANITEX',

      address:
        'Ukmergės g. 250, Vilnius',

      supplies:
        'Groceries, mayonnaise, sauces and general food supplies',

      notes:
        'Existing Freida’s grocery supplier identified from historical invoice photographs supplied by the owner.'
    });

  const lavashSupplier =
    await ensureSupplier({
      branchId: vilnius.id,

      name:
        'Lavash Supplier - Name To Confirm',

      address:
        'Gardino g. 98, Vilnius',

      supplies:
        'Lavash / bread',

      notes:
        'Historical Freida’s lavash supplier. The legal company name is not fully visible in the supplied invoice image and should be confirmed before replacing this temporary supplier name.'
    });

  /* =========================================================
     CORE INVENTORY
     ========================================================= */

  const chicken =
    await ensureInventoryItem({
      branchId: vilnius.id,

      name: 'Chicken',

      category: 'Meat',

      unit: 'kg',

      reorderLevel: 0,

      preferredSupplierId:
        vilne.id
    });

  const beef =
    await ensureInventoryItem({
      branchId: vilnius.id,

      name: 'Beef',

      category: 'Meat',

      unit: 'kg',

      reorderLevel: 0,

      preferredSupplierId:
        vilne.id
    });

  await ensureInventoryItem({
    branchId: vilnius.id,

    name: 'Shawarma Sauce',

    category: 'Sauces',

    unit: 'jar',

    reorderLevel: 1,

    preferredSupplierId:
      sanitex.id
  });

  await ensureInventoryItem({
    branchId: vilnius.id,

    name: 'Garlic Sauce',

    category: 'Sauces',

    unit: 'jar',

    reorderLevel: 1,

    preferredSupplierId:
      sanitex.id
  });

  await ensureInventoryItem({
    branchId: vilnius.id,

    name: 'Lavash',

    category: 'Bread',

    unit: 'piece',

    reorderLevel: 0,

    preferredSupplierId:
      lavashSupplier.id
  });

  /* =========================================================
     EXISTING FOOD MENU
     ========================================================= */

  const foodItems = [
    'XXL Šavarma komplektas',
    'XXL kebabo komplektas',
    'Šavarma komplektas',
    'Kebabo komplektas',
    'Komplektas prancūziškoje duonoje',
    'Kebabas XXL',
    'Kebabas S',
    'Šavarma XXL',
    'Šavarma S',
    'BBQ sparneliai',
    'BBQ sparnelių komplektas',
    'Freida’s Soul bulvytės',
    'Turkiškos salotos',
    'Prancūziškoje duonoje',
    'Klasikinės salotos'
  ];

  let sortOrder = 1;

  for (const name of foodItems) {
    await ensureMenuItem({
      name,
      category: 'food',
      sortOrder
    });

    sortOrder += 1;
  }

  /* =========================================================
     DRINKS

     These use the SAME - 0 + worker interface.
     ========================================================= */

  const drinkDefinitions = [
    {
      name: 'Coca-Cola',
      inventoryName: 'Coca-Cola',
      unit: 'bottle'
    },
    {
      name: 'Fanta',
      inventoryName: 'Fanta',
      unit: 'bottle'
    },
    {
      name: 'Sprite',
      inventoryName: 'Sprite',
      unit: 'bottle'
    },
    {
      name: 'Water',
      inventoryName: 'Water',
      unit: 'bottle'
    }
  ];

  for (const drink of drinkDefinitions) {
    const inventoryItem =
      await ensureInventoryItem({
        branchId:
          vilnius.id,

        name:
          drink.inventoryName,

        category:
          'Drinks',

        unit:
          drink.unit,

        reorderLevel:
          0
      });

    const menuItem =
      await ensureMenuItem({
        name:
          drink.name,

        category:
          'drink',

        sortOrder
      });

    sortOrder += 1;

    /*
      1 drink sold = minus 1 from inventory.

      The actual deduction will happen in index.js when
      the worker SUBMITS the daily report.
    */
    await ensureMenuInventoryLink({
      branchId:
        vilnius.id,

      menuItemId:
        menuItem.id,

      inventoryItemId:
        inventoryItem.id,

      stockPerSale:
        1
    });
  }

  /* =========================================================
     HISTORICAL SUPPLIER PURCHASE

     Invoice clearly visible in the photo supplied:
     VL154941
     18 September 2026

     This is HISTORY ONLY.
     It does NOT add the old stock back into today's inventory.
     ========================================================= */

  await ensureHistoricalPurchase({
    branchId:
      vilnius.id,

    supplierId:
      vilne.id,

    createdByUserId:
      owner.id,

    purchaseDate:
      '2026-09-18',

    invoiceNumber:
      'VL154941',

    subtotal:
      155.57,

    vatAmount:
      32.67,

    totalAmount:
      188.24,

    notes:
      'Historical invoice imported from the invoice photograph supplied by the owner. Imported as purchase history only and does not change current inventory.',

    items: [
      {
        inventoryItemId:
          chicken.id,

        itemName:
          'Chicken meat',

        quantity:
          15.09,

        unit:
          'kg',

        unitCost:
          3.8,

        lineTotal:
          57.34
      },
      {
        inventoryItemId:
          beef.id,

        itemName:
          'Beef',

        quantity:
          9.4,

        unit:
          'kg',

        unitCost:
          10.45,

        lineTotal:
          98.23
      }
    ]
  });
}

/* =========================================================
   INITIALIZE
   ========================================================= */

export async function initializeDatabase() {
  /*
    CREATE TABLE IF NOT EXISTS protects existing tables/data.
  */
  await query(schema);

  /*
    Add new columns to tables that already existed before
    this upgrade.
  */
  await applySafeMigrations();

  /*
    Add only missing seed/reference records.
  */
  await seedDatabase();
}

/* =========================================================
   RESET

   DO NOT RUN THIS AGAINST YOUR LIVE DATABASE.
   ========================================================= */

export async function resetDatabase() {
  await query(`
    TRUNCATE TABLE
      stock_movements,
      purchase_items,
      purchases,
      menu_inventory_links,
      report_sales,
      daily_reports,
      attendance,
      expenses,
      needs,
      alerts,
      activity_logs,
      inventory_items,
      suppliers,
      users,
      menu_items,
      branches
    RESTART IDENTITY CASCADE
  `);

  await seedDatabase();
}