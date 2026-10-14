# Connecting the free-guide sign-up to your newsletter

The sign-up form is in `index.html` (section `id="free"`). Its behaviour is controlled by one setting near the bottom of the file:

```js
const NEWSLETTER = { action: "", field: "email_address" };
```

## While `action` is empty (the Claude preview)
Sign-ups are saved privately to the preview page's own database (only you, the owner, can read them). Ask Claude to export them to CSV whenever you like, and import that CSV into your newsletter tool.

## When you host the site yourself (go-live)
1. Create a free account with a newsletter tool such as Kit (formerly ConvertKit), MailerLite or Beehiiv.
2. Create a form / sign-up page in the tool and open its **embed code** (choose "HTML" or "raw HTML").
3. Copy the form's `action="..."` URL into `NEWSLETTER.action`.
4. Copy the email input's `name="..."` into `NEWSLETTER.field` (Kit: `email_address`; MailerLite: `fields[email]`).
5. In the tool, turn on **double opt-in** and set the **incentive/welcome email** to deliver the free PDF
   `Is-It-Too-Late-Career-Change-Calculator.pdf` (upload it to the tool; it gives you a download link).
6. Optional: add a welcome sequence that introduces the paid guides.

The form already validates the email and requires the consent box before sending.
