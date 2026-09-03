# Smart Student Lost & Found Management System

A simple, modern, beginner-friendly full-stack web application designed for college campuses. It provides a centralized platform for students, faculty, and campus staff to report misplaced or found belongings, search active cases, and automatically discover explainable pairings through an intuitive, deterministic smart matching engine.

---

## 1. Problem Statement

On university and college campuses, students and staff frequently misplace critical belongings—such as student ID cards, keys, textbooks, scientific calculators, backpacks, wallets, and electronic gadgets.

Traditionally, found-item information is fragmented across informal WhatsApp groups, physical notice boards, individual security desks, or lost-property boxes. As a result:
- Students spend hours searching different departments.
- Found items sit unclaimed at security kiosks.
- There is no automated, transparent way to verify ownership or notify owners when a matching item is handed in.

---

## 2. Objective

The objective of this project is to provide a single, centralized web application where campus members can:
1. **Report Lost Items** with specific details (category, date, campus location, description).
2. **Report Found Items** to log recovered belongings into a searchable database.
3. **Search & Filter Items** across categories, dates, and locations.
4. **Automatically Pair Items** using an explainable, 100-point matching algorithm without black-box AI.
5. **Verify Matches** with explicit confirmation or rejection actions.
6. **Track Status Lifecycle** from initial report to verified recovery and case resolution.

---

## 3. Technology Stack

Designed specifically for clarity, performance, and explainability during technical interviews:

### Frontend
- **HTML5**: Semantic document structure across clean modular pages (`index.html`, `dashboard.html`, `report-lost.html`, `report-found.html`, `search.html`, `matches.html`, `interview-guide.html`).
- **CSS3**: Responsive collegiate theme with accessible contrast, card layouts, status badges, and zero heavy UI frameworks.
- **JavaScript (ES6+)**: Vanilla client-side state handling, dynamic DOM rendering, and asynchronous `fetch` calls to backend REST endpoints.

### Backend
- **Python 3**: Clean, readable backend logic.
- **FastAPI**: Modern, high-performance web framework providing automatic data validation via Pydantic, OpenAPI documentation, and asynchronous request handling.
- *(Also includes an Express + SQLite server to power immediate zero-config live web preview in browser environments).*

### Database
- **SQLite (`database/lost_found.db`)**: Self-contained, zero-configuration relational database with foreign key relations and ACID compliance.

---

## 4. System Architecture

```text
┌────────────────────────────────────────────────────────┐
│                   Frontend (Browser)                   │
│   HTML5 / Modern CSS / Vanilla JavaScript (Fetch API)  │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP JSON Requests
                           ▼
┌────────────────────────────────────────────────────────┐
│               FastAPI Backend (Python)                 │
│  - RESTful Endpoints (/items, /matches, /stats)        │
│  - Pydantic Validation Schemas                         │
│  - Salted SHA-256 Authentication                       │
└──────────────┬─────────────────────────┬───────────────┘
               │                         │
               ▼                         ▼
┌─────────────────────────────┐ ┌────────────────────────┐
│  Smart Matching Algorithm   │ │      SQLite Database   │
│  - Category Match  (30 pts) │ │  - users table         │
│  - Item Name Match (25 pts) │ │  - items table         │
│  - Location Prox.  (20 pts) │ │  - matches table       │
│  - Date Similarity (15 pts) │ └────────────────────────┘
│  - Description KW  (10 pts) │
│  - Threshold: >= 50%        │
└─────────────────────────────┘
```

---

## 5. Database Design (SQLite)

The relational schema is structured in Third Normal Form (3NF):

### `users` Table
Stores registered campus students, faculty, and administrative staff:
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `name` (TEXT NOT NULL): Full student name
- `email` (TEXT UNIQUE NOT NULL): Campus email address
- `password` (TEXT NOT NULL): Salted SHA-256 password hash
- `phone` (TEXT): Contact phone number
- `created_at` (TIMESTAMP): Registration timestamp

### `items` Table
Stores all lost and found item reports:
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `user_id` (INTEGER NOT NULL, FK -> `users.id`): Report owner
- `item_type` (TEXT NOT NULL): `'lost'` or `'found'`
- `category` (TEXT NOT NULL): ID Card, Books, Wallet, Bag, Keys, Electronics, Certificates, Other
- `item_name` (TEXT NOT NULL): Short descriptive title
- `description` (TEXT NOT NULL): Color, markings, and distinct details
- `location` (TEXT NOT NULL): Campus zone or room
- `date` (TEXT NOT NULL): Occurrence date (YYYY-MM-DD)
- `image` (TEXT): Optional image URL
- `contact_info` (TEXT): Email or phone number
- `status` (TEXT NOT NULL): Current status
- `created_at` (TIMESTAMP): Submission timestamp

### `matches` Table
Stores pairings discovered by the matching engine:
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `lost_item_id` (INTEGER NOT NULL, FK -> `items.id`)
- `found_item_id` (INTEGER NOT NULL, FK -> `items.id`)
- `match_score` (INTEGER NOT NULL): 0 to 100 percentage
- `score_breakdown` (TEXT): JSON breakdown of points awarded per factor
- `status` (TEXT NOT NULL): `'Suggested'`, `'Confirmed'`, or `'Rejected'`
- `created_at` (TIMESTAMP): Pairing timestamp

---

## 6. Smart Matching Algorithm

Instead of unpredictable machine learning models, the system employs an **explainable 100-point weighted heuristic**:

| Factor | Max Weight | Logic & Evaluation |
| :--- | :--- | :--- |
| **Category Match** | **30 Points** | `lost.category.lower() == found.category.lower()`. ID Card will never match Keys. |
| **Item Name Match** | **25 Points** | Exact string match: 25 pts; Substring match: 20 pts; Token Jaccard overlap: proportional. |
| **Location Proximity** | **20 Points** | Exact room: 20 pts; Contained match: 15 pts; Same campus zone keyword (Canteen, Library, Lab): 10 pts. |
| **Date Similarity** | **15 Points** | Same day: 15 pts; Within 2 days: 12 pts; Within 5 days: 8 pts; Within 10 days: 5 pts. |
| **Description Match** | **10 Points** | Token overlap of significant adjectives and brands (color, model, tags). &ge; 3 keywords: 10 pts; &ge; 1 keyword: 5 pts. |
| **Maximum Score** | **100 Points** | |

### Threshold
Any pairing achieving a score **&ge; 50%** is automatically flagged as a **“Possible Match”** and submitted to both student parties for review.

---

## 7. Status Lifecycle

Each report traverses a transparent lifecycle:

```text
[ Lost ]  ──( Score >= 50% )──> [ Possible Match ] ──( Confirm )──> [ Match Verified ] ──> [ Resolved ]
   │                                     │
   └──( Closed / Expired )──> [ Closed ] └──( Not a Match )──> Reverts to [ Lost / Found ]
```

- **Lost**: Student submitted report; awaiting matching items.
- **Found**: Finder reported item; awaiting matching owner.
- **Possible Match**: Smart algorithm detected a candidate pairing (&ge; 50%).
- **Match Verified**: Student or finder verified the reports belong to the same item; contact info is unlocked.
- **Resolved**: Owner confirmed receipt of their belonging.
- **Closed**: Case manually archived or withdrawn.

---

## 8. REST API Endpoints

All endpoints use standard HTTP verbs and return JSON payloads:

### Authentication
- `POST /register`: Create student account with validated email and salted hash.
- `POST /login`: Verify credentials and retrieve session user profile.

### Items
- `POST /items/lost`: Report a lost belonging and trigger auto-match check.
- `POST /items/found`: Report a found belonging and trigger auto-match check.
- `GET /items`: Fetch recent campus lost/found reports.
- `GET /items/{id}`: Retrieve full details for a specific item report.
- `GET /items/search`: Query items by name keyword, category, location, date, status, or type.
- `POST /items/{id}/resolve`: Mark an item as `Resolved` or `Closed`.

### Smart Matching
- `GET /matches`: Retrieve all discovered pairings.
- `GET /matches/{item_id}`: Retrieve pairings for a specific item.
- `POST /matches/{match_id}/confirm`: Confirm pairing &rarr; status becomes `Match Verified`.
- `POST /matches/{match_id}/reject`: Mark pairing as `Not a Match` (reverts items to `Lost`/`Found`).

### Dashboard & Metrics
- `GET /my-reports?user_id={id}`: List all submissions for a logged-in student.
- `GET /stats?user_id={id}`: Returns summary counts for Lost, Found, Matches, and Resolved cases.

---

## 9. Project Directory Structure

```text
student-lost-found/
│
├── frontend/
│   ├── index.html            # Landing page with stats & recent reports
│   ├── login.html            # Student & staff login
│   ├── register.html         # Campus registration
│   ├── dashboard.html        # User dashboard & status tracking
│   ├── report-lost.html      # Lost item submission form
│   ├── report-found.html     # Found item submission form
│   ├── search.html           # Live filter & item search
│   ├── matches.html          # Possible matches review & verification
│   ├── interview-guide.html  # Architecture, simulator & viva prep
│   ├── css/
│   │   └── style.css         # Clean campus stylesheet
│   └── js/
│       └── app.js            # Shared state, auth, and API client
│
├── backend/
│   ├── main.py               # FastAPI application & REST routing
│   ├── database.py           # SQLite connection & sessionmaker
│   ├── models.py             # SQLAlchemy ORM models (User, Item, Match)
│   ├── schemas.py            # Pydantic data validation schemas
│   ├── matching.py           # 100-point explainable matching algorithm
│   └── requirements.txt      # Python dependencies (FastAPI, uvicorn, etc.)
│
├── database/
│   └── lost_found.db         # Persistent SQLite database file
│
└── README.md                 # Full documentation
```

---

## 10. How to Run the Application Locally

### Option A: Running with Python FastAPI
```bash
# 1. Navigate to the backend folder
cd backend

# 2. Create and activate a Python virtual environment
python3 -m venv venv
source venv/bin/activate    # On Windows: venv\Scripts\activate

# 3. Install required packages
pip install -r requirements.txt

# 4. Start the FastAPI server
uvicorn main:app --reload --port 8000
```
Open `http://localhost:8000` in your browser to view the application and interactive Swagger docs at `http://localhost:8000/docs`.

### Option B: Running with the Built-In Container Server
```bash
# Start the server (runs on port 3000)
npm run dev
```
Open `http://localhost:3000` in your web browser.

---

## 11. Interview Questions & Model Answers

### Q: Why not use Machine Learning or an LLM for matching?
> “In a lost-and-found system, deterministic explainability is essential. If a student is told an item is a 90% match, they want to know *why*. A transparent weighted heuristic (Category 30, Name 25, Location 20, Date 15, Description 10) provides clear accountability, zero inference cost, and millisecond execution time without API failure points.”

### Q: How do you prevent duplicate submissions or repeated alerts?
> “Before inserting a new pairing into the `matches` table, the engine checks for existing matches between the composite key `(lost_item_id, found_item_id)`. Items already marked as `Resolved` or `Closed` are excluded from candidate pools.”

### Q: How does client-side validation cooperate with backend validation?
> “The frontend validates field presence, email formatting, and date ranges immediately to provide instant visual feedback to the student. The backend uses Pydantic schemas to strictly enforce type constraints, minimum string lengths, and sanitized values, ensuring data integrity even if the client is bypassed.”

---

## 12. Future Enhancements
- **Automated Campus Email Alerts**: Dispatch email updates via SMTP whenever a possible match is detected.
- **College SSO Integration**: Authenticate students using campus Active Directory or Google Workspace OAuth.
- **Image Embeddings (Optional)**: Complement text heuristics with optional visual similarity for photos.
- **Admin Verification Portal**: Provide a dedicated role for campus security desks to log physical handovers.
