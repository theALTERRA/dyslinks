const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
}

const {
  buildVerificationEmail,
  buildChangeEmail,
  buildResetPasswordEmail,
  buildReportEmail,
  buildEmailChangedNotice
} = require("../mail");

const GITHUB_URL = "https://github.com/theALTERRA/dyslinks";

test("verification email renders dynamic site name, domain, token, and GitHub footer", () => {
  const email = buildVerificationEmail(
    { verification_token: "7b92f4e8-test-token" },
    { siteName: "MyShortener", domain: "links.example.com" }
  );

  assert.equal(email.subject, "Verify your account");
  assert.match(email.html, /MyShortener/);
  assert.match(email.html, /Verify your <span style="color:#8b5cf6;">email address\.<\/span>/);
  assert.match(email.html, /Thanks for creating an account on links\.example\.com\./);
  assert.match(email.html, /href="https:\/\/links\.example\.com\/verify\/7b92f4e8-test-token"/);
  assert.match(email.html, />links\.example\.com\/verify\/7b92f4e8-test-token<\/a>/);
  assert.match(email.html, /Verify account/);
  assert.match(email.html, new RegExp(`href="${GITHUB_URL}"[\\s\\S]*Powered by Dyslinks`));
  assert.doesNotMatch(email.html, /{{[^}]+}}/);

  assert.match(email.text, /links\.example\.com/);
  assert.match(email.text, /https:\/\/links\.example\.com\/verify\/7b92f4e8-test-token/);
});

test("change email template renders dynamic domain and verify-email URL", () => {
  const email = buildChangeEmail(
    { change_email_token: "chg-token-123" },
    { siteName: "BrandX", domain: "go.brandx.io" }
  );

  assert.equal(email.subject, "Verify your new email address");
  assert.match(email.html, /BrandX/);
  assert.match(email.html, /go\.brandx\.io/);
  assert.match(email.html, /href="https:\/\/go\.brandx\.io\/verify-email\/chg-token-123"/);
  assert.match(email.html, />go\.brandx\.io\/verify-email\/chg-token-123<\/a>/);
  assert.match(email.html, /Verify email/);
  assert.match(email.html, /Powered by Dyslinks/);
  assert.doesNotMatch(email.html, /{{[^}]+}}/);
});

test("reset password email renders dynamic reset URL and button", () => {
  const email = buildResetPasswordEmail(
    { reset_password_token: "rst-token-456" },
    { siteName: "Dyslinks", domain: "links.dystonet.com" }
  );

  assert.equal(email.subject, "Reset your password");
  assert.match(email.html, /Reset your <span style="color:#8b5cf6;">password\.<\/span>/);
  assert.match(email.html, /href="https:\/\/links\.dystonet\.com\/reset-password\/rst-token-456"/);
  assert.match(email.html, />links\.dystonet\.com\/reset-password\/rst-token-456<\/a>/);
  assert.match(email.html, /Reset password/);
  assert.doesNotMatch(email.html, /{{[^}]+}}/);
});

test("email changed notice and abuse report use the redesigned layout and escape HTML", () => {
  const notice = buildEmailChangedNotice("user+new@example.com", {
    siteName: `Acme <script>alert(1)</script>`,
    domain: "short.acme.test"
  });

  assert.match(notice.html, /Acme &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(notice.html, /<script>/);
  assert.match(notice.html, /user\+new@example\.com/);
  assert.match(notice.html, /Powered by Dyslinks/);
  assert.doesNotMatch(notice.html, /{{[^}]+}}/);

  const report = buildReportEmail(`https://evil.example/?x=<img src=x>`, {
    siteName: "Dyslinks",
    domain: "links.dystonet.com"
  });

  assert.equal(report.subject, "[REPORT]");
  assert.match(report.html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(report.html, /<img src=x>/);
  assert.match(report.html, /Powered by Dyslinks/);
  assert.doesNotMatch(report.html, /{{[^}]+}}/);
});

test("local domains use http:// and strip redundant protocol or trailing slashes", () => {
  const local = buildVerificationEmail(
    { verification_token: "abc123" },
    { siteName: "Dyslinks", domain: "localhost:3000/" }
  );
  assert.match(local.html, /href="http:\/\/localhost:3000\/verify\/abc123"/);
  assert.match(local.html, /Thanks for creating an account on localhost:3000\./);

  const stripped = buildVerificationEmail(
    { verification_token: "abc123" },
    { siteName: "Dyslinks", domain: "https://links.dystonet.com/" }
  );
  assert.match(stripped.html, /href="https:\/\/links\.dystonet\.com\/verify\/abc123"/);
  assert.match(stripped.html, /Thanks for creating an account on links\.dystonet\.com\./);
});
