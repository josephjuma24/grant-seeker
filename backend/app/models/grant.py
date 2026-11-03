"""
GrantSeeker AI - Grant ORM model
"""
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Grant(Base):
    __tablename__ = "grants"

    # Primary key
    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )

    # Source tracking
    external_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    source: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # grants_gov | nih | eu_portal | nsf | world_bank | afdb | manual
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Core details
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Funder
    funder_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    funder_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )  # government|foundation|multilateral|corporate|ngo

    # Funding amounts
    min_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="USD")

    # Dates
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    open_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="open", index=True
    )  # open|closed|upcoming|rolling

    # Eligibility (stored as JSON strings)
    eligible_org_types: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    eligible_countries: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array

    # Geography
    geographic_scope: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )  # global|africa|eu|us_only|east_africa|...

    # Categorisation (stored as JSON strings)
    subject_areas: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    sdg_goals: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of ints
    keywords: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array

    # Contact / application
    application_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Metadata
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )
    last_scraped_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ------------------------------------------------------------------
    # Helper properties to parse JSON array fields
    # ------------------------------------------------------------------

    def get_subject_areas(self) -> List[str]:
        """Return subject_areas as a Python list."""
        if not self.subject_areas:
            return []
        try:
            return json.loads(self.subject_areas)
        except (json.JSONDecodeError, TypeError):
            return []

    def get_eligible_countries(self) -> List[str]:
        """Return eligible_countries as a Python list."""
        if not self.eligible_countries:
            return []
        try:
            return json.loads(self.eligible_countries)
        except (json.JSONDecodeError, TypeError):
            return []

    def get_eligible_org_types(self) -> List[str]:
        """Return eligible_org_types as a Python list."""
        if not self.eligible_org_types:
            return []
        try:
            return json.loads(self.eligible_org_types)
        except (json.JSONDecodeError, TypeError):
            return []

    def get_keywords(self) -> List[str]:
        """Return keywords as a Python list."""
        if not self.keywords:
            return []
        try:
            return json.loads(self.keywords)
        except (json.JSONDecodeError, TypeError):
            return []

    def get_sdg_goals(self) -> List[int]:
        """Return sdg_goals as a Python list of ints."""
        if not self.sdg_goals:
            return []
        try:
            return [int(x) for x in json.loads(self.sdg_goals)]
        except (json.JSONDecodeError, TypeError, ValueError):
            return []

    def __repr__(self) -> str:
        return f"<Grant id={self.id!r} title={self.title[:40]!r}>"
