import logging
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.database import get_db
from app.models.application import Application
from app.models.grant import Grant
from app.models.user import User
from app.core.security import get_current_user
from app.schemas.application import ApplicationResponse, ApplicationCreate, ApplicationUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/applications", tags=["Applications"])

@router.get("/", response_model=List[ApplicationResponse])
def list_applications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all grants tracked by the logged-in user."""
    stmt = select(Application).where(Application.user_id == current_user.id).order_by(Application.created_at.desc())
    apps = db.execute(stmt).scalars().all()
    return [ApplicationResponse.from_orm_model(app) for app in apps]


@router.post("/", response_model=ApplicationResponse, status_code=status.HTTP_201_CREATED)
def track_grant(
    app_in: ApplicationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start tracking a grant (e.g. save it or record that you applied)."""
    # Verify grant exists
    grant_stmt = select(Grant).where(Grant.id == app_in.grant_id)
    grant = db.execute(grant_stmt).scalar_one_or_none()
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Grant not found."
        )
        
    # Check if already tracking
    existing_stmt = select(Application).where(
        Application.user_id == current_user.id,
        Application.grant_id == app_in.grant_id
    )
    existing = db.execute(existing_stmt).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already tracking this grant opportunity."
        )
        
    new_app = Application(
        user_id=current_user.id,
        grant_id=app_in.grant_id,
        status=app_in.status or "saved",
        notes=app_in.notes
    )
    
    if new_app.status == "applied":
        new_app.applied_at = datetime.now(timezone.utc)
        
    db.add(new_app)
    db.commit()
    db.refresh(new_app)
    
    return ApplicationResponse.from_orm_model(new_app)


@router.put("/{app_id}", response_model=ApplicationResponse)
def update_application(
    app_id: str,
    app_update: ApplicationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update tracking details of a grant application (e.g. change status or edit notes)."""
    stmt = select(Application).where(
        Application.id == app_id,
        Application.user_id == current_user.id
    )
    app = db.execute(stmt).scalar_one_or_none()
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tracked application not found."
        )
        
    update_data = app_update.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(app, field, value)
        
    # Automatically manage applied_at if status changes to 'applied'
    if "status" in update_data and update_data["status"] == "applied" and not app.applied_at:
        app.applied_at = datetime.now(timezone.utc)
        
    db.commit()
    db.refresh(app)
    return ApplicationResponse.from_orm_model(app)


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
def untrack_grant(
    app_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Stop tracking a grant opportunity."""
    stmt = select(Application).where(
        Application.id == app_id,
        Application.user_id == current_user.id
    )
    app = db.execute(stmt).scalar_one_or_none()
    if not app:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tracked application not found."
        )
        
    db.delete(app)
    db.commit()
    return None
