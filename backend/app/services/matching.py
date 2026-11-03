import logging
import json
import networkx as nx
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.user import User
from app.models.grant import Grant
from app.services.vector_db import VectorDBService
from app.schemas.grant import GrantResponse, GrantMatchResponse

logger = logging.getLogger(__name__)

class GrantMatcher:
    @classmethod
    def get_matches_for_user(cls, db: Session, user: User, limit: int = 5) -> List[GrantMatchResponse]:
        """Combine vector semantic search, SQL metadata filters, and a NetworkX
        relationship graph to rank and explain grant recommendations for a user.
        """
        logger.info("Computing matching grants for user: %s", user.email)
        
        # 1. Fetch active, open or upcoming grants from SQL
        stmt = select(Grant).where(Grant.is_active == True, Grant.status.in_(["open", "upcoming", "rolling"]))
        all_grants = db.execute(stmt).scalars().all()
        if not all_grants:
            return []

        # Map grants by ID for quick lookup
        grant_map = {g.id: g for g in all_grants}

        # 2. Build Query String and perform Vector Search
        user_keywords = user.get_research_keywords()
        query_text = (
            f"Research Field: {user.field_of_study or ''}. "
            f"Keywords: {', '.join(user_keywords)}. "
            f"Career Stage: {user.career_stage or ''}. "
            f"Bio: {user.bio or ''}"
        )
        
        # Search vector DB for semantic candidates
        vector_results = VectorDBService.search_grants(query_text, limit=100)
        vector_scores = {res["id"]: res["score"] for res in vector_results}

        # 3. Construct Bipartite NetworkX Graph
        # Nodes: Grants, Subject Areas, Keywords, SDGs
        # Edges connect grants to their attributes
        G = nx.Graph()
        
        for g in all_grants:
            G.add_node(g.id, type="grant")
            
            # Subject areas
            for area in g.get_subject_areas():
                G.add_node(area, type="subject_area")
                G.add_edge(g.id, area)
                
            # Keywords
            for kw in g.get_keywords():
                G.add_node(kw, type="keyword")
                G.add_edge(g.id, kw)
                
            # SDGs
            for sdg in g.get_sdg_goals():
                sdg_node = f"SDG-{sdg}"
                G.add_node(sdg_node, type="sdg")
                G.add_edge(g.id, sdg_node)

        # 4. Compute Network Affinity Boost using Jaccard Similarity on the graph
        # For grants that have a high vector score, find related grants that share neighbors.
        # This propagates recommendations structurally.
        network_boosts = {}
        for grant_id, v_score in vector_scores.items():
            if grant_id not in G:
                continue
                
            # Find matching neighbors (keywords, SDGs, areas)
            neighbors = list(G.neighbors(grant_id))
            for n in neighbors:
                # Find other grants sharing this attribute
                co_grants = list(G.neighbors(n))
                for cg in co_grants:
                    if cg == grant_id:
                        continue
                    # Calculate Jaccard similarity of their neighbors in the graph
                    n1 = set(G.neighbors(grant_id))
                    n2 = set(G.neighbors(cg))
                    jaccard = len(n1.intersection(n2)) / len(n1.union(n2)) if n1.union(n2) else 0
                    
                    # Accumulate a small structural boost (weighted by the vector similarity of the source)
                    network_boosts[cg] = network_boosts.get(cg, 0.0) + (jaccard * v_score * 0.15)

        # 5. Score and filter candidates
        matches = []
        user_country = user.country.upper() if user.country else None

        for g in all_grants:
            # A. Base vector score (default to low if not in vector search results)
            v_score = vector_scores.get(g.id, 0.2)
            
            # B. Network boost
            n_boost = network_boosts.get(g.id, 0.0)
            
            # C. Combine scores (cap at 1.0)
            final_score = min(1.0, v_score + n_boost)
            
            # D. HARD FILTERS (Geographic eligibility check)
            eligible_countries = [c.upper() for c in g.get_eligible_countries()]
            if eligible_countries and "GLOBAL" not in eligible_countries:
                if user_country and user_country not in eligible_countries:
                    # Penalize score severely if country is not eligible
                    final_score *= 0.1
            
            # E. Generate match reasons
            reasons = []
            
            # Highlight vector similarity
            if v_score >= 0.65:
                reasons.append(f"Strong semantic match ({int(v_score * 100)}%) with your research profile")
            elif v_score >= 0.4:
                reasons.append(f"Good content match ({int(v_score * 100)}%) to your interests")

            # Check shared keywords
            shared_kws = list(set(user_keywords).intersection(set(g.get_keywords())))
            if shared_kws:
                reasons.append(f"Matches your keywords: {', '.join(shared_kws[:3])}")
                
            # Check SDG goals
            # Let's see if we can find if there are matching SDGs
            # Sarah Jenkins has keywords: climate change, machine learning, renewable energy, sustainability
            # Crop diseases/alex: computer vision, health informatics, deep learning.
            # Let's check matching SDG goals based on keywords
            sdgs = g.get_sdg_goals()
            if sdgs:
                # Map SDGs to names
                sdg_names = {
                    2: "Zero Hunger",
                    3: "Good Health & Well-being",
                    7: "Affordable & Clean Energy",
                    9: "Industry, Innovation & Infrastructure",
                    13: "Climate Action",
                }
                matched_sdg_names = [sdg_names[s] for s in sdgs if s in sdg_names]
                if matched_sdg_names:
                    reasons.append(f"Supports SDG: {', '.join(matched_sdg_names)}")

            # Check country match
            if user_country and user_country in eligible_countries:
                reasons.append(f"Explicitly eligible for citizens/organizations in {user_country}")
            elif "GLOBAL" in eligible_countries:
                reasons.append("Globally open opportunity")

            # Check funding purpose vs career stage
            if user.funding_purpose == "scholarship" and "academic" in g.get_eligible_org_types():
                reasons.append("Aligned with academic / scholarship opportunities")
            elif user.funding_purpose == "research_grant" and g.max_amount and g.max_amount >= 500000.0:
                reasons.append("Fits large-scale research grant budgets")
            elif user.funding_purpose == "rd_innovation" and "sme" in g.get_eligible_org_types():
                reasons.append("SME/startup eligibility aligns with your R&D focus")

            # If final score is extremely low (meaning country mismatch), don't recommend
            if final_score < 0.25:
                continue

            matches.append(
                GrantMatchResponse(
                    grant=GrantResponse.from_orm_model(g),
                    score=round(final_score, 4),
                    match_reasons=reasons
                )
            )

        # Sort matches by final score descending
        matches.sort(key=lambda m: m.score, reverse=True)
        return matches[:limit]
