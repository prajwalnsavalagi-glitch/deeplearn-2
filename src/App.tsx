import { motion, AnimatePresence } from "motion/react";
import { 
  BookOpen, 
  FileText, 
  Presentation, 
  HelpCircle, 
  Layers, 
  Map, 
  ClipboardList, 
  Volume2, 
  Mic, 
  Video, 
  BarChart3, 
  Plus, 
  Upload, 
  Zap, 
  ArrowRight,
  ArrowLeft,
  Menu,
  X,
  MoreVertical,
  LogOut,
  User,
  Calendar,
  Search,
  Trash2,
  Edit2,
  ExternalLink,
  AlertCircle,
  Copy,
  Check,
  Download,
  MessageSquare,
  Image,
  Folder,
  StickyNote,
  Share2,
  CheckSquare,
  Link
} from "lucide-react";
import * as React from "react";
import { useState, useEffect } from "react";
import Markdown from "react-markdown";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  updateProfile,
  User as FirebaseUser
} from "firebase/auth";
import { auth, googleProvider, microsoftProvider } from "./firebase";
import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabase";

// --- Types ---
interface Session {
  id: string;
  user_id: string;
  session_name: string;
  created_at: string;
  updated_at: string;
  sources?: Source[];
  outputs?: Output[];
}

interface Source {
  id: string;
  session_id: string;
  source_type: string;
  source_content: any;
  created_at: string;
}

interface Output {
  id: string;
  session_id: string;
  output_type: string;
  output_content: any;
  created_at: string;
}

interface UserData {
  id: string;
  firebase_uid: string;
  name: string;
  email: string;
  photoURL?: string;
}

type View = "landing" | "login" | "signup" | "dashboard" | "workspace";

// --- Components ---

const FadeIn = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.8, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
  >
    {children}
  </motion.div>
);

const FloatingCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <motion.div
    animate={{ y: [0, -10, 0] }}
    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    className={className}
  >
    {children}
  </motion.div>
);

// --- Main App ---

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [user, setUser] = useState<UserData | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeLegal, setActiveLegal] = useState<"privacy" | "terms" | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [newProfileName, setNewProfileName] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [pendingSource, setPendingSource] = useState<{ type: string, content: any } | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<Output | null>(null);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- Auth Logic ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Check if user exists in Supabase
          let { data: supabaseUser, error } = await supabase
            .from('users')
            .select('*')
            .eq('firebase_uid', firebaseUser.uid)
            .single();

          if (error && error.code === 'PGRST116') {
            // User not found, create it
            const { data: newUser, error: createError } = await supabase
              .from('users')
              .insert([
                { 
                  firebase_uid: firebaseUser.uid, 
                  email: firebaseUser.email,
                  name: firebaseUser.displayName || "User",
                  photo_url: firebaseUser.photoURL,
                  created_at: new Date().toISOString()
                }
              ])
              .select()
              .single();

            if (createError) throw createError;
            supabaseUser = newUser;
          } else if (error) {
            if (error.code === 'PGRST205' || error.code === '42703') {
              setSchemaError("Supabase tables are missing or outdated. Please run the SQL schema in your Supabase SQL Editor.");
              return;
            }
            throw error;
          }

          const userData: UserData = {
            id: supabaseUser.id,
            firebase_uid: firebaseUser.uid,
            name: supabaseUser.name || firebaseUser.displayName || "User",
            email: supabaseUser.email || firebaseUser.email || "",
            photoURL: supabaseUser.photo_url || firebaseUser.photoURL || undefined
          };
          setUser(userData);
          setView("dashboard");
          setSyncError(null);
        } catch (error: any) {
          console.error("Error syncing user with Supabase:", error);
          if (error.code === 'PGRST205' || error.code === '42703' || (error.message && (error.message.includes('PGRST205') || error.message.includes('42703')))) {
            setSchemaError("Supabase tables are missing or outdated. Please run the SQL schema in your Supabase SQL Editor.");
          } else {
            setSyncError(error.message || "Failed to sync user data with the database.");
          }
          setUser(null);
        }
      } else {
        setUser(null);
        setView(prev => (prev === "dashboard" || prev === "workspace") ? "landing" : prev);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- Sessions Logic ---
  useEffect(() => {
    if (!isAuthReady || !user) {
      setSessions([]);
      return;
    }

    const fetchSessions = async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select(`
          *,
          sources (*),
          outputs (*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error("Error fetching sessions:", error);
      } else {
        setSessions(data || []);
      }
    };

    fetchSessions();

    // Set up real-time subscription
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          fetchSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthReady, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    
    await signInWithEmailAndPassword(auth, email, password);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
  };

  const handleGoogleLogin = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleMicrosoftLogin = async () => {
    await signInWithPopup(auth, microsoftProvider);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsProfileOpen(false);
      setView("landing");
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !newProfileName.trim() || !user) return;

    try {
      await updateProfile(auth.currentUser, { displayName: newProfileName.trim() });
      const { error } = await supabase
        .from('users')
        .update({ name: newProfileName.trim() })
        .eq('id', user.id);
      
      if (error) throw error;

      setUser(prev => prev ? { ...prev, name: newProfileName.trim() } : null);
      setIsEditProfileOpen(false);
    } catch (error: any) {
      alert("Failed to update profile: " + error.message);
    }
  };

  const handleCreateSessionWithSource = async () => {
    if (!user || !pendingSource) return;

    setIsCreatingSession(true);
    try {
      // 1. Generate AI Name for session
      let sessionName = "New Teaching Session";
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Generate a short, catchy title (max 5 words) for a teaching session based on this source: ${JSON.stringify(pendingSource.content)}. Return only the title text.`,
        });
        if (response.text) {
          sessionName = response.text.trim().replace(/^["']|["']$/g, '');
        }
      } catch (aiError) {
        console.error("AI Naming failed:", aiError);
      }

      // 2. Create Session
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .insert([
          {
            user_id: user.id,
            session_name: sessionName,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (sessionError) throw sessionError;

      // 3. Create Source
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .insert([
          {
            session_id: session.id,
            source_type: pendingSource.type,
            source_content: pendingSource.content,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (sourceError) throw sourceError;

      // 4. Update local state and navigate
      const newSession: Session = {
        ...session,
        sources: [source],
        outputs: []
      };

      setSelectedSession(newSession);
      setView("workspace");
      setIsAddSourceOpen(false);
      setPendingSource(null);
      setSourceInput("");
    } catch (error: any) {
      alert("Failed to create session: " + error.message);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleAddSource = async () => {
    if (!user || !pendingSource) return;

    if (view === "workspace" && selectedSession) {
      // Adding to existing session
      setIsCreatingSession(true);
      try {
        const { data, error } = await supabase
          .from('sources')
          .insert([
            {
              session_id: selectedSession.id,
              source_type: pendingSource.type,
              source_content: pendingSource.content,
              created_at: new Date().toISOString()
            }
          ])
          .select()
          .single();

        if (error) throw error;

        // Update local state
        setSelectedSession(prev => {
          if (!prev) return null;
          return {
            ...prev,
            sources: [...(prev.sources || []), data]
          };
        });
        setIsAddSourceOpen(false);
        setPendingSource(null);
      } catch (error: any) {
        alert("Failed to add source: " + error.message);
      } finally {
        setIsCreatingSession(false);
      }
    } else {
      // Creating new session
      handleCreateSessionWithSource();
    }
  };

  const deleteSession = async (id: string) => {
    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      if (selectedSession?.id === id) {
        setSelectedSession(null);
        setView("dashboard");
      }
    } catch (error: any) {
      alert("Failed to delete session: " + error.message);
    }
  };

  // --- Views ---

  const LandingView: React.FC = () => {
    const features = [
      { 
        icon: Plus, 
        title: "Add Any Source", 
        description: "Upload PDFs, videos, links, images, folders, or text." 
      },
      { 
        icon: MessageSquare, 
        title: "Chat With Your Sources", 
        description: "Ask questions and explore topics with AI." 
      },
      { 
        icon: StickyNote, 
        title: "Generate Smart Notes", 
        description: "Create summaries, explanations, and study notes." 
      },
      { 
        icon: ClipboardList, 
        title: "Create Teaching Materials", 
        description: "Generate lesson plans, worksheets, and explanations." 
      },
      { 
        icon: Share2, 
        title: "Visualize Concepts", 
        description: "Turn ideas into diagrams, infographics, and mind maps." 
      },
      { 
        icon: Presentation, 
        title: "Generate Slides", 
        description: "Create presentations instantly from any topic." 
      },
      { 
        icon: CheckSquare, 
        title: "Create Assessments", 
        description: "Generate quizzes and tests for practice or classroom use." 
      },
    ];

    return (
      <div className="min-h-screen bg-white selection:bg-black selection:text-white font-sans">
        {/* Legal Content Overlay */}
        <AnimatePresence>
          {activeLegal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-white pt-24 pb-20 px-6 overflow-y-auto"
            >
              <div className="max-w-3xl mx-auto">
                <button 
                  onClick={() => setActiveLegal(null)}
                  className="mb-8 flex items-center gap-2 text-gray-500 hover:text-black transition-colors group"
                >
                  <ArrowRight className="w-4 h-4 rotate-180 group-hover:-translate-x-1 transition-transform" />
                  Back to Home
                </button>

                {activeLegal === "privacy" ? (
                  <div className="prose prose-gray max-w-none">
                    <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
                    <p className="text-gray-600 mb-6 italic">Last Updated: April 3, 2026</p>
                    <section className="mb-10">
                      <h2 className="text-2xl font-bold mb-4">1. Information We Collect</h2>
                      <p className="text-gray-600 mb-4">DeepLearn collects information to provide a better experience for all our users. This includes Account Information, User Content, and Usage Data.</p>
                    </section>
                    <section className="mb-10">
                      <h2 className="text-2xl font-bold mb-4">2. How We Use Your Information</h2>
                      <p className="text-gray-600 mb-4">We use the information to provide, maintain, and improve our AI-powered learning tools and generate educational outputs.</p>
                    </section>
                  </div>
                ) : (
                  <div className="prose prose-gray max-w-none">
                    <h1 className="text-4xl font-bold mb-8">Terms and Conditions</h1>
                    <p className="text-gray-600 mb-6 italic">Last Updated: April 3, 2026</p>
                    <section className="mb-10">
                      <h2 className="text-2xl font-bold mb-4">1. Acceptance of Terms</h2>
                      <p className="text-gray-600 mb-4">By accessing or using DeepLearn, you agree to be bound by these Terms and Conditions.</p>
                    </section>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <button onClick={() => setView("landing")} className="flex items-center gap-0 hover:opacity-80 transition-opacity">
              <span className="font-bold text-xl tracking-tight text-black">Deep</span>
              <span className="font-bold text-xl tracking-tight text-gray-400">Learn</span>
            </button>
            <div className="hidden md:flex items-center gap-8">
              <button onClick={() => setView("login")} className="text-sm font-medium text-gray-600 hover:text-black transition-colors">Sign In</button>
              <button onClick={() => setView("signup")} className="px-6 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-all active:scale-95">
                Start Your First Session
              </button>
            </div>
            <button className="md:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
          {isMenuOpen && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="md:hidden absolute top-16 left-0 right-0 bg-white border-b border-gray-100 p-6 flex flex-col gap-4">
              <button onClick={() => setView("login")} className="text-left py-2 text-gray-600">Sign In</button>
              <button onClick={() => setView("signup")} className="w-full py-3 bg-black text-white rounded-xl font-medium">Start Your First Session</button>
            </motion.div>
          )}
        </nav>

        {/* Hero Section */}
        <section className="relative pt-32 pb-24 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern opacity-5 [mask-image:radial-gradient(ellipse_at_center,black,transparent)]" />
          <div className="max-w-4xl mx-auto text-center relative">
            <FadeIn>
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="text-5xl md:text-6xl font-bold tracking-tight text-black mb-6 leading-[1.1] bg-clip-text text-transparent bg-gradient-to-b from-black to-gray-600"
              >
                Your AI Workspace for Learning and Teaching
              </motion.h1>
              <p className="text-lg md:text-xl text-gray-500 mb-10 max-w-2xl mx-auto leading-relaxed">
                Study smarter and create teaching materials faster. Turn any topic, document, video, or idea into notes, visual explanations, presentations, quizzes, and lessons instantly.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button onClick={() => setView("signup")} className="w-full sm:w-auto px-8 py-4 bg-black text-white rounded-full font-bold text-base hover:bg-gray-800 transition-all flex items-center justify-center gap-2 group shadow-lg shadow-black/10">
                  Start Your First Session
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => setView("login")} className="w-full sm:w-auto px-8 py-4 bg-white text-black border border-gray-200 rounded-full font-bold text-base hover:bg-gray-50 transition-all">
                  Sign In
                </button>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Feature Highlights Section */}
        <section className="py-24 px-6 bg-white">
          <div className="max-w-7xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">Powerful Features for Everyone</h2>
                <p className="text-lg text-gray-500 max-w-2xl mx-auto">Tools designed to help students master subjects and teachers craft perfect lessons.</p>
              </div>
            </FadeIn>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <FadeIn key={i} delay={i * 0.1}>
                  <motion.div 
                    whileHover={{ y: -6, scale: 1.01 }}
                    className="p-8 bg-gray-50 rounded-[32px] border border-transparent hover:border-gray-200 hover:bg-white transition-all duration-300 h-full group"
                  >
                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-6 shadow-sm group-hover:shadow-md transition-all">
                      <feature.icon className="w-6 h-6 text-black" />
                    </div>
                    <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                    <p className="text-gray-500 leading-relaxed text-base">{feature.description}</p>
                  </motion.div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* How the Platform Works */}
        <section className="py-24 px-6 bg-gray-50">
          <div className="max-w-7xl mx-auto">
            <FadeIn>
              <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
                <p className="text-lg text-gray-500">Three simple steps to transform your learning or teaching.</p>
              </div>
            </FadeIn>
            
            <div className="relative">
              {/* Animated Connector Line (Desktop) */}
              <div className="hidden lg:block absolute top-1/2 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-gray-200 to-transparent -translate-y-1/2 z-0" />
              
              <div className="grid lg:grid-cols-3 gap-10 relative z-10">
                {[
                  { step: "Step 1", title: "Create a Session", desc: "Start a workspace for any topic or subject.", icon: Plus },
                  { step: "Step 2", title: "Add Sources", desc: "Upload documents, videos, links, images, or notes.", icon: Upload },
                  { step: "Step 3", title: "Explore With AI", desc: "Chat with your sources and generate learning materials.", icon: Zap }
                ].map((item, i) => (
                  <FadeIn key={i} delay={i * 0.2}>
                    <div className="flex flex-col items-center text-center">
                      <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mb-6 shadow-xl shadow-black/20 relative">
                        <item.icon className="w-6 h-6 text-white" />
                        <div className="absolute -top-1 -right-1 w-6 h-6 bg-white border-2 border-black rounded-full flex items-center justify-center text-[10px] font-bold">
                          {i + 1}
                        </div>
                      </div>
                      <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                      <p className="text-gray-500 text-base max-w-xs">{item.desc}</p>
                    </div>
                  </FadeIn>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Session-Based Learning Section */}
        <section className="py-24 px-6 bg-white overflow-hidden">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <FadeIn>
                <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">Sessions are topic workspaces.</h2>
                <p className="text-lg text-gray-500 mb-8 leading-relaxed">
                  Create a session for any subject and add sources like documents, videos, links, notes, or images. 
                </p>
                <p className="text-lg text-gray-500 mb-10 leading-relaxed">
                  The AI studies your sources and helps you explore them through chat, summaries, visual explanations, presentations, quizzes, and learning materials.
                </p>
                <div className="flex items-center gap-5 p-5 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <Layers className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold">Sources</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300" />
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center shadow-lg">
                      <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-[10px] font-bold">AI Chat</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300" />
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                      <Zap className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold">Materials</span>
                  </div>
                </div>
              </FadeIn>
              
              <FadeIn delay={0.3}>
                <div className="relative">
                  <div className="absolute -inset-3 bg-gradient-to-tr from-gray-100 to-white rounded-[48px] -rotate-1" />
                  <div className="relative bg-white p-8 rounded-[48px] shadow-xl border border-gray-100">
                    <div className="space-y-5">
                      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                          <BookOpen className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">Quantum Physics 101</p>
                          <p className="text-[10px] text-gray-400">4 Sources • 12 Materials</p>
                        </div>
                      </div>
                      <div className="h-3 w-3/4 bg-gray-100 rounded-full" />
                      <div className="h-3 w-1/2 bg-gray-50 rounded-full" />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="h-16 bg-gray-50 rounded-xl border border-dashed border-gray-200 flex items-center justify-center">
                          <Plus className="w-4 h-4 text-gray-300" />
                        </div>
                        <div className="h-16 bg-gray-50 rounded-xl border border-dashed border-gray-200 flex items-center justify-center">
                          <Plus className="w-4 h-4 text-gray-300" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-20 px-6 border-t border-gray-100 bg-white">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12">
            <div className="flex flex-col items-center md:items-start gap-4">
              <div className="flex items-center gap-0">
                <span className="font-bold text-2xl tracking-tight text-black">Deep</span>
                <span className="font-bold text-2xl tracking-tight text-gray-400">Learn</span>
              </div>
              <p className="text-gray-500 text-sm">Your AI Workspace for Learning and Teaching.</p>
            </div>
            <div className="flex items-center gap-10">
              <button onClick={() => setActiveLegal("privacy")} className="text-sm font-medium text-gray-500 hover:text-black transition-colors">Privacy Policy</button>
              <button onClick={() => setActiveLegal("terms")} className="text-sm font-medium text-gray-500 hover:text-black transition-colors">Terms and Conditions</button>
            </div>
            <div className="text-sm font-medium text-gray-400">© {new Date().getFullYear()} DeepLearn.</div>
          </div>
        </footer>
      </div>
    );
  };

  const AuthView: React.FC<{ mode: "login" | "signup" }> = ({ mode }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      setError(null);
      
      try {
        if (mode === "login") {
          await handleLogin(e);
        } else {
          await handleSignUp(e);
        }
      } catch (err: any) {
        // Firebase popup closed by user - ignore this error
        if (err.code === 'auth/popup-closed-by-user' || err.message?.includes('popup-closed-by-user')) {
          setIsLoading(false);
          return;
        }
        setError(err.message || "An error occurred during authentication.");
      } finally {
        setIsLoading(false);
      }
    };

    const handleSocialLogin = async (provider: "google" | "microsoft") => {
      setIsLoading(true);
      setError(null);
      try {
        if (provider === "google") {
          await handleGoogleLogin();
        } else {
          await handleMicrosoftLogin();
        }
      } catch (err: any) {
        // Firebase popup closed by user - ignore this error
        if (err.code === 'auth/popup-closed-by-user' || err.message?.includes('popup-closed-by-user')) {
          setIsLoading(false);
          return;
        }
        setError(err.message || "An error occurred during social login.");
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <div className="min-h-screen flex flex-col md:flex-row bg-white">
        {/* Left Panel: Form */}
        <div className="w-full md:w-1/2 flex items-center justify-center p-6 md:p-12">
          <div className="w-full max-w-sm">
            <button 
              onClick={() => setView("landing")} 
              className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black transition-colors mb-8 group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              Back to Home
            </button>

            <button onClick={() => setView("landing")} className="flex items-center gap-0 mb-10 hover:opacity-80 transition-opacity">
              <span className="font-bold text-xl tracking-tight text-black">Deep</span>
              <span className="font-bold text-xl tracking-tight text-gray-400">Learn</span>
            </button>
            
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
              <h2 className="text-2xl font-bold mb-1.5">{mode === "login" ? "Welcome back" : "Create an account"}</h2>
              <p className="text-sm text-gray-500 mb-6">{mode === "login" ? "Enter your details to access your dashboard." : "Join DeepLearn and start creating teaching materials."}</p>
              
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {mode === "signup" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                    <input name="name" type="text" required placeholder="John Doe" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-black focus:ring-0 transition-all outline-none text-sm" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email Address</label>
                  <input name="email" type="email" required placeholder="name@university.edu" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-black focus:ring-0 transition-all outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Password</label>
                  <input name="password" type="password" required placeholder="••••••••" className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-black focus:ring-0 transition-all outline-none text-sm" />
                </div>
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className="w-full py-3 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition-all active:scale-[0.98] mt-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    mode === "login" ? "Login" : "Create Account"
                  )}
                </button>
              </form>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-100"></div></div>
                <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-2 text-gray-400">Or continue with</span></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => handleSocialLogin("google")} 
                  disabled={isLoading}
                  className="flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all text-xs font-medium disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  Google
                </button>
                <button 
                  onClick={() => handleSocialLogin("microsoft")} 
                  disabled={isLoading}
                  className="flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition-all text-xs font-medium disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/></svg>
                  Microsoft
                </button>
              </div>

              <p className="text-center text-xs text-gray-500 mt-6">
                {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                <button onClick={() => setView(mode === "login" ? "signup" : "login")} className="font-bold text-black hover:underline">
                  {mode === "login" ? "Sign Up" : "Login"}
                </button>
              </p>
            </motion.div>
          </div>
        </div>

        {/* Right Panel: Animated Branding */}
        <div className="hidden md:flex w-1/2 bg-gray-50 items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 bg-grid-pattern opacity-30" />
          <div className="relative z-10 w-full max-w-md">
            <div className="grid grid-cols-2 gap-6 p-8">
              <FloatingCard className="p-6 bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100">
                <FileText className="w-8 h-8 mb-4 text-gray-400" />
                <div className="h-2 w-20 bg-gray-100 rounded mb-2" />
                <div className="h-2 w-12 bg-gray-50 rounded" />
              </FloatingCard>
              <FloatingCard className="p-6 bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 mt-12">
                <Presentation className="w-8 h-8 mb-4 text-gray-400" />
                <div className="h-2 w-16 bg-gray-100 rounded mb-2" />
                <div className="h-2 w-24 bg-gray-50 rounded" />
              </FloatingCard>
              <FloatingCard className="p-6 bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100">
                <HelpCircle className="w-8 h-8 mb-4 text-gray-400" />
                <div className="h-2 w-24 bg-gray-100 rounded mb-2" />
                <div className="h-2 w-16 bg-gray-50 rounded" />
              </FloatingCard>
              <FloatingCard className="p-6 bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 mt-12">
                <Layers className="w-8 h-8 mb-4 text-gray-400" />
                <div className="h-2 w-12 bg-gray-100 rounded mb-2" />
                <div className="h-2 w-20 bg-gray-50 rounded" />
              </FloatingCard>
            </div>
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-gray-200/20 rounded-full blur-3xl" />
        </div>
      </div>
    );
  };

  const DashboardView: React.FC = () => {
    const [searchQuery, setSearchQuery] = useState("");
    const filteredSessions = sessions.filter(s => s.session_name.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
      <div className="min-h-screen bg-white font-sans">
        {/* Dashboard Nav */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-10">
              <button onClick={() => setView("dashboard")} className="flex items-center gap-0 hover:opacity-80 transition-opacity">
                <span className="font-bold text-lg tracking-tight text-black">Deep</span>
                <span className="font-bold text-lg tracking-tight text-gray-400">Learn</span>
              </button>
              
              <div className="hidden md:flex items-center gap-5">
                <button onClick={() => setView("dashboard")} className="text-xs font-bold text-black">Home</button>
              </div>
            </div>
            
            <div className="relative">
              <button 
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors overflow-hidden border border-gray-100"
              >
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={user.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User className="w-4 h-4 text-gray-600" />
                )}
              </button>
              
              <AnimatePresence>
                {isProfileOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 rounded-2xl shadow-2xl shadow-black/5 p-2 z-50"
                  >
                    <div className="px-4 py-3 border-b border-gray-50 mb-1">
                      <p className="text-sm font-bold truncate">{user?.name}</p>
                      <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                    </div>
                    <button 
                      onClick={() => {
                        setNewProfileName(user?.name || "");
                        setIsEditProfileOpen(true);
                        setIsProfileOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
                    >
                      <User className="w-4 h-4" /> Profile Settings
                    </button>
                    <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                      <LogOut className="w-4 h-4" /> Logout
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </nav>

        <main className="pt-24 pb-16 px-6 max-w-7xl mx-auto">
          <div className="mb-10">
            <FadeIn>
              <h1 className="text-3xl font-bold mb-1">Hi, {user?.name?.split(' ')[0]}</h1>
              <p className="text-lg text-gray-500">What would you like to explore today?</p>
            </FadeIn>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search sessions..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent focus:border-black focus:bg-white rounded-xl transition-all outline-none text-sm"
              />
            </div>
            <button 
              onClick={() => {
                setPendingSource(null);
                setSourceInput("");
                setIsAddSourceOpen(true);
              }}
              className="px-6 py-3 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition-all flex items-center justify-center gap-2 shadow-md shadow-black/10 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Create New Session
            </button>
          </div>

          {/* Sessions List */}
          {sessions.length === 0 ? (
            <FadeIn>
              <div className="flex flex-col items-center justify-center py-20 px-6 bg-gray-50 rounded-[32px] border border-dashed border-gray-200">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-5 shadow-sm">
                  <BookOpen className="w-8 h-8 text-gray-200" />
                </div>
                <h3 className="text-xl font-bold mb-1.5">No sessions yet</h3>
                <p className="text-gray-500 mb-6 text-center max-w-xs text-sm">Create your first session to start exploring a topic.</p>
                <button 
                  onClick={() => setIsAddSourceOpen(true)}
                  className="px-6 py-3 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Your First Session
                </button>
              </div>
            </FadeIn>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredSessions.map((session, i) => (
                <FadeIn key={`${session.id}-${i}`} delay={i * 0.05}>
                  <div 
                    onClick={() => {
                      setSelectedSession(session);
                      setView("workspace");
                    }}
                    className="group p-6 bg-white border border-gray-100 rounded-[24px] hover:border-black transition-all cursor-pointer relative flex flex-col h-full"
                  >
                    <div className="flex items-start justify-between mb-5">
                      <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center group-hover:bg-black transition-colors">
                        <BookOpen className="w-6 h-6 text-gray-400 group-hover:text-white transition-colors" />
                      </div>
                      <SessionMenu onDelete={() => deleteSession(session.id)} />
                    </div>
                    
                    <h3 className="text-lg font-bold mb-2 group-hover:text-black transition-colors line-clamp-2">{session.session_name}</h3>
                    
                    <div className="mt-auto pt-5 flex items-center gap-4 text-[10px] font-medium text-gray-400">
                      <span className="flex items-center gap-1.5">
                        <Layers className="w-3 h-3" /> {session.sources?.length || 0} Sources
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3" /> {session.outputs?.length || 0} Materials
                      </span>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  };

  const SessionMenu = ({ onDelete }: { onDelete: () => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <div className="relative">
        <button 
          onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <MoreVertical className="w-5 h-5 text-gray-400" />
        </button>
        <AnimatePresence>
          {isOpen && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute right-0 mt-2 w-40 bg-white border border-gray-100 rounded-xl shadow-xl z-10 p-1"
            >
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                <ExternalLink className="w-4 h-4" /> Open Session
              </button>
              <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                <Edit2 className="w-4 h-4" /> Rename
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const [isGeneratingOutput, setIsGeneratingOutput] = useState(false);

  const generateOutput = async (type: string) => {
    if (!selectedSession || !user) return;
    
    const session = sessions.find(s => s.id === selectedSession.id) || selectedSession;
    if (!session.sources || session.sources.length === 0) {
      alert("Please add at least one source before generating materials.");
      return;
    }

    setIsGeneratingOutput(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const sourcesContext = session.sources.map(s => {
        const content = s.source_type === 'link' ? s.source_content.url : s.source_content.name;
        return `[Source Type: ${s.source_type}] Content/Reference: ${content}`;
      }).join("\n");
      
      let typeSpecificPrompt = "";
      switch(type) {
        case "Notes":
          typeSpecificPrompt = "Generate comprehensive, well-structured study notes. Use clear headings, bullet points, and bold key terms. Include a summary at the end.";
          break;
        case "Quiz":
          typeSpecificPrompt = "Generate a 10-question multiple-choice quiz. For each question, provide 4 options (A, B, C, D) and indicate the correct answer with an explanation.";
          break;
        case "Flashcards":
          typeSpecificPrompt = "Generate a set of 15 flashcards. Each flashcard should have a 'Front' (term or question) and a 'Back' (definition or answer). Format them clearly.";
          break;
        case "Slides":
          typeSpecificPrompt = "Generate an outline for a presentation (approx 8-10 slides). For each slide, provide a title and 3-5 key bullet points for the content.";
          break;
        default:
          typeSpecificPrompt = `Generate a high-quality ${type} based on the provided context.`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are an expert educator and instructional designer. 
        
        Your task is to generate: ${type}
        
        Context from provided sources:
        ${sourcesContext}
        
        Instructions:
        ${typeSpecificPrompt}
        
        Format requirements:
        - Use clean Markdown for all formatting.
        - Ensure the tone is professional yet accessible for students.
        - Focus on the most important concepts from the sources.
        - Return ONLY the generated content text.`,
      });

      const content = response.text || `Failed to generate ${type}. Please try again.`;
      
      const { data, error } = await supabase
        .from('outputs')
        .insert([
          {
            session_id: session.id,
            output_type: type,
            output_content: { text: content },
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (error) throw error;

      // Update local state for immediate feedback
      setSelectedSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          outputs: [...(prev.outputs || []), data]
        };
      });
    } catch (error: any) {
      alert("Failed to generate output: " + error.message);
    } finally {
      setIsGeneratingOutput(false);
    }
  };

  const deleteOutput = async (outputId: string) => {
    if (!confirm("Are you sure you want to delete this material?")) return;
    
    try {
      const { error } = await supabase
        .from('outputs')
        .delete()
        .eq('id', outputId);
      
      if (error) throw error;

      // Update local state
      setSelectedSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          outputs: prev.outputs?.filter(o => o.id !== outputId)
        };
      });
    } catch (error: any) {
      alert("Failed to delete material: " + error.message);
    }
  };

  const deleteSource = async (sourceId: string) => {
    if (!confirm("Are you sure you want to delete this source?")) return;
    
    try {
      const { error } = await supabase
        .from('sources')
        .delete()
        .eq('id', sourceId);
      
      if (error) throw error;

      // Update local state
      setSelectedSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          sources: prev.sources?.filter(s => s.id !== sourceId)
        };
      });
    } catch (error: any) {
      alert("Failed to delete source: " + error.message);
    }
  };

  const WorkspaceView = () => {
    // Get the latest session data from the sessions array
    const session = sessions.find(s => s.id === selectedSession?.id) || selectedSession;

    return (
      <div className="min-h-screen bg-white">
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setView("dashboard")}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="font-bold leading-tight text-sm">{session?.session_name}</h2>
                  <p className="text-[10px] text-gray-400">Workspace</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 text-xs font-bold hover:bg-gray-50 rounded-lg transition-colors">Share</button>
              <button className="px-3 py-1.5 bg-black text-white text-xs font-bold rounded-lg hover:bg-gray-800 transition-colors">Export</button>
            </div>
          </div>
        </nav>

        <main className="pt-24 pb-16 px-6 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Sources Sidebar */}
            <div className="lg:col-span-3 space-y-5">
              <div className="p-5 bg-gray-50 rounded-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-bold flex items-center gap-2 text-sm">
                    <Layers className="w-3.5 h-3.5" /> Sources
                  </h3>
                  <button 
                    onClick={() => setIsAddSourceOpen(true)}
                    className="p-1 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-2.5">
                  {session?.sources?.map((source, i) => (
                    <div key={`${source.id}-${i}`} className="p-2.5 bg-white rounded-lg border border-gray-100 flex items-center justify-between group hover:border-black transition-colors">
                      <div className="flex items-center gap-2.5 truncate">
                        {source.source_type === 'pdf' ? (
                          <FileText className="w-3.5 h-3.5 text-gray-400 group-hover:text-black" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-black" />
                        )}
                        <span className="text-xs font-medium truncate">
                          {source.source_content.name || source.source_content.url}
                        </span>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteSource(source.id); }}
                        className="p-1 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  {(!session?.sources || session.sources.length === 0) && (
                    <p className="text-[10px] text-gray-400 text-center py-3">No sources added</p>
                  )}
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-9 space-y-6">
              {/* Output Generation Tools */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {["Notes", "Slides", "Quiz", "Flashcards"].map((tool) => (
                  <button 
                    key={tool} 
                    onClick={() => generateOutput(tool)}
                    disabled={isGeneratingOutput}
                    className="p-3 bg-gray-50 hover:bg-black hover:text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingOutput ? (
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    {tool}
                  </button>
                ))}
              </div>

              {/* Generated Outputs List */}
              <div className="space-y-5">
                <h3 className="text-lg font-bold">Generated Materials</h3>
                {session?.outputs && session.outputs.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {session.outputs.map((output, i) => (
                      <motion.div 
                        key={`${output.id}-${i}`}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-all"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 bg-gray-50 rounded-lg flex items-center justify-center">
                              <FileText className="w-3.5 h-3.5 text-black" />
                            </div>
                            <h4 className="font-bold text-sm">{output.output_type}</h4>
                          </div>
                          <button 
                            onClick={() => deleteOutput(output.id)}
                            className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed mb-3 line-clamp-3">
                          {output.output_content.text}
                        </p>
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>Generated on {new Date(output.created_at).toLocaleDateString()}</span>
                          <button 
                            onClick={() => setSelectedOutput(output)}
                            className="font-bold text-black hover:underline"
                          >
                            View Full
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 border-2 border-dashed border-gray-100 rounded-[40px] flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mb-6">
                      <Zap className="w-8 h-8 text-gray-300" />
                    </div>
                    <h2 className="text-2xl font-bold mb-3">No materials generated yet</h2>
                    <p className="text-gray-500 max-w-md">
                      Select a tool above to generate notes, slides, or quizzes based on your sources.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white selection:bg-black selection:text-white">
      {schemaError && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 md:p-6">
          <div className="max-w-2xl w-full bg-white rounded-[40px] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-8 md:p-12 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                </div>
                <h2 className="text-2xl font-bold">Database Setup Required</h2>
              </div>
              <button 
                onClick={() => setSchemaError(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-8 md:p-12 overflow-y-auto flex-1 bg-white">
              <p className="text-gray-500 mb-8 leading-relaxed">
                The Supabase tables for your application are missing or outdated. 
                Please copy the SQL below and run it in your <strong>Supabase SQL Editor</strong>. 
                <br/><br/>
                <span className="text-red-500 font-medium">Note: This will reset your tables to ensure they have the correct columns (like <code>firebase_uid</code>).</span>
              </p>
              
              <div className="bg-gray-50 rounded-2xl p-6 mb-8 font-mono text-xs overflow-auto max-h-60 border border-gray-100 relative group">
                <button 
                  onClick={() => {
                    const sql = `-- SQL Schema for DeepLearn (Supabase)
-- WARNING: This will drop existing tables to ensure a clean setup.
DROP TABLE IF EXISTS public.outputs;
DROP TABLE IF EXISTS public.sources;
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.users;

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_content JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    output_type TEXT NOT NULL,
    output_content JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to users" ON public.users FOR ALL USING (true);
CREATE POLICY "Allow all access to sessions" ON public.sessions FOR ALL USING (true);
CREATE POLICY "Allow all access to sources" ON public.sources FOR ALL USING (true);
CREATE POLICY "Allow all access to outputs" ON public.outputs FOR ALL USING (true);`;
                    navigator.clipboard.writeText(sql);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="absolute top-4 right-4 p-2 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-all z-10 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider"
                >
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy SQL"}
                </button>
                <pre className="whitespace-pre-wrap">
{`-- SQL Schema for DeepLearn (Supabase)
-- WARNING: This will drop existing tables to ensure a clean setup.
DROP TABLE IF EXISTS public.outputs;
DROP TABLE IF EXISTS public.sources;
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.users;

CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_content JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    output_type TEXT NOT NULL,
    output_content JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to users" ON public.users FOR ALL USING (true);
CREATE POLICY "Allow all access to sessions" ON public.sessions FOR ALL USING (true);
CREATE POLICY "Allow all access to sources" ON public.sources FOR ALL USING (true);
CREATE POLICY "Allow all access to outputs" ON public.outputs FOR ALL USING (true);`}
                </pre>
              </div>
            </div>
            
            <div className="p-8 md:p-12 bg-gray-50 border-t border-gray-100 flex gap-3 shrink-0">
              <button 
                onClick={() => setSchemaError(null)}
                className="flex-1 py-4 border border-gray-200 rounded-2xl font-bold hover:bg-gray-100 transition-all text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={() => window.location.reload()}
                className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg shadow-black/10 text-sm"
              >
                I've run the SQL, reload app
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {view === "landing" && <LandingView key="landing" />}
        {view === "login" && <AuthView key="login" mode="login" />}
        {view === "signup" && <AuthView key="signup" mode="signup" />}
        {view === "dashboard" && user && <DashboardView key="dashboard" />}
        {view === "workspace" && <WorkspaceView key="workspace" />}
      </AnimatePresence>

      {/* Output Detail Modal */}
      <AnimatePresence key="output-detail-presence">
        {selectedOutput && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOutput(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center">
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">{selectedOutput.output_type}</h2>
                    <p className="text-sm text-gray-400">Generated Material</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => copyToClipboard(selectedOutput.output_content.text)}
                    className="p-3 hover:bg-gray-50 rounded-xl transition-all flex items-center gap-2 text-sm font-bold"
                  >
                    {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button 
                    onClick={() => {
                      const blob = new Blob([selectedOutput.output_content.text], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${selectedOutput.output_type.toLowerCase()}-${selectedOutput.id.slice(0, 8)}.md`;
                      a.click();
                    }}
                    className="p-3 hover:bg-gray-50 rounded-xl transition-all flex items-center gap-2 text-sm font-bold"
                  >
                    <Download className="w-5 h-5" />
                    Download
                  </button>
                  <button 
                    onClick={() => setSelectedOutput(null)}
                    className="p-3 hover:bg-gray-50 rounded-xl transition-all"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 md:p-12">
                <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-4xl prose-h2:text-3xl prose-h3:text-2xl prose-p:text-gray-600 prose-p:leading-relaxed prose-li:text-gray-600">
                  <Markdown>{selectedOutput.output_content.text}</Markdown>
                </div>
              </div>

              <div className="p-8 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                <span>Created on {new Date(selectedOutput.created_at).toLocaleString()}</span>
                <span>DeepLearn AI Engine</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Profile Modal */}
      <AnimatePresence key="edit-profile-presence">
        {isEditProfileOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditProfileOpen(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-gray-100 bg-white shrink-0">
                <h2 className="text-2xl font-bold">Edit Profile</h2>
              </div>
              
              <div className="p-8 overflow-y-auto flex-1 bg-white">
                <form onSubmit={handleUpdateProfile} id="edit-profile-form" className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
                    <input 
                      type="text" 
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      placeholder="Your Name"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-black focus:ring-0 transition-all outline-none"
                      required
                    />
                  </div>
                </form>
              </div>

              <div className="p-8 bg-gray-50 border-t border-gray-100 flex gap-3 shrink-0">
                <button 
                  type="button"
                  onClick={() => setIsEditProfileOpen(false)}
                  className="flex-1 py-3 border border-gray-200 rounded-xl font-bold hover:bg-gray-100 transition-all text-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  form="edit-profile-form"
                  className="flex-1 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all text-sm"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Source Modal */}
      <AnimatePresence key="add-source-presence">
        {isAddSourceOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddSourceOpen(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 md:p-8 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold">Add Sources</h2>
                  <p className="text-gray-500 text-xs md:text-sm">Upload materials to start your teaching session</p>
                </div>
                <button 
                  onClick={() => setIsAddSourceOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>

              <div className="p-6 md:p-8 overflow-y-auto flex-1 bg-white">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  <div className="space-y-4">
                    <button 
                      onClick={() => setPendingSource({ type: 'pdf', content: { name: sourceInput || 'Lecture_Notes.pdf' } })}
                      className={`w-full p-6 border-2 border-dashed rounded-2xl transition-all text-left group ${pendingSource?.type === 'pdf' ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-black hover:bg-gray-50'}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-colors ${pendingSource?.type === 'pdf' ? 'bg-black' : 'bg-gray-50 group-hover:bg-black'}`}>
                        <Upload className={`w-5 h-5 transition-colors ${pendingSource?.type === 'pdf' ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
                      </div>
                      <h4 className="font-bold mb-1">Upload Files</h4>
                      <p className="text-xs text-gray-400">PDF, DOCX, TXT up to 20MB</p>
                    </button>
                    {pendingSource?.type === 'pdf' && (
                      <input 
                        type="text"
                        placeholder="File name..."
                        value={sourceInput}
                        onChange={(e) => {
                          setSourceInput(e.target.value);
                          setPendingSource(prev => prev ? { ...prev, content: { ...prev.content, name: e.target.value } } : null);
                        }}
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black outline-none text-sm"
                      />
                    )}
                  </div>
                  <div className="space-y-4">
                    <button 
                      onClick={() => setPendingSource({ type: 'link', content: { url: sourceInput || 'https://wikipedia.org/article' } })}
                      className={`w-full p-6 border-2 border-dashed rounded-2xl transition-all text-left group ${pendingSource?.type === 'link' ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-black hover:bg-gray-50'}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-colors ${pendingSource?.type === 'link' ? 'bg-black' : 'bg-gray-50 group-hover:bg-black'}`}>
                        <ExternalLink className={`w-5 h-5 transition-colors ${pendingSource?.type === 'link' ? 'text-white' : 'text-gray-400 group-hover:text-white'}`} />
                      </div>
                      <h4 className="font-bold mb-1">Website URL</h4>
                      <p className="text-xs text-gray-400">Import content from any article</p>
                    </button>
                    {pendingSource?.type === 'link' && (
                      <input 
                        type="url"
                        placeholder="https://..."
                        value={sourceInput}
                        onChange={(e) => {
                          setSourceInput(e.target.value);
                          setPendingSource(prev => prev ? { ...prev, content: { ...prev.content, url: e.target.value } } : null);
                        }}
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black outline-none text-sm"
                      />
                    )}
                  </div>
                </div>

                {pendingSource && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 p-4 bg-black text-white rounded-2xl flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      {pendingSource.type === 'pdf' ? <FileText className="w-5 h-5" /> : <ExternalLink className="w-5 h-5" />}
                      <span className="text-sm font-medium">Source added: {pendingSource.content.name || pendingSource.content.url}</span>
                    </div>
                    <button onClick={() => setPendingSource(null)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}

                <div className="bg-gray-50 rounded-2xl p-6 mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <Zap className="w-5 h-5 text-black" />
                    <h4 className="font-bold">AI Processing Placeholder</h4>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Once you add your sources, our AI will analyze them to automatically name your session and prepare your workspace. This part is currently a placeholder.
                  </p>
                </div>
              </div>

              <div className="p-6 md:p-8 bg-gray-50 border-t border-gray-100 flex gap-3 shrink-0">
                <button 
                  onClick={() => setIsAddSourceOpen(false)}
                  className="flex-1 py-4 border border-gray-200 rounded-2xl font-bold hover:bg-gray-100 transition-all text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddSource}
                  disabled={isCreatingSession || !pendingSource}
                  className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isCreatingSession ? "Processing..." : (view === "workspace" ? "Add Source" : "Create Session")}
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {syncError && (
        <div className="fixed bottom-6 right-6 z-[200] max-w-md w-full bg-white rounded-2xl p-6 shadow-2xl border border-red-100 flex items-start gap-4 animate-in slide-in-from-right duration-300">
          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 mb-1">Sync Error</h3>
            <p className="text-sm text-gray-500 mb-3">{syncError}</p>
            <button 
              onClick={() => {
                setSyncError(null);
                window.location.reload();
              }}
              className="text-xs font-bold text-red-600 hover:underline"
            >
              Try Reloading
            </button>
          </div>
          <button onClick={() => setSyncError(null)} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

