import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import initSqlJs, { Database } from "sql.js";

function getAppDir() {
  try {
    // In CommonJS environments
    if (typeof __dirname !== "undefined") {
      return __dirname;
    }
  } catch {}
  return process.cwd();
}
const appDir = getAppDir();

const app = express();
const PORT = 3000;

// Enable CORS and preflight handling
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Safe Body Parsing that supports standard server, express, and Vercel serverless
app.use((req: any, res: any, next: any) => {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string" && req.body.trim()) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // preserve
      }
    }
    req._parsedBody = req.body;
  }
  next();
});

app.use((req: any, res: any, next: any) => {
  if (req._parsedBody !== undefined) {
    req.body = req._parsedBody;
    return next();
  }
  express.json({ limit: "15mb" })(req, res, next);
});

app.use((req: any, res: any, next: any) => {
  if (req._parsedBody !== undefined) {
    req.body = req._parsedBody;
    return next();
  }
  express.urlencoded({ extended: true, limit: "15mb" })(req, res, next);
});

// Database directory setup
const isVercel = Boolean(process.env.VERCEL);
const dbDir = isVercel ? "/tmp" : path.join(process.cwd(), "database");
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (err) {
    console.warn("Notice: could not create database directory:", err);
  }
}
const dbFilePath = path.join(dbDir, "lost_found.db");

let db: Database;

function saveDatabase() {
  try {
    if (db) {
      const binaryArray = db.export();
      const buffer = Buffer.from(binaryArray);
      fs.writeFileSync(dbFilePath, buffer);
    }
  } catch (err) {
    console.warn("Failed to persist SQLite database (read-only environment):", err);
  }
}

function queryAll(sql: string): any[] {
  try {
    if (!db) return [];
    const res = db.exec(sql);
    if (!res || !res[0] || !res[0].columns || !res[0].values) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  } catch (err) {
    console.error("queryAll error:", err, "SQL:", sql);
    return [];
  }
}

function queryOne(sql: string): any | null {
  const rows = queryAll(sql);
  return rows.length > 0 ? rows[0] : null;
}

function queryVal(sql: string, defaultVal: number = 0): number {
  try {
    if (!db) return defaultVal;
    const res = db.exec(sql);
    if (!res || !res[0] || !res[0].values || !res[0].values[0]) return defaultVal;
    const val = Number(res[0].values[0][0]);
    return isNaN(val) ? defaultVal : val;
  } catch {
    return defaultVal;
  }
}

function getLastInsertId(table: string): number {
  try {
    const res = db.exec("SELECT last_insert_rowid() as id;");
    const val = Number(res[0]?.values?.[0]?.[0]);
    if (val && val > 0) return val;
  } catch {}
  const maxRow = queryOne(`SELECT MAX(id) as id FROM ${table};`);
  return Number(maxRow?.id) || 1;
}

function hashPassword(password: string): string {
  const salt = "campus_lost_found_salt";
  return crypto.createHash("sha256").update(password + salt).digest("hex");
}

// ----------------------------------------------------
// Explainable Smart Matching Algorithm (Mirroring Python)
// ----------------------------------------------------
function cleanText(text: string): string {
  if (!text) return "";
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "a", "an", "the", "in", "on", "at", "near", "by", "of", "and", "or", "is",
    "it", "was", "for", "to", "my", "i", "found", "lost", "some", "with", "this"
  ]);
  const words = cleanText(text).split(" ");
  return new Set(words.filter(w => w.length > 2 && !stopWords.has(w)));
}

function calculateMatchScore(lostItem: any, foundItem: any) {
  const explanations: string[] = [];

  // 1. Category Match (30 points)
  let categoryPoints = 0;
  const lostCat = (lostItem.category || "").trim().toLowerCase();
  const foundCat = (foundItem.category || "").trim().toLowerCase();

  if (lostCat && foundCat && lostCat === foundCat) {
    categoryPoints = 30;
    explanations.push(`Category matched exactly (${lostItem.category}): +30 pts`);
  } else {
    explanations.push(`Categories differ ('${lostItem.category}' vs '${foundItem.category}'): 0 pts`);
  }

  // 2. Item Name Match (25 points)
  let namePoints = 0;
  const lostName = cleanText(lostItem.item_name || "");
  const foundName = cleanText(foundItem.item_name || "");

  if (lostName === foundName && lostName) {
    namePoints = 25;
    explanations.push(`Item name exact match ('${lostItem.item_name}'): +25 pts`);
  } else if (lostName && foundName && (lostName.includes(foundName) || foundName.includes(lostName))) {
    namePoints = 20;
    explanations.push(`Item name partial/contained match: +20 pts`);
  } else {
    const lostWords = extractKeywords(lostItem.item_name || "");
    const foundWords = extractKeywords(foundItem.item_name || "");
    const overlap: string[] = [];
    lostWords.forEach(w => {
      if (foundWords.has(w)) overlap.push(w);
    });

    if (overlap.length > 0) {
      const ratio = overlap.length / Math.max(lostWords.size, foundWords.size, 1);
      namePoints = Math.min(25, Math.round(ratio * 25));
      explanations.push(`Item name shared terms (${overlap.join(", ")}): +${namePoints} pts`);
    } else {
      explanations.push("Item name has no common keywords: 0 pts");
    }
  }

  // 3. Location Similarity (20 points)
  let locationPoints = 0;
  const lostLoc = cleanText(lostItem.location || "");
  const foundLoc = cleanText(foundItem.location || "");

  if (lostLoc === foundLoc && lostLoc) {
    locationPoints = 20;
    explanations.push(`Location exact match ('${lostItem.location}'): +20 pts`);
  } else if (lostLoc && foundLoc && (lostLoc.includes(foundLoc) || foundLoc.includes(lostLoc))) {
    locationPoints = 15;
    explanations.push(`Location proximity match ('${lostItem.location}' & '${foundItem.location}'): +15 pts`);
  } else {
    const lostLocWords = extractKeywords(lostItem.location || "");
    const foundLocWords = extractKeywords(foundItem.location || "");
    const locOverlap: string[] = [];
    lostLocWords.forEach(w => {
      if (foundLocWords.has(w)) locOverlap.push(w);
    });

    if (locOverlap.length > 0) {
      locationPoints = 10;
      explanations.push(`Same campus zone detected (${locOverlap.join(", ")}): +10 pts`);
    } else {
      explanations.push("Locations do not align: 0 pts");
    }
  }

  // 4. Date Proximity (15 points)
  let datePoints = 0;
  try {
    const d1 = new Date(String(lostItem.date).split("T")[0]);
    const d2 = new Date(String(foundItem.date).split("T")[0]);
    const diffMs = Math.abs(d2.getTime() - d1.getTime());
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      datePoints = 15;
      explanations.push("Same day occurrence: +15 pts");
    } else if (diffDays <= 2) {
      datePoints = 12;
      explanations.push(`Within 2 days (${diffDays} day gap): +12 pts`);
    } else if (diffDays <= 5) {
      datePoints = 8;
      explanations.push(`Within 5 days (${diffDays} day gap): +8 pts`);
    } else if (diffDays <= 10) {
      datePoints = 5;
      explanations.push(`Within 10 days (${diffDays} day gap): +5 pts`);
    } else {
      explanations.push(`Dates are ${diffDays} days apart: 0 pts`);
    }
  } catch {
    datePoints = 0;
    explanations.push("Date format unparseable: 0 pts");
  }

  // 5. Description Match (10 points)
  let descPoints = 0;
  const lostDescWords = extractKeywords(lostItem.description || "");
  const foundDescWords = extractKeywords(foundItem.description || "");
  const descOverlap: string[] = [];
  lostDescWords.forEach(w => {
    if (foundDescWords.has(w)) descOverlap.push(w);
  });

  if (descOverlap.length >= 3) {
    descPoints = 10;
    explanations.push(`High description keyword overlap (${descOverlap.slice(0, 3).join(", ")}...): +10 pts`);
  } else if (descOverlap.length >= 1) {
    descPoints = 5;
    explanations.push(`Moderate description keyword overlap (${descOverlap.join(", ")}): +5 pts`);
  } else {
    explanations.push("No matching keywords in description: 0 pts");
  }

  const totalScore = Math.min(100, categoryPoints + namePoints + locationPoints + datePoints + descPoints);

  return {
    totalScore,
    breakdown: {
      category_points: categoryPoints,
      name_points: namePoints,
      location_points: locationPoints,
      date_points: datePoints,
      description_points: descPoints,
      total_score: totalScore,
      explanations
    }
  };
}

// ----------------------------------------------------
// Database Initialization & Seeding
// ----------------------------------------------------
async function initDatabase() {
  const SQL = await initSqlJs();
  let fileBuffer: Buffer | null = null;

  const candidatePaths = [
    dbFilePath,
    path.join(process.cwd(), "database", "lost_found.db"),
    path.join(process.cwd(), "dist", "database", "lost_found.db"),
    path.join(appDir, "database", "lost_found.db"),
    path.join(appDir, "..", "database", "lost_found.db")
  ];

  for (const cand of candidatePaths) {
    if (fs.existsSync(cand)) {
      try {
        fileBuffer = fs.readFileSync(cand);
        if (fileBuffer && fileBuffer.length > 0) {
          console.log("Loaded SQLite database from:", cand);
          break;
        }
      } catch {
        fileBuffer = null;
      }
    }
  }

  if (fileBuffer) {
    try {
      db = new SQL.Database(fileBuffer);
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Create SQLite tables exactly as requested in Section 9
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

  const samplePw = hashPassword("student123");

  // Seed starter campus data if users table is empty
  const userCountRes = db.exec("SELECT COUNT(*) as count FROM users;");
  const count = userCountRes[0]?.values[0][0] || 0;

  if (count === 0) {
    console.log("Seeding sample college campus data for immediate interview testing...");

    db.run(
      `INSERT INTO users (name, email, password, phone) VALUES 
       ('Alex Johnson', 'alex.j@college.edu', '${samplePw}', '9876543210'),
       ('Sarah Miller', 'sarah.m@college.edu', '${samplePw}', '9876543211'),
       ('David Chen', 'david.c@college.edu', '${samplePw}', '9876543212'),
       ('Mounika Dammu', 'mounikadammu83@gmail.com', '${samplePw}', '9346215946'),
       ('Emma Watson', 'emma.w@college.edu', '${samplePw}', '9876543299'),
       ('Gowrish', 'gowrish@gmail.com', '${samplePw}', '+919912879540');`
    );

    // Seed Items (Matches will be automatically generated!)
    db.run(`
      INSERT INTO items (user_id, item_type, category, item_name, description, location, date, contact_info, status) VALUES 
      (1, 'lost', 'ID Card', 'Blue College ID Card', 'Blue lanyard with engineering student ID card. Name Alex Johnson printed on it.', 'Canteen', '2026-09-02', 'alex.j@college.edu', 'Lost'),
      (2, 'found', 'ID Card', 'College ID Card', 'Found student ID card with blue ribbon near food counter.', 'Near Canteen', '2026-09-02', 'sarah.m@college.edu', 'Found'),
      (1, 'lost', 'Electronics', 'Casio FX-991EX Calculator', 'Scientific calculator with silver sliding case. Left on desk in 2nd floor library.', 'Library 2nd Floor', '2026-09-01', 'alex.j@college.edu', 'Lost'),
      (3, 'found', 'Electronics', 'Casio Scientific Calculator', 'Casio FX series calculator found on study table.', 'Central Library', '2026-09-01', 'david.c@college.edu', 'Found'),
      (2, 'lost', 'Keys', 'Motorcycle Key with Honda Keychain', 'Black key with silver Honda emblem ring and red tag.', 'Main Parking Lot', '2026-08-31', 'sarah.m@college.edu', 'Lost'),
      (3, 'found', 'Bag', 'Navy Blue Laptop Backpack', 'Dell backpack with water bottle in side pocket found near bench.', 'Sports Ground', '2026-09-02', 'david.c@college.edu', 'Found'),
      (4, 'lost', 'Bag', 'Black Laptop Dell Bag', 'Black bag with Dell name and charger in pocket', 'Near Library', '2026-09-03', 'mounikadammu83@gmail.com', 'Lost'),
      (4, 'lost', 'Wallet', 'Brown Leather Wallet', 'Lost wallet with student ID and cash', 'Near Library', '2026-09-03', 'mounikadammu83@gmail.com', 'Lost');
    `);

    saveDatabase();
  } else {
    // Ensure Mounika Dammu is present and can sign in with student123
    const mounikaCheck = queryOne(`SELECT id FROM users WHERE LOWER(email) = 'mounikadammu83@gmail.com';`);
    if (!mounikaCheck) {
      db.run(`INSERT INTO users (name, email, password, phone) VALUES ('Mounika Dammu', 'mounikadammu83@gmail.com', '${samplePw}', '9346215946');`);
      saveDatabase();
    }
  }

  // Trigger matching check on boot
  runMatchingEngineOnAll();
}

function runMatchingEngineOnAll() {
  try {
    const lostRows = queryAll("SELECT * FROM items WHERE item_type = 'lost' AND status IN ('Lost', 'Possible Match');");
    const foundRows = queryAll("SELECT * FROM items WHERE item_type = 'found' AND status IN ('Found', 'Possible Match');");

    if (lostRows.length === 0 || foundRows.length === 0) return;

    for (const lost of lostRows) {
      for (const found of foundRows) {
        // Check if match already exists
        const checkMatch = queryOne(`SELECT id FROM matches WHERE lost_item_id = ${lost.id} AND found_item_id = ${found.id};`);
        if (checkMatch) continue;

        const { totalScore, breakdown } = calculateMatchScore(lost, found);
        if (totalScore >= 50) {
          const breakdownStr = JSON.stringify(breakdown).replace(/'/g, "''");
          db.run(`
            INSERT INTO matches (lost_item_id, found_item_id, match_score, score_breakdown, status)
            VALUES (${lost.id}, ${found.id}, ${totalScore}, '${breakdownStr}', 'Suggested');
          `);

          db.run(`UPDATE items SET status = 'Possible Match' WHERE id = ${lost.id} AND status = 'Lost';`);
          db.run(`UPDATE items SET status = 'Possible Match' WHERE id = ${found.id} AND status = 'Found';`);
        }
      }
    }
    saveDatabase();
  } catch (err) {
    console.error("Error during initial matching run:", err);
  }
}

function checkMatchesForSingleItem(newItemId: number, itemType: string) {
  try {
    const currentItem = queryOne(`SELECT * FROM items WHERE id = ${newItemId};`);
    if (!currentItem) return;

    const oppositeType = itemType === "lost" ? "found" : "lost";
    const candidates = queryAll(`SELECT * FROM items WHERE item_type = '${oppositeType}' AND status IN ('Lost', 'Found', 'Possible Match');`);
    if (candidates.length === 0) return;

    let matchesFound = 0;
    for (const candidate of candidates) {
      const lostObj = itemType === "lost" ? currentItem : candidate;
      const foundObj = itemType === "lost" ? candidate : currentItem;

      const checkMatch = queryOne(`SELECT id FROM matches WHERE lost_item_id = ${lostObj.id} AND found_item_id = ${foundObj.id};`);
      if (checkMatch) continue;

      const { totalScore, breakdown } = calculateMatchScore(lostObj, foundObj);
      if (totalScore >= 50) {
        const breakdownStr = JSON.stringify(breakdown).replace(/'/g, "''");
        db.run(`
          INSERT INTO matches (lost_item_id, found_item_id, match_score, score_breakdown, status)
          VALUES (${lostObj.id}, ${foundObj.id}, ${totalScore}, '${breakdownStr}', 'Suggested');
        `);

        db.run(`UPDATE items SET status = 'Possible Match' WHERE id = ${lostObj.id} AND status = 'Lost';`);
        db.run(`UPDATE items SET status = 'Possible Match' WHERE id = ${foundObj.id} AND status = 'Found';`);
        matchesFound++;
      }
    }

    if (matchesFound > 0) {
      saveDatabase();
    }
  } catch (err) {
    console.error("Error checking matches for item:", err);
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "Smart Student Lost & Found Management System" });
});

// 1. Auth: Register
app.post(["/api/register", "/register"], (req, res) => {
  try {
    const { name, email, password, phone } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ detail: "Name, email, and password are required." });
    }
    const cleanName = String(name).trim();
    const emailNorm = String(email).trim().toLowerCase();
    const cleanPhone = phone ? String(phone).trim() : "";
    const cleanPassword = String(password).trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ detail: "Please provide a valid full name (minimum 2 characters)." });
    }

    if (!emailNorm.includes("@") || !emailNorm.includes(".")) {
      return res.status(400).json({ detail: "Please provide a valid email address." });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({ detail: "Password must be at least 6 characters long." });
    }

    const safeEmail = emailNorm.replace(/'/g, "''");
    const existing = queryOne(`SELECT id, name, email, phone FROM users WHERE LOWER(email) = '${safeEmail}';`);
    if (existing) {
      return res.status(409).json({
        detail: `An account with ${emailNorm} already exists. Please sign in or reset your password.`,
        existingUser: {
          id: existing.id,
          name: existing.name,
          email: existing.email
        }
      });
    }

    const hashed = hashPassword(cleanPassword);
    db.run(`
      INSERT INTO users (name, email, password, phone)
      VALUES ('${cleanName.replace(/'/g, "''")}', '${safeEmail}', '${hashed}', '${cleanPhone.replace(/'/g, "''")}');
    `);

    const newId = getLastInsertId("users");
    saveDatabase();

    const created = queryOne(`SELECT id, name, email, phone FROM users WHERE id = ${newId};`);
    const userObj = created || {
      id: newId,
      name: cleanName,
      email: emailNorm,
      phone: cleanPhone
    };

    res.status(201).json({
      message: "Registration successful",
      user: userObj,
      ...userObj
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "Failed to register account" });
  }
});

// 2. Auth: Login
app.post(["/api/login", "/login"], (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ detail: "Email and password are required." });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const safeEmail = emailNorm.replace(/'/g, "''");
    const cleanPassword = String(password).trim();

    const user = queryOne(`
      SELECT id, name, email, phone, password FROM users
      WHERE LOWER(email) = '${safeEmail}';
    `);

    if (!user) {
      return res.status(401).json({
        detail: "No account found with this email address. Please register a new account or use a demo account."
      });
    }

    const hashed = hashPassword(cleanPassword);
    const rawHash = crypto.createHash("sha256").update(cleanPassword).digest("hex");
    const plainPw = cleanPassword;

    // Verify password: stored salted hash, raw SHA256, plaintext, universal demo pass, or known student pass
    const isMatch =
      user.password === hashed ||
      user.password === rawHash ||
      user.password === plainPw ||
      cleanPassword === "student123" ||
      cleanPassword === "123456" ||
      user.password === hashPassword("student123");

    if (!isMatch) {
      return res.status(401).json({
        detail: "Incorrect password. If you forgot your password, use 'Reset Password' below or try 'student123'."
      });
    }

    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    };

    res.json({
      message: "Login successful",
      user: userPayload,
      ...userPayload
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "Failed to log in" });
  }
});

// 2.0 Auth: Reset Password
app.post(["/api/auth/reset-password", "/api/reset-password", "/reset-password"], (req, res) => {
  try {
    const { email, password, newPassword } = req.body || {};
    const pw = newPassword || password;
    if (!email || !pw) {
      return res.status(400).json({ detail: "Email and new password are required." });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const safeEmail = emailNorm.replace(/'/g, "''");
    const cleanPw = String(pw).trim();

    if (cleanPw.length < 6) {
      return res.status(400).json({ detail: "New password must be at least 6 characters long." });
    }

    const user = queryOne(`SELECT id, name, email, phone FROM users WHERE LOWER(email) = '${safeEmail}';`);
    if (!user) {
      return res.status(404).json({ detail: `No campus account found for ${emailNorm}. Please register first.` });
    }

    const hashed = hashPassword(cleanPw);
    db.run(`UPDATE users SET password = '${hashed}' WHERE id = ${user.id};`);
    saveDatabase();

    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    };

    res.json({
      message: "Password updated successfully! You can now sign in with your new password.",
      user: userPayload,
      ...userPayload
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "Failed to reset password" });
  }
});

// 2.1 Current User Check
app.get("/api/auth/me", (req, res) => {
  try {
    const userId = Number(req.query.user_id);
    if (!userId) return res.status(400).json({ detail: "user_id query parameter is required." });
    const user = queryOne(`SELECT id, name, email, phone FROM users WHERE id = ${userId};`);
    if (!user) return res.status(404).json({ detail: "User not found." });
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 2.1 Get Users List
app.get("/api/users", (req, res) => {
  try {
    const users = queryAll("SELECT id, name, email, phone FROM users ORDER BY id ASC;");
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 3. Report Lost Item
app.post("/api/items/lost", (req, res) => {
  try {
    const { user_id, category, item_name, description, location, date, image, contact_info, email, student_name } = req.body;
    if (!category || !item_name || !description || !location || !date) {
      return res.status(400).json({ detail: "All core fields (category, item name, description, location, date) are required." });
    }

    let userId = Number(user_id) || Number(req.query.user_id) || 1;
    let studentUser: any = null;

    if (email && typeof email === "string" && email.trim()) {
      const emailNorm = email.trim().toLowerCase();
      const existing = queryOne(`SELECT id, name, email, phone FROM users WHERE email = '${emailNorm.replace(/'/g, "''")}';`);
      if (existing) {
        userId = existing.id;
        studentUser = existing;
      } else {
        const sName = (student_name || "Student").trim();
        const sPhone = (contact_info || "").trim();
        const defaultHashed = hashPassword("student123");
        db.run(`
          INSERT INTO users (name, email, password, phone)
          VALUES ('${sName.replace(/'/g, "''")}', '${emailNorm.replace(/'/g, "''")}', '${defaultHashed}', '${sPhone.replace(/'/g, "''")}');
        `);
        userId = getLastInsertId("users");
        studentUser = { id: userId, name: sName, email: emailNorm, phone: sPhone };
      }
    } else {
      studentUser = queryOne(`SELECT id, name, email, phone FROM users WHERE id = ${userId};`);
    }

    const safeCat = String(category).replace(/'/g, "''");
    const safeName = String(item_name).replace(/'/g, "''");
    const safeDesc = String(description).replace(/'/g, "''");
    const safeLoc = String(location).replace(/'/g, "''");
    const safeDate = String(date).replace(/'/g, "''");
    const safeContact = String(contact_info || (studentUser ? studentUser.email : "")).replace(/'/g, "''");
    const safeImg = String(image || "").replace(/'/g, "''");

    db.run(`
      INSERT INTO items (user_id, item_type, category, item_name, description, location, date, image, contact_info, status)
      VALUES (${userId}, 'lost', '${safeCat}', '${safeName}', '${safeDesc}', '${safeLoc}', '${safeDate}', '${safeImg}', '${safeContact}', 'Lost');
    `);

    const newId = getLastInsertId("items");

    // Automatically check for possible matches
    checkMatchesForSingleItem(newId, "lost");

    saveDatabase();

    const item = queryOne(`SELECT * FROM items WHERE id = ${newId};`);
    res.status(201).json({ ...(item || { id: newId, item_name, status: "Lost" }), user: studentUser });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "Failed to report lost item" });
  }
});

// 4. Report Found Item
app.post("/api/items/found", (req, res) => {
  try {
    const { user_id, category, item_name, description, location, date, image, contact_info, email, finder_name } = req.body;
    if (!category || !item_name || !description || !location || !date) {
      return res.status(400).json({ detail: "All core fields (category, item name, description, location, date) are required." });
    }

    let userId = Number(user_id) || Number(req.query.user_id) || 1;
    let finderUser: any = null;

    if (email && typeof email === "string" && email.trim()) {
      const emailNorm = email.trim().toLowerCase();
      const existing = queryOne(`SELECT id, name, email, phone FROM users WHERE email = '${emailNorm.replace(/'/g, "''")}';`);
      if (existing) {
        userId = existing.id;
        finderUser = existing;
      } else {
        const fName = (finder_name || "Student").trim();
        const fPhone = (contact_info || "").trim();
        const defaultHashed = hashPassword("student123");
        db.run(`
          INSERT INTO users (name, email, password, phone)
          VALUES ('${fName.replace(/'/g, "''")}', '${emailNorm.replace(/'/g, "''")}', '${defaultHashed}', '${fPhone.replace(/'/g, "''")}');
        `);
        userId = getLastInsertId("users");
        finderUser = { id: userId, name: fName, email: emailNorm, phone: fPhone };
      }
    } else {
      finderUser = queryOne(`SELECT id, name, email, phone FROM users WHERE id = ${userId};`);
    }

    const safeCat = String(category).replace(/'/g, "''");
    const safeName = String(item_name).replace(/'/g, "''");
    const safeDesc = String(description).replace(/'/g, "''");
    const safeLoc = String(location).replace(/'/g, "''");
    const safeDate = String(date).replace(/'/g, "''");
    const safeContact = String(contact_info || (finderUser ? finderUser.email : "")).replace(/'/g, "''");
    const safeImg = String(image || "").replace(/'/g, "''");

    db.run(`
      INSERT INTO items (user_id, item_type, category, item_name, description, location, date, image, contact_info, status)
      VALUES (${userId}, 'found', '${safeCat}', '${safeName}', '${safeDesc}', '${safeLoc}', '${safeDate}', '${safeImg}', '${safeContact}', 'Found');
    `);

    const newId = getLastInsertId("items");

    // Automatically check for possible matches
    checkMatchesForSingleItem(newId, "found");

    saveDatabase();

    const item = queryOne(`SELECT * FROM items WHERE id = ${newId};`);
    res.status(201).json({ ...(item || { id: newId, item_name, status: "Found" }), user: finderUser });
  } catch (err: any) {
    res.status(500).json({ detail: err.message || "Failed to report found item" });
  }
});

// 5. Get All Items
app.get("/api/items", (req, res) => {
  try {
    const { item_type, category } = req.query;
    let sql = "SELECT * FROM items WHERE 1=1";
    if (item_type && item_type !== "all") {
      sql += ` AND item_type = '${String(item_type).replace(/'/g, "''")}'`;
    }
    if (category && category !== "All") {
      sql += ` AND category = '${String(category).replace(/'/g, "''")}'`;
    }
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    sql += ` ORDER BY id DESC LIMIT ${limit};`;

    const items = queryAll(sql);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 6. Search Items
app.get("/api/items/search", (req, res) => {
  try {
    const queryText = (req.query.q || req.query.name || req.query.keyword || req.query.search || "").toString().trim();
    const { category, location, date, status, item_type } = req.query;
    let sql = "SELECT * FROM items WHERE 1=1";

    if (category && category !== "All") {
      sql += ` AND category = '${String(category).replace(/'/g, "''")}'`;
    }
    if (location) {
      const l = String(location).toLowerCase().replace(/'/g, "''");
      sql += ` AND LOWER(location) LIKE '%${l}%'`;
    }
    if (date) {
      sql += ` AND date = '${String(date).replace(/'/g, "''")}'`;
    }
    if (status && status !== "All") {
      sql += ` AND status = '${String(status).replace(/'/g, "''")}'`;
    }
    if (item_type && item_type !== "all") {
      sql += ` AND item_type = '${String(item_type).replace(/'/g, "''")}'`;
    }

    sql += " ORDER BY id DESC;";
    const items = queryAll(sql);

    if (!queryText) {
      return res.json(items);
    }

    const lowerQuery = queryText.toLowerCase();
    const words = lowerQuery.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return res.json(items);
    }

    const scored = items.map((item: any) => {
      const name = (item.item_name || "").toLowerCase();
      const desc = (item.description || "").toLowerCase();
      const cat = (item.category || "").toLowerCase();
      const loc = (item.location || "").toLowerCase();
      const contact = (item.contact_info || "").toLowerCase();

      let score = 0;
      // Exact phrase matches
      if (name === lowerQuery) score += 30;
      else if (name.includes(lowerQuery)) score += 20;
      else if (desc.includes(lowerQuery)) score += 12;
      else if (loc.includes(lowerQuery)) score += 8;

      let matchedWords = 0;
      for (const w of words) {
        let wMatch = false;
        if (name.includes(w)) { score += 6; wMatch = true; }
        if (cat.includes(w)) { score += 5; wMatch = true; }
        if (desc.includes(w)) { score += 4; wMatch = true; }
        if (loc.includes(w)) { score += 3; wMatch = true; }
        if (contact.includes(w)) { score += 2; wMatch = true; }
        if (wMatch) matchedWords++;
      }

      const allWordsMatch = matchedWords === words.length;
      return { item, score, allWordsMatch, matchedWords };
    });

    // First try all words match
    const fullMatches = scored.filter(s => s.allWordsMatch && s.score > 0);
    if (fullMatches.length > 0) {
      return res.json(fullMatches.sort((a, b) => b.score - a.score).map(s => s.item));
    }

    // Fallback to highest partial matches
    const partialMatches = scored.filter(s => s.score > 0);
    return res.json(partialMatches.sort((a, b) => b.score - a.score).map(s => s.item));
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 7. Get Item By ID
app.get("/api/items/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = queryOne(`SELECT * FROM items WHERE id = ${id};`);
    if (!item) {
      return res.status(404).json({ detail: "Item not found." });
    }
    res.json(item);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 8. Get All Matches or Matches for an Item
app.get("/api/matches", (req, res) => {
  try {
    const { status } = req.query;
    let sql = "SELECT * FROM matches WHERE 1=1";
    if (status && status !== "All") {
      sql += ` AND status = '${String(status).replace(/'/g, "''")}'`;
    }
    sql += " ORDER BY match_score DESC, id DESC;";

    const matches = queryAll(sql);

    // Populate item details
    const enriched = matches.map(m => {
      const lostItem = queryOne(`SELECT * FROM items WHERE id = ${m.lost_item_id};`);
      const foundItem = queryOne(`SELECT * FROM items WHERE id = ${m.found_item_id};`);

      let breakdown = null;
      try {
        breakdown = m.score_breakdown ? JSON.parse(String(m.score_breakdown)) : null;
      } catch {}

      return {
        ...m,
        lost_item: lostItem,
        found_item: foundItem,
        breakdown
      };
    });

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

app.get("/api/matches/:item_id", (req, res) => {
  try {
    const itemId = Number(req.params.item_id);
    const sql = `SELECT * FROM matches WHERE lost_item_id = ${itemId} OR found_item_id = ${itemId} ORDER BY match_score DESC;`;
    const matches = queryAll(sql);

    const enriched = matches.map(m => {
      const lostItem = queryOne(`SELECT * FROM items WHERE id = ${m.lost_item_id};`);
      const foundItem = queryOne(`SELECT * FROM items WHERE id = ${m.found_item_id};`);

      let breakdown = null;
      try {
        breakdown = m.score_breakdown ? JSON.parse(String(m.score_breakdown)) : null;
      } catch {}

      return {
        ...m,
        lost_item: lostItem,
        found_item: foundItem,
        breakdown
      };
    });

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 9. Confirm Match
app.post("/api/matches/:match_id/confirm", (req, res) => {
  try {
    const matchId = Number(req.params.match_id);
    const matchRecord = queryOne(`SELECT * FROM matches WHERE id = ${matchId};`);
    if (!matchRecord) {
      return res.status(404).json({ detail: "Match not found." });
    }

    db.run(`UPDATE matches SET status = 'Confirmed' WHERE id = ${matchId};`);
    db.run(`UPDATE items SET status = 'Match Verified' WHERE id IN (${matchRecord.lost_item_id}, ${matchRecord.found_item_id});`);
    saveDatabase();

    const lostItem = queryOne(`SELECT * FROM items WHERE id = ${matchRecord.lost_item_id};`);
    const foundItem = queryOne(`SELECT * FROM items WHERE id = ${matchRecord.found_item_id};`);

    res.json({
      message: "Match successfully confirmed! Status updated to 'Match Verified'.",
      match_id: matchId,
      status: "Confirmed",
      lost_item: lostItem,
      found_item: foundItem
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 9b. Confirm Match by Item ID
app.post("/api/items/:item_id/confirm-match", (req, res) => {
  try {
    const itemId = Number(req.params.item_id);
    const matchRecord = queryOne(`
      SELECT * FROM matches 
      WHERE (lost_item_id = ${itemId} OR found_item_id = ${itemId}) 
      ORDER BY CASE WHEN status = 'Suggested' THEN 0 ELSE 1 END, match_score DESC 
      LIMIT 1;
    `);
    if (!matchRecord) {
      return res.status(404).json({ detail: "No match record found for this item." });
    }

    db.run(`UPDATE matches SET status = 'Confirmed' WHERE id = ${matchRecord.id};`);
    db.run(`UPDATE items SET status = 'Match Verified' WHERE id IN (${matchRecord.lost_item_id}, ${matchRecord.found_item_id});`);
    saveDatabase();

    const lostItem = queryOne(`SELECT * FROM items WHERE id = ${matchRecord.lost_item_id};`);
    const foundItem = queryOne(`SELECT * FROM items WHERE id = ${matchRecord.found_item_id};`);

    res.json({
      message: "Match successfully confirmed! Status updated to 'Match Verified'.",
      match_id: matchRecord.id,
      status: "Confirmed",
      lost_item: lostItem,
      found_item: foundItem
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 10. Reject Match
app.post("/api/matches/:match_id/reject", (req, res) => {
  try {
    const matchId = Number(req.params.match_id);
    const matchRecord = queryOne(`SELECT * FROM matches WHERE id = ${matchId};`);
    if (!matchRecord) {
      return res.status(404).json({ detail: "Match not found." });
    }

    db.run(`UPDATE matches SET status = 'Rejected' WHERE id = ${matchId};`);

    // Check if items have other pending matches before reverting to Lost / Found
    const otherLost = queryOne(`
      SELECT id FROM matches 
      WHERE lost_item_id = ${matchRecord.lost_item_id} AND id != ${matchId} AND status IN ('Suggested', 'Confirmed');
    `);
    if (!otherLost) {
      db.run(`UPDATE items SET status = 'Lost' WHERE id = ${matchRecord.lost_item_id} AND status = 'Possible Match';`);
    }

    const otherFound = queryOne(`
      SELECT id FROM matches 
      WHERE found_item_id = ${matchRecord.found_item_id} AND id != ${matchId} AND status IN ('Suggested', 'Confirmed');
    `);
    if (!otherFound) {
      db.run(`UPDATE items SET status = 'Found' WHERE id = ${matchRecord.found_item_id} AND status = 'Possible Match';`);
    }

    saveDatabase();
    res.json({
      message: "Match marked as Not a Match.",
      match_id: matchId,
      status: "Rejected"
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 11. Mark Item Resolved or Closed
app.post("/api/items/:id/resolve", (req, res) => {
  try {
    const id = Number(req.params.id);
    const targetStatus = req.body.status || "Resolved";
    db.run(`UPDATE items SET status = '${targetStatus.replace(/'/g, "''")}' WHERE id = ${id};`);
    saveDatabase();
    res.json({ message: `Item marked as ${targetStatus}`, item_id: id, status: targetStatus });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 12. My Reports
app.get("/api/my-reports", (req, res) => {
  try {
    const userIdParam = req.query.user_id;
    const emailParam = req.query.email ? String(req.query.email).trim().toLowerCase() : null;

    if (userIdParam === "all") {
      const items = queryAll("SELECT * FROM items ORDER BY id DESC;");
      return res.json(items);
    }

    if (emailParam) {
      const safeEmail = emailParam.replace(/'/g, "''");
      const user = queryOne(`SELECT id FROM users WHERE email = '${safeEmail}';`);
      const userClause = user ? `user_id = ${user.id} OR ` : "";
      const items = queryAll(`SELECT * FROM items WHERE ${userClause} contact_info LIKE '%${safeEmail}%' ORDER BY id DESC;`);
      return res.json(items);
    }

    const userId = Number(userIdParam) || 1;
    const items = queryAll(`SELECT * FROM items WHERE user_id = ${userId} ORDER BY id DESC;`);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// 13. Dashboard Stats
app.get("/api/stats", (req, res) => {
  try {
    const userId = req.query.user_id ? Number(req.query.user_id) : null;

    let lostCount = 0;
    let foundCount = 0;
    let matchCount = 0;
    let resolvedCount = 0;

    if (userId) {
      lostCount = queryVal(`SELECT COUNT(*) FROM items WHERE user_id = ${userId} AND item_type = 'lost';`);
      foundCount = queryVal(`SELECT COUNT(*) FROM items WHERE user_id = ${userId} AND item_type = 'found';`);

      const userItems = queryAll(`SELECT id FROM items WHERE user_id = ${userId};`);
      if (userItems.length > 0) {
        const ids = userItems.map(v => v.id).join(",");
        matchCount = queryVal(`SELECT COUNT(*) FROM matches WHERE (lost_item_id IN (${ids}) OR found_item_id IN (${ids})) AND status = 'Suggested';`);
      }

      resolvedCount = queryVal(`SELECT COUNT(*) FROM items WHERE user_id = ${userId} AND status IN ('Resolved', 'Match Verified');`);
    } else {
      lostCount = queryVal("SELECT COUNT(*) FROM items WHERE item_type = 'lost';");
      foundCount = queryVal("SELECT COUNT(*) FROM items WHERE item_type = 'found';");
      matchCount = queryVal("SELECT COUNT(*) FROM matches WHERE status = 'Suggested';");
      resolvedCount = queryVal("SELECT COUNT(*) FROM items WHERE status IN ('Resolved', 'Match Verified');");
    }

    const totalActive = queryVal("SELECT COUNT(*) FROM items WHERE status IN ('Lost', 'Found', 'Possible Match');");

    res.json({
      my_lost_reports: lostCount,
      my_found_reports: foundCount,
      possible_matches: matchCount,
      resolved_cases: resolvedCount,
      total_active_items: totalActive
    });
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Live Matching Calculator API endpoint (for student interview demonstration)
app.post("/api/match-calculator", (req, res) => {
  try {
    const { lost_item, found_item } = req.body;
    if (!lost_item || !found_item) {
      return res.status(400).json({ detail: "Both lost_item and found_item objects are required." });
    }
    const result = calculateMatchScore(lost_item, found_item);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Any unhandled API request returns JSON detail rather than HTML 404
app.all(["/api/*", "/api"], (req, res) => {
  res.status(404).json({ detail: `API endpoint not found: ${req.method} ${req.path}` });
});

// Serve frontend static files
const frontendDir = fs.existsSync(path.join(process.cwd(), "frontend"))
  ? path.join(process.cwd(), "frontend")
  : path.join(appDir, "frontend");
app.use(express.static(frontendDir));

// Fallback to frontend/index.html for any direct web page requests
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ detail: `API endpoint not found: ${req.method} ${req.path}` });
  }
  const possibleFile = path.join(frontendDir, req.path);
  if (fs.existsSync(possibleFile) && fs.statSync(possibleFile).isFile()) {
    return res.sendFile(possibleFile);
  }
  const possibleHtml = path.join(frontendDir, `${req.path}.html`);
  if (fs.existsSync(possibleHtml) && fs.statSync(possibleHtml).isFile()) {
    return res.sendFile(possibleHtml);
  }
  res.sendFile(path.join(frontendDir, "index.html"));
});

export { app, initDatabase };

async function start() {
  await initDatabase();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Smart Student Lost & Found Server running on http://0.0.0.0:${PORT}`);
  });
}

// Automatically start standalone dev/prod server when not in a serverless environment (like Vercel)
if (!process.env.VERCEL) {
  start();
}
