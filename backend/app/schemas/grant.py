from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class GrantResponse(BaseModel):
    id: str
    external_id: Optional[str] = None
    source: str
    source_url: Optional[str] = None
    title: str
    description: Optional[str] = None
    funder_name: Optional[str] = None
    funder_type: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    currency: str = "USD"
    deadline: Optional[datetime] = None
    open_date: Optional[datetime] = None
    status: str
    eligible_org_types: List[str] = []
    eligible_countries: List[str] = []
    geographic_scope: Optional[str] = None
    subject_areas: List[str] = []
    sdg_goals: List[int] = []
    keywords: List[str] = []
    application_url: Optional[str] = None
    contact_email: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_scraped_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_model(cls, db_grant) -> "GrantResponse":
        """Convert a SQLAlchemy Grant model to GrantResponse Pydantic model."""
        return cls(
            id=db_grant.id,
            external_id=db_grant.external_id,
            source=db_grant.source,
            source_url=db_grant.source_url,
            title=db_grant.title,
            description=db_grant.description,
            funder_name=db_grant.funder_name,
            funder_type=db_grant.funder_type,
            min_amount=db_grant.min_amount,
            max_amount=db_grant.max_amount,
            currency=db_grant.currency,
            deadline=db_grant.deadline,
            open_date=db_grant.open_date,
            status=db_grant.status,
            eligible_org_types=db_grant.get_eligible_org_types(),
            eligible_countries=db_grant.get_eligible_countries(),
            geographic_scope=db_grant.geographic_scope,
            subject_areas=db_grant.get_subject_areas(),
            sdg_goals=db_grant.get_sdg_goals(),
            keywords=db_grant.get_keywords(),
            application_url=db_grant.application_url,
            contact_email=db_grant.contact_email,
            is_active=db_grant.is_active,
            created_at=db_grant.created_at,
            updated_at=db_grant.updated_at,
            last_scraped_at=db_grant.last_scraped_at
        )

class GrantMatchResponse(BaseModel):
    grant: GrantResponse
    score: float
    match_reasons: List[str]
