"""
GrantSeeker AI - Database setup (SQLAlchemy 2.0)
"""
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Engine & session factory
# ---------------------------------------------------------------------------

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},  # Required for SQLite
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db():
    """Yield a database session, closing it when done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------

def init_db() -> None:
    """Create all tables and seed the database if empty."""
    # Import all models so that Base.metadata has them registered
    from app.models import grant, user, notification, application  # noqa: F401

    logger.info("Creating database tables…")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ready.")

    # Seed with demo data if the DB is empty
    db = SessionLocal()
    try:
        from app.db.seed import seed_database

        count = seed_database(db)
        if count > 0:
            logger.info("Seeded database with %d demo grants.", count)
        else:
            logger.info("Database already seeded — skipping.")
    except Exception as exc:  # pragma: no cover
        logger.error("Seed failed: %s", exc)
    finally:
        db.close()
