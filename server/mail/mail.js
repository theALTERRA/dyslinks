const nodemailer = require("nodemailer");
const path = require("node:path");
const fs = require("node:fs");

const { resetMailText, verifyMailText, changeEmailText } = require("./text");
const { CustomError, escapeHtml, isLocalDomain } = require("../utils");
const env = require("../env");

const mailConfig = {
  host: env.MAIL_HOST,
  port: env.MAIL_PORT,
  secure: env.MAIL_SECURE,
  auth: env.MAIL_USER
    ? {
        user: env.MAIL_USER,
        pass: env.MAIL_PASSWORD
      }
    : undefined
};

const transporter = nodemailer.createTransport(mailConfig);

const baseTemplatePath = path.join(__dirname, "template.html");
const baseTemplate = fs.readFileSync(baseTemplatePath, { encoding: "utf-8" });

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace";

function resolveSiteMeta(overrides = {}) {
  const rawDomain = overrides.domain ?? env.DEFAULT_DOMAIN;
  const cleanDomain = String(rawDomain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const explicitProtocolMatch = String(rawDomain || "").trim().match(/^(https?):\/\//i);
  const protocol = explicitProtocolMatch
    ? `${explicitProtocolMatch[1].toLowerCase()}://`
    : (!env.isDev && !isLocalDomain(cleanDomain) ? "https://" : "http://");
  const siteUrl = `${protocol}${cleanDomain}`;
  const siteName = overrides.siteName ?? env.SITE_NAME;
  return { cleanDomain, siteUrl, siteName };
}

function renderActionBlock({ buttonLabel, actionUrl, displayUrl }) {
  if (!buttonLabel || !actionUrl) return "";

  const safeLabel = escapeHtml(buttonLabel);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeDisplayUrl = escapeHtml(displayUrl || actionUrl);

  return `
            <tr>
              <td align="center" class="email-card-pad" style="padding:0 44px 36px 44px;">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeActionUrl}" style="height:46px;v-text-anchor:middle;width:210px;" arcsize="50%" strokecolor="#7c3aed" fillcolor="#7c3aed">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:${FONT_STACK};font-size:15px;font-weight:600;">${safeLabel}</center>
                </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-->
                <a href="${safeActionUrl}" target="_blank" rel="noopener noreferrer" class="email-cta" style="display:inline-block;background-color:#7c3aed;color:#ffffff;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:1;text-decoration:none;text-align:center;padding:15px 38px;border-radius:9999px;-webkit-text-size-adjust:none;">${safeLabel}</a>
                <!--<![endif]-->
              </td>
            </tr>

            <tr>
              <td align="center" class="email-card-pad" style="padding:0 44px 8px 44px;">
                <p style="margin:0 0 8px 0;font-family:${FONT_STACK};font-size:13px;font-weight:400;line-height:1.6;color:#8e8e9a;text-align:center;">
                  If the button doesn&apos;t work, copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-family:${FONT_STACK};font-size:13px;font-weight:400;line-height:1.6;text-align:center;word-break:break-all;overflow-wrap:anywhere;">
                  <a href="${safeActionUrl}" target="_blank" rel="noopener noreferrer" style="color:#8b5cf6;text-decoration:none;word-break:break-all;overflow-wrap:anywhere;">${safeDisplayUrl}</a>
                </p>
              </td>
            </tr>`;
}

function renderDetailBlock(detailText) {
  if (!detailText) return "";

  const safeDetail = escapeHtml(detailText);
  return `
            <tr>
              <td align="center" class="email-card-pad" style="padding:0 44px 8px 44px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#141419" style="width:100%;background-color:#141419;border:1px solid #222229;border-radius:10px;border-collapse:separate;">
                  <tr>
                    <td align="center" style="padding:14px 18px;font-family:${MONO_STACK};font-size:13px;line-height:1.5;color:#e4e4e7;word-break:break-all;overflow-wrap:anywhere;">
                      ${safeDetail}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function renderEmailTemplate({
  title,
  preheader,
  headingPrefix,
  headingAccent,
  bodyHtml,
  buttonLabel,
  actionUrl,
  displayUrl,
  detailText,
  siteName,
  domain
}) {
  const meta = resolveSiteMeta({ siteName, domain });
  const headingParts = [];
  if (headingPrefix) {
    headingParts.push(escapeHtml(headingPrefix));
  }
  if (headingAccent) {
    headingParts.push(`<span style="color:#8b5cf6;">${escapeHtml(headingAccent)}</span>`);
  }

  const values = {
    title: escapeHtml(title || meta.siteName),
    preheader: escapeHtml(preheader || title || ""),
    site_url: escapeHtml(meta.siteUrl),
    site_name: escapeHtml(meta.siteName),
    heading_html: headingParts.join(" "),
    body_html: bodyHtml || "",
    action_block: renderActionBlock({ buttonLabel, actionUrl, displayUrl }),
    detail_block: renderDetailBlock(detailText)
  };

  return baseTemplate.replace(/{{(\w+)}}/g, (_, key) => values[key] ?? "");
}

function renderTextTemplate(template, replacements) {
  return template.replace(/{{(\w+)}}/g, (_, key) => replacements[key] ?? "");
}

function buildVerificationEmail(user, overrides = {}) {
  const meta = resolveSiteMeta(overrides);
  const encodedToken = encodeURIComponent(user.verification_token);
  const actionUrl = `${meta.siteUrl}/verify/${encodedToken}`;
  const displayUrl = `${meta.cleanDomain}/verify/${encodedToken}`;
  const safeDomain = escapeHtml(meta.cleanDomain);

  return {
    subject: "Verify your account",
    text: renderTextTemplate(verifyMailText, {
      verification: encodedToken,
      domain: meta.cleanDomain,
      site_name: meta.siteName,
      action_url: actionUrl
    }),
    html: renderEmailTemplate({
      title: "Verify your account",
      preheader: `Verify your email address to activate your ${meta.siteName} account.`,
      headingPrefix: "Verify your",
      headingAccent: "email address.",
      bodyHtml: `Thanks for creating an account on ${safeDomain}.<br />Please verify your email address using the button below.`,
      buttonLabel: "Verify account",
      actionUrl,
      displayUrl,
      siteName: meta.siteName,
      domain: overrides.domain
    })
  };
}

function buildChangeEmail(user, overrides = {}) {
  const meta = resolveSiteMeta(overrides);
  const encodedToken = encodeURIComponent(user.change_email_token);
  const actionUrl = `${meta.siteUrl}/verify-email/${encodedToken}`;
  const displayUrl = `${meta.cleanDomain}/verify-email/${encodedToken}`;
  const safeDomain = escapeHtml(meta.cleanDomain);

  return {
    subject: "Verify your new email address",
    text: renderTextTemplate(changeEmailText, {
      verification: encodedToken,
      domain: meta.cleanDomain,
      site_name: meta.siteName,
      action_url: actionUrl
    }),
    html: renderEmailTemplate({
      title: "Verify your new email address",
      preheader: `Confirm your new email address for your ${meta.siteName} account.`,
      headingPrefix: "Verify your",
      headingAccent: "new email.",
      bodyHtml: `You&apos;re attempting to change your email address on ${safeDomain}.<br />Please verify your new email address using the button below.`,
      buttonLabel: "Verify email",
      actionUrl,
      displayUrl,
      siteName: meta.siteName,
      domain: overrides.domain
    })
  };
}

function buildResetPasswordEmail(user, overrides = {}) {
  const meta = resolveSiteMeta(overrides);
  const encodedToken = encodeURIComponent(user.reset_password_token);
  const actionUrl = `${meta.siteUrl}/reset-password/${encodedToken}`;
  const displayUrl = `${meta.cleanDomain}/reset-password/${encodedToken}`;
  const safeDomain = escapeHtml(meta.cleanDomain);

  return {
    subject: "Reset your password",
    text: renderTextTemplate(resetMailText, {
      resetpassword: encodedToken,
      domain: meta.cleanDomain,
      site_name: meta.siteName,
      action_url: actionUrl
    }),
    html: renderEmailTemplate({
      title: "Reset your password",
      preheader: `Reset the password for your ${meta.siteName} account.`,
      headingPrefix: "Reset your",
      headingAccent: "password.",
      bodyHtml: `A password reset has been requested for your account on ${safeDomain}.<br />Please use the button below to reset your password. There&apos;s no need to take any action if you didn&apos;t request this.`,
      buttonLabel: "Reset password",
      actionUrl,
      displayUrl,
      siteName: meta.siteName,
      domain: overrides.domain
    })
  };
}

function buildReportEmail(link, overrides = {}) {
  const meta = resolveSiteMeta(overrides);
  const safeDomain = escapeHtml(meta.cleanDomain);

  return {
    subject: "[REPORT]",
    text: `Reported link: ${link}`,
    html: renderEmailTemplate({
      title: "[REPORT]",
      preheader: `A link was reported on ${meta.cleanDomain}.`,
      headingPrefix: "Reported",
      headingAccent: "link.",
      bodyHtml: `A link has been reported for review on ${safeDomain}.`,
      detailText: link,
      siteName: meta.siteName,
      domain: overrides.domain
    })
  };
}

function buildEmailChangedNotice(newEmail, overrides = {}) {
  const meta = resolveSiteMeta(overrides);
  const safeSiteName = escapeHtml(meta.siteName);
  const safeDomain = escapeHtml(meta.cleanDomain);
  const safeNewEmail = escapeHtml(newEmail);

  return {
    subject: `Your ${meta.siteName} email address was changed`,
    text: `Your ${meta.siteName} account email address was changed to ${newEmail}. If you did not make this change, contact your administrator immediately.`,
    html: renderEmailTemplate({
      title: `Your ${meta.siteName} email address was changed`,
      preheader: `Your ${meta.siteName} account email address was updated.`,
      headingPrefix: "Email address",
      headingAccent: "updated.",
      bodyHtml: `Your ${safeSiteName} account email address on ${safeDomain} was changed to <strong style="color:#f4f4f5;font-weight:600;">${safeNewEmail}</strong>.<br />If you did not make this change, contact your administrator immediately.`,
      siteName: meta.siteName,
      domain: overrides.domain
    })
  };
}

async function verification(user) {
  if (!env.MAIL_ENABLED) {
    throw new Error("Attempting to send verification email but email is not enabled.");
  }

  const email = buildVerificationEmail(user);
  const mail = await transporter.sendMail({
    from: env.MAIL_FROM || env.MAIL_USER,
    to: user.email,
    ...email
  });

  if (!mail.accepted.length) {
    throw new CustomError("Couldn't send verification email. Try again later.");
  }
}

async function changeEmail(user) {
  if (!env.MAIL_ENABLED) {
    throw new Error("Attempting to send change email token but email is not enabled.");
  }

  const email = buildChangeEmail(user);
  const mail = await transporter.sendMail({
    from: env.MAIL_FROM || env.MAIL_USER,
    to: user.change_email_address,
    ...email
  });

  if (!mail.accepted.length) {
    throw new CustomError("Couldn't send verification email. Try again later.");
  }
}

async function resetPasswordToken(user) {
  if (!env.MAIL_ENABLED) {
    throw new Error("Attempting to send reset password email but email is not enabled.");
  }

  const email = buildResetPasswordEmail(user);
  const mail = await transporter.sendMail({
    from: env.MAIL_FROM || env.MAIL_USER,
    to: user.email,
    ...email
  });

  if (!mail.accepted.length) {
    throw new CustomError(
      "Couldn't send reset password email. Try again later."
    );
  }
}

async function sendReportEmail(link) {
  if (!env.MAIL_ENABLED) {
    throw new Error("Attempting to send report email but email is not enabled.");
  }

  const email = buildReportEmail(link);
  const mail = await transporter.sendMail({
    from: env.MAIL_FROM || env.MAIL_USER,
    to: env.REPORT_EMAIL,
    ...email
  });

  if (!mail.accepted.length) {
    throw new CustomError("Couldn't submit the report. Try again later.");
  }
}

async function emailChangedNotice(oldEmail, newEmail) {
  if (!env.MAIL_ENABLED || !oldEmail) return;

  const email = buildEmailChangedNotice(newEmail);
  await transporter.sendMail({
    from: env.MAIL_FROM || env.MAIL_USER,
    to: oldEmail,
    ...email
  });
}

module.exports = {
  changeEmail,
  emailChangedNotice,
  verification,
  resetPasswordToken,
  sendReportEmail,
  renderEmailTemplate,
  buildVerificationEmail,
  buildChangeEmail,
  buildResetPasswordEmail,
  buildReportEmail,
  buildEmailChangedNotice
};
