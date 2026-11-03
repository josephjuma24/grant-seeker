import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.database import init_db
from app.api import auth, users, grants, applications, notifications
from app.tasks.scheduler import start_scheduler, stop_scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle events for startup and shutdown."""
    logger.info("Initializing GrantSeeker AI services...")
    
    # 1. Initialize SQLite Database & Tables, and seed demo records
    init_db()
    
    # 2. Trigger an asynchronous scrape job in a background thread
    # to populate vector database indices immediately on startup.
    import threading
    from app.tasks.scheduler import scrape_grants_job
    logger.info("Triggering initial scraper and vector database indexing on startup...")
    threading.Thread(target=scrape_grants_job, daemon=True).start()
    
    # 3. Start APScheduler background tasks
    start_scheduler()
    
    yield
    
    # Shutdown actions
    stop_scheduler()
    logger.info("GrantSeeker AI services shut down.")


app = FastAPI(
    title=settings.APP_NAME,
    description="AI-powered grant search, matching, and recommendation platform.",
    version="1.0.0",
    lifespan=lifespan
)

# Set up CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(grants.router, prefix="/api")
app.include_router(applications.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")

@app.get("/health")
def health_check():
    """Simple status check to verify server health."""
    return {"status": "ok", "app": settings.APP_NAME}
