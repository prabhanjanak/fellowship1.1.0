import nodemailer from "nodemailer";
import path from "path";
import fs from "fs";
import { db, emailSettingsTable } from "@workspace/db";

async function getTransporter() {
  const [settings] = await db.select().from(emailSettingsTable).limit(1);
  if (!settings || !settings.enabled || !settings.host || !settings.user || !settings.pass) {
    return null;
  }

  const port = Number(settings.port);
  return {
    transporter: nodemailer.createTransport({
      host: settings.host,
      port,
      secure: settings.useSsl || port === 465,
      auth: { user: settings.user, pass: settings.pass }
    }),
    from: settings.fromEmail || settings.user,
    fromName: settings.fromName || "Sankara Academy of Vision"
  };
}

export async function sendApplicationApprovalEmail(opts: {
  toEmail: string; toName: string; candidateCode: string; programName: string; formTitle: string;
}) {
  const cfg = await getTransporter();
  if (!cfg) {
    console.warn("[email] SMTP not configured or disabled — skipping approval email to", opts.toEmail);
    return;
  }
  await cfg.transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.from}>`,
    to: opts.toEmail,
    subject: `Application Approved — ${opts.programName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
        <img src="cid:logo" alt="Sankara Academy" style="height:50px;margin-bottom:16px" />
        <h2 style="color:#1d4ed8;margin:0 0 8px">Application Approved</h2>
        <p style="color:#374151">Dear <strong>${opts.toName}</strong>,</p>
        <p style="color:#374151">
          We are pleased to inform you that your application for the
          <strong>${opts.programName}</strong> fellowship has been reviewed and <strong>approved</strong>.
        </p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:20px 0">
          <p style="margin:0;font-size:14px;color:#166534">
            <strong>Your Candidate Code:</strong>&nbsp;
            <span style="font-family:monospace;font-size:16px;font-weight:bold">${opts.candidateCode}</span>
          </p>
          <p style="margin:6px 0 0;font-size:13px;color:#166534">
            Please keep this code safe — you will need it for the examination and interview process.
          </p>
        </div>
        <p style="color:#374151;font-size:14px">
          Further details regarding the examination schedule will be communicated to you shortly.
          Please ensure you are reachable on the email and phone number provided in your application.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
        <p style="color:#9ca3af;font-size:12px;margin:0">
          Sankara Academy of Vision &bull; Sankara Eye Care Institutions &bull; This is an automated message, please do not reply.
        </p>
      </div>
    `,
  });
}

export async function sendStatusUpdateEmail(opts: {
  toEmail: string; toName: string; status: string; programName?: string;
}) {
  const cfg = await getTransporter();
  if (!cfg) return;

  const subjectMap: Record<string, string> = {
    rejected: "Application Status Update",
    interview_completed: "Interview Completed — Thank You",
    allocated: "Congratulations — Fellowship Seat Allocated",
  };

  const bodyMap: Record<string, string> = {
    rejected: `We regret to inform you that after careful review, your application could not be accepted at this time. We wish you the very best in your future endeavours.`,
    interview_completed: `Thank you for appearing for the interview. Your results will be communicated shortly.`,
    allocated: `Congratulations! You have been allocated a fellowship seat. Please report as per the schedule that will be sent to you.`,
  };

  const subject = subjectMap[opts.status];
  const body = bodyMap[opts.status];
  if (!subject || !body) return;

  await cfg.transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.from}>`,
    to: opts.toEmail,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
        <h2 style="color:#1d4ed8;margin:0 0 8px">${subject}</h2>
        <p style="color:#374151">Dear <strong>${opts.toName}</strong>,</p>
        <p style="color:#374151">${body}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
        <p style="color:#9ca3af;font-size:12px;margin:0">Sankara Academy of Vision &bull; This is an automated message.</p>
      </div>
    `,
  });
}

export async function sendOfferLetterEmail(opts: {
  toEmail: string; toName: string; candidateCode: string; specialization: string; unitName: string;
}) {
  const cfg = await getTransporter();
  if (!cfg) return;

  const publicDir = path.join(process.cwd(), "..", "fellowship-exam", "public");
  const hospitalLogoPath = path.join(publicDir, "sankara-logo.jpg");
  const academyLogoPath = path.join(publicDir, "logo.png");

  const attachments = [];
  if (fs.existsSync(hospitalLogoPath)) {
    attachments.push({ filename: 'sankara-logo.jpg', path: hospitalLogoPath, cid: 'hospitalLogo' });
  }
  if (fs.existsSync(academyLogoPath)) {
    attachments.push({ filename: 'logo.png', path: academyLogoPath, cid: 'academyLogo' });
  }

  await cfg.transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.from}>`,
    to: opts.toEmail,
    subject: `Admission Offer — Fellowship in ${opts.specialization}`,
    attachments,
    html: `
      <div style="font-family:'Times New Roman',serif;max-width:800px;margin:auto;padding:40px;border:1px solid #ddd;line-height:1.6;color:#333;background:#fff;">
        <table style="width:100%;border-bottom:2px solid #1d4ed8;padding-bottom:10px;margin-bottom:30px;">
          <tr>
            <td style="width:50%;text-align:left;vertical-align:middle;">
              <img src="cid:hospitalLogo" alt="Sankara Eye Hospital" style="height:70px;" />
            </td>
            <td style="width:50%;text-align:right;vertical-align:middle;">
              <img src="cid:academyLogo" alt="Academy of Vision" style="height:70px;" />
            </td>
          </tr>
        </table>

        <div style="text-align:right;margin-bottom:20px;font-size:14px;">
          <strong>Date:</strong> ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
        </div>

        <div style="margin-bottom:30px;font-size:15px;">
          <strong>To,</strong><br/>
          <strong>Dr. ${opts.toName}</strong><br/>
          Candidate Code: ${opts.candidateCode}
        </div>

        <h2 style="text-align:center;text-decoration:underline;color:#1d4ed8;margin-bottom:30px;font-size:22px;">OFFER OF FELLOWSHIP ADMISSION</h2>

        <p>Dear Dr. ${opts.toName},</p>

        <p>Based on your performance in the entrance examination and subsequent interview conducted for the <strong>JULY 2026</strong> intake, we are pleased to offer you admission to the Fellowship program at <strong>Sankara Academy of Vision</strong>.</p>

        <p>You have been selected for the following specialization:</p>
        
        <div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;margin:20px 0;text-align:center;">
          <h3 style="margin:0;color:#0f172a;font-size:20px;">${opts.specialization}</h3>
        </div>

        <p>Your fellowship will be based at our <strong>${opts.unitName}</strong> unit. The duration of the fellowship is as per the standard norms of the academy.</p>

        <p>Please note that this offer is subject to the verification of your original documents and medical fitness. You are required to confirm your acceptance by replying to this email within 3 working days.</p>

        <p>Detailed joining instructions and the list of documents required at the time of reporting will be sent to you shortly.</p>

        <p>We look forward to welcoming you to the Sankara family.</p>

        <div style="margin-top:60px;font-size:15px;">
          <p>Yours Sincerely,</p>
          <br/><br/>
          <strong>Director,</strong><br/>
          Sankara Academy of Vision
        </div>

        <div style="margin-top:40px;border-top:1px solid #eee;padding-top:15px;font-size:11px;color:#666;text-align:center;">
          Sankara Eye Care Institutions, India &bull; www.sankaraeye.com &bull; This is an official document.
        </div>
      </div>
    `,
  });
}

