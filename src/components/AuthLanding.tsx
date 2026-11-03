import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  CalendarClock,
  Eye,
  EyeOff,
  FileCheck2,
  KeyRound,
  Loader2,
  MailCheck,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { api, ApiError } from '../api';
import type { UserProfile } from '../types';

// The signed-out landing page: what GrantSeeker does on the left, sign-in
// and registration on the right. Reuses the app's blue-600 brand, gray
// neutrals, 12px (rounded-xl) cards and the same form controls.

const PASSWORD_MIN_LENGTH = 12;
const SLIDE_MS = 5_000;

interface Props {
  onSignedIn: (user: UserProfile, info: { created: boolean }) => void;
}

const errorText = (err: unknown, fallback = 'Could not reach the server. Try again.') =>
  err instanceof ApiError ? err.message : fallback;

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/* Hero cards: dashboard snippets                                      */
/* ------------------------------------------------------------------ */

const cardShell = 'h-full bg-white rounded-xl border border-gray-200 shadow-[0_8px_30px_-12px_rgba(30,64,175,0.25)] p-5 flex flex-col';
const caption = 'text-[10px] font-bold uppercase tracking-wider text-gray-500';

function MatchedCard() {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const pct = 0.87;
  const rows = [
    ['Wellcome Trust · Malaria vector control', 94],
    ['IDRC · Climate-resilient agriculture', 88],
    ['Gates Foundation · Maternal health data', 82],
  ] as const;
  return (
    <div className={cardShell}>
      <p className={caption}>Smart matches</p>
      <div className="mt-2 flex items-center gap-4">
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true" className="shrink-0 -rotate-90">
          <circle cx="42" cy="42" r={r} fill="none" stroke="#E5E7EB" strokeWidth="8" />
          <circle
            cx="42" cy="42" r={r} fill="none" stroke="url(#gs-ring)" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} className="gs-draw"
            style={{ ['--gs-dash' as string]: circ, ['--gs-dash-end' as string]: circ * (1 - pct) }}
          />
          <defs>
            <linearGradient id="gs-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#2563EB" />
              <stop offset="1" stopColor="#059669" />
            </linearGradient>
          </defs>
        </svg>
        <div>
          <p className="text-2xl font-extrabold text-gray-900 leading-tight">126 calls matched</p>
          <p className="text-xs text-gray-600 mt-0.5"><span className="font-bold text-emerald-700">87</span> average fit, top 10</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {rows.map(([name, score]) => (
          <li key={name} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-gray-700">{name}</span>
            <span className="shrink-0 font-bold text-white bg-emerald-600 rounded-md px-1.5 py-0.5">{score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeadlineCard() {
  const marks = [
    { days: 9, label: 'NRF Kenya', at: 18, urgent: true },
    { days: 23, label: 'Horizon Europe', at: 46 },
    { days: 41, label: 'AfDB Youth', at: 82 },
  ];
  return (
    <div className={cardShell}>
      <p className={caption}>Deadline alerts</p>
      <p className="mt-2 text-2xl font-extrabold text-gray-900 leading-tight">Next deadline: 9 days</p>
      <p className="text-xs text-gray-600 mt-0.5">NRF Kenya Multidisciplinary Research Grant</p>
      <div className="mt-6 relative h-16" aria-hidden="true">
        <div className="absolute left-0 right-0 top-3 h-1.5 rounded-full bg-gray-100" />
        <div className="absolute left-0 top-3 h-1.5 rounded-full bg-gradient-to-r from-blue-600 to-blue-400" style={{ width: '18%' }} />
        <div className="absolute top-1 left-0 flex flex-col items-start">
          <span className="w-5 h-5 rounded-full bg-blue-600 ring-4 ring-blue-100" />
          <span className="mt-1.5 text-[10px] font-bold text-blue-700">Today</span>
        </div>
        {marks.map((m) => (
          <div key={m.label} className="absolute top-1.5 flex flex-col items-center -translate-x-1/2" style={{ left: `${m.at}%` }}>
            <span className={`w-4 h-4 rounded-full border-2 bg-white ${m.urgent ? 'border-red-500' : 'border-gray-400'}`} />
            <span className={`mt-1.5 text-[10px] font-bold whitespace-nowrap ${m.urgent ? 'text-red-600' : 'text-gray-600'}`}>{m.days}d</span>
            <span className="text-[10px] text-gray-500 whitespace-nowrap">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineCard() {
  const points = [8, 11, 10, 15, 18, 17, 24, 29, 31, 38, 44, 48];
  const w = 240;
  const h = 56;
  const max = 50;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`).join(' ');
  const len = 320;
  return (
    <div className={cardShell}>
      <p className={caption}>Application pipeline</p>
      <p className="mt-2 text-2xl font-extrabold text-gray-900 leading-tight">KES 48M pipeline tracked</p>
      <p className="text-xs text-gray-600 mt-0.5"><span className="font-bold text-emerald-700">+KES 4M</span> this month</p>
      <svg viewBox={`0 0 ${w} ${h + 4}`} className="mt-3 w-full h-14" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="gs-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2563EB" stopOpacity="0.25" />
            <stop offset="1" stopColor="#2563EB" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L${w},${h + 4} L0,${h + 4} Z`} fill="url(#gs-spark)" />
        <path d={path} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={0} className="gs-draw" style={{ ['--gs-dash' as string]: len }} vectorEffect="non-scaling-stroke" />
      </svg>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[['Drafting', '7'], ['Submitted', '5'], ['Awarded', 'KES 12M']].map(([k, v]) => (
          <div key={k} className="bg-gray-50 rounded-lg py-1.5">
            <dt className="text-[10px] text-gray-500">{k}</dt>
            <dd className="text-xs font-bold text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const SLIDES = [
  { label: 'Smart matches', Card: MatchedCard },
  { label: 'Deadline alerts', Card: DeadlineCard },
  { label: 'Application pipeline', Card: PipelineCard },
];

function HeroCarousel() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const swipeStart = useRef<number | null>(null);
  const regionId = useId();

  // Reduced motion: never moves on its own.
  const paused = hovering || focused || stopped || reduced;
  const go = useCallback((i: number) => setIndex((i + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => go(index + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, paused, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What GrantSeeker shows you"
      className={paused ? 'gs-paused' : ''}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      }}
    >
      <div
        id={regionId}
        aria-live={paused ? 'polite' : 'off'}
        className="relative h-[15.5rem] select-none"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(e) => { swipeStart.current = e.clientX; }}
        onPointerUp={(e) => {
          if (swipeStart.current === null) return;
          const dx = e.clientX - swipeStart.current;
          swipeStart.current = null;
          if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => { swipeStart.current = null; }}
      >
        {SLIDES.map(({ label, Card }, i) => {
          const offset = i === index ? 0 : (i - index + SLIDES.length) % SLIDES.length === 1 ? 1 : -1;
          return (
            <div
              key={label}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}: ${label}`}
              aria-hidden={i !== index}
              inert={i !== index ? true : undefined}
              className="gs-motion absolute inset-0 transition-[transform,opacity] duration-500 ease-out"
              style={{ transform: `translateX(${offset * 2.5}rem)`, opacity: i === index ? 1 : 0 }}
            >
              {/* Remount on show so the ring and sparkline draw in again. */}
              <Card key={i === index ? 'shown' : 'hidden'} />
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center gap-2" role="group" aria-label="Choose a slide" aria-controls={regionId}>
          {SLIDES.map(({ label }, i) => (
            <button
              key={label}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show slide ${i + 1}: ${label}`}
              aria-current={i === index ? 'true' : undefined}
              className={`gs-motion relative h-2.5 rounded-full overflow-hidden transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${i === index ? 'w-10 bg-blue-200' : 'w-2.5 bg-gray-300 hover:bg-gray-400'}`}
            >
              {i === index && <span key={`${index}-${stopped}`} className="gs-dot-progress absolute inset-0 bg-blue-600 rounded-full" style={{ ['--gs-slide-ms' as string]: `${SLIDE_MS}ms` }} />}
            </button>
          ))}
        </div>
        {!reduced && (
          <button
            type="button"
            onClick={() => setStopped(!stopped)}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label={stopped ? 'Play slideshow' : 'Pause slideshow'}
          >
            {stopped ? <Play className="w-3.5 h-3.5" aria-hidden="true" /> : <Pause className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        )}
        <span className="ml-auto text-[10px] text-gray-500">Example views</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Google sign-in                                                      */
/* ------------------------------------------------------------------ */

/** Google's four-colour "G", as required by its sign-in branding guidelines. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

type GoogleCodeClient = { requestCode: () => void };
type GoogleGlobal = {
  accounts: {
    oauth2: {
      initCodeClient: (cfg: {
        client_id: string;
        scope: string;
        ux_mode: 'popup';
        callback: (r: { code?: string; error?: string }) => void;
        error_callback?: (e: { type?: string }) => void;
      }) => GoogleCodeClient;
    };
  };
};

let gisLoading: Promise<GoogleGlobal> | null = null;
/** Loads Google Identity Services once, on first use. */
function loadGoogleIdentity(): Promise<GoogleGlobal> {
  const existing = (window as unknown as { google?: GoogleGlobal }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve((window as unknown as { google: GoogleGlobal }).google);
    s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in.')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/* ------------------------------------------------------------------ */
/* Auth card                                                           */
/* ------------------------------------------------------------------ */

const inputClass =
  'block w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-900 bg-white placeholder-gray-400 transition-shadow focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30';
const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1.5';
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

const cardClass = 'bg-white/95 backdrop-blur rounded-xl border border-gray-200 shadow-[0_20px_50px_-20px_rgba(17,24,39,0.25)] p-6 sm:p-8';
const primaryButton = `w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-600/30 transition-colors disabled:opacity-60 ${focusRing}`;
const linkButton = `text-xs font-semibold text-blue-700 hover:underline rounded ${focusRing}`;

function ErrorBox({ id, message }: { id?: string; message: string }) {
  return (
    <div id={id} role="alert" className="flex gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/** "Forgot password?": asks for the address and sends the link. */
function ForgotPanel({ initialEmail, onBack }: { initialEmail: string; onBack: (email: string) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setSent((await api.forgotPassword(email.trim())).message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardClass}>
      <button type="button" onClick={() => onBack(email)} className={`inline-flex items-center gap-1 ${linkButton}`}>
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to sign in
      </button>
      <span className="mt-5 w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center" aria-hidden="true">
        {sent ? <MailCheck className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
      </span>
      <h2 ref={heading} tabIndex={-1} className="mt-3 text-lg font-bold text-gray-900 focus:outline-none">{sent ? 'Check your email' : 'Reset your password'}</h2>
      {sent ? (
        <div role="status" className="mt-2 space-y-3 text-sm text-gray-700">
          <p>{sent}</p>
          <p className="text-gray-600">Not there after a few minutes? Check spam, or <button type="button" onClick={() => setSent(null)} className={linkButton}>send another link</button>.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-2 space-y-4" aria-describedby={error ? 'forgot-error' : undefined}>
          <p className="text-sm text-gray-600">Enter the email you sign in with. We’ll send a link to choose a new password.</p>
          <div>
            <label htmlFor="forgot-email" className={labelClass}>Email</label>
            <input id="forgot-email" type="email" className={inputClass} required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.ac.ke" />
          </div>
          {error && <ErrorBox id="forgot-error" message={error} />}
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Send reset link
          </button>
        </form>
      )}
    </div>
  );
}

/** Opened from the emailed link: checks it, then sets the new password. */
function ResetPasswordCard({ token, onDone, onRequestNew }: { token: string; onDone: (email: string) => void; onRequestNew: () => void }) {
  const [state, setState] = useState<{ kind: 'checking' } | { kind: 'invalid' } | { kind: 'ready'; email: string }>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.checkResetToken(token)
      .then((r) => setState(r.valid && r.email ? { kind: 'ready', email: r.email } : { kind: 'invalid' }))
      .catch(() => setState({ kind: 'invalid' }));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      const { email } = await api.resetPassword(token, password);
      onDone(email);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reset_link_invalid') setState({ kind: 'invalid' });
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === 'checking') {
    return (
      <div className={`${cardClass} flex items-center gap-2 text-sm text-gray-600`} aria-busy="true">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking your reset link…
      </div>
    );
  }
  if (state.kind === 'invalid') {
    return (
      <div className={cardClass}>
        <h2 className="text-lg font-bold text-gray-900">This link can’t be used</h2>
        <p className="mt-2 text-sm text-gray-600">Reset links work once and expire after 30 minutes. Request a new one and use the latest email.</p>
        <button type="button" onClick={onRequestNew} className={`mt-5 ${primaryButton}`}>Request a new link</button>
      </div>
    );
  }
  return (
    <div className={cardClass}>
      <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center" aria-hidden="true"><KeyRound className="w-5 h-5" /></span>
      <h2 className="mt-3 text-lg font-bold text-gray-900">Choose a new password</h2>
      <p className="mt-1 text-sm text-gray-600">For <b className="text-gray-900">{state.email}</b>. You’ll be signed out on every device.</p>
      <form onSubmit={submit} className="mt-5 space-y-4" aria-describedby={error ? 'reset-error' : undefined}>
        {/* Lets password managers save the new password against the right account. */}
        <input type="email" autoComplete="username" value={state.email} readOnly hidden />
        <div>
          <label htmlFor="reset-password" className={labelClass}>New password</label>
          <div className="relative">
            <input id="reset-password" type={show ? 'text' : 'password'} className={`${inputClass} pr-11`} required minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password" aria-describedby="reset-hint" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide passwords' : 'Show passwords'} aria-pressed={show} className={`absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-gray-800 rounded-r-xl ${focusRing}`}>
              {show ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
          <p id="reset-hint" className="text-xs text-gray-600 mt-1">At least {PASSWORD_MIN_LENGTH} characters. A short passphrase works well.</p>
        </div>
        <div>
          <label htmlFor="reset-confirm" className={labelClass}>Confirm new password</label>
          <input id="reset-confirm" type={show ? 'text' : 'password'} className={inputClass} required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <ErrorBox id="reset-error" message={error} />}
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Set new password
        </button>
      </form>
    </div>
  );
}

interface AuthCardProps extends Props {
  initialEmail?: string;
  /** Shown above the form, e.g. after a password reset. */
  notice?: string | null;
  onForgot: (email: string) => void;
}

function AuthCard({ onSignedIn, initialEmail = '', notice, onForgot }: AuthCardProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [applicantType, setApplicantType] = useState<'individual' | 'organisation'>('individual');
  const [inviteCode, setInviteCode] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'form' | 'google' | null>(null);
  const [google, setGoogle] = useState<{ clientId: string } | null | undefined>(undefined);
  const [inviteOnly, setInviteOnly] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = { tabLogin: useId(), tabRegister: useId(), panel: useId(), pwHint: useId(), err: useId() };

  useEffect(() => {
    api.providers().then((p) => { setGoogle(p.google); setInviteOnly(p.registration === 'invite_only'); }).catch(() => setGoogle(null));
  }, []);

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register' && password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setBusy('form');
    try {
      if (mode === 'login') {
        const { user } = await api.login(email, password, remember);
        setPassword('');
        onSignedIn(user, { created: false });
      } else {
        const { user } = await api.register({
          email,
          password,
          name: name.trim(),
          persona: 'academic',
          applicantType,
          inviteCode: inviteCode.trim() || undefined,
          researchInterests: [],
          remember,
        });
        setPassword('');
        onSignedIn(user, { created: true });
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const continueWithGoogle = async () => {
    if (!google) return;
    setError(null);
    setBusy('google');
    try {
      const gis = await loadGoogleIdentity();
      const code = await new Promise<string>((resolve, reject) => {
        gis.accounts.oauth2
          .initCodeClient({
            client_id: google.clientId,
            scope: 'openid email profile',
            ux_mode: 'popup',
            callback: (r) => (r.code ? resolve(r.code) : reject(new Error(r.error ?? 'Google sign-in was cancelled.'))),
            error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Google sign-in was cancelled.' : 'Google sign-in could not open. Allow pop-ups and try again.')),
          })
          .requestCode();
      });
      const { user, created } = await api.googleSignIn(code, remember);
      onSignedIn(user, { created });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setBusy(null);
    }
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = mode === 'login' ? 'register' : 'login';
    switchMode(next);
    tabs.current[next === 'login' ? 0 : 1]?.focus();
  };

  const isLogin = mode === 'login';
  return (
    <div className="bg-white/95 backdrop-blur rounded-xl border border-gray-200 shadow-[0_20px_50px_-20px_rgba(17,24,39,0.25)] p-6 sm:p-8">
      <div role="tablist" aria-label="Sign in or register" className="grid grid-cols-2 bg-gray-100 rounded-xl p-1" onKeyDown={onTabKey}>
        {(['login', 'register'] as const).map((m, i) => (
          <button
            key={m}
            ref={(el) => { tabs.current[i] = el; }}
            id={m === 'login' ? ids.tabLogin : ids.tabRegister}
            role="tab"
            type="button"
            aria-selected={mode === m}
            aria-controls={ids.panel}
            tabIndex={mode === m ? 0 : -1}
            onClick={() => switchMode(m)}
            className={`py-2 text-sm font-semibold rounded-lg transition-colors ${focusRing} ${mode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {m === 'login' ? 'Sign In' : 'Register'}
          </button>
        ))}
      </div>

      <div id={ids.panel} role="tabpanel" aria-labelledby={isLogin ? ids.tabLogin : ids.tabRegister} className="mt-6">
        {notice && isLogin && (
          <div role="status" className="mb-4 flex gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
        <h2 className="text-lg font-bold text-gray-900">{isLogin ? 'Sign in to your account' : 'Create your free account'}</h2>
        <p className="text-sm text-gray-600 mt-0.5">{isLogin ? 'Pick up where your matches left off.' : 'Upload your CV next and get ranked, explained matches.'}</p>

        <form onSubmit={submit} className="mt-5 space-y-4" noValidate={false} aria-describedby={error ? ids.err : undefined}>
          {!isLogin && (
            <>
              <div>
                <label htmlFor="auth-name" className={labelClass}>Full name</label>
                <input id="auth-name" className={inputClass} required maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Amina Wanjiru" />
              </div>
              <fieldset>
                <legend className={labelClass}>Applying as</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([['individual', 'Researcher'], ['organisation', 'Organisation']] as const).map(([value, label]) => (
                    <label key={value} className={`flex items-center justify-center px-3 py-2 border rounded-xl text-sm font-semibold cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600 ${applicantType === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                      <input type="radio" name="auth-applicant-type" value={value} checked={applicantType === value} onChange={() => setApplicantType(value)} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          <div>
            <label htmlFor="auth-email" className={labelClass}>Email</label>
            <input id="auth-email" type="email" className={inputClass} required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.ac.ke" />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="auth-password" className={labelClass}>Password</label>
              {isLogin && (
                <button type="button" onClick={() => onForgot(email)} className={linkButton}>
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                className={`${inputClass} pr-11`}
                required
                minLength={isLogin ? undefined : PASSWORD_MIN_LENGTH}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                aria-describedby={!isLogin ? ids.pwHint : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                aria-controls="auth-password"
                className={`absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 hover:text-gray-800 rounded-r-xl ${focusRing}`}
              >
                {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
            {!isLogin && <p id={ids.pwHint} className="text-xs text-gray-600 mt-1">At least {PASSWORD_MIN_LENGTH} characters. A short passphrase works well.</p>}
          </div>

          {!isLogin && (
            showInvite || inviteOnly ? (
              <div>
                <label htmlFor="auth-invite" className={labelClass}>Organisation invite code{inviteOnly ? '' : ' (optional)'}</label>
                <input id="auth-invite" className={inputClass} required={inviteOnly} aria-describedby={inviteOnly ? 'invite-only-note' : undefined} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="From your research office" autoComplete="off" />
                {inviteOnly && <p id="invite-only-note" className="text-xs text-gray-600 mt-1">Registration is by invitation. Ask your research office for a code.</p>}
              </div>
            ) : (
              <button type="button" onClick={() => setShowInvite(true)} className={`text-xs font-semibold text-blue-700 hover:underline rounded ${focusRing}`}>
                Joining your institution? Add an invite code
              </button>
            )
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600 accent-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2" />
            Keep me signed in
          </label>

          {error && (
            <div id={ids.err} role="alert" className="flex gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy !== null}
            className={`w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-600/30 transition-colors disabled:opacity-60 ${focusRing}`}
          >
            {busy === 'form' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-gray-200" />
          <span className="text-xs font-semibold text-gray-500">or continue with</span>
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={!google || busy !== null}
          aria-describedby={google === null ? 'google-unavailable' : undefined}
          className={`w-full inline-flex items-center justify-center gap-3 py-2.5 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
        >
          {busy === 'google' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <GoogleG />}
          Continue with Google
        </button>
        {google === null && (
          <p id="google-unavailable" className="mt-2 text-xs text-gray-600 text-center">Google sign-in isn’t set up on this server yet.</p>
        )}
        {google && <p className="mt-2 text-xs text-gray-600 text-center">New here? Your account is created the first time you continue with Google.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const BULLETS = [
  { Icon: Sparkles, text: 'AI-matched funding calls' },
  { Icon: ShieldCheck, text: 'Instant eligibility screening' },
  { Icon: BellRing, text: 'Deadline alerts' },
  { Icon: FileCheck2, text: 'Proposal-ready insights' },
];

/** The token from an emailed reset link (#reset-password=…), removed from the address bar once read. */
function takeResetToken(): string | null {
  const m = window.location.hash.match(/^#reset-password=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return m[1]!;
}

type CardView = { kind: 'auth'; email: string; notice: string | null } | { kind: 'forgot'; email: string } | { kind: 'reset'; token: string };

export default function AuthLanding({ onSignedIn }: Props) {
  const [view, setView] = useState<CardView>(() => {
    const token = takeResetToken();
    return token ? { kind: 'reset', token } : { kind: 'auth', email: '', notice: null };
  });

  const card =
    view.kind === 'reset' ? (
      <ResetPasswordCard
        token={view.token}
        onDone={(email) => setView({ kind: 'auth', email, notice: 'Password changed. Sign in with your new password.' })}
        onRequestNew={() => setView({ kind: 'forgot', email: '' })}
      />
    ) : view.kind === 'forgot' ? (
      <ForgotPanel initialEmail={view.email} onBack={(email) => setView({ kind: 'auth', email, notice: null })} />
    ) : (
      // Keyed so returning from a reset starts a fresh form with the email filled in.
      <React.Fragment key={view.notice ?? 'auth'}>
        <AuthCard
          onSignedIn={onSignedIn}
          initialEmail={view.email}
          notice={view.notice}
          onForgot={(email) => setView({ kind: 'forgot', email })}
        />
      </React.Fragment>
    );

  return (
    <div id="auth-screen" className="relative min-h-screen overflow-x-hidden bg-[#F9FAFB] font-sans text-gray-900">
      {/* Soft radial glow */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-32 w-[42rem] h-[42rem] rounded-full bg-[radial-gradient(closest-side,rgba(37,99,235,0.18),transparent)]" />
        <div className="absolute top-1/3 -right-40 w-[38rem] h-[38rem] rounded-full bg-[radial-gradient(closest-side,rgba(5,150,105,0.12),transparent)]" />
        <div className="absolute -bottom-48 left-1/4 w-[36rem] h-[36rem] rounded-full bg-[radial-gradient(closest-side,rgba(99,102,241,0.12),transparent)]" />
      </div>

      {/* Fluid shell: fills the screen up to 110rem, with padding and gaps that scale with it. */}
      <div className="relative mx-auto w-full max-w-[110rem] min-h-screen flex flex-col px-[clamp(1.25rem,5vw,6rem)] py-[clamp(1.5rem,4vh,3rem)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-extrabold text-lg shadow-sm" aria-hidden="true">G</div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-base leading-none">GrantSeeker</span>
            <span className="text-[10px] text-gray-500 font-semibold tracking-wider mt-0.5">INTELLIGENCE</span>
          </div>
        </div>

        {/* Phones: intro, carousel, form, bullets in one column (the left panel
            dissolves into the grid via `contents`). From lg: two columns,
            vertically centred against each other, so a taller form never
            pulls gaps into the left panel. */}
        <main className="flex-1 grid content-center gap-8 py-[clamp(2rem,5vh,4rem)] lg:grid-cols-[minmax(0,52rem)_clamp(22rem,30vw,30rem)] lg:justify-center lg:items-center lg:gap-x-[clamp(3rem,6vw,7rem)]">
          <div className="contents lg:flex lg:flex-col lg:gap-[clamp(1.75rem,4vh,2.75rem)] lg:w-full">
            <div className="order-1">
              <h1 className="text-[clamp(2.25rem,3.4vw+0.75rem,4.25rem)] font-extrabold italic tracking-tight leading-[1.05] pb-1 bg-gradient-to-r from-blue-700 via-blue-600 to-emerald-700 bg-clip-text text-transparent">
                Welcome to GrantSeeker
              </h1>
              <p className="mt-3 text-[clamp(1.125rem,0.6vw+0.9rem,1.5rem)] font-semibold text-gray-900">Find, qualify and win the right funding — faster.</p>
              <p className="mt-2 text-[clamp(0.875rem,0.3vw+0.8rem,1.0625rem)] leading-relaxed text-gray-600 max-w-[40rem]">
                AI grant discovery for East African researchers, universities and NGOs.
                <br className="hidden sm:block" /> Every call is screened against your profile and explained, so you apply where you can win.
              </p>
            </div>

            <div className="order-2 w-full max-w-[46rem] lg:max-w-none">
              <HeroCarousel />
            </div>

            <ul className="order-4 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[46rem] lg:max-w-none">
              {BULLETS.map(({ Icon, text }) => (
                <li key={text} className="flex items-center gap-3 bg-white/80 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-800">
                  <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0" aria-hidden="true">
                    <Icon className="w-4 h-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className="order-3 w-full max-w-[46rem] lg:max-w-none">
            {card}
          </div>
        </main>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>New calls are scanned twice daily at 06:00 and 12:00 EAT.</span>
        </footer>
      </div>
    </div>
  );
}
