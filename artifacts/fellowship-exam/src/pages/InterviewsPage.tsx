import { useState, useEffect } from "react";
import { fmtDate, fmtTime } from "../lib/dateUtils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Stethoscope, UserPlus, Trash2, Star, Activity, RadioTower,
  LayoutGrid, Plus, Settings, Users, ArrowRight, CheckCircle2,
  Clock, DoorOpen, UserCheck, X, FileText, Loader2,
} from "lucide-react";
import { useToast } from "../hooks/use-toast";

interface DoctorRow {
  doctorId: number; doctorName: string; doctorEmail: string;
  unitId: number | null; unitName: string | null;
  assignments: { id: number; candidateId: number; candidateName: string; candidateCode: string; scheduledAt: string | null; status: string; score: number | null; }[];
}

interface Candidate {
  id: number;
  candidateCode: string;
  fullName: string;
  status: string;
  mcqScore?: number | null;
  psychometricScore?: number | null;
  applications?: any[];
  specializations?: string[];
}

interface ScoreEntry {
  id: number; candidateId: number; candidateName: string; candidateCode: string;
  doctorId: number; doctorName: string; score: number; remarks: string | null; submittedAt: string; totalMarks?: number;
}

interface DoctorAssignment {
  id: number; candidateId: number; candidateCode: string; candidateName: string;
  status: string; scheduledAt: string | null;
  existingScore: { id: number; score: number; remarks: string | null; submittedAt: string } | null;
  batchId?: number;
  specialityId?: number | null;
  specialityName?: string;
  submissionId?: number | null;
}

interface PanelEntry {
  doctorId: number; doctorName: string; doctorEmail: string;
  unitId: number | null; unitName: string | null;
  isEngaged: boolean; engagedSince: string | null;
  currentCandidateId: number | null; currentCandidateName: string | null; currentCandidateCode: string | null;
  updatedAt: string;
}

interface PanelMember { doctorId: number; doctorName: string; doctorEmail: string; isMain: boolean; }
interface Panel {
  id: number; name: string; roomNumber: string; programId: number | null;
  specialityId?: number | null;
  isActive: boolean; createdAt: string; members: PanelMember[];
}

interface QueueEntry {
  id: number; panelId: number; candidateId: number; candidateName: string; candidateCode: string;
  queuePosition: number; status: string; calledAt: string | null; createdAt: string;
}

interface DoctorUser { id: number; fullName: string; email: string; role: string; }

export default function InterviewsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isCEC = user?.role === "central_exam_coordinator";
  const isAdmin = user?.role === "super_admin" || user?.role === "program_admin";
  const isDoctor = user?.role === "doctor";

  if (isDoctor) return <DoctorView toast={toast} qc={qc} />;
  if (isCEC || isAdmin) return <AdminView toast={toast} qc={qc} isCEC={isCEC} />;
  return null;
}

/* ─── Doctor View ─── */
function DoctorView({ toast, qc }: { toast: ReturnType<typeof import("../hooks/use-toast").useToast>["toast"]; qc: ReturnType<typeof useQueryClient> }) {
  const [scoreOpen, setScoreOpen] = useState<DoctorAssignment | null>(null);
  const [score, setScore] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data: assignments = [] } = useQuery<DoctorAssignment[]>({
    queryKey: ["doctor-assignments"],
    queryFn: () => api.get<DoctorAssignment[]>("/interviews/assignments"),
  });

  const { data: myStatus } = useQuery<{
    isEngaged: boolean; currentCandidateId: number | null;
    currentCandidateName: string | null; currentCandidateCode: string | null;
    panelName: string | null; roomNumber: string | null;
    specialityId: number | null; specialityName: string | null;
  }>({
    queryKey: ["panel-my-status"],
    queryFn: () => api.get("/panel/my-status"),
    refetchInterval: 5000,
  });

  const toggleStatus = useMutation({
    mutationFn: (body: { isEngaged: boolean; candidateId?: number | null }) => api.patch("/panel/status", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["panel-my-status"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const submitScore = useMutation({
    mutationFn: ({ candidateId, score, remarks }: { candidateId: number; score: number; remarks: string }) =>
      api.post("/interviews/scores", { candidateId, score, remarks }),
    onSuccess: () => { toast({ title: "Score submitted" }); qc.invalidateQueries({ queryKey: ["doctor-assignments"] }); setScoreOpen(null); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isEngaged = myStatus?.isEngaged ?? false;

  return (
    <div className="p-6 space-y-6">
      <Card className={`border-2 ${isEngaged ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" : "border-green-400 bg-green-50/50 dark:bg-green-950/20"}`}>
        <CardContent className="flex items-center justify-between py-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full animate-pulse ${isEngaged ? "bg-red-500" : "bg-green-500"}`} />
            <div>
              <p className={`font-semibold ${isEngaged ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                {isEngaged ? "Engaged — Interview in Progress" : "Free — Available"}
              </p>
              {myStatus?.panelName && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Panel: <strong>{myStatus.panelName}</strong> · Room {myStatus.roomNumber}
                  {myStatus.specialityName && (
                    <span className="ml-1 text-primary font-medium">({myStatus.specialityName})</span>
                  )}
                </p>
              )}
              {isEngaged && myStatus?.currentCandidateName && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Candidate: <strong>{myStatus.currentCandidateName}</strong> ({myStatus.currentCandidateCode})
                </p>
              )}
            </div>
          </div>
          <Button
            variant={isEngaged ? "destructive" : "default"} size="sm" className="gap-2"
            disabled={toggleStatus.isPending}
            onClick={() => toggleStatus.mutate({ isEngaged: !isEngaged, candidateId: isEngaged ? null : undefined })}
          >
            <RadioTower className="h-4 w-4" />
            {isEngaged ? "Mark as Free" : "Mark as Engaged"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold font-mono">My Interview Assignments</h1>
          {myStatus?.specialityName && (
            <p className="text-sm font-semibold text-primary mt-1">Specialization Panel: {myStatus.specialityName}</p>
          )}
          <p className="text-muted-foreground text-sm mt-1">{assignments.length} candidates assigned</p>
        </div>
        {assignments.length > 0 && (
          <Button 
            variant="outline"
            onClick={() => window.open(`/api/interviews/my-scores/export?token=${localStorage.getItem("fellowship_token")}`, "_blank")} 
            className="gap-2 border-indigo-200 text-indigo-750 hover:bg-indigo-50 font-bold h-10 px-4 rounded-xl text-xs uppercase tracking-wider shadow-sm"
          >
            <FileText className="h-4 w-4 text-indigo-500" /> Download My Evaluations
          </Button>
        )}
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-16">
          <Stethoscope className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No candidates assigned yet</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Candidate</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Scheduled</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        <div>
                          {a.candidateName}
                          {a.specialityName && (
                            <span className="block text-[10px] text-muted-foreground">{a.specialityName}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{a.candidateCode}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {a.scheduledAt ? new Date(a.scheduledAt).toLocaleString("en-IN") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={a.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                          {a.existingScore ? `Score: ${a.existingScore.score}` : a.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => { setScoreOpen(a); setScore(a.existingScore?.score?.toString() ?? ""); setRemarks(a.existingScore?.remarks ?? ""); }}>
                          {a.existingScore ? "Edit Score" : "Submit Score"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!scoreOpen} onOpenChange={() => setScoreOpen(null)}>
        <DialogContent className="max-w-5xl w-[90vw] p-0 rounded-3xl overflow-hidden border-none bg-white shadow-2xl">
          <DialogHeader className="bg-slate-900 text-white p-6 shrink-0 border-b border-white/5 flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-black uppercase tracking-widest text-white flex items-center gap-2">
                <Stethoscope className="h-5 w-5 text-indigo-400" />
                Clinical Evaluation Station — {scoreOpen?.candidateName}
              </DialogTitle>
              {scoreOpen?.specialityName && (
                <Badge variant="outline" className="mt-2 text-[10px] font-black uppercase text-indigo-200 border-indigo-500/30 bg-indigo-500/10 h-6 px-3">
                  Specialization: {scoreOpen.specialityName}
                </Badge>
              )}
            </div>
          </DialogHeader>

          {scoreOpen && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-0 h-[70vh]">
              {/* Left Column: Comprehensive Printable Form with LOR */}
              <div className="md:col-span-3 border-r bg-slate-50 flex flex-col p-4 space-y-3">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-slate-400" />
                    Applicant Dossier & Reference LOR Files
                  </span>
                  <Badge variant="outline" className="text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 border-slate-200 h-5">
                    Code: {scoreOpen.candidateCode}
                  </Badge>
                </div>
                <div className="flex-1 border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-sm relative">
                  {scoreOpen.submissionId ? (
                    <iframe 
                      src={`/api/submission-view/${scoreOpen.submissionId}?token=${localStorage.getItem("fellowship_token")}`} 
                      className="w-full h-full border-none" 
                      title="Candidate Application Form"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm font-semibold">
                      No print submission available
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Score entry and lock protocols */}
              <div className="md:col-span-2 p-6 flex flex-col justify-between bg-white h-full">
                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-none">Evaluation Matrix</h4>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Total scoring range: 0 – 50 Marks (Clinical VIVA)
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Assigned Clinical Mark (max 50)</Label>
                      <Input 
                        type="number" 
                        min={0} 
                        max={50}
                        value={score} 
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val > 50) setScore("50");
                          else if (val < 0) setScore("0");
                          else setScore(e.target.value);
                        }} 
                        placeholder="Enter score..." 
                        className="h-12 border-2 rounded-xl focus:ring-indigo-500 font-bold font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Assessment Remarks</Label>
                      <textarea 
                        value={remarks} 
                        onChange={(e) => setRemarks(e.target.value)} 
                        placeholder="Clinical assessment observations, skills proficiency, panel consensus notes..." 
                        className="w-full min-h-[140px] p-3 text-sm font-semibold border-2 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 border-input bg-background"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-100 flex flex-col gap-2 shrink-0">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setScoreOpen(null)} 
                      className="rounded-xl h-12 text-xs font-bold uppercase tracking-wider flex-1"
                    >
                      Cancel
                    </Button>
                    <Button 
                      disabled={!score || submitScore.isPending} 
                      onClick={() => scoreOpen && submitScore.mutate({ candidateId: scoreOpen.candidateId, score: Number(score), remarks })}
                      className="rounded-xl h-12 bg-slate-900 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-wider flex-1 gap-1.5 shadow-lg active:scale-95 transition-all"
                    >
                      {submitScore.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4 text-emerald-400" />}
                      Commit & Lock
                    </Button>
                  </div>
                  <p className="text-[9px] font-bold text-center text-slate-400 uppercase tracking-widest mt-1">
                    * Evaluation lock synchronizes marks to counseling queue atomically
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Admin / CEC View ─── */
function AdminView({ toast, qc, isCEC }: { toast: ReturnType<typeof import("../hooks/use-toast").useToast>["toast"]; qc: ReturnType<typeof useQueryClient>; isCEC: boolean }) {
  const [activeTab, setActiveTab] = useState<"panels" | "live" | "scores" | "marksheet">("panels");
  const [assignDoctorId, setAssignDoctorId] = useState<number | null>(null);
  const [assignCandidateId, setAssignCandidateId] = useState("");
  const [assignScheduled, setAssignScheduled] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");

  const { data: livePanel = [], isLoading: liveLoading } = useQuery<PanelEntry[]>({
    queryKey: ["panel-live"],
    queryFn: () => api.get<PanelEntry[]>("/panel/live"),
    refetchInterval: activeTab === "live" ? 4000 : false,
  });

  const { data: specialities = [] } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["specialities"],
    queryFn: () => api.get("/specialities"),
  });

  const { data: doctors = [], isLoading: doctorsLoading } = useQuery<DoctorRow[]>({
    queryKey: ["doctor-assignments-admin"],
    queryFn: () => api.get<DoctorRow[]>("/interviews/doctor-assignments"),
  });

  const { data: scores = [] } = useQuery<ScoreEntry[]>({
    queryKey: ["interview-scores"],
    queryFn: () => api.get<ScoreEntry[]>("/interviews/scores"),
  });

  const { data: candidates = [] } = useQuery<Candidate[]>({
    queryKey: ["candidates"],
    queryFn: () => api.get<Candidate[]>("/candidates"),
  });

  const assignMutation = useMutation({
    mutationFn: (body: { doctorId: number; candidateId: number; scheduledAt?: string }) =>
      api.post("/interviews/assign", body),
    onSuccess: () => {
      toast({ title: "Candidate assigned" });
      qc.invalidateQueries({ queryKey: ["doctor-assignments-admin"] });
      setAssignDoctorId(null); setAssignCandidateId(""); setAssignScheduled("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/interviews/assign/${id}`),
    onSuccess: () => { toast({ title: "Assignment removed" }); qc.invalidateQueries({ queryKey: ["doctor-assignments-admin"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredCandidates = candidates.filter((c) =>
    !candidateSearch || c.fullName.toLowerCase().includes(candidateSearch.toLowerCase()) || c.candidateCode.toLowerCase().includes(candidateSearch.toLowerCase())
  );

  const engagedCount = livePanel.filter((d) => d.isEngaged).length;
  const freeCount = livePanel.filter((d) => !d.isEngaged).length;
  const _ = isCEC; // suppress unused warning

  const tabs = [
    { key: "panels" as const, label: "Interview Panels", icon: LayoutGrid },
    { key: "live" as const, label: "Live Status", icon: Activity },
    { key: "scores" as const, label: `Scores (${scores.length})`, icon: Star },
    { key: "marksheet" as const, label: "Mark Sheet", icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-black p-4 md:p-8 space-y-8 animate-in fade-in duration-700">
      {/* Premium Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-amber-600 to-orange-500 p-8 text-white shadow-2xl">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 to-transparent blur-3xl" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-orange-100 text-sm font-medium">
              <Stethoscope className="h-4 w-4" />
              <span>Assessment Cycle</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight">Interviews & Panels</h1>
            <p className="text-orange-100/80 max-w-md">Orchestrate interview panels, monitor live session progress, and review faculty assessments.</p>
          </div>
          <div className="flex flex-wrap gap-2 bg-black/10 p-1.5 rounded-2xl backdrop-blur-md">
            {tabs.map((t) => (
              <Button 
                key={t.key} 
                variant={activeTab === t.key ? "default" : "ghost"} 
                size="sm" 
                onClick={() => setActiveTab(t.key)}
                className={`h-10 px-4 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all border-none ${activeTab === t.key ? 'bg-white text-orange-600 shadow-lg' : 'text-orange-50 hover:bg-white/10 hover:text-white'}`}
              >
                <t.icon className="h-4 w-4 mr-2" />{t.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* ── INTERVIEW PANELS ── */}
      {activeTab === "panels" && (
        <PanelsTab toast={toast} qc={qc} candidates={candidates} specialities={specialities} />
      )}

      {/* ── LIVE STATUS ── */}
      {activeTab === "live" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
              <CardContent className="flex items-center gap-3 py-4">
                <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center"><div className="h-3 w-3 rounded-full bg-green-500" /></div>
                <div><p className="text-2xl font-bold text-green-700 dark:text-green-400">{freeCount}</p><p className="text-xs text-green-600 dark:text-green-500">Doctors Free</p></div>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
              <CardContent className="flex items-center gap-3 py-4">
                <div className="h-8 w-8 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center"><div className="h-3 w-3 rounded-full animate-pulse bg-red-500" /></div>
                <div><p className="text-2xl font-bold text-red-700 dark:text-red-400">{engagedCount}</p><p className="text-xs text-red-600 dark:text-red-500">Interviews in Progress</p></div>
              </CardContent>
            </Card>
          </div>
          {liveLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading panel…</div>
          ) : livePanel.length === 0 ? (
            <div className="text-center py-16"><Activity className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" /><p className="text-muted-foreground">No panel doctors configured</p></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {livePanel.map((d) => (
                <Card key={d.doctorId} className={`border-2 transition-all duration-500 ${d.isEngaged ? "border-red-300 bg-red-50/60 dark:bg-red-950/20 dark:border-red-700" : "border-green-300 bg-green-50/60 dark:bg-green-950/20 dark:border-green-700"}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-sm">{d.doctorName}</p>
                        {d.unitName && <p className="text-[11px] text-muted-foreground">{d.unitName}</p>}
                      </div>
                      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${d.isEngaged ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"}`}>
                        <div className={`h-2 w-2 rounded-full ${d.isEngaged ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
                        {d.isEngaged ? "Engaged" : "Free"}
                      </div>
                    </div>
                    {d.isEngaged && d.currentCandidateName && (
                      <div className="rounded-lg bg-background/70 border p-2.5 space-y-1">
                        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Current Candidate</p>
                        <p className="text-sm font-semibold">{d.currentCandidateName}</p>
                        {d.currentCandidateCode && <p className="text-xs font-mono text-muted-foreground">{d.currentCandidateCode}</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">Auto-refreshes every 4 seconds</p>
        </div>
      )}

      {/* ── MARK SHEET TAB ── */}
      {activeTab === "marksheet" && (
        <MarkSheetTab specialities={specialities} candidates={candidates} scores={scores} isCEC={isCEC} toast={toast} doctors={doctors} />
      )}

      {/* ── SCORES ── */}
      {activeTab === "scores" && (
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" /> Interview Results Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 mt-4">
            {scores.length === 0 ? (
              <div className="text-center py-16"><Star className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" /><p className="text-muted-foreground">No interview scores yet</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Candidate</th>
                      <th className="text-center px-4 py-3 font-medium text-muted-foreground">Avg. Score</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Doctor Breakdown</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const grouped: Record<number, { name: string; code: string; scores: ScoreEntry[]; total: number }> = {};
                      scores.forEach((s) => {
                        if (!grouped[s.candidateId]) {
                          grouped[s.candidateId] = { name: s.candidateName, code: s.candidateCode, scores: [], total: s.totalMarks || 100 };
                        }
                        grouped[s.candidateId]!.scores.push(s);
                      });

                      return Object.entries(grouped).map(([cid, data]) => {
                        const avg = data.scores.reduce((acc, s) => acc + s.score, 0) / data.scores.length;
                        const lastDate = new Date(Math.max(...data.scores.map(s => new Date(s.submittedAt).getTime())));
                        
                        return (
                          <tr key={cid} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <p className="font-semibold">{data.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{data.code}</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center">
                                <span className="text-lg font-bold text-primary">{avg.toFixed(1)}</span>
                                <span className="text-[10px] text-muted-foreground">out of {data.total}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-1.5">
                                {data.scores.map((s) => (
                                  <div key={s.id} className="flex items-center gap-2">
                                    <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px] bg-background">
                                      {s.score}
                                    </Badge>
                                    <span className="text-xs font-medium text-muted-foreground">{s.doctorName}</span>
                                    {s.remarks && (
                                      <span className="text-[10px] italic text-muted-foreground truncate max-w-[150px]" title={s.remarks}>
                                        — "{s.remarks}"
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                              {fmtDate(lastDate)}
                              <br />
                              {fmtTime(lastDate)}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Assign Dialog */}
      <Dialog open={assignDoctorId != null} onOpenChange={(o) => { if (!o) { setAssignDoctorId(null); setAssignCandidateId(""); setAssignScheduled(""); setCandidateSearch(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Assign Candidate to Doctor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Search Candidate</Label>
              <Input placeholder="Name or code…" value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Select Candidate</Label>
              <Select value={assignCandidateId} onValueChange={setAssignCandidateId}>
                <SelectTrigger><SelectValue placeholder="Pick a candidate…" /></SelectTrigger>
                <SelectContent>
                  {filteredCandidates.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.fullName} · {c.candidateCode}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scheduled Time (optional)</Label>
              <Input type="datetime-local" value={assignScheduled} onChange={(e) => setAssignScheduled(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignDoctorId(null); setAssignCandidateId(""); }}>Cancel</Button>
            <Button disabled={!assignCandidateId || assignMutation.isPending}
              onClick={() => assignDoctorId && assignMutation.mutate({ doctorId: assignDoctorId, candidateId: Number(assignCandidateId), scheduledAt: assignScheduled || undefined })}>
              {assignMutation.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Panels Tab ─── */
function PanelsTab({ toast, qc, candidates, specialities }: {
  toast: ReturnType<typeof import("../hooks/use-toast").useToast>["toast"];
  qc: ReturnType<typeof useQueryClient>;
  candidates: Candidate[];
  specialities: { id: number; name: string; code: string }[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createRoom, setCreateRoom] = useState("");
  const [createSpecialityId, setCreateSpecialityId] = useState<string>("none");
  const [createIsMindMatter, setCreateIsMindMatter] = useState(false);

  const [selectedPanelId, setSelectedPanelId] = useState<number | null>(null);
  const [addMemberDoctorId, setAddMemberDoctorId] = useState("");
  const [addCandidateId, setAddCandidateId] = useState("");
  const [candSearch, setCandSearch] = useState("");
  const [managePanel, setManagePanel] = useState<Panel | null>(null);

  const [editName, setEditName] = useState("");
  const [editRoom, setEditRoom] = useState("");
  const [editSpecialityId, setEditSpecialityId] = useState<string>("none");
  const [editIsMindMatter, setEditIsMindMatter] = useState(false);

  const { data: panels = [], isLoading } = useQuery<Panel[]>({
    queryKey: ["panels"],
    queryFn: () => api.get<Panel[]>("/panels"),
    refetchInterval: 8000,
  });


  const { data: doctorUsers = [] } = useQuery<DoctorUser[]>({
    queryKey: ["users"],
    queryFn: () => api.get<DoctorUser[]>("/users"),
    select: (u) => u.filter((x) => x.role === "doctor"),
  });

  const { data: panelQueue = [] } = useQuery<QueueEntry[]>({
    queryKey: ["panel-queue", selectedPanelId],
    queryFn: () => api.get<QueueEntry[]>(`/panels/${selectedPanelId}/queue`),
    enabled: selectedPanelId !== null,
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; roomNumber: string; specialityId?: number | null; isMindMatter?: boolean }) => api.post<Panel>("/panels", body),
    onSuccess: () => {
      toast({ title: "Panel created" });
      qc.invalidateQueries({ queryKey: ["panels"] });
      setCreateOpen(false); setCreateName(""); setCreateRoom(""); setCreateSpecialityId("none"); setCreateIsMindMatter(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePanelMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/panels/${id}`),
    onSuccess: () => {
      toast({ title: "Panel deleted" });
      qc.invalidateQueries({ queryKey: ["panels"] });
      setSelectedPanelId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePanelMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; roomNumber?: string; isActive?: boolean; specialityId?: number | null; isMindMatter?: boolean }) =>
      api.patch(`/panels/${id}`, body),
    onSuccess: () => {
      toast({ title: "Panel updated" });
      qc.invalidateQueries({ queryKey: ["panels"] });
      setManagePanel(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (managePanel) {
      setEditName(managePanel.name);
      setEditRoom(managePanel.roomNumber);
      setEditSpecialityId(managePanel.specialityId ? String(managePanel.specialityId) : "none");
      setEditIsMindMatter((managePanel as any).isMindMatter ?? false);
    }
  }, [managePanel]);

  const addMemberMutation = useMutation({
    mutationFn: ({ panelId, doctorId }: { panelId: number; doctorId: number }) =>
      api.post(`/panels/${panelId}/members`, { doctorId }),
    onSuccess: () => {
      toast({ title: "Doctor added to panel" });
      qc.invalidateQueries({ queryKey: ["panels"] });
      setAddMemberDoctorId("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ panelId, doctorId }: { panelId: number; doctorId: number }) =>
      api.delete(`/panels/${panelId}/members/${doctorId}`),
    onSuccess: () => { toast({ title: "Doctor removed" }); qc.invalidateQueries({ queryKey: ["panels"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addToQueueMutation = useMutation({
    mutationFn: ({ panelId, candidateId }: { panelId: number; candidateId: number }) =>
      api.post(`/panels/${panelId}/queue`, { candidateId }),
    onSuccess: () => {
      toast({ title: "Added to queue" });
      qc.invalidateQueries({ queryKey: ["panel-queue", selectedPanelId] });
      setAddCandidateId(""); setCandSearch("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateQueueMutation = useMutation({
    mutationFn: ({ panelId, candidateId, status }: { panelId: number; candidateId: number; status: string }) =>
      api.patch(`/panels/${panelId}/queue/${candidateId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panel-queue", selectedPanelId] });
      qc.invalidateQueries({ queryKey: ["display-live"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeFromQueueMutation = useMutation({
    mutationFn: ({ panelId, candidateId }: { panelId: number; candidateId: number }) =>
      api.delete(`/panels/${panelId}/queue/${candidateId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["panel-queue", selectedPanelId] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auto-select first panel
  useEffect(() => {
    if (panels.length > 0 && !selectedPanelId) {
      setSelectedPanelId(panels[0]!.id);
    }
  }, [panels, selectedPanelId]);

  const selectedPanel = panels.find((p) => p.id === selectedPanelId);
  const filteredCandidates = candidates.filter((c) =>
    !candSearch || c.fullName.toLowerCase().includes(candSearch.toLowerCase()) || c.candidateCode.toLowerCase().includes(candSearch.toLowerCase())
  );

  const currentCandidate = panelQueue.find((q) => q.status === "in_progress");
  const waitingQueue = panelQueue.filter((q) => q.status === "waiting");
  const doneQueue = panelQueue.filter((q) => q.status === "done");

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading panels…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{panels.length}</span> panels ·{" "}
          <span className="font-semibold text-emerald-600">{panels.filter((p) => p.isActive).length}</span> active
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Panel
        </Button>
      </div>

      {panels.length === 0 ? (
        <div className="rounded-xl border border-dashed p-16 text-center space-y-3">
          <LayoutGrid className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">No interview panels yet</p>
          <p className="text-xs text-muted-foreground">Create a panel to assign doctors and manage the interview queue</p>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Create First Panel</Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Panel list */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Panels</p>
            {panels.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPanelId(p.id)}
                className={`w-full text-left rounded-lg border p-3 transition-all ${
                  selectedPanelId === p.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 bg-card"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">Room {p.roomNumber}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${p.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${p.isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
                      {p.isActive ? "Active" : "Inactive"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{p.members.length} doctors</span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Panel detail */}
          {selectedPanel && (
            <div className="lg:col-span-2 space-y-4">
              {/* Panel header */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <DoorOpen className="h-4 w-4" /> Room {selectedPanel.roomNumber}
                        <span className="text-base font-normal text-muted-foreground">— {selectedPanel.name}</span>
                      </CardTitle>
                      {selectedPanel.specialityId && (
                        <div className="mt-1">
                          <Badge variant="outline" className="text-[10px] text-primary border-primary/20 bg-primary/5">
                            Specialization: {specialities.find((s) => s.id === selectedPanel.specialityId)?.name || "Mapped"}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                        onClick={() => updatePanelMutation.mutate({ id: selectedPanel.id, isActive: !selectedPanel.isActive })}>
                        {selectedPanel.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setManagePanel(selectedPanel)}>
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => { if (window.confirm(`Delete panel "${selectedPanel.name}"?`)) deletePanelMutation.mutate(selectedPanel.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Panel Doctors</p>
                  {selectedPanel.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground mb-2">No doctors assigned yet</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {selectedPanel.members.map((m) => (
                        <div key={m.doctorId} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-sm">
                          <UserCheck className="h-3 w-3 text-primary" />
                          <span className="font-medium text-xs">{m.doctorName}</span>
                          {m.isMain && <Badge className="text-[9px] h-4 px-1">Main</Badge>}
                          <button className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => removeMemberMutation.mutate({ panelId: selectedPanel.id, doctorId: m.doctorId })}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Select value={addMemberDoctorId} onValueChange={setAddMemberDoctorId}>
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Add a doctor to this panel…" />
                      </SelectTrigger>
                      <SelectContent>
                        {doctorUsers
                          .filter((d) => !selectedPanel.members.find((m) => m.doctorId === d.id))
                          .map((d) => (
                            <SelectItem key={d.id} value={String(d.id)} className="text-xs">{d.fullName}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 gap-1 text-xs" disabled={!addMemberDoctorId || addMemberMutation.isPending}
                      onClick={() => addMemberDoctorId && addMemberMutation.mutate({ panelId: selectedPanel.id, doctorId: Number(addMemberDoctorId) })}>
                      <UserPlus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Queue */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Interview Queue</span>
                    <Badge variant="secondary" className="text-xs">
                      {waitingQueue.length} waiting · {doneQueue.length} done
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Currently in session */}
                  {currentCandidate ? (
                    <div className="rounded-lg border-2 border-orange-400 bg-orange-50 dark:bg-orange-950/30 p-3">
                      <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider mb-1">In Session</p>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{currentCandidate.candidateName}</p>
                          <p className="text-xs font-mono text-muted-foreground">{currentCandidate.candidateCode}</p>
                          {currentCandidate.calledAt && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Since {fmtTime(currentCandidate.calledAt)}
                            </p>
                          )}
                        </div>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                          onClick={() => updateQueueMutation.mutate({ panelId: selectedPanel.id, candidateId: currentCandidate.candidateId, status: "done" })}>
                          <CheckCircle2 className="h-3 w-3" /> Done
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                      No active interview — call the next candidate below
                    </div>
                  )}

                  {/* Waiting list */}
                  {waitingQueue.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Waiting Queue</p>
                      {waitingQueue.map((q, i) => (
                        <div key={q.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}</span>
                            <div>
                              <p className="text-sm font-medium">{q.candidateName}</p>
                              <p className="text-xs font-mono text-muted-foreground">{q.candidateCode}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {i === 0 && !currentCandidate && (
                              <Button size="sm" className="h-7 gap-1 text-xs"
                                onClick={() => updateQueueMutation.mutate({ panelId: selectedPanel.id, candidateId: q.candidateId, status: "in_progress" })}>
                                <ArrowRight className="h-3 w-3" /> Call
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => removeFromQueueMutation.mutate({ panelId: selectedPanel.id, candidateId: q.candidateId })}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add to queue */}
                  <div className="pt-2 border-t space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Add candidate to queue</p>
                    <Input
                      placeholder="Search candidate by name or code…" value={candSearch}
                      onChange={(e) => setCandSearch(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <div className="flex gap-2">
                      <Select value={addCandidateId} onValueChange={setAddCandidateId}>
                        <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select candidate…" /></SelectTrigger>
                        <SelectContent>
                          {filteredCandidates
                            .filter((c) => !panelQueue.find((q) => q.candidateId === c.id && q.status !== "done"))
                            .filter((c) => {
                              if (!selectedPanel?.specialityId) return true; // General panel accepts any candidate
                              const specId = Number(selectedPanel.specialityId);
                              const hasApp = (c as any).applications?.some((app: any) => Number(app.specialityId) === specId);
                              const hasPref = (c as any).preferences?.some((p: any) => Number(p.specialityId) === specId);
                              return hasApp || hasPref;
                            })
                            .map((c) => (
                              <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.fullName} · {c.candidateCode}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-8 text-xs gap-1" disabled={!addCandidateId || addToQueueMutation.isPending}
                        onClick={() => addCandidateId && addToQueueMutation.mutate({ panelId: selectedPanel.id, candidateId: Number(addCandidateId) })}>
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  </div>

                  {/* Done */}
                  {doneQueue.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Completed Today ({doneQueue.length})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {doneQueue.map((q) => (
                          <span key={q.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs">
                            <CheckCircle2 className="h-2.5 w-2.5" /> {q.candidateCode}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {waitingQueue.length === 0 && !currentCandidate && doneQueue.length === 0 && (
                    <div className="text-center py-4 text-sm text-muted-foreground flex items-center justify-center gap-2">
                      <Clock className="h-4 w-4" /> Queue is empty — add candidates above
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Create Panel Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateName(""); setCreateRoom(""); setCreateSpecialityId("none"); setCreateIsMindMatter(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Create Interview Panel</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Panel Name</Label>
              <Input placeholder="e.g. Panel A, VR Panel…" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Room Number / Name</Label>
              <Input placeholder="e.g. Room 101, Conference Hall…" value={createRoom} onChange={(e) => setCreateRoom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Specialization Mapping</Label>
              <Select value={createSpecialityId} onValueChange={setCreateSpecialityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Specialization..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (General Panel)</SelectItem>
                  {specialities.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input 
                type="checkbox" 
                id="createIsMindMatter"
                checked={createIsMindMatter} 
                onChange={(e) => setCreateIsMindMatter(e.target.checked)}
                className="h-4 w-4 rounded border-gray-350 text-orange-650 focus:ring-orange-500"
              />
              <Label htmlFor="createIsMindMatter" className="text-xs font-bold text-slate-750 cursor-pointer">Is Mind Matter Panel</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={!createName.trim() || !createRoom.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({
                name: createName.trim(),
                roomNumber: createRoom.trim(),
                specialityId: createSpecialityId === "none" ? null : Number(createSpecialityId),
                isMindMatter: createIsMindMatter
              })}>
              {createMutation.isPending ? "Creating…" : "Create Panel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Panel Info / Manage Dialog */}
      <Dialog open={managePanel !== null} onOpenChange={(o) => { if (!o) setManagePanel(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Manage Panel — {managePanel?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Panel Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Room Number / Name</Label>
              <Input value={editRoom} onChange={(e) => setEditRoom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Specialization Mapping</Label>
              <Select value={editSpecialityId} onValueChange={setEditSpecialityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Specialization..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (General Panel)</SelectItem>
                  {specialities.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input 
                type="checkbox" 
                id="editIsMindMatter"
                checked={editIsMindMatter} 
                onChange={(e) => setEditIsMindMatter(e.target.checked)}
                className="h-4 w-4 rounded border-gray-350 text-orange-650 focus:ring-orange-500"
              />
              <Label htmlFor="editIsMindMatter" className="text-xs font-bold text-slate-755 cursor-pointer">Is Mind Matter Panel</Label>
            </div>
            <div className="flex justify-between border-t pt-2 text-sm">
              <span className="text-muted-foreground">Members count:</span>
              <span className="font-semibold">{managePanel?.members.length} doctors</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagePanel(null)}>Cancel</Button>
            <Button disabled={!editName.trim() || !editRoom.trim() || updatePanelMutation.isPending}
              onClick={() => managePanel && updatePanelMutation.mutate({
                id: managePanel.id,
                name: editName.trim(),
                roomNumber: editRoom.trim(),
                specialityId: editSpecialityId === "none" ? null : Number(editSpecialityId),
                isMindMatter: editIsMindMatter
              })}>
              {updatePanelMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Helper Editable Score Cell Component ─── */
function EditableCell({ 
  value, 
  onSave, 
  max, 
  canEdit 
}: { 
  value: number | null; 
  onSave: (val: number | null) => Promise<void>; 
  max: number; 
  canEdit: boolean; 
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState<string>(value !== null ? String(value) : "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTempValue(value !== null ? String(value) : "");
  }, [value]);

  if (!canEdit) {
    return <span className="tabular-nums font-mono text-xs text-slate-650">{value !== null ? value.toFixed(1) : "—"}</span>;
  }

  const handleBlurOrEnter = async () => {
    if (isSaving) return;
    setIsEditing(false);
    
    const trimmed = tempValue.trim();
    if (trimmed === "") {
      if (value !== null) {
        setIsSaving(true);
        try {
          await onSave(null);
        } catch {}
        setIsSaving(false);
      }
      return;
    }

    const num = parseFloat(trimmed);
    if (isNaN(num) || num < 0 || num > max) {
      setTempValue(value !== null ? String(value) : "");
      return;
    }

    if (num !== value) {
      setIsSaving(true);
      try {
        await onSave(num);
      } catch {}
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        type="number"
        step="0.1"
        min="0"
        max={max}
        className="w-18 h-7 text-xs text-right font-mono border-orange-400 focus:ring-orange-500 rounded px-1.5 py-0.5 bg-amber-50/50"
        value={tempValue}
        onChange={(e) => setTempValue(e.target.value)}
        onBlur={handleBlurOrEnter}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleBlurOrEnter();
          if (e.key === "Escape") {
            setIsEditing(false);
            setTempValue(value !== null ? String(value) : "");
          }
        }}
        autoFocus
      />
    );
  }

  return (
    <div 
      onClick={() => setIsEditing(true)} 
      className="inline-flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-2 py-1 rounded border border-dashed border-transparent hover:border-slate-300/65 transition-all font-mono text-slate-700 font-bold text-xs"
      title="Click to edit score"
    >
      {isSaving ? (
        <span className="text-[10px] text-orange-500 animate-pulse font-sans font-medium">saving…</span>
      ) : (
        <span className="tabular-nums">{value !== null ? value.toFixed(1) : "—"}</span>
      )}
      <span className="text-[9px] text-slate-350 select-none">✏️</span>
    </div>
  );
}

/* ─── Premium Mark Sheet Tab Component ─── */
function MarkSheetTab({ specialities, candidates, scores, isCEC, toast, doctors }: {
  specialities: { id: number; name: string; code: string }[];
  candidates: any[];
  scores: any[];
  isCEC: boolean;
  toast: any;
  doctors: any[];
}) {
  const [selectedSpec, setSelectedSpec] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [vivaDialogOpen, setVivaDialogOpen] = useState<any | null>(null);
  const { user } = useAuth();
  const qc = useQueryClient();

  const canEdit = user?.role === "central_exam_coordinator" || user?.role === "super_admin" || user?.role === "program_admin";

  const updateScoreMutation = useMutation({
    mutationFn: ({ 
      candidateId, 
      mcqScore, 
      psychometricScore, 
      vivaScore,
      targetDoctorId
    }: { 
      candidateId: number; 
      mcqScore?: number | null; 
      psychometricScore?: number | null; 
      vivaScore?: number | null; 
      targetDoctorId?: number | null;
    }) => {
      const specId = selectedSpec !== "all" ? Number(selectedSpec) : null;
      return api.patch(`/candidates/${candidateId}/marks`, {
        mcqScore,
        psychometricScore,
        vivaScore,
        specialityId: specId,
        targetDoctorId
      });
    },
    onSuccess: () => {
      toast({ title: "Score updated successfully" });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["interview-scores"] });
    },
    onError: (e: any) => {
      let desc = e.message;
      if (e.response?.status === 403) {
        desc = "Doctor marks cannot be changed. Please do it with that doctor's login account only, or ask an administrator. Only administrators have that access.";
      } else if (e.response?.status === 401) {
        desc = "Your session has expired. Please log in again.";
      } else if (e.response?.data?.error) {
        desc = e.response.data.error;
      }
      toast({ 
        title: "Access Denied / Failed to Update", 
        description: desc, 
        variant: "destructive" 
      });
    }
  });

  const getSpecsArray = (c: any): string[] => {
    if (!c.specializations) return [];
    if (Array.isArray(c.specializations)) return c.specializations;
    if (typeof c.specializations === "string") {
      const s = c.specializations;
      if (s.startsWith("{") || s.startsWith("[")) {
        try {
          const parsed = JSON.parse(s.replace(/^{|}$/g, (m: string) => m === "{" ? "[" : "]"));
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {}
      }
      return s.split(",").map((x: string) => x.trim()).filter(Boolean);
    }
    return [];
  };

  const filteredCandidates = candidates.filter(c => {
    // 1. Search term match (Name or Code)
    const matchesSearch = 
      c.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.candidateCode.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;

    // 2. Specialization match
    if (selectedSpec === "all") return true;
    const hasApp = c.applications?.some((app: any) => String(app.specialityId) === selectedSpec);
    const specName = specialities.find(s => String(s.id) === selectedSpec)?.name;
    const hasPref = specName ? getSpecsArray(c).some((s: string) => s.toLowerCase() === specName.toLowerCase()) : false;
    return hasApp || hasPref;
  });

  const handleDownload = () => {
    let url = `/api/interviews/scores/export?token=${localStorage.getItem("fellowship_token")}`;
    if (selectedSpec !== "all") {
      url += `&specialityId=${selectedSpec}`;
    }
    window.open(url, "_blank");
  };

  // Helper stats
  const totalInView = filteredCandidates.length;
  const gradedCandidates = filteredCandidates.filter(c => {
    const candScores = scores.filter(s => s.candidateId === c.id);
    return candScores.length > 0;
  });
  const fullyGradedCount = gradedCandidates.length;

  return (
    <div className="space-y-6">
      {/* Marksheet Filter & Info Dashboard */}
      <Card className="border-slate-200/80 shadow-sm rounded-2xl bg-white overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-bold text-lg text-slate-800">Unified Mark Sheet</h3>
              <p className="text-xs text-muted-foreground">
                Consolidated entrance rankings combining written MCQ, clinical VIVA, and Mind Matter evaluations.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Speciality Selector */}
              <div className="w-[220px]">
                <Select value={selectedSpec} onValueChange={setSelectedSpec}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 focus:ring-orange-500 font-semibold text-slate-700">
                    <SelectValue placeholder="All Specialities" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="all" className="font-semibold text-slate-750">All Specialities</SelectItem>
                    {specialities.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)} className="text-xs font-semibold text-slate-750">
                        {s.name} ({s.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Download Master Spreadsheet Button */}
              <Button 
                onClick={handleDownload}
                className="gap-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-bold h-10 px-5 rounded-xl text-xs uppercase tracking-wider shadow-md transition-all active:scale-95 duration-150"
              >
                <FileText className="h-4 w-4 text-orange-200" />
                Export Excel Sheet
              </Button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-slate-100">
            <div className="bg-slate-50/50 rounded-xl p-3.5 border border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest leading-none mb-1">Active Group</p>
                <p className="text-lg font-black text-slate-800">{totalInView} Candidates</p>
              </div>
              <Users className="h-5 w-5 text-slate-400" />
            </div>

            <div className="bg-slate-50/50 rounded-xl p-3.5 border border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest leading-none mb-1">VIVA Evaluated</p>
                <p className="text-lg font-black text-emerald-600">{fullyGradedCount} Candidates</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>

            <div className="bg-slate-50/50 rounded-xl p-3.5 border border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest leading-none mb-1">Max Aggregate Ceiling</p>
                <p className="text-lg font-black text-indigo-600">110 Total Marks</p>
              </div>
              <Star className="h-5 w-5 text-indigo-500" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main List Table */}
      <Card className="border-slate-200/80 shadow-sm rounded-2xl bg-white overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100 px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <LayoutGrid className="h-4.5 w-4.5 text-orange-500" /> Candidate Evaluation Grid
          </CardTitle>
          <div className="w-full sm:w-[240px] shrink-0">
            <Input 
              placeholder="Filter by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8.5 text-xs rounded-lg border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-semibold"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredCandidates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground font-semibold">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              No candidates found matching the active selection.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/40 text-slate-450 text-[10px] font-black uppercase tracking-widest">
                    <th className="text-left px-6 py-3.5 font-black">Candidate</th>
                    <th className="text-center px-4 py-3.5 font-black w-24">Code</th>
                    <th className="text-right px-4 py-3.5 font-black w-28">MCQ (Max 50)</th>
                    <th className="text-right px-4 py-3.5 font-black w-28">VIVA (Max 50)</th>
                    <th className="text-right px-4 py-3.5 font-black w-28">Mind Matter (Max 10)</th>
                    <th className="text-right px-6 py-3.5 font-black w-32">Total (Max 110)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-semibold">
                  {filteredCandidates.map((c) => {
                    const candSpecs = getSpecsArray(c);
                    const targetAppSpecId = c.applications?.[0]?.specialityId;
                    const targetPrefSpec = specialities.find(s => candSpecs.some(cs => cs.toLowerCase() === s.name.toLowerCase()));
                    const currentSpecId = selectedSpec !== "all" ? Number(selectedSpec) : (targetAppSpecId ?? targetPrefSpec?.id);

                    const candScores = scores.filter(s => 
                      s.candidateId === c.id && 
                      (currentSpecId ? s.specialityId === currentSpecId : true)
                    );
                    const avgViva = candScores.length > 0
                      ? candScores.reduce((sum, s) => sum + s.score, 0) / candScores.length
                      : null;

                    const mcqScore = c.mcqScore !== null ? Number(c.mcqScore) : null;
                    const mindMatterScore = c.psychometricScore !== null ? Number(c.psychometricScore) : null;
                    
                    const totalScore = (mcqScore !== null || avgViva !== null || mindMatterScore !== null)
                      ? (mcqScore ?? 0) + (avgViva ?? 0) + (mindMatterScore ?? 0)
                      : null;

                    return (
                      <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-bold text-slate-800 text-sm leading-tight">{c.fullName}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {getSpecsArray(c).map((spec: string, index: number) => (
                                <Badge 
                                  key={index} 
                                  variant="outline" 
                                  className="text-[9px] font-black uppercase px-2 py-0.5 tracking-wider bg-slate-50 border-slate-200/80 text-slate-500 rounded-md"
                                >
                                  {spec}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="font-mono text-xs text-slate-500 uppercase font-black bg-slate-100 px-2 py-1 rounded-md border border-slate-200/30">
                            {c.candidateCode}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <EditableCell
                            value={mcqScore}
                            max={50}
                            canEdit={canEdit}
                            onSave={async (val) => {
                              await updateScoreMutation.mutateAsync({ candidateId: c.id, mcqScore: val });
                            }}
                          />
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex flex-col items-end">
                            <div 
                              onClick={() => setVivaDialogOpen(c)}
                              className="inline-flex items-center gap-1.5 cursor-pointer hover:bg-orange-50 border border-dashed border-slate-250 hover:border-orange-300 hover:text-orange-700 px-2 py-1 rounded-lg transition-all font-mono font-bold text-xs"
                              title="Click to view and edit doctor breakdown"
                            >
                              <span className="tabular-nums">{avgViva !== null ? avgViva.toFixed(1) : "—"}</span>
                              <span className="text-[10px] text-slate-400 select-none">✏️</span>
                            </div>
                            {candScores.length > 0 && (
                              <span className="text-[9px] text-slate-450 font-bold uppercase tracking-wider mt-0.5">
                                {candScores.length} {candScores.length === 1 ? "doc" : "docs"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <EditableCell
                            value={mindMatterScore}
                            max={10}
                            canEdit={canEdit}
                            onSave={async (val) => {
                              await updateScoreMutation.mutateAsync({ candidateId: c.id, psychometricScore: val });
                            }}
                          />
                        </td>
                        <td className="px-6 py-4 text-right">
                          {totalScore !== null ? (
                            <Badge className="bg-slate-900 text-white font-mono font-bold text-sm tracking-wide shadow-sm hover:bg-slate-950 px-3 py-1 rounded-lg">
                              {totalScore.toFixed(1)}
                            </Badge>
                          ) : (
                            <span className="text-slate-400 font-mono">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── VIVA Marks Breakdown & Auditor Modal ── */}
      {vivaDialogOpen && (
        <VivaScoresDialog
          candidate={vivaDialogOpen}
          open={!!vivaDialogOpen}
          onClose={() => setVivaDialogOpen(null)}
          scores={scores}
          doctors={doctors}
          selectedSpec={selectedSpec}
          specialities={specialities}
          updateScoreMutation={updateScoreMutation}
        />
      )}
    </div>
  );
}

/* ─── Premium VIVA Marks Breakdown & Auditor Dialog Component ─── */
function VivaScoresDialog({
  candidate,
  open,
  onClose,
  scores,
  doctors,
  selectedSpec,
  specialities,
  updateScoreMutation,
}: {
  candidate: any;
  open: boolean;
  onClose: () => void;
  scores: any[];
  doctors: any[];
  selectedSpec: string;
  specialities: any[];
  updateScoreMutation: any;
}) {
  const [newDoctorId, setNewDoctorId] = useState<string>("");
  const [newScore, setNewScore] = useState<string>("");
  const [tempScores, setTempScores] = useState<Record<number, string>>({});
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);
  const [savingDoctorId, setSavingDoctorId] = useState<number | null>(null);

  // Determine the target specialityId for the candidate
  const getSpecsArray = (c: any): string[] => {
    if (!c.specializations) return [];
    if (Array.isArray(c.specializations)) return c.specializations;
    if (typeof c.specializations === "string") {
      const s = c.specializations;
      if (s.startsWith("{") || s.startsWith("[")) {
        try {
          const parsed = JSON.parse(s.replace(/^{|}$/g, (m: string) => m === "{" ? "[" : "]"));
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {}
      }
      return s.split(",").map((x: string) => x.trim()).filter(Boolean);
    }
    return [];
  };

  const candSpecs = getSpecsArray(candidate);
  const targetAppSpecId = candidate.applications?.[0]?.specialityId;
  const targetPrefSpec = specialities.find((s: any) => candSpecs.some((cs: string) => cs.toLowerCase() === s.name.toLowerCase()));
  const specialityId = selectedSpec !== "all" ? Number(selectedSpec) : (targetAppSpecId ?? targetPrefSpec?.id);
  const specialityName = specialities.find((s: any) => s.id === specialityId)?.name ?? "Speciality Interview";

  // Filter existing scores for this candidate and speciality
  const candidateScores = scores.filter(
    (s) => s.candidateId === candidate.id && (specialityId ? s.specialityId === specialityId : true)
  );

  // Set up temporary scores state for editing inputs
  useEffect(() => {
    const initialTemp: Record<number, string> = {};
    candidateScores.forEach((s) => {
      initialTemp[s.doctorId] = String(s.score);
    });
    setTempScores(initialTemp);
  }, [scores, candidate.id, specialityId]);

  // Doctors who have already scored this candidate
  const alreadyScoredDoctorIds = candidateScores.map((s) => s.doctorId);
  // Remaining doctors who can be added
  const remainingDoctors = doctors.filter((d) => !alreadyScoredDoctorIds.includes(d.doctorId));

  const handleUpdateScore = async (doctorId: number) => {
    const valStr = tempScores[doctorId]?.trim();
    if (valStr === undefined || valStr === "") return;
    const val = parseFloat(valStr);
    if (isNaN(val) || val < 0 || val > 50) {
      // Reset to original score
      const original = candidateScores.find(s => s.doctorId === doctorId)?.score;
      setTempScores(prev => ({ ...prev, [doctorId]: original !== undefined ? String(original) : "" }));
      return;
    }

    // Skip update if value hasn't changed
    const originalScore = candidateScores.find(s => s.doctorId === doctorId)?.score;
    if (originalScore !== undefined && val === originalScore) {
      return;
    }

    setSavingDoctorId(doctorId);
    try {
      await updateScoreMutation.mutateAsync({
        candidateId: candidate.id,
        vivaScore: val,
        targetDoctorId: doctorId,
        specialityId,
      });
    } catch {}
    setSavingDoctorId(null);
  };

  const handleDeleteScore = async (doctorId: number, doctorName: string) => {
    if (!window.confirm(`Are you sure you want to remove the VIVA score given by ${doctorName}?`)) {
      return;
    }
    setSavingDoctorId(doctorId);
    try {
      await updateScoreMutation.mutateAsync({
        candidateId: candidate.id,
        vivaScore: null,
        targetDoctorId: doctorId,
        specialityId,
      });
    } catch {}
    setSavingDoctorId(null);
  };

  const handleAddNewScore = async () => {
    if (!newDoctorId || !newScore.trim()) return;
    const val = parseFloat(newScore);
    if (isNaN(val) || val < 0 || val > 50) return;

    setIsSubmittingNew(true);
    try {
      await updateScoreMutation.mutateAsync({
        candidateId: candidate.id,
        vivaScore: val,
        targetDoctorId: Number(newDoctorId),
        specialityId,
      });
      setNewDoctorId("");
      setNewScore("");
    } catch {}
    setIsSubmittingNew(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-xl rounded-2xl border-slate-100 shadow-xl bg-white p-6 gap-0">
        <DialogHeader className="pb-4 border-b border-slate-100">
          <DialogTitle className="text-slate-800 font-black text-lg flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-orange-500" />
            VIVA Score Breakdown
          </DialogTitle>
          <div className="mt-2.5 bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-xs">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Candidate</p>
              <p className="font-bold text-slate-800 text-sm">{candidate.fullName}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Specialization</p>
              <Badge className="bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold border-orange-200/50 rounded-md">
                {specialityName}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="py-5 space-y-6 max-h-[350px] overflow-y-auto pr-1">
          {/* List of existing doctor scores */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none mb-1">
              Panel Evaluations ({candidateScores.length})
            </h4>

            {candidateScores.length === 0 ? (
              <div className="text-center py-8 rounded-xl bg-slate-50/50 border border-dashed border-slate-200/60 text-muted-foreground text-xs font-semibold">
                No doctor marks submitted for this candidate yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {candidateScores.map((s) => {
                  const isSavingRow = savingDoctorId === s.doctorId;
                  const isModified = tempScores[s.doctorId] !== undefined && tempScores[s.doctorId] !== String(s.score);

                  return (
                    <div 
                      key={s.doctorId} 
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-white transition-all shadow-sm hover:shadow-md"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-sm leading-snug">{s.doctorName}</span>
                        <span className="text-[10px] font-medium text-slate-400">
                          Evaluated: {new Date(s.submittedAt).toLocaleDateString()} {new Date(s.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Score input field */}
                        <div className="relative flex items-center">
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            max="50"
                            className="w-20 h-9 font-mono font-bold text-right text-xs pr-7 border-slate-200 focus:ring-orange-500 rounded-lg"
                            value={tempScores[s.doctorId] !== undefined ? tempScores[s.doctorId] : ""}
                            onChange={(e) => setTempScores({ ...tempScores, [s.doctorId]: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleUpdateScore(s.doctorId);
                              if (e.key === "Escape") {
                                setTempScores({ ...tempScores, [s.doctorId]: String(s.score) });
                              }
                            }}
                            onBlur={() => handleUpdateScore(s.doctorId)}
                            disabled={isSavingRow}
                          />
                          <span className="absolute right-2 text-[9px] font-black text-slate-400">/50</span>
                        </div>

                        {/* Save Button (only visible if modified) */}
                        {isModified && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateScore(s.doctorId)}
                            className="h-9 px-2.5 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 rounded-lg font-bold"
                            disabled={isSavingRow}
                          >
                            Save
                          </Button>
                        )}

                        {/* Delete Score Button */}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteScore(s.doctorId, s.doctorName)}
                          className="h-9 w-9 text-slate-450 hover:text-red-650 hover:bg-red-50 rounded-lg transition-all shrink-0"
                          disabled={isSavingRow}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add a new doctor score directly */}
          {remainingDoctors.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none mb-1">
                Record Mark for another Doctor
              </h4>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {/* Doctor Selection */}
                <div className="flex-1 min-w-[180px]">
                  <Select value={newDoctorId} onValueChange={setNewDoctorId}>
                    <SelectTrigger className="h-9 rounded-lg bg-slate-50 border-slate-200 text-xs font-semibold text-slate-700">
                      <SelectValue placeholder="Choose doctor..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {remainingDoctors.map((d) => (
                        <SelectItem key={d.doctorId} value={String(d.doctorId)} className="text-xs font-semibold text-slate-755">
                          {d.doctorName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Score Input */}
                <div className="relative flex items-center w-full sm:w-28 shrink-0">
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    placeholder="Score"
                    className="h-9 font-mono font-bold text-right text-xs pr-7 border-slate-200 focus:ring-orange-500 rounded-lg w-full"
                    value={newScore}
                    onChange={(e) => setNewScore(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddNewScore();
                    }}
                    disabled={isSubmittingNew}
                  />
                  <span className="absolute right-2 text-[9px] font-black text-slate-400">/50</span>
                </div>

                {/* Add button */}
                <Button
                  onClick={handleAddNewScore}
                  className="h-9 px-4 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-lg uppercase tracking-wider shrink-0"
                  disabled={!newDoctorId || !newScore.trim() || isSubmittingNew}
                >
                  {isSubmittingNew ? "Adding..." : "Add"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 border-t border-slate-100 flex items-center justify-end">
          <Button 
            onClick={onClose}
            className="h-10 px-6 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs uppercase tracking-wider transition-all"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

