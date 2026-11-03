"""
GrantSeeker AI - Database Seeding
"""
import json
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.user import User
from app.models.grant import Grant
from app.core.security import hash_password

def seed_database(db: Session) -> int:
    """Seed the database with test users and sample grants.
    Returns the number of grants seeded, or 0 if already seeded.
    """
    # Check if we already have users or grants
    existing_grants_count = db.query(Grant).count()
    if existing_grants_count > 0:
        return 0

    # 1. Create Test Users
    test_users = [
        User(
            email="researcher@grantseeker.ai",
            hashed_password=hash_password("password123"),
            full_name="Dr. Sarah Jenkins",
            role="researcher",
            institution="Global Science University",
            field_of_study="Environmental Science & AI",
            career_stage="lecturer",
            research_keywords=json.dumps(["climate change", "machine learning", "renewable energy", "sustainability"]),
            country="KE",
            funding_purpose="research_grant",
            bio="Associate Professor focused on applying machine learning techniques to climate prediction and renewable energy optimization.",
            notification_prefs=json.dumps({"new_match": True, "deadline_14d": True, "deadline_3d": True, "weekly_digest": True})
        ),
        User(
            email="student@grantseeker.ai",
            hashed_password=hash_password("password123"),
            full_name="Alex Mercer",
            role="student",
            institution="Nairobi Tech Institute",
            field_of_study="Computer Science",
            career_stage="masters",
            research_keywords=json.dumps(["computer vision", "health informatics", "deep learning"]),
            country="KE",
            funding_purpose="scholarship",
            bio="MSc candidate researching computer vision applications for early diagnosis of crop diseases in East Africa.",
            notification_prefs=json.dumps({"new_match": True, "deadline_14d": True, "deadline_3d": True, "weekly_digest": False})
        ),
        User(
            email="industry@grantseeker.ai",
            hashed_password=hash_password("password123"),
            full_name="Innovate Kenya Ltd",
            role="industry",
            institution="Innovate Kenya Hub",
            field_of_study="Industrial Engineering",
            career_stage="senior",
            research_keywords=json.dumps(["solar technology", "waste management", "agritech"]),
            country="KE",
            funding_purpose="rd_innovation",
            org_size="11-50",
            bio="Agritech startup developing low-cost IoT soil moisture sensors powered by solar energy for smallholder farmers.",
            notification_prefs=json.dumps({"new_match": True, "deadline_14d": True, "deadline_3d": False, "weekly_digest": True})
        )
    ]

    for user in test_users:
        # Check if email exists
        stmt = select(User).where(User.email == user.email)
        existing_user = db.execute(stmt).scalar_one_or_none()
        if not existing_user:
            db.add(user)

    # 2. Create Sample Grants
    now = datetime.now(timezone.utc)
    sample_grants = [
        Grant(
            external_id="EU-HORIZON-CLIMA-2026",
            source="eu_portal",
            source_url="https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/eu-horizon-clima-2026",
            title="Horizon Europe: AI-Driven Climate Mitigation Solutions",
            description="Funding for research projects developing advanced artificial intelligence and machine learning models to optimize carbon capture, predict extreme weather patterns, and accelerate transition to renewable energy sources.",
            funder_name="European Commission",
            funder_type="government",
            min_amount=1500000.0,
            max_amount=5000000.0,
            currency="EUR",
            open_date=now - timedelta(days=30),
            deadline=now + timedelta(days=60),
            status="open",
            eligible_org_types=json.dumps(["academic", "research_institute", "sme"]),
            eligible_countries=json.dumps(["EU", "KE", "ZA", "NG", "GH"]),
            geographic_scope="eu",
            subject_areas=json.dumps(["Environmental Science", "Computer Science", "Engineering"]),
            sdg_goals=json.dumps([13, 7, 9]),
            keywords=json.dumps(["climate change", "machine learning", "artificial intelligence", "carbon capture", "renewable energy"]),
            application_url="https://ec.europa.eu/opportunities/apply",
            contact_email="horizon-clima@ec.europa.eu"
        ),
        Grant(
            external_id="NIH-R01-AI-HEALTH",
            source="nih",
            source_url="https://grants.nih.gov/grants/guide/pa-files/NIH-R01-AI-HEALTH.html",
            title="NIH R01: Innovative AI for Infectious Disease Prediction and Management",
            description="Supports projects utilizing deep learning, natural language processing, and multimodal biomedical datasets to model, monitor, and mitigate infectious disease transmission globally, with special emphasis on resource-limited settings.",
            funder_name="National Institutes of Health",
            funder_type="government",
            min_amount=250000.0,
            max_amount=1000000.0,
            currency="USD",
            open_date=now - timedelta(days=15),
            deadline=now + timedelta(days=12),
            status="open",
            eligible_org_types=json.dumps(["academic", "hospital", "research_institute"]),
            eligible_countries=json.dumps(["US", "KE", "UG", "TZ", "ZA"]),
            geographic_scope="global",
            subject_areas=json.dumps(["Medicine", "Computer Science", "Public Health"]),
            sdg_goals=json.dumps([3, 9]),
            keywords=json.dumps(["health informatics", "infectious disease", "deep learning", "epidemiology", "machine learning"]),
            application_url="https://grants.nih.gov/apply",
            contact_email="nih-ai-health@nih.gov"
        ),
        Grant(
            external_id="NSF-26-COMPUTING",
            source="nsf",
            source_url="https://www.nsf.gov/funding/pgm_summ.jsp?pims_id=50326",
            title="NSF Division of Information and Intelligent Systems Core Programs",
            description="Supports research and education projects in Human-Centered Computing, Information Integration and Informatics, and Robust Intelligence (Computer Vision, Natural Language Processing, Machine Learning).",
            funder_name="National Science Foundation",
            funder_type="government",
            min_amount=100000.0,
            max_amount=1200000.0,
            currency="USD",
            open_date=now - timedelta(days=60),
            deadline=now + timedelta(days=150),
            status="open",
            eligible_org_types=json.dumps(["academic", "nonprofit"]),
            eligible_countries=json.dumps(["US"]),
            geographic_scope="us_only",
            subject_areas=json.dumps(["Computer Science", "Mathematics"]),
            sdg_goals=json.dumps([9, 4]),
            keywords=json.dumps(["computer vision", "artificial intelligence", "deep learning", "human-computer interaction"]),
            application_url="https://research.gov",
            contact_email="iis-core@nsf.gov"
        ),
        Grant(
            external_id="AFDB-AGRI-INNOVATION-2026",
            source="afdb",
            source_url="https://www.afdb.org/en/projects-and-operations/agricultural-innovation-fund",
            title="African Development Bank: Agricultural Innovation and Technology Fund",
            description="Empowering African smallholder farmers and agribusinesses through modern technology. Supports startups and SMEs deploying IoT devices, solar-powered systems, drone mapping, and mobile applications to increase crop yield and reduce post-harvest waste.",
            funder_name="African Development Bank",
            funder_type="multilateral",
            min_amount=50000.0,
            max_amount=250000.0,
            currency="USD",
            open_date=now - timedelta(days=10),
            deadline=now + timedelta(days=45),
            status="open",
            eligible_org_types=json.dumps(["sme", "startup", "ngo"]),
            eligible_countries=json.dumps(["KE", "UG", "TZ", "RW", "ET", "NG", "GH", "ZA"]),
            geographic_scope="africa",
            subject_areas=json.dumps(["Agriculture", "Engineering", "Business Development"]),
            sdg_goals=json.dumps([2, 7, 8, 9]),
            keywords=json.dumps(["agritech", "solar technology", "waste management", "IoT", "smallholder farmers"]),
            application_url="https://afdb.org/agri-innovation/apply",
            contact_email="agri-innovate@afdb.org"
        ),
        Grant(
            external_id="BILL-GATES-HEALTH-EQUITY",
            source="manual",
            source_url="https://www.gatesfoundation.org/our-work/programs/global-health",
            title="Grand Challenges: AI Solutions for Global Health Equity",
            description="A program supporting innovative projects that use AI to address critical healthcare challenges in low- and middle-income countries. We seek solutions focusing on maternal/child health, family planning, and clinical decision support.",
            funder_name="Bill & Melinda Gates Foundation",
            funder_type="foundation",
            min_amount=100000.0,
            max_amount=500000.0,
            currency="USD",
            open_date=now - timedelta(days=40),
            deadline=now + timedelta(days=2),
            status="open",
            eligible_org_types=json.dumps(["academic", "nonprofit", "sme", "startup"]),
            eligible_countries=json.dumps(["global"]),
            geographic_scope="global",
            subject_areas=json.dumps(["Medicine", "Public Health", "Computer Science"]),
            sdg_goals=json.dumps([3, 5, 10]),
            keywords=json.dumps(["health informatics", "artificial intelligence", "maternal health", "clinical support"]),
            application_url="https://grandchallenges.org",
            contact_email="info@gatesfoundation.org"
        ),
        Grant(
            external_id="GOOGLE-AI-FOR-SDGS",
            source="manual",
            source_url="https://ai.google/responsibility/social-good/",
            title="Google.org: AI for Sustainable Development Goals",
            description="Funding and technical assistance for academic institutions and non-profit organizations using artificial intelligence to solve challenges aligned with the United Nations Sustainable Development Goals.",
            funder_name="Google.org",
            funder_type="corporate",
            min_amount=500000.0,
            max_amount=2000000.0,
            currency="USD",
            open_date=now - timedelta(days=5),
            deadline=now + timedelta(days=75),
            status="open",
            eligible_org_types=json.dumps(["academic", "nonprofit"]),
            eligible_countries=json.dumps(["global"]),
            geographic_scope="global",
            subject_areas=json.dumps(["Computer Science", "Environmental Science", "Social Sciences"]),
            sdg_goals=json.dumps([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
            keywords=json.dumps(["artificial intelligence", "machine learning", "deep learning", "sustainability", "social good"]),
            application_url="https://google.org/ai-sdgs",
            contact_email="ai-sdg-grant@google.com"
        ),
        Grant(
            external_id="ROCKFELLER-CLEAN-ENERGY",
            source="manual",
            source_url="https://www.rockefellerfoundation.org/initiative/clean-energy/",
            title="Rockefeller Foundation: Solar Mini-Grids for Rural Electrification",
            description="Accelerating access to reliable, clean electricity in sub-Saharan Africa. Funding supports decentralized solar mini-grid deployment, local training programs, and smart metering integration.",
            funder_name="Rockefeller Foundation",
            funder_type="foundation",
            min_amount=200000.0,
            max_amount=750000.0,
            currency="USD",
            open_date=now - timedelta(days=90),
            deadline=now - timedelta(days=2),  # Already closed
            status="closed",
            eligible_org_types=json.dumps(["sme", "ngo", "utility"]),
            eligible_countries=json.dumps(["KE", "TZ", "UG", "RW", "ET", "ZM", "MW"]),
            geographic_scope="east_africa",
            subject_areas=json.dumps(["Engineering", "Economics", "Environmental Science"]),
            sdg_goals=json.dumps([7, 11, 13]),
            keywords=json.dumps(["solar technology", "mini-grids", "renewable energy", "rural electrification"]),
            application_url="https://rockefellerfoundation.org/apply-mini-grids",
            contact_email="cleanenergy@rockfound.org"
        ),
        Grant(
            external_id="EU-EDCTP3-HEALTH-2026",
            source="eu_portal",
            source_url="https://ec.europa.eu/opportunities/edctp3",
            title="Global Health EDCTP3 Joint Undertaking: Research on Neglected Diseases",
            description="Promoting global clinical research partnerships between Europe and sub-Saharan Africa to accelerate the development of new or improved health technologies, treatments, and vaccines against poverty-related infectious diseases.",
            funder_name="European Commission / EDCTP Association",
            funder_type="government",
            min_amount=1000000.0,
            max_amount=4000000.0,
            currency="EUR",
            open_date=now - timedelta(days=20),
            deadline=now + timedelta(days=95),
            status="open",
            eligible_org_types=json.dumps(["academic", "research_institute", "ngo", "hospital"]),
            eligible_countries=json.dumps(["EU", "KE", "TZ", "UG", "ZA", "NG", "GH", "RW"]),
            geographic_scope="global",
            subject_areas=json.dumps(["Medicine", "Public Health"]),
            sdg_goals=json.dumps([3, 17]),
            keywords=json.dumps(["infectious disease", "clinical trials", "vaccines", "global health", "neglected diseases"]),
            application_url="https://ec.europa.eu/opportunities/edctp3/apply",
            contact_email="edctp3@ec.europa.eu"
        )
    ]

    count = 0
    for grant in sample_grants:
        # Check if grant external_id exists
        stmt = select(Grant).where(Grant.external_id == grant.external_id)
        existing_grant = db.execute(stmt).scalar_one_or_none()
        if not existing_grant:
            db.add(grant)
            count += 1

    db.commit()
    return count
