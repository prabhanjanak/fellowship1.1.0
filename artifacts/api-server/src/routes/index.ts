import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import programsRouter from "./programs";
import specialitiesRouter from "./specialities";
import unitsRouter from "./units";
import candidatesRouter from "./candidates";
import preferencesRouter from "./preferences";
import documentsRouter from "./documents";
import examsRouter from "./exams";
import questionsRouter from "./questions";
import examAssignmentsRouter from "./exam-assignments";
import attemptsRouter from "./attempts";
import interviewsRouter from "./interviews";
import panelRouter from "./panel";
import doctorsRouter from "./doctors";
import rankingsRouter from "./rankings";
import allocationsRouter from "./allocations";
import dashboardRouter from "./dashboard";
import importExcelRouter from "./import-excel";
import applicationFormsRouter from "./application-forms";
import seatMatrixRouter from "./seat-matrix";
import documentTemplatesRouter from "./document-templates";
import paymentSettingsRouter from "./payment-settings";
import storageRouter from "./storage";
import paymentRouter from "./payment";
import examManagementRouter from "./exam-management";
import debugRouter from "./debug";
import tvAccessRouter from "./tv-access";
import emailSettingsRouter from "./email-settings";
import globalSettingsRouter from "./global-settings";
import reportsRouter from "./reports";
import { db, applicationSubmissionsTable, applicationFormsTable, programsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import path from "path";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseSpecializationString, formatDOBToStandard } from "../lib/utils";

const router: IRouter = Router();

router.get("/ping", (req, res) => res.send("pong"));

// Global Print Application Route (Moved here for maximum reliability - TOP PRIORITY)
router.get(
  "/print-application/:id",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.id, id));
      if (!sub) return res.status(404).json({ error: "Submission not found" });

      const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, sub.formId));
      const [program] = form ? await db.select().from(programsTable).where(eq(programsTable.id, form.programId)) : [null];

      const doc = new PDFDocument({ 
        margin: 50, 
        size: 'A4',
        info: { Title: `Application - ${sub.fullName}`, Author: 'Sankara Academy of Vision' }
      });
      
      const filename = `Application_${sub.fullName.replace(/\s+/g, '_')}_${id}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=${filename}`);
      res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' blob: data:; img-src 'self' data: blob:;");
      doc.pipe(res);

      const colors = { primary: '#0f172a', secondary: '#475569', accent: '#2563eb', muted: '#94a3b8', border: '#e2e8f0' };

      const drawSectionHeader = (title: string) => {
        if (doc.y > 680) {
          doc.addPage();
          doc.y = 50;
        }
        doc.moveDown(1);
        const y = doc.y;
        doc.rect(50, y, 500, 24).fill('#f1f5f9');
        doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12.5).text(title.toUpperCase(), 60, y + 6, { width: 480 });
        doc.strokeColor(colors.border).lineWidth(0.5).moveTo(50, y + 24).lineTo(550, y + 24).stroke();
        doc.y = y + 32;
      };

      const renderApplicationRecordRow = (label: string, value: any) => {
        const valText = (value === null || value === undefined || value === "null" || value === "") ? "—" : String(value);
        const startY = doc.y;
        doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(10.5).text(label.toUpperCase(), 50, startY, { width: 120, lineGap: 2 });
        const labelEndY = doc.y;
        doc.fillColor(colors.primary).font('Helvetica').fontSize(11.5).text(`: ${valText}`, 180, startY, { width: 250, lineGap: 2 });
        const valueEndY = doc.y;
        doc.y = Math.max(labelEndY, valueEndY) + 5;
      };

      const renderGeneralRow = (label: string, value: any) => {
        const valText = (value === null || value === undefined || value === "null" || value === "") ? "—" : String(value);
        if (doc.y > 720) {
          doc.addPage();
          doc.y = 50;
        }
        const currentY = doc.y;
        doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(10.5).text(label.toUpperCase(), 50, currentY, { width: 160, lineGap: 2 });
        const labelEndY = doc.y;
        doc.fillColor(colors.primary).font('Helvetica').fontSize(11.5).text(`: ${valText}`, 220, currentY, { width: 330, lineGap: 2 });
        const valueEndY = doc.y;
        doc.y = Math.max(labelEndY, valueEndY) + 6;
      };

      const parseSpecializations = (spec: string | null | undefined): string[] => {
        return parseSpecializationString(spec);
      };

      const parseCenterPreferences = (cp: string | null | undefined, customAnswers?: any, sections?: any[]): Record<string, string> => {
        if (cp) {
          try {
            const parsed = JSON.parse(cp);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
          } catch { }
        }
        if (customAnswers && typeof customAnswers === "object") {
          const prefs: Record<string, string> = {};
          Object.entries(customAnswers).forEach(([key, val]) => {
            if (key.startsWith("unit_") && val) {
              let label = key.replace("unit_", "").replace(/_/g, " ").toUpperCase();
              if (sections) {
                sections.forEach((sec: any) => {
                  sec.fields?.forEach((f: any) => {
                    if (f.id === key) label = f.label.replace(" Preferred Center", "");
                  });
                });
              }
              prefs[label] = Array.isArray(val) ? val.join(", ") : String(val);
            }
          });
          return prefs;
        }
        return {};
      };

      // Header
      doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(24).text('SANKARA ACADEMY OF VISION', 50, 50, { width: 500, align: 'left' });
      doc.fillColor(colors.primary).font('Helvetica').fontSize(11).text('Educational unit of Sankara Eye Foundation, India', 50, 75, { width: 500, align: 'left' });
      doc.moveDown(0.2);
      doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(10).text('FELLOWSHIP PROGRAM ADMISSIONS', 50, 90, { width: 500, align: 'left' });
      doc.strokeColor(colors.accent).lineWidth(2).moveTo(50, 105).lineTo(550, 105).stroke();

      // Photo on the right
      const photoUrl = sub.photoUrl;
      const photoX = 450;
      const photoY = 120;
      const photoW = 100;
      const photoH = 120;

      if (photoUrl && photoUrl.startsWith("/objects/")) {
        const localPath = path.join(process.cwd(), "uploads", photoUrl.replace("/objects/", ""));
        try {
          doc.image(localPath, photoX, photoY, { width: photoW, height: photoH });
          doc.rect(photoX, photoY, photoW, photoH).strokeColor(colors.border).lineWidth(1).stroke();
        } catch (e) {
          doc.rect(photoX, photoY, photoW, photoH).fill('#f1f5f9');
          doc.fillColor(colors.muted).font('Helvetica').fontSize(8.5).text('PHOTO NOT AVAILABLE', photoX, photoY + 50, { width: photoW, align: 'center' });
        }
      } else {
        doc.rect(photoX, photoY, photoW, photoH).fill('#f1f5f9');
        doc.fillColor(colors.muted).font('Helvetica').fontSize(8.5).text('NO PHOTO UPLOADED', photoX, photoY + 50, { width: photoW, align: 'center' });
      }

      doc.y = 120;
      doc.fillColor(colors.accent).font('Helvetica-Bold').fontSize(14).text('APPLICATION RECORD', 50, 120, { width: 380 });
      doc.y = 145; // Give standard padding from title

      renderApplicationRecordRow('Application ID', id);
      renderApplicationRecordRow('Program', program?.name || 'Fellowship Program');
      renderApplicationRecordRow('Submission Date', sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
      renderApplicationRecordRow('Status', sub.status.toUpperCase());
      
      // Ensure vertical cursor is below the photo height before starting section headers to prevent overlapping
      if (doc.y < 250) {
        doc.y = 250;
      }

      drawSectionHeader('Personal Details');
      renderGeneralRow('Full Name', sub.fullName);
      renderGeneralRow('Email Address', sub.email);
      renderGeneralRow('Phone Number', sub.phone);
      renderGeneralRow('Date of Birth', formatDOBToStandard(sub.dateOfBirth));
      renderGeneralRow('Permanent Address', sub.permanentAddress);

      drawSectionHeader('Qualifications');
      renderGeneralRow('Degree', sub.degree);
      renderGeneralRow('College', sub.medicalCollege);
      renderGeneralRow('University', sub.university);
      renderGeneralRow('Reg No', sub.medicalCouncilNumber);

      drawSectionHeader('Specialization & Centers');
      const specs = parseSpecializations(sub.specialization);
      const centerPrefs = parseCenterPreferences(sub.centerPreference, sub.customAnswers, form?.sectionsConfig ?? undefined);
      specs.forEach((sp, idx) => {
        if (doc.y > 720) {
          doc.addPage();
          doc.y = 50;
        }
        const currentY = doc.y;
        doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(10.5).text(`${idx + 1}. ${sp}`, 50, currentY, { width: 180, lineGap: 2 });
        const spEndY = doc.y;
        doc.fillColor(colors.secondary).font('Helvetica').fontSize(10).text(` - Center: ${centerPrefs[sp] || 'No preference'}`, 230, currentY, { width: 320, lineGap: 2 });
        const centerEndY = doc.y;
        doc.y = Math.max(spEndY, centerEndY) + 6;
      });

      drawSectionHeader('Declaration');
      renderGeneralRow('Payment ID', sub.paymentId || '—');
      
      if (doc.y > 720) {
        doc.addPage();
        doc.y = 50;
      }
      doc.moveDown(0.5);
      doc.fillColor(colors.secondary).font('Helvetica-Oblique').fontSize(8.5).text(
        'Declaration: I hereby declare that the information provided above is true to the best of my knowledge and belief.',
        50, doc.y, { width: 500, lineGap: 2 }
      );

      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fillColor(colors.muted).fontSize(8).text(`Page ${i + 1} of ${range.count} | Generated by SAV Admissions Portal`, 50, 780, { align: 'center' });
      }

      doc.end();
    } catch (e) {
      console.error("[print-gen] error:", e);
      if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF" });
    }
  }
);

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(programsRouter);
router.use(specialitiesRouter);
router.use(unitsRouter);
router.use(candidatesRouter);
router.use(preferencesRouter);
router.use(documentsRouter);
router.use(examsRouter);
router.use(questionsRouter);
router.use(examAssignmentsRouter);
router.use(attemptsRouter);
router.use(interviewsRouter);
router.use(panelRouter);
router.use(doctorsRouter);
router.use(rankingsRouter);
router.use(allocationsRouter);
router.use(dashboardRouter);
router.use(importExcelRouter);
router.use(applicationFormsRouter);
router.use(seatMatrixRouter);
router.use(documentTemplatesRouter);
router.use(paymentSettingsRouter);
router.use(storageRouter);
router.use(paymentRouter);
router.use(examManagementRouter);
router.use(debugRouter);
router.use(tvAccessRouter);
router.use(emailSettingsRouter);
router.use(globalSettingsRouter);
router.use(reportsRouter);

export default router;
