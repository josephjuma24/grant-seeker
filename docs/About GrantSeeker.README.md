# About GrantSeeker

**GrantSeeker is a grant intelligence platform for researchers, universities and NGOs in Africa.** Autonomous agents harvest funding calls from funder sources. The platform keeps only calls that applicants based in Africa can apply to and that state an award amount, then ranks them against each user's full profile. It also supports the work after discovery: checking eligibility, drafting, team review, institutional approval and tracking outcomes.

This document explains what each part of the system does and what it gives the people and organisations that use it. For setup and technical details, see the [project README](../README.md).

---

## Who it is for

| User | What they need | What GrantSeeker gives them |
|---|---|---|
| **Researcher / applicant** | Find calls they can actually win, without searching dozens of funder sites | A short, ranked list of eligible calls with the reasons for each score, plus help drafting |
| **Grant officer** (research office) | See and steer their institution's applications | One pipeline of proposals with review, approval and budget steps |
| **Institution admin** | Govern who does what, and see the institution's funding picture | Members, roles, invite codes, access reviews and an audit trail |
| **Platform admin** | Keep the catalogue fresh and trustworthy | Harvester control, source management, health and audit verification |

---

## Modules and what they do

| Module | What it does | Benefit to the user |
|---|---|---|
| **Harvester (AI agents)** | Collects calls from Grants.gov, RSS feeds and funder web pages (read with Gemini) twice a day or on demand. It works out who can apply, closes calls that have ended and archives old ones. | The catalogue stays current without anyone searching by hand. |
| **Africa-first screening** | Lists a call only if it states an amount above $0 and is open to applicants in Africa (Africa-focused, worldwide or low- and middle-income countries). | No time wasted on US- or EU-only calls, or calls with no stated budget. |
| **Intelligence Dashboard** | Live figures: available funding pool, average award, deadlines due within 30 days, expired calls, the Africa-eligibility metric and harvester status. It updates the moment the agents change the data. | An accurate picture at a glance that never shows outdated or expired money. |
| **Grant Explorer** | Search and filter by category, funder, region and organisation type, in list, tile or details views. Calls are split into Active, Expired (ended up to 30 days ago) and Archived tabs. | Fast, focused browsing, with closed calls kept out of the way but still on record. |
| **Smart Profile & Matches** | Builds a structured profile from the sign-up form and uploaded CVs, proposals and organisation documents. Every extracted value is linked to the line it came from. Shows how complete the profile is and what to add. | Better matches with little typing, and a clear route to improving them. |
| **Fit scoring** | Checks eligibility gates (geography, applicant type, career stage, registration). It then weights thematic alignment 35%, track record 25%, capacity 15%, partnership 10%, deadline 10% and funder history 5%, citing evidence and listing gaps. | Users know *why* a call suits them and what to fix before applying. Every score can be explained. |
| **Call History** | Links repeat editions of a call (a new cycle, a new reference number, or a funder page updated in place) and summarises what changed: amount, deadline, eligibility, focus and wording. | Applicants learn from earlier cycles and spot changes that affect their eligibility or budget. |
| **AI Proposal Assistant** | For a chosen call it produces an eligibility review, a proposal outline, partner suggestions and a compliance check, and saves them with a checklist. | A strong first draft in minutes instead of days, aligned with the call's requirements. |
| **Export (Word / PDF)** | Exports a call with its AI assessment, drafts and checklist as an editable Word document or a PDF. | Easy to share with co-applicants, supervisors and review committees. |
| **My Saved Applications** | Tracks applications through draft, review, approved, submitted, awarded and rejected, with a timeline. | No lost applications or missed steps, and a personal success rate. |
| **Research Office** | Grant officers review, approve and submit their institution's proposals and manage budgets, members and invite codes. | A controlled workflow for institutional sign-off. |
| **Collaboration Hub** | Teams with members, shared calls and messages. The researcher directory shows only people who opted in, and never their email. | Consortium building and joint applications without exposing personal data. |
| **Notifications** | Alerts on strong new matches and on changes to a user's applications. | Users hear about opportunities and decisions without checking constantly. |
| **Administration and security** | Role-based access, row-level security, access reviews of privileged accounts, a tamper-evident audit log, rate limits and breached-password checks. | Institutions can trust the platform with staff data and proposal work. |

---

## Benefits for users

- **Less searching, more applying.** Calls come to the user already filtered for African eligibility and a stated budget, and already ranked against their profile.
- **Better-targeted applications.** Eligibility gates and evidence-based scores steer effort towards calls the user can realistically win, and away from ones they would be screened out of.
- **Fewer missed deadlines.** The 30-day critical-deadline view, the "archives in N days" countdowns and match alerts make it clear what needs attention now.
- **Faster, stronger drafts.** The assistant turns the call text and the user's profile into a structured outline and compliance check that the user can edit and export.
- **Learning across cycles.** Call History shows how a funder's priorities, budgets and eligibility rules shift from year to year.
- **Transparency.** Each score explains itself, each profile value shows where it came from, and the dashboard shows what was screened out and why.

## Impact on how people work

| Before | With GrantSeeker |
|---|---|
| Scanning funder websites and newsletters by hand | Agents harvest twice a day; a live dashboard shows what is new |
| Discovering late that a call excludes African applicants | Ineligible calls never reach the list |
| Guessing whether a call is a good fit | A score with evidence, gaps and an eligibility verdict |
| Starting each proposal from a blank page | An AI outline, eligibility review and compliance check to build on |
| Expired calls cluttering spreadsheets | Expired calls separated automatically, then archived after 30 days |
| Re-reading a repeated call from scratch | A "what changed" summary between editions |
| Proposals tracked in email threads | One pipeline with statuses, approvals, budgets and a timeline |

## Value for organisations

- **Visibility of the funding pipeline.** Research offices see every proposal, its status, budget and timeline in one place, and the success rate is tracked from real outcomes.
- **More, and better-chosen, submissions.** Staff spend their time on calls the institution is eligible for and well placed to win, which raises the return on proposal-writing effort.
- **Governance and compliance.** Internal review and approval come before submission, access is least-privilege with dormant-account reviews, and the audit log can be verified for tampering.
- **Institutional memory.** Profiles, drafts, call histories and outcomes stay in the system when staff move on.
- **Collaboration at scale.** Teams and the opt-in researcher directory make it easier to assemble consortia that larger international calls often require.
- **Data protection.** Row-level security keeps each organisation's proposals and members private; directory entries are opt-in and never show email addresses.

## What to measure

**Shown in GrantSeeker today**
- Open calls listed, split into Africa-focused and international, plus calls screened out by reason
- Funding pool and average award of listed calls
- Calls due within 30 days, and expired calls approaching the archive
- Strong matches and profile completeness for each user
- Application success rate (awarded ÷ decided)
- Harvest freshness (time since the last scan)

**Worth deriving from its data**
- Applications per stage and time from draft to submission
- Total value of submitted and awarded proposals
- Share of submissions that went to high-scoring (eligible) matches

---

## Current scope and limits

- **The catalogue is only as broad as its sources.** The built-in sources are US federal (Grants.gov), and only their foreign-eligible calls pass the Africa rule. Adding Africa-focused and international funders (for example Wellcome, Gates Grand Challenges, the African Academy of Sciences, IDRC and national research funds) is the biggest lever for growth.
- **AI features work best with a Gemini API key.** Without one, matching uses the local rule-based matcher and the assistant runs in a simulated mode.
- **Scores support decisions; they don't make them.** Applicants should still confirm eligibility against each funder's official call documents.

*See the [project README](../README.md) for architecture, setup, configuration and the API.*
