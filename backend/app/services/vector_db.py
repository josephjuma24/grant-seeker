import os
import logging
from typing import List, Dict, Any, Optional
import chromadb
from chromadb.config import Settings as ChromaSettings
from sentence_transformers import SentenceTransformer

from app.core.config import settings
from app.models.grant import Grant

logger = logging.getLogger(__name__)

class VectorDBService:
    _model: Optional[SentenceTransformer] = None
    _client: Optional[chromadb.PersistentClient] = None
    _collection = None

    @classmethod
    def get_model(cls) -> SentenceTransformer:
        """Lazily load the sentence-transformers model."""
        if cls._model is None:
            logger.info("Loading SentenceTransformer model 'all-MiniLM-L6-v2'...")
            # Set cache folder if needed, otherwise default to huggingface home
            cls._model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("SentenceTransformer model loaded successfully.")
        return cls._model

    @classmethod
    def get_client(cls) -> chromadb.PersistentClient:
        """Lazily initialize the ChromaDB persistent client."""
        if cls._client is None:
            persist_dir = settings.CHROMA_PERSIST_DIR
            os.makedirs(persist_dir, exist_ok=True)
            logger.info("Initializing ChromaDB persistent client at: %s", persist_dir)
            cls._client = chromadb.PersistentClient(path=persist_dir)
        return cls._client

    @classmethod
    def get_collection(cls):
        """Get or create the 'grants' Chroma collection."""
        if cls._collection is None:
            client = cls.get_client()
            logger.info("Getting or creating Chroma collection 'grants'...")
            # We use cosine similarity (cosine distance in Chroma: smaller is closer, score is distance)
            # Distance: 0 to 2, where 0 is identical, 2 is opposite.
            cls._collection = client.get_or_create_collection(
                name="grants",
                metadata={"hnsw:space": "cosine"}
            )
        return cls._collection

    @classmethod
    def _build_grant_document(cls, grant: Grant) -> str:
        """Build a rich text document for embedding from a Grant model."""
        subject_areas = ", ".join(grant.get_subject_areas())
        keywords = ", ".join(grant.get_keywords())
        
        parts = [
            f"Title: {grant.title}",
            f"Description: {grant.description or ''}",
            f"Funder: {grant.funder_name or ''}",
            f"Subject Areas: {subject_areas}",
            f"Keywords: {keywords}"
        ]
        return "\n".join(parts)

    @classmethod
    def upsert_grant(cls, grant: Grant) -> None:
        """Generate embeddings and upsert a grant into ChromaDB."""
        try:
            collection = cls.get_collection()
            model = cls.get_model()
            
            document = cls._build_grant_document(grant)
            embedding = model.encode(document).tolist()
            
            # Map deadline timestamp to ISO or string for metadata (Chroma supports simple types)
            deadline_str = grant.deadline.isoformat() if grant.deadline else ""
            
            metadata = {
                "title": grant.title,
                "funder_name": grant.funder_name or "",
                "status": grant.status,
                "min_amount": grant.min_amount if grant.min_amount is not None else -1.0,
                "max_amount": grant.max_amount if grant.max_amount is not None else -1.0,
                "currency": grant.currency,
                "deadline": deadline_str,
                "geographic_scope": grant.geographic_scope or ""
            }
            
            collection.upsert(
                ids=[grant.id],
                embeddings=[embedding],
                metadatas=[metadata],
                documents=[document]
            )
            logger.info("Upserted grant %s to vector database.", grant.id)
        except Exception as exc:
            logger.error("Failed to upsert grant %s to ChromaDB: %s", grant.id, exc)

    @classmethod
    def delete_grant(cls, grant_id: str) -> None:
        """Delete a grant from ChromaDB."""
        try:
            collection = cls.get_collection()
            collection.delete(ids=[grant_id])
            logger.info("Deleted grant %s from vector database.", grant_id)
        except Exception as exc:
            logger.error("Failed to delete grant %s from ChromaDB: %s", grant_id, exc)

    @classmethod
    def search_grants(cls, query_text: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Perform semantic similarity search on grants.
        Returns a list of dicts: {'id': grant_id, 'score': similarity_score}
        """
        try:
            collection = cls.get_collection()
            model = cls.get_model()
            
            query_embedding = model.encode(query_text).tolist()
            
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=limit
            )
            
            matches = []
            if results and results.get("ids") and len(results["ids"]) > 0:
                ids = results["ids"][0]
                # Chroma cosine distance is 0 to 2.
                # We convert distance to similarity score: 1.0 - (distance / 2.0)
                distances = results.get("distances", [[]])[0] if "distances" in results else [1.0] * len(ids)
                
                for idx, grant_id in enumerate(ids):
                    distance = distances[idx] if idx < len(distances) else 1.0
                    # Clip distance between 0.0 and 2.0
                    distance = max(0.0, min(2.0, distance))
                    similarity = 1.0 - (distance / 2.0)
                    matches.append({
                        "id": grant_id,
                        "score": round(similarity, 4)
                    })
            return matches
        except Exception as exc:
            logger.error("Failed semantic search in ChromaDB: %s", exc)
            return []
