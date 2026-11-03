import logging
import json
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User
from app.core.security import get_current_user
from app.schemas.user import UserResponse, UserUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["Users"])

@router.get("/profile", response_model=UserResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    """Fetch the logged-in user's profile details."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        institution=current_user.institution,
        field_of_study=current_user.field_of_study,
        career_stage=current_user.career_stage,
        research_keywords=current_user.get_research_keywords(),
        country=current_user.country,
        funding_purpose=current_user.funding_purpose,
        org_size=current_user.org_size,
        bio=current_user.bio,
        notification_prefs=current_user.get_notification_prefs(),
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at
    )


@router.put("/profile", response_model=UserResponse)
def update_profile(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update the logged-in user's profile details."""
    update_data = user_update.model_dump(exclude_unset=True)
    
    for field, value in update_data.items():
        if field == "research_keywords":
            current_user.research_keywords = json.dumps(value)
        elif field == "notification_prefs":
            current_user.notification_prefs = json.dumps(value)
        else:
            setattr(current_user, field, value)
            
    db.commit()
    db.refresh(current_user)
    
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        institution=current_user.institution,
        field_of_study=current_user.field_of_study,
        career_stage=current_user.career_stage,
        research_keywords=current_user.get_research_keywords(),
        country=current_user.country,
        funding_purpose=current_user.funding_purpose,
        org_size=current_user.org_size,
        bio=current_user.bio,
        notification_prefs=current_user.get_notification_prefs(),
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at
    )
