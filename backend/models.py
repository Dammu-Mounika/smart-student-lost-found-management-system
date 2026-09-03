"""
Database Models (SQLAlchemy ORM).
Represents the three core entities:
1. User: Campus students, faculty, or staff.
2. Item: Reported lost or found belongings.
3. Match: System-computed pairing between a lost item and a found item.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.database import Base

class User(Base):
    """
    users table:
    Stores registered campus users for authentication and report ownership.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)  # Hashed password
    phone = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    items = relationship("Item", back_populates="owner")


class Item(Base):
    """
    items table:
    Stores both 'lost' and 'found' item reports on campus.
    Status choices:
    - 'Lost' (for lost items awaiting matches)
    - 'Found' (for found items awaiting matches)
    - 'Possible Match' (when score >= 50%)
    - 'Match Verified' (when confirmed by user/finder)
    - 'Resolved' (item returned to owner)
    - 'Closed' (report resolved or withdrawn)
    """
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_type = Column(String(20), nullable=False)   # 'lost' or 'found'
    category = Column(String(50), nullable=False)    # e.g., 'ID Card', 'Keys', 'Wallet', etc.
    item_name = Column(String(150), nullable=False)  # e.g., 'Blue College ID Card'
    description = Column(Text, nullable=False)       # Detailed description
    location = Column(String(120), nullable=False)   # e.g., 'Canteen', 'Library 2nd Floor'
    date = Column(String(30), nullable=False)        # Date lost or found (YYYY-MM-DD)
    image = Column(Text, nullable=True)              # Optional image URL or base64 preview
    contact_info = Column(String(150), nullable=True)# Contact email / phone
    status = Column(String(50), default="Lost")      # Lost, Found, Possible Match, Match Verified, Resolved, Closed
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    owner = relationship("User", back_populates="items")


class Match(Base):
    """
    matches table:
    Records pairings discovered by the matching algorithm.
    Includes an explainable match score (0-100%) and status ('Suggested', 'Confirmed', 'Rejected').
    """
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    lost_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    found_item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    match_score = Column(Integer, nullable=False)    # 0 to 100
    score_breakdown = Column(Text, nullable=True)    # JSON string of points per factor
    status = Column(String(30), default="Suggested") # 'Suggested', 'Confirmed', 'Rejected'
    created_at = Column(DateTime, default=datetime.utcnow)
