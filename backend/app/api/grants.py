import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.database import get_db
from app.models.grant import Grant
from app.models.user import User
from app.core.security import get_current_user
from app.services.matching import GrantMatcher
from app.services.scraper import EUGrantScraper
from app.services.vector_db import VectorDBService
from app.schemas.grant import GrantResponse, GrantMatchResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/grants", tags=["Grants"])

@router.get("/", response_model=List[GrantResponse])
def list_grants(
    funder_type: Optional[str] = Query(None, description="Filter by funder type (government|foundation|multilateral|corporate|ngo)"),
    status: Optional[str] = Query(None, description="Filter by status (open|closed|upcoming|rolling)"),
    geographic_scope: Optional[str] = Query(None, description="Filter by geographic scope"),
    min_amount: Optional[float] = Query(None, description="Filter by minimum grant value"),
    max_amount: Optional[float] = Query(None, description="Filter by maximum grant value"),
    db: Session = Depends(get_db)
):
    """Retrieve and filter grants based on query parameters."""
    stmt = select(Grant).where(Grant.is_active == True)
    
    if funder_type:
        stmt = stmt.where(Grant.funder_type == funder_type)
    if status:
        stmt = stmt.where(Grant.status == status)
    if geographic_scope:
        stmt = stmt.where(Grant.geographic_scope == geographic_scope)
    if min_amount is not None:
        stmt = stmt.where(Grant.max_amount >= min_amount)
    if max_amount is not None:
        stmt = stmt.where(Grant.min_amount <= max_amount)
        
    stmt = stmt.order_by(Grant.created_at.desc())
    grants = db.execute(stmt).scalars().all()
    
    return [GrantResponse.from_orm_model(g) for g in grants]


@router.get("/matches", response_model=List[GrantMatchResponse])
def get_user_matches(
    limit: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get personalized grant matches for the authenticated user."""
    return GrantMatcher.get_matches_for_user(db, current_user, limit=limit)


@router.post("/search", response_model=List[GrantMatchResponse])
def semantic_search(
    query: str = Query(..., min_length=3, description="Semantic search query matching grant title, description, or subject areas"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db)
):
    """Perform a pure semantic search across all grants in ChromaDB."""
    matches = VectorDBService.search_grants(query, limit=limit)
    
    results = []
    for match in matches:
        grant_id = match["id"]
        score = match["score"]
        
        # Load grant details from SQL
        stmt = select(Grant).where(Grant.id == grant_id)
        grant = db.execute(stmt).scalar_one_or_none()
        
        if grant and grant.is_active:
            reasons = [f"Semantic match score: {int(score * 100)}%"]
            results.append(
                GrantMatchResponse(
                    grant=GrantResponse.from_orm_model(grant),
                    score=score,
                    match_reasons=reasons
                )
            )
            
    # Sort by score descending
    results.sort(key=lambda x: x.score, reverse=True)
    return results


@router.get("/{grant_id}", response_model=GrantResponse)
def get_grant(grant_id: str, db: Session = Depends(get_db)):
    """Fetch details of a single grant."""
    stmt = select(Grant).where(Grant.id == grant_id, Grant.is_active == True)
    grant = db.execute(stmt).scalar_one_or_none()
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Grant not found."
        )
    return GrantResponse.from_orm_model(grant)


@router.post("/trigger-scrape", status_code=status.HTTP_200_OK)
async def trigger_scrape(db: Session = Depends(get_db)):
    """Manually trigger the scraper to fetch new grants (admin/developer utility)."""
    try:
        count = await EUGrantScraper.scrape_eu_grants(db)
        return {"status": "success", "message": f"Scraper completed. Fetched/Updated {count} grants."}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scraping failed: {str(exc)}"
        )
