import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Download,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { downloadWindowsDesktopApp } from '../lib/https';
import EDITORIAL_WORKSPACE_IMAGE from '../assets/images/auth_workspace_editorial_1793163587127.jpg';

export function AuthScreen() {
  const {
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    authError,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloadingExe, setDownloadingExe] = useState(false);
  const [imageError, setImageError] = useState(false);
  const emailInputRef = useRef<HTMLInputElement | null>(null);

  const handleDownloadExe = async () => {
    setDownloadingExe(true);
    try {
      await downloadWindowsDesktopApp();
    } finally {
      setDownloadingExe(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else {
        await registerWithEmail(fullName.trim(), email.trim(), password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="top" className="min-h-screen bg-slate-50 flex flex-col">
      {/* Clean 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 lg:px-10 py-4 bg-white border-b border-slate-200">
        <a
          href="#top"
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          AI Workforce
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a href="#agents" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Digital Agents
          </a>
          <a href="#workflows" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Self-Healing
          </a>
          <a href="#governance" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
            Approval Gate
          </a>
          <a
            href="#auth-panel"
            onClick={(e) => {
              e.preventDefault();
              setMode('register');
              clearAuthError();
              emailInputRef.current?.focus();
            }}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Create Workspace
          </a>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDownloadExe}
            disabled={downloadingExe}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{downloadingExe ? 'Preparing .exe...' : 'Windows App (.exe)'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              clearAuthError();
              emailInputRef.current?.focus();
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Sign In to Workspace
          </button>
        </div>
      </header>

      {/* Main 2-Column Split */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 lg:px-10 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        {/* Left Auth Column */}
        <section
          id="auth-panel"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-7 lg:p-9 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  clearAuthError();
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'signin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  clearAuthError();
                }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'register'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>

            <h1
              className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2"
              style={{ textWrap: 'balance' }}
            >
              {mode === 'signin'
                ? 'Access your digital operations team'
                : 'Initialize an isolated business workspace'}
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              {mode === 'signin'
                ? 'Sign in with your business email or Google account to manage leads, execute multi-agent DAG workflows, and approve outreach.'
                : 'Create your account to provision an isolated PostgreSQL workspace with starter CRM prospects and server-verified admin access.'}
            </p>

            {authError && (
              <div
                role="alert"
                className="mb-6 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            {/* First-Party Email & Password Form (Works in all browsers & restricted iframes) */}
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-fullname"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Full name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="auth-fullname"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jordan Mercer"
                      required={mode === 'register'}
                      className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Work email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={emailInputRef}
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    minLength={8}
                    required
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <span>
                  {submitting
                    ? mode === 'signin'
                      ? 'Signing in...'
                      : 'Provisioning workspace...'
                    : mode === 'signin'
                      ? 'Sign In with Email'
                      : 'Create Workspace Account'}
                </span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-slate-500">Or authenticate via Google</span>
              </div>
            </div>

            {/* Google OAuth Sign-In */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-900 text-sm font-medium rounded-lg border border-slate-300 transition-colors flex items-center justify-center gap-2.5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.81-1.5 3.34-3.2 4.37v3.62h5.18c3.03-2.79 4.78-6.9 4.78-11.78 0-.8-.08-1.57-.22-2.32l.12.38z"
                />
                <path
                  fill="#34A853"
                  d="M12.18 22c4.32 0 7.95-1.43 10.6-3.88l-5.18-3.62c-1.43.96-3.27 1.53-5.42 1.53-4.17 0-7.7-2.81-8.96-6.6H-2.1v3.73C.54 18.41 5.94 22 12.18 22z"
                />
              </svg>
              <span>
                {mode === 'signin' ? 'Continue with Google' : 'Register Workspace with Google'}
              </span>
            </button>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-200 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-slate-700 shrink-0" />
            <span>
              Row-isolated business data · Server-side AI execution · Mandatory human approval
            </span>
          </div>
        </section>

        {/* Right Editorial & Product Capabilities Column */}
        <section className="lg:col-span-7 rounded-xl overflow-hidden border border-slate-200 bg-slate-900 relative flex flex-col justify-end min-h-[460px]">
          {!imageError ? (
            <img
              src={EDITORIAL_WORKSPACE_IMAGE}
              alt="Modern executive workspace desk illuminated by natural morning light"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950" />
          )}

          {/* Measured contrast scrim */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/65 to-slate-950/20" />

          <div className="relative z-10 p-8 lg:p-10 text-white space-y-6">
            <div className="max-w-xl space-y-3">
              <p className="text-xs font-medium text-slate-300 tracking-wide">
                Autonomous Business Workflow Engine for Small &amp; Medium Teams
              </p>
              <h2
                className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white"
                style={{ textWrap: 'balance' }}
              >
                Plan DAG tasks, invoke business tools, and govern outreach with one-click sign-off.
              </h2>
              <p className="text-sm text-slate-200 leading-relaxed">
                Submit a natural-language business directive and let coordinated AI specialists
                update your PostgreSQL CRM, qualify fit transparently, sync deal trackers, and stage
                personalized follow-ups at a human supervisor checkpoint.
              </p>
            </div>

            <div
              id="agents"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 border-t border-white/15 text-xs"
            >
              <div className="space-y-1">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>01. Orchestrator / Planner Agent</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Decomposes natural-language business requests into DAG tasks with explicit handoffs.
                </p>
              </div>

              <div className="space-y-1">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>02. Specialized Worker Agents</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Lead Qualifier, Function-Calling CRM Updater, Outreach Dispatcher, and Insights.
                </p>
              </div>

              <div id="workflows" className="space-y-1">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>03. Tool Calling &amp; Connector Layer</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  PostgreSQL CRM mutations plus Google Sheets &amp; Airtable pipeline relays.
                </p>
              </div>

              <div id="governance" className="space-y-1">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>04. Supervisor &amp; Human Checkpoint</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Pauses high-risk outreach and webhooks for human one-click sign-off.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
