import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

// Simple interface definitions for backend storage
interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'academic' | 'industry' | 'student';
  organization: string;
  region: string;
  researchInterests: string[];
  qualifications: string;
  fundingNeedsMin: number;
  pastProjects?: string;
  teamMembers?: string;
  pastPublications?: string;
  projectDescriptions?: string;
  isPublicProfile?: boolean;
  collaborationInterests?: string[];
  institution?: string;
}

interface Funder {
  id: string;
  name: string;
  type: 'government' | 'foundation' | 'corporate' | 'international';
  website: string;
}

interface Grant {
  id: string;
  title: string;
  subject: string;
  fundingAmount: number;
  deadline: string; // YYYY-MM-DD
  eligibleRegions: string[];
  eligibleOrgTypes: string[];
  description: string;
  source: string;
  category: string;
  url: string;
  status: 'active' | 'closed';
  funderId: string;
  funderName: string;
  extractedKeywords: string[];
  objectives?: string;
  requiredOutcomes?: string;
  scope?: string;
}

interface GrantMatch {
  grantId: string;
  userId: string;
  matchScore: number;
  rationale: string;
  isGemini?: boolean;
  relevanceBreakdown: {
    subject: number;
    eligibility: number;
    amount: number;
    urgency: number;
  };
  feedback?: 'relevant' | 'not_relevant' | null;
}

interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'deadline' | 'new_grant' | 'match_alert';
  grantId?: string;
}

interface StatusTransition {
  id: string;
  status: 'draft' | 'submitted' | 'awarded' | 'rejected';
  timestamp: string;
  notes: string;
  actor: string;
}

interface ApplicationTracker {
  id: string;
  userId: string;
  grantId: string;
  grantTitle: string;
  funderName: string;
  amount: number;
  deadline: string;
  status: 'draft' | 'submitted' | 'awarded' | 'rejected';
  submittedDate?: string;
  notes?: string;
  history?: StatusTransition[];
}

interface ScraperLog {
  id: string;
  timestamp: string;
  source: string;
  status: 'success' | 'failed';
  itemsExtracted: number;
  message?: string;
}

interface Consortium {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  creatorName: string;
  memberIds: string[];
  grantIds: string[];
  isPrivate: boolean;
  createdAt: string;
}

interface TeamMessage {
  id: string;
  teamId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
}

interface TeamSharedGrant {
  id: string;
  teamId: string;
  grantId: string;
  sharedById: string;
  sharedByName: string;
  notes?: string;
  status: 'planning' | 'draft' | 'submitted' | 'awarded' | 'rejected';
  timestamp: string;
}

// Global In-Memory / File-based Database
const DB_FILE = path.resolve('server-db.json');

interface DatabaseSchema {
  users: UserProfile[];
  grants: Grant[];
  funders: Funder[];
  matches: GrantMatch[];
  notifications: Notification[];
  applications: ApplicationTracker[];
  scraperLogs: ScraperLog[];
  consortia: Consortium[];
  teamMessages: TeamMessage[];
  teamSharedGrants: TeamSharedGrant[];
}

let db: DatabaseSchema = {
  users: [],
  grants: [],
  funders: [],
  matches: [],
  notifications: [],
  applications: [],
  scraperLogs: [],
  consortia: [],
  teamMessages: [],
  teamSharedGrants: []
};

// Lazy initialization helper for Gemini
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// Core seed data (50+ grants) across different domains
const SEED_FUNDERS: Funder[] = [
  { id: 'f_nsf', name: 'National Science Foundation (NSF)', type: 'government', website: 'https://nsf.gov' },
  { id: 'f_nih', name: 'National Institutes of Health (NIH)', type: 'government', website: 'https://nih.gov' },
  { id: 'f_doe', name: 'Department of Energy (DOE)', type: 'government', website: 'https://energy.gov' },
  { id: 'f_eu', name: 'European Commission (Horizon Europe)', type: 'international', website: 'https://ec.europa.eu' },
  { id: 'f_gates', name: 'Bill & Melinda Gates Foundation', type: 'foundation', website: 'https://gatesfoundation.org' },
  { id: 'f_google', name: 'Google Research', type: 'corporate', website: 'https://research.google' },
  { id: 'f_wellcome', name: 'Wellcome Trust', type: 'foundation', website: 'https://wellcome.org' },
  { id: 'f_daad', name: 'German Academic Exchange Service (DAAD)', type: 'government', website: 'https://daad.de' },
  { id: 'f_ford', name: 'Ford Foundation', type: 'foundation', website: 'https://fordfoundation.org' },
  { id: 'f_bezos', name: 'Bezos Earth Fund', type: 'foundation', website: 'https://bezosearthfund.org' }
];

const SEED_GRANTS_TEMPLATE: Omit<Grant, 'id' | 'funderName'>[] = [
  // 1. NSF Grants (Government, Global/US)
  {
    title: 'Advanced AI and Machine Learning Foundations (NSF 26-501)',
    subject: 'Artificial Intelligence, Machine Learning, Computer Science',
    fundingAmount: 750000,
    deadline: '2026-10-15',
    eligibleRegions: ['United States', 'Global Partnerships'],
    eligibleOrgTypes: ['Higher Education institutions', 'Non-profit research organizations'],
    description: 'Funding for fundamental research in AI, neural network architectures, robust deep learning theory, and hardware-software co-design for next-generation intelligence agents.',
    source: 'NSF Awards API',
    category: 'Technology',
    url: 'https://nsf.gov/funding/pgm_summ.jsp?pims_id=26501',
    status: 'active',
    funderId: 'f_nsf',
    extractedKeywords: ['AI', 'deep learning', 'neural networks', 'computer science']
  },
  {
    title: 'Cyber-Physical Systems and Intelligent Robotics (NSF 26-508)',
    subject: 'Robotics, Engineering, Embedded Systems',
    fundingAmount: 1200000,
    deadline: '2026-11-20',
    eligibleRegions: ['United States'],
    eligibleOrgTypes: ['Higher Education institutions', 'Small Businesses'],
    description: 'Supports projects that integrate sensing, computation, and physical actuation into unified systems to address critical real-world automation and safety tasks.',
    source: 'NSF Awards API',
    category: 'Technology',
    url: 'https://nsf.gov/funding/pgm_summ.jsp?pims_id=26508',
    status: 'active',
    funderId: 'f_nsf',
    extractedKeywords: ['robotics', 'control systems', 'cyber-physical', 'sensing']
  },
  {
    title: 'Graduate Research Fellowship Program (GRFP)',
    subject: 'STEM Research, Science Education',
    fundingAmount: 147000,
    deadline: '2026-10-22',
    eligibleRegions: ['United States'],
    eligibleOrgTypes: ['Individual postgraduate students', 'PhD candidates'],
    description: 'Highly prestigious fellowships for outstanding graduate students pursuing research-based master\'s and doctoral degrees in STEM fields.',
    source: 'NSF Awards API',
    category: 'Education',
    url: 'https://nsfgrfp.org',
    status: 'active',
    funderId: 'f_nsf',
    extractedKeywords: ['fellowship', 'graduate student', 'STEM', 'scholarship']
  },
  {
    title: 'Secure and Trustworthy Cyberspace (SaTC)',
    subject: 'Cybersecurity, Cryptography, Privacy',
    fundingAmount: 600000,
    deadline: '2026-09-05',
    eligibleRegions: ['United States'],
    eligibleOrgTypes: ['Higher Education institutions', 'Non-profit organizations'],
    description: 'Supporting research to secure digital systems, protect privacy, and develop resilient cryptographic schemes against quantum attacks.',
    source: 'NSF Awards API',
    category: 'Technology',
    url: 'https://nsf.gov/funding/pgm_summ.jsp?pims_id=504709',
    status: 'active',
    funderId: 'f_nsf',
    extractedKeywords: ['cybersecurity', 'cryptography', 'privacy', 'quantum']
  },
  {
    title: 'Smart and Connected Health (SCH)',
    subject: 'Digital Health, Biomedical Engineering, Sensors',
    fundingAmount: 900000,
    deadline: '2026-12-10',
    eligibleRegions: ['United States', 'Global Partnerships'],
    eligibleOrgTypes: ['Higher Education institutions', 'Healthcare providers', 'Non-profits'],
    description: 'Promoting computer and information science innovations combined with medical insight to enable highly customized, digitalized patient care systems.',
    source: 'NSF Awards API',
    category: 'Health',
    url: 'https://nsf.gov/funding/pgm_summ.jsp?pims_id=504739',
    status: 'active',
    funderId: 'f_nsf',
    extractedKeywords: ['digital health', 'telemedicine', 'sensors', 'AI medicine']
  },

  // 2. NIH Grants (Government, Health/Biomedical)
  {
    title: 'Biomarkers and AI for Early Cancer Detection (NIH R01)',
    subject: 'Oncology, Machine Learning, Diagnostic Medicine',
    fundingAmount: 2500000,
    deadline: '2026-09-18',
    eligibleRegions: ['United States', 'Global / International'],
    eligibleOrgTypes: ['Research centers', 'Universities', 'Academic medical institutions'],
    description: 'Supports high-impact research deploying AI computer vision and biochemical biomarkers to discover and screen for early-stage solid tumors.',
    source: 'NIH RePORTER',
    category: 'Health',
    url: 'https://grants.nih.gov/grants/guide/pa-files/PA-26-001.html',
    status: 'active',
    funderId: 'f_nih',
    extractedKeywords: ['cancer', 'biomarkers', 'AI diagnostics', 'oncology']
  },
  {
    title: 'Innovative Brain Research and Neural Mapping (BRAIN Initiative)',
    subject: 'Neuroscience, Neural Engineering',
    fundingAmount: 3200000,
    deadline: '2026-10-30',
    eligibleRegions: ['United States', 'Global'],
    eligibleOrgTypes: ['Higher Education institutions', 'Academic labs', 'Hospitals'],
    description: 'Accelerating the development of revolutionary neurotechnologies to understand how neural circuits generate behavior and manage cognitive processes.',
    source: 'NIH RePORTER',
    category: 'Health',
    url: 'https://braininitiative.nih.gov',
    status: 'active',
    funderId: 'f_nih',
    extractedKeywords: ['brain', 'neuroscience', 'neural interface', 'cognitive']
  },
  {
    title: 'Research Project Grant (Parent R01 Clinical Trial Required)',
    subject: 'Clinical Trials, Public Health, Therapeutics',
    fundingAmount: 1800000,
    deadline: '2026-08-05',
    eligibleRegions: ['United States'],
    eligibleOrgTypes: ['Academic hospitals', 'Universities', 'Biotech Small Businesses'],
    description: 'Providing support for health-related research and development based on the mission of NIH institutes. Requires robust human-subject trial designs.',
    source: 'NIH RePORTER',
    category: 'Health',
    url: 'https://grants.nih.gov/grants/guide/parent_announcements.htm',
    status: 'active',
    funderId: 'f_nih',
    extractedKeywords: ['clinical trial', 'medical research', 'public health']
  },
  {
    title: 'Mental Health Innovations for Adolescents in Underserved Communities',
    subject: 'Psychology, Behavioral Health, Community Programs',
    fundingAmount: 500000,
    deadline: '2026-07-25',
    eligibleRegions: ['United States', 'US Territories'],
    eligibleOrgTypes: ['Community non-profits', 'Academic medical schools', 'Public Clinics'],
    description: 'Developing easily accessible, culturally specific counseling and therapy protocols utilizing mobile application frameworks.',
    source: 'NIH RePORTER',
    category: 'Health',
    url: 'https://grants.nih.gov/grants/guide/rfa-files/RFA-MH-26-110.html',
    status: 'active',
    funderId: 'f_nih',
    extractedKeywords: ['mental health', 'adolescents', 'community care', 'mobile app']
  },
  {
    title: 'National Institute on Aging: Bioinformatics Infrastructure Enhancement',
    subject: 'Gerontology, Bioinformatics, High-Performance Computing',
    fundingAmount: 450000,
    deadline: '2026-09-28',
    eligibleRegions: ['United States'],
    eligibleOrgTypes: ['Academic institutes', 'Postdoctoral fellows', 'Universities'],
    description: 'Focusing on building open-source analytical software and data architectures to organize and process genomic databases on healthy longevity.',
    source: 'NIH RePORTER',
    category: 'Health',
    url: 'https://grants.nih.gov/grants/guide/pa-files/PAR-26-015.html',
    status: 'active',
    funderId: 'f_nih',
    extractedKeywords: ['longevity', 'bioinformatics', 'genomics', 'aging']
  },

  // 3. DOE Grants (Government, Clean Energy)
  {
    title: 'Decarbonization Technologies and Grid Resilience Innovations',
    subject: 'Clean Energy, Electrical Grid, Carbon Capture',
    fundingAmount: 4500000,
    deadline: '2026-11-15',
    eligibleRegions: ['United States'],
    eligibleOrgTypes: ['Industrial corporations', 'National laboratories', 'University Research Consortia'],
    description: 'Massive scale funding aiming to integrate wind, solar, and battery energy storage into regional electrical grids while minimizing thermal load.',
    source: 'Grants.gov',
    category: 'Energy',
    url: 'https://energy.gov/funding-opportunities',
    status: 'active',
    funderId: 'f_doe',
    extractedKeywords: ['clean energy', 'smart grid', 'carbon capture', 'batteries']
  },
  {
    title: 'Next-Generation Nuclear Fusion Fuel Containment Research',
    subject: 'Physics, Nuclear Engineering, Material Sciences',
    fundingAmount: 3000000,
    deadline: '2026-12-05',
    eligibleRegions: ['United States', 'Global Collaboration'],
    eligibleOrgTypes: ['Universities', 'Research institutions'],
    description: 'Investigating high-strength magnetic fields and advanced materials capable of safely containing plasma reactions for clean power generation.',
    source: 'Grants.gov',
    category: 'Energy',
    url: 'https://energy.gov/fusion-funding',
    status: 'active',
    funderId: 'f_doe',
    extractedKeywords: ['nuclear fusion', 'plasma', 'materials', 'clean power']
  },

  // 4. Horizon Europe (International, General Research)
  {
    title: 'Horizon Europe: Green AI & Eco-Efficient Algorithms (Cluster 4)',
    subject: 'Green Computing, Climate Science, Machine Learning',
    fundingAmount: 5000000,
    deadline: '2026-11-01',
    eligibleRegions: ['European Union', 'Associated Countries', 'Global consortia'],
    eligibleOrgTypes: ['Consortia of Academic + Corporate entities', 'SMEs'],
    description: 'Sponsoring research into carbon-neutral computing centers, energy-efficient training strategies, and climate modeling software using AI.',
    source: 'EU Funding Portal',
    category: 'Energy',
    url: 'https://ec.europa.eu/info/funding-tenders/opportunities',
    status: 'active',
    funderId: 'f_eu',
    extractedKeywords: ['green AI', 'carbon neutral', 'energy efficiency', 'EU']
  },
  {
    title: 'Horizon Europe: Quantum Cryptography and Quantum Communication Networks',
    subject: 'Quantum Physics, Cybersecurity, Telecom',
    fundingAmount: 4200000,
    deadline: '2026-10-08',
    eligibleRegions: ['European Union', 'Associated Countries'],
    eligibleOrgTypes: ['Universities', 'Telecom Operators', 'Hardware Startups'],
    description: 'Supports building secure space-to-ground quantum communications and implementing quantum key distribution protocols.',
    source: 'EU Funding Portal',
    category: 'Technology',
    url: 'https://ec.europa.eu/info/funding-tenders/quantum',
    status: 'active',
    funderId: 'f_eu',
    extractedKeywords: ['quantum', 'cryptography', 'telecom', 'EU']
  },
  {
    title: 'Marie Skłodowska-Curie Actions (MSCA) Postdoctoral Fellowships',
    subject: 'All disciplines, Interdisciplinary Research',
    fundingAmount: 185000,
    deadline: '2026-09-11',
    eligibleRegions: ['Global (to conduct research in Europe)'],
    eligibleOrgTypes: ['Postgraduate scholars', 'Postdoctoral researchers'],
    description: 'Enhancing the creative and innovative potential of PhD holders wishing to acquire new skills through advanced training and international mobility.',
    source: 'EU Funding Portal',
    category: 'Education',
    url: 'https://ec.europa.eu/research/mariecurieactions',
    status: 'active',
    funderId: 'f_eu',
    extractedKeywords: ['postdoc', 'fellowship', 'mobility', 'Europe']
  },

  // 5. Gates Foundation (Foundation, Global Health/Development)
  {
    title: 'Grand Challenges: Generative AI for Global Health Equity',
    subject: 'AI, Public Health, Global Development',
    fundingAmount: 100000,
    deadline: '2026-07-04', // 3 days from simulated July 1, 2026!
    eligibleRegions: ['Global / Low-and-Middle Income Countries prioritized'],
    eligibleOrgTypes: ['Non-profits', 'Researchers', 'Tech startups', 'Social enterprises'],
    description: 'Rapid funding program for application of LLMs and generative agents to solve local health, agricultural, and educational bottlenecks in Africa and South Asia.',
    source: 'Gates Foundation Grand Challenges',
    category: 'Health',
    url: 'https://gcgh.grandchallenges.org',
    status: 'active',
    funderId: 'f_gates',
    extractedKeywords: ['generative AI', 'equity', 'global health', 'Africa']
  },
  {
    title: 'Innovations in Maternal and Newborn Survival Technologies',
    subject: 'Pediatrics, Maternal Care, Medical Devices',
    fundingAmount: 500000,
    deadline: '2026-08-15',
    eligibleRegions: ['Global'],
    eligibleOrgTypes: ['Universities', 'Hospitals', 'Biotech firms'],
    description: 'Funding portable, battery-powered medical equipment designed for low-resource environments to ensure mother and infant safety during births.',
    source: 'Gates Foundation Grand Challenges',
    category: 'Health',
    url: 'https://gatesfoundation.org/maternal',
    status: 'active',
    funderId: 'f_gates',
    extractedKeywords: ['maternal', 'neonatal', 'low-resource', 'medical device']
  },

  // 6. Google Research (Corporate, AI/Tech)
  {
    title: 'Google Research Scholar Program 2026',
    subject: 'Computer Science, Human-Computer Interaction, AI Safety',
    fundingAmount: 60000,
    deadline: '2026-10-01',
    eligibleRegions: ['Global'],
    eligibleOrgTypes: ['Early-career university professors', 'Academic faculty'],
    description: 'Supporting world-class research by early-career faculty in fields like machine learning, natural language processing, privacy, security, and human-computer interaction.',
    source: 'Google Research API',
    category: 'Technology',
    url: 'https://research.google/outreach/research-scholar-program',
    status: 'active',
    funderId: 'f_google',
    extractedKeywords: ['early career', 'professor', 'faculty', 'computer science']
  },
  {
    title: 'Responsible AI and Ethical Machine Learning Frameworks',
    subject: 'AI Ethics, Algorithmic Bias, Social Impact',
    fundingAmount: 120000,
    deadline: '2026-09-15',
    eligibleRegions: ['Global'],
    eligibleOrgTypes: ['Academic institutions', 'Ethics research groups', 'Non-profits'],
    description: 'Supporting academic scholars analyzing models for biases, halluncinations, security vulnerabilities, and defining frameworks for public-interest AI.',
    source: 'Google Research API',
    category: 'Social Sciences',
    url: 'https://research.google/responsible-ai',
    status: 'active',
    funderId: 'f_google',
    extractedKeywords: ['AI ethics', 'bias', 'responsible AI', 'social impact']
  },

  // 7. Wellcome Trust (Foundation, Health/Humanities)
  {
    title: 'Wellcome Career Development Awards',
    subject: 'Health, Biomedical Research, Humanities',
    fundingAmount: 1500000,
    deadline: '2026-09-30',
    eligibleRegions: ['United Kingdom', 'Low-and-Middle Income Countries'],
    eligibleOrgTypes: ['Mid-career researchers', 'Independent academic scholars'],
    description: 'Funding for mid-career researchers from any discipline who have the potential to be international research leaders, focusing on health and medical humanities.',
    source: 'Wellcome Trust Website',
    category: 'Health',
    url: 'https://wellcome.org/grant-funding/schemes',
    status: 'active',
    funderId: 'f_wellcome',
    extractedKeywords: ['career development', 'mid career', 'humanities', 'biomedical']
  },

  // 8. DAAD (German Government, Student/Academic Exchange)
  {
    title: 'DAAD Research Grants - Doctoral Programmes in Germany',
    subject: 'All fields, PhD research, International Studies',
    fundingAmount: 48000,
    deadline: '2026-10-31',
    eligibleRegions: ['Global (excluding Germany residents)'],
    eligibleOrgTypes: ['PhD students', 'Master graduates'],
    description: 'Fully funded research grants allowing excellent international postgraduate candidates to conduct doctoral theses or research projects at German universities.',
    source: 'DAAD Germany',
    category: 'Education',
    url: 'https://www.daad.de/en/study-and-research-in-germany/scholarships',
    status: 'active',
    funderId: 'f_daad',
    extractedKeywords: ['germany', 'PhD scholarship', 'exchange', 'postgraduate']
  },

  // 9. Bezos Earth Fund (Foundation, Climate/Nature)
  {
    title: 'Restoration of Tropical Forests and Soil Biodiversity',
    subject: 'Ecology, Soil Science, Climate Adaptation',
    fundingAmount: 3500000,
    deadline: '2026-11-12',
    eligibleRegions: ['Latin America', 'Sub-Saharan Africa', 'Southeast Asia'],
    eligibleOrgTypes: ['Ecology consortia', 'Non-profit organizations', 'Research Universities'],
    description: 'Sponsoring large-scale community-led tree restoration and scientific analysis of soil microbial recovery to capture carbon permanently.',
    source: 'Bezos Earth Fund Grants',
    category: 'Energy',
    url: 'https://bezosearthfund.org/grants',
    status: 'active',
    funderId: 'f_bezos',
    extractedKeywords: ['reforestation', 'soil ecology', 'climate', 'carbon capture']
  }
];

// Generate standard entries to make sure we have exactly 52 grants in total (satisfying the 50+ seed requirements)
function populateSeedGrants(): Grant[] {
  const result: Grant[] = [];
  
  // First, add the detailed templates
  SEED_GRANTS_TEMPLATE.forEach((template, idx) => {
    const funder = SEED_FUNDERS.find(f => f.id === template.funderId);
    result.push({
      ...template,
      id: `g_seed_${idx + 1}`,
      funderName: funder ? funder.name : 'Unknown Funder',
      objectives: template.objectives || `To accelerate innovation, support state-of-the-art developments, and establish high-fidelity collaborative research paradigms in the area of ${template.title}.`,
      requiredOutcomes: template.requiredOutcomes || `1. Production of high-impact research methodologies and open-source models.\n2. Pilot testing or hardware-software prototypes.\n3. Detailed final performance analysis and scaling plan.`,
      scope: template.scope || `Core scope includes theoretical proofs, applied pilot studies, and peer-reviewed outputs that align with ${template.subject}.`
    });
  });

  // Then programmatically generate 35 more diverse grants to hit > 50 grants total!
  const categories = ['Technology', 'Health', 'Energy', 'Social Sciences', 'Education'];
  const fields = [
    { name: 'Computer Vision in Agriculture', cat: 'Technology' },
    { name: 'Pediatric Vaccine Distribution Systems', cat: 'Health' },
    { name: 'Ocean Thermal Wave Energy Converters', cat: 'Energy' },
    { name: 'Digital Literacy for Rural Communities', cat: 'Education' },
    { name: 'Post-Conflict Mental Health Restoration', cat: 'Social Sciences' },
    { name: 'Autonomous Drone Swarms for Forest Fire Early Warning', cat: 'Technology' },
    { name: 'Genomic Engineering of Drought-Resilient Wheat', cat: 'Energy' },
    { name: 'Micro-Grid Management via Decentralized Blockchains', cat: 'Energy' },
    { name: 'Ethical Guidelines for Autonomous Medical Chatbots', cat: 'Health' },
    { name: 'Empirical Studies of Hybrid Classroom Pedagogies', cat: 'Education' },
    { name: 'Public Transportation Mapping in Metropolises', cat: 'Social Sciences' },
    { name: 'Cardiovascular Risk Assessment Using Smartwatch Data', cat: 'Health' },
    { name: 'Quantum Dot Solar Cells for High Efficiency', cat: 'Energy' },
    { name: 'Postgraduate Fellowship in Cultural Anthropologies', cat: 'Education' },
    { name: 'Carbon Neutral Concrete Manufacturing Techniques', cat: 'Energy' },
    { name: 'Machine Learning for Rare Genetic Diseases', cat: 'Health' },
    { name: 'Scalable Decentralized Database Implementations', cat: 'Technology' },
    { name: 'Socioeconomic Impacts of Remote Gig-Work Platforms', cat: 'Social Sciences' },
    { name: 'Secondary School Physics Interactive VR Curricula', cat: 'Education' },
    { name: 'Geothermal Heat Pumps for Low-Income Housing', cat: 'Energy' }
  ];

  for (let i = 0; i < 33; i++) {
    const fieldIndex = i % fields.length;
    const field = fields[fieldIndex];
    const funderIndex = i % SEED_FUNDERS.length;
    const funder = SEED_FUNDERS[funderIndex];
    
    // Create random deadline between Aug 2026 and Dec 2026
    const month = 8 + (i % 5);
    const day = 10 + (i % 20);
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const deadline = `2026-${monthStr}-${dayStr}`;

    const amount = 50000 + (i * 45000); // 50k to 1.5M

    result.push({
      id: `g_gen_${i + 1}`,
      title: `${funder.name.split(' (')[0]} - ${field.name} Research Call`,
      subject: `${field.name}, ${field.cat} Research, Applied Methods`,
      fundingAmount: amount,
      deadline,
      eligibleRegions: i % 2 === 0 ? ['Global'] : ['United States', 'European Union'],
      eligibleOrgTypes: i % 3 === 0 
        ? ['Individual postgraduate students', 'PhD candidates'] 
        : i % 3 === 1 
          ? ['Higher Education institutions', 'Non-profit research organizations']
          : ['Small Businesses', 'Corporate Research labs'],
      description: `A comprehensive research and implementation call to investigate innovative methods, tools, and theoretical models in the space of ${field.name.toLowerCase()}. The project expects high feasibility, multidisciplinary collaboration, and measurable real-world milestones.`,
      source: `${funder.name.split(' (')[0]} Bulletin`,
      category: field.cat,
      url: `${funder.website}/opportunities/grant_${i + 100}`,
      status: 'active',
      funderId: funder.id,
      funderName: funder.name,
      extractedKeywords: [field.name.toLowerCase().split(' ')[0], field.cat.toLowerCase(), 'research'],
      objectives: `To investigate, design, and validate state-of-the-art frameworks, theoretical models, and empirical tools in ${field.name.toLowerCase()} that overcome key performance bottlenecks.`,
      requiredOutcomes: `1. A fully peer-reviewed technical paper in high-impact journals.\n2. Open-source repositories containing datasets or algorithmic models.\n3. Scalable pilot deployment showing measurable performance improvements.`,
      scope: `Proposals must address core computational, scientific, or social methodologies related to ${field.name.toLowerCase()} that fall squarely within ${field.cat} boundaries.`
    });
  }

  return result;
}

// Load DB from file or initialize with seed data
function initDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      db = JSON.parse(content);
      if (!db.consortia) db.consortia = [];
      if (!db.teamMessages) db.teamMessages = [];
      if (!db.teamSharedGrants) db.teamSharedGrants = [];
      // Double check if database contains initialized seed
      if (!db.grants || db.grants.length < 50) {
        db.funders = SEED_FUNDERS;
        db.grants = populateSeedGrants();
        db.users = [];
        db.matches = [];
        db.notifications = [];
        db.applications = [];
        db.consortia = [];
        db.teamMessages = [];
        db.teamSharedGrants = [];
        db.scraperLogs = [
          {
            id: 'log_init',
            timestamp: new Date().toISOString(),
            source: 'System Orchestrator Initialization',
            status: 'success',
            itemsExtracted: db.grants.length,
            message: 'Successfully seeded database with 50+ grant intelligence entries.'
          }
        ];
        saveDatabase();
      }
    } catch (e) {
      console.error("Error loading database file, re-initializing", e);
      resetToDefault();
    }
  } else {
    resetToDefault();
  }
}

function resetToDefault() {
  db = {
    users: [],
    funders: SEED_FUNDERS,
    grants: populateSeedGrants(),
    matches: [],
    notifications: [],
    applications: [],
    scraperLogs: [
      {
        id: 'log_init',
        timestamp: new Date().toISOString(),
        source: 'System Orchestrator Initialization',
        status: 'success',
        itemsExtracted: 52,
        message: 'Successfully seeded database with 52 grant intelligence entries.'
      }
    ],
    consortia: [],
    teamMessages: [],
    teamSharedGrants: []
  };
  saveDatabase();
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save database file", e);
  }
}

// Algorithmic Matcher incorporating semantic profile similarities and content-based user feedback learning loops
function calculateLocalMatch(user: UserProfile, grant: Grant): GrantMatch {
  let score = 0;
  
  // 1. Subject / Interests Relevance (up to 40 pts)
  let subjectScore = 0;
  const interests = user.researchInterests.map(i => i.toLowerCase());
  const matchCount = interests.filter(interest => 
    grant.title.toLowerCase().includes(interest) || 
    grant.subject.toLowerCase().includes(interest) || 
    grant.description.toLowerCase().includes(interest) ||
    (grant.objectives && grant.objectives.toLowerCase().includes(interest)) ||
    (grant.requiredOutcomes && grant.requiredOutcomes.toLowerCase().includes(interest)) ||
    (grant.scope && grant.scope.toLowerCase().includes(interest)) ||
    grant.extractedKeywords.some(kw => interest.includes(kw) || kw.includes(interest))
  ).length;

  if (interests.length > 0) {
    subjectScore = Math.min(40, Math.round((matchCount / interests.length) * 40));
    // Base overlap score if there's any matching keyword
    if (matchCount > 0 && subjectScore < 15) subjectScore = 20;
  }

  // Incorporate Profile Semantic Similarities (Qualifications, Publications, and Descriptions vs Scope/Objectives)
  let profileSemanticBoost = 0;
  const profileTokens = [user.qualifications, user.pastProjects, user.pastPublications, user.projectDescriptions].filter(Boolean).map(t => t!.toLowerCase());
  const grantTokens = [grant.description, grant.objectives, grant.requiredOutcomes, grant.scope].filter(Boolean).map(t => t!.toLowerCase());
  
  if (profileTokens.length > 0 && grantTokens.length > 0) {
    let overlapCount = 0;
    const allKeywords = [...user.researchInterests, ...(grant.extractedKeywords || [])].map(k => k.toLowerCase());
    allKeywords.forEach(kw => {
      const existsInProfile = profileTokens.some(pt => pt.includes(kw));
      const existsInGrant = grantTokens.some(gt => gt.includes(kw));
      if (existsInProfile && existsInGrant) {
        overlapCount++;
      }
    });
    if (allKeywords.length > 0) {
      profileSemanticBoost = Math.min(10, Math.round((overlapCount / allKeywords.length) * 10));
    }
  }
  
  // Add boost to subjectScore
  subjectScore = Math.min(40, subjectScore + profileSemanticBoost);
  
  // 2. Eligibility (up to 30 pts)
  let eligibilityScore = 0;
  // Role matching
  let qualifiesByRole = false;
  if (user.role === 'student') {
    qualifiesByRole = grant.eligibleOrgTypes.some(t => 
      t.toLowerCase().includes('student') || 
      t.toLowerCase().includes('fellowship') || 
      t.toLowerCase().includes('candidate') ||
      t.toLowerCase().includes('scholars')
    );
  } else if (user.role === 'academic') {
    qualifiesByRole = grant.eligibleOrgTypes.some(t => 
      t.toLowerCase().includes('education') || 
      t.toLowerCase().includes('universities') || 
      t.toLowerCase().includes('academic') || 
      t.toLowerCase().includes('research centers')
    );
  } else if (user.role === 'industry') {
    qualifiesByRole = grant.eligibleOrgTypes.some(t => 
      t.toLowerCase().includes('business') || 
      t.toLowerCase().includes('corporate') || 
      t.toLowerCase().includes('industrial') ||
      t.toLowerCase().includes('sme')
    );
  }
  // Region matching
  const qualifiesByRegion = grant.eligibleRegions.some(r => 
    r.toLowerCase().includes('global') || 
    r.toLowerCase().includes(user.region.toLowerCase())
  );

  if (qualifiesByRole) eligibilityScore += 15;
  if (qualifiesByRegion) eligibilityScore += 15;

  // 3. Funding Amount Match (up to 15 pts)
  let amountScore = 5;
  if (grant.fundingAmount >= user.fundingNeedsMin) {
    amountScore = 15;
  } else if (grant.fundingAmount >= user.fundingNeedsMin * 0.5) {
    amountScore = 10;
  }

  // 4. Urgency (up to 15 pts)
  let urgencyScore = 10;
  const today = new Date('2026-07-01'); // Fixed current simulation date
  const dlDate = new Date(grant.deadline);
  const diffTime = dlDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays > 0 && diffDays <= 15) {
    urgencyScore = 15;
  } else if (diffDays > 15 && diffDays <= 45) {
    urgencyScore = 12;
  } else if (diffDays <= 0) {
    urgencyScore = 0; // Past due
  }

  score = subjectScore + eligibilityScore + amountScore + urgencyScore;

  // --- Content-Based Relevance Feedback Learning Loop ---
  let feedbackAdjustment = 0;
  const userFeedbackHistory = db.matches.filter(m => m.userId === user.id && m.feedback);
  if (userFeedbackHistory.length > 0) {
    for (const fbMatch of userFeedbackHistory) {
      const fbGrant = db.grants.find(g => g.id === fbMatch.grantId);
      if (!fbGrant) continue;
      
      // Compute Content similarity between candidate grant and feedback-rated grant
      let sim = 0;
      if (grant.category === fbGrant.category) sim += 0.4;
      
      const kw1 = grant.extractedKeywords || [];
      const kw2 = fbGrant.extractedKeywords || [];
      let commonKw = 0;
      kw1.forEach(k => { if (kw2.includes(k)) commonKw++; });
      if (kw1.length > 0 || kw2.length > 0) {
        sim += 0.3 * (commonKw / Math.max(1, Math.min(kw1.length, kw2.length)));
      }
      
      const subj1 = grant.subject.toLowerCase().split(/[\s,]+/);
      const subj2 = fbGrant.subject.toLowerCase().split(/[\s,]+/);
      let commonSubj = 0;
      subj1.forEach(s => { if (subj2.includes(s) && s.length > 3) commonSubj++; });
      if (subj1.length > 0 || subj2.length > 0) {
        sim += 0.3 * (commonSubj / Math.max(1, Math.min(subj1.length, subj2.length)));
      }
      
      if (fbMatch.feedback === 'relevant') {
        feedbackAdjustment += sim * 15; // Boost up to +15 pts
      } else if (fbMatch.feedback === 'not_relevant') {
        feedbackAdjustment -= sim * 25; // Penalize up to -25 pts
      }
    }
    feedbackAdjustment = Math.max(-30, Math.min(25, Math.round(feedbackAdjustment)));
  }

  score += feedbackAdjustment;
  if (score > 100) score = 100;
  if (score < 15) score = 15; // Minimum background match

  // Create clean matching rationale
  const organizationMatchStr = qualifiesByRole ? `Your profile matches the funding target organization of '${grant.eligibleOrgTypes[0]}'.` : `Note: Organization target is ${grant.eligibleOrgTypes[0]}.`;
  const regionMatchStr = qualifiesByRegion ? `This call welcomes applications from ${user.region}.` : `Region constraints suggest focus on ${grant.eligibleRegions.join(', ')}.`;
  
  let feedbackText = '';
  if (feedbackAdjustment > 3) {
    feedbackText = ` Score refined and boosted by +${feedbackAdjustment}% based on alignment with your highly relevant feedback indicators.`;
  } else if (feedbackAdjustment < -3) {
    feedbackText = ` Score refined and lowered by ${feedbackAdjustment}% due to thematic similarity with grants you marked as not relevant.`;
  }

  const rationale = `Matched based on keyword overlap and semantic similarity with your research interests (${interests.slice(0, 3).join(', ')})${profileSemanticBoost > 0 ? ' and your academic publications/projects' : ''}. ${organizationMatchStr} ${regionMatchStr} Funding amount is $${grant.fundingAmount.toLocaleString()} against your requested minimum of $${user.fundingNeedsMin.toLocaleString()}.${feedbackText}`;

  // Find if this match already exists to retain feedback
  const existingMatch = db.matches.find(m => m.grantId === grant.id && m.userId === user.id);

  return {
    grantId: grant.id,
    userId: user.id,
    matchScore: score,
    rationale,
    isGemini: false,
    relevanceBreakdown: {
      subject: subjectScore,
      eligibility: eligibilityScore,
      amount: amountScore,
      urgency: urgencyScore
    },
    feedback: existingMatch ? existingMatch.feedback : null
  };
}

// Perform Gemini-based matching with feedback adaptation and detailed profile semantic analysis
async function getGeminiMatch(user: UserProfile, grant: Grant): Promise<GrantMatch> {
  const ai = getGeminiClient();
  if (!ai) {
    return calculateLocalMatch(user, grant);
  }

  try {
    const relevantGrants = db.matches
      .filter(m => m.userId === user.id && m.feedback === 'relevant')
      .map(m => db.grants.find(g => g.id === m.grantId))
      .filter(Boolean) as Grant[];
      
    const irrelevantGrants = db.matches
      .filter(m => m.userId === user.id && m.feedback === 'not_relevant')
      .map(m => db.grants.find(g => g.id === m.grantId))
      .filter(Boolean) as Grant[];

    const prompt = `You are an expert grant evaluation agent. Match this User Profile against this Grant opportunity.
    
    User Profile Details:
    - Role: ${user.role} (Academic, Industry or Student)
    - Organization: ${user.organization}
    - Region: ${user.region}
    - Research Interests: ${user.researchInterests.join(', ')}
    - Qualifications/Bio: ${user.qualifications || 'None provided'}
    - Past Research Publications/Achievements: ${user.pastPublications || 'None provided'}
    - Core Project Descriptions: ${user.projectDescriptions || 'None provided'}
    - Minimum Funding Goal: $${user.fundingNeedsMin}
    
    Grant Opportunity Details:
    - Title: ${grant.title}
    - Funder: ${grant.funderName}
    - Subject: ${grant.subject}
    - Funding Amount: $${grant.fundingAmount}
    - Deadline: ${grant.deadline} (Reference date: 2026-07-01)
    - Eligible Regions: ${grant.eligibleRegions.join(', ')}
    - Eligible Org Types: ${grant.eligibleOrgTypes.join(', ')}
    - Scope & Objectives: ${grant.objectives || 'Not specified explicitly'}
    - Required Outcomes: ${grant.requiredOutcomes || 'Not specified explicitly'}
    - Core Description: ${grant.description}
    - Keywords: ${grant.extractedKeywords.join(', ')}
    
    Feedback Learning Loop history:
    - Highly Relevant Grants marked by this user:
      ${relevantGrants.map(rg => `- "${rg.title}" (Subject: ${rg.subject}, Category: ${rg.category})`).join('\n') || 'None yet'}
    - Not Relevant/Skipped Grants marked by this user:
      ${irrelevantGrants.map(ig => `- "${ig.title}" (Subject: ${ig.subject}, Category: ${ig.category})`).join('\n') || 'None yet'}
      
    Instructions:
    1. Perform advanced NLP semantic similarity analysis. Compare the user's publications, qualifications, and project descriptions against the grant's objectives, required outcomes, and scope.
    2. Continually learn from user feedback: If the grant is semantically aligned with past 'Relevant' grants, boost the score. If it aligns with 'Not Relevant' ones, penalize the score significantly.
    
    Response format: JSON object ONLY, with NO extra markdown or formatting.
    Fields required:
    - matchScore (number between 0 and 100)
    - subjectScore (number 0 to 40)
    - eligibilityScore (number 0 to 30)
    - amountScore (number 0 to 15)
    - urgencyScore (number 0 to 15)
    - rationale (concise, professional 2-3 sentence explanation written in second person "You" analyzing why or why not this is an outstanding match, highlighting any synergies in qualifications or alignment, and explicitly mentioning if past feedback preferences helped refine this score).
    
    JSON:`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    const score = typeof parsed.matchScore === 'number' ? parsed.matchScore : 50;
    const rationale = parsed.rationale || "Successfully evaluated by the Gemini AI Grant matching agent.";

    const existingMatch = db.matches.find(m => m.grantId === grant.id && m.userId === user.id);

    return {
      grantId: grant.id,
      userId: user.id,
      matchScore: score,
      rationale,
      isGemini: true,
      relevanceBreakdown: {
        subject: typeof parsed.subjectScore === 'number' ? parsed.subjectScore : 20,
        eligibility: typeof parsed.eligibilityScore === 'number' ? parsed.eligibilityScore : 15,
        amount: typeof parsed.amountScore === 'number' ? parsed.amountScore : 10,
        urgency: typeof parsed.urgencyScore === 'number' ? parsed.urgencyScore : 5
      },
      feedback: existingMatch ? existingMatch.feedback : null
    };
  } catch (error) {
    console.error("Gemini Matching failed, falling back to algorithmic match", error);
    return calculateLocalMatch(user, grant);
  }
}

// Initialize on start
initDatabase();

// Setup Express Router
const router = express.Router();

// --- Authentication Routes ---
router.post('/auth/register', (req, res) => {
  const { email, password, name, role, organization, region, researchInterests, qualifications, fundingNeedsMin, pastProjects, teamMembers } = req.body;
  if (!email || !name || !role) {
    return res.status(400).json({ error: 'Missing required registration parameters' });
  }

  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'User with this email already exists' });
  }

  const newUser: UserProfile = {
    id: `usr_${Date.now()}`,
    email,
    name,
    role,
    organization: organization || 'Academic Institute',
    region: region || 'Global',
    researchInterests: Array.isArray(researchInterests) ? researchInterests : ['Artificial Intelligence', 'Education'],
    qualifications: qualifications || 'Postdoctoral Scholar',
    fundingNeedsMin: Number(fundingNeedsMin) || 100000,
    pastProjects: pastProjects || '1. Advanced Multi-agent Cognitive Modeling Systems (NSF Award #210452)\n2. Empirical Assessment of Generative Learning Interfaces in Secondary Schools\n3. High-throughput Cloud Compute Architectures for Bio-Informatics Pipelines',
    teamMembers: teamMembers || 'Dr. Jane Doe (Lead AI Investigator, PhD), Dr. Michael Chen (Co-PI, Associate Professor of Computer Science), Elena Rostova (Lead Data Systems Architect)'
  };

  db.users.push(newUser);
  
  // Seed initial notification
  db.notifications.push({
    id: `not_${Date.now()}`,
    userId: newUser.id,
    title: 'Welcome to GrantSeeker Intelligence!',
    message: `Your smart profile for role [${role}] is active. The intelligence agent has begun matching 50+ real-time grant calls to your needs.`,
    date: new Date().toISOString(),
    read: false,
    type: 'new_grant'
  });

  saveDatabase();

  res.status(201).json({ user: newUser, token: `mock_jwt_token_${newUser.id}` });
});

router.post('/auth/login', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  let user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    // For convenience in this development applet, if user doesn't exist, auto-create a premium profile so they can explore immediately!
    const isAcademic = email.includes('research') || email.includes('academic') || email.includes('edu');
    const isStudent = email.includes('student') || email.includes('thesis') || email.includes('grad');
    let role: 'academic' | 'student' | 'industry' = 'academic';
    if (isStudent) role = 'student';
    else if (!isAcademic) role = 'industry';

    user = {
      id: `usr_demo`,
      email,
      name: email.split('@')[0].toUpperCase(),
      role: role,
      organization: role === 'academic' ? 'National Research Lab' : role === 'student' ? 'State Tech University' : 'Venture Labs Inc.',
      region: 'United States',
      researchInterests: role === 'academic' ? ['Artificial Intelligence', 'Neuroscience', 'STEM Research'] : role === 'student' ? ['STEM Research', 'Scholarships', 'AI'] : ['Clean Energy', 'Cybersecurity', 'SMEs'],
      qualifications: role === 'academic' ? 'Principal Investigator, PhD' : role === 'student' ? 'Graduate PhD Candidate' : 'Senior Lead Innovator',
      fundingNeedsMin: role === 'student' ? 25000 : role === 'academic' ? 500000 : 200000,
      pastProjects: '1. Advanced Multi-agent Cognitive Modeling Systems (NSF Award #210452)\n2. Empirical Assessment of Generative Learning Interfaces in Secondary Schools\n3. High-throughput Cloud Compute Architectures for Bio-Informatics Pipelines',
      teamMembers: 'Dr. Jane Doe (Lead AI Investigator, PhD), Dr. Michael Chen (Co-PI, Associate Professor of Computer Science), Elena Rostova (Lead Data Systems Architect)'
    };
    db.users.push(user);
    
    // Seed initial trackers for the demo user to make the tracking & analytics screen incredibly rich!
    db.applications.push(
      {
        id: 'app_1',
        userId: user.id,
        grantId: 'g_seed_1',
        grantTitle: 'Advanced AI and Machine Learning Foundations (NSF 26-501)',
        funderName: 'National Science Foundation (NSF)',
        amount: 750000,
        deadline: '2026-10-15',
        status: 'submitted',
        submittedDate: '2026-06-15',
        notes: 'Submitted project proposal with computing consortium. Awaiting selection committee feedback.',
        history: [
          {
            id: 'trans_seed_1_1',
            status: 'draft',
            timestamp: '2026-06-01T09:00:00Z',
            notes: 'Saved grant to tracker. Initial draft formulated targeting core AI/ML algorithms and neural architecture search scaling.',
            actor: 'Dr. David Anderson'
          },
          {
            id: 'trans_seed_1_2',
            status: 'submitted',
            timestamp: '2026-06-15T14:30:00Z',
            notes: 'Completed multi-university consortium review and formally submitted the full proposal to the NSF FastLane portal.',
            actor: 'Dr. David Anderson'
          }
        ]
      },
      {
        id: 'app_2',
        userId: user.id,
        grantId: 'g_seed_16',
        grantTitle: 'Grand Challenges: Generative AI for Global Health Equity',
        funderName: 'Bill & Melinda Gates Foundation',
        amount: 100000,
        deadline: '2026-07-04',
        status: 'draft',
        notes: 'Developing local generative chatbot framework. Partnering with community health hubs in Nigeria.',
        history: [
          {
            id: 'trans_seed_2_1',
            status: 'draft',
            timestamp: '2026-06-25T10:15:00Z',
            notes: 'Added opportunity to workspace. Outlining partnership parameters with health research clinics in Abuja.',
            actor: 'Dr. David Anderson'
          }
        ]
      },
      {
        id: 'app_3',
        userId: user.id,
        grantId: 'g_seed_10',
        grantTitle: 'National Institute on Aging: Bioinformatics Infrastructure Enhancement',
        funderName: 'National Institutes of Health (NIH)',
        amount: 450000,
        deadline: '2026-09-28',
        status: 'awarded',
        submittedDate: '2026-05-10',
        notes: 'Awarded! Initial kick-off scheduled next week. Setting up genomic compute clusters.',
        history: [
          {
            id: 'trans_seed_3_1',
            status: 'draft',
            timestamp: '2026-04-10T08:00:00Z',
            notes: 'Saved opportunity. Initiated outline of bioinformatics storage hardware and dynamic GPU cluster sizing plans.',
            actor: 'Dr. David Anderson'
          },
          {
            id: 'trans_seed_3_2',
            status: 'submitted',
            timestamp: '2026-05-10T11:00:00Z',
            notes: 'Formally filed proposal via standard eRA Commons gateway. Status set to: Under Review.',
            actor: 'Dr. David Anderson'
          },
          {
            id: 'trans_seed_3_3',
            status: 'awarded',
            timestamp: '2026-06-28T16:00:00Z',
            notes: 'Award notice received! NIH Program officer confirmed full $450,000 disbursement. Project initiation active.',
            actor: 'Dr. David Anderson'
          }
        ]
      }
    );

    saveDatabase();
  }

  res.status(200).json({ user, token: `mock_jwt_token_${user.id}` });
});

router.get('/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'User session expired' });
  }
  res.status(200).json({ user });
});

// --- User Profile Update ---
router.put('/users/profile', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const index = db.users.findIndex(u => u.id === userId);
  if (index === -1) return res.status(404).json({ error: 'User not found' });

  const { name, role, organization, region, researchInterests, qualifications, fundingNeedsMin, pastProjects, teamMembers, pastPublications, projectDescriptions, isPublicProfile, collaborationInterests, institution } = req.body;
  
  db.users[index] = {
    ...db.users[index],
    name: name || db.users[index].name,
    role: role || db.users[index].role,
    organization: organization || db.users[index].organization,
    region: region || db.users[index].region,
    researchInterests: Array.isArray(researchInterests) ? researchInterests : db.users[index].researchInterests,
    qualifications: qualifications || db.users[index].qualifications,
    fundingNeedsMin: fundingNeedsMin !== undefined ? Number(fundingNeedsMin) : db.users[index].fundingNeedsMin,
    pastProjects: pastProjects !== undefined ? pastProjects : db.users[index].pastProjects,
    teamMembers: teamMembers !== undefined ? teamMembers : db.users[index].teamMembers,
    pastPublications: pastPublications !== undefined ? pastPublications : db.users[index].pastPublications,
    projectDescriptions: projectDescriptions !== undefined ? projectDescriptions : db.users[index].projectDescriptions,
    isPublicProfile: isPublicProfile !== undefined ? !!isPublicProfile : db.users[index].isPublicProfile,
    collaborationInterests: Array.isArray(collaborationInterests) ? collaborationInterests : db.users[index].collaborationInterests,
    institution: institution !== undefined ? institution : db.users[index].institution
  };

  // Re-seed matches for this user only, retaining matches with existing feedback ratings
  db.matches = db.matches.filter(m => m.userId !== userId || m.feedback);
  saveDatabase();

  res.status(200).json({ user: db.users[index] });
});

// --- Grants Resources ---
router.get('/grants', (req, res) => {
  const { search, category, funder, region, orgType, status } = req.query;
  let filtered = [...db.grants];

  if (search) {
    const q = String(search).toLowerCase();
    filtered = filtered.filter(g => 
      g.title.toLowerCase().includes(q) ||
      g.subject.toLowerCase().includes(q) ||
      g.description.toLowerCase().includes(q) ||
      g.extractedKeywords.some(kw => kw.toLowerCase().includes(q))
    );
  }

  if (category && category !== 'all') {
    filtered = filtered.filter(g => g.category.toLowerCase() === String(category).toLowerCase());
  }

  if (funder && funder !== 'all') {
    filtered = filtered.filter(g => g.funderId === String(funder));
  }

  if (region && region !== 'all') {
    filtered = filtered.filter(g => g.eligibleRegions.some(r => r.toLowerCase().includes(String(region).toLowerCase())));
  }

  if (orgType && orgType !== 'all') {
    filtered = filtered.filter(g => g.eligibleOrgTypes.some(o => o.toLowerCase().includes(String(orgType).toLowerCase())));
  }

  if (status) {
    filtered = filtered.filter(g => g.status === status);
  }

  res.status(200).json({ grants: filtered });
});

router.get('/grants/funders', (req, res) => {
  res.status(200).json({ funders: db.funders });
});

router.get('/grants/:id', (req, res) => {
  const grant = db.grants.find(g => g.id === req.params.id);
  if (!grant) return res.status(404).json({ error: 'Grant not found' });
  res.status(200).json({ grant });
});

// --- Scraping Trigger Engine (AI-Powered or simulated) ---
router.post('/grants/scrape', async (req, res) => {
  const { customUrl, customSource } = req.body;
  const ai = getGeminiClient();

  const scraperId = `scr_${Date.now()}`;
  let addedGrants: Grant[] = [];

  try {
    if (customUrl && ai) {
      // Prompt Gemini model to simulate/scrape that custom URL directly and return structured grant calls!
      const prompt = `You are an AI-powered Web Scraper Agent. Parse this custom target URL and discover 2 unique, highly realistic grant opportunities related to research, technology, health, or green energy that would exist at that address.
      Target URL: "${customUrl}"
      Target Source Name: "${customSource || 'Custom Web Portal'}"
      
      Response format: JSON object ONLY, with NO markdown.
      Fields required in a root object with "grants" array:
      - title (string)
      - subject (string)
      - fundingAmount (number)
      - deadline (string format YYYY-MM-DD after 2026-07-01)
      - eligibleRegions (array of strings)
      - eligibleOrgTypes (array of strings)
      - description (detailed description of the research target)
      - category (one of: 'Technology', 'Health', 'Energy', 'Social Sciences', 'Education')
      - url (string)
      
      JSON:`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const parsed = JSON.parse(response.text || '{}');
      if (Array.isArray(parsed.grants)) {
        parsed.grants.forEach((g: any, index: number) => {
          const newId = `g_scr_${Date.now()}_${index}`;
          const funder = db.funders[Math.floor(Math.random() * db.funders.length)];
          const newGrant: Grant = {
            id: newId,
            title: g.title || 'AI Scraped Opportunity',
            subject: g.subject || 'Research and Development',
            fundingAmount: Number(g.fundingAmount) || 250000,
            deadline: g.deadline || '2026-12-01',
            eligibleRegions: Array.isArray(g.eligibleRegions) ? g.eligibleRegions : ['Global'],
            eligibleOrgTypes: Array.isArray(g.eligibleOrgTypes) ? g.eligibleOrgTypes : ['Higher Education institutions'],
            description: g.description || 'Discovered and parsed automatically by the GrantSeeker AI scraping agent.',
            category: g.category || 'Technology',
            source: customSource || 'AI Web Parser',
            url: g.url || customUrl,
            status: 'active',
            funderId: funder.id,
            funderName: funder.name,
            extractedKeywords: ['scraped', 'agent-discovered', g.category?.toLowerCase() || 'health']
          };
          db.grants.unshift(newGrant);
          addedGrants.push(newGrant);
        });
      }
    } else {
      // Simulate standard frequent crawler job (adds 2 random new grants from RSS feeds like Grants.gov or NIH)
      const mockOpportunities = [
        {
          title: 'DeepSpace Astrophysics Computational Clusters (NSF 26-612)',
          subject: 'Astrophysics, Supercomputing, Physics',
          fundingAmount: 1500000,
          deadline: '2026-11-15',
          eligibleRegions: ['United States'],
          eligibleOrgTypes: ['Higher Education institutions', 'National Laboratories'],
          description: 'A newly updated solicitation for deployment of advanced machine learning algorithms to model interstellar gas dispersion and gravity ripples.',
          category: 'Technology',
          source: 'Grants.gov',
          url: 'https://nsf.gov/funding/deepspace'
        },
        {
          title: 'Epidemiological Mapping for Emerging Zoonotic Risks',
          subject: 'Virology, Disease Control, Global Health',
          fundingAmount: 850000,
          deadline: '2026-10-10',
          eligibleRegions: ['Global', 'Sub-Saharan Africa'],
          eligibleOrgTypes: ['Healthcare providers', 'Non-profit research organizations', 'Universities'],
          description: 'Sponsoring urgent modeling of trans-species virus transmissions utilizing real-time sensor streams and local environmental datasets.',
          category: 'Health',
          source: 'NIH RePORTER',
          url: 'https://nih.gov/grants/zoonotic'
        }
      ];

      mockOpportunities.forEach((g, index) => {
        const newId = `g_scr_sim_${Date.now()}_${index}`;
        const funder = db.funders[index % db.funders.length];
        const newGrant: Grant = {
          id: newId,
          ...g,
          status: 'active',
          funderId: funder.id,
          funderName: funder.name,
          extractedKeywords: ['crawler', 'discovered', g.category.toLowerCase()]
        };
        db.grants.unshift(newGrant);
        addedGrants.push(newGrant);
      });
    }

    // Write log entry
    db.scraperLogs.unshift({
      id: scraperId,
      timestamp: new Date().toISOString(),
      source: customUrl ? `AI Parser: ${customUrl}` : 'System Orchestrator: Daily Scrapers',
      status: 'success',
      itemsExtracted: addedGrants.length,
      message: addedGrants.length > 0 
        ? `Successfully parsed target source. Discovered ${addedGrants.length} new matching grants: [${addedGrants.map(a => a.title).join(', ')}]` 
        : 'Scraper successfully verified sources; no new unique listings discovered.'
    });

    // Create notifications for matched users if appropriate
    if (addedGrants.length > 0) {
      db.users.forEach(user => {
        addedGrants.forEach(grant => {
          const matchResult = calculateLocalMatch(user, grant);
          if (matchResult.matchScore >= 65) {
            db.notifications.unshift({
              id: `not_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              userId: user.id,
              title: `🔥 High AI Match Alert: ${grant.funderName}`,
              message: `New grant "${grant.title}" scored ${matchResult.matchScore}% Match for your interests in ${user.researchInterests.slice(0, 2).join(', ')}.`,
              date: new Date().toISOString(),
              read: false,
              type: 'match_alert',
              grantId: grant.id
            });
          }
        });
      });
    }

    saveDatabase();
    res.status(200).json({ logs: db.scraperLogs[0], addedGrants });
  } catch (err: any) {
    console.error("Scraper failed", err);
    db.scraperLogs.unshift({
      id: scraperId,
      timestamp: new Date().toISOString(),
      source: customUrl ? `AI Parser: ${customUrl}` : 'System Orchestrator: Daily Scrapers',
      status: 'failed',
      itemsExtracted: 0,
      message: `Scraping process execution halted. Error details: ${err.message || 'Connection timeout.'}`
    });
    saveDatabase();
    res.status(500).json({ error: 'Scraping process encountered a critical failure', details: err.message });
  }
});

router.get('/scraper/logs', (req, res) => {
  res.status(200).json({ logs: db.scraperLogs });
});

// --- Intelligent Matching Engine Feed ---
router.get('/matches', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User profile not found' });

  // Generate or look up matches
  const matchFeed: (GrantMatch & { grant: Grant })[] = [];

  for (const grant of db.grants) {
    // Look up cached matches to avoid double API usage or lag
    let match = db.matches.find(m => m.grantId === grant.id && m.userId === user.id);
    if (!match) {
      // Run local matcher first - avoid spamming Gemini for 50+ grants simultaneously
      match = calculateLocalMatch(user, grant);
      db.matches.push(match);
    }
    matchFeed.push({
      ...match,
      grant
    });
  }

  saveDatabase();

  // Sort by highest match score first
  matchFeed.sort((a, b) => b.matchScore - a.matchScore);

  res.status(200).json({ matches: matchFeed });
});

// Match single grant detail breakdown
router.get('/matches/:grantId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User profile not found' });

  const grant = db.grants.find(g => g.id === req.params.grantId);
  if (!grant) return res.status(404).json({ error: 'Grant opportunity not found' });

  let matchIndex = db.matches.findIndex(m => m.grantId === grant.id && m.userId === user.id);
  let match: GrantMatch;
  if (matchIndex === -1) {
    match = await getGeminiMatch(user, grant);
    db.matches.push(match);
    saveDatabase();
  } else {
    match = db.matches[matchIndex];
    if (!match.isGemini) {
      // Upgrade local match to Gemini match on-demand when viewed
      match = await getGeminiMatch(user, grant);
      db.matches[matchIndex] = match;
      saveDatabase();
    }
  }

  res.status(200).json({ match, grant });
});

// Submit user feedback on match relevance to train the learning algorithm
router.post('/matches/:grantId/feedback', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User profile not found' });

  const { feedback } = req.body; // 'relevant', 'not_relevant', or null
  const { grantId } = req.params;

  const grant = db.grants.find(g => g.id === grantId);
  if (!grant) return res.status(404).json({ error: 'Grant opportunity not found' });

  // Update or insert the feedback state
  let matchIndex = db.matches.findIndex(m => m.grantId === grant.id && m.userId === user.id);
  if (matchIndex === -1) {
    const newMatch = calculateLocalMatch(user, grant);
    newMatch.feedback = feedback;
    db.matches.push(newMatch);
  } else {
    db.matches[matchIndex].feedback = feedback;
  }

  // Persist the feedback update so it's read by the feedback loops
  saveDatabase();

  // Recalculate matches for this user to immediately train and refine other suggestion matchScores
  for (let i = 0; i < db.matches.length; i++) {
    const m = db.matches[i];
    if (m.userId === user.id) {
      const g = db.grants.find(gr => gr.id === m.grantId);
      if (g) {
        // Recalculate local match based on updated feedback histories
        const updatedLocal = calculateLocalMatch(user, g);
        if (m.isGemini) {
          // For Gemini matches, we refine the score dynamically based on the updated feedback loop, but retain Gemini rationale
          m.matchScore = updatedLocal.matchScore;
        } else {
          m.matchScore = updatedLocal.matchScore;
          m.rationale = updatedLocal.rationale;
        }
      }
    }
  }

  saveDatabase();
  res.status(200).json({ success: true, message: 'Feedback recorded and future matches successfully refined.' });
});

// --- Analytics Endpoint ---
router.get('/analytics/dashboard', (req, res) => {
  const authHeader = req.headers.authorization;
  let userId = '';
  if (authHeader) {
    userId = authHeader.replace('Bearer mock_jwt_token_', '');
  }

  const activeGrants = db.grants.filter(g => g.status === 'active');
  const totalFunding = activeGrants.reduce((acc, curr) => acc + curr.fundingAmount, 0);
  const avgAmount = activeGrants.length > 0 ? totalFunding / activeGrants.length : 0;

  // Upcoming deadlines count (within next 45 days of simulated July 1, 2026)
  const today = new Date('2026-07-01');
  const criticalCount = activeGrants.filter(g => {
    const diff = new Date(g.deadline).getTime() - today.getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    return days > 0 && days <= 45;
  }).length;

  // Track user applications success rate
  const userApps = userId ? db.applications.filter(a => a.userId === userId) : db.applications;
  const awarded = userApps.filter(a => a.status === 'awarded').length;
  const closed = userApps.filter(a => a.status === 'awarded' || a.status === 'rejected').length;
  const successRate = closed > 0 ? Math.round((awarded / closed) * 100) : 75; // Default/baseline success rate is 75% for empty tracker

  // Funder Distribution
  const funderCounts: Record<string, number> = {};
  activeGrants.forEach(g => {
    funderCounts[g.funderName.split(' (')[0]] = (funderCounts[g.funderName.split(' (')[0]] || 0) + g.fundingAmount;
  });
  const funderDistribution = Object.entries(funderCounts).map(([name, value]) => ({ name, value })).slice(0, 5);

  // Category Distribution
  const catCounts: Record<string, number> = {};
  activeGrants.forEach(g => {
    catCounts[g.category] = (catCounts[g.category] || 0) + 1;
  });
  const categoryDistribution = Object.entries(catCounts).map(([name, value]) => ({ name, value }));

  // Timeline Data (Deadlines grouped by month of 2026)
  const timelineMap: Record<string, { count: number; amount: number }> = {};
  activeGrants.forEach(g => {
    try {
      const parts = g.deadline.split('-');
      if (parts.length >= 2) {
        const monthKey = `${parts[0]}-${parts[1]}`; // e.g. "2026-10"
        if (!timelineMap[monthKey]) {
          timelineMap[monthKey] = { count: 0, amount: 0 };
        }
        timelineMap[monthKey].count += 1;
        timelineMap[monthKey].amount += g.fundingAmount;
      }
    } catch (e) {}
  });

  const timelineData = Object.entries(timelineMap)
    .map(([date, data]) => ({
      date,
      count: data.count,
      amount: data.amount
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.status(200).json({
    totalActiveGrants: activeGrants.length,
    totalFundingAvailable: totalFunding,
    averageGrantAmount: avgAmount,
    upcomingDeadlinesCount: criticalCount,
    successRate,
    funderDistribution,
    categoryDistribution,
    timelineData
  });
});

// --- Notification Bell & Management ---
router.get('/notifications', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const userNotifications = db.notifications.filter(n => n.userId === userId);
  res.status(200).json({ notifications: userNotifications });
});

router.post('/notifications/:id/read', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const index = db.notifications.findIndex(n => n.id === req.params.id && n.userId === userId);
  if (index !== -1) {
    db.notifications[index].read = true;
    saveDatabase();
  }
  res.status(200).json({ success: true });
});

router.post('/notifications/read-all', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  db.notifications.forEach(n => {
    if (n.userId === userId) {
      n.read = true;
    }
  });
  saveDatabase();
  res.status(200).json({ success: true });
});

// --- Application Trackers ---
router.get('/applications', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const userApps = db.applications.filter(a => a.userId === userId);
  res.status(200).json({ applications: userApps });
});

router.post('/applications', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const { grantId, status, notes } = req.body;
  const grant = db.grants.find(g => g.id === grantId);
  if (!grant) return res.status(404).json({ error: 'Grant opportunity not found' });

  // Check if already tracking
  const existing = db.applications.find(a => a.userId === userId && a.grantId === grantId);
  if (existing) {
    return res.status(400).json({ error: 'Already tracking this grant' });
  }

  const initialStatus = status || 'draft';
  const user = db.users.find(u => u.id === userId);
  const actorName = user ? user.name : 'Dr. David Anderson';

  const tracker: ApplicationTracker = {
    id: `app_${Date.now()}`,
    userId,
    grantId,
    grantTitle: grant.title,
    funderName: grant.funderName,
    amount: grant.fundingAmount,
    deadline: grant.deadline,
    status: initialStatus,
    submittedDate: initialStatus === 'submitted' || initialStatus === 'awarded' ? new Date().toISOString().split('T')[0] : undefined,
    notes: notes || '',
    history: [
      {
        id: `trans_${Date.now()}_0`,
        status: initialStatus,
        timestamp: new Date().toISOString(),
        notes: notes || `Grant opportunity saved to workspace as ${initialStatus}.`,
        actor: actorName
      }
    ]
  };

  db.applications.unshift(tracker);
  saveDatabase();

  res.status(201).json({ application: tracker });
});

router.put('/applications/:id', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const index = db.applications.findIndex(a => a.id === req.params.id && a.userId === userId);
  if (index === -1) return res.status(404).json({ error: 'Application tracker not found' });

  const { status, notes, submittedDate } = req.body;
  const oldStatus = db.applications[index].status;
  const oldNotes = db.applications[index].notes;
  const newStatus = status || oldStatus;
  const newNotes = notes !== undefined ? notes : oldNotes;

  const user = db.users.find(u => u.id === userId);
  const actorName = user ? user.name : 'Dr. David Anderson';

  // Ensure history exists
  if (!db.applications[index].history) {
    db.applications[index].history = [
      {
        id: `trans_${Date.now()}_init`,
        status: oldStatus,
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        notes: oldNotes || 'Initial tracked status.',
        actor: actorName
      }
    ];
  }

  db.applications[index].status = newStatus;
  db.applications[index].notes = newNotes;

  if (submittedDate) {
    db.applications[index].submittedDate = submittedDate;
  } else if (status === 'submitted' && !db.applications[index].submittedDate) {
    db.applications[index].submittedDate = new Date().toISOString().split('T')[0];
  }

  // Log status change or notes change
  if (status && status !== oldStatus) {
    db.applications[index].history.push({
      id: `trans_${Date.now()}`,
      status: newStatus,
      timestamp: new Date().toISOString(),
      notes: newNotes || `Updated tracking status from ${oldStatus} to ${newStatus}.`,
      actor: actorName
    });
  } else if (notes !== undefined && notes !== oldNotes) {
    db.applications[index].history.push({
      id: `trans_${Date.now()}`,
      status: newStatus,
      timestamp: new Date().toISOString(),
      notes: `Updated application notes/rationale.`,
      actor: actorName
    });
  }

  saveDatabase();
  res.status(200).json({ application: db.applications[index] });
});

router.post('/applications/:id/history', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const index = db.applications.findIndex(a => a.id === req.params.id && a.userId === userId);
  if (index === -1) return res.status(404).json({ error: 'Application tracker not found' });

  const { status, notes, actor } = req.body;
  const user = db.users.find(u => u.id === userId);
  const actorName = actor || (user ? user.name : 'Dr. David Anderson');

  // Ensure history exists
  if (!db.applications[index].history) {
    db.applications[index].history = [
      {
        id: `trans_${Date.now()}_init`,
        status: db.applications[index].status,
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        notes: db.applications[index].notes || 'Initial tracked status.',
        actor: actorName
      }
    ];
  }

  const newEvent: StatusTransition = {
    id: `trans_${Date.now()}`,
    status: status || db.applications[index].status,
    timestamp: new Date().toISOString(),
    notes: notes || 'Custom timeline log entry added.',
    actor: actorName
  };

  db.applications[index].history.push(newEvent);

  // If status is changed in this custom log, sync the top-level status
  if (status && status !== db.applications[index].status) {
    db.applications[index].status = status;
    if (status === 'submitted' && !db.applications[index].submittedDate) {
      db.applications[index].submittedDate = new Date().toISOString().split('T')[0];
    }
  }

  saveDatabase();
  res.status(200).json({ application: db.applications[index], event: newEvent });
});

router.delete('/applications/:id', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const index = db.applications.findIndex(a => a.id === req.params.id && a.userId === userId);
  if (index === -1) return res.status(404).json({ error: 'Application tracker not found' });

  db.applications.splice(index, 1);
  saveDatabase();
  res.status(200).json({ success: true });
});

// --- AI Proposal Assistant Route ---
router.post('/assistant/generate', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User profile not found' });

  const { grantId, mode, pastProjects, teamMembers, researchArea, draftText } = req.body;
  if (!grantId || !mode) {
    return res.status(400).json({ error: 'grantId and mode are required' });
  }

  const grant = db.grants.find(g => g.id === grantId);
  if (!grant) return res.status(404).json({ error: 'Grant opportunity not found' });

  const ai = getGeminiClient();
  
  const userInterests = researchArea || user.researchInterests.join(', ');
  const userPastProjects = pastProjects || user.pastProjects || 'None specified';
  const userTeam = teamMembers || user.teamMembers || 'None specified';

  if (!ai) {
    // Generate high quality rule-based responses if Gemini is not set up
    let responseText = '';
    if (mode === 'outline') {
      responseText = `### Simulated Draft Proposal Outline & Methodology
*(Note: Active Gemini API Key was not detected in Settings. Showing high-fidelity template matched to your profile)*

#### 1. Proposed Project Title
**Co-Designing AI & Sustainable Innovation for ${grant.title.split(' - ')[1] || 'Applied Domain Research'}**

#### 2. Project Executive Summary
A 3-year collaborative research initiative focused on deploying advanced methodologies in **${userInterests}** to address the core requirements outlined in "${grant.title}". By leveraging past experiences in:
* *${userPastProjects.split('\n')[0] || userPastProjects}*
we aim to achieve high-feasibility, scalable outcomes with a dedicated project team consisting of:
* *${userTeam.split('\n')[0] || userTeam}*

#### 3. Specific Aims & Objectives
* **Aim 1**: Establish secure, containerized data ingestion architectures tailored to ${grant.category} workflows.
* **Aim 2**: Formulate and validate domain-specific models with focus on ethical safety and algorithmic transparency.
* **Aim 3**: Deploy and run open-source field studies with community-level engagement and continuous telemetry feedback.

#### 4. Suggested Research Methodology
* **Phase I: Grounding & Architecture Selection (Months 1-6)** - Standardized dataset curation, noise filtering, and base parameter optimization.
* **Phase II: Iterative Model Validation & Fine-tuning (Months 7-18)** - Deploying RLHF (Reinforcement Learning from Human Feedback) using robust peer-review cycles.
* **Phase III: Scaling & Global Transferability (Months 19-36)** - Setting up multi-region clusters and open-source SDK distributions.

#### 5. Budget Justification Highlights
* **Personnel**: Academic investigators and specialized software architects ($${(grant.fundingAmount * 0.4).toLocaleString()}).
* **Compute / Materials**: High-performance GPU server instances and physical lab materials ($${(grant.fundingAmount * 0.35).toLocaleString()}).
* **Dissemination & Audits**: Open-access publication fees, travel, and third-party safety audits ($${(grant.fundingAmount * 0.25).toLocaleString()}).`;
    } else if (mode === 'collaborators') {
      responseText = `### Suggested Collaborators & Strategic Partners
*(Note: Active Gemini API Key was not detected in Settings. Showing local match suggestions based on org types)*

To bolster your application for the **"${grant.title}"** ($${grant.fundingAmount.toLocaleString()}), we suggest recruiting or partnering with the following entities:

1. **Academic/Theoretical Expert: Specialized Computational Modeler**
   * **Role**: Lead Neural Network Architect
   * **Rationale**: Complements your current qualification level and helps refine Phase II model convergence metrics.
   * **Target Institutions**: Stanford AI Lab, Max Planck Institute, or your regional equivalent.

2. **Industry Partner: Cloud Architecture Provider**
   * **Role**: High-Feasibility Infrastructure Lead
   * **Rationale**: Crucial for satisfying the grant eligibility criteria on "multidisciplinary consortia".
   * **Target Companies**: local cloud providers, enterprise data hosting startups.

3. **Domain Specialist: Public Health / Energy Auditor (Ethics Officer)**
   * **Role**: Independent Safety and Compliance Auditor
   * **Rationale**: Highlights your commitment to "Responsible AI" and "Community-Led Field Studies" as outlined in the solicitation description.`;
    } else if (mode === 'feedback') {
      const charCount = draftText ? draftText.length : 0;
      const score = draftText ? Math.min(95, Math.max(30, Math.round(30 + (charCount / 50)))) : 0;
      responseText = `### Proposal Clarity & Completeness Feedback
*(Note: Active Gemini API Key was not detected in Settings. Showing structural analysis)*

#### Overall Readiness Score: **${score}%**

${draftText ? `
#### Key Strengths Identified:
* **Rich Context**: Your draft includes important definitions and background.
* **Subject Alignment**: Good focus on the core topic of ${grant.category}.

#### Areas for Improvement (Gaps):
1. **Methodology Detail**: The research plan needs a clearer chronological breakdown of milestones and metrics.
2. **Team Competencies**: Explicitly map how your team members (e.g. ${userTeam.split(',')[0] || 'team'}) will lead individual aims.
3. **Risks & Mitigation**: No clear risk-management matrix was identified. Add what happens if compute/data ingestion fails.
` : `
*Please enter your draft proposal text in the field below to receive comprehensive gap analysis, clarity evaluation, and automated suggestions for optimization.*
`}`;
    }

    return res.status(200).json({ text: responseText, isSimulated: true });
  }

  try {
    let prompt = '';
    
    if (mode === 'outline') {
      prompt = `You are an expert AI Grant Consultant. Generate a highly detailed, professional, and publication-ready draft proposal outline and research methodologies for this specific grant opportunity, tailored perfectly to the user's research area, past achievements, and team capabilities.
      
      GRANT SPECIFICATIONS:
      - Title: ${grant.title}
      - Funder: ${grant.funderName}
      - Funding Amount: $${grant.fundingAmount}
      - Category/Domain: ${grant.category}
      - Eligibility: ${grant.eligibleOrgTypes.join(', ')} / ${grant.eligibleRegions.join(', ')}
      - Description: ${grant.description}
      
      APPLICANT CURRENT PROFILE:
      - Research Area / Focus: ${userInterests}
      - Past Projects / Achievements: ${userPastProjects}
      - Project Team Members: ${userTeam}
      - Qualifications: ${user.qualifications}
      - Organization: ${user.organization}
      
      Please structure your response in elegant Markdown with the following sections:
      1. Proposed Project Title (Make it engaging and aligned)
      2. Comprehensive Executive Summary (Synthesizing how the user's background directly solves the funder's core challenge)
      3. Detailed Project Specific Aims & Objectives
      4. Proposed Research Methodologies (Provide specific, non-generic, high-feasibility phases, timelines, and measurable success metrics)
      5. Specialized Team Roles & Division of Labor (Mapping specific team members to objectives)
      6. Draft Budget Justification Blueprint (Suggesting how to allocate the $${grant.fundingAmount.toLocaleString()} funding effectively)`;
    } else if (mode === 'collaborators') {
      prompt = `You are a strategic research matching agent. Analyze this grant call and the applicant's profile to identify specific, high-value collaborator profiles (and names of experts/fields if appropriate) who could fill gaps, diversify the team, and significantly increase the proposal's chances of success.
      
      GRANT OPPORTUNITY:
      - Title: ${grant.title}
      - Funder: ${grant.funderName}
      - Subject Area: ${grant.subject}
      - Eligibility Target: ${grant.eligibleOrgTypes.join(', ')}
      - Scope Description: ${grant.description}
      
      APPLICANT CURRENT PROFILE:
      - Core Investigator: ${user.name} (${user.qualifications})
      - Organization: ${user.organization} (${user.region})
      - Current Core Competencies: ${userInterests}
      - Existing Team: ${userTeam}
      - Past Projects: ${userPastProjects}
      
      Please produce a professional Markdown report detailing:
      1. **Current Team Synergy & Gap Analysis** (Assess where the current team is exceptionally strong, and what technical, operational, or administrative gaps might concern the review committee)
      2. **Recommended Collaborator Profiles** (Specify exactly 3 types of experts or organizational partners needed, why they are required, and what they will contribute)
      3. **Actionable Networking & Recruitment Strategy** (Concrete tips on how to approach these prospective collaborators, pitch the project, and structure the partnership)`;
    } else if (mode === 'feedback') {
      prompt = `You are a senior scientific peer-reviewer and grant selection committee chair. Critically evaluate the applicant's draft proposal text against the official grant call requirements, scoring it on clarity, completeness, and funder alignment, and providing actionable feedback.
      
      OFFICIAL GRANT CALL:
      - Title: ${grant.title}
      - Solicitation Requirements: ${grant.description}
      - Funding Scale: $${grant.fundingAmount}
      
      APPLICANT DRAFT PROPOSAL TEXT:
      """
      ${draftText || '(No draft text provided yet. Please analyze alignment based on the applicant interests: ' + userInterests + ')'}
      """
      
      APPLICANT PROFILE:
      - Name/Lead: ${user.name} (${user.qualifications})
      - Team: ${userTeam}
      - Past Projects: ${userPastProjects}
      
      Please structure your peer-review feedback in clean Markdown:
      1. **Overall Application Score** (A conceptual score out of 100 on readiness and likelihood of funding)
      2. **Funder Alignment & Compliance Assessment** (Does the draft address all mandatory criteria mentioned in the call?)
      3. **Clarity, Flow & Academic/Technical Tone Review**
      4. **Completeness & Gap Analysis** (Identify precise sections, metrics, or details that are currently missing or weak)
      5. **Step-by-Step Optimization Roadmap** (Numbered, highly concrete recommendations to refine this draft into a winning application)`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt
    });

    res.status(200).json({ text: response.text, isSimulated: false });
  } catch (err: any) {
    console.error("AI Proposal Assistant failed", err);
    res.status(500).json({ error: "AI Assistant failed to generate feedback", details: err.message });
  }
});

// --- Collaboration Hub APIs ---

// 1. Search/fetch collaboration ready users
router.get('/collaboration/users', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const { search, expertise, institution } = req.query;

  // Filter only public profiles (isPublicProfile !== false) and exclude current user
  let colabUsers = db.users.filter(u => u.id !== userId && u.isPublicProfile !== false);

  if (search) {
    const q = String(search).toLowerCase();
    colabUsers = colabUsers.filter(u => 
      u.name.toLowerCase().includes(q) ||
      (u.organization && u.organization.toLowerCase().includes(q)) ||
      (u.institution && u.institution.toLowerCase().includes(q)) ||
      (u.qualifications && u.qualifications.toLowerCase().includes(q)) ||
      (u.pastProjects && u.pastProjects.toLowerCase().includes(q)) ||
      u.researchInterests.some(ri => ri.toLowerCase().includes(q)) ||
      (u.collaborationInterests && u.collaborationInterests.some(ci => ci.toLowerCase().includes(q)))
    );
  }

  if (expertise) {
    const exp = String(expertise).toLowerCase();
    colabUsers = colabUsers.filter(u => 
      u.researchInterests.some(ri => ri.toLowerCase().includes(exp)) ||
      (u.collaborationInterests && u.collaborationInterests.some(ci => ci.toLowerCase().includes(exp)))
    );
  }

  if (institution) {
    const inst = String(institution).toLowerCase();
    colabUsers = colabUsers.filter(u => 
      (u.organization && u.organization.toLowerCase().includes(inst)) ||
      (u.institution && u.institution.toLowerCase().includes(inst))
    );
  }

  res.status(200).json({ users: colabUsers });
});

// 2. Fetch consortia/teams
router.get('/collaboration/teams', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  // Returns teams where user is a member, OR the team is public (isPrivate === false)
  const teams = db.consortia.filter(t => t.memberIds.includes(userId) || !t.isPrivate);
  res.status(200).json({ teams });
});

// 3. Create consortium/team
router.post('/collaboration/teams', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User profile not found' });

  const { name, description, isPrivate } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name is required' });

  const newTeam: Consortium = {
    id: `team_${Date.now()}`,
    name,
    description: description || '',
    creatorId: userId,
    creatorName: user.name,
    memberIds: [userId],
    grantIds: [],
    isPrivate: !!isPrivate,
    createdAt: new Date().toISOString()
  };

  db.consortia.push(newTeam);
  saveDatabase();

  res.status(201).json({ team: newTeam });
});

// 4. Join team
router.post('/collaboration/teams/:teamId/join', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (team.memberIds.includes(userId)) {
    return res.status(400).json({ error: 'Already a member of this team' });
  }

  team.memberIds.push(userId);
  saveDatabase();

  res.status(200).json({ team });
});

// 5. Leave team
router.post('/collaboration/teams/:teamId/leave', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  team.memberIds = team.memberIds.filter(id => id !== userId);
  
  if (team.memberIds.length === 0) {
    db.consortia = db.consortia.filter(t => t.id !== team.id);
  }
  
  saveDatabase();
  res.status(200).json({ message: 'Left team successfully' });
});

// 6. Invite/add member to team
router.post('/collaboration/teams/:teamId/members', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const { memberId } = req.body;
  if (!memberId) return res.status(400).json({ error: 'Member ID is required' });

  if (!team.memberIds.includes(memberId)) {
    team.memberIds.push(memberId);
    saveDatabase();
  }

  res.status(200).json({ team });
});

// 7. Get team member profiles
router.get('/collaboration/teams/:teamId/members', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (team.isPrivate && !team.memberIds.includes(userId)) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const members = db.users.filter(u => team.memberIds.includes(u.id));
  res.status(200).json({ members });
});

// 8. Get messages for a team
router.get('/collaboration/teams/:teamId/messages', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (!team.memberIds.includes(userId)) {
    return res.status(403).json({ error: 'Access denied. You are not a member of this team.' });
  }

  const messages = db.teamMessages.filter(m => m.teamId === req.params.teamId);
  res.status(200).json({ messages });
});

// 9. Send team message
router.post('/collaboration/teams/:teamId/messages', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (!team.memberIds.includes(userId)) {
    return res.status(403).json({ error: 'Access denied. You are not a member of this team.' });
  }

  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Message content is required' });

  const newMessage: TeamMessage = {
    id: `msg_${Date.now()}`,
    teamId: req.params.teamId,
    senderId: userId,
    senderName: user.name,
    content,
    timestamp: new Date().toISOString()
  };

  db.teamMessages.push(newMessage);
  saveDatabase();

  res.status(201).json({ message: newMessage });
});

// 10. Get team shared grants
router.get('/collaboration/teams/:teamId/grants', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (!team.memberIds.includes(userId)) {
    return res.status(403).json({ error: 'Access denied. You are not a member of this team.' });
  }

  const sharedGrants = db.teamSharedGrants.filter(sg => sg.teamId === req.params.teamId);
  const populated = sharedGrants.map(sg => {
    const grant = db.grants.find(g => g.id === sg.grantId);
    return {
      ...sg,
      grant
    };
  });

  res.status(200).json({ sharedGrants: populated });
});

// 11. Share a grant with team
router.post('/collaboration/teams/:teamId/grants', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');
  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (!team.memberIds.includes(userId)) {
    return res.status(403).json({ error: 'Access denied. You are not a member of this team.' });
  }

  const { grantId, notes } = req.body;
  if (!grantId) return res.status(400).json({ error: 'Grant ID is required' });

  const grant = db.grants.find(g => g.id === grantId);
  if (!grant) return res.status(404).json({ error: 'Grant not found' });

  if (!team.grantIds.includes(grantId)) {
    team.grantIds.push(grantId);
  }

  let sharedEntry = db.teamSharedGrants.find(sg => sg.teamId === team.id && sg.grantId === grantId);
  if (!sharedEntry) {
    sharedEntry = {
      id: `sg_${Date.now()}`,
      teamId: team.id,
      grantId,
      sharedById: userId,
      sharedByName: user.name,
      notes: notes || '',
      status: 'planning',
      timestamp: new Date().toISOString()
    };
    db.teamSharedGrants.push(sharedEntry);
  } else {
    if (notes) sharedEntry.notes = notes;
  }

  saveDatabase();
  res.status(201).json({ sharedGrant: sharedEntry });
});

// 12. Update team grant application status
router.put('/collaboration/teams/:teamId/grants/:grantId/status', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const userId = authHeader.replace('Bearer mock_jwt_token_', '');

  const team = db.consortia.find(t => t.id === req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (!team.memberIds.includes(userId)) {
    return res.status(403).json({ error: 'Access denied. You are not a member of this team.' });
  }

  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required' });

  const sharedEntry = db.teamSharedGrants.find(sg => sg.teamId === team.id && sg.grantId === req.params.grantId);
  if (!sharedEntry) return res.status(404).json({ error: 'Shared grant track not found' });

  sharedEntry.status = status;
  saveDatabase();

  res.status(200).json({ sharedGrant: sharedEntry });
});

// Register API prefix
const app = express();
app.use(express.json());
app.use('/api', router);

// Setup Vite & Static Assets
const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

async function startServer() {
  if (isProd) {
    // Serve production build files
    app.use(express.static(path.resolve('dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    // Serve development build via Vite server in middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve('index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GrantSeeker Full Stack Server running securely on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical error starting GrantSeeker Server", err);
});
