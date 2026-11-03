import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select, update

from app.db.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.core.security import get_current_user
from app.schemas.notification import NotificationResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notifications", tags=["Notifications"])

@router.get("/", response_model=List[NotificationResponse])
def list_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve all notifications for the authenticated user."""
    stmt = select(Notification).where(Notification.user_id == current_user.id).order_by(Notification.created_at.desc())
    notifications = db.execute(stmt).scalars().all()
    return notifications


@router.put("/{notif_id}/read", response_model=NotificationResponse)
def mark_read(
    notif_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark a specific notification as read."""
    stmt = select(Notification).where(
        Notification.id == notif_id,
        Notification.user_id == current_user.id
    )
    notification = db.execute(stmt).scalar_one_or_none()
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found."
        )
        
    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.put("/read-all", status_code=status.HTTP_200_OK)
def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark all unread notifications for the user as read."""
    stmt = (
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.is_read == False)
        .values(is_read=True)
    )
    db.execute(stmt)
    db.commit()
    return {"status": "success", "message": "All notifications marked as read."}
