"""
GrantSeeker AI - End-to-End Test Suite
"""
import os
import sys
import json
import logging
from datetime import datetime, timezone

# Add parent directory to sys.path so app can be imported
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set test environment settings
os.environ["DATABASE_URL"] = "sqlite:///./test_grantseeker.db"
os.environ["CHROMA_PERSIST_DIR"] = "./data/test_chroma"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.db.database import Base, get_db
from app.db.seed import seed_database
from app.core.security import hash_password
from app.models.user import User
from app.models.grant import Grant
from app.models.application import Application
from app.models.notification import Notification
from app.services.vector_db import VectorDBService

# Configure testing database
engine = create_engine("sqlite:///./test_grantseeker.db", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

# Override FastAPI get_db dependency
app.dependency_overrides[get_db] = override_get_db

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_suite")

class TestSuite:
    def __init__(self):
        self.client = TestClient(app)
        self.auth_headers = {}
        self.researcher_token = None
        self.refresh_token = None
        self.test_user_id = None
        self.test_grant_id = None
        self.test_app_id = None
        self.test_notif_id = None

    def setup_db(self):
        logger.info("Setting up clean test database...")
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        
        # Seed test data
        db = TestingSessionLocal()
        seed_database(db)
        db.close()
        logger.info("Setup complete.")

    def teardown_db(self):
        logger.info("Tearing down test database...")
        Base.metadata.drop_all(bind=engine)
        if os.path.exists("./test_grantseeker.db"):
            os.remove("./test_grantseeker.db")
        # Clean up Chroma files
        import shutil
        if os.path.exists("./data/test_chroma"):
            shutil.rmtree("./data/test_chroma")
        logger.info("Teardown complete.")

    def run_tests(self) -> bool:
        tests = [
            ("Health Check", self.test_health_check),
            ("User Registration", self.test_user_registration),
            ("User Login", self.test_user_login),
            ("Token Refresh", self.test_token_refresh),
            ("Get Profile", self.test_get_profile),
            ("Update Profile", self.test_update_profile),
            ("List & Filter Grants", self.test_list_grants),
            ("Semantic Search", self.test_semantic_search),
            ("Hybrid Matching Recommendations", self.test_matching_recommendations),
            ("Track Grant Application", self.test_track_application),
            ("List Tracked Applications", self.test_list_applications),
            ("Update Tracked Application", self.test_update_application),
            ("Trigger Scrape", self.test_trigger_scrape),
            ("List Notifications", self.test_list_notifications),
            ("Mark Notification as Read", self.test_mark_notification_read),
            ("Delete Tracked Application", self.test_untrack_application),
        ]
        
        passed = 0
        failed = 0
        
        print("\n" + "="*60)
        print("          GRANTSEEKER AI - RUNNING TEST SUITE")
        print("="*60)
        
        for name, test_func in tests:
            try:
                print(f"Running Test: {name:<40} ... ", end="", flush=True)
                test_func()
                print("\033[92mPASSED\033[0m")
                passed += 1
            except Exception as e:
                print("\033[91mFAILED\033[0m")
                print(f"Error details: {e}")
                import traceback
                traceback.print_exc()
                failed += 1
                
        print("="*60)
        print(f"RESULTS: {passed} tests passed, {failed} tests failed.")
        print("="*60 + "\n")
        return failed == 0

    def test_health_check(self):
        resp = self.client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_user_registration(self):
        payload = {
            "email": "new_user@grantseeker.ai",
            "password": "secure_password",
            "full_name": "Test User",
            "role": "student",
            "institution": "Test Uni",
            "field_of_study": "AI",
            "career_stage": "phd",
            "research_keywords": ["ml", "nlp"],
            "country": "KE"
        }
        resp = self.client.post("/api/auth/register", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["email"] == "new_user@grantseeker.ai"
        assert data["full_name"] == "Test User"
        assert "id" in data

    def test_user_login(self):
        # We login with the seeded researcher account
        payload = {
            "username": "researcher@grantseeker.ai",
            "password": "password123"
        }
        resp = self.client.post("/api/auth/login", data=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        self.researcher_token = data["access_token"]
        self.refresh_token = data["refresh_token"]
        self.auth_headers = {"Authorization": f"Bearer {self.researcher_token}"}

    def test_token_refresh(self):
        payload = {
            "access_token": self.researcher_token,
            "refresh_token": self.refresh_token
        }
        resp = self.client.post("/api/auth/refresh", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        self.researcher_token = data["access_token"]
        self.auth_headers = {"Authorization": f"Bearer {self.researcher_token}"}

    def test_get_profile(self):
        resp = self.client.get("/api/users/profile", headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "researcher@grantseeker.ai"
        assert data["full_name"] == "Dr. Sarah Jenkins"
        self.test_user_id = data["id"]

    def test_update_profile(self):
        payload = {
            "full_name": "Dr. Sarah Jenkins Updated",
            "research_keywords": ["climate change", "machine learning", "renewables", "sustainability", "deep learning"]
        }
        resp = self.client.put("/api/users/profile", json=payload, headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["full_name"] == "Dr. Sarah Jenkins Updated"
        assert "renewables" in data["research_keywords"]

    def test_list_grants(self):
        resp = self.client.get("/api/grants/?status=open")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        assert all(g["status"] == "open" for g in data)
        self.test_grant_id = data[0]["id"]

    def test_semantic_search(self):
        # We index the seeded grants into ChromaDB first for vector testing
        db = TestingSessionLocal()
        grants = db.query(Grant).all()
        for g in grants:
            VectorDBService.upsert_grant(g)
        db.close()

        resp = self.client.post("/api/grants/search?query=solar%20powered%20mini-grids&limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        # High scoring match should relate to clean energy/solar mini-grids
        first_title = data[0]["grant"]["title"]
        assert "solar" in first_title.lower() or "energy" in first_title.lower() or "climate" in first_title.lower()

    def test_matching_recommendations(self):
        resp = self.client.get("/api/grants/matches?limit=3", headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        # Verify match reasons are populated
        assert len(data[0]["match_reasons"]) > 0
        # The top match for Sarah Jenkins should be climate change / machine learning oriented
        top_match_title = data[0]["grant"]["title"]
        assert any(x in top_match_title.lower() for x in ["climate", "health", "innovation", "sdg"])

    def test_track_application(self):
        payload = {
            "grant_id": self.test_grant_id,
            "status": "saved",
            "notes": "Planning to apply next month."
        }
        resp = self.client.post("/api/applications/", json=payload, headers=self.auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["grant_id"] == self.test_grant_id
        assert data["status"] == "saved"
        self.test_app_id = data["id"]

    def test_list_applications(self):
        resp = self.client.get("/api/applications/", headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        assert data[0]["id"] == self.test_app_id
        assert data[0]["grant"]["id"] == self.test_grant_id

    def test_update_application(self):
        payload = {
            "status": "applied",
            "notes": "Submitted the proposal today!"
        }
        resp = self.client.put(f"/api/applications/{self.test_app_id}", json=payload, headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "applied"
        assert data["notes"] == "Submitted the proposal today!"
        assert data["applied_at"] is not None

    def test_trigger_scrape(self):
        # Trigger mock scrape to insert EU-HORIZON-DIGITAL-2026-05 and EU-HORIZON-HEALTH-2026-11
        resp = self.client.post("/api/grants/trigger-scrape")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        
        # Verify the new grants are queryable
        check_resp = self.client.get("/api/grants/")
        titles = [g["title"] for g in check_resp.json()]
        assert any("decentralized AI" in t or "Edge" in t for t in titles)

    def test_list_notifications(self):
        # We manually seed a notification for the test user to query
        db = TestingSessionLocal()
        notif = Notification(
            user_id=self.test_user_id,
            title="Test Alert",
            message="This is a test notification message",
            notif_type="new_match"
        )
        db.add(notif)
        db.commit()
        self.test_notif_id = notif.id
        db.close()

        resp = self.client.get("/api/notifications/", headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0
        assert data[0]["id"] == self.test_notif_id
        assert data[0]["title"] == "Test Alert"

    def test_mark_notification_read(self):
        resp = self.client.put(f"/api/notifications/{self.test_notif_id}/read", headers=self.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_read"] is True

    def test_untrack_application(self):
        resp = self.client.delete(f"/api/applications/{self.test_app_id}", headers=self.auth_headers)
        assert resp.status_code == 204
        
        # Verify it's gone
        check_resp = self.client.get("/api/applications/", headers=self.auth_headers)
        assert not any(app["id"] == self.test_app_id for app in check_resp.json())

if __name__ == "__main__":
    suite = TestSuite()
    success = False
    try:
        suite.setup_db()
        success = suite.run_tests()
    finally:
        suite.teardown_db()
    
    sys.exit(0 if success else 1)
