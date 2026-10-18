# Resend + DNS setup for PickleMe sign-in emails

Sender: `PickleMe <signin@pickleme.doblados.net>` (dedicated subdomain; Google Workspace mail on doblados.net is untouched).
DNS host: Moniker (ns1–ns4.monikerdns.net). Resend region: Tokyo (ap-northeast-1).

## 1. Resend
1. Sign up at https://resend.com (free: 100 emails/day, 3,000/month).
2. Domains → Add domain → `pickleme.doblados.net`, region **Tokyo (ap-northeast-1)**.
3. Keep the DNS records page open.

## 2. Moniker DNS (doblados.net → Modify Domain Setup → DNS)
Enter names relative to doblados.net (do not type `.doblados.net`):

| Type | Name | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey.pickleme` | DKIM value copied from Resend (`p=MIGf...`) | — |
| MX | `send.pickleme` | `feedback-smtp.ap-northeast-1.amazonses.com` (add a trailing `.` if Moniker appends the domain) | 10 |
| TXT | `send.pickleme` | `v=spf1 include:amazonses.com ~all` (copy exactly from Resend) | — |
| TXT (optional, recommended) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:jon@doblados.net` | — |

Click **Apply now** after adding. Do not change the existing root MX/SPF (Google Workspace) or `mail` CNAME.
Then in Resend click **Verify DNS records** (usually minutes, up to a few hours).

## 3. Resend API key
API Keys → Create → permission **Sending access**, domain `pickleme.doblados.net`. Copy once; never commit or share it.

## 4. Supabase (project pickleme)
- Authentication → Emails → SMTP Settings → enable custom SMTP:
  sender email `signin@pickleme.doblados.net`, sender name `PickleMe`, host `smtp.resend.com`, port `465`,
  username `resend`, password = Resend API key. Save.
- Authentication → Rate Limits: emails per hour starts at 30; raise to ~60 for game nights if needed.
- Authentication → Email Templates → **Magic Link** and **Confirm signup**: subject `Your PickleMe sign-in link`,
  body = `supabase/templates/magic_link.html`.
- Authentication → URL Configuration: Site URL `https://jon.doblados.net/pickleme/`, Redirect URL `https://jon.doblados.net/pickleme/**`.

## 5. Test
Request a link for jon@doblados.net at https://jon.doblados.net/pickleme/, check delivery in Resend → Emails,
and confirm the link opens PickleMe (not localhost).
