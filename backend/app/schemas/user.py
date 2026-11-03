from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    role: str

class UserCreate(UserBase):
    password: str
    institution: Optional[str] = None
    field_of_study: Optional[str] = None
    career_stage: Optional[str] = None
    research_keywords: List[str] = []
    country: Optional[str] = None
    funding_purpose: Optional[str] = None
    org_size: Optional[str] = None
    bio: Optional[str] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    institution: Optional[str] = None
    field_of_study: Optional[str] = None
    career_stage: Optional[str] = None
    research_keywords: Optional[List[str]] = None
    country: Optional[str] = None
    funding_purpose: Optional[str] = None
    org_size: Optional[str] = None
    bio: Optional[str] = None
    notification_prefs: Optional[dict] = None

class UserResponse(UserBase):
    id: str
    institution: Optional[str] = None
    field_of_study: Optional[str] = None
    career_stage: Optional[str] = None
    research_keywords: List[str] = []
    country: Optional[str] = None
    funding_purpose: Optional[str] = None
    org_size: Optional[str] = None
    bio: Optional[str] = None
    notification_prefs: dict = {}
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
