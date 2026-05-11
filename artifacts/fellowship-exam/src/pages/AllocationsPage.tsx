import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Loader2,
  Download,
  CheckCircle2,
  UserCheck,
  Trophy,
  Search,
  Mail,
  FileText,
  Building2,
  BarChart3,
  Filter,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import { useToast } from "../hooks/use-toast";
import * as XLSX from 'xlsx';

export default function AllocationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [specFilter, setSpecFilter] = useState("all");
  const [previewCandidate, setPreviewCandidate] = useState<any | null>(null);

  const { data: candidates = [], isLoading: isLoadingCandidates } = useQuery({
    queryKey: ["candidates"],
    queryFn: () => api.get<any[]>("/candidates"),
  });

  const { data: matrixData, isLoading: isLoadingMatrix } = useQuery({
    queryKey: ["seat-matrix"],
    queryFn: () => api.get<any>("/seat-matrix"),
  });

  const isLoading = isLoadingCandidates || isLoadingMatrix;

  const SEAT_MATRIX: Record<string, number> = {};
  matrixData?.rows?.forEach((r: any) => {
    SEAT_MATRIX[r.speciality] = r.total;
  });

  const SPECIALIZATIONS = matrixData?.rows?.map((r: any) => r.speciality) || [];

  // Calculate scores and sort
  const scoredCandidates = candidates
    .map((c: any) => {
      const interviewAvg = c.interviewScore || 0;
      return {
        ...c,
        totalScore: (c.mcqScore || 0) + (c.psychometricScore || 0) + interviewAvg,
        interviewAvg,
        preferences: c.specializations || [],
        parsedCenterPreference: (() => {
          try {
            return typeof c.centerPreference === 'string' ? JSON.parse(c.centerPreference) : c.centerPreference || {};
          } catch(e) { return {}; }
        })()
      };
    })
    .sort((a: any, b: any) => (b.totalScore || 0) - (a.totalScore || 0));

  const filtered = scoredCandidates.filter(c => {
    const matchSearch = c.fullName.toLowerCase().includes(search.toLowerCase()) || 
                       c.candidateCode.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    const isAllocated = c.status === 'allocated';
    const allocatedSpec = isAllocated ? c.reviewNotes?.replace('Allocated to ', '').split(' [')[0] : null;
    const matchSpec = specFilter === "all" || (isAllocated && allocatedSpec === specFilter);
    
    return matchSearch && matchStatus && matchSpec;
  });

  const allocationMutation = useMutation({
    mutationFn: ({ id, specialization }: { id: number, specialization: string }) => 
      api.patch(`/candidates/${id}`, { status: 'allocated', reviewNotes: `Allocated to ${specialization}` }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["seat-matrix"] });
      toast({ title: "Allocation Successful", description: "Candidate has been assigned to the specialization." });
    }
  });

  const sendOfferMutation = useMutation({
    mutationFn: (id: number) => api.post(`/candidates/${id}/send-offer`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      toast({ title: "Offer Letter Sent", description: "The professional offer letter has been emailed to the candidate." });
      setPreviewCandidate(null);
    },
    onError: (e: any) => {
      toast({ title: "Failed to send email", description: e.message, variant: "destructive" });
    }
  });

  const autoAllocateMutation = useMutation({
    mutationFn: async (plan: { id: number, specialization: string }[]) => {
      for (const item of plan) {
        await api.patch(`/candidates/${item.id}`, { status: 'allocated', reviewNotes: `Allocated to ${item.specialization}` });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["seat-matrix"] });
      toast({ title: "Auto-Allocation Complete", description: "Candidates have been assigned based on merit and preferences." });
    }
  });

  const handleAutoAllocate = () => {
    const plan: { id: number, specialization: string }[] = [];
    const tempOccupancy = { ...occupancy };
    
    scoredCandidates.forEach((c: any) => {
      if (c.status === 'allocated') return;
      
      for (const pref of c.preferences) {
        if ((tempOccupancy[pref] || 0) < (SEAT_MATRIX[pref] || 0)) {
          plan.push({ id: c.id, specialization: pref });
          tempOccupancy[pref] = (tempOccupancy[pref] || 0) + 1;
          break;
        }
      }
    });

    if (plan.length === 0) {
      toast({ title: "Nothing to allocate", description: "All candidates are either allocated or no seats match their preferences." });
      return;
    }

    if (confirm(`This will automatically allocate ${plan.length} candidates based on merit. Proceed?`)) {
      autoAllocateMutation.mutate(plan);
    }
  };

  const exportToExcel = () => {
    const data = filtered.map((c: any, index: number) => ({
      Rank: index + 1,
      "Candidate Code": c.candidateCode,
      Name: c.fullName,
      "MCQ Score": c.mcqScore || 0,
      "Psych Score": c.psychometricScore || 0,
      "Interview Score": c.interviewAvg.toFixed(2),
      "Total Score": c.totalScore.toFixed(2),
      "Allocated Specialization": c.status === 'allocated' ? c.reviewNotes?.replace('Allocated to ', '').split(' [')[0] : 'Pending',
      "Offer Status": c.reviewNotes?.includes('[OFFER SENT]') ? 'Sent' : 'Not Sent'
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Allocations");
    XLSX.writeFile(workbook, `Fellowship_Allocations_JUL_2026.xlsx`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const occupancy: Record<string, number> = {};
  matrixData?.rows?.forEach((r: any) => {
    occupancy[r.speciality] = r.totalAllocated || 0;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merit-Based Allocation</h1>
          <p className="text-muted-foreground">JULY 2026 Batch — Final Seat Assignment & Offer Letters</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleAutoAllocate} variant="default" className="gap-2 bg-primary hover:bg-primary/90" disabled={autoAllocateMutation.isPending}>
            {autoAllocateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
            Smart Auto-Allocate
          </Button>
          <Button onClick={exportToExcel} variant="outline" className="gap-2 border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap bg-white p-4 rounded-xl border shadow-sm">
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search candidate name or code..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="pl-9 h-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 h-10">
            <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="interview_completed">Interview Done</SelectItem>
            <SelectItem value="allocated">Allocated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={specFilter} onValueChange={setSpecFilter}>
          <SelectTrigger className="w-56 h-10">
            <Building2 className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Allocation Spec" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Specializations</SelectItem>
            {SPECIALIZATIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Seat Matrix Sidebar */}
        <Card className="xl:col-span-1 shadow-md border-slate-200 h-fit">
          <CardHeader className="bg-slate-50/80 border-b p-4">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> SEAT OCCUPANCY
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {SPECIALIZATIONS.map(spec => {
              const total = SEAT_MATRIX[spec] || 0;
              const filled = occupancy[spec] || 0;
              const percent = (filled / total) * 100;
              
              return (
                <div key={spec} className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-tight text-slate-600">
                    <span className="truncate max-w-[160px]">{spec}</span>
                    <span className={filled >= total ? "text-rose-600" : "text-emerald-600"}>{filled} / {total}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <div 
                      className={`h-full transition-all duration-500 ${percent >= 100 ? 'bg-rose-500' : percent > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t mt-4 flex justify-between items-center text-xs font-black text-slate-800 uppercase tracking-widest">
              <span>TOTAL CAPACITY</span>
              <Badge variant="secondary" className="bg-slate-900 text-white border-none">
                {Object.values(occupancy).reduce((a,b)=>a+b, 0)} / {Object.values(SEAT_MATRIX).reduce((a,b)=>a+b, 0)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Merit List */}
        <Card className="xl:col-span-3 shadow-md border-slate-200 overflow-hidden">
          <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Trophy className="h-5 w-5 text-amber-400" />
              <h2 className="font-black uppercase tracking-widest text-sm">Merit Ranking & Allocation</h2>
            </div>
            <Badge className="bg-primary text-white border-none text-[10px] uppercase font-black">Merit Mode Active</Badge>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16 text-center font-bold text-slate-800">RANK</TableHead>
                    <TableHead className="font-bold text-slate-800">CANDIDATE</TableHead>
                    <TableHead className="font-bold text-slate-800">SCORES</TableHead>
                    <TableHead className="font-bold text-slate-800">TOTAL</TableHead>
                    <TableHead className="font-bold text-slate-800">PREFERENCES & ALLOCATION</TableHead>
                    <TableHead className="text-right font-bold text-slate-800">ACTION</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c: any, index: number) => {
                    const isAllocated = c.status === 'allocated' && c.reviewNotes?.startsWith('Allocated to ');
                    const allocatedSpec = isAllocated ? c.reviewNotes.replace('Allocated to ', '').split(' [')[0] : null;
                    const isMailSent = c.reviewNotes?.includes('[OFFER SENT]');
                    
                    return (
                      <TableRow key={c.id} className={`${isAllocated ? "bg-emerald-50/40 hover:bg-emerald-50/60" : "hover:bg-slate-50/50"} transition-colors border-slate-100`}>
                        <TableCell className="text-center">
                          <div className={`mx-auto h-8 w-8 rounded-full flex items-center justify-center font-black text-sm ${index < 3 ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-500'}`}>
                            {index + 1}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-black text-slate-800 uppercase tracking-tight">{c.fullName}</div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">{c.candidateCode}</div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-black text-slate-400 uppercase">Exam:</span>
                              <span className="text-[11px] font-bold text-slate-700">{(c.mcqScore || 0) + (c.psychometricScore || 0)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-black text-slate-400 uppercase">Intv:</span>
                              <span className="text-[11px] font-bold text-slate-700">{c.interviewAvg.toFixed(1)}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-lg font-black text-primary tracking-tighter tabular-nums">{c.totalScore.toFixed(2)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2 py-2">
                            {c.preferences.slice(0, 3).map((p: string, i: number) => {
                              const preferredUnits = c.parsedCenterPreference[p];
                              const isThisAllocated = p === allocatedSpec;
                              const isFull = (occupancy[p] || 0) >= (SEAT_MATRIX[p] || 0);
                              
                              return (
                              <div key={i} className="flex flex-col gap-1 group">
                                <div className="flex items-center gap-2">
                                  <Badge variant={isThisAllocated ? "default" : "outline"} className={`text-[10px] h-5 px-2 font-black ${isThisAllocated ? "bg-emerald-600" : "text-slate-400 border-slate-200"}`}>
                                    {i + 1}
                                  </Badge>
                                  <span className={`text-xs uppercase tracking-wide ${isThisAllocated ? "font-black text-emerald-700" : "font-bold text-slate-500"}`}>
                                    {p}
                                  </span>
                                  {!isAllocated && !isFull && (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      onClick={() => allocationMutation.mutate({ id: c.id, specialization: p })}
                                      className="h-6 px-2 text-[10px] font-black text-emerald-600 hover:bg-emerald-50 opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-widest"
                                    >
                                      <CheckCircle2 className="h-3 w-3 mr-1" /> Allocate
                                    </Button>
                                  )}
                                  {isFull && !isThisAllocated && (
                                    <span className="text-[9px] font-black text-rose-400 uppercase italic">Full</span>
                                  )}
                                </div>
                                {Array.isArray(preferredUnits) && preferredUnits.length > 0 && (
                                  <div className="text-[10px] font-bold text-slate-400 ml-9 flex items-center gap-1">
                                    <Building2 className="h-3 w-3" /> {preferredUnits.join(", ")}
                                  </div>
                                )}
                              </div>
                            )})}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {isAllocated ? (
                            <div className="flex flex-col items-end gap-2">
                              <Badge className="bg-emerald-600 text-white border-none font-black text-[10px] tracking-widest px-3 py-1">
                                <UserCheck className="h-3 w-3 mr-1.5" /> ALLOCATED
                              </Badge>
                              <div className="flex gap-1">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-8 gap-1.5 text-[10px] font-black border-slate-200 text-slate-600 hover:bg-slate-50 uppercase tracking-widest"
                                  onClick={() => setPreviewCandidate({ ...c, allocatedSpec })}
                                >
                                  <FileText className="h-3.5 w-3.5" /> Preview
                                </Button>
                                <Button 
                                  variant={isMailSent ? "secondary" : "default"}
                                  size="sm" 
                                  className={`h-8 gap-1.5 text-[10px] font-black uppercase tracking-widest ${isMailSent ? 'bg-slate-100 text-slate-400' : 'bg-primary'}`}
                                  disabled={sendOfferMutation.isPending}
                                  onClick={() => {
                                    if (confirm(`Send formal offer letter to ${c.fullName}?`)) {
                                      sendOfferMutation.mutate(c.id);
                                    }
                                  }}
                                >
                                  {sendOfferMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                                  {isMailSent ? "SENT" : "SEND MAIL"}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-slate-300 border-slate-200 text-[10px] font-bold tracking-widest px-3">PENDING</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Offer Letter Preview Dialog */}
      <Dialog open={!!previewCandidate} onOpenChange={() => setPreviewCandidate(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 border-none shadow-2xl">
          <div className="bg-slate-900 p-4 text-white flex justify-between items-center sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="font-black uppercase tracking-widest text-sm">Professional Offer Letter Preview</h2>
            </div>
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={() => setPreviewCandidate(null)}>Close</Button>
          </div>
          
          <div className="p-8 bg-white text-slate-900 font-serif shadow-inner">
            <div className="border-2 border-slate-100 p-12 rounded shadow-sm relative min-h-[800px]">
              {/* Fake Letterhead */}
              <div className="flex justify-between items-center border-b-2 border-primary pb-6 mb-8">
                <div className="h-16 w-32 bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400 rounded uppercase tracking-tighter italic">Hospital Logo</div>
                <div className="h-16 w-32 bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400 rounded uppercase tracking-tighter italic">Academy Logo</div>
              </div>

              <div className="text-right text-sm font-bold text-slate-600 mb-8">
                DATE: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}
              </div>

              <div className="mb-10 text-base leading-relaxed">
                <p className="font-bold uppercase tracking-tight">TO,</p>
                <p className="font-black text-lg text-primary">{previewCandidate?.fullName?.toUpperCase()}</p>
                <p className="font-mono text-xs text-slate-400">CANDIDATE CODE: {previewCandidate?.candidateCode}</p>
              </div>

              <h1 className="text-center text-2xl font-black underline text-slate-900 mb-10 tracking-tight">OFFER OF FELLOWSHIP ADMISSION</h1>

              <div className="space-y-6 text-base leading-relaxed text-slate-800">
                <p>Dear Dr. {previewCandidate?.fullName},</p>

                <p>Based on your performance in the entrance examination and subsequent interview conducted for the <strong>JULY 2026</strong> intake, we are pleased to offer you admission to the Fellowship program at <strong>Sankara Academy of Vision</strong>.</p>

                <p>You have been selected for the following specialization:</p>
                
                <div className="bg-slate-50 p-6 border-2 border-slate-200 my-8 text-center rounded-xl">
                  <h3 className="m-0 text-2xl font-black text-slate-900 uppercase tracking-tight">{previewCandidate?.allocatedSpec}</h3>
                </div>

                <p>Your fellowship will be based at our <strong>{previewCandidate?.unitName || "Assigned Center"}</strong> unit. The duration of the fellowship is as per the standard norms of the academy.</p>

                <p>Please note that this offer is subject to the verification of your original documents and medical fitness. You are required to confirm your acceptance by replying to this email within 3 working days.</p>

                <p>Detailed joining instructions and the list of documents required at the time of reporting will be sent to you shortly.</p>

                <p>We look forward to welcoming you to the Sankara family.</p>
              </div>

              <div className="mt-20">
                <p className="font-bold">Yours Sincerely,</p>
                <div className="h-16"></div>
                <p className="font-black uppercase tracking-tight text-slate-900">Director,</p>
                <p className="text-slate-500 font-bold text-sm">Sankara Academy of Vision</p>
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 bg-slate-50 border-t flex items-center justify-between">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Professional PDF-style email will be sent</div>
            <Button 
              className="gap-2 font-black uppercase tracking-widest text-[10px]"
              disabled={sendOfferMutation.isPending}
              onClick={() => sendOfferMutation.mutate(previewCandidate.id)}
            >
              {sendOfferMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Confirm and Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
