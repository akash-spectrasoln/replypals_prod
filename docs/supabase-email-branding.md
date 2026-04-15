# Supabase Auth Email Branding (ReplyPals)

Supabase sends signup/OTP/reset auth emails directly from Auth.  
That is why users currently receive `noreply@mail.app.supabase.io` templates.

To apply ReplyPals branding, update templates in:

- Supabase Dashboard -> `Authentication` -> `Email Templates`

---

## 1) Confirm Signup Template

Use this subject:

`Confirm your ReplyPals account`

Use this HTML body:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Confirm your ReplyPals account</title>
</head>
<body style="margin:0;padding:0;background:#F8F9FE;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FE;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#0F2544 0%,#1a3a6e 60%,#FF6B35 100%);border-radius:16px 16px 0 0;padding:28px 36px;text-align:center;">
            <span style="display:inline-block;width:44px;height:44px;background:#FF6B35;border-radius:50%;line-height:44px;font-size:20px;font-weight:900;color:#fff;">R</span>
            <h1 style="color:#fff;font-size:22px;font-weight:700;margin:12px 0 0;">ReplyPals</h1>
            <p style="color:rgba(255,255,255,0.75);font-size:13px;margin:4px 0 0;">Write better English. Sound more confident.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:36px;border-radius:0 0 16px 16px;">
            <h2 style="color:#0F2544;font-size:22px;font-weight:700;margin:0 0 8px;">Confirm your email</h2>
            <p style="color:#6B7280;font-size:15px;margin:0 0 20px;">
              Welcome to ReplyPals! Click the button below to verify your account and start using your free rewrites.
            </p>

            <a href="{{ .ConfirmationURL }}"
               style="display:inline-block;background:linear-gradient(135deg,#FF6B35,#FF8C42);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;">
              Confirm Email
            </a>

            <p style="color:#9CA3AF;font-size:12px;margin:20px 0 0;">
              If you didn’t request this, you can safely ignore this email.
            </p>
            <hr style="border:none;border-top:1px solid #EAECF4;margin:28px 0;">
            <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;line-height:1.8;">
              © 2026 ReplyPals<br>
              <a href="https://www.replypals.in" style="color:#FF6B35;text-decoration:none;">www.replypals.in</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

---

## 2) Magic Link / OTP Template (Optional but recommended)

Subject:

`Your ReplyPals sign-in link`

Button URL placeholder:

`{{ .ConfirmationURL }}`

You can reuse the same layout above and only change heading/body text.

---

## 3) Reset Password Template (Optional but recommended)

Subject:

`Reset your ReplyPals password`

Button URL placeholder:

`{{ .ConfirmationURL }}`

---

## 4) Sender Branding

To stop showing `mail.app.supabase.io`, configure custom SMTP in:

- Supabase Dashboard -> `Project Settings` -> `Authentication` -> `SMTP Settings`

Use your mailbox credentials (for example `support@replypals.in`) so sender and branding are fully ReplyPals.

If you keep default Supabase SMTP, only template content changes; sender domain stays Supabase.

