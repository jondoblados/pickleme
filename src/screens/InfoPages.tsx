import type { ReactNode } from 'react'

export const PRIVACY_CONTACT = 'jon@doblados.net'
export const POLICY_UPDATED = '23 October 2026'

type Nav = (view: 'privacy' | 'faq') => void

/** Footer shown on every screen. Links keep any invite/game parameters so nothing is lost. */
export function Footer({ onNav, dark = false }: { onNav: Nav; dark?: boolean }) {
  const link = (view: 'privacy' | 'faq', label: string) => (
    <a href={`?view=${view}`} onClick={e => { e.preventDefault(); onNav(view) }}>{label}</a>
  )
  return (
    <footer className={`footer${dark ? ' footer-dark' : ''}`}>
      <nav aria-label="Help and legal">
        {link('faq', 'FAQ & guide')}
        <span aria-hidden="true">·</span>
        {link('privacy', 'Privacy Policy')}
      </nav>
      <p>PickleMe · pickleball game sign-ups</p>
    </footer>
  )
}

function Mail() {
  return <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>
}

export function PrivacyPolicy({ onNav }: { onNav: Nav }) {
  return (
    <article className="doc">
      <h1 className="display">Privacy Policy</h1>
      <p className="muted small">Last updated: {POLICY_UPDATED}</p>
      <p className="lede">The short version: we use your email to sign you in and your display name to show you on game lists.
        Other players never see your email. We don't sell your information or use it for advertising.</p>

      <h2>1. Who we are</h2>
      <p>PickleMe is a web app run by Jon Doblados to help pickleball groups organise games, manage sign-ups and keep waitlists.
        For privacy questions or requests, email <Mail />.</p>

      <h2>2. Information we collect</h2>
      <ul>
        <li><b>Email address</b> — to create your account and send you passwordless sign-in links.</li>
        <li><b>Display name</b> — the name other members of your group see on game lists.</li>
        <li><b>Group membership and role</b> — for example player, organiser or admin.</li>
        <li><b>Game sign-up records</b> — games you join, your playing or waitlist position, withdrawals, removals by an organiser, and when these happened.</li>
        <li><b>Attendance records</b> — whether an organiser marked you Present, No-show or Excused for a game you were on the playing list for, who marked it and when.</li>
        <li><b>Technical information</b> needed to run and secure the service, such as sign-in records, session information, error logs and security logs.</li>
      </ul>
      <p>PickleMe does not use passwords. Your email and account details are still personal information, and we treat them that way.</p>

      <h2>3. How we use it</h2>
      <ul>
        <li>Send sign-in links and keep you signed in.</li>
        <li>Manage group membership and what each role can do.</li>
        <li>Process sign-ups, withdrawals and waitlist positions.</li>
        <li>Show game lists to members of your group.</li>
        <li>Email you when you move from the waitlist into the playing list.</li>
        <li>Let organisers record attendance and review attendance and repeat no-show reports for their group, so places go to people who turn up.</li>
        <li>Investigate problems, prevent misuse and keep the service secure.</li>
        <li>Answer questions and privacy requests, and meet legal requirements.</li>
      </ul>
      <p>We don't use your email for marketing.</p>

      <h2>4. What other users can see</h2>
      <p>Members of your group can see your display name, your role, and your status in that group's games (playing or waitlist, and your position).
        Organisers can also remove a player from a game.</p>
      <p>Attendance records are visible only to that group's organisers and admins, not to other players. Organisers and admins can
        export attendance and repeat no-show reports for their group as spreadsheet (CSV) files; once exported, those files are their responsibility.</p>
      <p>Anyone who receives a game link (including a forwarded one) can sign in with a verified email and join that game's group in one step.
        Once they join, they become a group member and can see the group's game lists like any other member.</p>
      <p>Your email address is not shown to other players, organisers or admins anywhere in the app. Only the operator can see it,
        through the back-end systems used to run PickleMe, and only to operate and support the service.</p>
      <p>People outside your group can't see its games or player lists. If someone copies a list into WhatsApp or elsewhere,
        that copy is outside PickleMe — please respect other players' privacy when sharing.</p>

      <h2>5. Service providers</h2>
      <ul>
        <li><b>Supabase</b> — sign-in, database and back-end services (database hosted in Singapore).</li>
        <li><b>Resend</b> — delivers sign-in emails and waitlist emails.</li>
        <li><b>GitHub Pages</b> — hosts the web app.</li>
        <li><b>Google Fonts</b> — supplies the fonts the app displays, so your browser connects to Google when you open PickleMe.</li>
      </ul>
      <p>These providers only process what they need to deliver their service, such as your email address, sign-in data or technical request details
        (for example your IP address). We may also disclose information where the law requires or allows it.
        We do not sell your personal information or share it with advertisers.</p>

      <h2>6. Processing outside Singapore</h2>
      <p>Some providers may process or store information outside Singapore. Where Singapore's Personal Data Protection Act (PDPA) applies to
        such a transfer, we take appropriate steps so that your information gets protection comparable to the PDPA.</p>

      <h2>7. Browser storage</h2>
      <p>PickleMe stores your signed-in session in your browser and remembers the last email you used to sign in on that device.
        We don't use analytics, advertising trackers or advertising cookies.</p>
      <p>Signing out ends your session on that device. Clearing your browser data also removes it, but doesn't delete your PickleMe account.</p>

      <h2>8. How long we keep information</h2>
      <ul>
        <li><b>Account, profile and membership:</b> while you have an account. Deleted when you ask us to close it.</li>
        <li><b>Game sign-up history:</b> the app shows past games for 60 days. We keep identifiable sign-up records for up to 12 months after a game, then delete or anonymise them.</li>
        <li><b>Attendance records:</b> kept for up to 12 months after a game, then deleted or anonymised together with sign-up records.</li>
        <li><b>Security, audit and email-delivery records:</b> only as long as needed for security, troubleshooting and legal needs, in line with our providers' log retention.</li>
        <li><b>Backups:</b> deleted information may remain in restricted backups until those backups expire.</li>
      </ul>

      <h2>9. Your choices and requests</h2>
      <p>Email <Mail /> to:</p>
      <ul>
        <li>Ask what personal information we hold about you and how it has been used or disclosed.</li>
        <li>Correct inaccurate information (you can change your display name yourself under your profile).</li>
        <li>Withdraw consent for us to use your information.</li>
        <li>Close your account and delete your information.</li>
        <li>Raise a privacy concern or complaint.</li>
      </ul>
      <p>We may need to confirm your identity first. If you withdraw consent or close your account, you won't be able to sign in or sign up for games;
        we'll explain any information we have to keep and why.</p>

      <h2>10. Security</h2>
      <p>We use access controls, row-level security and authentication checks to protect your information. No online service can guarantee absolute security.
        Don't forward your sign-in links, and sign out on shared devices.</p>

      <h2>11. Changes to this policy</h2>
      <p>We'll publish any updates here with a new date. If we want to use your information for a new purpose, we'll tell you and ask for consent where required.</p>

      <p className="doc-foot muted small">Questions? See the <a href="?view=faq" onClick={e => { e.preventDefault(); onNav('faq') }}>FAQ</a> or email <Mail />.</p>
    </article>
  )
}

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="faq-item">
      <summary>{q}</summary>
      <div className="faq-answer">{children}</div>
    </details>
  )
}

export function Faq({ onNav }: { onNav: Nav }) {
  return (
    <article className="doc">
      <h1 className="display">FAQ & guide</h1>
      <p className="lede">Everything you need to sign up for games, manage the waitlist and, if you're an organiser, run your group.</p>

      <h2>Getting started</h2>
      <Q q="How do I sign in?">
        <p>Enter your email and tap <b>Email me a sign-in link</b>. Open the email and tap the link — no password needed.
          The link works once and expires after an hour.</p>
      </Q>
      <Q q="I didn't get the sign-in email.">
        <p>Wait a minute, then check your spam or promotions folder. You can request a new link after 60 seconds.
          If you see a message about the email limit, try again later or let an organiser know.</p>
      </Q>
      <Q q="The link says it has expired or was already used.">
        <p>Each link works only once. Go back to PickleMe and request a new one.</p>
      </Q>
      <Q q="I opened the link from WhatsApp and ended up in a different browser.">
        <p>That's fine — sign-in links work in whichever browser opens the email. Keep using that browser afterwards so you stay signed in.</p>
      </Q>
      <Q q="How do I join my group?">
        <p>The easiest way: open a game link shared in your WhatsApp group, sign in with your email, choose a display name, then tap
          <b>Join group &amp; game</b>. You're added to the group and to the game (or its waitlist, if it's full) in one step.
          An organiser's group invite link also works. If you're signed in but see no games, ask for a game or invite link.</p>
      </Q>
      <Q q="What name will other players see?">
        <p>The display name you choose the first time you sign in (up to 40 characters). Change it any time from the tab with your name.
          Your email is never shown to other players.</p>
      </Q>

      <h2>Signing up for games</h2>
      <Q q="How do I join a game?">
        <p>Tap a game on the <b>Games</b> tab (or open the game link from WhatsApp) and tap <b>Join game</b>.
          Your status shows as <b>You're playing — #n</b>.</p>
      </Q>
      <Q q="What happens when a game is full?">
        <p>The button changes to <b>Join waitlist</b> and you get a waitlist number. Places are first come, first served.</p>
      </Q>
      <Q q="How does the waitlist work?">
        <p>If someone withdraws, is removed, or the organiser adds more places, the next person on the waitlist moves into the playing list automatically.
          We email you when that happens, from games@pickleme.doblados.net.</p>
      </Q>
      <Q q="How do I drop out?">
        <p>Open the game and tap <b>Withdraw</b>, then tap again to confirm. Please withdraw as early as you can so the next person gets your place.
          You can withdraw until the game ends, even if registration is closed.</p>
      </Q>
      <Q q="If I withdraw and rejoin, do I keep my place?">
        <p>No. Rejoining puts you at the end of the list.</p>
      </Q>
      <Q q="Why can't I join?">
        <p>Either the organiser has closed registration, the game has already started, or it was cancelled. The game page shows which.</p>
      </Q>
      <Q q="Do the lists update by themselves?">
        <p>Yes. When you see <b>Live</b> at the bottom of a game, changes appear automatically. If it says reconnecting, the lists refresh when you return to the tab.</p>
      </Q>
      <Q q="Where are past games?">
        <p>Tap <b>Show past games</b> at the bottom of the Games tab to see games from the last 60 days.</p>
      </Q>
      <Q q="How do I share a game?">
        <p>On the game page use <b>Copy game link</b>, <b>Copy WhatsApp message</b> or <b>Open in WhatsApp</b>.
          Anyone with the link can sign in and join your group and the game, so share it only with your group.</p>
      </Q>

      <h2>For organisers</h2>
      <Q q="How do I create a game?">
        <p>On the Games tab tap <b>New game</b>. Details are pre-filled from the last game, one week later. Check the date, time, place and player limit,
          save, then share the link in WhatsApp.</p>
      </Q>
      <Q q="Can I change a game after posting it?">
        <p>Yes — open the game and tap <b>Edit game</b>. You can raise the player limit (waitlisted players move in automatically), but not lower it below the number already playing.</p>
      </Q>
      <Q q="What's the difference between closing and cancelling?">
        <p><b>Close registration</b> stops new sign-ups but still lets players withdraw; you can reopen it. <b>Cancel</b> is permanent.</p>
      </Q>
      <Q q="How do I remove a player?">
        <p>On the game page, tap <b>Remove</b> next to their name, then tap again to confirm. The next waitlisted player moves in and gets an email.</p>
      </Q>
      <Q q="Can I join a game that has already started?">
        <p>Yes, as long as a place is still free. Open the game (or the WhatsApp link) and tap <b>Join now</b>; sign-ups stay open until the game ends.
          Once a game has started there is no waitlist: if every place is taken, you can't join. Organisers can still close registration at any time.</p>
      </Q>
      <Q q="How do I take attendance?">
        <p>Open the game once it has started. In the <b>Playing</b> list, each name gets three buttons: ✓ <b>Present</b>, ⊖ <b>Excused</b> and ✕ <b>No-show</b>.
          Tap one to mark the player, or tap it again to clear it. Present and Excused work during the game; No-show unlocks once the game has ended.
          Anyone who was on the list at the start but withdrew later is shown underneath so you can still mark them.
          Late joiners are added to the list as Unmarked, so mark them the same way as everyone else.
          You can correct a mark later, and every change is logged. Waitlisted players are not included, and unmarked players are never counted as no-shows.</p>
      </Q>
      <Q q="How do I see attendance reports and repeat no-shows?">
        <p>In <b>Attendance reports</b> at the bottom of the game page, choose a date range (up to one year) and tap <b>Generate report</b>. You'll see each player's present, no-show, excused and unmarked counts,
          and a <b>Repeat no-shows</b> list of anyone at or above the threshold you set (2 by default). Each list can be exported as a CSV file.
          Cancelled games are excluded. Games played before this feature was added have no attendance records.</p>
      </Q>
      <Q q="How do I invite players?">
        <p>Go to <b>Members & invites</b> and create an invite link. While a link is active you can copy it again at any time with
          <b>Copy link</b> or <b>Copy WhatsApp message</b>. Links last 30 days and can be used up to 200 times, and you can turn a link off at any time.
          Under each link, <b>Joined with this link</b> shows who joined with it and when; <b>Joined from a game link</b> lists people who joined from a shared game.
          Links created before 23 October 2026 can't be copied again; create a new one instead.</p>
      </Q>
      <Q q="Can I delete a game?">
        <p>Only group admins can, and only once a game has been cancelled. Open the cancelled game and tap <b>Delete game</b> under
          Admin tools, then tap again to confirm. This permanently removes the game and its sign-up history and can't be undone.</p>
      </Q>
      <Q q="Can I change the group name?">
        <p>Group admins can. Go to <b>Members & invites</b>, edit <b>Group name</b> and tap <b>Save name</b>. Everyone in the group sees the new name straight away.
          Invite links and game links keep working.</p>
      </Q>
      <Q q="Who can make someone an organiser?">
        <p>Admins can set a member's role to Player, Organiser or Admin on the Members page. Organisers can create, edit, close and cancel games and remove sign-ups.</p>
      </Q>

      <h2>Privacy and your account</h2>
      <Q q="Who can see my email address?">
        <p>No other player, organiser or admin can see it in the app. It's used only to sign you in and send game emails.</p>
      </Q>
      <Q q="How do I sign out or delete my account?">
        <p>Sign out from the tab with your name. To close your account and delete your information, email <Mail />.</p>
      </Q>
      <Q q="Where can I read the full privacy policy?">
        <p>See our <a href="?view=privacy" onClick={e => { e.preventDefault(); onNav('privacy') }}>Privacy Policy</a>.</p>
      </Q>
    </article>
  )
}
