"""
GrantSeeker AI - Application Configuration
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    # JWT / Security
    SECRET_KEY: str = "grant-seeker-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    DATABASE_URL: str = "sqlite:///./grantseeker.db"

    # ChromaDB
    CHROMA_PERSIST_DIR: str = "./data/chroma"

    # Scraper
    SCRAPER_INTERVAL_HOURS: int = 6

    # EU Funding Portal
    EU_PORTAL_API_KEY: str = "SEDIA"

    # App metadata
    APP_NAME: str = "GrantSeeker AI"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
