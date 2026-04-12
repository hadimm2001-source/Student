import React, { useState, useEffect, Component, ReactNode } from 'react';
import { 
  Users, CheckCircle, XCircle, Clock, Search, Filter, 
  FileSpreadsheet, FileText, Download, Upload, Trash2, 
  MessageSquare, Sparkles, LogOut, ChevronRight, Map, Zap, GraduationCap,
  Printer, Share2, Copy, AlertCircle, Settings, Calendar, FileDown, BarChart3, UserX,
  LayoutGrid, CalendarCheck, User, ShieldCheck, ArrowLeft, Info, HelpCircle, Bell, FilePlus, AlertTriangle, Send, Paperclip
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase';
import { collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, getDocs, where, setDoc } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { GoogleGenAI } from "@google/genai";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// --- Types ---
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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
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
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, errorInfo: '' };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let isFirestoreError = false;
      let parsedError: any = null;
      try {
        parsedError = JSON.parse(this.state.errorInfo);
        if (parsedError.operationType) isFirestoreError = true;
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-red-100">
            <AlertTriangle size={64} className="text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-black text-slate-900 mb-2">عذراً، حدث خطأ ما</h2>
            <p className="text-slate-600 mb-6">
              {isFirestoreError 
                ? "حدث خطأ في الاتصال بقاعدة البيانات. يرجى التأكد من صلاحيات الوصول."
                : "حدث خطأ غير متوقع في التطبيق."}
            </p>
            {isFirestoreError && (
              <div className="text-left bg-slate-50 p-4 rounded-lg mb-6 overflow-auto max-h-40">
                <code className="text-[10px] text-slate-500">
                  {JSON.stringify(parsedError, null, 2)}
                </code>
              </div>
            )}
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

interface Excuse {
  id: string;
  type: string;
  detail: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  fileName?: string;
  fileUrl?: string;
}

interface Student {
  id: string;
  name: string;
  phone: string;
  class: string;
  status: 'present' | 'absent' | 'late' | 'excused' | 'none';
  time: string;
  absentCount: number;
  excuses?: Excuse[];
}

interface AttendanceHistory {
  [date: string]: Student[];
}

// --- Constants ---
const ADMIN_PASSWORD = "hadi";
const STORAGE_KEY = 'attendance_saas_data';
const HISTORY_KEY = 'attendance_saas_history';

// --- App Component ---
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [view, setView] = useState<'login' | 'admin' | 'student'>('login');
  const [isAdmin, setIsAdmin] = useState(false);
  const [studentPhone, setStudentPhone] = useState('');
  const [loggedInStudent, setLoggedInStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceHistory>({});
  const [absenceThreshold, setAbsenceThreshold] = useState(3);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Request notification permission for admin
  useEffect(() => {
    if (isAdmin && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
          setNotificationsEnabled(permission === "granted");
        });
      } else {
        setNotificationsEnabled(Notification.permission === "granted");
      }
    }
  }, [isAdmin]);

  const sendAdminNotification = (title: string, body: string) => {
    if (notificationsEnabled) {
      try {
        new Notification(title, { 
          body, 
          icon: 'https://cdn-icons-png.flaticon.com/512/3119/3119338.png',
          badge: 'https://cdn-icons-png.flaticon.com/512/3119/3119338.png'
        });
      } catch (e) {
        console.error("Failed to show browser notification:", e);
      }
    }
  };

  // Load initial data from Firestore for real-time sync
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && user.email === "hadimm2001@gmail.com") {
        setIsAdmin(true);
        setView('admin');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!db) return;

    // Test connection
    const testConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, 'app_data', 'state'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    try {
      const unsub = onSnapshot(doc(db, 'app_data', 'state'), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.students) setStudents(data.students);
          if (data.history) setAttendanceHistory(data.history);
          if (data.settings?.absenceThreshold) setAbsenceThreshold(data.settings.absenceThreshold);
        }
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'app_data/state');
        setLoading(false);
      });
      return () => unsub();
    } catch (err) {
      console.error("Error setting up Firestore listener:", err);
      setLoading(false);
    }
  }, []);

  // Save data to Firestore helper
  const saveData = async (newStudents: Student[], newHistory: AttendanceHistory, settings?: any) => {
    if (!db) return;
    try {
      const updateData: any = {
        students: newStudents,
        history: newHistory,
        lastUpdated: new Date().toISOString()
      };
      if (settings) updateData.settings = settings;
      
      await setDoc(doc(db, 'app_data', 'state'), updateData, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'app_data/state');
    }
  };

  const updateStatus = (id: string, status: Student['status']) => {
    const time = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    let updatedStudent: Student | null = null;
    
    const newStudents = students.map(s => {
      if (s.id === id) {
        let absentCount = s.absentCount;
        if ((status === 'absent' || status === 'excused') && s.status !== 'absent' && s.status !== 'excused') {
          absentCount++;
          // Threshold check
          if (absentCount >= absenceThreshold) {
            sendAdminNotification(
              "تنبيه: تجاوز حد الغياب",
              `الطالب ${s.name} وصل إلى ${absentCount} أيام غياب.`
            );
          }
        }
        if ((s.status === 'absent' || s.status === 'excused') && status !== 'absent' && status !== 'excused') absentCount = Math.max(0, absentCount - 1);
        
        updatedStudent = { ...s, status, time, absentCount };
        return updatedStudent;
      }
      return s;
    });

    setStudents(newStudents);
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    saveData(newStudents, newHistory);
    return updatedStudent; // Return for notification
  };

  const markBulk = (status: Student['status'], filteredIds: string[]) => {
    const time = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    const newStudents = students.map(s => {
      if (filteredIds.includes(s.id)) {
        let absentCount = s.absentCount;
        if ((status === 'absent' || status === 'excused') && s.status !== 'absent' && s.status !== 'excused') {
          absentCount++;
          if (absentCount >= absenceThreshold) {
            sendAdminNotification(
              "تنبيه: تجاوز حد الغياب",
              `الطالب ${s.name} وصل إلى ${absentCount} أيام غياب.`
            );
          }
        }
        if ((s.status === 'absent' || s.status === 'excused') && status !== 'absent' && status !== 'excused') absentCount = Math.max(0, absentCount - 1);
        return { ...s, status, time, absentCount };
      }
      return s;
    });

    setStudents(newStudents);
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    saveData(newStudents, newHistory);
  };

  const deleteStudent = (id: string) => {
    const newStudents = students.filter(s => s.id !== id);
    setStudents(newStudents);
    const today = new Date().toISOString().split('T')[0];
    const newHistory = { ...attendanceHistory, [today]: newStudents };
    setAttendanceHistory(newHistory);
    saveData(newStudents, newHistory);
  };

  const handleExcuseAction = (studentId: string, excuseId: string, action: 'approved' | 'rejected') => {
    const newStudents = students.map(s => {
      if (s.id === studentId) {
        const updatedExcuses = (s.excuses || []).map(e => e.id === excuseId ? { ...e, status: action } : e);
        return { ...s, excuses: updatedExcuses };
      }
      return s;
    });
    setStudents(newStudents);
    saveData(newStudents, attendanceHistory);
  };

  const handleBulkExcuseAction = (updates: { studentId: string, excuseId: string }[], action: 'approved' | 'rejected') => {
    const newStudents = students.map(s => {
      const studentUpdates = updates.filter(u => u.studentId === s.id);
      if (studentUpdates.length > 0) {
        const updatedExcuses = (s.excuses || []).map(e => {
          const update = studentUpdates.find(u => u.excuseId === e.id);
          return update ? { ...e, status: action } : e;
        });
        return { ...s, excuses: updatedExcuses };
      }
      return s;
    });
    setStudents(newStudents);
    saveData(newStudents, attendanceHistory);
  };

  const handleAdminLogin = async (password: string) => {
    if (password === ADMIN_PASSWORD) {
      // Check if already logged in with the correct email to avoid popup
      if (auth.currentUser && auth.currentUser.email === "hadimm2001@gmail.com") {
        setIsAdmin(true);
        setView('admin');
        return;
      }

      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        setIsAdmin(true);
        setView('admin');
      } catch (error) {
        console.error("Login error:", error);
        alert("فشل تسجيل الدخول عبر جوجل");
      }
    } else {
      alert("كلمة المرور غير صحيحة");
    }
  };

  const handleStudentLogin = (phone: string) => {
    const student = students.find(s => s.phone === phone);
    if (student) {
      setLoggedInStudent(student);
      setView('student');
    } else {
      alert("رقم الجوال غير مسجل");
    }
  };

  const handleLogout = () => {
    setView('login');
    setIsAdmin(false);
    setLoggedInStudent(null);
    setStudentPhone('');
  };

  const deleteHistoryRecord = (studentPhone: string, date: string) => {
    const newHistory = { ...attendanceHistory };
    if (newHistory[date]) {
      newHistory[date] = newHistory[date].filter(s => s.phone !== studentPhone);
      if (newHistory[date].length === 0) {
        delete newHistory[date];
      }
    }
    setAttendanceHistory(newHistory);
    saveData(students, newHistory);
  };

  const updateStudentExcuses = (studentId: string, excuses: Excuse[]) => {
    const newStudents = students.map(s => s.id === studentId ? { ...s, excuses } : s);
    setStudents(newStudents);
    saveData(newStudents, attendanceHistory);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="loader-spinner"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b]">
      <AnimatePresence mode="wait">
        {view === 'login' && (
          <LoginView 
            onAdminLogin={handleAdminLogin} 
            onStudentLogin={handleStudentLogin} 
          />
        )}
        {view === 'admin' && (
          <AdminDashboard 
            students={students} 
            attendanceHistory={attendanceHistory}
            onUpdateStatus={updateStatus}
            onMarkBulk={markBulk}
            onDeleteStudent={deleteStudent}
            onExcuseAction={handleExcuseAction}
            onBulkExcuseAction={handleBulkExcuseAction}
            onImportStudents={(newS) => {
              setStudents(newS);
              saveData(newS, attendanceHistory);
            }}
            onUpdateThreshold={(val) => {
              setAbsenceThreshold(val);
              saveData(students, attendanceHistory, { absenceThreshold: val });
            }}
            absenceThreshold={absenceThreshold}
            notificationsEnabled={notificationsEnabled}
            onLogout={handleLogout} 
          />
        )}
        {view === 'student' && loggedInStudent && (
          <StudentPortal 
            student={loggedInStudent} 
            students={students}
            history={attendanceHistory}
            onDeleteRecord={deleteHistoryRecord}
            onUpdateExcuses={updateStudentExcuses}
            onLogout={handleLogout} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Login View ---
function LoginView({ onAdminLogin, onStudentLogin }: { 
  onAdminLogin: (p: string) => void, 
  onStudentLogin: (p: string) => void 
}) {
  const [mode, setMode] = useState<'student' | 'admin'>('student');
  const [input, setInput] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="login-container flex items-center justify-center min-h-screen bg-[#f1f5f9] p-4"
    >
      <div className="login-card max-w-[480px] w-full bg-white p-10 md:p-16 rounded-[40px] shadow-2xl shadow-slate-200/60 border border-slate-50 flex flex-col items-center">
        {/* Isometric Stack Logo */}
        <div className="mb-12">
          <svg width="100" height="100" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M40 15L65 27.5L40 40L15 27.5L40 15Z" fill="#6366f1" fillOpacity="0.8" />
            <path d="M15 35L40 47.5L65 35V40L40 52.5L15 40V35Z" fill="#6366f1" />
            <path d="M15 45L40 57.5L65 45V50L40 62.5L15 50V45Z" fill="#6366f1" />
          </svg>
        </div>

        <h1 className="text-[32px] font-medium text-[#0f172a] mb-3 text-center leading-tight">بوابة الحضور والانضباط</h1>
        <p className="text-[#94a3b8] font-medium text-lg mb-14 text-center">مدرسة الجشة المتوسطة</p>

        <div className="w-full space-y-12">
          <div className="w-full">
            <label className="block text-[#475569] font-medium text-base mb-4 text-right mr-1">
              {mode === 'student' ? 'رقم الجوال المسجل:' : 'كلمة مرور الإدارة:'}
            </label>
            <input 
              type={mode === 'student' ? 'tel' : 'password'}
              className="w-full bg-white border-2 border-[#f1f5f9] rounded-2xl px-8 py-6 text-[#1e293b] font-medium text-lg focus:border-indigo-500 transition-all outline-none text-right placeholder-[#cbd5e1] shadow-sm"
              placeholder={mode === 'student' ? 'أدخل رقم الجوال (مثل: 05...)' : '••••••••'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (mode === 'student' ? onStudentLogin(input) : onAdminLogin(input))}
            />
          </div>
          
          <button 
            className={`w-full py-6 rounded-2xl font-medium text-2xl shadow-xl transition-all flex items-center justify-center gap-4 active:scale-[0.98] ${
              mode === 'student' 
                ? 'bg-[#10b981] hover:bg-[#059669] text-white shadow-emerald-100' 
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
            }`}
            onClick={() => mode === 'student' ? onStudentLogin(input) : onAdminLogin(input)}
          >
            <span className="text-white">
              {mode === 'student' ? 'استعلام عن الطالب' : 'دخول النظام'}
            </span>
            <Search size={26} className="opacity-50" />
          </button>

          <div className="text-center pt-4">
            <button 
              onClick={() => {
                setMode(mode === 'student' ? 'admin' : 'student');
                setInput('');
              }}
              className="text-[#94a3b8] hover:text-indigo-600 font-medium text-base transition-colors"
            >
              {mode === 'student' ? 'دخول الإدارة' : 'العودة لبوابة الطالب'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// --- Admin Dashboard ---
function AdminDashboard({ 
  students, 
  attendanceHistory, 
  onUpdateStatus, 
  onMarkBulk, 
  onDeleteStudent, 
  onExcuseAction, 
  onBulkExcuseAction,
  onImportStudents, 
  onUpdateThreshold,
  absenceThreshold,
  notificationsEnabled,
  onLogout 
}: { 
  students: Student[], 
  attendanceHistory: AttendanceHistory,
  onUpdateStatus: (id: string, status: Student['status']) => Student | null,
  onMarkBulk: (status: Student['status'], ids: string[]) => void,
  onDeleteStudent: (id: string) => void,
  onExcuseAction: (studentId: string, excuseId: string, action: 'approved' | 'rejected') => void,
  onBulkExcuseAction: (updates: { studentId: string, excuseId: string }[], action: 'approved' | 'rejected') => void,
  onImportStudents: (s: Student[]) => void,
  onUpdateThreshold: (val: number) => void,
  absenceThreshold: number,
  notificationsEnabled: boolean,
  onLogout: () => void
}) {
  const [activeAdminTab, setActiveAdminTab] = useState<'attendance' | 'excuses'>('attendance');
  const [filter, setFilter] = useState({ search: '', classes: [] as string[], status: 'all' });
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [showReportsDropdown, setShowReportsDropdown] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [reportType, setReportType] = useState<'daily' | 'monthly' | 'student' | 'warning' | null>(null);
  const [selectedStudentForAi, setSelectedStudentForAi] = useState<Student | null>(null);
  const [selectedStudentForJourney, setSelectedStudentForJourney] = useState<Student | null>(null);
  const [statusChangeNotification, setStatusChangeNotification] = useState<{ student: Student, type: 'absent' | 'late' } | null>(null);
  const [aiMessage, setAiMessage] = useState('');
  const [aiMessageLoading, setAiMessageLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [studentsToRemind, setStudentsToRemind] = useState<{ student: Student, status: string }[]>([]);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [excuseStatusFilter, setExcuseStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [excuseSearch, setExcuseSearch] = useState('');
  const [excuseSortBy, setExcuseSortBy] = useState<'date' | 'name' | 'status'>('date');
  const [selectedExcuses, setSelectedExcuses] = useState<string[]>([]);
  const [viewingAttachment, setViewingAttachment] = useState<{ url: string, name: string } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<Student[]>([]);
  const adminName = "عبدالهادي المحسن";

  const allExcuses = students.flatMap(s => (s.excuses || []).map(e => ({ ...e, studentName: s.name, studentId: s.id, studentClass: s.class })));
  const pendingExcusesCount = allExcuses.filter(e => e.status === 'pending').length;
  
  const filteredExcuses = allExcuses.filter(e => {
    const matchesStatus = excuseStatusFilter === 'all' || e.status === excuseStatusFilter;
    const matchesSearch = e.studentName.includes(excuseSearch) || e.detail.includes(excuseSearch);
    return matchesStatus && matchesSearch;
  }).sort((a, b) => {
    if (excuseSortBy === 'date') return new Date(b.date).getTime() - new Date(a.date).getTime();
    if (excuseSortBy === 'name') return a.studentName.localeCompare(b.studentName);
    if (excuseSortBy === 'status') return a.status.localeCompare(b.status);
    return 0;
  });

  const handleBulkExcuseAction = (action: 'approved' | 'rejected') => {
    if (selectedExcuses.length === 0) {
      alert('يرجى اختيار أعذار أولاً');
      return;
    }
    
    if (confirm(`هل أنت متأكد من ${action === 'approved' ? 'قبول' : 'رفض'} ${selectedExcuses.length} أعذار؟`)) {
      const updates = selectedExcuses.map(id => {
        const excuse = allExcuses.find(e => e.id === id);
        return excuse ? { studentId: excuse.studentId, excuseId: excuse.id } : null;
      }).filter(Boolean) as { studentId: string, excuseId: string }[];

      onBulkExcuseAction(updates, action);
      setSelectedExcuses([]);
      alert('تم تحديث الأعذار بنجاح');
    }
  };

  const toggleExcuseSelection = (id: string) => {
    setSelectedExcuses(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleAllExcusesSelection = () => {
    if (selectedExcuses.length === filteredExcuses.length) {
      setSelectedExcuses([]);
    } else {
      setSelectedExcuses(filteredExcuses.map(e => e.id));
    }
  };

  const handleExcuseAction = (studentId: string, excuseId: string, action: 'approved' | 'rejected') => {
    onExcuseAction(studentId, excuseId, action);
  };

  const filteredStudents = students.filter(s => {
    const matchSearch = s.name.includes(filter.search) || s.phone.includes(filter.search);
    const matchClass = filter.classes.length === 0 || filter.classes.includes(s.class);
    const matchStatus = filter.status === 'all' || s.status === filter.status;
    return matchSearch && matchClass && matchStatus;
  });

  const classes = Array.from(new Set(students.map(s => s.class))).sort();

  const toggleClassFilter = (cls: string) => {
    setFilter(prev => ({
      ...prev,
      classes: prev.classes.includes(cls) 
        ? prev.classes.filter(c => c !== cls) 
        : [...prev.classes, cls]
    }));
  };

  const generateParentMessage = async (student: Student) => {
    setSelectedStudentForAi(student);
    setAiMessageLoading(true);
    setAiMessage('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      const prompt = `اكتب رسالة واتساب قصيرة ومهذبة لولي أمر الطالب ${student.name} تخبره فيها أن الطالب ${student.status === 'absent' ? 'غائب' : 'متأخر'} اليوم. اطلب منه التعاون للحرص على انضباط الطالب.`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setAiMessage(response.text || "لا يمكن صياغة الرسالة حالياً.");
    } catch (error) {
      console.error(error);
      setAiMessage("حدث خطأ أثناء صياغة الرسالة.");
    }
    setAiMessageLoading(false);
  };

  const updateStatus = (id: string, status: Student['status']) => {
    const updatedStudent = onUpdateStatus(id, status);
    if (updatedStudent && (status === 'absent' || status === 'late')) {
      setStatusChangeNotification({ student: updatedStudent, type: status });
    }
  };

  const markBulk = (status: Student['status']) => {
    const ids = filteredStudents.map(s => s.id);
    onMarkBulk(status, ids);
  };

  const deleteStudent = (id: string) => {
    onDeleteStudent(id);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const XLSX = (window as any).XLSX;
        
        if (!XLSX) {
          alert('خطأ: مكتبة XLSX غير متوفرة. يرجى تحديث الصفحة.');
          return;
        }

        const wb = XLSX.read(data, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (!rows || rows.length <= 1) {
          alert('الملف فارغ أو لا يحتوي على بيانات طلاب.');
          return;
        }

        // Try to find columns by header name or use defaults (0: phone, 1: class, 2: name)
        const headers = rows[0].map(h => String(h || '').trim());
        let phoneIdx = 0, classIdx = 1, nameIdx = 2;

        // Simple heuristic for headers
        headers.forEach((h, idx) => {
          if (h.includes('جوال') || h.includes('هاتف') || h.includes('phone')) phoneIdx = idx;
          if (h.includes('صف') || h.includes('فصل') || h.includes('class')) classIdx = idx;
          if (h.includes('اسم') || h.includes('طالب') || h.includes('name')) nameIdx = idx;
        });

        const newStudents: Student[] = rows.slice(1).map((row: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          phone: String(row[phoneIdx] || '').trim(),
          class: String(row[classIdx] || 'عام').trim(),
          name: String(row[nameIdx] || '').trim(),
          status: 'none' as Student['status'],
          time: '-',
          absentCount: 0
        })).filter((s: any) => s.name && s.phone);

        if (newStudents.length === 0) {
          alert('لم يتم العثور على طلاب. تأكد من وجود أعمدة (الاسم، الجوال، الصف).');
          return;
        }

        setPendingImportData(newStudents);
        setShowImportModal(true);
      } catch (error) {
        console.error("Import Error:", error);
        alert('حدث خطأ أثناء معالجة الملف.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImport = (mode: 'overwrite' | 'merge') => {
    if (mode === 'overwrite') {
      onImportStudents(pendingImportData);
    } else {
      // Merge: Update existing by phone, add new ones
      const existingPhones = new Set(students.map(s => s.phone));
      const mergedStudents = [...students];
      
      pendingImportData.forEach(newS => {
        const index = mergedStudents.findIndex(s => s.phone === newS.phone);
        if (index !== -1) {
          // Replace existing
          mergedStudents[index] = { ...mergedStudents[index], ...newS, id: mergedStudents[index].id };
        } else {
          // Add new
          mergedStudents.push(newS);
        }
      });
      
      onImportStudents(mergedStudents);
    }
    setShowImportModal(false);
    setPendingImportData([]);
    alert('تم استيراد البيانات بنجاح');
  };

  const generateAiAnalysis = async () => {
    setAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      const stats = {
        total: students.length,
        present: students.filter(s => s.status === 'present').length,
        absent: students.filter(s => s.status === 'absent').length,
        late: students.filter(s => s.status === 'late').length
      };

      const prompt = `حلل بيانات الحضور هذه لمدرسة: إجمالي الطلاب ${stats.total}، حاضر ${stats.present}، غائب ${stats.absent}، متأخر ${stats.late}. قدم توصيات للموجه الطلابي لتحسين الانضباط.`;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setAiAnalysis(response.text || "لا يمكن التحليل حالياً.");
    } catch (error) {
      console.error(error);
      setAiAnalysis("حدث خطأ أثناء التحليل الذكي.");
    }
    setAiLoading(false);
  };

  const prepareReminders = () => {
    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const yesterdayData = attendanceHistory[yesterdayStr] || [];
    
    const toRemind = students.filter(s => {
      const record = yesterdayData.find(r => r.phone === s.phone);
      if (record && record.status === 'absent') {
        // Check if there's an approved excuse for yesterday
        const hasExcuse = (s.excuses || []).some(e => e.date === yesterdayStr && e.status === 'approved');
        return !hasExcuse;
      }
      return false;
    }).map(s => ({ student: s, status: 'absent' }));

    setStudentsToRemind(toRemind);
    setShowReminderModal(true);
    setShowReportsDropdown(false);
  };

  const sendReminders = async () => {
    setSendingReminders(true);
    // Simulate API call for SMS/Email
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // In a real app, we would call an SMS/Email service here
    // For now, we'll just show success
    alert(`تم إرسال ${studentsToRemind.length} رسالة تذكير بنجاح عبر الرسائل النصية والبريد الإلكتروني.`);
    
    setSendingReminders(false);
    setShowReminderModal(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="container"
    >
      <header className="admin-header">
        <div className="header-main">
          <div className="header-brand">
            <div className="brand-icon">
              <ShieldCheck size={28} />
            </div>
            <div className="brand-text">
              <h1>نظام إدارة الحضور والغياب</h1>
              <span className="subtitle">الموجه الطلابي - مدرسة الجشة المتوسطة</span>
            </div>
          </div>

          <nav className="admin-nav">
            <button 
              onClick={() => setActiveAdminTab('attendance')}
              className={`nav-btn ${activeAdminTab === 'attendance' ? 'active' : ''}`}
            >
              <Users size={18} />
              <span>إدارة التحضير</span>
            </button>
            <button 
              onClick={() => setActiveAdminTab('excuses')}
              className={`nav-btn ${activeAdminTab === 'excuses' ? 'active' : ''}`}
            >
              <FileText size={18} />
              <span>سجل الأعذار</span>
              {pendingExcusesCount > 0 && (
                <span className="badge-count">{pendingExcusesCount}</span>
              )}
            </button>
          </nav>

          <div className="header-user-section">
            <div className="date-info">
              <span className="day">{new Date().toLocaleDateString('ar-SA', { weekday: 'long' })}</span>
              <span className="date">{new Date().toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' })}</span>
            </div>
            
            <div className="user-card">
              <div className="user-avatar">
                {adminName.charAt(0)}
              </div>
              <div className="user-info">
                <span className="user-name">{adminName}</span>
                <span className="user-role">الموجه الطلابي</span>
              </div>
            </div>

            <div className="header-actions">
              <button onClick={() => setShowSettingsModal(true)} className="icon-btn" title="الإعدادات">
                <Settings size={20} />
              </button>
              <button onClick={onLogout} className="logout-btn-new">
                <LogOut size={18} />
                <span>خروج</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {activeAdminTab === 'attendance' ? (
        <>
          {/* Stats */}
          <div className="stats-grid">
            <StatCard title="إجمالي الطلاب" value={students.length} icon={<Users />} color="primary" />
            <StatCard title="حاضر اليوم" value={students.filter(s => s.status === 'present').length} icon={<CheckCircle />} color="success" />
            <StatCard title="غائب اليوم" value={students.filter(s => s.status === 'absent').length} icon={<XCircle />} color="danger" />
            <StatCard title="متأخر اليوم" value={students.filter(s => s.status === 'late').length} icon={<Clock />} color="warning" />
            <StatCard title="بعذر اليوم" value={students.filter(s => s.status === 'excused').length} icon={<FileText />} color="info" />
          </div>

          {/* Controls */}
          <div className="controls-section">
            <div className="filters-row">
              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="ابحث باسم الطالب أو الجوال..." 
                  value={filter.search}
                  onChange={(e) => setFilter(prev => ({ ...prev, search: e.target.value }))}
                />
              </div>
              <div className="input-group relative group">
                <div className="flex flex-wrap gap-1 p-2 border border-slate-200 rounded-lg bg-slate-50 min-h-[42px]">
                  {filter.classes.length === 0 ? (
                    <span className="text-slate-400 text-sm">تصفية حسب الفصول...</span>
                  ) : (
                    filter.classes.map(c => (
                      <span key={c} className="bg-primary text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                        {c}
                        <button onClick={() => toggleClassFilter(c)} className="hover:text-red-200">×</button>
                      </span>
                    ))
                  )}
                </div>
                <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg mt-1 shadow-lg hidden group-hover:block max-h-48 overflow-y-auto">
                  {classes.map(c => (
                    <div 
                      key={c} 
                      className={`p-2 hover:bg-slate-50 cursor-pointer text-sm flex items-center justify-between ${filter.classes.includes(c) ? 'bg-blue-50 text-primary font-bold' : ''}`}
                      style={{
                        color: c.includes('أول') ? '#000000' : c.includes('ثاني') ? '#0077be' : c.includes('ثالث') ? '#4b0082' : 'inherit',
                        fontWeight: 'bold',
                        borderBottom: '1px solid #f1f5f9'
                      }}
                      onClick={() => toggleClassFilter(c)}
                    >
                      {c}
                      {filter.classes.includes(c) && <CheckCircle size={14} />}
                    </div>
                  ))}
                </div>
              </div>
              <div className="input-group">
                <select 
                  value={filter.status}
                  onChange={(e) => setFilter(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">جميع الحالات</option>
                  <option value="present">حاضر</option>
                  <option value="absent">غائب</option>
                  <option value="late">متأخر</option>
                  <option value="excused">بعذر</option>
                  <option value="none">لم يسجل</option>
                </select>
              </div>
            </div>
            <div className="actions-row justify-center">
              <div className="action-group">
                <button className="btn btn-success" onClick={() => markBulk('present')}>
                  <CheckCircle size={18} />
                  الكل حاضر
                </button>
                <button className="btn btn-danger" onClick={() => markBulk('absent')}>
                  <XCircle size={18} />
                  الكل غائب
                </button>
              </div>

              <div className="action-group">
                <div className="dropdown-container">
                  <button 
                    className="dropdown-trigger" 
                    onClick={() => setShowReportsDropdown(!showReportsDropdown)}
                  >
                    <BarChart3 size={18} />
                    التقارير والأدوات
                    <ChevronRight size={16} className={`transition-transform ${showReportsDropdown ? 'rotate-90' : ''}`} />
                  </button>
                  
                  <AnimatePresence>
                    {showReportsDropdown && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="dropdown-menu-custom"
                      >
                        <div className="dropdown-item-custom" onClick={() => { setReportType('daily'); setShowReportsDropdown(false); }}>
                          <span className="item-text">تقرير اليوم</span>
                          <div className="item-icon bg-orange-100 text-orange-600">
                            <FileText size={18} />
                          </div>
                        </div>
                        <div className="dropdown-item-custom" onClick={() => { setReportType('monthly'); setShowReportsDropdown(false); }}>
                          <span className="item-text">نطاق التاريخ</span>
                          <div className="item-icon bg-blue-100 text-blue-600">
                            <Calendar size={18} />
                          </div>
                        </div>
                        <div className="dropdown-item-custom" onClick={() => { setReportType('student'); setShowReportsDropdown(false); }}>
                          <span className="item-text">تقرير بالطالب</span>
                          <div className="item-icon bg-slate-100 text-slate-600">
                            <Users size={18} />
                          </div>
                        </div>
                        <div className="dropdown-item-custom" onClick={() => { setReportType('warning'); setShowReportsDropdown(false); }}>
                          <span className="item-text">تقرير الطلاب المنذرين</span>
                          <div className="item-icon bg-red-100 text-red-600">
                            <AlertCircle size={18} />
                          </div>
                        </div>
                        <div className="dropdown-item-custom" onClick={prepareReminders}>
                          <span className="item-text">إرسال تذكيرات آلية</span>
                          <div className="item-icon bg-purple-100 text-purple-600">
                            <Bell size={18} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                <button className="btn btn-warning-custom" onClick={() => setShowAbsenceModal(true)}>
                  <UserX size={18} />
                  الغيابات والتأخير
                </button>
              </div>

              <div className="action-group">
                <label className="btn btn-import-custom">
                  <Upload size={18} />
                  استيراد إكسل
                  <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImport} />
                </label>
              </div>
            </div>
          </div>

          {/* AI Analysis */}
          {aiAnalysis && (
            <div className="ai-box block mb-6">
              <div className="flex items-center gap-2 mb-2 text-purple-600 font-bold">
                <Sparkles size={18} />
                تحليل Gemini الذكي
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {aiAnalysis}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>اسم الطالب</th>
                  <th>رقم الجوال</th>
                  <th>الصف</th>
                  <th className="text-center">التحضير</th>
                  <th className="text-center">الوقت</th>
                  <th className="text-center">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(student => (
                  <tr key={student.id}>
                    <td>
                      <div className="student-name">
                        {student.name}
                        {student.absentCount > 3 && (
                          <span className="badge-warning">⚠️ غياب متكرر ({student.absentCount})</span>
                        )}
                      </div>
                    </td>
                    <td className="student-id text-2xl font-black" dir="ltr">{student.phone}</td>
                    <td>{student.class}</td>
                    <td>
                      <div className="status-toggles">
                        <button 
                          className={`toggle-btn ${student.status === 'present' ? 'active-present' : ''}`}
                          onClick={() => updateStatus(student.id, 'present')}
                        >حاضر</button>
                        <button 
                          className={`toggle-btn ${student.status === 'absent' ? 'active-absent' : ''}`}
                          onClick={() => updateStatus(student.id, 'absent')}
                        >غائب</button>
                        <button 
                          className={`toggle-btn ${student.status === 'late' ? 'active-late' : ''}`}
                          onClick={() => updateStatus(student.id, 'late')}
                        >تأخير</button>
                        <button 
                          className={`toggle-btn ${student.status === 'excused' ? 'active-excused' : ''}`}
                          onClick={() => updateStatus(student.id, 'excused')}
                        >بعذر</button>
                      </div>
                    </td>
                    <td className="text-center time-cell">{student.time}</td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        {(student.status === 'absent' || student.status === 'late') && (
                          <button 
                            className="p-2 text-purple-600 hover:bg-purple-50 rounded"
                            onClick={() => generateParentMessage(student)}
                            title="رسالة ذكية لولي الأمر"
                          >
                            <MessageSquare size={18} />
                          </button>
                        )}
                        <button className="delete-btn" onClick={() => deleteStudent(student.id)}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredStudents.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-20 text-slate-400 font-bold">
                      لا يوجد طلاب مسجلين حالياً. يمكنك استيراد قائمة الطلاب من ملف إكسل.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-100 p-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
            <div>
              <h2 className="text-2xl font-black mb-2">سجل الأعذار والمبررات</h2>
              <p className="text-slate-500">مراجعة واعتماد ومتابعة سجل الأعذار المقدمة من الطلاب</p>
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="relative flex-1 lg:flex-none">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="بحث في الأعذار..." 
                  className="bg-slate-100 border-none rounded-xl py-2.5 pr-10 pl-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 w-full lg:w-64"
                  value={excuseSearch}
                  onChange={(e) => setExcuseSearch(e.target.value)}
                />
              </div>
              
              <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                <Filter size={14} className="mr-2 text-slate-400" />
                <select 
                  className="bg-transparent border-none text-[11px] font-black text-slate-600 outline-none cursor-pointer pr-2"
                  value={excuseSortBy}
                  onChange={(e) => setExcuseSortBy(e.target.value as any)}
                >
                  <option value="date">ترتيب حسب التاريخ</option>
                  <option value="name">ترتيب حسب الاسم</option>
                  <option value="status">ترتيب حسب الحالة</option>
                </select>
              </div>

              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button 
                  onClick={() => setExcuseStatusFilter('pending')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${excuseStatusFilter === 'pending' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                >
                  قيد الانتظار ({pendingExcusesCount})
                </button>
                <button 
                  onClick={() => setExcuseStatusFilter('approved')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${excuseStatusFilter === 'approved' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500'}`}
                >
                  المقبولة
                </button>
                <button 
                  onClick={() => setExcuseStatusFilter('rejected')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${excuseStatusFilter === 'rejected' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
                >
                  المرفوضة
                </button>
                <button 
                  onClick={() => setExcuseStatusFilter('all')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${excuseStatusFilter === 'all' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'}`}
                >
                  الكل
                </button>
              </div>
            </div>
          </div>

          {/* Bulk Actions Bar */}
          {selectedExcuses.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-indigo-600 text-white p-4 rounded-2xl mb-8 flex items-center justify-between shadow-lg shadow-indigo-100"
            >
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center font-black">
                  {selectedExcuses.length}
                </div>
                <span className="font-black text-sm">أعذار مختارة</span>
                <button 
                  onClick={toggleAllExcusesSelection}
                  className="text-xs font-bold hover:underline bg-white/10 px-3 py-1.5 rounded-lg"
                >
                  إلغاء التحديد
                </button>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => handleBulkExcuseAction('approved')}
                  className="bg-white text-indigo-600 px-6 py-2 rounded-xl text-xs font-black hover:bg-green-50 hover:text-green-600 transition-all flex items-center gap-2"
                >
                  <CheckCircle size={16} />
                  قبول المحدد
                </button>
                <button 
                  onClick={() => handleBulkExcuseAction('rejected')}
                  className="bg-white/10 text-white border border-white/20 px-6 py-2 rounded-xl text-xs font-black hover:bg-red-500 transition-all flex items-center gap-2"
                >
                  <XCircle size={16} />
                  رفض المحدد
                </button>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredExcuses.map(excuse => (
              <div 
                key={excuse.id} 
                className={`bg-white rounded-3xl p-6 border-2 transition-all shadow-sm hover:shadow-md relative group ${
                  selectedExcuses.includes(excuse.id) ? 'border-indigo-500 ring-4 ring-indigo-50' : 
                  excuse.status === 'approved' ? 'border-green-100' : 
                  excuse.status === 'rejected' ? 'border-red-100' : 
                  'border-slate-50 hover:border-indigo-100'
                }`}
                onClick={() => toggleExcuseSelection(excuse.id)}
              >
                {/* Selection Checkbox */}
                <div className={`absolute -top-3 -right-3 w-8 h-8 rounded-full border-4 border-white shadow-lg flex items-center justify-center transition-all z-10 ${
                  selectedExcuses.includes(excuse.id) ? 'bg-indigo-600 text-white scale-110' : 'bg-slate-100 text-transparent group-hover:bg-slate-200'
                }`}>
                  <CheckCircle size={16} />
                </div>

                <div className="flex justify-between items-start mb-4">
                  <div className="text-[11px] text-slate-400 font-bold bg-slate-50 px-2 py-1 rounded-lg">{excuse.date}</div>
                  <div className={`px-3 py-1 rounded-lg text-[10px] font-black ${
                    excuse.type === 'عذر طبي' ? 'bg-blue-50 text-blue-600' : 
                    excuse.type === 'عذر عائلي' ? 'bg-purple-50 text-purple-600' : 
                    'bg-orange-50 text-orange-600'
                  }`}>
                    {excuse.type}
                  </div>
                </div>
                
                <div className="mb-4">
                  <div className="text-xl font-black text-slate-800 mb-1">{excuse.studentName}</div>
                  <div className="text-xs text-slate-400 font-bold">{excuse.studentClass}</div>
                </div>

                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 mb-6 min-h-[80px]">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {excuse.detail}
                  </p>
                </div>
                
                <div className="mb-6" onClick={(e) => e.stopPropagation()}>
                  <div className="text-[10px] text-slate-400 font-black mb-2 mr-1 uppercase tracking-wider">المرفقات:</div>
                  {excuse.fileName ? (
                    <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-100 group">
                      <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-500">
                        <Paperclip size={16} />
                      </div>
                      <span className="text-xs text-slate-600 truncate flex-1 font-bold">{excuse.fileName}</span>
                      <div className="flex items-center gap-1">
                        <button 
                          className="text-[11px] font-black text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (excuse.fileUrl) {
                              setViewingAttachment({ url: excuse.fileUrl, name: excuse.fileName || 'مرفق' });
                            } else {
                              alert('المرفق غير متاح للعرض حالياً');
                            }
                          }}
                        >
                          عرض
                        </button>
                        <button 
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="تحميل المرفق"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (excuse.fileUrl) {
                              const link = document.createElement('a');
                              link.href = excuse.fileUrl;
                              link.download = excuse.fileName || 'attachment';
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            } else {
                              alert('المرفق غير متاح للتحميل حالياً');
                            }
                          }}
                        >
                          <Download size={14} />
                        </button>
                        <button 
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                          title="طباعة المرفق"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (excuse.fileUrl) {
                              const printWindow = window.open('', '_blank');
                              if (printWindow) {
                                printWindow.document.write(`<html><body style="margin:0;display:flex;justify-content:center;align-items:center;"><img src="${excuse.fileUrl}" style="max-width:100%;max-height:100%;" onload="window.print();window.close();"></body></html>`);
                                printWindow.document.close();
                              }
                            } else {
                              window.print();
                            }
                          }}
                        >
                          <Printer size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-400 italic mr-1 bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200 text-center">
                      لا يوجد مرفقات لهذا العذر
                    </div>
                  )}
                </div>

                {excuse.status === 'pending' ? (
                  <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExcuseAction(excuse.studentId, excuse.id, 'approved');
                      }}
                      className="flex-1 bg-green-50 text-green-600 hover:bg-green-100 py-3 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={18} />
                      قبول
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExcuseAction(excuse.studentId, excuse.id, 'rejected');
                      }}
                      className="flex-1 bg-red-50 text-red-600 hover:bg-red-100 py-3 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2"
                    >
                      <XCircle size={18} />
                      رفض
                    </button>
                  </div>
                ) : (
                  <div className={`w-full py-3 rounded-xl text-sm font-black text-center border ${
                    excuse.status === 'approved' ? 'bg-green-50/50 text-green-600 border-green-100' : 'bg-red-50/50 text-red-600 border-red-100'
                  }`}>
                    {excuse.status === 'approved' ? 'تم قبول العذر' : 'تم رفض العذر'}
                  </div>
                )}
              </div>
            ))}
            {filteredExcuses.length === 0 && (
              <div className="col-span-full text-center py-20">
                <ShieldCheck size={48} className="mx-auto text-slate-200 mb-4" />
                <p className="text-slate-400 font-bold mb-6">
                  {excuseStatusFilter === 'pending' ? 'لا توجد طلبات أعذار بانتظار المراجعة.' : 
                   excuseStatusFilter === 'approved' ? 'لا توجد أعذار مقبولة حالياً.' :
                   excuseStatusFilter === 'rejected' ? 'لا توجد أعذار مرفوضة حالياً.' :
                   'سجل الأعذار فارغ حالياً.'}
                </p>
                <button 
                  onClick={() => setActiveAdminTab('attendance')}
                  className="btn btn-primary mx-auto flex items-center gap-2"
                >
                  <Users size={18} />
                  العودة لقائمة الطلاب
                </button>
              </div>
            )}
          </div>

          {/* Attachment Viewer Modal */}
          {viewingAttachment && (
            <div className="modal-overlay" onClick={() => setViewingAttachment(null)}>
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white p-4 rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col relative"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-4 px-2">
                  <h3 className="text-xl font-black text-slate-800">{viewingAttachment.name}</h3>
                  <button 
                    onClick={() => setViewingAttachment(null)}
                    className="w-10 h-10 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all"
                  >
                    ×
                  </button>
                </div>
                <div className="flex-1 overflow-auto bg-slate-50 rounded-2xl p-4 flex items-center justify-center border border-slate-100">
                  {viewingAttachment.url.startsWith('data:image') ? (
                    <img src={viewingAttachment.url} alt="Attachment" className="max-w-full h-auto shadow-lg rounded-lg" />
                  ) : (
                    <iframe src={viewingAttachment.url} className="w-full h-full min-h-[600px] rounded-lg shadow-lg" title="PDF Viewer"></iframe>
                  )}
                </div>
                <div className="mt-4 flex justify-center gap-4">
                  <button 
                    className="btn btn-primary"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = viewingAttachment.url;
                      link.download = viewingAttachment.name;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                  >
                    <Download size={18} />
                    تحميل الملف
                  </button>
                  <button 
                    className="btn btn-outline"
                    onClick={() => {
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        printWindow.document.write(`<html><body style="margin:0;display:flex;justify-content:center;align-items:center;"><img src="${viewingAttachment.url}" style="max-width:100%;max-height:100%;" onload="window.print();window.close();"></body></html>`);
                        printWindow.document.close();
                      }
                    }}
                  >
                    <Printer size={18} />
                    طباعة
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAbsenceModal && (
          <div className="modal-overlay active" onClick={() => setShowAbsenceModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-2xl" 
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 className="flex items-center gap-2 text-red-600">
                  <AlertCircle />
                  قائمة الغياب والتأخير اليوم
                </h3>
                <button className="close-btn" onClick={() => setShowAbsenceModal(false)}>×</button>
              </div>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-red-50 rounded-2xl border-2 border-red-100 flex flex-col items-center">
                    <div className="text-red-600 font-black text-4xl mb-1">{students.filter(s => s.status === 'absent').length}</div>
                    <div className="text-red-400 font-bold text-sm">إجمالي الغياب</div>
                  </div>
                  <div className="p-6 bg-yellow-50 rounded-2xl border-2 border-yellow-100 flex flex-col items-center">
                    <div className="text-yellow-600 font-black text-4xl mb-1">{students.filter(s => s.status === 'late').length}</div>
                    <div className="text-yellow-400 font-bold text-sm">إجمالي التأخير</div>
                  </div>
                </div>
                
                <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
                  {students.filter(s => s.status === 'absent' || s.status === 'late').map(s => (
                    <div key={s.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${s.status === 'absent' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                          {s.status === 'absent' ? <XCircle size={20} /> : <Clock size={20} />}
                        </div>
                        <div>
                          <div className="font-black text-slate-800">{s.name}</div>
                          <div className="text-xs text-slate-400 font-bold">{s.class} • {s.phone}</div>
                        </div>
                      </div>
                      <div className={`px-4 py-1.5 rounded-xl text-xs font-black ${s.status === 'absent' ? 'bg-red-600 text-white' : 'bg-yellow-500 text-white'}`}>
                        {s.status === 'absent' ? 'غائب' : 'متأخر'}
                      </div>
                    </div>
                  ))}
                  {students.filter(s => s.status === 'absent' || s.status === 'late').length === 0 && (
                    <div className="text-center py-12 text-slate-400 font-bold">لا يوجد غيابات أو تأخيرات مسجلة لليوم.</div>
                  )}
                </div>

                <button 
                  className="modal-btn bg-red-600 hover:bg-red-700 flex items-center justify-center gap-2 py-4 text-lg"
                  onClick={async () => {
                    const absent = students.filter(s => s.status === 'absent');
                    const late = students.filter(s => s.status === 'late');
                    const data = [
                      ...absent.map(s => ({ name: s.name, class: s.class, status: 'غائب' })),
                      ...late.map(s => ({ name: s.name, class: s.class, status: 'متأخر' }))
                    ];

                    const docGen = new Document({
                      sections: [{
                        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: "تقرير الغياب والتأخير اليومي", bold: true, size: 32, font: "Tajawal" })],
                          }),
                          new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: `التاريخ: ${new Date().toLocaleDateString('ar-SA')}`, size: 24, font: "Tajawal" })],
                          }),
                          new Paragraph({ text: "" }),
                          new Table({
                            width: { size: 100, type: WidthType.PERCENTAGE },
                            rows: [
                              new TableRow({
                                children: [
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "اسم الطالب", bold: true, font: "Tajawal", size: 28 })] })] }),
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "الفصل", bold: true, font: "Tajawal", size: 28 })] })] }),
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "الحالة", bold: true, font: "Tajawal", size: 28 })] })] }),
                                ],
                              }),
                              ...data.map(item => new TableRow({
                                children: [
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item.name, font: "Tajawal", size: 28 })] })] }),
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item.class, font: "Tajawal", size: 28 })] })] }),
                                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item.status, font: "Tajawal", size: 28, color: item.status === 'غائب' ? 'FF0000' : 'FFA500' })] })] }),
                                ],
                              })),
                            ],
                          }),
                        ],
                      }],
                    });
                    const blob = await Packer.toBlob(docGen);
                    saveAs(blob, `تقرير_الغياب_اليومي_${new Date().toISOString().split('T')[0]}.docx`);
                  }}
                >
                  <FileDown size={24} />
                  تصدير القائمة (Word)
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showReminderModal && (
          <div className="modal-overlay active" onClick={() => setShowReminderModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-2xl" 
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 className="flex items-center gap-2 text-purple-600">
                  <Bell />
                  إرسال تذكيرات آلية للغياب
                </h3>
                <button className="close-btn" onClick={() => setShowReminderModal(false)}>×</button>
              </div>
              <div className="space-y-6">
                <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100">
                  <p className="text-purple-800 text-sm font-bold leading-relaxed">
                    سيتم إرسال رسائل تذكير لجميع الطلاب الذين سجلوا "غياب بدون عذر" في يوم أمس ({new Date(Date.now() - 86400000).toLocaleDateString('ar-SA')}).
                  </p>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-2 pr-2">
                  <div className="text-xs font-bold text-slate-400 mb-2">الطلاب المستهدفون ({studentsToRemind.length}):</div>
                  {studentsToRemind.map(({ student }) => (
                    <div key={student.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-xs">
                          {student.name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-700 text-sm">{student.name}</div>
                          <div className="text-[10px] text-slate-400">{student.class} • {student.phone}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-white px-2 py-1 rounded-lg border border-slate-200 text-slate-500">SMS</span>
                        <span className="text-[10px] bg-white px-2 py-1 rounded-lg border border-slate-200 text-slate-500">Email</span>
                      </div>
                    </div>
                  ))}
                  {studentsToRemind.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">لا يوجد طلاب غائبين بدون عذر ليوم أمس.</div>
                  )}
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="text-xs font-bold text-slate-500 mb-2">نص الرسالة المقترح:</div>
                  <p className="text-sm text-slate-700 italic leading-relaxed">
                    "عزيزي ولي أمر الطالب، نود إحاطتكم علماً بأن الطالب تغيب عن المدرسة يوم أمس بدون عذر مسبق. نرجو منكم التعاون للحرص على انضباط الطالب وتزويدنا بالعذر إن وجد. شكراً لتعاونكم."
                  </p>
                </div>

                <div className="flex gap-3">
                  <button 
                    className={`flex-1 py-4 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-2 ${
                      studentsToRemind.length === 0 || sendingReminders
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-purple-600 text-white hover:bg-purple-700 shadow-lg shadow-purple-100'
                    }`}
                    disabled={studentsToRemind.length === 0 || sendingReminders}
                    onClick={sendReminders}
                  >
                    {sendingReminders ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        جاري الإرسال...
                      </>
                    ) : (
                      <>
                        <Search size={20} className="rotate-90" />
                        إرسال التذكيرات الآن
                      </>
                    )}
                  </button>
                  <button 
                    className="px-6 py-4 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 transition-all"
                    onClick={() => setShowReminderModal(false)}
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
          <div className="modal-overlay active" onClick={() => setShowSettingsModal(false)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-sm" 
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 className="flex items-center gap-2">
                  <Settings />
                  إعدادات النظام
                </h3>
                <button className="close-btn" onClick={() => setShowSettingsModal(false)}>×</button>
              </div>
              <div className="space-y-6">
                <div>
                  <label className="form-label">حد الغياب للتنبيه (أيام)</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="1" 
                      max="10" 
                      value={absenceThreshold} 
                      onChange={(e) => onUpdateThreshold(parseInt(e.target.value))}
                      className="flex-1 accent-indigo-600"
                    />
                    <span className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">
                      {absenceThreshold}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">سيتم إرسال تنبيه للمسؤول عند وصول الطالب لهذا العدد من الغيابات.</p>
                </div>

                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-3 h-3 rounded-full ${notificationsEnabled ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <div className="font-bold text-blue-800 text-sm">
                      تنبيهات المتصفح: {notificationsEnabled ? 'مفعلة' : 'معطلة'}
                    </div>
                  </div>
                  {!notificationsEnabled && (
                    <button 
                      onClick={() => {
                        Notification.requestPermission().then(p => {
                          if (p === 'granted') window.location.reload();
                        });
                      }}
                      className="text-xs text-blue-600 underline font-bold"
                    >
                      طلب إذن التنبيهات
                    </button>
                  )}
                </div>

                <button 
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
                  onClick={() => setShowSettingsModal(false)}
                >
                  حفظ وإغلاق
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showImportModal && (
          <div className="modal-overlay active" style={{ zIndex: 9999 }} onClick={() => setShowImportModal(false)}>
            <motion.div 
              key="import-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-md" 
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 className="flex items-center gap-2 text-indigo-600">
                  <Upload />
                  تأكيد استيراد البيانات
                </h3>
                <button className="close-btn" onClick={() => setShowImportModal(false)}>×</button>
              </div>
              <div className="space-y-6 text-center">
                <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <FileSpreadsheet size={40} />
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-800 mb-2">تم العثور على {pendingImportData.length} طالب</h4>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    يرجى اختيار طريقة تحديث البيانات في النظام:
                  </p>
                </div>

                <div className="space-y-3">
                  <button 
                    onClick={() => confirmImport('overwrite')}
                    className="w-full p-4 rounded-2xl border-2 border-red-100 bg-red-50 hover:bg-red-100 transition-all text-right group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Trash2 size={20} />
                      </div>
                      <div>
                        <div className="font-black text-red-700">1- حذف السابق</div>
                        <div className="text-[10px] text-red-400">سيتم مسح جميع الطلاب الحاليين واستبدالهم بالقائمة الجديدة</div>
                      </div>
                    </div>
                  </button>

                  <button 
                    onClick={() => confirmImport('merge')}
                    className="w-full p-4 rounded-2xl border-2 border-indigo-100 bg-indigo-50 hover:bg-indigo-100 transition-all text-right group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <div className="font-black text-indigo-700">2- دمج واستبدال</div>
                        <div className="text-[10px] text-indigo-400">سيتم تحديث بيانات الطلاب الموجودين وإضافة الطلاب الجدد</div>
                      </div>
                    </div>
                  </button>
                </div>

                <button 
                  className="text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors"
                  onClick={() => setShowImportModal(false)}
                >
                  إلغاء العملية
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedStudentForAi && (
          <div className="modal-overlay active" onClick={() => setSelectedStudentForAi(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box" 
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3>رسالة ذكية لولي الأمر</h3>
                <button className="close-btn" onClick={() => setSelectedStudentForAi(null)}>×</button>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                  <div className="font-bold text-purple-700">{selectedStudentForAi.name}</div>
                  <div className="text-xs text-purple-500">الحالة: {selectedStudentForAi.status === 'absent' ? 'غائب' : 'متأخر'}</div>
                </div>
                
                {aiMessageLoading ? (
                  <div className="py-10 text-center">
                    <div className="loader-spinner mb-2"></div>
                    <div className="text-purple-600 font-bold">جاري صياغة الرسالة...</div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm leading-relaxed whitespace-pre-wrap relative">
                    {aiMessage}
                    <button 
                      className="absolute top-2 left-2 p-1 text-slate-400 hover:text-primary"
                      onClick={() => {
                        navigator.clipboard.writeText(aiMessage);
                        alert("تم نسخ الرسالة");
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  <button 
                    className="modal-btn flex-1 bg-green-600 hover:bg-green-700 flex items-center justify-center gap-2"
                    onClick={() => {
                      const url = `https://wa.me/${selectedStudentForAi.phone}?text=${encodeURIComponent(aiMessage)}`;
                      window.open(url, '_blank');
                    }}
                  >
                    <Share2 size={18} />
                    إرسال واتساب
                  </button>
                  <button className="modal-btn flex-1 bg-slate-200 text-slate-700 hover:bg-slate-300" onClick={() => setSelectedStudentForAi(null)}>إغلاق</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Student Journey Modal */}
        {selectedStudentForJourney && (
          <div className="modal-overlay active" onClick={() => setSelectedStudentForJourney(null)}>
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="modal-box max-w-6xl p-0 overflow-hidden bg-transparent shadow-none"
              onClick={e => e.stopPropagation()}
            >
              <JourneyVisualization 
                student={selectedStudentForJourney} 
                history={attendanceHistory}
                onClose={() => setSelectedStudentForJourney(null)} 
              />
            </motion.div>
          </div>
        )}

        {/* Reports Modals */}
        {reportType && (
          <div className="modal-overlay active" onClick={() => setReportType(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-box max-w-md" 
              onClick={e => e.stopPropagation()}
            >
              <ReportsModal 
                type={reportType}
                students={students} 
                history={attendanceHistory}
                onClose={() => setReportType(null)} 
              />
            </motion.div>
          </div>
        )}

        {/* Status Change Notification Modal */}
        {statusChangeNotification && (
          <div className="modal-overlay active" onClick={() => setStatusChangeNotification(null)}>
            <motion.div 
              initial={{ y: -100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -100, opacity: 0 }}
              className="modal-box max-w-lg p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-4 mb-6">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${statusChangeNotification.type === 'absent' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                  {statusChangeNotification.type === 'absent' ? <XCircle size={28} /> : <Clock size={28} />}
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-slate-800">
                    {statusChangeNotification.type === 'absent' ? 'غياب' : 'تأخر'}: {statusChangeNotification.student.name}
                  </h3>
                  <p className="text-slate-500 text-sm">تم تسجيل الطالب ك{statusChangeNotification.type === 'absent' ? 'غائب' : 'متأخر'} اليوم.</p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button 
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
                  onClick={() => {
                    const msg = `السلام عليكم، نود إحاطتكم علماً بأن الطالب ${statusChangeNotification.student.name} قد تم تسجيله ك${statusChangeNotification.type === 'absent' ? 'غائب' : 'متأخر'} اليوم. نرجو منكم المتابعة والحرص على انضباط الطالب.`;
                    const url = `https://wa.me/${statusChangeNotification.student.phone}?text=${encodeURIComponent(msg)}`;
                    window.open(url, '_blank');
                    setStatusChangeNotification(null);
                  }}
                >
                  إرسال رسالة
                </button>
                <button 
                  className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-3 rounded-xl transition-colors"
                  onClick={() => setStatusChangeNotification(null)}
                >
                  إغلاق
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Journey Visualization Component ---
function JourneyVisualization({ student, history, onClose, showClose = true, compact = false }: { student: Student, history: AttendanceHistory, onClose: () => void, showClose?: boolean, compact?: boolean }) {
  const dates = Array.from({ length: 30 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().split('T')[0];
  });

  const studentHistory = dates.map(date => {
    const dayData = history[date] || [];
    const record = dayData.find(s => s.phone === student.phone);
    return { date, status: record?.status || 'none' };
  });

  const presentCount = studentHistory.filter(h => h.status === 'present').length;
  const absentCount = studentHistory.filter(h => h.status === 'absent').length;
  const lateCount = studentHistory.filter(h => h.status === 'late').length;
  const excusedCount = studentHistory.filter(h => h.status === 'excused').length;
  const points = presentCount * 5 + lateCount * 2 + excusedCount * 3;

  // Prepare chart data
  const chartData = {
    labels: dates.map(d => d.split('-').slice(1).reverse().join('/')),
    datasets: [
      {
        label: 'مستوى الانضباط',
        data: studentHistory.map(h => h.status === 'present' ? 100 : h.status === 'late' ? 50 : h.status === 'excused' ? 30 : h.status === 'absent' ? 0 : null),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        tension: 0.4,
        pointBackgroundColor: studentHistory.map(h => h.status === 'present' ? '#10b981' : h.status === 'late' ? '#f59e0b' : h.status === 'excused' ? '#0ea5e9' : h.status === 'absent' ? '#ef4444' : '#64748b'),
        pointRadius: 6,
        fill: true,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        rtl: true,
        callbacks: {
          label: (context: any) => {
            const status = studentHistory[context.dataIndex].status;
            return status === 'present' ? 'حاضر' : status === 'late' ? 'متأخر' : status === 'excused' ? 'بعذر' : status === 'absent' ? 'غائب' : 'لا يوجد سجل';
          }
        }
      }
    },
    scales: {
      y: { min: 0, max: 100, display: false },
      x: {
        ticks: {
          color: 'rgba(255,255,255,0.5)',
          font: { size: 10, family: 'Tajawal' }
        },
        grid: { display: false }
      }
    }
  };

  return (
    <div className={`journey-container m-0 w-full shadow-2xl border-none flex flex-col justify-between ${compact ? 'p-4 min-h-[350px]' : 'p-8 min-h-[500px]'}`}>
      <div className={`journey-header flex justify-between items-start ${compact ? 'mb-4' : 'mb-8'}`}>
        <div>
          <h4 className={`flex items-center gap-4 font-black ${compact ? 'text-xl' : 'text-3xl'}`}>
            <BarChart3 size={compact ? 24 : 40} className="text-white" />
            {compact ? 'مؤشر الانضباط' : `مؤشر الانضباط الشهري: ${student.name}`}
          </h4>
          {!compact && <p className="journey-subtitle text-indigo-200 mt-2 text-lg">تتبع مستوى التزامك وحضورك اليومي عبر الرسم البياني ✨</p>}
        </div>
        <div className="flex gap-4 bg-white/5 p-3 rounded-2xl border border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-400"></div>
            <span className="text-[10px] font-bold text-white/70">حاضر</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span className="text-[10px] font-bold text-white/70">غائب</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <span className="text-[10px] font-bold text-white/70">متأخر</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-sky-400"></div>
            <span className="text-[10px] font-bold text-white/70">بعذر</span>
          </div>
        </div>
        {showClose && (
          <div className="bg-white/10 p-3 rounded-full text-white/50 hover:text-white cursor-pointer" onClick={onClose}>
            <XCircle size={compact ? 24 : 32} />
          </div>
        )}
      </div>
      
      <div className="flex-1 min-h-[200px] mt-8 overflow-x-auto pb-8 custom-scrollbar">
        <div className="relative flex items-center min-w-max px-8 h-40">
          {/* The horizontal line */}
          <div className="absolute left-8 right-8 h-1 bg-white/10 top-1/2 -translate-y-1/2 rounded-full"></div>
          
          {/* The dots */}
          <div className="flex justify-between w-full relative z-10 gap-10">
            {studentHistory.map((h, idx) => (
              <div key={idx} className="flex flex-col items-center relative">
                {/* Status Dot - Only show for the current day (last index) */}
                {idx === studentHistory.length - 1 && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1.2 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className={`w-7 h-7 rounded-full border-4 border-white/30 shadow-2xl z-20 ${
                      h.status === 'present' ? 'bg-green-400 shadow-green-400/60' : 
                      h.status === 'absent' ? 'bg-red-500 shadow-red-500/60' : 
                      h.status === 'late' ? 'bg-yellow-400 shadow-yellow-400/60' : 
                      h.status === 'excused' ? 'bg-sky-400 shadow-sky-400/60' : 
                      'bg-slate-500/50'
                    }`}
                    title={`اليوم (${h.date}): ${h.status === 'present' ? 'حاضر' : h.status === 'late' ? 'متأخر' : h.status === 'excused' ? 'بعذر' : h.status === 'absent' ? 'غائب' : 'لم يسجل بعد'}`}
                  />
                )}
                
                {/* Date Label - Only show for the current day or keep all? User said "only current day" */}
                {idx === studentHistory.length - 1 && (
                  <div className="absolute top-12 text-xs text-white font-black whitespace-nowrap bg-white/10 px-3 py-1 rounded-full backdrop-blur-md border border-white/10 mt-2">
                    {h.date.split('-').slice(1).reverse().join('/')}
                  </div>
                )}

                {/* Vertical indicator line - Only for current day */}
                {idx === studentHistory.length - 1 && (
                  <div className="absolute top-1/2 w-px h-8 bg-white/20 -translate-y-1/2"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-4 gap-4 ${compact ? 'mt-6' : 'mt-10'}`}>
        <div className={`bg-white/10 border border-white/20 rounded-3xl flex flex-col items-center justify-center backdrop-blur-md ${compact ? 'p-3' : 'p-6'}`}>
          <div className="text-green-300 text-[10px] font-bold mb-1">حضور</div>
          <div className={`${compact ? 'text-xl' : 'text-3xl'} font-black text-white`}>{presentCount}</div>
        </div>
        <div className={`bg-white/10 border border-white/20 rounded-3xl flex flex-col items-center justify-center backdrop-blur-md ${compact ? 'p-3' : 'p-6'}`}>
          <div className="text-red-300 text-[10px] font-bold mb-1">غياب</div>
          <div className={`${compact ? 'text-xl' : 'text-3xl'} font-black text-white`}>{absentCount}</div>
        </div>
        <div className={`bg-white/10 border border-white/20 rounded-3xl flex flex-col items-center justify-center backdrop-blur-md ${compact ? 'p-3' : 'p-6'}`}>
          <div className="text-yellow-300 text-[10px] font-bold mb-1">تأخير</div>
          <div className={`${compact ? 'text-xl' : 'text-3xl'} font-black text-white`}>{lateCount}</div>
        </div>
        <div className={`bg-white/10 border border-white/20 rounded-3xl flex flex-col items-center justify-center backdrop-blur-md ${compact ? 'p-3' : 'p-6'}`}>
          <div className="text-indigo-200 text-[10px] font-bold mb-1">النقاط</div>
          <div className={`${compact ? 'text-xl' : 'text-3xl'} font-black text-white`}>{points}</div>
        </div>
      </div>
    </div>
  );
}

// --- Reports Modal Component ---
function ReportsModal({ type, students, history, onClose }: { type: 'daily' | 'monthly' | 'student' | 'warning', students: Student[], history: AttendanceHistory, onClose: () => void }) {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [selectedClass, setSelectedClass] = useState('all');
  const [monthlyResults, setMonthlyResults] = useState<{ studentName: string, class: string, present: number, absent: number, late: number }[] | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const reportRef = React.useRef<HTMLDivElement>(null);
  const monthlyPdfRef = React.useRef<HTMLDivElement>(null);

  const classes = Array.from(new Set(students.map(s => s.class))).sort();

  const takeScreenshot = async () => {
    if (!reportRef.current) return;
    setIsCapturing(true);
    // Small delay to allow React to hide the button
    setTimeout(async () => {
      const canvas = await (window as any).html2canvas(reportRef.current);
      const image = canvas.toDataURL("image/png");
      const link = document.createElement('a');
      link.href = image;
      link.download = `تقرير_طالب_${new Date().getTime()}.png`;
      link.click();
      setIsCapturing(false);
    }, 100);
  };

  const generateDailyWordReport = async () => {
    const today = new Date().toISOString().split('T')[0];
    const present = students.filter(s => s.status === 'present');
    const absent = students.filter(s => s.status === 'absent');
    const late = students.filter(s => s.status === 'late');
    const excused = students.filter(s => s.status === 'excused');

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "تقرير الحضور والغياب اليومي الإحصائي", bold: true, size: 32, font: "Tajawal" })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `التاريخ: ${new Date().toLocaleDateString('ar-SA')}`, size: 24, font: "Tajawal" })],
          }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "الحالة", bold: true, font: "Tajawal", size: 28 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "العدد", bold: true, font: "Tajawal", size: 28 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "حاضر", font: "Tajawal", size: 28 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(present.length), font: "Tajawal", size: 28 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "غائب", font: "Tajawal", size: 28 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(absent.length), font: "Tajawal", size: 28 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "متأخر", font: "Tajawal", size: 28 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(late.length), font: "Tajawal", size: 28 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "بعذر", font: "Tajawal", size: 28 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(excused.length), font: "Tajawal", size: 28 })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "الإجمالي", bold: true, font: "Tajawal", size: 28 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(students.length), bold: true, font: "Tajawal", size: 28 })] })] }),
                ],
              }),
            ],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `تقرير_إحصائي_${today}.docx`);
  };

  const generateDailyPdfReport = () => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const today = new Date().toLocaleDateString('ar-SA');
    
    // Simple PDF generation (Arabic support in jsPDF is tricky without fonts, but we'll try basic structure)
    doc.text(`Daily Attendance Report - ${today}`, 105, 20, { align: 'center' });
    
    const data = [
      ['Present', students.filter(s => s.status === 'present').length],
      ['Absent', students.filter(s => s.status === 'absent').length],
      ['Late', students.filter(s => s.status === 'late').length],
      ['Excused', students.filter(s => s.status === 'excused').length],
      ['Total', students.length]
    ];

    autoTable(doc, {
      head: [['Status', 'Count']],
      body: data,
      startY: 30,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }
    });

    doc.save(`تقرير_إحصائي_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleDirectPrint = () => {
    window.print();
  };

  const handleMonthlySearch = () => {
    if (!dateRange.from || !dateRange.to) {
      alert("يرجى تحديد نطاق التاريخ");
      return;
    }

    const results = students
      .filter(s => selectedClass === 'all' || s.class === selectedClass)
      .map(student => {
        let present = 0, absent = 0, late = 0, excused = 0;
        
        Object.entries(history).forEach(([date, dayStudents]) => {
          if (date >= dateRange.from && date <= dateRange.to) {
            const record = (dayStudents as Student[]).find(s => s.phone === student.phone);
            if (record) {
              if (record.status === 'present') present++;
              else if (record.status === 'absent') absent++;
              else if (record.status === 'late') late++;
              else if (record.status === 'excused') excused++;
            }
          }
        });

        return {
          studentName: student.name,
          class: student.class,
          present,
          absent,
          late,
          excused
        };
      });

    setMonthlyResults(results);
  };

  const generateMonthlyWordReport = async () => {
    if (!monthlyResults) return;

    const docGen = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "تقرير الحضور والغياب للفترة", bold: true, size: 32, font: "Tajawal" })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `من: ${dateRange.from} إلى: ${dateRange.to}`, size: 24, font: "Tajawal" })],
          }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "اسم الطالب", bold: true, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "الفصل", bold: true, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "حاضر", bold: true, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "غائب", bold: true, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "متأخر", bold: true, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "بعذر", bold: true, font: "Tajawal", size: 24 })] })] }),
                ],
              }),
              ...monthlyResults.map(r => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.studentName, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.class, font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(r.present), font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(r.absent), font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(r.late), font: "Tajawal", size: 24 })] })] }),
                  new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(r.excused), font: "Tajawal", size: 24 })] })] }),
                ],
              })),
            ],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(docGen);
    saveAs(blob, `تقرير_فترة_${dateRange.from}_${dateRange.to}.docx`);
  };

  const generateMonthlyPdfReport = async () => {
    if (!monthlyResults || !monthlyPdfRef.current) return;
    
    setIsCapturing(true);
    
    try {
      const canvas = await (window as any).html2canvas(monthlyPdfRef.current, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`تقرير_فترة_${dateRange.from}_${dateRange.to}.pdf`);
    } catch (error) {
      console.error("PDF generation error:", error);
      alert("حدث خطأ أثناء إنشاء ملف PDF");
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="w-full">
      <div className="modal-header border-b-0 mb-0 pb-0">
        <button onClick={onClose} className="close-btn text-slate-400 hover:text-slate-600 transition-colors">×</button>
        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800">
          {type === 'daily' && <><span className="text-red-500"><Printer size={24} /></span> التقرير الشامل (طباعة / Word / PDF)</>}
          {type === 'monthly' && <><Calendar /> تقرير غياب لفترة</>}
          {type === 'student' && <><Users /> تقرير غياب طالب</>}
          {type === 'warning' && <><AlertCircle /> تقرير الطلاب المنذرين</>}
        </h3>
      </div>

      {type === 'daily' && (
        <div className="space-y-6 pt-2">
          <p className="text-center text-slate-400 text-sm font-medium px-4">
            سيتم إنشاء تقرير شامل يحتوي على جميع بيانات الحضور والغياب الحالية.
          </p>
          
          <div className="bg-[#f8fbfe] border border-[#e8f1f9] rounded-2xl p-6 mx-2">
            <div className="grid grid-cols-2 gap-y-6 gap-x-8">
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold text-sm">إجمالي الطلاب:</span>
                <span className="text-slate-800 font-black text-lg">{students.length}</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                <span className="text-slate-500 font-bold text-sm">الحاضرين:</span>
                <span className="text-[#10b981] font-black text-lg">{students.filter(s => s.status === 'present').length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold text-sm">الغائبين:</span>
                <span className="text-[#f43f5e] font-black text-lg">{students.filter(s => s.status === 'absent').length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold text-sm">المتأخرين:</span>
                <span className="text-[#f59e0b] font-black text-lg">{students.filter(s => s.status === 'late').length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-bold text-sm">بعذر:</span>
                <span className="text-[#0ea5e9] font-black text-lg">{students.filter(s => s.status === 'excused').length}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 px-2">
            <button 
              className="flex items-center justify-center gap-2 bg-[#e11d48] hover:bg-[#be123c] text-white py-3.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-red-100"
              onClick={generateDailyPdfReport}
            >
              <FileDown size={18} />
              تحميل PDF
            </button>
            <button 
              className="flex items-center justify-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white py-3.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-indigo-100"
              onClick={generateDailyWordReport}
            >
              <FileText size={18} />
              تصدير Word
            </button>
          </div>

          <div className="px-2 space-y-3">
            <button 
              className="w-full flex items-center justify-center gap-2 bg-[#10b981] hover:bg-[#059669] text-white py-3.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-emerald-100"
              onClick={handleDirectPrint}
            >
              <Printer size={18} />
              طباعة مباشرة
            </button>
            <button 
              className="w-full py-3.5 rounded-xl font-black text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all"
              onClick={onClose}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {type === 'monthly' && (
        <div className="space-y-6">
          <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100/50 space-y-4">
            <div className="flex items-center gap-2 text-indigo-900 font-black text-sm mb-1">
              <Filter size={16} />
              تصفية البيانات
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="form-label text-[10px]">الفصل الدراسي</label>
                <select 
                  className="form-select bg-white" 
                  value={selectedClass} 
                  onChange={(e) => setSelectedClass(e.target.value)}
                >
                  <option value="all">جميع الفصول</option>
                  {classes.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-[10px]">من تاريخ</label>
                  <input 
                    type="date" 
                    className="form-input bg-white" 
                    value={dateRange.from}
                    onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label text-[10px]">إلى تاريخ</label>
                  <input 
                    type="date" 
                    className="form-input bg-white" 
                    value={dateRange.to}
                    onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <button className="modal-btn bg-indigo-600 hover:bg-indigo-700 w-full" onClick={handleMonthlySearch}>
              استخراج التقرير الإحصائي
            </button>
          </div>

          {monthlyResults && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center justify-between px-1">
                <div className="text-xs font-black text-slate-500 uppercase tracking-wider">نتائج البحث ({monthlyResults.length})</div>
                <div className="text-[10px] text-slate-400 font-bold">{dateRange.from} ↔ {dateRange.to}</div>
              </div>
              <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-2xl shadow-sm">
                <table className="report-table-custom m-0">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr>
                      <th className="text-right">الطالب</th>
                      <th>حاضر</th>
                      <th>غائب</th>
                      <th>متأخر</th>
                      <th>بعذر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyResults.map((r, i) => (
                      <tr key={i}>
                        <td className="text-right text-xs font-bold text-slate-700">{r.studentName}</td>
                        <td className="text-green-600 font-black">{r.present}</td>
                        <td className="text-red-600 font-black">{r.absent}</td>
                        <td className="text-yellow-600 font-black">{r.late}</td>
                        <td className="text-sky-600 font-black">{r.excused}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button className="modal-btn bg-[#e11d48] hover:bg-[#be123c] flex items-center justify-center gap-2" onClick={generateMonthlyPdfReport}>
                  <FileDown size={18} />
                  تصدير PDF
                </button>
                <button className="modal-btn bg-slate-800 hover:bg-slate-900 flex items-center justify-center gap-2" onClick={generateMonthlyWordReport}>
                  <FileText size={18} />
                  تصدير Word
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {type === 'student' && (
        <div className="space-y-6">
          <div>
            <label className="form-label">ابحث أو اختر الطالب من القائمة الحالية:</label>
            <select 
              className="form-select" 
              value={selectedStudentId} 
              onChange={(e) => setSelectedStudentId(e.target.value)}
            >
              <option value="">-- يرجى اختيار الطالب --</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name} - {s.class}</option>)}
            </select>
          </div>

          {selectedStudentId && (() => {
            const student = students.find(s => s.id === selectedStudentId);
            if (!student) return null;
            
            const studentHistory = Object.entries(history).map(([date, dayStudents]) => {
              const record = (dayStudents as Student[]).find(s => s.phone === student.phone);
              return record ? { date, status: record.status } : null;
            }).filter(Boolean) as { date: string, status: string }[];
            
            const cumulativeAbsence = studentHistory.filter(h => h.status === 'absent').length;

            return (
              <div className="relative">
                <div className="screenshot-btn-custom" onClick={takeScreenshot} title="لقطة شاشة">
                  <Share2 size={20} />
                </div>
                
                <div ref={reportRef} className="bg-white p-2" style={{ width: '400px', margin: '0 auto' }}>
                  <div className="student-report-card">
                    <div className="flex justify-between items-start mb-8">
                      <div className="w-16 h-16 bg-[#0047ab] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
                        <FileText size={32} />
                      </div>
                      <div className="text-left">
                        <div className="text-[11px] text-slate-400 font-bold">إشعار رسمي</div>
                        <div className="text-xs font-black text-slate-800">نظام المواظبة المدرسية</div>
                      </div>
                    </div>

                    <h2 className="report-title-main text-[#0047ab]">إشعار حالة حضور وغياب وتأخر</h2>
                    
                    <div className="grid grid-cols-1 gap-3 mb-6 p-5 bg-slate-50/50 rounded-3xl border border-slate-100 shadow-inner">
                      <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-2">
                        <span className="text-slate-400 text-[11px] font-bold">اسم الطالب</span> 
                        <span className="text-[#0047ab] text-xl font-black leading-tight">{student.name}</span>
                      </div>
                      <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-2">
                        <span className="text-slate-400 text-[11px] font-bold">الصف الدراسي</span> 
                        <span className="text-slate-900 text-base font-black">{student.class}</span>
                      </div>
                      <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-2">
                        <span className="text-slate-400 text-[11px] font-bold">رقم التواصل</span> 
                        <span className="text-slate-900 text-base font-black" dir="ltr">{student.phone}</span>
                      </div>
                      <div className="flex flex-col gap-0.5 border-b border-slate-100 pb-2">
                        <span className="text-slate-400 text-[11px] font-bold">تاريخ التقرير</span> 
                        <span className="text-slate-900 text-base font-black">{new Date().toLocaleDateString('ar-SA')}</span>
                      </div>
                      <div className="flex flex-col gap-1 border-b border-slate-100 pb-2">
                        <span className="text-slate-400 text-[11px] font-bold">حالة الحضور اليوم</span> 
                        <div className={`px-4 py-1.5 rounded-xl inline-block w-fit text-sm font-black shadow-sm ${
                          student.status === 'present' ? 'bg-green-500 text-white' : 
                          student.status === 'absent' ? 'bg-[#ff3b5c] text-white' : 
                          'bg-yellow-500 text-white'
                        }`}>
                          {student.status === 'present' ? 'حاضر ✅' : student.status === 'absent' ? 'غائب ❌' : student.status === 'late' ? 'متأخر ⏰' : 'لم يسجل'}
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-slate-400 text-[11px] font-bold">إجمالي أيام الغياب</span> 
                        <span className="text-[#ff3b5c] text-2xl font-black">{cumulativeAbsence} أيام</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 mb-6">
                      <p className="text-xs text-slate-600 leading-relaxed text-center font-medium">
                        يُعتبر هذا الإشعار بمثابة تبليغ رسمي لولي الأمر بمتابعة سجل حضور وانصراف الطالب. 
                        نأمل التعاون المستمر والحرص على انتظام الطالب لما فيه مصلحته التعليمية والتربوية.
                      </p>
                    </div>

                    <div className="flex justify-between items-center pt-6 border-t border-slate-100">
                      <div className="text-[10px] text-slate-400 font-bold">صدر بواسطة: الإدارة المدرسية</div>
                      <div className="w-20 h-20 bg-slate-50 rounded-full border-4 border-white shadow-inner flex items-center justify-center">
                        <ShieldCheck size={32} className="text-slate-200" />
                      </div>
                    </div>
                  </div>
                </div>
                  
                <div className="mt-8 scale-100 origin-top">
                  <div className="text-center mb-4 text-slate-400 text-xs font-bold">-- ملخص الانضباط (للمراجعة فقط) --</div>
                  <JourneyVisualization student={student} history={history} onClose={() => {}} showClose={false} compact={true} />
                </div>

                {!isCapturing && (
                  <button className="modal-btn mt-4 bg-indigo-900 border border-indigo-400 text-indigo-100 flex items-center justify-center gap-2">
                    <Sparkles size={18} />
                    قراءة ذكية لمسار الطالب
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {type === 'warning' && (
        <div className="space-y-4">
          <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center gap-3 mb-2">
            <AlertTriangle className="text-red-500" size={20} />
            <p className="text-xs text-red-700 font-bold">
              قائمة الطلاب الذين تجاوزت غياباتهم الحد المسموح (3 أيام فأكثر)
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
            {students.filter(s => s.absentCount > 3).map(s => (
              <div key={s.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-100 hover:border-red-200 transition-colors shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-black text-xs">
                    {s.absentCount}
                  </div>
                  <div>
                    <div className="font-black text-slate-800">{s.name}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{s.class}</div>
                  </div>
                </div>
                <div className="bg-red-600 text-white px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider">
                  إنذار نهائي
                </div>
              </div>
            ))}
            {students.filter(s => s.absentCount > 3).length === 0 && (
              <div className="text-center py-16">
                <ShieldCheck size={48} className="mx-auto text-slate-100 mb-4" />
                <p className="text-slate-400 font-bold">لا يوجد طلاب منذرين حالياً.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden Printable Monthly Report for PDF */}
      {monthlyResults && (
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
          <div ref={monthlyPdfRef} className="p-10 bg-white w-[800px] font-sans" dir="rtl">
            <div className="flex justify-between items-center mb-10 border-b-2 border-slate-100 pb-6">
              <div className="text-right">
                <h1 className="text-2xl font-black text-slate-900 mb-1">تقرير الحضور والغياب للفترة</h1>
                <p className="text-slate-500 font-bold">مدرسة الجشة المتوسطة</p>
              </div>
              <div className="text-left">
                <div className="text-xs text-slate-400 font-bold">تاريخ التقرير</div>
                <div className="text-sm font-black text-slate-800">{new Date().toLocaleDateString('ar-SA')}</div>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl mb-8 flex justify-between items-center">
              <div className="flex gap-10">
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">من تاريخ</div>
                  <div className="font-black text-slate-800">{dateRange.from}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">إلى تاريخ</div>
                  <div className="font-black text-slate-800">{dateRange.to}</div>
                </div>
              </div>
              <div className="text-left">
                <div className="text-[10px] text-slate-400 font-bold uppercase">إجمالي الطلاب</div>
                <div className="text-xl font-black text-indigo-600">{monthlyResults.length}</div>
              </div>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-indigo-600 text-white">
                  <th className="p-4 text-right rounded-tr-xl">اسم الطالب</th>
                  <th className="p-4 text-center">الفصل</th>
                  <th className="p-4 text-center">حاضر</th>
                  <th className="p-4 text-center">غائب</th>
                  <th className="p-4 text-center">متأخر</th>
                  <th className="p-4 text-center rounded-tl-xl">بعذر</th>
                </tr>
              </thead>
              <tbody>
                {monthlyResults.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="p-4 text-right border-b border-slate-100 font-bold text-slate-700">{r.studentName}</td>
                    <td className="p-4 text-center border-b border-slate-100 text-slate-600">{r.class}</td>
                    <td className="p-4 text-center border-b border-slate-100 text-green-600 font-black">{r.present}</td>
                    <td className="p-4 text-center border-b border-slate-100 text-red-600 font-black">{r.absent}</td>
                    <td className="p-4 text-center border-b border-slate-100 text-yellow-600 font-black">{r.late}</td>
                    <td className="p-4 text-center border-b border-slate-100 text-sky-600 font-black">{r.excused}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-12 pt-6 border-t border-slate-100 flex justify-between items-center">
              <div className="text-[10px] text-slate-300 font-bold">صدر بواسطة: نظام المواظبة المدرسية</div>
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                <ShieldCheck size={24} className="text-slate-200" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Student Portal ---
function StudentPortal({ student, students, history, onDeleteRecord, onUpdateExcuses, onLogout }: { 
  student: Student, 
  students: Student[], 
  history: AttendanceHistory, 
  onDeleteRecord: (phone: string, date: string) => void,
  onUpdateExcuses: (id: string, excuses: Excuse[]) => void,
  onLogout: () => void 
}) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'log' | 'excuses' | 'profile'>('dashboard');
  const [showExcuseModal, setShowExcuseModal] = useState(false);
  const [showWelcomeAlert, setShowWelcomeAlert] = useState(false);
  const [alertType, setAlertType] = useState<'absent' | 'late' | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'present' | 'absent' | 'late'>('all');
  const [newExcuse, setNewExcuse] = useState({ type: 'عذر طبي', detail: '', date: new Date().toISOString().split('T')[0], fileName: '', fileUrl: '' });

  useEffect(() => {
    const unexcusedAbsenceCount = studentHistory.filter(h => h.status === 'absent' && !studentExcuses.find(e => e.date === h.date)).length;
    const unexcusedLateCount = studentHistory.filter(h => h.status === 'late' && !studentExcuses.find(e => e.date === h.date)).length;

    if (unexcusedAbsenceCount > 0) {
      setAlertType('absent');
      setShowWelcomeAlert(true);
    } else if (unexcusedLateCount > 0) {
      setAlertType('late');
      setShowWelcomeAlert(true);
    }
  }, []);

  const studentHistory = Object.entries(history)
    .map(([date, dayStudents]) => {
      const record = (dayStudents as Student[]).find(s => s.phone === student.phone);
      return record ? { date, ...record } : null;
    })
    .filter(Boolean) as (Student & { date: string })[];

  const sortedHistory = [...studentHistory].sort((a, b) => b.date.localeCompare(a.date));

  const currentStudent = students.find(s => s.id === student.id) || student;
  const studentExcuses = currentStudent.excuses || [];

  const stats = {
    attendanceRate: studentHistory.length > 0 ? Math.round((studentHistory.filter(h => h.status === 'present').length / studentHistory.length) * 100) : 100,
    absenceDays: studentHistory.filter(h => h.status === 'absent').length,
    delayTimes: studentHistory.filter(h => h.status === 'late').length,
    excusedAbsence: studentHistory.filter(h => h.status === 'excused').length + studentExcuses.filter(e => e.status === 'approved').length
  };

  // Dynamic calculations for discipline
  const unexcusedAbsences = Math.max(0, stats.absenceDays - stats.excusedAbsence);
  const disciplinePoints = Math.max(0, 100 - (unexcusedAbsences * 2) - (stats.delayTimes * 0.5));
  const remainingAbsenceBalance = Math.max(0, 15 - unexcusedAbsences);

  const getPerformanceStatus = (pts: number) => {
    if (pts >= 95) return { text: 'أداء متميز', color: 'text-green-500' };
    if (pts >= 85) return { text: 'أداء جيد جداً', color: 'text-blue-500' };
    if (pts >= 75) return { text: 'أداء جيد', color: 'text-yellow-600' };
    return { text: 'يحتاج تحسين', color: 'text-red-500' };
  };

  const perf = getPerformanceStatus(disciplinePoints);

  const handleAddExcuse = () => {
    if (!newExcuse.detail) {
      alert('يرجى كتابة تفاصيل العذر');
      return;
    }
    const excuse: Excuse = {
      id: Math.random().toString(36).substr(2, 9),
      type: newExcuse.type,
      detail: newExcuse.detail,
      date: newExcuse.date,
      status: 'pending',
      fileName: newExcuse.fileName,
      fileUrl: newExcuse.fileUrl
    };
    onUpdateExcuses(student.id, [...studentExcuses, excuse]);
    setShowExcuseModal(false);
    setNewExcuse({ type: 'عذر طبي', detail: '', date: new Date().toISOString().split('T')[0], fileName: '', fileUrl: '' });
    alert('تم رفع العذر بنجاح وهو قيد المراجعة');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (limit to 500KB for Base64 storage in Firestore)
      if (file.size > 500 * 1024) {
        alert('حجم الملف كبير جداً. يرجى اختيار ملف أقل من 500 كيلوبايت لضمان الحفظ.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        const base64 = evt.target?.result as string;
        setNewExcuse({ ...newExcuse, fileName: file.name, fileUrl: base64 });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="portal-layout">
      {/* Sidebar */}
      <aside className="portal-sidebar">
        <div className="portal-logo">
          <ShieldCheck size={32} />
          <span>بوابة المواظبة</span>
        </div>
        
        <nav className="portal-nav">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutGrid size={20} />
            <span>ملخص المواظبة</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'log' ? 'active' : ''}`}
            onClick={() => setActiveTab('log')}
          >
            <CalendarCheck size={20} />
            <span>سجل الغياب والتأخير</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'excuses' ? 'active' : ''}`}
            onClick={() => setActiveTab('excuses')}
          >
            <FileText size={20} />
            <span>الأعذار والمبررات</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <User size={20} />
            <span>الملف الشخصي</span>
          </div>
        </nav>

        <div className="portal-sidebar-footer">
          <button onClick={onLogout} className="btn btn-outline w-full justify-center text-red-600 border-red-100 hover:bg-red-50">
            <LogOut size={18} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="portal-main">
        <header className="portal-header">
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-black text-slate-900">{student.class}</div>
              <div className="text-[10px] text-slate-500">{student.name}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Bell size={16} />
            </div>
          </div>
          
          <div className="portal-search">
            <Search size={18} />
            <input type="text" placeholder="البحث في السجلات..." />
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="mb-8">
                <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
                  ملخص المواظبة
                  <BarChart3 className="text-indigo-600" />
                </h2>
                <p className="text-slate-500">نظرة عامة على حالة الحضور والغياب للفصل الدراسي الحالي</p>
              </div>

              <div className="portal-stats-grid">
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-green-50 text-green-500">
                    <CheckCircle size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>نسبة الحضور</h4>
                    <div className="value">{stats.attendanceRate}%</div>
                  </div>
                </div>
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-red-50 text-red-500">
                    <XCircle size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>أيام الغياب</h4>
                    <div className="value">{stats.absenceDays} أيام</div>
                  </div>
                </div>
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-orange-50 text-orange-500">
                    <Clock size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>مرات التأخير</h4>
                    <div className="value">{stats.delayTimes} مرات</div>
                  </div>
                </div>
                <div className="p-stat-card">
                  <div className="p-stat-icon bg-blue-50 text-blue-500">
                    <FileText size={24} />
                  </div>
                  <div className="p-stat-info">
                    <h4>غياب بعذر</h4>
                    <div className="value">{stats.excusedAbsence} أيام</div>
                  </div>
                </div>
              </div>

              <div className="mb-8">
                <JourneyVisualization student={student} history={history} onClose={() => {}} showClose={false} />
              </div>

              <div className="grid grid-cols-3 gap-6">
                <div className="col-span-2">
                  <div className="discipline-card">
                    <div className="discipline-header">
                      <h3 className="font-bold">مؤشر الانضباط المدرسي</h3>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-1 text-green-600 text-xs font-bold">
                          <CheckCircle size={14} />
                          <span>حضور</span>
                        </div>
                        <div className="flex items-center gap-1 text-red-600 text-xs font-bold">
                          <XCircle size={14} />
                          <span>غياب</span>
                        </div>
                        <div className="flex items-center gap-1 text-yellow-500 text-xs font-bold">
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <span>متأخر</span>
                        </div>
                      </div>
                    </div>
                    <div className="discipline-progress-bg">
                      <div className="discipline-progress-fill" style={{ width: `${stats.attendanceRate}%` }}></div>
                    </div>
                    <div className="discipline-labels">
                      <span>غياب ({100 - stats.attendanceRate}%)</span>
                      <span>مواظب ({stats.attendanceRate}%)</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-8">
                      <div className="bg-slate-50 p-4 rounded-xl text-center">
                        <div className="text-xs text-slate-500 mb-1">نقاط المواظبة</div>
                        <div className="text-xl font-black text-indigo-600">{disciplinePoints} / 100</div>
                        <div className={`text-[10px] font-bold mt-1 ${perf.color}`}>{perf.text}</div>
                      </div>
                      <div className="bg-slate-50 p-4 rounded-xl text-center">
                        <div className="text-xs text-slate-500 mb-1">مجموع أيام الغياب بدون عذر</div>
                        <div className="text-xl font-black text-slate-700">{unexcusedAbsences} يوم</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-span-1">
                  <div className="recent-log-card">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-bold">سجل حديث</h3>
                      <button className="text-indigo-600 text-xs font-bold" onClick={() => setActiveTab('log')}>عرض الكل</button>
                    </div>
                    <div className="space-y-4">
                      {sortedHistory.slice(0, 3).map((h, i) => (
                        <div key={i} className="log-item">
                          <div className="log-item-info">
                            <div className={`log-icon ${h.status === 'present' ? 'bg-green-50 text-green-500' : h.status === 'absent' ? 'bg-red-50 text-red-500' : 'bg-orange-50 text-orange-500'}`}>
                              {h.status === 'present' ? <CheckCircle size={18} /> : h.status === 'absent' ? <XCircle size={18} /> : <Clock size={18} />}
                            </div>
                            <div>
                              <div className="text-sm font-bold flex items-center gap-1">
                                {h.status === 'present' ? 'حضور' : h.status === 'absent' ? 'غياب' : 'متأخر'}
                                {(h.status === 'absent' || h.status === 'late') && studentExcuses.find(e => e.date === h.date)?.status === 'approved' && (
                                  <ShieldCheck size={12} className="text-green-500" />
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400">{h.date}</div>
                            </div>
                          </div>
                          <ChevronRight size={14} className="text-slate-300" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'log' && (
            <motion.div 
              key="log"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black mb-2">سجل الغياب والتأخير</h2>
                  <p className="text-slate-500">عرض تفصيلي لجميع سجلات الحضور والغياب</p>
                </div>
                <div className="flex gap-2">
                  <select className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold outline-none">
                    <option>الفصل الدراسي الحالي</option>
                  </select>
                  <select 
                    className="bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold outline-none"
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value as any)}
                  >
                    <option value="all">جميع السجلات</option>
                    <option value="present">حاضر</option>
                    <option value="absent">غائب</option>
                    <option value="late">متأخر</option>
                  </select>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>النوع</th>
                      <th>المدة / الوقت</th>
                      <th>الحالة / العذر</th>
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHistory
                      .filter(h => logFilter === 'all' || h.status === logFilter)
                      .map((h, i) => (
                      <tr key={i}>
                        <td className="font-bold text-slate-700">{h.date}</td>
                        <td>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black ${
                            h.status === 'present' ? 'bg-green-100 text-green-600' : 
                            h.status === 'absent' ? 'bg-red-100 text-red-600' : 
                            h.status === 'late' ? 'bg-orange-100 text-orange-600' :
                            'bg-sky-100 text-sky-600'
                          }`}>
                            {h.status === 'present' ? 'حضور' : h.status === 'absent' ? 'غياب' : h.status === 'late' ? 'متأخر' : 'بعذر'}
                          </span>
                        </td>
                        <td className="text-slate-500 text-sm">{h.time || '-'}</td>
                        <td className="text-slate-500 text-sm">
                          {h.status === 'absent' ? (
                            studentExcuses.find(e => e.date === h.date)?.status === 'approved' ? (
                              <div className="flex items-center gap-1 text-green-600 font-bold">
                                <ShieldCheck size={14} />
                                <span>عذر مقبول</span>
                                {studentExcuses.find(e => e.date === h.date)?.fileName && (
                                  <button 
                                    className="text-[10px] text-indigo-600 flex items-center gap-1 hover:underline ml-2"
                                    onClick={() => alert(`عرض المرفق: ${studentExcuses.find(e => e.date === h.date)?.fileName}`)}
                                  >
                                    <Paperclip size={10} />
                                    عرض
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-red-400">بدون عذر</span>
                            )
                          ) : h.status === 'late' ? (
                            studentExcuses.find(e => e.date === h.date)?.status === 'approved' ? (
                              <div className="flex items-center gap-1 text-green-600 font-bold">
                                <ShieldCheck size={14} />
                                <span>تأخر مقبول</span>
                                {studentExcuses.find(e => e.date === h.date)?.fileName && (
                                  <button 
                                    className="text-[10px] text-indigo-600 flex items-center gap-1 hover:underline ml-2"
                                    onClick={() => alert(`عرض المرفق: ${studentExcuses.find(e => e.date === h.date)?.fileName}`)}
                                  >
                                    <Paperclip size={10} />
                                    عرض
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-orange-400">تأخر غير مبرر</span>
                            )
                          ) : h.status === 'excused' ? (
                            <div className="flex items-center gap-1 text-sky-600 font-bold">
                              <ShieldCheck size={14} />
                              <span>غياب بعذر مسبق</span>
                            </div>
                          ) : (
                            <span className="text-green-500">في الوقت المحدد</span>
                          )}
                        </td>
                        <td>
                          <div className="flex gap-2">
                            {h.status === 'absent' ? (
                              studentExcuses.find(e => e.date === h.date) ? (
                                <span className="text-green-600 text-xs font-bold bg-green-50 px-3 py-1 rounded-lg">تم تقديم العذر</span>
                              ) : (
                                <button 
                                  onClick={() => {
                                    setNewExcuse(prev => ({ ...prev, date: h.date }));
                                    setActiveTab('excuses');
                                    setShowExcuseModal(true);
                                  }}
                                  className="text-indigo-600 text-xs font-bold bg-indigo-50 px-3 py-1 rounded-lg hover:bg-indigo-100 transition-colors"
                                >
                                  تقديم عذر
                                </button>
                              )
                            ) : h.status === 'present' ? (
                              <span className="text-emerald-600 text-xs font-bold bg-emerald-50 px-3 py-1 rounded-lg">ممتاز</span>
                            ) : h.status === 'late' ? (
                              <span className="text-orange-600 text-xs font-bold bg-orange-50 px-3 py-1 rounded-lg">احضر مبكر</span>
                            ) : h.status === 'excused' ? (
                              <span className="text-sky-600 text-xs font-bold bg-sky-50 px-3 py-1 rounded-lg">غياب مبرر</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {sortedHistory.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-slate-400">لا توجد سجلات حالياً.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'excuses' && (
            <motion.div 
              key="excuses"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black mb-2">الأعذار والمبررات</h2>
                  <p className="text-slate-500">تقديم ومتابعة حالة الأعذار الطبية أو العائلية لأيام الغياب</p>
                </div>
                <button 
                  onClick={() => setShowExcuseModal(true)}
                  className="btn btn-primary px-6 py-3 rounded-xl shadow-lg shadow-indigo-200"
                >
                  <FilePlus size={20} />
                  رفع عذر جديد
                </button>
              </div>

              <div className="excuse-grid">
                {studentExcuses.map(excuse => (
                  <div key={excuse.id} className={`excuse-card ${excuse.status === 'approved' ? 'accepted' : excuse.status === 'rejected' ? 'rejected' : 'pending'}`}>
                    <div className="flex justify-between items-start mb-4">
                      <span className={`excuse-status ${
                        excuse.status === 'approved' ? 'bg-green-100 text-green-600' : 
                        excuse.status === 'rejected' ? 'bg-red-100 text-red-600' : 
                        'bg-orange-100 text-orange-600'
                      }`}>
                        {excuse.status === 'approved' ? 'مقبول' : excuse.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                      </span>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Calendar size={12} />
                        {excuse.date}
                      </span>
                    </div>
                    <h3 className="text-lg font-black mb-2">{excuse.type}</h3>
                    <p className="text-sm text-slate-500 mb-6">{excuse.detail}</p>
                    <button 
                      className="text-indigo-600 text-xs font-bold flex items-center gap-1 hover:underline"
                      onClick={() => {
                        if (excuse.fileUrl) {
                          window.open(excuse.fileUrl, '_blank');
                        } else {
                          alert('المرفق غير متاح للعرض حالياً');
                        }
                      }}
                    >
                      عرض المرفقات
                      <ArrowLeft size={14} />
                    </button>
                  </div>
                ))}
                {studentExcuses.length === 0 && (
                  <div className="col-span-full text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <FileText size={48} className="mx-auto text-slate-300 mb-4" />
                    <p className="text-slate-500">لا توجد أعذار مقدمة حالياً.</p>
                  </div>
                )}
              </div>

              {showExcuseModal && (
                <AnimatePresence>
                  <div className="modal-overlay">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="modal-box max-w-md"
                    >
                      <div className="modal-header">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                            <FileText size={20} />
                          </div>
                          <div>
                            <h3 className="text-lg font-black text-slate-900">رفع عذر جديد</h3>
                            <p className="text-xs text-slate-400 font-bold">يرجى إرفاق المستندات اللازمة</p>
                          </div>
                        </div>
                        <button className="close-btn" onClick={() => setShowExcuseModal(false)}>×</button>
                      </div>
                      <div className="space-y-6 p-2">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="form-label">نوع العذر</label>
                            <select 
                              className="form-select bg-slate-50 border-slate-100"
                              value={newExcuse.type}
                              onChange={(e) => setNewExcuse({ ...newExcuse, type: e.target.value })}
                            >
                              <option>عذر طبي</option>
                              <option>عذر عائلي</option>
                              <option>ظرف طارئ</option>
                            </select>
                          </div>
                          <div>
                            <label className="form-label">التاريخ</label>
                            <input 
                              type="date" 
                              className="form-input bg-slate-50 border-slate-100"
                              value={newExcuse.date}
                              onChange={(e) => setNewExcuse({ ...newExcuse, date: e.target.value })}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="form-label">التفاصيل <span className="text-red-500">*</span></label>
                          <textarea 
                            className="form-input min-h-[120px] bg-slate-50 border-slate-100 resize-none"
                            placeholder="اشرح سبب الغياب بالتفصيل (مطلوب)..."
                            value={newExcuse.detail}
                            onChange={(e) => setNewExcuse({ ...newExcuse, detail: e.target.value })}
                            required
                          ></textarea>
                        </div>
                        <div>
                          <label className="form-label">إرفاق مستند (صورة أو PDF)</label>
                          <input 
                            id="excuse-file-upload"
                            type="file" 
                            className="hidden" 
                            accept="image/*,.pdf"
                            onChange={handleFileChange}
                          />
                          <label 
                            htmlFor="excuse-file-upload"
                            className={`file-upload-box block border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                              newExcuse.fileName ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:border-indigo-300'
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <Upload size={24} className={newExcuse.fileName ? 'text-indigo-600' : 'text-slate-400'} />
                              <span className={`text-sm font-black ${newExcuse.fileName ? 'text-indigo-700' : 'text-slate-500'}`}>
                                {newExcuse.fileName || 'اضغط لرفع الملف'}
                              </span>
                              <p className="text-[10px] text-slate-400 font-bold">أقصى حجم للملف 5 ميجابايت</p>
                            </div>
                          </label>
                        </div>
                        <button 
                          onClick={handleAddExcuse}
                          disabled={!newExcuse.fileName || !newExcuse.detail}
                          className={`w-full py-4 rounded-2xl font-black shadow-lg transition-all flex items-center justify-center gap-2 ${
                            (!newExcuse.fileName || !newExcuse.detail) 
                              ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                              : 'bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700'
                          }`}
                        >
                          <CheckCircle size={20} />
                          إرسال العذر للمراجعة
                        </button>
                      </div>
                    </motion.div>
                  </div>
                </AnimatePresence>
              )}
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto"
            >
              <div className="profile-hero">
                <div className="profile-avatar-container">
                  <div className="w-full h-full bg-slate-50 flex items-center justify-center">
                    <User size={60} className="text-slate-200" />
                  </div>
                  <div className="profile-avatar-badge">
                    <ShieldCheck size={18} />
                  </div>
                </div>
                <h2 className="text-2xl font-black mb-1">{student.class}</h2>
                <p className="text-slate-500">{student.name}</p>
              </div>

              <div className="profile-info-card">
                <div className="flex items-center gap-2 mb-8 pb-4 border-bottom border-slate-100">
                  <Info className="text-indigo-600" size={20} />
                  <h3 className="font-black">معلومات الطالب</h3>
                  <span className="mr-auto px-3 py-1 bg-green-100 text-green-600 text-[10px] font-black rounded-full">منتظم</span>
                </div>

                <div className="profile-grid">
                  <div className="profile-field">
                    <label>رقم الجوال</label>
                    <span dir="ltr">{student.phone}</span>
                  </div>
                  <div className="profile-field">
                    <label>المدرسة</label>
                    <span>مدرسة الجشة المتوسطة</span>
                  </div>
                </div>

                {/* Button removed as requested */}
              </div>
            </motion.div>
          )}

          {showWelcomeAlert && (
            <div className="modal-overlay">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="modal-box max-w-md text-center p-8"
              >
                <div className="w-20 h-20 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <AlertTriangle size={40} />
                </div>
                <h3 className="text-2xl font-black text-slate-900 mb-4">تنبيه</h3>
                <p className="text-slate-600 leading-relaxed mb-8">
                  عزيزي ولي الأمر<br />
                  يوجد لدى الطالب/ة <span className="font-bold text-indigo-600">({student.name})</span> عدد <span className="font-bold text-red-600">[{alertType === 'absent' ? studentHistory.filter(h => h.status === 'absent' && !studentExcuses.find(e => e.date === h.date)).length : studentHistory.filter(h => h.status === 'late' && !studentExcuses.find(e => e.date === h.date)).length}]</span> من سجلات {alertType === 'absent' ? 'الغياب' : 'التأخير'} دون عذر مسجّل في النظام.<br />
                  يُرجى التكرم بالانتقال إلى قسم "الأعذار والمبررات" وتقديم العذر اللازم.
                </p>
                <button 
                  onClick={() => {
                    setShowWelcomeAlert(false);
                    setActiveTab('excuses');
                  }}
                  className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
                >
                  الانتقال لقسم الأعذار
                </button>
                <button 
                  onClick={() => setShowWelcomeAlert(false)}
                  className="w-full mt-3 py-3 text-slate-400 font-bold hover:text-slate-600 transition-all"
                >
                  إغلاق
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Helper Components ---
function StatCard({ title, value, icon, color }: { title: string, value: number, icon: React.ReactNode, color: string }) {
  return (
    <div className="stat-card">
      <div className="stat-info">
        <h3>{title}</h3>
        <p className={`text-${color}`}>{value}</p>
      </div>
      <div className={`stat-icon bg-${color}-light text-${color}`}>
        {icon}
      </div>
    </div>
  );
}
