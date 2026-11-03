import logging
import asyncio
from datetime import datetime, timedelta, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.database import SessionLocal
from app.models.application import Application
from app.models.grant import Grant
from app.models.notification import Notification
from app.models.user import User
from app.services.scraper import EUGrantScraper

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()

def check_deadlines_job():
    """Daily job to check upcoming deadlines for tracked grants and create notifications."""
    logger.info("Starting scheduled deadline check...")
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        
        # 1. Fetch applications tracking open grants
        stmt = select(Application).where(Application.status.in_(["saved", "applied", "interview"]))
        active_applications = db.execute(stmt).scalars().all()
        
        notifications_created = 0
        for app in active_applications:
            grant = app.grant
            if not grant or not grant.deadline:
                continue
                
            # Parse grant deadline (ensure it is timezone-aware)
            deadline = grant.deadline.replace(tzinfo=timezone.utc) if grant.deadline.tzinfo is None else grant.deadline
            time_left = deadline - now
            
            # Check 14-day deadline
            if timedelta(days=13) <= time_left < timedelta(days=14):
                # Check if notification already exists
                notif_stmt = select(Notification).where(
                    Notification.user_id == app.user_id,
                    Notification.grant_id == grant.id,
                    Notification.notif_type == "deadline_14d"
                )
                existing = db.execute(notif_stmt).scalar_one_or_none()
                if not existing:
                    notif = Notification(
                        user_id=app.user_id,
                        grant_id=grant.id,
                        title="Upcoming Deadline (14 Days)",
                        message=f"The grant '{grant.title}' you are tracking is closing in 14 days on {grant.deadline.strftime('%Y-%m-%d')}.",
                        notif_type="deadline_14d"
                    )
                    db.add(notif)
                    notifications_created += 1

            # Check 3-day deadline
            elif timedelta(days=2) <= time_left < timedelta(days=3):
                # Check if notification already exists
                notif_stmt = select(Notification).where(
                    Notification.user_id == app.user_id,
                    Notification.grant_id == grant.id,
                    Notification.notif_type == "deadline_3d"
                )
                existing = db.execute(notif_stmt).scalar_one_or_none()
                if not existing:
                    notif = Notification(
                        user_id=app.user_id,
                        grant_id=grant.id,
                        title="Urgent Deadline (3 Days)",
                        message=f"URGENT: The grant '{grant.title}' you are tracking is closing in 3 days on {grant.deadline.strftime('%Y-%m-%d')}.",
                        notif_type="deadline_3d"
                    )
                    db.add(notif)
                    notifications_created += 1

            # Check if deadline passed
            elif time_left < timedelta(days=0) and grant.status == "open":
                # Close the grant
                grant.status = "closed"
                # Notify user
                notif_stmt = select(Notification).where(
                    Notification.user_id == app.user_id,
                    Notification.grant_id == grant.id,
                    Notification.notif_type == "grant_closed"
                )
                existing = db.execute(notif_stmt).scalar_one_or_none()
                if not existing:
                    notif = Notification(
                        user_id=app.user_id,
                        grant_id=grant.id,
                        title="Grant Application Closed",
                        message=f"The grant '{grant.title}' has reached its deadline and is now closed.",
                        notif_type="grant_closed"
                    )
                    db.add(notif)
                    notifications_created += 1
        
        db.commit()
        if notifications_created > 0:
            logger.info("Created %d deadline alerts.", notifications_created)
        else:
            logger.info("No new deadline alerts generated.")
    except Exception as exc:
        logger.error("Error in check_deadlines_job: %s", exc)
        db.rollback()
    finally:
        db.close()


def scrape_grants_job():
    """Periodic job to run the web scraper."""
    logger.info("Starting scheduled scraper job...")
    db = SessionLocal()
    try:
        # Run async scraper within a synchronous wrapper
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        count = loop.run_until_complete(EUGrantScraper.scrape_eu_grants(db))
        loop.close()
        logger.info("Scheduled scraper job finished. Found/Updated %d grants.", count)
    except Exception as exc:
        logger.error("Error in scrape_grants_job: %s", exc)
    finally:
        db.close()


def start_scheduler():
    """Initialize and start the background scheduler."""
    from app.core.config import settings
    
    if not scheduler.running:
        logger.info("Starting APScheduler background tasks...")
        
        # Scraper task (running at configured interval)
        scheduler.add_job(
            scrape_grants_job,
            "interval",
            hours=settings.SCRAPER_INTERVAL_HOURS,
            id="scrape_grants",
            replace_existing=True
        )
        
        # Deadline checking task (runs daily)
        scheduler.add_job(
            check_deadlines_job,
            "interval",
            days=1,
            id="check_deadlines",
            replace_existing=True
        )
        
        scheduler.start()
        logger.info("APScheduler running with jobs: scrape_grants (every %d hours), check_deadlines (every 24 hours)", settings.SCRAPER_INTERVAL_HOURS)


def stop_scheduler():
    """Gracefully shutdown the scheduler."""
    if scheduler.running:
        logger.info("Stopping APScheduler background tasks...")
        scheduler.shutdown()
        logger.info("APScheduler stopped.")
