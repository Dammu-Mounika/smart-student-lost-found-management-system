"""
FastAPI Main Application Entry Point.
Implements the clean RESTful API for the Smart Student Lost & Found Management System:
- Authentication (Register / Login)
- Item Reports (Lost & Found)
- Automatic Smart Matching Execution
- Status Tracking (Lost, Found, Possible Match, Match Verified, Resolved, Closed)
- Match Verification (Confirm / Reject)
- Search & Filtering
- User Dashboard Stats
"""

from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
import hashlib
import json
import os

from database import engine, Base, get_db
import models
import schemas
from matching import calculate_match_score

# Initialize database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Smart Student Lost & Found Management System API",
    description="REST API for campus lost and found tracking with explainable smart matching.",
    version="1.0.0"
)

# Enable CORS for frontend cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def hash_password(password: str) -> str:
    """Simple, interview-explainable secure hash using SHA-256 with salt."""
    salt = "campus_lost_found_salt"
    return hashlib.sha256((password + salt).encode("utf-8")).hexdigest()

# ==========================================
# 1. AUTHENTICATION ENDPOINTS
# ==========================================

@app.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register_user(user_in: schemas.UserRegister, db: Session = Depends(get_db)):
    """Register a new student, faculty, or staff member."""
    existing_user = db.query(models.User).filter(models.User.email == user_in.email.lower()).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="A user with this college email already exists.")

    new_user = models.User(
        name=user_in.name.strip(),
        email=user_in.email.lower().strip(),
        password=hash_password(user_in.password),
        phone=user_in.phone
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.post("/login")
def login_user(creds: schemas.UserLogin, db: Session = Depends(get_db)):
    """Authenticate user credentials."""
    user = db.query(models.User).filter(
        models.User.email == creds.email.lower().strip(),
        models.User.password == hash_password(creds.password)
    ).first()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    return {
        "message": "Login successful",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone
        }
    }

# ==========================================
# 2. SMART MATCHING HELPER
# ==========================================

def trigger_matching_engine(new_item: models.Item, db: Session) -> int:
    """
    Called whenever a new Lost or Found item is reported.
    Compares the newly submitted item against candidate opposite-type items.
    If match score >= 50%, creates a record in 'matches' and updates status to 'Possible Match'.
    """
    matches_created = 0
    opposite_type = "found" if new_item.item_type == "lost" else "lost"

    # Fetch active opposite-type candidates that are not closed or resolved
    candidates = db.query(models.Item).filter(
        models.Item.item_type == opposite_type,
        models.Item.status.in_(["Lost", "Found", "Possible Match"])
    ).all()

    for candidate in candidates:
        lost_obj = new_item if new_item.item_type == "lost" else candidate
        found_obj = candidate if new_item.item_type == "lost" else new_item

        # Check if already matched
        existing_match = db.query(models.Match).filter(
            models.Match.lost_item_id == lost_obj.id,
            models.Match.found_item_id == found_obj.id
        ).first()

        if existing_match:
            continue

        score, breakdown = calculate_match_score(lost_obj, found_obj)

        # Match threshold: 50% or higher
        if score >= 50:
            match_record = models.Match(
                lost_item_id=lost_obj.id,
                found_item_id=found_obj.id,
                match_score=score,
                score_breakdown=json.dumps(breakdown),
                status="Suggested"
            )
            db.add(match_record)

            # Update statuses to 'Possible Match' if currently generic 'Lost' or 'Found'
            if lost_obj.status == "Lost":
                lost_obj.status = "Possible Match"
            if found_obj.status == "Found":
                found_obj.status = "Possible Match"

            matches_created += 1

    if matches_created > 0:
        db.commit()

    return matches_created

# ==========================================
# 3. ITEM REPORTING ENDPOINTS
# ==========================================

@app.post("/items/lost", response_model=schemas.ItemOut, status_code=status.HTTP_201_CREATED)
def report_lost_item(
    item_in: schemas.ItemCreate,
    user_id: int = Query(..., description="ID of the student reporting the lost item"),
    db: Session = Depends(get_db)
):
    """
    Report a lost item on campus.
    Validates input, persists to SQLite, triggers automatic smart matching against found items.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found. Please log in.")

    item = models.Item(
        user_id=user_id,
        item_type="lost",
        category=item_in.category,
        item_name=item_in.item_name.strip(),
        description=item_in.description.strip(),
        location=item_in.location.strip(),
        date=item_in.date,
        image=item_in.image,
        contact_info=item_in.contact_info or user.email,
        status="Lost"
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Run matching
    trigger_matching_engine(item, db)
    db.refresh(item)
    return item


@app.post("/items/found", response_model=schemas.ItemOut, status_code=status.HTTP_201_CREATED)
def report_found_item(
    item_in: schemas.ItemCreate,
    user_id: int = Query(..., description="ID of the student/finder reporting the item"),
    db: Session = Depends(get_db)
):
    """
    Report a found item on campus.
    Validates input, persists to SQLite, triggers automatic smart matching against lost items.
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found. Please log in.")

    item = models.Item(
        user_id=user_id,
        item_type="found",
        category=item_in.category,
        item_name=item_in.item_name.strip(),
        description=item_in.description.strip(),
        location=item_in.location.strip(),
        date=item_in.date,
        image=item_in.image,
        contact_info=item_in.contact_info or user.email,
        status="Found"
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Run matching
    trigger_matching_engine(item, db)
    db.refresh(item)
    return item

# ==========================================
# 4. SEARCH & ITEM QUERIES
# ==========================================

@app.get("/items", response_model=List[schemas.ItemOut])
def get_all_items(
    item_type: Optional[str] = Query(None, description="'lost' or 'found'"),
    category: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """List all recent items with optional basic filters."""
    query = db.query(models.Item)
    if item_type:
        query = query.filter(models.Item.item_type == item_type)
    if category:
        query = query.filter(models.Item.category == category)
    return query.order_by(models.Item.id.desc()).limit(limit).all()


@app.get("/items/search", response_model=List[schemas.ItemOut])
def search_items(
    name: Optional[str] = Query(None, description="Keywords in item name"),
    category: Optional[str] = Query(None, description="Category filter"),
    location: Optional[str] = Query(None, description="Location keywords"),
    date: Optional[str] = Query(None, description="Occurrence date"),
    status_filter: Optional[str] = Query(None, alias="status", description="Lost, Found, Possible Match, etc."),
    item_type: Optional[str] = Query(None, description="'lost' or 'found'"),
    db: Session = Depends(get_db)
):
    """
    Search lost and found items by name, category, location, date, and status.
    """
    query = db.query(models.Item)

    if name:
        query = query.filter(models.Item.item_name.ilike(f"%{name.strip()}%"))
    if category and category != "All":
        query = query.filter(models.Item.category == category)
    if location:
        query = query.filter(models.Item.location.ilike(f"%{location.strip()}%"))
    if date:
        query = query.filter(models.Item.date == date)
    if status_filter and status_filter != "All":
        query = query.filter(models.Item.status == status_filter)
    if item_type and item_type != "all":
        query = query.filter(models.Item.item_type == item_type)

    return query.order_by(models.Item.id.desc()).all()


@app.get("/items/{id}", response_model=schemas.ItemOut)
def get_item_by_id(id: int, db: Session = Depends(get_db)):
    """Retrieve details for a single lost or found report."""
    item = db.query(models.Item).filter(models.Item.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")
    return item

# ==========================================
# 5. MATCHING & VERIFICATION ENDPOINTS
# ==========================================

@app.get("/matches", response_model=List[schemas.MatchOut])
def get_all_matches(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db)
):
    """Get all discovered pairings with populated lost and found item details."""
    query = db.query(models.Match)
    if status_filter:
        query = query.filter(models.Match.status == status_filter)
    matches = query.order_by(models.Match.match_score.desc()).all()

    result = []
    for m in matches:
        lost_item = db.query(models.Item).filter(models.Item.id == m.lost_item_id).first()
        found_item = db.query(models.Item).filter(models.Item.id == m.found_item_id).first()
        breakdown_dict = {}
        if m.score_breakdown:
            try:
                breakdown_dict = json.loads(m.score_breakdown)
            except Exception:
                pass

        result.append({
            "id": m.id,
            "lost_item_id": m.lost_item_id,
            "found_item_id": m.found_item_id,
            "match_score": m.match_score,
            "status": m.status,
            "created_at": m.created_at,
            "lost_item": lost_item,
            "found_item": found_item,
            "breakdown": breakdown_dict
        })
    return result


@app.get("/matches/{item_id}", response_model=List[schemas.MatchOut])
def get_matches_for_item(item_id: int, db: Session = Depends(get_db)):
    """Get matches relevant to a specific item."""
    matches = db.query(models.Match).filter(
        (models.Match.lost_item_id == item_id) | (models.Match.found_item_id == item_id)
    ).order_by(models.Match.match_score.desc()).all()

    result = []
    for m in matches:
        lost_item = db.query(models.Item).filter(models.Item.id == m.lost_item_id).first()
        found_item = db.query(models.Item).filter(models.Item.id == m.found_item_id).first()
        breakdown_dict = {}
        if m.score_breakdown:
            try:
                breakdown_dict = json.loads(m.score_breakdown)
            except Exception:
                pass

        result.append({
            "id": m.id,
            "lost_item_id": m.lost_item_id,
            "found_item_id": m.found_item_id,
            "match_score": m.match_score,
            "status": m.status,
            "created_at": m.created_at,
            "lost_item": lost_item,
            "found_item": found_item,
            "breakdown": breakdown_dict
        })
    return result


@app.post("/matches/{match_id}/confirm")
def confirm_match(match_id: int, db: Session = Depends(get_db)):
    """
    Verify/Confirm a suggested match.
    Updates match status to 'Confirmed' and items' statuses to 'Match Verified'.
    """
    match_record = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match_record:
        raise HTTPException(status_code=404, detail="Match not found.")

    match_record.status = "Confirmed"

    lost_item = db.query(models.Item).filter(models.Item.id == match_record.lost_item_id).first()
    found_item = db.query(models.Item).filter(models.Item.id == match_record.found_item_id).first()

    if lost_item:
        lost_item.status = "Match Verified"
    if found_item:
        found_item.status = "Match Verified"

    db.commit()
    return {
        "message": "Match successfully verified! Contact the owner/finder to retrieve the item.",
        "match_id": match_id,
        "status": "Confirmed"
    }


@app.post("/matches/{match_id}/reject")
def reject_match(match_id: int, db: Session = Depends(get_db)):
    """
    Reject a suggested match ('Not a Match').
    Sets match status to 'Rejected'. Reverts item statuses back to 'Lost' / 'Found' if no other active matches.
    """
    match_record = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match_record:
        raise HTTPException(status_code=404, detail="Match not found.")

    match_record.status = "Rejected"

    # Check if items have other pending matches
    lost_item = db.query(models.Item).filter(models.Item.id == match_record.lost_item_id).first()
    found_item = db.query(models.Item).filter(models.Item.id == match_record.found_item_id).first()

    if lost_item and lost_item.status == "Possible Match":
        other_active = db.query(models.Match).filter(
            models.Match.lost_item_id == lost_item.id,
            models.Match.id != match_id,
            models.Match.status.in_(["Suggested", "Confirmed"])
        ).first()
        if not other_active:
            lost_item.status = "Lost"

    if found_item and found_item.status == "Possible Match":
        other_active = db.query(models.Match).filter(
            models.Match.found_item_id == found_item.id,
            models.Match.id != match_id,
            models.Match.status.in_(["Suggested", "Confirmed"])
        ).first()
        if not other_active:
            found_item.status = "Found"

    db.commit()
    return {
        "message": "Match rejected. Items remain open for other possible matches.",
        "match_id": match_id,
        "status": "Rejected"
    }


@app.post("/items/{item_id}/resolve")
def resolve_item(item_id: int, db: Session = Depends(get_db)):
    """Mark an item as Resolved (owner received belonging)."""
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found.")
    item.status = "Resolved"
    db.commit()
    return {"message": "Item marked as Resolved", "item_id": item_id, "status": "Resolved"}

# ==========================================
# 6. USER REPORTS & DASHBOARD
# ==========================================

@app.get("/my-reports")
def get_my_reports(user_id: int = Query(..., description="Logged-in User ID"), db: Session = Depends(get_db)):
    """Retrieve all reports submitted by a specific user with their current status."""
    items = db.query(models.Item).filter(models.Item.user_id == user_id).order_by(models.Item.id.desc()).all()
    return items


@app.get("/stats")
def get_dashboard_stats(user_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """
    Returns counts for:
    - My Lost Reports
    - My Found Reports
    - Possible Matches
    - Resolved Cases
    """
    if user_id:
        my_lost = db.query(models.Item).filter(models.Item.user_id == user_id, models.Item.item_type == "lost").count()
        my_found = db.query(models.Item).filter(models.Item.user_id == user_id, models.Item.item_type == "found").count()
        # Find item IDs owned by this user
        user_item_ids = [item.id for item in db.query(models.Item.id).filter(models.Item.user_id == user_id).all()]
        possible_matches = db.query(models.Match).filter(
            (models.Match.lost_item_id.in_(user_item_ids)) | (models.Match.found_item_id.in_(user_item_ids)),
            models.Match.status == "Suggested"
        ).count() if user_item_ids else 0
        resolved_cases = db.query(models.Item).filter(models.Item.user_id == user_id, models.Item.status.in_(["Resolved", "Match Verified"])).count()
    else:
        my_lost = db.query(models.Item).filter(models.Item.item_type == "lost").count()
        my_found = db.query(models.Item).filter(models.Item.item_type == "found").count()
        possible_matches = db.query(models.Match).filter(models.Match.status == "Suggested").count()
        resolved_cases = db.query(models.Item).filter(models.Item.status.in_(["Resolved", "Match Verified"])).count()

    total_active = db.query(models.Item).filter(models.Item.status.in_(["Lost", "Found", "Possible Match"])).count()

    return {
        "my_lost_reports": my_lost,
        "my_found_reports": my_found,
        "possible_matches": possible_matches,
        "resolved_cases": resolved_cases,
        "total_active_items": total_active
    }
