"""
GrantSeeker AI - User ORM model
"""
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.notification import Notification
    from app.models.application import Application


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    # Primary key
    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )

    # Auth fields
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # student|researcher|industry

    # Profile fields (all optional)
    institution: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    field_of_study: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    career_stage: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # phd|masters|postdoc|lecturer|senior|mid_level
    research_keywords: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # JSON array
    country: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # ISO code
    funding_purpose: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # thesis|scholarship|research_grant|rd_innovation
    org_size: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # for industry role
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Notification preferences (JSON object stored as string)
    notification_prefs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    # Relationships
    notifications: Mapped[List["Notification"]] = relationship(
        "Notification", back_populates="user", cascade="all, delete-orphan"
    )
    applications: Mapped[List["Application"]] = relationship(
        "Application", back_populates="user", cascade="all, delete-orphan"
    )

    # ------------------------------------------------------------------
    # Helper properties
    # ------------------------------------------------------------------

    def get_research_keywords(self) -> List[str]:
        """Return research_keywords as a Python list."""
        if not self.research_keywords:
            return []
        try:
            return json.loads(self.research_keywords)
        except (json.JSONDecodeError, TypeError):
            return []

    def get_notification_prefs(self) -> dict:
        """Return notification_prefs as a Python dict."""
        if not self.notification_prefs:
            return {}
        try:
            return json.loads(self.notification_prefs)
        except (json.JSONDecodeError, TypeError):
            return {}

    def __repr__(self) -> str:
        return f"<User id={self.id!r} email={self.email!r}>"
