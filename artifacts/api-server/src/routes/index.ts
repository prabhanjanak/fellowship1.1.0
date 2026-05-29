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
import fs from "fs/promises";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseSpecializationString, formatDOBToStandard } from "../lib/utils";

const router: IRouter = Router();

router.get("/ping", (req, res) => res.send("pong"));

// Global Print Application Route (Moved here for maximum reliability - TOP PRIORITY)
router.get(
  "/print-application/:id",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator", "doctor"),
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
      // renderApplicationRecordRow('Status', sub.status.toUpperCase());
      
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

// ─── Doctor Submission HTML View ─────────────────────────────────────────────
// Returns the full application as a rich HTML page (not PDF).
// This is what the doctor sees inside the scoring dialog iframe.
router.get(
  "/submission-view/:id",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator", "doctor"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).send("<h1>Invalid ID</h1>");

      const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.id, id));
      if (!sub) return res.status(404).send("<h1>Submission not found</h1>");

      const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, sub.formId));

      // Embed photo as base64 so it renders in sandboxed iframe
      let photoDataUrl = "";
      if (sub.photoUrl && sub.photoUrl.startsWith("/objects/")) {
        try {
          const localPath = path.join(process.cwd(), "uploads", sub.photoUrl.replace("/objects/", ""));
          const buf = await fs.readFile(localPath);
          const ext = localPath.split(".").pop()?.toLowerCase() || "jpg";
          const mime = ext === "png" ? "image/png" : "image/jpeg";
          photoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        } catch { /* photo not found — render placeholder */ }
      }

      const parseSpecs = (s: string | null | undefined): string[] => parseSpecializationString(s);

      const fld = (val: any) => {
        if (val === null || val === undefined || val === "" || val === "null") return "—";
        if (typeof val === "boolean") return val ? "Yes" : "No";
        return String(val);
      };

      // Traverse form config to build friendly labels map for custom fields
      const fieldLabels: Record<string, string> = {};
      const sectionsConfig: any[] = form?.sectionsConfig ?? [];
      for (const sec of sectionsConfig) {
        for (const f of sec.fields ?? []) {
          if (f.id && f.label) {
            fieldLabels[f.id] = f.label;
          }
        }
      }

      // 1. Personal Details Card
      const personalRows: [string, any][] = [
        ["Date of Birth", formatDOBToStandard(sub.dateOfBirth)],
        ["Gender", sub.gender],
        ["Marital Status", sub.maritalStatus],
        ["Spouse / Family Details", sub.spouseDetails],
        ["Mailing Address", sub.mailingAddress],
        ["Permanent Address", sub.permanentAddress],
      ];

      // 2. Qualifications Card
      const qualificationsRows: [string, any][] = [
        ["Degree", sub.degree],
        ["Medical College", sub.medicalCollege],
        ["University", sub.university],
        ["Medical Council Reg No.", sub.medicalCouncilNumber],
        ["PG Qualifications", sub.pgQualifications],
        ["DO Details", sub.doQualification ? sub.doDetails : null],
        ["MS/MD Details", sub.msMdQualification ? sub.msMdDetails : null],
        ["DNB Details", sub.dnbQualification ? sub.dnbDetails : null],
        ["Other Training", sub.otherTraining],
      ];

      // 3. Clinical Profile Card
      const clinicalRows: [string, any][] = [
        ["Diagnostic Skills", sub.diagnosticSkills],
        ["Surgical Experience", sub.surgicalExperience],
        ["Total Surgeries Done", sub.totalSurgeries],
      ];

      // 4. Research Card
      const researchRows: [string, any][] = [
        ["Publications", sub.publications],
        ["Presentations", sub.presentations],
      ];

      // 5. Additional / Referral Card
      const referralRows: [string, any][] = [
        ["Health Declaration", sub.healthDeclaration === "true" || sub.healthDetails || sub.medicalConditions ? `${sub.healthDeclaration === "true" ? "Yes" : "No"}${sub.healthDetails ? " | Details: " + sub.healthDetails : ""}${sub.medicalConditions ? " | Conditions: " + sub.medicalConditions : ""}` : null],
        ["Referred By", sub.referredByName || sub.referralSource || sub.mediaSource ? `${[sub.referredByName, sub.referralSource, sub.mediaSource].filter(Boolean).join(" · ")}` : null],
        ["Previous Applications", sub.previousApplicationMonthYear],
        ["Other Information", sub.otherInformation],
      ];

      const createCardHtml = (title: string, rows: [string, any][]) => {
        const filteredRows = rows.filter(([_, val]) => val !== null && val !== undefined && val !== "" && val !== "—");
        if (filteredRows.length === 0) return "";

        const trs = filteredRows.map(([label, val]) => `
          <tr>
            <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #f1f5f9;width:40%;vertical-align:top;">${label}</td>
            <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#0f172a;border-bottom:1px solid #f1f5f9;word-break:break-word;">${fld(val)}</td>
          </tr>
        `).join("");

        return `
          <div style="margin-bottom:20px;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.02);">
            <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e2e8f0;">
              <span style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#334155;">${title}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;background:#fff;">${trs}</table>
          </div>
        `;
      };

      const personalCard = createCardHtml("Personal Details", personalRows);
      const qualificationsCard = createCardHtml("Academic Qualifications", qualificationsRows);
      const clinicalCard = createCardHtml("Clinical Skills & Surgical Profile", clinicalRows);
      const researchCard = createCardHtml("Research & Academic Achievements", researchRows);
      const referralCard = createCardHtml("Referral & Additional Profile Details", referralRows);

      // 6. Custom Answers Card
      const customRowsHtml: string[] = [];
      const fd = (sub.formData as Record<string, any>) || {};
      const ca = (sub.customAnswers as Record<string, any>) || {};
      const allCustomEntries = { ...ca, ...fd };

      for (const [key, val] of Object.entries(allCustomEntries)) {
        if (val === null || val === undefined || val === "") continue;

        // Skip standard keys that are already explicitly rendered above
        const standardKeys = [
          "fullName", "email", "phone", "dateOfBirth", "gender", "permanentAddress", "mailingAddress",
          "degree", "medicalCollege", "university", "medicalCouncilNumber", "pgQualifications",
          "diagnosticSkills", "surgicalExperience", "totalSurgeries", "publications", "presentations",
          "lor1Url", "lor1RefName", "lor1RefContact", "lor1RefEmail",
          "lor2Url", "lor2RefName", "lor2RefContact", "lor2RefEmail",
          "photoUrl", "otherInformation", "maritalStatus", "spouseDetails", "doQualification", "doDetails",
          "msMdQualification", "msMdDetails", "dnbQualification", "dnbDetails", "otherTraining",
          "healthDeclaration", "healthDetails", "medicalConditions", "referredByName", "referralSource", "mediaSource",
          "previousApplicationMonthYear"
        ];
        if (standardKeys.includes(key)) continue;

        let displayVal = fld(val);
        if (typeof val === "string" && (val.trim().startsWith("[") || val.trim().startsWith("{"))) {
          try {
            const parsed = JSON.parse(val.trim());
            if (Array.isArray(parsed)) {
              displayVal = parsed.join(", ");
            } else if (typeof parsed === "object") {
              displayVal = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(" | ");
            }
          } catch {}
        }

        const label = fieldLabels[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        customRowsHtml.push(`
          <tr>
            <td style="padding:10px 14px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #f1f5f9;width:40%;vertical-align:top;">${label}</td>
            <td style="padding:10px 14px;font-size:12px;font-weight:600;color:#0f172a;border-bottom:1px solid #f1f5f9;word-break:break-word;">${displayVal}</td>
          </tr>
        `);
      }

      let customAnswersCard = "";
      if (customRowsHtml.length > 0) {
        customAnswersCard = `
          <div style="margin-bottom:20px;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.02);">
            <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e2e8f0;">
              <span style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#334155;">Custom Application Answers</span>
            </div>
            <table style="width:100%;border-collapse:collapse;background:#fff;">${customRowsHtml.join("")}</table>
          </div>
        `;
      }

      const specs = parseSpecs(sub.specialization);
      const specBadges = specs.map(s =>
        `<span style="display:inline-block;padding:3px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;font-size:11px;font-weight:800;color:#1d4ed8;margin:2px;">${s}</span>`
      ).join(" ");

      // LOR Block
      const lorItems: string[] = [];
      if (sub.lor1Url || sub.lor1RefName) {
        lorItems.push(`
          <div style="flex:1;min-width:260px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.01);">
            <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Letter of Recommendation 1</div>
            ${sub.lor1RefName ? `<div style="font-size:13px;font-weight:700;color:#0f172a;">${sub.lor1RefName}</div>` : ""}
            ${sub.lor1RefContact ? `<div style="font-size:11px;color:#475569;margin-top:2px;">Contact: ${sub.lor1RefContact}</div>` : ""}
            ${sub.lor1RefEmail ? `<div style="font-size:11px;color:#2563eb;margin-top:2px;">Email: ${sub.lor1RefEmail}</div>` : ""}
            ${sub.lor1Url ? `<a href="${sub.lor1Url}" target="_blank" style="display:inline-flex;align-items:center;margin-top:10px;font-size:12px;font-weight:700;color:#2563eb;text-decoration:none;">📄 [View LOR 1 Document]</a>` : "<span style='font-size:11px;color:#94a3b8;display:block;margin-top:6px;'>No LOR document uploaded</span>"}
          </div>
        `);
      }
      if (sub.lor2Url || sub.lor2RefName) {
        lorItems.push(`
          <div style="flex:1;min-width:260px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.01);">
            <div style="font-size:10px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Letter of Recommendation 2</div>
            ${sub.lor2RefName ? `<div style="font-size:13px;font-weight:700;color:#0f172a;">${sub.lor2RefName}</div>` : ""}
            ${sub.lor2RefContact ? `<div style="font-size:11px;color:#475569;margin-top:2px;">Contact: ${sub.lor2RefContact}</div>` : ""}
            ${sub.lor2RefEmail ? `<div style="font-size:11px;color:#2563eb;margin-top:2px;">Email: ${sub.lor2RefEmail}</div>` : ""}
            ${sub.lor2Url ? `<a href="${sub.lor2Url}" target="_blank" style="display:inline-flex;align-items:center;margin-top:10px;font-size:12px;font-weight:700;color:#2563eb;text-decoration:none;">📄 [View LOR 2 Document]</a>` : "<span style='font-size:11px;color:#94a3b8;display:block;margin-top:6px;'>No LOR document uploaded</span>"}
          </div>
        `);
      }

      let lorSectionHtml = "";
      if (lorItems.length > 0) {
        lorSectionHtml = `
          <div style="margin-bottom:20px;">
            <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#475569;margin-bottom:10px;">Letters of Recommendation</div>
            <div style="display:flex;flex-wrap:wrap;gap:14px;">${lorItems.join("")}</div>
          </div>
        `;
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Application — ${sub.fullName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #0f172a; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <div style="max-width:860px;margin:0 auto;padding:20px;">

    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:16px;border-bottom:3px solid #1d4ed8;margin-bottom:20px;">
      <div>
        <div style="font-size:22px;font-weight:900;color:#1d4ed8;text-transform:uppercase;letter-spacing:-0.5px;">Sankara Academy of Vision</div>
        <div style="font-size:11px;font-weight:600;color:#64748b;margin-top:2px;">Educational unit of Sankara Eye Foundation, India</div>
        <div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-top:4px;">Fellowship Program — Applicant Dossier</div>
      </div>
      <div style="font-size:10px;font-weight:700;color:#64748b;text-align:right;">
        <div>Application ID: #${sub.id}</div>
        <div style="margin-top:2px;">Submitted: ${sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</div>
      </div>
    </div>

    <!-- Candidate Card: Photo + Name + Specializations -->
    <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:20px;padding:16px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;">
      <div style="width:90px;height:110px;border:2px solid #e2e8f0;border-radius:8px;overflow:hidden;flex-shrink:0;background:#f1f5f9;display:flex;align-items:center;justify-content:center;">
        ${photoDataUrl
          ? `<img src="${photoDataUrl}" alt="Photo" style="width:100%;height:100%;object-fit:cover;" />`
          : `<span style="font-size:9px;font-weight:700;color:#94a3b8;text-align:center;text-transform:uppercase;">No Photo</span>`
        }
      </div>
      <div style="flex:1;">
        <div style="font-size:20px;font-weight:900;color:#0f172a;letter-spacing:-0.3px;">${sub.fullName}</div>
        <div style="font-size:12px;font-weight:600;color:#475569;margin-top:3px;">${fld(sub.email)}${sub.phone ? " · " + sub.phone : ""}</div>
        ${sub.degree || sub.medicalCollege ? `<div style="font-size:11px;font-weight:700;color:#64748b;margin-top:4px;">${[sub.degree, sub.medicalCollege, sub.university].filter(Boolean).join(" · ")}</div>` : ""}
        ${specs.length > 0 ? `<div style="margin-top:8px;">${specBadges}</div>` : ""}
      </div>
    </div>

    ${lorSectionHtml}

    ${personalCard}
    ${qualificationsCard}
    ${clinicalCard}
    ${researchCard}
    ${customAnswersCard}
    ${referralCard}

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center;font-weight:600;">
      CONFIDENTIAL — FOR PANEL USE ONLY · Sankara Academy of Vision · Fellowship Program ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.send(html);
    } catch (e) {
      console.error("[submission-view] error:", e);
      if (!res.headersSent) res.status(500).send("<h1>Error generating view</h1>");
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
