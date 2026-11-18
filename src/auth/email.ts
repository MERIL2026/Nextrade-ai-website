import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export type EmailKind = 'verification' | 'password-reset' | 'security-notice';

export interface OutboundAuthEmail {
  to: string;
  recipientName?: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  actionUrl?: string;
}

export interface EmailDeliveryResult {
  delivered: boolean;
  mode: 'provider' | 'dev-outbox' | 'unconfigured';
  provider: string;
  messageId?: string;
  error?: string;
}

export interface AuthEmailSender {
  isConfigured: () => boolean;
  getProviderName: () => string;
  send: (email: OutboundAuthEmail) => Promise<EmailDeliveryResult>;
}

const PLACEHOLDER_VALUES = new Set([
  '',
  'YOUR_RESEND_OR_EMAIL_API_KEY',
  'MY_EMAIL_API_KEY',
  'YOUR_EMAILJS_SERVICE_ID',
  'YOUR_EMAILJS_TEMPLATE_ID',
  'YOUR_EMAILJS_PUBLIC_KEY',
  'YOUR_EMAILJS_PRIVATE_KEY',
]);

function isPresent(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed)) return '';
  return trimmed;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVerificationEmailContent(params: {
  fullName: string;
  to: string;
  verifyUrl: string;
  expiresHours: number;
}): OutboundAuthEmail {
  const safeName = escapeHtml(params.fullName);
  const safeUrl = escapeHtml(params.verifyUrl);
  return {
    to: params.to,
    recipientName: params.fullName,
    kind: 'verification',
    actionUrl: params.verifyUrl,
    subject: 'Verify your Nextrade AI account email',
    text: [
      `Hello ${params.fullName},`,
      '',
      'Welcome to Nextrade AI. Confirm your email address using the link below to activate your browser workspace account:',
      params.verifyUrl,
      '',
      `This verification link expires in ${params.expiresHours} hours and can only be used once.`,
      'If you did not register a Nextrade AI account, you can safely ignore this message.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#080B12;">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8F2;border-radius:12px;padding:32px;">
      <div style="font-weight:700;font-size:14px;letter-spacing:0.08em;color:#080B12;margin-bottom:20px;">NEXTRADE AI</div>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#080B12;">Verify your email address</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#667085;">
        Hello ${safeName}, confirm your email address to activate your Nextrade AI account and access your authenticated workspace.
      </p>
      <p style="margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#2D46E6;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:13px;padding:12px 22px;border-radius:6px;">
          Verify Email Address
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#667085;">
        Or copy and paste this URL into your browser:<br />
        <span style="word-break:break-all;color:#080B12;">${safeUrl}</span>
      </p>
      <hr style="border:none;border-top:1px solid #E4E8F2;margin:24px 0;" />
      <p style="margin:0;font-size:11px;line-height:1.6;color:#667085;">
        This single-use link expires in ${params.expiresHours} hours. If you did not sign up for Nextrade AI, disregard this message.
      </p>
    </div>
  </body>
</html>`,
  };
}

export function buildPasswordResetEmailContent(params: {
  fullName: string;
  to: string;
  resetUrl: string;
  expiresMinutes: number;
}): OutboundAuthEmail {
  const safeName = escapeHtml(params.fullName);
  const safeUrl = escapeHtml(params.resetUrl);
  return {
    to: params.to,
    recipientName: params.fullName,
    kind: 'password-reset',
    actionUrl: params.resetUrl,
    subject: 'Reset your Nextrade AI password',
    text: [
      `Hello ${params.fullName},`,
      '',
      'We received a request to reset your Nextrade AI account password. Open the single-use link below to choose a new password:',
      params.resetUrl,
      '',
      `This reset link expires in ${params.expiresMinutes} minutes. Completing a password reset automatically revokes all existing active sessions.`,
      'If you did not request a password reset, you can safely ignore this message and your password will remain unchanged.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#080B12;">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8F2;border-radius:12px;padding:32px;">
      <div style="font-weight:700;font-size:14px;letter-spacing:0.08em;color:#080B12;margin-bottom:20px;">NEXTRADE AI</div>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#080B12;">Reset your password</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#667085;">
        Hello ${safeName}, use the button below to set a new password for your Nextrade AI account. For your security, resetting your password revokes all active sessions.
      </p>
      <p style="margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#2D46E6;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:13px;padding:12px 22px;border-radius:6px;">
          Choose New Password
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#667085;">
        Or copy and paste this URL into your browser:<br />
        <span style="word-break:break-all;color:#080B12;">${safeUrl}</span>
      </p>
      <hr style="border:none;border-top:1px solid #E4E8F2;margin:24px 0;" />
      <p style="margin:0;font-size:11px;line-height:1.6;color:#667085;">
        This single-use link expires in ${params.expiresMinutes} minutes. If you did not request a password reset, no changes have been made.
      </p>
    </div>
  </body>
</html>`,
  };
}

export function buildSecurityNotificationEmailContent(params: {
  fullName: string;
  to: string;
  eventSummary: string;
  occurredAtIso: string;
}): OutboundAuthEmail {
  const safeName = escapeHtml(params.fullName);
  const safeSummary = escapeHtml(params.eventSummary);
  return {
    to: params.to,
    recipientName: params.fullName,
    kind: 'security-notice',
    subject: 'Nextrade AI account security notice',
    text: [
      `Hello ${params.fullName},`,
      '',
      `Security event recorded on your Nextrade AI account (${params.occurredAtIso}):`,
      params.eventSummary,
      '',
      'All previously active sessions were signed out. If you did not perform this action, please reset your password immediately.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#080B12;">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E8F2;border-radius:12px;padding:32px;">
      <div style="font-weight:700;font-size:14px;letter-spacing:0.08em;color:#080B12;margin-bottom:20px;">NEXTRADE AI</div>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.25;color:#080B12;">Account security update</h1>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#667085;">
        Hello ${safeName}, a security change occurred on your account at <strong style="color:#080B12;">${escapeHtml(params.occurredAtIso)}</strong>:
      </p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#080B12;background:#F7F8FA;border:1px solid #E4E8F2;border-radius:8px;padding:12px 14px;">
        ${safeSummary}
      </p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#667085;">
        If you did not initiate this change, reset your password immediately from the login screen.
      </p>
    </div>
  </body>
</html>`,
  };
}

function resolveEmailConfig() {
  const rawProvider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();

  const emailjsServiceId = isPresent(process.env.EMAILJS_SERVICE_ID);
  const emailjsTemplateId = isPresent(process.env.EMAILJS_TEMPLATE_ID);
  const emailjsResetTemplateId = isPresent(process.env.EMAILJS_RESET_TEMPLATE_ID) || emailjsTemplateId;
  const emailjsSecurityTemplateId =
    isPresent(process.env.EMAILJS_SECURITY_TEMPLATE_ID) || emailjsTemplateId;
  const emailjsPublicKey = isPresent(process.env.EMAILJS_PUBLIC_KEY || process.env.EMAILJS_USER_ID);
  const emailjsPrivateKey = isPresent(process.env.EMAILJS_PRIVATE_KEY);
  const emailjsReady = Boolean(emailjsServiceId && emailjsTemplateId && emailjsPublicKey);

  const resendApiKey = isPresent(process.env.EMAIL_API_KEY || process.env.RESEND_API_KEY);
  const resendFromEmail = isPresent(process.env.EMAIL_FROM);
  const resendFromName = (process.env.EMAIL_FROM_NAME || 'Nextrade AI').trim();
  const resendReady = Boolean(resendApiKey && resendFromEmail);

  // Explicit provider or auto-detect from populated keys
  const activeProvider =
    rawProvider ||
    (emailjsReady ? 'emailjs' : resendReady ? 'resend' : 'unconfigured');

  return {
    activeProvider,
    emailjs: {
      ready: emailjsReady,
      serviceId: emailjsServiceId,
      templateId: emailjsTemplateId,
      resetTemplateId: emailjsResetTemplateId,
      securityTemplateId: emailjsSecurityTemplateId,
      publicKey: emailjsPublicKey,
      privateKey: emailjsPrivateKey,
    },
    resend: {
      ready: resendReady,
      apiKey: resendApiKey,
      fromEmail: resendFromEmail,
      fromName: resendFromName,
    },
  };
}

async function sendViaEmailJs(
  cfg: ReturnType<typeof resolveEmailConfig>['emailjs'],
  email: OutboundAuthEmail,
): Promise<EmailDeliveryResult> {
  const templateId =
    email.kind === 'password-reset'
      ? cfg.resetTemplateId
      : email.kind === 'security-notice'
        ? cfg.securityTemplateId
        : cfg.templateId;

  const recipientName = email.recipientName || email.to.split('@')[0] || 'Trader';

  const body: Record<string, unknown> = {
    service_id: cfg.serviceId,
    template_id: templateId,
    user_id: cfg.publicKey,
    template_params: {
      to_email: email.to,
      email: email.to,
      to_name: recipientName,
      user_name: recipientName,
      subject: email.subject,
      action_url: email.actionUrl ?? '',
      link: email.actionUrl ?? '',
      verify_url: email.kind === 'verification' ? email.actionUrl ?? '' : '',
      reset_url: email.kind === 'password-reset' ? email.actionUrl ?? '' : '',
      message: email.text,
      html_message: email.html,
      email_kind: email.kind,
      app_name: 'Nextrade AI',
    },
  };

  if (cfg.privateKey) {
    body.accessToken = cfg.privateKey;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const textBody = (await response.text().catch(() => '')).trim();
      if (!response.ok) {
        return {
          delivered: false,
          mode: 'provider',
          provider: 'emailjs',
          error: textBody || `EmailJS returned HTTP ${response.status}.`,
        };
      }

      return {
        delivered: true,
        mode: 'provider',
        provider: 'emailjs',
        messageId: textBody || 'emailjs-ok',
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      delivered: false,
      mode: 'provider',
      provider: 'emailjs',
      error: err instanceof Error ? err.message : 'EmailJS request failed.',
    };
  }
}

async function sendViaResend(
  cfg: ReturnType<typeof resolveEmailConfig>['resend'],
  email: OutboundAuthEmail,
): Promise<EmailDeliveryResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${cfg.fromName} <${cfg.fromEmail}>`,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!response.ok) {
        return {
          delivered: false,
          mode: 'provider',
          provider: 'resend',
          error: payload.message || `Email provider returned HTTP ${response.status}.`,
        };
      }
      return {
        delivered: true,
        mode: 'provider',
        provider: 'resend',
        messageId: payload.id,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      delivered: false,
      mode: 'provider',
      provider: 'resend',
      error: err instanceof Error ? err.message : 'Email provider request failed.',
    };
  }
}

export function createAuthEmailSender(): AuthEmailSender {
  const isConfigured = () => {
    const cfg = resolveEmailConfig();
    if (cfg.activeProvider === 'emailjs') return cfg.emailjs.ready;
    if (cfg.activeProvider === 'resend') return cfg.resend.ready;
    return false;
  };

  const getProviderName = () => {
    const cfg = resolveEmailConfig();
    if (cfg.activeProvider === 'emailjs' && cfg.emailjs.ready) return 'emailjs';
    if (cfg.activeProvider === 'resend' && cfg.resend.ready) return 'resend';
    return 'unconfigured';
  };

  const send = async (email: OutboundAuthEmail): Promise<EmailDeliveryResult> => {
    const cfg = resolveEmailConfig();

    if (cfg.activeProvider === 'emailjs' && cfg.emailjs.ready) {
      return sendViaEmailJs(cfg.emailjs, email);
    }
    if (cfg.activeProvider === 'resend' && cfg.resend.ready) {
      return sendViaResend(cfg.resend, email);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const allowDevOutbox = !isProduction && process.env.AUTH_DEV_OUTBOX === 'true';

    if (allowDevOutbox) {
      try {
        const outboxDir = path.join(PROJECT_ROOT, '.data', 'dev-email-outbox');
        fs.mkdirSync(outboxDir, { recursive: true });
        const fileId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        fs.writeFileSync(
          path.join(outboxDir, `${fileId}.json`),
          JSON.stringify(
            {
              recordedAt: new Date().toISOString(),
              to: email.to,
              kind: email.kind,
              subject: email.subject,
              text: email.text,
            },
            null,
            2,
          ),
          'utf8',
        );
        return {
          delivered: false,
          mode: 'dev-outbox',
          provider: 'unconfigured',
        };
      } catch {
        return {
          delivered: false,
          mode: 'unconfigured',
          provider: 'unconfigured',
        };
      }
    }

    return {
      delivered: false,
      mode: 'unconfigured',
      provider: 'unconfigured',
    };
  };

  return {
    isConfigured,
    getProviderName,
    send,
  };
}
