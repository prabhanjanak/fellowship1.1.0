import { Router } from "express";
import { DEFAULT_SECTIONS } from "../lib/default-sections";
import { eq, desc, inArray, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, applicationFormsTable, applicationSubmissionsTable, programsTable, candidatesTable, candidatePreferencesTable, specialitiesTable, paymentSettingsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import * as XLSX from "xlsx";
import { sendApplicationApprovalEmail } from "../lib/email";
import { google } from "googleapis";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";

const router: Router = Router();

function generateToken(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function checkCompleteness(sub: {
  fullName?: string | null; email?: string | null; phone?: string | null;
  degree?: string | null; medicalCollege?: string | null;
  lor1Url?: string | null; lor2Url?: string | null; photoUrl?: string | null;
}): boolean {
  return !!(sub.fullName && sub.email && sub.phone && sub.degree && sub.medicalCollege && sub.lor1Url && sub.lor2Url && sub.photoUrl);
}

router.get(
  "/application-forms",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (_req, res) => {
    const forms = await db.select().from(applicationFormsTable).orderBy(desc(applicationFormsTable.createdAt));
    const programs = await db.select().from(programsTable);
    const submissions = await db.select().from(applicationSubmissionsTable);

    const out = forms.map((f) => {
      const prog = programs.find((p) => p.id === f.programId);
      const subs = submissions.filter((s) => s.formId === f.id);
      return {
        ...f,
        programName: prog?.name ?? null,
        submissionCount: subs.length,
        pendingCount: subs.filter((s) => s.status === "pending").length,
      };
    });
    res.json(out);
  }
);

router.post(
  "/application-forms",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const { programId, title, description, deadline, sectionsConfig } = req.body as {
      programId: number; title: string; description?: string; deadline?: string; sectionsConfig?: any[];
    };
    if (!programId || !title) return res.status(400).json({ error: "programId and title required" });

    const { customFields, loadDefaults } = req.body as { customFields?: unknown[]; loadDefaults?: boolean };
    const token = generateToken();
    
    let finalSectionsConfig = sectionsConfig ?? [];
    if (loadDefaults && finalSectionsConfig.length === 0) {
      finalSectionsConfig = DEFAULT_SECTIONS;
    }

    const [form] = await db.insert(applicationFormsTable).values({
      token,
      programId,
      title,
      description: description ?? null,
      deadline: deadline ? new Date(deadline) : null,
      isActive: true,
      createdBy: req.user!.userId,
      customFields: (customFields as never) ?? [],
      sectionsConfig: (finalSectionsConfig as never),
    }).returning();
    res.status(201).json(form);
  }
);

router.patch(
  "/application-forms/:id",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { isActive, deadline, title, description, customFields, sectionsConfig } = req.body as {
      isActive?: boolean; deadline?: string | null; title?: string; description?: string;
      customFields?: unknown[]; sectionsConfig?: any[];
    };
    const updates: Partial<typeof applicationFormsTable.$inferInsert> = {};
    if (isActive !== undefined) updates.isActive = isActive;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (deadline !== undefined) updates.deadline = deadline ? new Date(deadline) : null;
    if (customFields !== undefined) updates.customFields = customFields as never;
    if (sectionsConfig !== undefined) updates.sectionsConfig = sectionsConfig as never;

    const [updated] = await db
      .update(applicationFormsTable)
      .set(updates)
      .where(eq(applicationFormsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Form not found" });
    res.json(updated);
  }
);

router.delete(
  "/application-forms/:id",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.formId, id));
    await db.delete(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    res.json({ success: true });
  }
);

router.get(
  "/application-forms/:id/submissions",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const formId = Number(req.params.id);
    const subs = await db
      .select()
      .from(applicationSubmissionsTable)
      .where(eq(applicationSubmissionsTable.formId, formId))
      .orderBy(desc(applicationSubmissionsTable.submittedAt));
    res.json(subs);
  }
);

router.get(
  "/application-forms/:id/export",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const formId = Number(req.params.id);
    const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, formId));
    const subs = await db
      .select()
      .from(applicationSubmissionsTable)
      .where(eq(applicationSubmissionsTable.formId, formId))
      .orderBy(desc(applicationSubmissionsTable.submittedAt));

    const rows = subs.map((s) => {
      let specParsed: any = [];
      try {
        specParsed = JSON.parse(s.specialization ?? "[]");
      } catch {
        specParsed = s.specialization;
      }
      const specString = Array.isArray(specParsed) ? specParsed.join(", ") : (specParsed || "");

      let cpParsed: Record<string, any> = {};
      try {
        cpParsed = JSON.parse(s.centerPreference ?? "{}");
      } catch {
        if (s.centerPreference) {
          const mainSpec = Array.isArray(specParsed) ? specParsed[0] : specParsed;
          if (mainSpec) cpParsed[mainSpec] = s.centerPreference;
          else cpParsed["Center"] = s.centerPreference;
        }
      }

      let caParsed: Record<string, any> = {};
      try {
        caParsed = JSON.parse(s.customAnswers ?? "{}");
      } catch {}

      const baseRow: Record<string, any> = {
        "Submission ID": s.id,
        "Timestamp": s.submittedAt ? new Date(s.submittedAt).toLocaleString("en-IN") : "",
        "Name in Full (First Name, Middle Name, Last/Family Name)": s.fullName,
        "E-mail (this would be the ID all communication would be shared on)": s.email,
        "Mobile Number (only 10 digits)": s.phone ?? "",
        "Date of Birth": s.dateOfBirth ?? "",
        "Marital Status": s.maritalStatus ?? "",
        "Permanent Address (including postal pin code)": s.permanentAddress ?? "",
        "Select 1 option from the dropbox": specString,
        "Cornea - Choose the preferred center": cpParsed["Cornea"] ? (Array.isArray(cpParsed["Cornea"]) ? cpParsed["Cornea"].join(", ") : cpParsed["Cornea"]) : "Not Applicable",
        "Glaucoma - Choose the preferred center": cpParsed["Glaucoma"] ? (Array.isArray(cpParsed["Glaucoma"]) ? cpParsed["Glaucoma"].join(", ") : cpParsed["Glaucoma"]) : "Not Applicable",
        "IOL - Choose the preferred center": cpParsed["IOL"] ? (Array.isArray(cpParsed["IOL"]) ? cpParsed["IOL"].join(", ") : cpParsed["IOL"]) : "Not Applicable",
        "Medical Retina - Choose the preferred center": cpParsed["Medical Retina"] ? (Array.isArray(cpParsed["Medical Retina"]) ? cpParsed["Medical Retina"].join(", ") : cpParsed["Medical Retina"]) : "Not Applicable",
        "Oculoplasty - Choose the preferred center": cpParsed["Oculoplasty"] ? (Array.isArray(cpParsed["Oculoplasty"]) ? cpParsed["Oculoplasty"].join(", ") : cpParsed["Oculoplasty"]) : "Not Applicable",
        "Pediatric Ophthalmology - Choose the preferred center": cpParsed["Pediatric Ophthalmology"] ? (Array.isArray(cpParsed["Pediatric Ophthalmology"]) ? cpParsed["Pediatric Ophthalmology"].join(", ") : cpParsed["Pediatric Ophthalmology"]) : "Not Applicable",
        "Phaco Refractive - Choose the preferred center": cpParsed["Phaco Refractive"] ? (Array.isArray(cpParsed["Phaco Refractive"]) ? cpParsed["Phaco Refractive"].join(", ") : cpParsed["Phaco Refractive"]) : "Not Applicable",
        "Vitreo Retina - Choose the preferred center": cpParsed["Vitreo Retina"] ? (Array.isArray(cpParsed["Vitreo Retina"]) ? cpParsed["Vitreo Retina"].join(", ") : cpParsed["Vitreo Retina"]) : "Not Applicable"
      };

      // Add any other dynamically added specializations just in case
      for (const [key, val] of Object.entries(cpParsed)) {
        if (!["Cornea", "Glaucoma", "IOL", "Medical Retina", "Oculoplasty", "Pediatric Ophthalmology", "Phaco Refractive", "Vitreo Retina"].includes(key)) {
          const valString = Array.isArray(val) ? val.join(", ") : val;
          baseRow[`${key} - Choose the preferred center`] = valString;
        }
      }

      baseRow["Where did you hear about this Fellowship?"] = s.referralSource ?? "";
      baseRow["Degrees & Other Qualifications (Mention University name, passing month/year)"] = s.degree ?? "";
      baseRow["Medical College Qualified From"] = s.medicalCollege ?? "";
      baseRow["University from which Medical College is affiliated"] = s.university ?? "";
      baseRow["Medical Council Registration Number (MCI)"] = s.medicalCouncilNumber ?? "";
      baseRow["Publications"] = s.publications ?? "";
      baseRow["Presentations"] = s.presentations ?? "";
      baseRow["Letter of recommendation 1"] = s.lor1Url ?? "";
      baseRow["Letter of recommendation 2"] = s.lor2Url ?? "";
      baseRow["Passport size photograph"] = s.photoUrl ?? "";
      baseRow["Transaction ID/ UTR No"] = s.paymentUrl ?? "";
      baseRow["Status"] = s.status;
      baseRow["Source"] = s.source ?? "internal";
      baseRow["Review Notes"] = s.reviewNotes ?? "";

      // Add any custom answers dynamically at the end
      for (const [key, val] of Object.entries(caParsed)) {
        const valString = Array.isArray(val) ? val.join(", ") : val;
        baseRow[key] = valString;
      }

      return baseRow;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0] ?? {}).map((k) => ({ wch: Math.max(k.length + 2, 18) }));
    ws["!cols"] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, "Submissions");

    const safeName = (form?.title ?? `form-${formId}`).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 40);
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_submissions.xlsx"`);
    res.send(buffer);
  }
);

router.patch(
  "/application-forms/submissions/:id",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { status, reviewNotes } = req.body as { status?: string; reviewNotes?: string };
    const updates: Partial<typeof applicationSubmissionsTable.$inferInsert> = {};
    if (status) updates.status = status;
    if (reviewNotes !== undefined) updates.reviewNotes = reviewNotes;
    updates.reviewedAt = new Date();

    const [updated] = await db
      .update(applicationSubmissionsTable)
      .set(updates)
      .where(eq(applicationSubmissionsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Submission not found" });
    res.json(updated);
  }
);

router.post(
  "/application-forms/submissions/:id/approve",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.id, id));
    if (!sub) return res.status(404).json({ error: "Submission not found" });

    const form = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, sub.formId));
    const programId = form[0]?.programId ?? 1;

    const existing = await db.select().from(candidatesTable).where(eq(candidatesTable.email, sub.email));
    if (existing.length > 0) {
      await db.update(applicationSubmissionsTable).set({ status: "approved", reviewedAt: new Date() }).where(eq(applicationSubmissionsTable.id, id));
      return res.json({ message: "Candidate already exists", candidateId: existing[0]!.id });
    }

    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `SAV-${year}-${rand}`;

    const [candidate] = await db.insert(candidatesTable).values({
      candidateCode: code,
      fullName: sub.fullName,
      email: sub.email,
      phone: sub.phone ?? null,
      dateOfBirth: sub.dateOfBirth ?? null,
      gender: null,
      address: sub.permanentAddress ?? null,
      qualification: sub.degree ?? null,
      collegeName: sub.medicalCollege ?? null,
      status: "pending",
    }).returning();

    if (sub.specialization) {
      const specs = await db.select().from(specialitiesTable);
      const spec = specs.find((s) => s.name === sub.specialization);
      if (spec) {
        await db.insert(candidatePreferencesTable).values({
          candidateId: candidate!.id,
          specialityId: spec.id,
          preferenceOrder: 1,
        });
      }
    }

    await db.update(applicationSubmissionsTable).set({ status: "approved", reviewedAt: new Date() }).where(eq(applicationSubmissionsTable.id, id));

    const prog = await db.select().from(programsTable).where(eq(programsTable.id, programId));
    sendApplicationApprovalEmail({
      toEmail: sub.email,
      toName: sub.fullName,
      candidateCode: candidate!.candidateCode,
      programName: prog[0]?.name ?? "Fellowship Program",
      formTitle: form[0]?.title ?? "Application",
    }).catch((e: Error) => console.warn("[email] failed:", e.message));

    res.json({ message: "Candidate created", candidateId: candidate!.id });
  }
);

// Bulk approve/reject
router.post(
  "/application-forms/:formId/submissions/bulk-action",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const formId = Number(req.params.formId);
    const { action, ids } = req.body as { action: "approve" | "reject"; ids: number[] };
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "action and ids required" });
    }

    if (action === "reject") {
      const result = await db.update(applicationSubmissionsTable)
        .set({ status: "rejected", reviewedAt: new Date() })
        .where(and(
          inArray(applicationSubmissionsTable.id, ids),
          eq(applicationSubmissionsTable.formId, formId)
        ))
        .returning({ id: applicationSubmissionsTable.id });
      return res.json({ success: true, processed: result.length });
    }

    if (action === "approve") {
      let approved = 0;
      for (const id of ids) {
        try {
          const [sub] = await db.select().from(applicationSubmissionsTable)
            .where(and(eq(applicationSubmissionsTable.id, id), eq(applicationSubmissionsTable.formId, formId)));
          if (!sub || sub.status === "approved") continue;

          const form = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, sub.formId));
          const programId = form[0]?.programId ?? 1;

          const existing = await db.select().from(candidatesTable).where(eq(candidatesTable.email, sub.email));
          if (existing.length > 0) {
            await db.update(applicationSubmissionsTable).set({ status: "approved", reviewedAt: new Date() }).where(eq(applicationSubmissionsTable.id, id));
            approved++;
            continue;
          }

          const year = new Date().getFullYear();
          const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
          const code = `SAV-${year}-${rand}`;

          const [candidate] = await db.insert(candidatesTable).values({
            candidateCode: code,
            fullName: sub.fullName,
            email: sub.email,
            phone: sub.phone ?? null,
            dateOfBirth: sub.dateOfBirth ?? null,
            gender: null,
            address: sub.permanentAddress ?? null,
            qualification: sub.degree ?? null,
            collegeName: sub.medicalCollege ?? null,
            status: "pending",
          }).returning();

          if (sub.specialization) {
            const specs = await db.select().from(specialitiesTable);
            const spec = specs.find((s) => s.name === sub.specialization);
            if (spec && candidate) {
              await db.insert(candidatePreferencesTable).values({
                candidateId: candidate.id,
                specialityId: spec.id,
                preferenceOrder: 1,
              }).onConflictDoNothing();
            }
          }

          await db.update(applicationSubmissionsTable).set({ status: "approved", reviewedAt: new Date() }).where(eq(applicationSubmissionsTable.id, id));

          if (candidate) {
            const prog = await db.select().from(programsTable).where(eq(programsTable.id, programId));
            sendApplicationApprovalEmail({
              toEmail: sub.email,
              toName: sub.fullName,
              candidateCode: candidate.candidateCode,
              programName: prog[0]?.name ?? "Fellowship Program",
              formTitle: form[0]?.title ?? "Application",
            }).catch(() => { });
          }
          approved++;
        } catch (e) {
          console.warn(`[bulk-approve] id=${id} failed:`, e);
        }
      }
      return res.json({ success: true, processed: approved });
    }

    return res.status(400).json({ error: "Invalid action" });
  }
);

// Google Forms config GET
router.get(
  "/application-forms/:id/google-forms-config",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });
    const cfg = form.googleFormsConfig as { formId?: string; serviceAccountJson?: Record<string, unknown> } | null;
    res.json({
      googleFormId: cfg?.formId ?? "",
      hasServiceAccount: !!(cfg?.serviceAccountJson),
    });
  }
);

// Google Forms config PUT
router.put(
  "/application-forms/:id/google-forms-config",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { googleFormId, serviceAccountJson } = req.body as { googleFormId: string; serviceAccountJson?: string };

    let parsedJson: Record<string, unknown> | undefined;
    if (serviceAccountJson && serviceAccountJson.trim()) {
      try {
        parsedJson = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
      } catch {
        return res.status(400).json({ error: "Invalid service account JSON" });
      }
    }

    // If no new service account JSON provided, keep existing
    const [existing] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Form not found" });

    const existingCfg = existing.googleFormsConfig as { formId?: string; serviceAccountJson?: Record<string, unknown> } | null;
    const newConfig = {
      formId: googleFormId,
      serviceAccountJson: parsedJson ?? existingCfg?.serviceAccountJson ?? undefined,
    };

    await db.update(applicationFormsTable)
      .set({ googleFormsConfig: newConfig as never })
      .where(eq(applicationFormsTable.id, id));

    res.json({ success: true });
  }
);

// Google Forms sync
router.post(
  "/application-forms/:id/sync-google-forms",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });

    const cfg = form.googleFormsConfig as { formId?: string; serviceAccountJson?: Record<string, unknown> } | null;
    if (!cfg?.formId || !cfg?.serviceAccountJson) {
      return res.status(400).json({ error: "Google Forms integration not configured. Please enter a Form ID and Service Account JSON." });
    }

    try {
      const auth = new google.auth.GoogleAuth({
        credentials: cfg.serviceAccountJson as Parameters<typeof google.auth.GoogleAuth>[0]["credentials"],
        scopes: ["https://www.googleapis.com/auth/forms.responses.readonly"],
      });

      const formsApi = google.forms({ version: "v1", auth });
      const responsesResp = await formsApi.forms.responses.list({ formId: cfg.formId });
      const responses = responsesResp.data.responses ?? [];

      // Get existing response IDs to avoid duplicates
      const existingResult = await db.execute(sql`
        SELECT google_forms_response_id FROM application_submissions
        WHERE form_id = ${id} AND google_forms_response_id IS NOT NULL
      `);
      const existingIds = new Set(
        (existingResult.rows as { google_forms_response_id: string }[])
          .flatMap((r) => r.google_forms_response_id.split(",").map((id) => id.trim()))
      );

      // Get form structure to map question IDs to titles
      const formMetaResp = await formsApi.forms.get({ formId: cfg.formId });
      const items = formMetaResp.data.items ?? [];
      const questionMap = new Map<string, string>();
      for (const item of items) {
        if (item.questionItem?.question?.questionId && item.title) {
          questionMap.set(item.questionItem.question.questionId, item.title.toLowerCase());
        }
      }

      // ── Step 1: parse every NEW response and group by normalised email ──────
      type GFGroup = {
        email: string; fullName: string; latestTs: string;
        specializations: { name: string; centerPref: string }[];
        responseIds: string[];
        masterExtract: (kw: string[]) => string;
        masterAnswers: Record<string, { textAnswers?: { answers?: { value?: string | null }[] } }>;
      };

      const emailGroups = new Map<string, GFGroup>();

      for (const resp of responses) {
        if (!resp.responseId || existingIds.has(resp.responseId)) continue;

        const answers = resp.answers ?? {};
        const makeExtract = (ans: typeof answers) => (keywords: string[]): string => {
          for (const [qId, answer] of Object.entries(ans)) {
            const title = questionMap.get(qId) ?? "";
            if (keywords.some((k) => new RegExp(k, "i").test(title))) {
              return (answer.textAnswers?.answers ?? []).map((a) => a.value ?? "").join(", ").trim();
            }
          }
          return "";
        };

        const extract = makeExtract(answers);
        const fullName = extract(["name in full", "full name", "your name"]);
        const rawEmail = extract(["e-mail", "email"]);
        if (!fullName || !rawEmail) continue;

        const emailKey = rawEmail.toLowerCase().replace(/\s+/g, "");
        const spec = extract(["applying for", "subspecialt", "special"]);
        const centerPref =
          extract(["cornea.*center", "glaucoma.*center", "iol.*center", "oculoplasty.*center", "pediatric.*center", "phaco.*center"]) ||
          extract(["center", "location", "unit", "prefer"]);

        if (!emailGroups.has(emailKey)) {
          emailGroups.set(emailKey, {
            email: rawEmail.trim(), fullName, latestTs: resp.lastSubmittedTime ?? "",
            specializations: [], responseIds: [], masterExtract: extract, masterAnswers: answers,
          });
        }
        const group = emailGroups.get(emailKey)!;
        group.responseIds.push(resp.responseId);

        // Collect unique specializations across all responses for this email
        if (spec && !group.specializations.find((s) => s.name === spec)) {
          group.specializations.push({ name: spec, centerPref: centerPref || "" });
        }

        // Keep the extract/answers from the most-recent response as "master"
        if ((resp.lastSubmittedTime ?? "") >= group.latestTs) {
          group.latestTs = resp.lastSubmittedTime ?? "";
          group.masterExtract = extract;
          group.masterAnswers = answers;
        }
      }

      // ── Step 2: upsert one submission record per email ───────────────────────
      let imported = 0;
      let merged = 0;

      for (const [emailKey, group] of emailGroups) {
        const ex = group.masterExtract;

        // Build merged specialization JSON
        const specializationJson = JSON.stringify(
          group.specializations.length > 0 ? group.specializations.map((s) => s.name) : []
        );
        const centerPrefJson = group.specializations.length > 0
          ? JSON.stringify(Object.fromEntries(group.specializations.map((s) => [s.name, s.centerPref])))
          : null;

        // All merged Google Forms response IDs (comma-separated for traceability)
        const allResponseIds = group.responseIds.join(",");

        const phone = ex(["mobile number", "phone number", "mobile", "phone", "contact number"]);
        const degree = ex(["degrees & other", "degree", "qualification", "mbbs"]);
        const medicalCollege = ex(["medical college qualified", "medical college", "college"]);
        const university = ex(["university from which", "university"]);
        const pgQualifications = ex(["postgraduate qual", "pg qual"]);
        const medicalCouncilNumber = ex(["medical council registration", "council registration", "registration number"]);
        const publications = ex(["journal.*publication", "publications"]);
        const presentations = ex(["presentations.*conference", "presentations"]);
        const referralSource = ex(["where did you hear", "hear about"]);
        const referredByName = ex(["referred.*faculty", "faculty.*trainee", "referred by"]);
        const permanentAddress = ex(["permanent address"]);
        const dateOfBirth = ex(["date of birth"]);
        const maritalStatus = ex(["marital status"]);
        const healthDeclaration = ex(["medical condition", "ailments", "suffering"]);
        const lor1Url = ex(["lor 1", "letter of recommendation 1"]);
        const lor1RefName = ex(["name.*designation.*reference", "designation of reference"]);
        const lor1RefContact = ex(["contact number of reference"]);
        const lor1RefEmail = ex(["email id of reference", "email.*reference"]);
        const lor2Url = ex(["lor 2", "letter of recommendation 2"]);
        const paymentUrl = ex(["screenshot.*transaction", "payment.*screenshot", "transaction id", "utr"]);
        const photoUrl = ex(["passport size photograph", "passport photo", "photograph"]);

        // Check if a submission already exists for this email+formId (from a previous sync)
        const existingSubResult = await db.execute(sql`
          SELECT id, specialization, center_preference FROM application_submissions
          WHERE form_id = ${id} AND LOWER(email) = ${emailKey}
          LIMIT 1
        `);
        const existingSub = (existingSubResult.rows as { id: number; specialization: string | null; center_preference: string | null }[])[0];

        if (existingSub) {
          // Merge new specializations into existing record
          let existingSpecs: string[] = [];
          try { existingSpecs = JSON.parse(existingSub.specialization ?? "[]"); } catch {
            if (existingSub.specialization) existingSpecs = [existingSub.specialization];
          }
          const newSpecs = group.specializations.map((s) => s.name);
          const mergedSpecs = [...new Set([...existingSpecs, ...newSpecs])];

          let existingCenterPrefs: Record<string, string> = {};
          try { existingCenterPrefs = JSON.parse(existingSub.center_preference ?? "{}"); } catch { /* ignore */ }
          const newCenterPrefs = Object.fromEntries(group.specializations.map((s) => [s.name, s.centerPref]));
          const mergedCenterPrefs = { ...existingCenterPrefs, ...newCenterPrefs };

          await db.execute(sql`
            UPDATE application_submissions SET
              specialization = ${JSON.stringify(mergedSpecs)},
              center_preference = ${JSON.stringify(mergedCenterPrefs)},
              google_forms_response_id = ${allResponseIds},
              updated_at = NOW()
            WHERE id = ${existingSub.id}
          `);
          merged++;
        } else {
          const subData = {
            formId: id, status: "pending", source: "google_forms",
            googleFormsResponseId: allResponseIds,
            fullName: group.fullName, email: group.email,
            phone: phone || null, specialization: specializationJson,
            centerPreference: centerPrefJson,
            degree: degree || null, medicalCollege: medicalCollege || null,
            university: university || null, pgQualifications: pgQualifications || null,
            medicalCouncilNumber: medicalCouncilNumber || null,
            publications: publications || null, presentations: presentations || null,
            referralSource: referralSource || null, referredByName: referredByName || null,
            permanentAddress: permanentAddress || null, dateOfBirth: dateOfBirth || null,
            maritalStatus: maritalStatus || null, healthDeclaration: healthDeclaration || null,
            lor1Url: lor1Url || null, lor1RefName: lor1RefName || null,
            lor1RefContact: lor1RefContact || null, lor1RefEmail: lor1RefEmail || null,
            lor2Url: lor2Url || null, paymentUrl: paymentUrl || null,
            photoUrl: photoUrl || null, declarationAccepted: true, customAnswers: {},
          };
          const isComplete = checkCompleteness(subData);
          await db.insert(applicationSubmissionsTable).values({ ...subData, readyForReview: isComplete } as never);
          imported++;
        }
      }

      res.json({ success: true, imported, merged, total: responses.length, uniqueApplicants: emailGroups.size });
    } catch (e: unknown) {
      console.error("[google-forms-sync] error:", e);
      const msg = e instanceof Error ? e.message : "Unknown error";
      res.status(500).json({ error: `Google Forms sync failed: ${msg}` });
    }
  }
);

// Google Sheets config GET
router.get(
  "/application-forms/:id/google-sheets-config",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });
    const cfg = form.googleSheetsConfig as { spreadsheetId?: string; sheetName?: string; serviceAccountJson?: Record<string, unknown> } | null;
    res.json({
      spreadsheetId: cfg?.spreadsheetId ?? "",
      sheetName: cfg?.sheetName ?? "Form Responses 1",
      hasServiceAccount: !!(cfg?.serviceAccountJson),
    });
  }
);

// Google Sheets config PUT
router.put(
  "/application-forms/:id/google-sheets-config",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { spreadsheetId, sheetName, serviceAccountJson } = req.body as { spreadsheetId: string; sheetName: string; serviceAccountJson?: string };

    let parsedJson: Record<string, unknown> | undefined;
    if (serviceAccountJson && serviceAccountJson.trim()) {
      try {
        parsedJson = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
      } catch {
        return res.status(400).json({ error: "Invalid service account JSON" });
      }
    }

    const [existing] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Form not found" });

    const existingCfg = existing.googleSheetsConfig as { spreadsheetId?: string; sheetName?: string; serviceAccountJson?: Record<string, unknown> } | null;
    const newConfig = {
      spreadsheetId,
      sheetName,
      serviceAccountJson: parsedJson ?? existingCfg?.serviceAccountJson ?? undefined,
    };

    await db.update(applicationFormsTable)
      .set({ googleSheetsConfig: newConfig as never })
      .where(eq(applicationFormsTable.id, id));

    res.json({ success: true });
  }
);

// Google Sheets sync
router.post(
  "/application-forms/:id/sync-google-sheets",
  requireAuth,
  requireRole("super_admin", "program_admin", "central_exam_coordinator"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });

    const cfg = form.googleSheetsConfig as { spreadsheetId?: string; sheetName?: string; serviceAccountJson?: Record<string, unknown> } | null;
    if (!cfg?.spreadsheetId || !cfg?.serviceAccountJson) {
      return res.status(400).json({ error: "Google Sheets integration not configured. Please enter a Spreadsheet ID and Service Account JSON." });
    }

    try {
      const auth = new google.auth.GoogleAuth({
        credentials: cfg.serviceAccountJson as any,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });

      const sheets = google.sheets({ version: "v4", auth });
      
      let sheetName = cfg.sheetName || 'Form Responses 1';
      let rows: string[][] | null = null;

      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: cfg.spreadsheetId,
          range: `'${sheetName}'!A1:ZZ`,
        });
        rows = response.data.values as string[][] | null;
      } catch (e: any) {
        console.warn(`[google-sheets-sync] Could not find sheet "${sheetName}", attempting auto-discovery...`, e.message);
        
        // Auto-discovery: fetch spreadsheet metadata to see available sheets
        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: cfg.spreadsheetId,
        });
        
        const sheetTitles = spreadsheet.data.sheets?.map(s => s.properties?.title).filter(Boolean) as string[];
        if (!sheetTitles || sheetTitles.length === 0) {
          throw new Error("No sheets found in this spreadsheet.");
        }

        // Try to find a sheet that looks like a response sheet
        const bestMatch = sheetTitles.find(t => t.toLowerCase().includes("responses")) 
                       || sheetTitles.find(t => t.toLowerCase().includes("form"))
                       || sheetTitles[0];
        
        console.info(`[google-sheets-sync] Auto-discovered sheet: "${bestMatch}"`);
        sheetName = bestMatch;

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: cfg.spreadsheetId,
          range: `'${sheetName}'!A1:ZZ`,
        });
        rows = response.data.values as string[][] | null;
      }

      if (!rows || rows.length <= 1) {
        return res.json({ success: true, imported: 0, message: `No data found in sheet "${sheetName}"` });
      }

      const headers = rows[0].map((h: string) => h.trim());
      const dataRows = rows.slice(1);

      // Collect all current row IDs from the spreadsheet to handle deletions
      const spreadsheetRowIds = new Set<string>();

      // Get existing row IDs/timestamps to avoid duplicates
      const existingResult = await db.execute(sql`
        SELECT google_sheets_row_id, email FROM application_submissions
        WHERE form_id = ${id} AND google_sheets_row_id IS NOT NULL
      `);
      const existingIds = new Set((existingResult.rows as { google_sheets_row_id: string }[]).map(r => r.google_sheets_row_id));

      let imported = 0;
      let merged = 0;

      for (const row of dataRows) {
        const rowData: Record<string, string> = {};
        headers.forEach((header: string, index: number) => {
          rowData[header] = row[index] || "";
        });

        const timestamp = rowData["Timestamp"];
        const email = rowData["E-mail (this would be the ID all communication would be shared on)"] || rowData["E-mail"] || rowData["Email"];
        const rowId = `${timestamp}_${email}`.toLowerCase().replace(/\s+/g, "");
        spreadsheetRowIds.add(rowId);

        if (existingIds.has(rowId)) continue;

        const specialization = rowData["Select 1 option from the dropbox"];
        
        // Find the center preference for the selected specialization
        const centerPrefHeaders = [
          "Cornea", "Glaucoma", "IOL", "Medical Retina", "Oculoplasty", "Pediatric", "Phaco Refractive", "Vitreo Retina"
        ];
        
        let centerPreference = "";
        for (const h of headers) {
          if (centerPrefHeaders.some(cp => h.startsWith(cp)) && h.toLowerCase().includes("choose the preferred center")) {
            if (rowData[h] && rowData[h] !== "Not Applicable") {
              centerPreference = rowData[h];
              break;
            }
          }
        }

        // Diagnostic skills mapping
        const diagnosticSkills: Record<string, string> = {};
        headers.forEach((h: string) => {
          if (h.startsWith("Perform & Interpret Diagnostics")) {
            const match = h.match(/\[(.*?)\]/);
            if (match && match[1]) {
              diagnosticSkills[match[1]] = rowData[h];
            }
          }
        });

        // Surgical experience mapping
        const surgicalExperience: Record<string, { supervision: string; independent: string }> = {};
        const surgicalCategories = ["ECCE", "SICS", "PHACO", "TRABECULECTOMY", "RETINA LASERS", "DCR"];
        surgicalCategories.forEach(cat => {
          const supKey = headers.find(h => h.includes(`Approximate No of ${cat}`) && h.includes("(Under Supervision)"));
          const indKey = headers.find(h => h.includes(`Approximate No of ${cat}`) && h.includes("(Independently)"));
          surgicalExperience[cat] = {
            supervision: supKey ? rowData[supKey] : "0",
            independent: indKey ? rowData[indKey] : "0"
          };
        });

        const subData = {
          formId: id,
          status: "pending",
          source: "google_sheets",
          googleSheetsRowId: rowId,
          fullName: rowData["Name in Full (First Name, Middle Name, Last/Family Name)"] || rowData["Name in Full"] || "",
          email: email || "",
          phone: rowData["Mobile Number (only 10 digits)"] || rowData["Mobile Number"] || "",
          specialization,
          centerPreference,
          referralSource: rowData["Where did you hear about this Fellowship?"],
          referredByName: rowData["Mention the name of referred Faculty/Existing Trainee from Sankara"],
          mediaSource: rowData["Mention the Media Source"],
          permanentAddress: rowData["Permanent Address (including postal pin code)"],
          mailingAddress: rowData["Preferred Mailing Address (if different from the Permanent Address then fill if same as permanent put N/A)"],
          dateOfBirth: rowData["Date of Birth"] || rowData["Date of Birth "],
          maritalStatus: rowData["Marital Status"] || rowData["Marital Status "],
          spouseDetails: rowData["If Married Spouse Details(Name & Profession)"] || rowData["If Married Spouse Details(Name & Profession) "],
          previousApplicationMonthYear: rowData["If you have responded yes, month & year"],
          medicalConditions: rowData["Kindly declare if you are suffering any of the following ailments and are on medications."] || rowData["Kindly declare if you are suffering any of the following ailments and are on medications. "],
          degree: rowData["Degree"],
          medicalCollege: rowData["Medical College Qualified From ( College, City , State, Country)"],
          university: rowData["University from which MBBS Degree Awarded"],
          pgQualifications: rowData["Postgraduate Qualifications"] || rowData["Postgraduate Qualifications "],
          doQualification: rowData["Qualification [DO (Diploma Ophthlmology)]"] === "Yes",
          doDetails: rowData["If DO then College & University Qualified from and year of Qualification"] || rowData["If DO then College & University Qualified from and year of Qualification "],
          msMdQualification: rowData["Qualification [MS/MD ( Masters in Ophthalmology)]"] === "Yes",
          msMdDetails: rowData["If MS then College & University Qualified from and year of Qualification"],
          dnbQualification: rowData["Qualification [DNB]"] === "Yes",
          dnbDetails: rowData["If DNB then institution completed from and year of Qualification"],
          otherTraining: rowData["Any Other Training / Certification undertaken"] || rowData["Any Other Training / Certification undertaken "],
          medicalCouncilNumber: rowData["Medical Council Registration Number ( indicate complete number and state of registration)"],
          diagnosticSkills: JSON.stringify(diagnosticSkills),
          surgicalExperience: JSON.stringify(surgicalExperience),
          totalSurgeries: rowData["7. Total No of Surgeries performed till date"] || rowData["7. Total No of Surgeries performed till date "],
          publications: rowData["Journal - List of all publications in the format of - Journal, Date, Title, Co - Authors"],
          presentations: rowData["Presentations  - List of presentations at Conferences in the format of - Journal, Date, Title, Co - Authors"],
          lor1Url: rowData["LOR 1,  Issue Date and Signature are mandatory on the Letter"] || rowData["LOR 1,  Issue Date and Signature are mandatory on the Letter "],
          lor1RefName: rowData["Name & Designation of Reference:"],
          lor1RefContact: rowData["Contact number of Reference:"],
          lor1RefEmail: rowData["Email ID of Reference"],
          lor2Url: rowData["LOR 2,  Issue Date and Signature are mandatory on the Letter"],
          lor2RefName: rowData["Name & Designation of Reference"],
          lor2RefContact: rowData["Contact number of Reference:"],
          lor2RefEmail: rowData["Email id of Reference:"],
          otherInformation: rowData["If there is any other information you deem pertinent for us to consider as part of your application please share that here."],
          declarationAccepted: rowData["Declaration"] === "Yes" || rowData["Declaration"] === "I Accept",
          paymentUrl: rowData["Upload the screenshot with Transaction ID/UTR details of the payment of Rs.2750/-  (Fee including Tax)"] || rowData["Upload the screenshot with Transaction ID/UTR details of the payment of Rs.2750/-  (Fee including Tax) "],
          photoUrl: rowData["Please upload your latest passport size photograph"] || rowData["Please upload your latest passport size photograph "],
          customAnswers: {},
        };

        const isComplete = checkCompleteness(subData);
        await db.insert(applicationSubmissionsTable).values({ ...subData, readyForReview: isComplete } as any);
        imported++;
      }

      // Handle deletions: if a row is gone from the spreadsheet, remove it from our DB
      let deletedCount = 0;
      const idsToDelete: string[] = [];
      const emailsToDelete: string[] = [];

      for (const rowId of existingIds) {
        if (!spreadsheetRowIds.has(rowId)) {
          const [sub] = await db.select().from(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.googleSheetsRowId, rowId));
          if (sub) {
            idsToDelete.push(rowId);
            emailsToDelete.push(sub.email);
          }
        }
      }

      if (idsToDelete.length > 0) {
        // Delete candidates first if they exist (linked by email)
        for (const email of emailsToDelete) {
          await db.delete(candidatesTable).where(eq(candidatesTable.email, email));
        }
        // Delete submissions
        await db.delete(applicationSubmissionsTable)
          .where(and(
            eq(applicationSubmissionsTable.formId, id),
            inArray(applicationSubmissionsTable.googleSheetsRowId, idsToDelete)
          ));
        deletedCount = idsToDelete.length;
      }

      res.json({ success: true, imported, deleted: deletedCount, total: dataRows.length });
    } catch (e: unknown) {
      console.error("[google-sheets-sync] error:", e);
      const msg = e instanceof Error ? e.message : "Unknown error";
      res.status(500).json({ error: `Google Sheets sync failed: ${msg}` });
    }
  }
);

// Public: request a signed upload URL scoped to an active form token
router.post("/apply/:token/request-upload-url", async (req, res) => {
  const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.token, req.params.token));
  if (!form) return res.status(404).json({ error: "Form not found" });
  if (!form.isActive) return res.status(410).json({ error: "This form is no longer accepting submissions" });
  if (form.deadline && new Date() > form.deadline) {
    return res.status(410).json({ error: "The deadline for this form has passed" });
  }
  const { name, contentType, size, candidateName } = (req.body ?? {}) as { name?: string; contentType?: string; size?: number; candidateName?: string };
  if (!name || typeof name !== "string" || !name.trim() || !contentType || typeof contentType !== "string") {
    return res.status(400).json({ error: "Missing required fields: name, contentType" });
  }
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({ error: "Only PDF, JPG, and PNG files are allowed" });
  }
  // LOR files (PDF): max 5 MB; passport photos (images): max 2 MB
  const maxSize = contentType === "application/pdf" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
  if (size && size > maxSize) {
    return res.status(400).json({ error: `File too large. Maximum size: ${maxSize / 1024 / 1024} MB` });
  }
  try {
    const isReplit = !!process.env.REPL_ID;
    if (!isReplit) {
      // Local fallback
      const objectId = Math.random().toString(36).substring(2, 10);
      const ext = name.split('.').pop() ?? "bin";
      const sanitizedName = name.split('.')[0].replace(/[^a-zA-Z0-9]/g, "_");

      let folderName = candidateName ? candidateName.trim().replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_") : "Unknown_Candidate";
      const filename = `${sanitizedName}_${objectId}.${ext}`;

      const uploadURL = `/api/apply/${req.params.token}/local-upload/${folderName}/${filename}`;
      const objectPath = `/objects/uploads/${folderName}/${filename}`;
      return res.json({ uploadURL, objectPath, metadata: { name: name.trim(), size, contentType } });
    }

    const { ObjectStorageService } = await import("../lib/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    return res.json({ uploadURL, objectPath, metadata: { name: name.trim(), size, contentType } });
  } catch (error) {
    console.error("UPLOAD ENDPOINT ERROR:", error);
    return res.status(500).json({ error: "Failed to generate upload URL", details: error instanceof Error ? error.message : String(error) });
  }
});

// Public: handle local uploads when running outside Replit
router.put("/apply/:token/local-upload/:folderName/:filename", async (req, res) => {
  try {
    const uploadDir = path.join(process.cwd(), "uploads", req.params.folderName);
    if (!uploadDir.includes(path.join("artifacts", "api-server"))) {
      // Ensure we are in the api-server directory or relative to it
      // This is a safety check and fix for mixed CWD scenarios
    }
    await fs.mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, req.params.filename);
    const writeStream = createWriteStream(filePath);

    req.pipe(writeStream);

    writeStream.on("finish", () => {
      res.json({ success: true, path: `/objects/uploads/${req.params.folderName}/${req.params.filename}` });
    });

    writeStream.on("error", (err) => {
      console.error("Write stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "File write failed" });
    });

    req.on("error", (err) => {
      console.error("Request stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Upload stream failed" });
    });
  } catch (error) {
    console.error("Local upload catch error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Failed to process upload" });
  }
});

// Public: get form info (includes specialities for dropdown + custom fields)
router.get("/apply/:token", async (req, res) => {
  const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.token, req.params.token));
  if (!form) return res.status(404).json({ error: "Form not found" });
  if (!form.isActive) return res.status(410).json({ error: "This form is no longer accepting submissions" });
  if (form.deadline && new Date() > form.deadline) {
    return res.status(410).json({ error: "The deadline for this form has passed" });
  }
  const [program] = await db.select().from(programsTable).where(eq(programsTable.id, form.programId));

  const CANONICAL_SPECIALITIES = [
    "Cornea", "Glaucoma", "IOL Fellowship", "Medical Retina",
    "Oculoplasty", "Pediatric Ophthalmology", "Phaco Refractive", "Vitreo Retina",
  ];
  const CANONICAL_UNITS = [
    "Anand", "Bangalore", "Coimbatore", "Guntur", "Hyderabad",
    "Indore", "Jaipur", "Kanpur", "Krishnankoil", "Ludhiana",
    "Panvel", "Shimoga", "Varanasi",
  ];

  const specResult = await db.execute(sql`
    SELECT DISTINCT speciality FROM seat_matrix_entries
    WHERE speciality !~ '^[0-9]' AND speciality != 'Date'
    ORDER BY speciality
  `);
  const dbSpecs = (specResult.rows as { speciality: string }[]).map((r) => r.speciality);
  const specialities = dbSpecs.length > 0 ? dbSpecs : CANONICAL_SPECIALITIES;

  const unitResult = await db.execute(sql`
    SELECT DISTINCT unit_name FROM seat_matrix_entries
    WHERE unit_name !~ '^[0-9]'
    ORDER BY unit_name
  `);
  const dbUnits = (unitResult.rows as { unit_name: string }[]).map((r) => r.unit_name);
  const units = dbUnits.length > 0 ? dbUnits : CANONICAL_UNITS;

  res.json({
    ...form,
    programName: program?.name ?? null,
    specialities,
    units,
    customFields: form.customFields ?? [],
    sectionsConfig: form.sectionsConfig ?? []
  });
});

// Public: payment config
router.get("/apply/:token/payment-config", async (req, res) => {
  const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.token, req.params.token));
  const programId = form?.programId ?? null;

  const all = await db.select().from(paymentSettingsTable).where(eq(paymentSettingsTable.isActive, true));
  const specific = programId ? all.find((s) => s.programId === programId) : null;
  const global = all.find((s) => s.programId === null);
  const setting = specific ?? global ?? null;

  if (!setting) {
    return res.json({ mock: true, amount: 275000, currency: "INR", description: "Fellowship Application Fee" });
  }

  const hasCreds = !!(setting.razorpayKeyId && setting.razorpayKeySecret);
  res.json({
    mock: !hasCreds,
    keyId: hasCreds ? setting.razorpayKeyId : undefined,
    amount: setting.amount,
    currency: setting.currency,
    description: setting.description,
    mode: setting.mode,
    upiId: setting.upiId ?? undefined,
  });
});

// Public: submit application
router.post("/apply/:token", async (req, res) => {
  const [form] = await db.select().from(applicationFormsTable).where(eq(applicationFormsTable.token, req.params.token));
  if (!form) return res.status(404).json({ error: "Form not found" });
  if (!form.isActive) return res.status(410).json({ error: "This form is no longer accepting submissions" });
  if (form.deadline && new Date() > form.deadline) {
    return res.status(410).json({ error: "The deadline for this form has passed" });
  }

  const body = req.body as Record<string, any>;
  const sections = (form.sectionsConfig as any[]) || [];

  const subData: Record<string, any> = {
    formId: form.id,
    status: (body.saveAsDraft as boolean) ? "draft" : "pending",
    saveAsDraft: (body.saveAsDraft as boolean) ?? false,
    source: "internal",
    customAnswers: {},
    submittedAt: new Date(),
  };

  // Map fields from body based on sectionsConfig
  sections.forEach((sec: any) => {
    if (!sec.enabled) return;
    sec.fields.forEach((f: any) => {
      let val = body[f.id];
      if (val === undefined) return;

      // If standard mapping exists, use it
      if (f.isStandard && f.mapping) {
        // Special handling for JSON fields if they come as arrays/objects
        if (['specialization', 'medicalConditions', 'diagnosticSkills', 'surgicalExperience', 'qualificationMatrix'].includes(f.mapping)) {
          if (val && typeof val !== 'string') val = JSON.stringify(val);
        }
        subData[f.mapping] = val;
      } else {
        // Otherwise put in customAnswers
        subData.customAnswers[f.id] = val;
      }
    });
  });

  // Fallback for mandatory fields if not mapped
  if (!subData.fullName && body.fullName) subData.fullName = body.fullName;
  if (!subData.email && body.email) subData.email = body.email;

  if (!subData.fullName || !subData.email) {
    return res.status(400).json({ error: "Full name and email are required" });
  }

  // File path validation
  const fileFields = ['lor1Url', 'lor2Url', 'photoUrl', 'paymentUrl'];
  for (const f of fileFields) {
    const val = subData[f] || body[f];
    if (val && typeof val === 'string' && val.startsWith('/objects/') && !val.startsWith('/objects/uploads/')) {
      return res.status(400).json({ error: `Invalid file path for ${f}` });
    }
    if (val && !subData[f]) subData[f] = val;
  }

  // Payment mapping
  const razorpayId = body.paymentId || body.payment_id;
  if (razorpayId) subData.paymentUrl = `razorpay:${razorpayId}`;

  const isComplete = checkCompleteness(subData);

  const [sub] = await db.insert(applicationSubmissionsTable).values({
    ...subData,
    readyForReview: isComplete,
  } as any).returning();

  res.status(201).json({ success: true, submissionId: sub!.id });
});

// Admin: delete submission
router.delete(
  "/application-submissions/:id",
  requireAuth,
  requireRole("super_admin", "program_admin"),
  async (req, res) => {
    const id = Number(req.params.id);
    const deleted = await db.delete(applicationSubmissionsTable).where(eq(applicationSubmissionsTable.id, id)).returning();
    if (deleted.length === 0) return res.status(404).json({ error: "Submission not found" });
    res.json({ message: "Submission deleted" });
  }
);

// Admin: bulk delete submissions
router.post(
  "/application-submissions/bulk-delete",
  requireAuth,
  requireRole("super_admin", "program_admin"),
  async (req, res) => {
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No IDs provided" });
    await db.delete(applicationSubmissionsTable).where(sql`${applicationSubmissionsTable.id} IN (${sql.join(ids, sql`, `)})`);
    res.json({ message: `${ids.length} submissions deleted` });
  }
);

// Admin: get default sections
router.get("/application-forms/default-sections", requireAuth, requireRole("super_admin", "program_admin"), (req, res) => {
  res.json(DEFAULT_SECTIONS);
});

export default router;
