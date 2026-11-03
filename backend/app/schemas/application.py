from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.schemas.grant import GrantResponse

class ApplicationCreate(BaseModel):
    grant_id: str
    status: Optional[str] = "saved"
    notes: Optional[str] = None

class ApplicationUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    applied_at: Optional[datetime] = None

class ApplicationResponse(BaseModel):
    id: str
    user_id: str
    grant_id: str
    status: str
    notes: Optional[str] = None
    applied_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    grant: Optional[GrantResponse] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_model(cls, db_app) -> "ApplicationResponse":
        """Convert a SQLAlchemy Application model to ApplicationResponse Pydantic model."""
        grant_resp = None
        if db_app.grant:
            grant_resp = GrantResponse.from_orm_model(db_app.grant)
        return cls(
            id=db_app.id,
            user_id=db_app.user_id,
            grant_id=db_app.grant_id,
            status=db_app.status,
            notes=db_app.notes,
            applied_at=db_app.applied_at,
            created_at=db_app.created_at,
            updated_at=db_app.updated_at,
            grant=grant_resp
        )
