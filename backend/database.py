"""
Database Connection Setup using SQLite and SQLAlchemy.
Beginner-friendly and easy to explain in an interview:
- SQLite is file-based (lost_found.db), requiring no separate server.
- SQLAlchemy acts as an ORM (Object Relational Mapper) mapping Python classes to SQL tables.
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Define SQLite database file path (located in /database/lost_found.db)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_DIR = os.path.join(BASE_DIR, "database")
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_URL = f"sqlite:///{os.path.join(DATABASE_DIR, 'lost_found.db')}"

# SQLite requires 'check_same_thread: False' when used across FastAPI async worker threads
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# SessionLocal is the factory for creating database sessions per request
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative base class for models
Base = declarative_base()

def get_db():
    """
    FastAPI dependency injection helper.
    Yields an active database session for a single request, then closes it automatically.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
