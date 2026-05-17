import React, { useState, useEffect } from 'react';
import { 
  Github, 
  Settings, 
  History, 
  Zap, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  ExternalLink,
  Terminal,
  Code2,
  TrendingUp,
  LogOut,
  ToggleLeft,
  ToggleRight,
  Clock
} from 'lucide-react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  addDoc,
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  limit
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo, null, 2));
  
  // Check for index error
  if (errInfo.error.includes('The query requires an index')) {
    return "Database index is being built. Please wait a few minutes and refresh.";
  }
  
  return errInfo.error;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
          <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-2xl max-w-md w-full">
            <h2 className="text-xl font-bold text-red-500 mb-4">Something went wrong</h2>
            <p className="text-[#8b949e] text-sm mb-6">{this.state.error?.message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-2 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface UserData {
  uid: string;
  githubUsername?: string;
  githubAccessToken?: string;
  repoName?: string;
  streak: number;
  autoMode?: boolean;
  lastPushDate?: string;
}

interface GitLog {
  id: string;
  timestamp: string;
  commitMessage: string;
  content: string;
  status: 'success' | 'failed';
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [logs, setLogs] = useState<GitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);

  // Auto-Push Logic
  useEffect(() => {
    if (!user || !userData?.autoMode || !userData?.githubAccessToken || !userData?.repoName || actionLoading) return;

    const checkAndTriggerAutoPush = async () => {
      const lastPush = logs.find(l => l.status === 'success');
      const now = new Date();
      
      let shouldPush = false;
      if (!lastPush) {
        shouldPush = true;
      } else {
        const lastDate = new Date(lastPush.timestamp);
        const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
        if (diffHours >= 24) {
          shouldPush = true;
        }
      }

      if (shouldPush) {
        setAutoStatus('Auto-pushing daily insight...');
        await triggerPush(true);
        setAutoStatus(null);
      }
    };

    const timer = setTimeout(checkAndTriggerAutoPush, 3000); // Wait 3s after load
    return () => clearTimeout(timer);
  }, [user, userData?.autoMode, logs.length]);

  useEffect(() => {
    let unsubLogs: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      // Clean up previous logs listener if any
      if (unsubLogs) {
        unsubLogs();
        unsubLogs = null;
      }

      if (u) {
        // Fetch user data
        try {
          const userDoc = await getDoc(doc(db, 'users', u.uid));
          if (userDoc.exists()) {
            setUserData(userDoc.data() as UserData);
            setRepoInput(userDoc.data().repoName || '');
          } else {
            const newData = { uid: u.uid, streak: 0 };
            await setDoc(doc(db, 'users', u.uid), newData);
            setUserData(newData as UserData);
          }
        } catch (err: any) {
          setError(handleFirestoreError(err, OperationType.GET, `users/${u.uid}`));
        }

        // Fetch logs
        const q = query(
          collection(db, 'logs'),
          where('uid', '==', u.uid),
          orderBy('timestamp', 'desc'),
          limit(10)
        );
        
        unsubLogs = onSnapshot(q, (snapshot) => {
          setLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GitLog)));
        }, (err) => {
          setError(handleFirestoreError(err, OperationType.LIST, 'logs'));
        });
      } else {
        setUserData(null);
        setLogs([]);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (unsubLogs) unsubLogs();
    };
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError('Failed to login with Google');
    }
  };

  const handleConnectGithub = async () => {
    try {
      const res = await fetch('/api/auth/github/url');
      const { url } = await res.json();
      const popup = window.open(url, 'github_oauth', 'width=600,height=700');
      
      const handleMessage = async (event: MessageEvent) => {
        if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
          const token = event.data.token;
          if (user) {
            try {
              await setDoc(doc(db, 'users', user.uid), { githubAccessToken: token }, { merge: true });
              setUserData(prev => prev ? { ...prev, githubAccessToken: token } : null);
            } catch (err) {
              setError(handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
            }
          }
          window.removeEventListener('message', handleMessage);
        }
      };
      window.addEventListener('message', handleMessage);
    } catch (err) {
      setError('Failed to connect GitHub');
    }
  };

  const handleUpdateRepo = async () => {
    if (!user || !repoInput) return;
    setActionLoading(true);
    try {
      await setDoc(doc(db, 'users', user.uid), { repoName: repoInput }, { merge: true });
      setUserData(prev => prev ? { ...prev, repoName: repoInput } : null);
    } catch (err) {
      setError(handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
    } finally {
      setActionLoading(false);
    }
  };

  const toggleAutoMode = async () => {
    if (!user || !userData) return;
    const newMode = !userData.autoMode;
    try {
      await setDoc(doc(db, 'users', user.uid), { autoMode: newMode }, { merge: true });
      setUserData(prev => prev ? { ...prev, autoMode: newMode } : null);
    } catch (err) {
      setError(handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
    }
  };

  const triggerPush = async (isAuto = false) => {
    if (!userData?.githubAccessToken || !userData?.repoName || !user) return;
    if (!isAuto) setActionLoading(true);
    setError(null);
    try {
      // 1. Generate AI Content in Frontend
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const aiResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Generate a short, professional, and 'techy' piece of code or a technical insight (markdown format) that sounds like it's from a senior software engineer. Keep it under 200 words. Focus on topics like system design, performance optimization, or clean code. Output ONLY the markdown content.",
      });

      const content = aiResponse.text;
      if (!content) throw new Error("AI failed to generate content");

      // 2. Push to GitHub via Backend
      const res = await fetch('/api/push-contribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token: userData.githubAccessToken, 
          repoName: userData.repoName,
          content: content
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      // 3. Update Streak and Last Push Date
      const now = new Date().toISOString();
      const lastPushDate = userData.lastPushDate ? new Date(userData.lastPushDate) : null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let newStreak = userData.streak || 0;
      if (!lastPushDate || lastPushDate < today) {
        newStreak += 1;
      }

      await setDoc(doc(db, 'users', user.uid), { 
        lastPushDate: now,
        streak: newStreak
      }, { merge: true });
      
      setUserData(prev => prev ? { ...prev, lastPushDate: now, streak: newStreak } : null);

      // Log success
      try {
        await addDoc(collection(db, 'logs'), {
          uid: user.uid,
          timestamp: now,
          commitMessage: data.commitMessage,
          content: content,
          status: 'success'
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'logs');
      }
    } catch (err: any) {
      if (!isAuto) setError(err.message || 'Failed to push contribution');
      try {
        await addDoc(collection(db, 'logs'), {
          uid: user.uid,
          timestamp: new Date().toISOString(),
          commitMessage: 'Failed push',
          content: err.message,
          status: 'failed'
        });
      } catch (logErr) {
        handleFirestoreError(logErr, OperationType.WRITE, 'logs');
      }
    } finally {
      if (!isAuto) setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] font-sans selection:bg-blue-500/30">
        {/* Header */}
        <header className="border-b border-[#30363d] bg-[#161b22]/80 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                <Zap className="w-6 h-6 text-white fill-current" />
              </div>
              <div>
                <h1 className="font-bold text-xl tracking-tight text-white">GitPulse</h1>
                <p className="text-[10px] uppercase tracking-widest text-[#8b949e] font-semibold">AI Contribution Engine</p>
              </div>
            </div>
            
            {user ? (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-sm font-medium text-white">{user.displayName}</span>
                  <span className="text-xs text-[#8b949e]">{user.email}</span>
                </div>
                <button 
                  onClick={() => signOut(auth)}
                  className="p-2 hover:bg-[#30363d] rounded-lg transition-colors text-[#8b949e] hover:text-white"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="px-4 py-2 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-all flex items-center gap-2"
              >
                Get Started
              </button>
            )}
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {!user ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl"
              >
                <h2 className="text-5xl font-bold text-white mb-6 leading-tight">
                  Your GitHub Profile, <span className="text-blue-500">Automated.</span>
                </h2>
                <p className="text-xl text-[#8b949e] mb-10">
                  Maintain a professional presence with daily AI-generated technical insights and code snippets pushed directly to your profile.
                </p>
                <button 
                  onClick={handleLogin}
                  className="px-8 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/40 flex items-center gap-3 mx-auto"
                >
                  Connect with Google
                </button>
              </motion.div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Controls */}
              <div className="lg:col-span-1 space-y-6">
                {/* Status Card */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-[#8b949e] mb-4 flex items-center gap-2">
                    <Terminal className="w-4 h-4" /> System Status
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-[#0d1117] rounded-xl border border-[#30363d]">
                      <span className="text-sm">GitHub Linked</span>
                      {userData?.githubAccessToken ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <button 
                          onClick={handleConnectGithub}
                          className="text-xs font-bold text-blue-500 hover:underline"
                        >
                          Connect
                        </button>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-[#8b949e]">Target Repository (owner/repo)</label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={repoInput}
                          onChange={(e) => setRepoInput(e.target.value)}
                          placeholder="username/daily-insights"
                          className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                        />
                        <button 
                          onClick={handleUpdateRepo}
                          disabled={actionLoading}
                          className="p-2 bg-[#30363d] hover:bg-[#3d444d] rounded-lg transition-colors"
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-[#0d1117] rounded-xl border border-[#30363d]">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-500" />
                        <span className="text-sm">Auto-Push (24h)</span>
                      </div>
                      <button 
                        onClick={toggleAutoMode}
                        className="text-blue-500 hover:text-blue-400 transition-colors"
                      >
                        {userData?.autoMode ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8 text-[#8b949e]" />}
                      </button>
                    </div>

                    <button 
                      onClick={() => triggerPush()}
                      disabled={actionLoading || !userData?.githubAccessToken || !userData?.repoName}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                      Trigger Daily Push
                    </button>
                  </div>
                </div>

                {/* Stats Card */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-[#8b949e] flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" /> Activity
                    </h3>
                    <span className="text-xs font-mono bg-blue-500/10 text-blue-500 px-2 py-1 rounded">Live</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#0d1117] p-4 rounded-xl border border-[#30363d]">
                      <p className="text-2xl font-bold text-white">{userData?.streak || 0}</p>
                      <p className="text-[10px] text-[#8b949e] uppercase font-bold">Day Streak</p>
                    </div>
                    <div className="bg-[#0d1117] p-4 rounded-xl border border-[#30363d]">
                      <p className="text-2xl font-bold text-white">{logs.length}</p>
                      <p className="text-[10px] text-[#8b949e] uppercase font-bold">Total Pushes</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Feed */}
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <History className="w-5 h-5 text-blue-500" /> Contribution History
                  </h3>
                  {autoStatus && (
                    <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {autoStatus}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="bg-red-900/20 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <AnimatePresence mode="popLayout">
                    {logs.length === 0 ? (
                      <div className="text-center py-20 bg-[#161b22] rounded-2xl border border-dashed border-[#30363d]">
                        <Code2 className="w-12 h-12 text-[#30363d] mx-auto mb-4" />
                        <p className="text-[#8b949e]">No contributions yet. Trigger your first one!</p>
                      </div>
                    ) : (
                      logs.map((log) => (
                        <motion.div 
                          key={log.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden"
                        >
                          <div className="p-4 border-b border-[#30363d] flex items-center justify-between bg-[#1c2128]">
                            <div className="flex items-center gap-3">
                              {log.status === 'success' ? (
                                <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                </div>
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                                  <AlertCircle className="w-4 h-4 text-red-500" />
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-bold text-white">{log.commitMessage}</p>
                                <p className="text-[10px] text-[#8b949e]">{new Date(log.timestamp).toLocaleString()}</p>
                              </div>
                            </div>
                            {log.status === 'success' && (
                              <a 
                                href={`https://github.com/${userData?.repoName}`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2 hover:bg-[#30363d] rounded-lg transition-colors text-[#8b949e] hover:text-white"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                          <div className="p-4 bg-[#0d1117]">
                            <div className="prose prose-invert prose-sm max-w-none">
                              <Markdown>{log.content}</Markdown>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="max-w-6xl mx-auto px-4 py-12 border-t border-[#30363d] mt-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2 opacity-50">
              <Github className="w-5 h-5" />
              <span className="text-sm font-medium">GitPulse v1.0</span>
            </div>
            <div className="flex gap-8 text-sm text-[#8b949e]">
              <a href="#" className="hover:text-white transition-colors">Documentation</a>
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
