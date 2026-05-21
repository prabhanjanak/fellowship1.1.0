import { useState, useEffect, useCallback } from "react";
import { loadDraft, saveDraft, clearDraft } from "../lib/draftStore";
import logoUrl from "../assets/seh_sav_logo_1777703794142.jpg";
import { Loader2, AlertCircle, CheckCircle2, ChevronRight, ChevronLeft, ChevronDown, CreditCard } from "lucide-react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { motion, AnimatePresence } from "framer-motion";

// Ensure Razorpay type exists
declare global {
  interface Window {
    Razorpay: new (opts: Record<string, unknown>) => { open(): void };
  }
}

const API = "/api";

const INITIAL_FORM = {
  fullName: "", email: "", phone: "", dateOfBirth: "", maritalStatus: "", spouseDetails: "",
  specialization: [] as string[],
  centerPreference: "",
  referralSource: "", referredByName: "", mediaSource: "",
  permanentAddress: "", mailingAddress: "",
  medicalConditions: [] as string[],
  previousApplicationMonthYear: "", appearedEarlier: "No",
  degree: "", medicalCollege: "", university: "", pgQualifications: "",
  qualificationMatrix: {} as Record<string, string>,
  doDetails: "", msMdDetails: "", dnbDetails: "",
  medicalCouncilNumber: "", otherCertifications: "",
  diagnosticSkills: {} as Record<string, string>,
  surgicalExperience: {} as Record<string, string>,
  publications: "", presentations: "",
  lor1RefName: "", lor1RefContact: "", lor1RefEmail: "",
  lor2RefName: "", lor2RefContact: "", lor2RefEmail: "",
  additionalInfo: "", declarationAccepted: false,
};

// ── Particle Canvas Component ─────────────────────────────────────────────
function ParticleCanvas({ className }: { className?: string }) {
  const mountRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const COUNT = 80;
    const particles = Array.from({ length: COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 2.5 + 1,
      color: [`rgba(16,185,129,`, `rgba(5,150,105,`, `rgba(52,211,153,`, `rgba(110,231,183,`][Math.floor(Math.random() * 4)],
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw connection lines
      for (let i = 0; i < COUNT; i++) {
        for (let j = i + 1; j < COUNT; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(16,185,129,${0.12 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      // Draw dots
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + "0.6)";
        ctx.fill();
      });
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <canvas
      ref={mountRef}
      className={`fixed inset-0 pointer-events-none ${className || ""}`}
      style={{ zIndex: 0 }}
    />
  );
}

export default function ApplyPage({ token, isManualEntry }: { token: string; isManualEntry?: boolean }) {
  const [formInfo, setFormInfo] = useState<any>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<string, any>>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const [files, setFiles] = useState<Record<string, File>>({});
  
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Post-payment confirmation state
  const [paymentVerified, setPaymentVerified] = useState<{paymentId: string; finalForm: Record<string,any>; verifyResponse: any} | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<{ amount: number; currency: string; description: string; mock: boolean } | null>(null);

  // Load Razorpay Script
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  useEffect(() => {
    let active = true;
    
    async function loadFormAndDraft() {
      try {
        const r = await fetch(`${API}/apply/${token}?t=${Date.now()}`, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.error ?? "Form not found");
        }
        const data = await r.json();
        if (!active) return;
        
        setFormInfo(data);
        if (data.sectionsConfig && data.sectionsConfig.length > 0) {
           // Check for draft in IndexedDB
           const savedDraft = await loadDraft(token);
           if (active && savedDraft) {
             console.log(`[AutoSave] Found IndexedDB draft for ${token}, restoring step ${savedDraft.step}`);
             setForm(savedDraft.form);
             setStep(savedDraft.step);
             if (savedDraft.files) {
               setFiles(savedDraft.files);
             }
             return;
           }

           const initial: Record<string, any> = { ...INITIAL_FORM };
           data.sectionsConfig.forEach((sec: any) => {
             sec.fields.forEach((f: any) => {
               if (f.defaultValue !== undefined) initial[f.id] = f.defaultValue;
             });
           });
           if (active) setForm(initial);
        }
      } catch (e: any) {
        if (active) setFormError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadFormAndDraft();

    return () => {
      active = false;
    };
  }, [token]);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  
  // Effect to save draft whenever form, step, or files change
  useEffect(() => {
    if (formInfo && !submitted) {
      console.log(`[AutoSave] Saving draft to IndexedDB for token: ${token}`);
      setIsSaving(true);
      
      saveDraft(token, { form, step, files }).then(() => {
        setIsSaving(false);
        setLastSaved(new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' }));
        console.log(`[AutoSave] Draft + files successfully saved to IndexedDB`);
      });
    }
  }, [form, step, files, token, formInfo, submitted]);

  useEffect(() => {
    // Load payment config
    fetch(`${API}/apply/${token}/payment-config`)
      .then(r => r.json())
      .then(data => setPaymentConfig(data))
      .catch(e => console.error("Failed to load payment config", e));
  }, [token]);

  const set = (field: string, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const onFileChange = (field: string, file: File | null) => {
    if (file) {
      const lowerField = field.toLowerCase();
      const lowerName = file.name.toLowerCase();
      
      if (lowerField.includes("lor")) {
        // LOR must be PDF only, <= 5MB
        const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
        if (!isPdf) {
          setErrors(prev => ({ ...prev, [field]: "LOR file must be in PDF format only" }));
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          setErrors(prev => ({ ...prev, [field]: "LOR file size exceeds 5MB limit" }));
          return;
        }
      } else if (lowerField.includes("photo")) {
        // Passport size photo must be JPG/JPEG only, <= 2MB
        const isJpg = file.type === "image/jpeg" || file.type === "image/jpg" || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg");
        if (!isJpg) {
          setErrors(prev => ({ ...prev, [field]: "Passport photo must be in JPG/JPEG format only" }));
          return;
        }
        if (file.size > 2 * 1024 * 1024) {
          setErrors(prev => ({ ...prev, [field]: "Passport photo size exceeds 2MB limit" }));
          return;
        }
      } else {
        // General files, <= 10MB
        if (file.size > 10 * 1024 * 1024) {
          setErrors(prev => ({ ...prev, [field]: "File size exceeds 10MB limit" }));
          return;
        }
      }

      setFiles(prev => ({ ...prev, [field]: file }));
      setErrors(prev => {
         const next = { ...prev };
         delete next[field];
         return next;
      });
    }
  };

  const validateStep = (currentStep: number) => {
    const sections = formInfo?.sectionsConfig ? [...formInfo.sectionsConfig] : [];
    if (isManualEntry && sections.length > 0 && sections[sections.length - 1].id !== 'manual_payment') {
      sections.push({
        id: 'manual_payment',
        title: "Administrative Manual Payment",
        description: "Enter offline payment details for this candidate.",
        fields: [
          { id: "paymentUTR", type: "text", label: "Payment Reference / UTR Number", required: true },
          { id: "paymentUrl", type: "file", label: "Payment Screenshot", required: true }
        ]
      });
    }
    const section = sections[currentStep];
    if (!section) return true;
    const newErrors: Record<string, string> = {};
    let hasError = false;

    section.fields.forEach((f: any) => {
      // Check visibility logic first
      let isVisible = true;
      if (f.visibleIf) {
         const targetValue = form[f.visibleIf.field];
         const conditionValue = f.visibleIf.contains || f.visibleIf.equals;
         if (f.visibleIf.key) {
            const nestedVal = targetValue?.[f.visibleIf.key];
            if (nestedVal !== conditionValue) isVisible = false;
         } else if (f.visibleIf.contains) {
            if (!targetValue || !targetValue.includes(conditionValue)) isVisible = false;
         } else if (f.visibleIf.equals) {
            if (targetValue !== conditionValue) isVisible = false;
         }
      }

      const isNonInput = f.type === 'info' || f.type === 'heading' || f.type === 'static_text';

      if (isVisible && !isNonInput) {
        if (f.type === 'file') {
          if (!files[f.id]) {
            newErrors[f.id] = `${f.label} is required`;
            hasError = true;
          }
        } else {
          const val = form[f.id];
          if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
            newErrors[f.id] = `${f.label} is required`;
            hasError = true;
          } else if (f.type === 'phone' || f.id === 'phone' || f.id === 'mobile') {
            const stripped = String(val).replace(/\D/g, '');
            if (stripped.length !== 10) {
              newErrors[f.id] = `${f.label} must be exactly 10 digits`;
              hasError = true;
            }
          }
        }
      }
    });

    setErrors(newErrors);
    return !hasError;
  };

  const handlePaymentAndSubmit = async () => {
    if (!validateStep(step)) return;
    
    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Upload files via correct two-step local upload route
      const uploadedUrls: Record<string, string> = {};
      for (const [field, file] of Object.entries(files)) {
        const urlRes = await fetch(`${API}/apply/${token}/request-upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            contentType: file.type,
            size: file.size,
            candidateName: form.fullName || "candidate",
            fieldName: field,
          }),
        });
        if (!urlRes.ok) {
          const err = await urlRes.json().catch(() => ({}));
          throw new Error(err.error || `Failed to get upload URL for ${field}`);
        }
        const { uploadURL, objectPath } = await urlRes.json();

        // Step 1b: PUT the file directly to the returned URL
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Failed to upload ${field}`);

        uploadedUrls[field] = objectPath;
        uploadedUrls[field] = objectPath;
      }
      const finalForm = { ...form, ...uploadedUrls };

      if (isManualEntry) {
         const specCount = Array.isArray(finalForm.specialization) ? finalForm.specialization.length : 1;
         const calculatedAmount = 2750 * specCount;
         setPaymentVerified({
           paymentId: finalForm.paymentUTR || ("MANUAL_ENTRY_" + Date.now()),
           finalForm: { ...finalForm, paymentMode: "Manual Offline", paidAmount: calculatedAmount },
           verifyResponse: { success: true }
         });
         window.scrollTo(0, 0);
         setSubmitting(false);
         return;
      }

      // 2. Create Order
      const specCount = Array.isArray(form.specialization) ? form.specialization.length : 1;
      const orderRes = await fetch(`${API}/payment/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, specializationCount: specCount }),
      });
      
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error || "Failed to initiate payment");

      const options = {
        key: orderData.key,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: "Sankara Academy of Vision",
        description: orderData.description || "Fellowship Application Fee",
        order_id: orderData.order.id,
        handler: async (response: any) => {
          try {
            // 3. Verify Payment signature
            const verifyRes = await fetch(`${API}/payment/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, token }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData.error || "Payment verification failed");

            // 4. Show payment confirmation screen (user sees Payment ID, then confirms)
            setPaymentVerified({
              paymentId: response.razorpay_payment_id,
              finalForm,
              verifyResponse: verifyData,
            });
            window.scrollTo(0, 0);
          } catch (e: any) {
            setSubmitError(e.message);
          } finally {
            setSubmitting(false);
          }
        },
        prefill: {
          name: finalForm.fullName || "",
          email: finalForm.email || "",
          contact: finalForm.phone || "",
        },
        theme: { color: "#ea580c" },
        modal: { ondismiss: () => setSubmitting(false) }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (e: any) {
      setSubmitError(e.message);
      setSubmitting(false);
    }
  };

  const next = async () => {
    const sections = formInfo?.sectionsConfig ? [...formInfo.sectionsConfig] : [];
    if (isManualEntry && sections.length > 0 && sections[sections.length - 1].id !== 'manual_payment') {
      sections.push({
        id: 'manual_payment',
        title: "Administrative Manual Payment",
        description: "Enter offline payment details for this candidate.",
        fields: [
          { id: "paymentUTR", type: "text", label: "Payment Reference / UTR Number", required: true },
          { id: "paymentUrl", type: "file", label: "Payment Screenshot", required: true }
        ]
      });
    }
    if (!validateStep(step)) return;
    if (step === sections.length - 1) {
      await handlePaymentAndSubmit();
      return;
    }
    setStep(s => s + 1);
    window.scrollTo(0, 0);
  };

  const prev = () => {
    setStep(s => Math.max(0, s - 1));
    window.scrollTo(0, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <Loader2 className="w-8 h-8 animate-spin text-[#000080]" />
      </div>
    );
  }

  if (formError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] p-4">
        <Card className="max-w-md w-full text-center p-8 border-slate-200 shadow-md">
          <AlertCircle className="w-16 h-16 text-[#000080] mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Application Unavailable</h2>
          <p className="text-slate-600 mb-6">{formError}</p>
          <Button onClick={() => window.location.reload()} className="bg-[#000080] hover:bg-blue-900">
            Try Again
          </Button>
        </Card>
      </div>
    );
  }

  // ── Payment Verified Confirmation Screen ────────────────────────────────
  if (paymentVerified && !submitted) {
    const { paymentId, finalForm } = paymentVerified;

    const handleFinalSubmit = async () => {
      setConfirming(true);
      setConfirmError(null);
      try {
        const submitRes = await fetch(`${API}/apply/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...finalForm, payment_id: paymentId }),
        });
        if (!submitRes.ok) {
          const errData = await submitRes.json();
          throw new Error(errData.error || "Submission failed. Please contact support with Payment ID: " + paymentId);
        }
        const resData = await submitRes.json();
        setSubmissionId(resData.submissionId ? String(resData.submissionId) : null);
        setSubmitted(true);
        // Clear draft on success
        localStorage.removeItem(`fellowship_draft_${token}`);
        await clearDraft(token);
        window.scrollTo(0, 0);
      } catch (e: any) {
        setConfirmError(e.message);
      } finally {
        setConfirming(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="max-w-lg w-full space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center shadow-lg shadow-green-100">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-9 h-9 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-green-800 mb-1">{isManualEntry ? "Offline Registration Recorded!" : "Payment Successful!"}</h2>
            <p className="text-sm text-green-700">
              Your payment of <strong>{isManualEntry ? `Rs. ${(2750 * (Array.isArray(finalForm.specialization) ? finalForm.specialization.length : 1)).toLocaleString("en-IN")} (Manual Offline)` : (paymentConfig ? `${paymentConfig.currency} ${((paymentConfig.amount * (Array.isArray(finalForm.specialization) ? finalForm.specialization.length : 1)) / 100).toLocaleString("en-IN")}` : `Rs. ${(2750 * (Array.isArray(finalForm.specialization) ? finalForm.specialization.length : 1)).toLocaleString("en-IN")}`)}</strong> {isManualEntry ? "has been registered offline." : "has been verified by Razorpay."}
              {Array.isArray(finalForm.specialization) && finalForm.specialization.length > 1 && ` (Rs. 2,750 x ${finalForm.specialization.length} specializations)`}
            </p>
          </div>

          <div className="bg-white border-2 border-orange-200 rounded-2xl p-6 shadow-md">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard className="w-5 h-5 text-[#000080]" />
              <span className="text-sm font-bold text-blue-900 uppercase tracking-wider">{isManualEntry ? "Offline Reference / UTR Number" : "Your Razorpay Payment ID"}</span>
            </div>
            <div className="bg-orange-50 border border-orange-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3 mb-4">
              <code className="text-lg font-mono font-bold text-orange-700 tracking-wider select-all">{paymentId}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(paymentId); }}
                className="text-xs bg-[#000080] hover:bg-blue-900 text-white px-3 py-1.5 rounded-lg font-semibold transition-all"
              >Copy</button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              ⚠️ <strong>Save this Reference</strong> — you will need it for any future correspondence or verification. {isManualEntry ? "This is the manual offline UTR number entered." : "It was also shown inside the Razorpay popup."}
            </p>
          </div>

          {confirmError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              <strong>Error:</strong> {confirmError}
            </div>
          )}

          <button
            onClick={handleFinalSubmit}
            disabled={confirming}
            className="w-full py-4 rounded-2xl font-bold text-lg text-white transition-all duration-300 shadow-lg flex items-center justify-center gap-3"
            style={{ background: confirming ? '#16a34a99' : 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', boxShadow: '0 8px 24px rgba(22,163,74,0.35)' }}
          >
            {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {confirming ? 'Processing Submission...' : 'Confirm & Final Submit'}
          </button>
        </div>
      </div>
    );
  }

  // ── Final Success / Printable Application Document ─────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-2xl w-full"
          >
            <Card className="border-none shadow-xl overflow-hidden ">
              <div className="bg-[#000080] p-10 text-white text-center relative">
                <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                   <div className="absolute -top-24 -left-24 w-64 h-64 bg-white rounded-full blur-3xl"></div>
                   <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-emerald-400 rounded-full blur-3xl"></div>
                </div>
                <div className="relative z-10">
                  <div className="w-24 h-24 bg-white/20 backdrop-blur-xl rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl border border-white/30">
                    <CheckCircle2 className="w-12 h-12 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold mb-3 text-slate-800">Application Submitted!</h2>
                  <p className="text-emerald-50/80 font-medium max-w-md mx-auto">Your application for the {formInfo.programName} has been received successfully.</p>
                </div>
              </div>
              <CardContent className="p-10 space-y-8 bg-white">
                <div className="grid grid-cols-2 gap-6">
                   <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Application Reference</p>
                      <p className="text-lg font-mono font-bold text-slate-800">#{submissionId}</p>
                   </div>
                   <div className="space-y-1 text-right">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Submitted On</p>
                      <p className="text-lg font-bold text-slate-800">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                   </div>
                </div>
                
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 space-y-4">
                   <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Next Steps</h3>
                   <div className="space-y-3">
                      {[
                        "Receive confirmation email shortly.",
                        "Our team will review your credentials.",
                        "Shortlisted candidates will be notified for interviews."
                      ].map((step, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                           <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">{idx + 1}</div>
                           <p className="text-sm text-slate-600 font-medium">{step}</p>
                        </div>
                      ))}
                   </div>
                </div>

                <Button 
                  className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-lg shadow-xl hover:shadow-2xl transition-all hover:-translate-y-0.5"
                  onClick={() => window.location.href = "/"}
                >
                  Return to Dashboard
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      );
   }

    const sections = formInfo.sectionsConfig ? [...formInfo.sectionsConfig] : [];
  if (isManualEntry && sections.length > 0 && sections[sections.length - 1].id !== 'manual_payment') {
      sections.push({
          id: 'manual_payment',
          title: "Administrative Manual Payment",
          description: "Enter offline payment details for this candidate.",
          fields: [
              { id: "paymentUTR", type: "text", label: "Payment Reference / UTR Number", required: true },
              { id: "paymentUrl", type: "file", label: "Payment Screenshot", required: true }
          ]
      });
  }
  const currentSection = sections[step];
  if (!currentSection) {
     return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] p-4">
          <Card className="max-w-md w-full text-center p-8 border-orange-100 shadow-xl">
            <AlertCircle className="w-16 h-16 text-[#000080] mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Form Configuration Missing</h2>
            <p className="text-slate-600 mb-6">This application form has no sections configured yet. Please contact the administrator.</p>
            <Button onClick={() => window.location.href = "/"} className="bg-[#000080] hover:bg-blue-900">
              Go to Homepage
            </Button>
          </Card>
        </div>
     );
  }
  const progress = ((step + 1) / sections.length) * 100;

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans">
      
      
      <div className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#000080] flex items-center justify-center text-white rounded-lg">
                 <img src={logoUrl} alt="Logo" className="h-8 w-8 object-contain invert" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 leading-tight font-outfit">{formInfo.title}</h1>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1 font-outfit">Sankara Fellowship Intake</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
               <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Progress</p>
                  <p className="text-sm font-bold text-slate-900">{step + 1} / {sections.length} Steps</p>
               </div>
            </div>
          </div>
          
          <div className="mt-4 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
              className="h-full bg-[#ea580c]" 
            />
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 mt-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Card className="border-none shadow-2xl rounded-3xl overflow-hidden ">
              <div className="bg-white px-8 py-10 border-b border-slate-100">
                <div className="flex items-center gap-3 mb-3">
                   <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight font-outfit">{currentSection.title}</h2>
                </div>
                {currentSection.description && (
                  <div 
                    className="text-slate-600 leading-relaxed prose prose-sm max-w-none prose-slate opacity-80 mb-4"
                    dangerouslySetInnerHTML={{ __html: currentSection.description }}
                  />
                )}
                <div className="p-4 bg-orange-50 border-l-4 border-orange-500 rounded-r-2xl flex items-start gap-3 shadow-sm">
                  <AlertCircle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-extrabold text-orange-950">All fields on this page are mandatory to be filled</p>
                    <p className="text-xs text-orange-850 mt-1 font-semibold leading-relaxed">
                      If any field is not applicable to your case (e.g. Spouse Details, Publications, Presentations, or previous attempts), you <span className="underline decoration-2">must</span> write <strong className="bg-orange-100/80 px-2 py-0.5 rounded text-orange-950 font-black">NA</strong> or <strong className="bg-orange-100/80 px-2 py-0.5 rounded text-orange-950 font-black">N/A</strong> or enter <strong className="bg-orange-100/80 px-2 py-0.5 rounded text-orange-950 font-black">0</strong>.
                    </p>
                  </div>
                </div>
              </div>
          
          <CardContent className="p-6 md:p-8 space-y-8">
             {currentSection.fields.map((field: any) => {
               if (field.visibleIf) {
                 const targetValue = form[field.visibleIf.field];
                 const conditionValue = field.visibleIf.contains || field.visibleIf.equals;
                 if (field.visibleIf.key) {
                    const nestedVal = targetValue?.[field.visibleIf.key];
                    if (nestedVal !== conditionValue) return null;
                 } else if (field.visibleIf.contains) {
                    if (!targetValue || !targetValue.includes(conditionValue)) return null;
                 } else if (field.visibleIf.equals) {
                    if (targetValue !== conditionValue) return null;
                 }
               }

               return (
                 <div key={field.id} className="space-y-3">
                   {field.type !== 'info' && field.type !== 'heading' && field.type !== 'static_text' && (
                     <Label className="text-[15px] font-bold text-slate-800 flex items-center gap-1.5 tracking-tight">
                       {field.label}
                       <span className="text-red-500 font-extrabold">*</span>
                     </Label>
                   )}

                  {field.type === 'file' && (
                     <div className={`relative border-2 border-dashed rounded-2xl p-10 transition-all ${files[field.id] ? 'border-emerald-400 bg-emerald-50/20' : errors[field.id] ? 'border-red-300 bg-red-50/20' : 'border-slate-200 hover:border-orange-500 hover:bg-orange-50/5 bg-slate-50/30'}`}>
                       <input
                         type="file"
                         name={field.id}
                         onChange={(e) => onFileChange(field.id, e.target.files?.[0] || null)}
                         className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                         accept={field.id.toLowerCase().includes("lor") ? ".pdf" : field.id.toLowerCase().includes("photo") ? ".jpg,.jpeg" : ".pdf,.jpg,.jpeg,.png"}
                       />
                       <div className="text-center">
                         {files[field.id] ? (
                           <>
                             <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                               <CheckCircle2 className="w-6 h-6 text-green-600" />
                             </div>
                             <p className="text-sm font-bold text-green-700">{files[field.id].name}</p>
                             <p className="text-xs text-green-600 mt-1">File selected successfully</p>
                           </>
                         ) : (
                           <>
                             <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-3">
                               <Loader2 className="w-6 h-6 text-slate-400" />
                             </div>
                             <p className="text-sm font-medium text-slate-600">Click to upload or drag & drop</p>
                             <p className="text-xs text-slate-400 mt-1">
                               {field.id.toLowerCase().includes("lor")
                                 ? "PDF only (Max 5MB)"
                                 : field.id.toLowerCase().includes("photo")
                                   ? "JPG/JPEG only (Max 2MB)"
                                   : "PDF or Image (Max 10MB)"}
                             </p>
                           </>
                         )}
                       </div>
                     </div>
                  )}{field.type === 'info' && (
                      <div className="bg-blue-50 border-l-4 border-[#000080] p-6 rounded-r-xl shadow-sm">
                         <div className="flex items-start gap-4">
                           <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                             <CreditCard className="w-5 h-5 text-[#000080]" />
                           </div>
                           <div>
                             <h4 className="text-sm font-bold text-blue-900 uppercase tracking-wider mb-1">{field.label || "Instruction"}</h4>
                             <div 
                               className="text-sm text-blue-800 leading-relaxed font-medium prose prose-sm max-w-none prose-blue"
                               dangerouslySetInnerHTML={{ __html: field.defaultValue || "" }}
                             />
                           </div>
                         </div>
                      </div>
                    )}

                 {field.type === 'heading' && (
                   <div className="pt-4 pb-2 border-b border-slate-200">
                     <h3 className="text-xl font-bold text-slate-800">{field.label}</h3>
                     {field.description && <p className="text-sm text-slate-500 mt-1">{field.description}</p>}
                   </div>
                 )}

                 {field.type === 'static_text' && (
                   <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                     {field.label}
                   </div>
                 )}

                 {field.type === 'phone' && (
                   <div className="flex gap-2">
                     <div className="relative group">
                       <div className="h-full px-5 py-4 rounded-2xl border-2 border-slate-200/80 bg-slate-50 flex items-center gap-3 cursor-pointer hover:border-orange-300 hover:bg-orange-50/20 transition-all shadow-sm">
                         <div className="w-6 h-6 rounded-full overflow-hidden border border-slate-200 flex-shrink-0 shadow-sm relative">
                           <div className="absolute inset-0 flex flex-col">
                             <div className="flex-1 bg-[#FF9933]"></div>
                             <div className="flex-1 bg-white flex items-center justify-center">
                               <div className="w-1.5 h-1.5 rounded-full border-[0.5px] border-[#000080] flex items-center justify-center">
                                 <div className="w-[0.5px] h-full bg-[#000080] rotate-0"></div>
                                 <div className="w-[0.5px] h-full bg-[#000080] rotate-45 absolute"></div>
                                 <div className="w-[0.5px] h-full bg-[#000080] rotate-90 absolute"></div>
                                 <div className="w-[0.5px] h-full bg-[#000080] rotate-135 absolute"></div>
                               </div>
                             </div>
                             <div className="flex-1 bg-[#128807]"></div>
                           </div>
                         </div>
                         <span className="text-sm font-bold text-slate-700 tracking-tight">+91</span>
                         <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-orange-500 transition-colors" />
                       </div>
                     </div>
                     <input
                       type="text"
                       name={field.id}
                       autoComplete="new-password"
                       value={form[field.id] || ""}
                       onChange={(e) => {
                         const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                         set(field.id, val);
                       }}
                       className={`flex-1 px-5 py-4 rounded-2xl border-2 ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200/80 hover:border-slate-300'} focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all outline-none font-bold text-slate-800 text-[16px] tracking-widest`}
                       placeholder="10 digit mobile number"
                     />
                   </div>
                 )}

                 {field.type === 'text' && (
                   <input
                     type="text"
                     name={field.id}
                     autoComplete="new-password"
                     value={form[field.id] || ""}
                     onChange={(e) => set(field.id, e.target.value)}
                     className={`w-full px-4 py-3 rounded-lg border ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200'} focus:ring-2 focus:ring-blue-500/20 focus:border-[#000080] transition-all outline-none`}
                     placeholder={field.placeholder || `${field.label} (Put 'NA' if not applicable)`}
                   />
                 )}

                 {field.type === 'email' && (
                   <input
                     type="email"
                     name={field.id}
                     autoComplete="new-password"
                     value={form[field.id] || ""}
                     onChange={(e) => set(field.id, e.target.value)}
                     className={`w-full px-4 py-3 rounded-lg border ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200'} focus:ring-2 focus:ring-blue-500/20 focus:border-[#000080] transition-all outline-none`}
                     placeholder={field.placeholder || "example@domain.com"}
                   />
                 )}

                 {field.type === 'textarea' && (
                   <textarea
                     name={field.id}
                     autoComplete="new-password"
                     value={form[field.id] || ""}
                     onChange={(e) => set(field.id, e.target.value)}
                     rows={4}
                     className={`w-full px-4 py-3 rounded-lg border ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200'} focus:ring-2 focus:ring-blue-500/20 focus:border-[#000080] transition-all outline-none`}
                     placeholder={field.placeholder || `${field.label} (Put 'NA' if not applicable)`}
                   />
                 )}

                 {field.type === 'select' && (
                   <select
                     value={form[field.id] || ""}
                     onChange={(e) => set(field.id, e.target.value)}
                     className={`w-full px-5 py-4 rounded-2xl border-2 ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200/80 hover:border-slate-300'} focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all outline-none bg-white font-medium text-slate-800 text-[15px]`}
                   >
                     <option value="">Select Option</option>
                     {field.options.map((opt: string) => (
                       <option key={opt} value={opt}>{opt}</option>
                     ))}
                   </select>
                 )}

                 {field.type === 'radio' && (
                   <div className="flex flex-wrap gap-4">
                     {field.options.map((opt: string) => (
                       <label key={opt} className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${form[field.id] === opt ? 'border-[#000080] bg-blue-50 text-[#000080]' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                         <input
                           type="radio"
                           name={field.id}
                           checked={form[field.id] === opt}
                           onChange={() => set(field.id, opt)}
                           className="w-4 h-4 text-[#000080] border-slate-300 focus:ring-[#000080]"
                         />
                         <span className="text-sm font-medium">{opt}</span>
                       </label>
                     ))}
                   </div>
                 )}

                 {field.type === 'date' && (
                   <input
                     type="date"
                     value={form[field.id] || ""}
                     onChange={(e) => set(field.id, e.target.value)}
                     className={`w-full px-4 py-3 rounded-lg border ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200'} focus:ring-2 focus:ring-blue-500/20 focus:border-[#000080] transition-all outline-none`}
                   />
                 )}

                 {field.type === 'time' && (
                   <input
                     type="time"
                     value={form[field.id] || ""}
                     onChange={(e) => set(field.id, e.target.value)}
                     className={`w-full px-4 py-3 rounded-lg border ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200'} focus:ring-2 focus:ring-blue-500/20 focus:border-[#000080] transition-all outline-none`}
                   />
                 )}

                 {field.type === 'checkbox' && (
                   <label className="flex items-start gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={!!form[field.id]}
                        onChange={(e) => set(field.id, e.target.checked)}
                        className="mt-1 w-5 h-5 rounded text-[#000080] border-slate-300 focus:ring-[#000080]"
                      />
                      <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors leading-relaxed">
                        {field.label}
                      </span>
                   </label>
                 )}

                 {field.type === 'checkbox_group' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {field.options.map((opt: string) => (
                        <label key={opt} className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all ${Array.isArray(form[field.id]) && form[field.id].includes(opt) ? 'border-[#000080] bg-blue-50' : 'border-slate-100 hover:border-slate-200'}`}>
                          <input
                            type="checkbox"
                            checked={Array.isArray(form[field.id]) && form[field.id].includes(opt)}
                            onChange={(e) => {
                               let current = Array.isArray(form[field.id]) ? [...form[field.id]] : [];
                               if (e.target.checked) {
                                  if (opt === "None of the Above") {
                                    current = [opt];
                                  } else {
                                    current = current.filter((i: string) => i !== "None of the Above");
                                    current.push(opt);
                                  }
                               } else {
                                  current = current.filter((i: string) => i !== opt);
                               }
                               set(field.id, current);
                            }}
                            className="w-5 h-5 rounded text-[#000080] border-slate-300 focus:ring-[#000080]"
                          />
                          <span className="text-sm font-medium text-slate-700">{opt}</span>
                        </label>
                      ))}
                    </div>
                 )}

                 {field.type === 'skills_table' && (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b">
                          <tr>
                            <th className="px-4 py-3 text-left font-bold text-slate-700">Skill</th>
                            {field.options.map((opt: string) => (
                              <th key={opt} className="px-4 py-3 text-center font-bold text-slate-700">{opt}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {field.rows.map((row: string) => (
                            <tr key={row} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3 font-medium text-slate-800">{row}</td>
                              {field.options.map((opt: string) => (
                                <td key={opt} className="px-4 py-3 text-center">
                                  <input
                                    type="radio"
                                    name={`${field.id}_${row}`}
                                    checked={form[field.id]?.[row] === opt}
                                    onChange={() => {
                                      const current = form[field.id] || {};
                                      set(field.id, { ...current, [row]: opt });
                                    }}
                                    className="w-4 h-4 text-[#000080]"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                 )}

                 {field.type === 'qualification_matrix' && (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b">
                          <tr>
                            <th className="px-4 py-3 text-left font-bold text-slate-700">Qualification</th>
                            <th className="px-4 py-3 text-center font-bold text-slate-700">Yes</th>
                            <th className="px-4 py-3 text-center font-bold text-slate-700">No</th>
                            <th className="px-4 py-3 text-center font-bold text-slate-700">N/A</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {['DO (Diploma Ophthlmology)', 'MS/MD ( Masters in Ophthalmology)', 'DNB'].map((q: string) => (
                            <tr key={q}>
                              <td className="px-4 py-3 font-medium text-slate-800">{q}</td>
                              {['Yes', 'No', 'N/A'].map((v: string) => (
                                <td key={v} className="px-4 py-3 text-center">
                                  <input
                                    type="radio"
                                    name={`${field.id}_${q}`}
                                    checked={form[field.id]?.[q] === v}
                                    onChange={() => {
                                       const current = form[field.id] || {};
                                       set(field.id, { ...current, [q]: v });
                                    }}
                                    className="w-4 h-4 text-[#000080]"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                 )}

                 {field.type === 'surgery_table' && (
                    <div className="space-y-6">
                      <div className="overflow-x-auto border rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="px-6 py-4 text-left font-bold text-slate-700 uppercase tracking-wider">Surgery Type</th>
                              <th className="px-6 py-4 text-center font-bold text-slate-700 uppercase tracking-wider bg-orange-50/30">Under Supervision</th>
                              <th className="px-6 py-4 text-center font-bold text-slate-700 uppercase tracking-wider bg-green-50/30">Independently</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {field.rows.map((row: string) => (
                              <tr key={row} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4 font-semibold text-slate-800">{row}</td>
                                <td className="px-6 py-4 bg-orange-50/10">
                                  <input
                                    type="number"
                                    min="0"
                                    value={form[field.id]?.[row]?.supervision || ""}
                                    onChange={(e) => {
                                      const current = form[field.id] || {};
                                      const rowData = current[row] || {};
                                      set(field.id, { ...current, [row]: { ...rowData, supervision: parseInt(e.target.value) || 0 } });
                                    }}
                                    className="w-full px-3 py-2 text-center rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-[#000080] outline-none transition-all font-medium"
                                    placeholder="0 (Put '0' if not applicable)"
                                  />
                                </td>
                                <td className="px-6 py-4 bg-green-50/10">
                                  <input
                                    type="number"
                                    min="0"
                                    value={form[field.id]?.[row]?.independent || ""}
                                    onChange={(e) => {
                                      const current = form[field.id] || {};
                                      const rowData = current[row] || {};
                                      set(field.id, { ...current, [row]: { ...rowData, independent: parseInt(e.target.value) || 0 } });
                                    }}
                                    className="w-full px-3 py-2 text-center rounded-lg border border-slate-200 focus:ring-2 focus:ring-green-500/20 focus:border-green-500 outline-none transition-all font-medium"
                                    placeholder="0"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                 {field.type === 'number' && (
                    <input
                      type="number"
                      value={form[field.id] || ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={`w-full px-5 py-4 rounded-2xl border-2 ${errors[field.id] ? 'border-red-500 shadow-sm shadow-red-100' : 'border-slate-200/80 hover:border-slate-300'} focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all outline-none font-medium text-slate-800 text-[15px]`}
                      placeholder="0"
                    />
                 )}

                 {errors[field.id] && (
                   <p className="text-xs font-bold text-red-500 flex items-center gap-1">
                     <AlertCircle className="w-3 h-3" /> {errors[field.id]}
                   </p>
                 )}
                 </div>
               );
             })}

             {step === sections.length - 1 && (
               <div className="mb-6 p-5 bg-orange-50 border-2 border-orange-200 rounded-2xl shadow-sm">
                 <div className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                     <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                       <CreditCard className="w-5 h-5 text-[#000080]" />
                     </div>
                     <div>
                       <p className="text-xs font-bold text-blue-800 uppercase tracking-wider">Total Amount to Pay</p>
                       <p className="text-[10px] text-[#000080]">Rs. 2,750 x {Array.isArray(form.specialization) ? form.specialization.length : 1} Specialization{Array.isArray(form.specialization) && form.specialization.length > 1 ? 's' : ''}</p>
                     </div>
                   </div>
                   <div className="text-right">
                     <span className="text-2xl font-bold text-blue-900">
                       Rs. {(2750 * (Array.isArray(form.specialization) ? form.specialization.length : 1)).toLocaleString("en-IN")}
                     </span>
                   </div>
                 </div>
               </div>
             )}

             {submitError && (
               <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                 <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                 <p className="text-sm font-medium text-red-800">{submitError}</p>
               </div>
             )}
          </CardContent>

          <div className="bg-slate-50 p-6 flex items-center justify-between border-t border-slate-100">
            <Button
              variant="outline"
              onClick={prev}
              disabled={step === 0 || submitting}
              className="h-14 px-8 border-2 border-slate-200/80 hover:bg-slate-50 hover:border-slate-300 rounded-2xl text-slate-700 font-bold transition-all active:scale-[0.98] cursor-pointer font-outfit"
            >
              <ChevronLeft className="w-4 h-4 mr-2" /> Previous
            </Button>

            <Button 
              onClick={next} 
              disabled={submitting}
              className="bg-[#000080] hover:bg-[#000066] text-white px-10 py-7 rounded-2xl flex items-center gap-2 text-[17px] font-extrabold transition-all shadow-xl shadow-blue-950/10 hover:shadow-2xl hover:shadow-blue-950/20 active:scale-[0.98] cursor-pointer font-outfit"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : step === sections.length - 1 ? (
                <>Submit & Pay <ChevronRight className="w-5 h-5" /></>
              ) : (
                <>Next Step <ChevronRight className="w-5 h-5" /></>
              )}
            </Button>
          </div>
          <div className="mt-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
             <div className="flex items-start gap-3">
               <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
               <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                 Your progress is <strong>automatically saved</strong>. You can close this window and return later to continue where you left off. 
                 <br />
                 <span className="text-[#000080]">Note: Applications cannot be modified after final submission.</span>
               </p>
             </div>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  </main>
</div>
);
}



