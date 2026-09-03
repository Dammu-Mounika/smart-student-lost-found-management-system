import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import initSqlJs, { Database } from "sql.js";

function getAppDir(): string {
  try {
    if (typeof __dirname !== "undefined") {
      return __dirname;
    }
  } catch {
    // Ignore
  }

  return process.cwd();
}

const appDir = getAppDir();
const app = express();
const PORT = 3000;

// ====================================================
// CORS
// ====================================================

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// ====================================================
// BODY PARSING
// ====================================================

app.use(
  express.json({
    limit: "15mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "15mb",
  }),
);

// ====================================================
// DATABASE
// ====================================================

const isVercel = Boolean(process.env.VERCEL);

const dbDir = isVercel ? "/tmp" : path.join(process.cwd(), "database");

if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (error) {
    console.warn("Could not create database directory:", error);
  }
}

const dbFilePath = path.join(dbDir, "lost_found.db");

let db: Database;

// ====================================================
// DATABASE HELPERS
// ====================================================

function saveDatabase(): void {
  try {
    if (!db) {
      return;
    }

    const binaryArray = db.export();
    const buffer = Buffer.from(binaryArray);

    fs.writeFileSync(dbFilePath, buffer);

    console.log("SQLite database saved successfully.");
  } catch (error) {
    console.error("Failed to save SQLite database:", error);
  }
}

function escapeSql(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

function queryAll(sql: string): any[] {
  try {
    if (!db) {
      return [];
    }

    const result = db.exec(sql);

    if (!result || !result[0] || !result[0].columns || !result[0].values) {
      return [];
    }

    const columns = result[0].columns;

    return result[0].values.map((row) =>
      Object.fromEntries(columns.map((column, index) => [column, row[index]])),
    );
  } catch (error) {
    console.error("queryAll error:", error);

    console.error("SQL:", sql);

    return [];
  }
}

function queryOne(sql: string): any | null {
  const rows = queryAll(sql);

  return rows.length > 0 ? rows[0] : null;
}

function queryVal(sql: string, defaultValue = 0): number {
  try {
    if (!db) {
      return defaultValue;
    }

    const result = db.exec(sql);

    if (!result || !result[0] || !result[0].values || !result[0].values[0]) {
      return defaultValue;
    }

    const value = Number(result[0].values[0][0]);

    return Number.isNaN(value) ? defaultValue : value;
  } catch {
    return defaultValue;
  }
}

function getLastInsertId(table: string): number {
  try {
    const result = db.exec("SELECT last_insert_rowid() AS id;");

    const value = Number(result[0]?.values?.[0]?.[0]);

    if (value > 0) {
      return value;
    }
  } catch {
    // Fallback below
  }

  const row = queryOne(`SELECT MAX(id) AS id FROM ${table};`);

  return Number(row?.id) || 1;
}

// ====================================================
// PASSWORD
// ====================================================

function hashPassword(password: string): string {
  const salt = "campus_lost_found_salt";

  return crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
}

// ====================================================
// TEXT MATCHING
// ====================================================

function cleanText(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "in",
    "on",
    "at",
    "near",
    "by",
    "of",
    "and",
    "or",
    "is",
    "it",
    "was",
    "for",
    "to",
    "my",
    "i",
    "found",
    "lost",
    "some",
    "with",
    "this",
  ]);

  const words = cleanText(text).split(" ").filter(Boolean);

  return new Set(
    words.filter((word) => word.length > 2 && !stopWords.has(word)),
  );
}

function calculateMatchScore(lostItem: any, foundItem: any) {
  const explanations: string[] = [];

  // --------------------------------------------
  // 1. CATEGORY - 30 POINTS
  // --------------------------------------------

  let categoryPoints = 0;

  const lostCategory = cleanText(lostItem.category || "");

  const foundCategory = cleanText(foundItem.category || "");

  if (lostCategory && foundCategory && lostCategory === foundCategory) {
    categoryPoints = 30;

    explanations.push(
      `Category matched exactly (${lostItem.category}): +30 pts`,
    );
  } else {
    explanations.push(
      `Categories differ ('${lostItem.category}' vs '${foundItem.category}'): 0 pts`,
    );
  }

  // --------------------------------------------
  // 2. ITEM NAME - 25 POINTS
  // --------------------------------------------

  let namePoints = 0;

  const lostName = cleanText(lostItem.item_name || "");

  const foundName = cleanText(foundItem.item_name || "");

  if (lostName && foundName && lostName === foundName) {
    namePoints = 25;

    explanations.push(
      `Item name exact match ('${lostItem.item_name}'): +25 pts`,
    );
  } else if (
    lostName &&
    foundName &&
    (lostName.includes(foundName) || foundName.includes(lostName))
  ) {
    namePoints = 20;

    explanations.push("Item name partial/contained match: +20 pts");
  } else {
    const lostWords = extractKeywords(lostItem.item_name || "");

    const foundWords = extractKeywords(foundItem.item_name || "");

    const overlap: string[] = [];

    lostWords.forEach((word) => {
      if (foundWords.has(word)) {
        overlap.push(word);
      }
    });

    if (overlap.length > 0) {
      const ratio =
        overlap.length / Math.max(lostWords.size, foundWords.size, 1);

      namePoints = Math.min(25, Math.round(ratio * 25));

      explanations.push(
        `Item name shared terms (${overlap.join(", ")}): +${namePoints} pts`,
      );
    } else {
      explanations.push("Item name has no common keywords: 0 pts");
    }
  }

  // --------------------------------------------
  // 3. LOCATION - 20 POINTS
  // --------------------------------------------

  let locationPoints = 0;

  const lostLocation = cleanText(lostItem.location || "");

  const foundLocation = cleanText(foundItem.location || "");

  if (lostLocation && foundLocation && lostLocation === foundLocation) {
    locationPoints = 20;

    explanations.push(`Location exact match ('${lostItem.location}'): +20 pts`);
  } else if (
    lostLocation &&
    foundLocation &&
    (lostLocation.includes(foundLocation) ||
      foundLocation.includes(lostLocation))
  ) {
    locationPoints = 15;

    explanations.push(
      `Location proximity match ('${lostItem.location}' & '${foundItem.location}'): +15 pts`,
    );
  } else {
    const lostWords = extractKeywords(lostItem.location || "");

    const foundWords = extractKeywords(foundItem.location || "");

    const overlap: string[] = [];

    lostWords.forEach((word) => {
      if (foundWords.has(word)) {
        overlap.push(word);
      }
    });

    if (overlap.length > 0) {
      locationPoints = 10;

      explanations.push(
        `Same campus zone detected (${overlap.join(", ")}): +10 pts`,
      );
    } else {
      explanations.push("Locations do not align: 0 pts");
    }
  }

  // --------------------------------------------
  // 4. DATE - 15 POINTS
  // --------------------------------------------

  let datePoints = 0;

  try {
    const date1 = new Date(String(lostItem.date).split("T")[0]);

    const date2 = new Date(String(foundItem.date).split("T")[0]);

    const difference = Math.abs(date2.getTime() - date1.getTime());

    const days = Math.round(difference / (1000 * 60 * 60 * 24));

    if (days === 0) {
      datePoints = 15;

      explanations.push("Same day occurrence: +15 pts");
    } else if (days <= 2) {
      datePoints = 12;

      explanations.push(`Within 2 days (${days} day gap): +12 pts`);
    } else if (days <= 5) {
      datePoints = 8;

      explanations.push(`Within 5 days (${days} day gap): +8 pts`);
    } else if (days <= 10) {
      datePoints = 5;

      explanations.push(`Within 10 days (${days} day gap): +5 pts`);
    } else {
      explanations.push(`Dates are ${days} days apart: 0 pts`);
    }
  } catch {
    explanations.push("Date format unparseable: 0 pts");
  }

  // --------------------------------------------
  // 5. DESCRIPTION - 10 POINTS
  // --------------------------------------------

  let descriptionPoints = 0;

  const lostDescription = extractKeywords(lostItem.description || "");

  const foundDescription = extractKeywords(foundItem.description || "");

  const descriptionOverlap: string[] = [];

  lostDescription.forEach((word) => {
    if (foundDescription.has(word)) {
      descriptionOverlap.push(word);
    }
  });

  if (descriptionOverlap.length >= 3) {
    descriptionPoints = 10;

    explanations.push(
      `High description keyword overlap (${descriptionOverlap
        .slice(0, 3)
        .join(", ")}...): +10 pts`,
    );
  } else if (descriptionOverlap.length >= 1) {
    descriptionPoints = 5;

    explanations.push(
      `Moderate description keyword overlap (${descriptionOverlap.join(
        ", ",
      )}): +5 pts`,
    );
  } else {
    explanations.push("No matching keywords in description: 0 pts");
  }

  const totalScore = Math.min(
    100,
    categoryPoints +
      namePoints +
      locationPoints +
      datePoints +
      descriptionPoints,
  );

  return {
    totalScore,
    breakdown: {
      category_points: categoryPoints,
      name_points: namePoints,
      location_points: locationPoints,
      date_points: datePoints,
      description_points: descriptionPoints,
      total_score: totalScore,
      explanations,
    },
  };
}

// ====================================================
// DATABASE INITIALIZATION
// ====================================================

async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  let fileBuffer: Buffer | null = null;

  const candidatePaths = [
    dbFilePath,
    path.join(process.cwd(), "database", "lost_found.db"),
    path.join(process.cwd(), "dist", "database", "lost_found.db"),
    path.join(appDir, "database", "lost_found.db"),
    path.join(appDir, "..", "database", "lost_found.db"),
  ];

  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const buffer = fs.readFileSync(candidate);

      if (buffer.length > 0) {
        fileBuffer = buffer;

        console.log("Loaded SQLite database from:", candidate);

        break;
      }
    } catch (error) {
      console.warn("Could not read database:", candidate);
    }
  }

  if (fileBuffer) {
    try {
      db = new SQL.Database(fileBuffer);
    } catch (error) {
      console.error(
        "Existing database could not be opened. Creating a new database.",
      );

      db = new SQL.Database();
    }
  } else {
    console.log("No existing database found. Creating new SQLite database.");

    db = new SQL.Database();
  }

  // ==================================================
  // USERS TABLE
  // ==================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ==================================================
  // ITEMS TABLE
  // ==================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      category TEXT NOT NULL,
      item_name TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      date TEXT NOT NULL,
      image TEXT,
      contact_info TEXT,
      status TEXT DEFAULT 'Lost',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ==================================================
  // MATCHES TABLE
  // ==================================================

  db.run(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lost_item_id INTEGER NOT NULL,
      found_item_id INTEGER NOT NULL,
      match_score INTEGER NOT NULL,
      score_breakdown TEXT,
      status TEXT DEFAULT 'Suggested',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ==================================================
  // DATABASE MIGRATION
  // ==================================================

  console.log("Checking SQLite database schema...");

  const itemColumns = queryAll("PRAGMA table_info(items);");

  const existingColumns = new Set(
    itemColumns.map((column: any) => String(column.name)),
  );

  const requiredColumns: Record<string, string> = {
    user_id: "INTEGER",
    item_type: "TEXT",
    category: "TEXT",
    item_name: "TEXT",
    description: "TEXT",
    location: "TEXT",
    date: "TEXT",
    image: "TEXT",
    contact_info: "TEXT",
    status: "TEXT",
  };

  for (const [columnName, columnType] of Object.entries(requiredColumns)) {
    if (existingColumns.has(columnName)) {
      continue;
    }

    try {
      let defaultValue = "";

      if (columnName === "status") {
        defaultValue = " DEFAULT 'Lost'";
      }

      db.run(
        `ALTER TABLE items ADD COLUMN ${columnName} ${columnType}${defaultValue};`,
      );

      console.log(`Database migration: added '${columnName}' column`);
    } catch (error) {
      console.error(`Database migration failed for '${columnName}':`, error);
    }
  }

  // ==================================================
  // SEED DATA
  // ==================================================

  const userCount = queryVal("SELECT COUNT(*) FROM users;");

  if (userCount === 0) {
    console.log("Seeding sample campus data...");

    const samplePassword = hashPassword("student123");

    db.run(`
      INSERT INTO users
      (name, email, password, phone)
      VALUES
      (
        'Alex Johnson',
        'alex.j@college.edu',
        '${samplePassword}',
        '9876543210'
      ),
      (
        'Sarah Miller',
        'sarah.m@college.edu',
        '${samplePassword}',
        '9876543211'
      ),
      (
        'David Chen',
        'david.c@college.edu',
        '${samplePassword}',
        '9876543212'
      ),
      (
        'Mounika Dammu',
        'mounikadammu83@gmail.com',
        '${samplePassword}',
        '9346215946'
      ),
      (
        'Emma Watson',
        'emma.w@college.edu',
        '${samplePassword}',
        '9876543299'
      ),
      (
        'Gowrish',
        'gowrish@gmail.com',
        '${samplePassword}',
        '+919912879540'
      );
    `);

    db.run(`
      INSERT INTO items
      (
        user_id,
        item_type,
        category,
        item_name,
        description,
        location,
        date,
        contact_info,
        status
      )
      VALUES
      (
        1,
        'lost',
        'ID Card',
        'Blue College ID Card',
        'Blue lanyard with engineering student ID card. Name Alex Johnson printed on it.',
        'Canteen',
        '2026-09-02',
        'alex.j@college.edu',
        'Lost'
      ),
      (
        2,
        'found',
        'ID Card',
        'College ID Card',
        'Found student ID card with blue ribbon near food counter.',
        'Near Canteen',
        '2026-09-02',
        'sarah.m@college.edu',
        'Found'
      ),
      (
        1,
        'lost',
        'Electronics',
        'Casio FX-991EX Calculator',
        'Scientific calculator with silver sliding case. Left on desk in 2nd floor library.',
        'Library 2nd Floor',
        '2026-09-01',
        'alex.j@college.edu',
        'Lost'
      ),
      (
        3,
        'found',
        'Electronics',
        'Casio Scientific Calculator',
        'Casio FX series calculator found on study table.',
        'Central Library',
        '2026-09-01',
        'david.c@college.edu',
        'Found'
      ),
      (
        2,
        'lost',
        'Keys',
        'Motorcycle Key with Honda Keychain',
        'Black key with silver Honda emblem ring and red tag.',
        'Main Parking Lot',
        '2026-08-31',
        'sarah.m@college.edu',
        'Lost'
      ),
      (
        3,
        'found',
        'Bag',
        'Navy Blue Laptop Backpack',
        'Dell backpack with water bottle in side pocket found near bench.',
        'Sports Ground',
        '2026-09-02',
        'david.c@college.edu',
        'Found'
      ),
      (
        4,
        'lost',
        'Bag',
        'Black Laptop Dell Bag',
        'Black bag with Dell name and charger in pocket.',
        'Near Library',
        '2026-09-03',
        'mounikadammu83@gmail.com',
        'Lost'
      ),
      (
        4,
        'lost',
        'Wallet',
        'Brown Leather Wallet',
        'Lost wallet with student ID and cash.',
        'Near Library',
        '2026-09-03',
        'mounikadammu83@gmail.com',
        'Lost'
      );
    `);

    saveDatabase();
  } else {
    // Ensure Mounika exists
    const mounika = queryOne(`
        SELECT id
        FROM users
        WHERE LOWER(email) =
        'mounikadammu83@gmail.com';
      `);

    if (!mounika) {
      const password = hashPassword("student123");

      db.run(`
        INSERT INTO users
        (name, email, password, phone)
        VALUES
        (
          'Mounika Dammu',
          'mounikadammu83@gmail.com',
          '${password}',
          '9346215946'
        );
      `);

      saveDatabase();
    }
  }

  runMatchingEngineOnAll();
}

// ====================================================
// MATCHING ENGINE
// ====================================================

function runMatchingEngineOnAll(): void {
  try {
    const lostItems = queryAll(`
        SELECT *
        FROM items
        WHERE item_type = 'lost'
        AND status IN
        ('Lost', 'Possible Match');
      `);

    const foundItems = queryAll(`
        SELECT *
        FROM items
        WHERE item_type = 'found'
        AND status IN
        ('Found', 'Possible Match');
      `);

    if (lostItems.length === 0 || foundItems.length === 0) {
      return;
    }

    for (const lost of lostItems) {
      for (const found of foundItems) {
        const existing = queryOne(`
            SELECT id
            FROM matches
            WHERE lost_item_id =
              ${Number(lost.id)}
            AND found_item_id =
              ${Number(found.id)};
          `);

        if (existing) {
          continue;
        }

        const { totalScore, breakdown } = calculateMatchScore(lost, found);

        if (totalScore >= 50) {
          const breakdownText = escapeSql(JSON.stringify(breakdown));

          db.run(`
            INSERT INTO matches
            (
              lost_item_id,
              found_item_id,
              match_score,
              score_breakdown,
              status
            )
            VALUES
            (
              ${Number(lost.id)},
              ${Number(found.id)},
              ${totalScore},
              '${breakdownText}',
              'Suggested'
            );
          `);

          db.run(`
            UPDATE items
            SET status = 'Possible Match'
            WHERE id =
              ${Number(lost.id)}
            AND status = 'Lost';
          `);

          db.run(`
            UPDATE items
            SET status = 'Possible Match'
            WHERE id =
              ${Number(found.id)}
            AND status = 'Found';
          `);
        }
      }
    }

    saveDatabase();
  } catch (error) {
    console.error("Matching engine error:", error);
  }
}

function checkMatchesForSingleItem(newItemId: number, itemType: string): void {
  try {
    const currentItem = queryOne(`
        SELECT *
        FROM items
        WHERE id =
          ${Number(newItemId)};
      `);

    if (!currentItem) {
      return;
    }

    const oppositeType = itemType === "lost" ? "found" : "lost";

    const candidates = queryAll(`
        SELECT *
        FROM items
        WHERE item_type =
          '${escapeSql(oppositeType)}'
        AND status IN
          ('Lost', 'Found', 'Possible Match');
      `);

    for (const candidate of candidates) {
      const lostItem = itemType === "lost" ? currentItem : candidate;

      const foundItem = itemType === "lost" ? candidate : currentItem;

      const existing = queryOne(`
          SELECT id
          FROM matches
          WHERE lost_item_id =
            ${Number(lostItem.id)}
          AND found_item_id =
            ${Number(foundItem.id)};
        `);

      if (existing) {
        continue;
      }

      const { totalScore, breakdown } = calculateMatchScore(
        lostItem,
        foundItem,
      );

      if (totalScore >= 50) {
        const breakdownText = escapeSql(JSON.stringify(breakdown));

        db.run(`
          INSERT INTO matches
          (
            lost_item_id,
            found_item_id,
            match_score,
            score_breakdown,
            status
          )
          VALUES
          (
            ${Number(lostItem.id)},
            ${Number(foundItem.id)},
            ${totalScore},
            '${breakdownText}',
            'Suggested'
          );
        `);

        db.run(`
          UPDATE items
          SET status = 'Possible Match'
          WHERE id =
            ${Number(lostItem.id)}
          AND status = 'Lost';
        `);

        db.run(`
          UPDATE items
          SET status = 'Possible Match'
          WHERE id =
            ${Number(foundItem.id)}
          AND status = 'Found';
        `);
      }
    }

    saveDatabase();
  } catch (error) {
    console.error("Single-item matching error:", error);
  }
}

// ====================================================
// HEALTH
// ====================================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Smart Student Lost & Found Management System",
  });
});

// ====================================================
// REGISTER
// ====================================================

app.post(["/api/register", "/register"], (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        detail: "Name, email, and password are required.",
      });
    }

    const cleanName = String(name).trim();

    const emailNorm = String(email).trim().toLowerCase();

    const cleanPassword = String(password).trim();

    const cleanPhone = phone ? String(phone).trim() : "";

    if (cleanName.length < 2) {
      return res.status(400).json({
        detail: "Please provide a valid full name.",
      });
    }

    if (!emailNorm.includes("@") || !emailNorm.includes(".")) {
      return res.status(400).json({
        detail: "Please provide a valid email address.",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        detail: "Password must be at least 6 characters.",
      });
    }

    const safeEmail = escapeSql(emailNorm);

    const existing = queryOne(`
          SELECT id, name, email, phone
          FROM users
          WHERE LOWER(email) =
            '${safeEmail}';
        `);

    if (existing) {
      return res.status(200).json({
        message: "Account already exists.",
        user: existing,
        ...existing,
      });
    }

    const hashed = hashPassword(cleanPassword);

    db.run(`
        INSERT INTO users
        (
          name,
          email,
          password,
          phone
        )
        VALUES
        (
          '${escapeSql(cleanName)}',
          '${safeEmail}',
          '${hashed}',
          '${escapeSql(cleanPhone)}'
        );
      `);

    const newId = getLastInsertId("users");

    saveDatabase();

    const user = queryOne(`
          SELECT id, name, email, phone
          FROM users
          WHERE id =
            ${newId};
        `);

    return res.status(201).json({
      message: "Registration successful.",
      user,
      ...user,
    });
  } catch (error: any) {
    console.error("Register error:", error);

    return res.status(500).json({
      detail: error?.message || "Registration failed.",
    });
  }
});

// ====================================================
// LOGIN
// ====================================================

app.post(["/api/login", "/login", "/api/auth/login"], (req, res) => {
  try {
    const { name, email, phone } = req.body || {};

    if (!email) {
      return res.status(400).json({
        detail: "Please provide your email address.",
      });
    }

    const emailNorm = String(email).trim().toLowerCase();

    const safeEmail = escapeSql(emailNorm);

    let user = queryOne(`
          SELECT id, name, email, phone
          FROM users
          WHERE LOWER(email) =
            '${safeEmail}';
        `);

    let nameNorm = name ? String(name).trim() : "Student";

    if (!user) {
      const password = hashPassword("student123");

      db.run(`
          INSERT INTO users
          (
            name,
            email,
            password,
            phone
          )
          VALUES
          (
            '${escapeSql(nameNorm)}',
            '${safeEmail}',
            '${password}',
            '${escapeSql(phone || "")}'
          );
        `);

      saveDatabase();

      const id = getLastInsertId("users");

      user = queryOne(`
            SELECT id, name, email, phone
            FROM users
            WHERE id = ${id};
          `);
    }

    return res.json({
      message: "Login successful.",
      user,
      ...user,
    });
  } catch (error: any) {
    console.error("Login error:", error);

    return res.status(500).json({
      detail: error?.message || "Login failed.",
    });
  }
});

// ====================================================
// REPORT LOST ITEM
// ====================================================

app.post("/api/items/lost", (req, res) => {
  try {
    console.log("========== LOST ITEM REQUEST ==========");

    console.log("Request body:", req.body);

    const {
      user_id,
      category,
      item_name,
      description,
      location,
      location_lost,
      date,
      date_lost,
      image,
      contact_info,
      email,
      student_name,
    } = req.body || {};

    const finalLocation = location || location_lost;

    const finalDate = date || date_lost;

    // --------------------------------------------
    // VALIDATION
    // --------------------------------------------

    if (
      !category ||
      !item_name ||
      !description ||
      !finalLocation ||
      !finalDate
    ) {
      console.error("Lost report validation failed.");

      return res.status(400).json({
        detail:
          "All core fields are required: category, item name, description, location, and date.",
      });
    }

    // --------------------------------------------
    // USER
    // --------------------------------------------

    let userId = Number(user_id) || 1;

    let studentUser: any = null;

    if (email && typeof email === "string" && email.trim()) {
      const emailNorm = email.trim().toLowerCase();

      const safeEmail = escapeSql(emailNorm);

      studentUser = queryOne(`
            SELECT id, name, email, phone
            FROM users
            WHERE LOWER(email) =
              '${safeEmail}';
          `);

      if (studentUser) {
        userId = Number(studentUser.id);
      } else {
        const studentName = String(student_name || "Student").trim();

        const phone = String(contact_info || "").trim();

        const password = hashPassword("student123");

        db.run(`
            INSERT INTO users
            (
              name,
              email,
              password,
              phone
            )
            VALUES
            (
              '${escapeSql(studentName)}',
              '${safeEmail}',
              '${password}',
              '${escapeSql(phone)}'
            );
          `);

        userId = getLastInsertId("users");

        studentUser = {
          id: userId,
          name: studentName,
          email: emailNorm,
          phone,
        };
      }
    } else {
      studentUser = queryOne(`
            SELECT id, name, email, phone
            FROM users
            WHERE id =
              ${userId};
          `);
    }

    // --------------------------------------------
    // SANITIZE VALUES
    // --------------------------------------------

    const safeCategory = escapeSql(category);

    const safeItemName = escapeSql(item_name);

    const safeDescription = escapeSql(description);

    const safeLocation = escapeSql(finalLocation);

    const safeDate = escapeSql(finalDate);

    const safeImage = escapeSql(image || "");

    const safeContact = escapeSql(contact_info || studentUser?.email || "");

    // --------------------------------------------
    // INSERT
    // --------------------------------------------

    console.log("Creating lost item...");

    db.run(`
        INSERT INTO items
        (
          user_id,
          item_type,
          category,
          item_name,
          description,
          location,
          date,
          image,
          contact_info,
          status
        )
        VALUES
        (
          ${userId},
          'lost',
          '${safeCategory}',
          '${safeItemName}',
          '${safeDescription}',
          '${safeLocation}',
          '${safeDate}',
          '${safeImage}',
          '${safeContact}',
          'Lost'
        );
      `);

    const newId = getLastInsertId("items");

    console.log("Lost item created with ID:", newId);

    // --------------------------------------------
    // MATCHING
    // --------------------------------------------

    checkMatchesForSingleItem(newId, "lost");

    // --------------------------------------------
    // SAVE
    // --------------------------------------------

    saveDatabase();

    const item = queryOne(`
          SELECT *
          FROM items
          WHERE id =
            ${newId};
        `);

    console.log("Lost report completed successfully.");

    return res.status(201).json({
      message: "Lost item reported successfully.",
      item,
      user: studentUser,
    });
  } catch (error: any) {
    console.error("======================================");

    console.error("❌ LOST REPORT ERROR");

    console.error("Message:", error?.message);

    console.error("Stack:", error?.stack);

    console.error("Request body:", req.body);

    console.error("======================================");

    return res.status(500).json({
      detail: error?.message || "Failed to report lost item.",
      error: true,
    });
  }
});

// ====================================================
// REPORT FOUND ITEM
// ====================================================

app.post("/api/items/found", (req, res) => {
  try {
    const {
      user_id,
      category,
      item_name,
      description,
      location,
      location_found,
      date,
      date_found,
      image,
      contact_info,
      email,
      finder_name,
    } = req.body || {};

    const finalLocation = location || location_found;

    const finalDate = date || date_found;

    if (
      !category ||
      !item_name ||
      !description ||
      !finalLocation ||
      !finalDate
    ) {
      return res.status(400).json({
        detail:
          "All core fields are required: category, item name, description, location, and date.",
      });
    }

    let userId = Number(user_id) || 1;

    let finderUser: any = null;

    if (email && typeof email === "string" && email.trim()) {
      const emailNorm = email.trim().toLowerCase();

      const safeEmail = escapeSql(emailNorm);

      finderUser = queryOne(`
            SELECT id, name, email, phone
            FROM users
            WHERE LOWER(email) =
              '${safeEmail}';
          `);

      if (finderUser) {
        userId = Number(finderUser.id);
      } else {
        const finderName = String(finder_name || "Student").trim();

        const phone = String(contact_info || "").trim();

        const password = hashPassword("student123");

        db.run(`
            INSERT INTO users
            (
              name,
              email,
              password,
              phone
            )
            VALUES
            (
              '${escapeSql(finderName)}',
              '${safeEmail}',
              '${password}',
              '${escapeSql(phone)}'
            );
          `);

        userId = getLastInsertId("users");

        finderUser = {
          id: userId,
          name: finderName,
          email: emailNorm,
          phone,
        };
      }
    } else {
      finderUser = queryOne(`
            SELECT id, name, email, phone
            FROM users
            WHERE id =
              ${userId};
          `);
    }

    const safeCategory = escapeSql(category);

    const safeItemName = escapeSql(item_name);

    const safeDescription = escapeSql(description);

    const safeLocation = escapeSql(finalLocation);

    const safeDate = escapeSql(finalDate);

    const safeImage = escapeSql(image || "");

    const safeContact = escapeSql(contact_info || finderUser?.email || "");

    db.run(`
        INSERT INTO items
        (
          user_id,
          item_type,
          category,
          item_name,
          description,
          location,
          date,
          image,
          contact_info,
          status
        )
        VALUES
        (
          ${userId},
          'found',
          '${safeCategory}',
          '${safeItemName}',
          '${safeDescription}',
          '${safeLocation}',
          '${safeDate}',
          '${safeImage}',
          '${safeContact}',
          'Found'
        );
      `);

    const newId = getLastInsertId("items");

    checkMatchesForSingleItem(newId, "found");

    saveDatabase();

    const item = queryOne(`
          SELECT *
          FROM items
          WHERE id =
            ${newId};
        `);

    return res.status(201).json({
      message: "Found item reported successfully.",
      item,
      user: finderUser,
    });
  } catch (error: any) {
    console.error("❌ FOUND REPORT ERROR:", error);

    return res.status(500).json({
      detail: error?.message || "Failed to report found item.",
      error: true,
    });
  }
});

// ====================================================
// GET ALL ITEMS
// ====================================================

app.get("/api/items", (req, res) => {
  try {
    const { item_type, category } = req.query;

    let sql = "SELECT * FROM items WHERE 1=1";

    if (item_type && item_type !== "all") {
      sql += `
          AND item_type =
          '${escapeSql(item_type)}'
        `;
    }

    if (category && category !== "All") {
      sql += `
          AND category =
          '${escapeSql(category)}'
        `;
    }

    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));

    sql += `
        ORDER BY id DESC
        LIMIT ${limit};
      `;

    const items = queryAll(sql);

    return res.json(items);
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to load items.",
    });
  }
});

// ====================================================
// SEARCH
// ====================================================

app.get("/api/items/search", (req, res) => {
  try {
    const queryText = (
      req.query.q ||
      req.query.name ||
      req.query.keyword ||
      req.query.search ||
      ""
    )
      .toString()
      .trim();

    const { category, location, date, status, item_type } = req.query;

    let sql = "SELECT * FROM items WHERE 1=1";

    if (category && category !== "All") {
      sql += `
          AND category =
          '${escapeSql(category)}'
        `;
    }

    if (location) {
      sql += `
          AND LOWER(location)
          LIKE '%${escapeSql(String(location).toLowerCase())}%'
        `;
    }

    if (date) {
      sql += `
          AND date =
          '${escapeSql(date)}'
        `;
    }

    if (status && status !== "All") {
      sql += `
          AND status =
          '${escapeSql(status)}'
        `;
    }

    if (item_type && item_type !== "all") {
      sql += `
          AND item_type =
          '${escapeSql(item_type)}'
        `;
    }

    sql += " ORDER BY id DESC;";

    const items = queryAll(sql);

    if (!queryText) {
      return res.json(items);
    }

    const words = queryText.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = items.map((item: any) => {
      const name = String(item.item_name || "").toLowerCase();

      const description = String(item.description || "").toLowerCase();

      const itemCategory = String(item.category || "").toLowerCase();

      const itemLocation = String(item.location || "").toLowerCase();

      let score = 0;
      let matchedWords = 0;

      if (name === queryText.toLowerCase()) {
        score += 30;
      } else if (name.includes(queryText.toLowerCase())) {
        score += 20;
      }

      for (const word of words) {
        let matched = false;

        if (name.includes(word)) {
          score += 6;
          matched = true;
        }

        if (itemCategory.includes(word)) {
          score += 5;
          matched = true;
        }

        if (description.includes(word)) {
          score += 4;
          matched = true;
        }

        if (itemLocation.includes(word)) {
          score += 3;
          matched = true;
        }

        if (matched) {
          matchedWords++;
        }
      }

      return {
        item,
        score,
        allWordsMatch: matchedWords === words.length,
      };
    });

    const fullMatches = scored.filter(
      (item) => item.allWordsMatch && item.score > 0,
    );

    if (fullMatches.length > 0) {
      return res.json(
        fullMatches.sort((a, b) => b.score - a.score).map((item) => item.item),
      );
    }

    return res.json(
      scored
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.item),
    );
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Search failed.",
    });
  }
});

// ====================================================
// GET ITEM BY ID
// ====================================================

app.get("/api/items/:id", (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        detail: "Invalid item ID.",
      });
    }

    const item = queryOne(`
          SELECT *
          FROM items
          WHERE id = ${id};
        `);

    if (!item) {
      return res.status(404).json({
        detail: "Item not found.",
      });
    }

    return res.json(item);
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to load item.",
    });
  }
});

// ====================================================
// MATCHES
// ====================================================

app.get("/api/matches", (req, res) => {
  try {
    const { status } = req.query;

    let sql = "SELECT * FROM matches WHERE 1=1";

    if (status && status !== "All") {
      sql += `
          AND status =
          '${escapeSql(status)}'
        `;
    }

    sql += `
        ORDER BY
        match_score DESC,
        id DESC;
      `;

    const matches = queryAll(sql);

    const enriched = matches.map((match: any) => {
      const lostItem = queryOne(`
                SELECT *
                FROM items
                WHERE id =
                  ${Number(match.lost_item_id)};
              `);

      const foundItem = queryOne(`
                SELECT *
                FROM items
                WHERE id =
                  ${Number(match.found_item_id)};
              `);

      let breakdown = null;

      try {
        if (match.score_breakdown) {
          breakdown = JSON.parse(String(match.score_breakdown));
        }
      } catch {
        breakdown = null;
      }

      return {
        ...match,
        lost_item: lostItem,
        found_item: foundItem,
        breakdown,
      };
    });

    return res.json(enriched);
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to load matches.",
    });
  }
});

app.get("/api/matches/:item_id", (req, res) => {
  try {
    const itemId = Number(req.params.item_id);

    const matches = queryAll(`
          SELECT *
          FROM matches
          WHERE
            lost_item_id =
              ${itemId}
            OR
            found_item_id =
              ${itemId}
          ORDER BY
            match_score DESC;
        `);

    const enriched = matches.map((match: any) => {
      const lostItem = queryOne(`
                SELECT *
                FROM items
                WHERE id =
                  ${Number(match.lost_item_id)};
              `);

      const foundItem = queryOne(`
                SELECT *
                FROM items
                WHERE id =
                  ${Number(match.found_item_id)};
              `);

      let breakdown = null;

      try {
        breakdown = match.score_breakdown
          ? JSON.parse(String(match.score_breakdown))
          : null;
      } catch {
        breakdown = null;
      }

      return {
        ...match,
        lost_item: lostItem,
        found_item: foundItem,
        breakdown,
      };
    });

    return res.json(enriched);
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to load matches.",
    });
  }
});

// ====================================================
// CONFIRM MATCH
// ====================================================

app.post("/api/matches/:match_id/confirm", (req, res) => {
  try {
    const matchId = Number(req.params.match_id);

    const match = queryOne(`
          SELECT *
          FROM matches
          WHERE id =
            ${matchId};
        `);

    if (!match) {
      return res.status(404).json({
        detail: "Match not found.",
      });
    }

    db.run(`
        UPDATE matches
        SET status = 'Confirmed'
        WHERE id =
          ${matchId};
      `);

    db.run(`
        UPDATE items
        SET status =
          'Match Verified'
        WHERE id IN
        (
          ${Number(match.lost_item_id)},
          ${Number(match.found_item_id)}
        );
      `);

    saveDatabase();

    return res.json({
      message: "Match successfully confirmed.",
      match_id: matchId,
      status: "Confirmed",
    });
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to confirm match.",
    });
  }
});

// ====================================================
// CONFIRM MATCH BY ITEM
// ====================================================

app.post("/api/items/:item_id/confirm-match", (req, res) => {
  try {
    const itemId = Number(req.params.item_id);

    const match = queryOne(`
          SELECT *
          FROM matches
          WHERE
            lost_item_id =
              ${itemId}
            OR
            found_item_id =
              ${itemId}
          ORDER BY
            CASE
              WHEN status =
                'Suggested'
              THEN 0
              ELSE 1
            END,
            match_score DESC
          LIMIT 1;
        `);

    if (!match) {
      return res.status(404).json({
        detail: "No match found for this item.",
      });
    }

    db.run(`
        UPDATE matches
        SET status = 'Confirmed'
        WHERE id =
          ${Number(match.id)};
      `);

    db.run(`
        UPDATE items
        SET status =
          'Match Verified'
        WHERE id IN
        (
          ${Number(match.lost_item_id)},
          ${Number(match.found_item_id)}
        );
      `);

    saveDatabase();

    return res.json({
      message: "Match successfully confirmed.",
      match_id: match.id,
      status: "Confirmed",
    });
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to confirm match.",
    });
  }
});

// ====================================================
// REJECT MATCH
// ====================================================

app.post("/api/matches/:match_id/reject", (req, res) => {
  try {
    const matchId = Number(req.params.match_id);

    const match = queryOne(`
          SELECT *
          FROM matches
          WHERE id =
            ${matchId};
        `);

    if (!match) {
      return res.status(404).json({
        detail: "Match not found.",
      });
    }

    db.run(`
        UPDATE matches
        SET status =
          'Rejected'
        WHERE id =
          ${matchId};
      `);

    const otherLost = queryOne(`
          SELECT id
          FROM matches
          WHERE
            lost_item_id =
              ${Number(match.lost_item_id)}
          AND id !=
              ${matchId}
          AND status IN
              ('Suggested', 'Confirmed');
        `);

    if (!otherLost) {
      db.run(`
          UPDATE items
          SET status =
            'Lost'
          WHERE id =
            ${Number(match.lost_item_id)}
          AND status =
            'Possible Match';
        `);
    }

    const otherFound = queryOne(`
          SELECT id
          FROM matches
          WHERE
            found_item_id =
              ${Number(match.found_item_id)}
          AND id !=
              ${matchId}
          AND status IN
              ('Suggested', 'Confirmed');
        `);

    if (!otherFound) {
      db.run(`
          UPDATE items
          SET status =
            'Found'
          WHERE id =
            ${Number(match.found_item_id)}
          AND status =
            'Possible Match';
        `);
    }

    saveDatabase();

    return res.json({
      message: "Match marked as not a match.",
      match_id: matchId,
      status: "Rejected",
    });
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to reject match.",
    });
  }
});

// ====================================================
// RESOLVE ITEM
// ====================================================

app.post("/api/items/:id/resolve", (req, res) => {
  try {
    const id = Number(req.params.id);

    const requestedStatus = req.body?.status || "Resolved";

    const status = String(requestedStatus).trim();

    db.run(`
        UPDATE items
        SET status =
          '${escapeSql(status)}'
        WHERE id =
          ${id};
      `);

    saveDatabase();

    return res.json({
      message: `Item marked as ${status}.`,
      item_id: id,
      status,
    });
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to resolve item.",
    });
  }
});

// ====================================================
// MY REPORTS
// ====================================================

app.get("/api/my-reports", (req, res) => {
  try {
    const userIdParam = req.query.user_id;

    const emailParam = req.query.email
      ? String(req.query.email).trim().toLowerCase()
      : null;

    if (userIdParam === "all") {
      return res.json(
        queryAll(`
            SELECT *
            FROM items
            ORDER BY id DESC;
          `),
      );
    }

    if (emailParam) {
      const email = escapeSql(emailParam);

      const user = queryOne(`
            SELECT id
            FROM users
            WHERE LOWER(email) =
              '${email}';
          `);

      if (user) {
        return res.json(
          queryAll(`
              SELECT *
              FROM items
              WHERE user_id =
                ${Number(user.id)}
              ORDER BY id DESC;
            `),
        );
      }

      return res.json([]);
    }

    const userId = Number(userIdParam) || 1;

    return res.json(
      queryAll(`
          SELECT *
          FROM items
          WHERE user_id =
            ${userId}
          ORDER BY id DESC;
        `),
    );
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to load reports.",
    });
  }
});

// ====================================================
// DASHBOARD STATS
// ====================================================

app.get("/api/stats", (req, res) => {
  try {
    const userId = req.query.user_id ? Number(req.query.user_id) : null;

    let lostCount = 0;
    let foundCount = 0;
    let matchCount = 0;
    let resolvedCount = 0;

    if (userId) {
      lostCount = queryVal(`
            SELECT COUNT(*)
            FROM items
            WHERE user_id =
              ${userId}
            AND item_type =
              'lost';
          `);

      foundCount = queryVal(`
            SELECT COUNT(*)
            FROM items
            WHERE user_id =
              ${userId}
            AND item_type =
              'found';
          `);

      const userItems = queryAll(`
            SELECT id
            FROM items
            WHERE user_id =
              ${userId};
          `);

      if (userItems.length) {
        const ids = userItems.map((item) => Number(item.id)).join(",");

        matchCount = queryVal(`
              SELECT COUNT(*)
              FROM matches
              WHERE
                (
                  lost_item_id
                  IN (${ids})
                  OR
                  found_item_id
                  IN (${ids})
                )
              AND status =
                'Suggested';
            `);
      }

      resolvedCount = queryVal(`
            SELECT COUNT(*)
            FROM items
            WHERE user_id =
              ${userId}
            AND status IN
              (
                'Resolved',
                'Match Verified'
              );
          `);
    } else {
      lostCount = queryVal(`
            SELECT COUNT(*)
            FROM items
            WHERE item_type =
              'lost';
          `);

      foundCount = queryVal(`
            SELECT COUNT(*)
            FROM items
            WHERE item_type =
              'found';
          `);

      matchCount = queryVal(`
            SELECT COUNT(*)
            FROM matches
            WHERE status =
              'Suggested';
          `);

      resolvedCount = queryVal(`
            SELECT COUNT(*)
            FROM items
            WHERE status IN
              (
                'Resolved',
                'Match Verified'
              );
          `);
    }

    const totalActive = queryVal(`
          SELECT COUNT(*)
          FROM items
          WHERE status IN
          (
            'Lost',
            'Found',
            'Possible Match'
          );
        `);

    return res.json({
      my_lost_reports: lostCount,
      my_found_reports: foundCount,
      possible_matches: matchCount,
      resolved_cases: resolvedCount,
      total_active_items: totalActive,
    });
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Failed to load dashboard statistics.",
    });
  }
});

// ====================================================
// MATCH CALCULATOR
// ====================================================

app.post("/api/match-calculator", (req, res) => {
  try {
    const { lost_item, found_item } = req.body || {};

    if (!lost_item || !found_item) {
      return res.status(400).json({
        detail: "Both lost_item and found_item are required.",
      });
    }

    const result = calculateMatchScore(lost_item, found_item);

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      detail: error?.message || "Match calculation failed.",
    });
  }
});

// ====================================================
// UNKNOWN API ROUTES
// ====================================================

app.all(["/api/*", "/api"], (req, res) => {
  return res.status(404).json({
    detail: `API endpoint not found: ${req.method} ${req.path}`,
  });
});

// ====================================================
// FRONTEND
// ====================================================

const frontendDir = fs.existsSync(path.join(process.cwd(), "frontend"))
  ? path.join(process.cwd(), "frontend")
  : path.join(appDir, "frontend");

app.use(express.static(frontendDir));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      detail: "API endpoint not found.",
    });
  }

  const possibleFile = path.join(frontendDir, req.path);

  if (fs.existsSync(possibleFile) && fs.statSync(possibleFile).isFile()) {
    return res.sendFile(possibleFile);
  }

  const possibleHtml = path.join(frontendDir, `${req.path}.html`);

  if (fs.existsSync(possibleHtml) && fs.statSync(possibleHtml).isFile()) {
    return res.sendFile(possibleHtml);
  }

  return res.sendFile(path.join(frontendDir, "index.html"));
});

// ====================================================
// GLOBAL ERROR HANDLER
// ====================================================

app.use((error: any, req: any, res: any, next: any) => {
  console.error("Global Express error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(Number(error?.status || error?.statusCode) || 500).json({
    detail: error?.message || "Internal server error.",
    error: true,
  });
});

// ====================================================
// EXPORTS
// ====================================================

export { app, initDatabase };

// ====================================================
// START SERVER
// ====================================================

async function start(): Promise<void> {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Smart Student Lost & Found Server running on http://0.0.0.0:${PORT}`,
      );
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);

    process.exit(1);
  }
}

// ====================================================
// START ONLY OUTSIDE VERCEL
// ====================================================

if (!process.env.VERCEL) {
  start();
}
