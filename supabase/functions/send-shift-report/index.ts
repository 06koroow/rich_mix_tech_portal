import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SMTP_FROM = Deno.env.get("EMAIL_FROM") || "Rich Mix Tech Portal <tech@richmix.org.uk>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { to, subject, body, html, event, report } = payload;

    const recipients = Array.isArray(to) ? to : (to ? [to] : []);

    if (!recipients.length) {
      return new Response(
        JSON.stringify({ error: "Missing required field: to (recipient list)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subject) {
      return new Response(
        JSON.stringify({ error: "Missing required field: subject" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailHtml = html || `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="border-bottom: 2px solid #0ea5e9; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px;">Rich Mix Technical Operations</h2>
          <p style="margin: 4px 0 0 0; color: #64748b; font-size: 14px;">End of Shift Report</p>
        </div>

        <div style="background: #f8fafc; padding: 16px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
          <h3 style="margin: 0 0 8px 0; color: #0f172a; font-size: 16px;">${subject}</h3>
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Submitted By:</strong> ${report?.author || "Technician"}</p>
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Timestamp:</strong> ${report?.submittedAt ? new Date(report.submittedAt).toLocaleString("en-GB") : new Date().toLocaleString("en-GB")}</p>
          ${event?.space ? `<p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Space:</strong> ${event.space}</p>` : ""}
          ${event?.date ? `<p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Event Date:</strong> ${event.date}</p>` : ""}
        </div>

        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 6px 0; color: #0f172a; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">1. Shift Summary</h4>
          <div style="background: #ffffff; padding: 12px; border-left: 3px solid #0ea5e9; font-size: 14px; line-height: 1.5; white-space: pre-wrap; background-color: #f1f5f9; border-radius: 0 4px 4px 0;">${report?.summary || "No summary provided."}</div>
        </div>

        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 6px 0; color: #0f172a; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">2. Issues & Equipment Faults</h4>
          <div style="background: #ffffff; padding: 12px; border-left: 3px solid ${report?.issues ? '#ef4444' : '#10b981'}; font-size: 14px; line-height: 1.5; white-space: pre-wrap; background-color: #f1f5f9; border-radius: 0 4px 4px 0;">${report?.issues || "None reported (All equipment operational)."}</div>
        </div>

        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 6px 0; color: #0f172a; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">3. Handover & Follow-Up</h4>
          <div style="background: #ffffff; padding: 12px; border-left: 3px solid #8b5cf6; font-size: 14px; line-height: 1.5; white-space: pre-wrap; background-color: #f1f5f9; border-radius: 0 4px 4px 0;">${report?.followUp || "None required."}</div>
        </div>

        <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">
          Sent automatically via Rich Mix Technical Portal
        </div>
      </div>
    `;

    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY secret not configured. Email payload logged:", { to: recipients, subject });
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "logged",
          message: "Email received but RESEND_API_KEY is not configured on Supabase.",
          recipients: recipients,
          subject: subject,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: SMTP_FROM,
        to: recipients,
        subject: subject,
        html: emailHtml,
        text: body || subject,
      }),
    });

    const data = await res.json();

    return new Response(JSON.stringify({ ok: res.ok, data: data }), {
      status: res.ok ? 200 : res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || "Failed to dispatch email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
