"""
Pydantic Schemas for Request & Response Data Validation.
Provides clear input checking, type enforcement, and serialization.
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# --- User Schemas ---
class UserRegister(BaseModel):
    name: str = Field(..., min_length=2, description="Student / Staff Full Name")
    email: EmailStr = Field(..., description="Valid college email address")
    password: str = Field(..., min_length=6, description="Password (min 6 characters)")
    phone: Optional[str] = Field(None, description="Contact phone number")

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Item Schemas ---
class ItemCreate(BaseModel):
    item_type: str = Field(..., regex="^(lost|found)$", description="'lost' or 'found'")
    category: str = Field(..., min_length=2, description="ID Card, Books, Wallet, Bag, Keys, Electronics, Certificates, Other")
    item_name: str = Field(..., min_length=2, description="Descriptive item name")
    description: str = Field(..., min_length=5, description="Clear description of the item")
    location: str = Field(..., min_length=2, description="Location where lost or found on campus")
    date: str = Field(..., description="Date formatted as YYYY-MM-DD")
    image: Optional[str] = None
    contact_info: Optional[str] = None

class ItemOut(BaseModel):
    id: int
    user_id: int
    item_type: str
    category: str
    item_name: str
    description: str
    location: str
    date: str
    image: Optional[str] = None
    contact_info: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Match Schemas ---
class MatchBreakdown(BaseModel):
    category_points: int = 0
    name_points: int = 0
    location_points: int = 0
    date_points: int = 0
    description_points: int = 0
    total_score: int = 0
    explanation: List[str] = []

class MatchOut(BaseModel):
    id: int
    lost_item_id: int
    found_item_id: int
    match_score: int
    status: str
    created_at: Optional[datetime] = None
    lost_item: Optional[ItemOut] = None
    found_item: Optional[ItemOut] = None
    breakdown: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

# --- Dashboard & Search Schemas ---
class DashboardStats(BaseModel):
    my_lost_reports: int
    my_found_reports: int
    possible_matches: int
    resolved_cases: int
    total_active_items: int
