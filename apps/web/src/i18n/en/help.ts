import type fr from '../fr/help';
import type { Translation } from '../types';

export default {
  nav: 'Help',
  title: 'Help',
  subtitle: 'User guides by role and a guided tour of the app.',
  startTour: 'Start the guided tour',
  tourHint: 'About 2 minutes: the tour shows where everything is, screen by screen.',
  chooseRole: 'Guide for',
  roles: {
    prepose: 'Care attendant',
    infirmiere: 'Nurse',
    responsable: 'Manager',
    admin: 'Platform administration',
  },
  general: {
    title: 'For everyone',
    install: {
      title: 'Install the app on a phone',
      body: 'iPhone and iPad: open the address in Safari, tap Share, then “Add to Home Screen”.\nAndroid: open the address in Chrome, menu ⋮, then “Install app”.\nAfterwards, always open the app from its icon.',
    },
    notifications: {
      title: 'Get notifications',
      body: 'My profile › Notifications › “Turn on for this device”, then accept the phone’s prompt.\nA notification never shows a resident’s name or the text of a message: you have to open the app.\nOn iPhone, only once the app has been added to the Home Screen.',
    },
    shared: {
      title: 'Shared computer or tablet at the station',
      body: 'Check “Shared device” when signing in.\nThe session closes after 15 minutes without activity, and when the browser is closed.\nAlways sign out when you leave.',
    },
    privacy: {
      title: 'Privacy (Quebec Law 25)',
      body: 'Only record what is useful for the resident’s care and safety.\nEvery time a file is viewed, it is written to the audit log.\nNothing is deleted: a note is corrected or cancelled with a reason, and the history stays.',
    },
    language: {
      title: 'Language and appearance',
      body: 'My profile › Appearance: French or English, light or dark theme.',
    },
  },
  guides: {
    prepose: {
      intro: 'Your day: read the handover when you arrive, record what happens, take care of follow-ups.',
      handover: {
        title: 'At the start of a shift: the handover',
        body: 'Open the Handover tab: what happened since your last handover.\nRead each priority instruction and tap “I’ve read this instruction”.\nConfirm management announcements (“I’ve read this announcement”).\nTap “I’ve reviewed the handover”: ordinary notes are marked as read.',
      },
      notes: {
        title: 'Write a note',
        body: 'Journal › “New note”: resident, category, what happened and what you did.\nThe microphone lets you dictate instead of typing.\nYou can correct your note for 24 hours; the previous version is kept.',
      },
      followUps: {
        title: 'Follow-ups',
        body: 'Follow-ups: actions to take that come from a note.\n“I’ll take it” to take a team follow-up, “Mark done” when it is settled (a short closing note helps the next shift).\nAn overdue follow-up shows in red.',
      },
      messages: {
        title: 'Messages',
        body: 'Private messages, groups, the whole-team thread and announcements.\nA message can be edited or withdrawn for 15 minutes; nothing is deleted.\nDo not write there what belongs in a resident’s file: the journal is the record.',
      },
      agenda: {
        title: 'Agenda and schedule',
        body: 'Agenda: residents’ appointments and activities; those in the next 24 hours appear in the handover.\nSchedule: your shifts for the week.\nOn a phone, both pages are in the “More” menu.',
      },
      residents: {
        title: 'Residents',
        body: 'Each resident’s file: room, emergency contact, special instructions, and their notes.',
      },
    },
    infirmiere: {
      intro: 'On top of the team’s work: priority instructions, corrections, managing residents.',
      priority: {
        title: 'Priority instructions',
        body: 'Check “Priority” when writing a note: each employee will have to confirm it one by one at their handover.\nEmployees on shift get a notification.\nAn instruction corrected in substance must be read again by everyone.',
      },
      corrections: {
        title: 'Correct or cancel a note',
        body: 'You can correct any note, at any time; every version is kept.\nCancelling a note requires a reason; it stays visible, struck through.',
      },
      residents: {
        title: 'Manage residents',
        body: 'Residents › “Add a resident”; edit a file; record a departure.\nRestricted notes: visible only to the nurse and the manager.\nA resident’s statistics: trends by month or by year (falls, sleep…).',
      },
      announcements: {
        title: 'Announcements',
        body: 'Messages › Announcements: post an instruction for the whole team.\nEveryone confirms reading it; “Read by N — see who’s missing”.',
      },
    },
    responsable: {
      intro: 'On top of everything the nurse does: the team, the residence’s settings and compliance.',
      security: {
        title: 'Two-factor authentication',
        body: 'Required for your account: a code from your authenticator app at each sign-in.\nKeep your backup codes somewhere safe; new ones can be generated in My profile.\nLost phone and codes: the platform administration resets your two-factor authentication.',
      },
      team: {
        title: 'The team',
        body: 'Admin › Team › “Invite an employee”: they get an email and choose their own password.\nChange a role; deactivate an account (their sessions close immediately).',
      },
      settings: {
        title: 'Residence settings',
        body: 'Admin › Categories: note categories.\nAdmin › Shifts: shift types (day, evening, night…).\nSchedule: place the team’s shifts, week by week.',
      },
      compliance: {
        title: 'Compliance and complaints',
        body: 'Admin › Audit log: who viewed or changed what.\nFull export of a resident’s file (Law 25) from their file.\nAdmin › Messaging: view a conversation in case of a complaint, with a reason (logged).',
      },
      features: {
        title: 'The residence’s features',
        body: 'Admin › Features: what each role sees and can do, and exceptions for a person (also shown in Team).\nThese settings are part of the plan agreed with your residence: to change them, write to the platform administration. You’re notified by email of each change.\nChanging an employee’s role removes their exceptions.',
      },
      assistance: {
        title: 'Assistance access',
        body: 'Admin › Assistance: let the platform team view the residence to fix a problem.\nLimited time, read-only, messaging excluded; every page viewed is written to the log. Can be withdrawn at any time.',
      },
    },
    admin: {
      intro: 'You manage residences and their managers, never a residence’s content.',
      residences: {
        title: 'Residences',
        body: 'Residences › “New residence”: name, type, time zone, and its manager (invited by email).\nA residence’s page: edit, suspend with a reason (sessions closed, data kept), reactivate.\nManagers: invite, promote an employee, resend the invitation, password link, reset two-factor authentication.',
      },
      features: {
        title: 'A residence’s features',
        body: 'A residence’s page › Features tab: what each role sees and can do. Hidden: the page disappears; View only: read without writing; Full: everything.\nStart with a plan (Complete, Essential, Nurse-kept journal), then adjust cell by cell: it becomes “Custom”.\nA setting never gives more than the role (“— (role)”); a module another one depends on is flagged before saving (no Journal, no Handover).\nExceptions for a person: a different level for one employee, with a reason; removed automatically if their role changes.\nNothing is deleted: turning a module back on brings its data back. Every change is logged and the manager gets an email; it applies within a minute.',
      },
      security: {
        title: 'Security',
        body: 'Locked accounts to unlock, refused sign-ins, suspicious events.\nEmail sending: check the setup with a test email.',
      },
      audit: {
        title: 'Platform log',
        body: 'All administrators’ actions; they also appear in the log of the residence concerned.',
      },
      assistance: {
        title: 'Help a residence',
        body: 'Only if its manager grants you assistance access: “View (read-only)” on the dashboard.\nAn orange banner shows the rules; “End access” when you leave.',
      },
      admins: {
        title: 'Administrators',
        body: 'Invite another administrator; never deactivate yourself.\nLast resort (last admin without their phone): npm run mfa:reset on the server.',
      },
    },
  },
  tour: {
    progress: '{{n}} of {{total}}',
    next: 'Next',
    prev: 'Back',
    skip: 'Leave the tour',
    finish: 'Finish',
    dialog: 'Guided tour',
    offer: {
      title: 'First time here?',
      body: 'A 2-minute guided tour shows where everything is.',
      start: 'Start',
      later: 'Later',
    },
    steps: {
      welcome: { title: 'Welcome to the Logbook', body: 'Here is a short tour of the app. You can leave it at any time and start it again from the Help page.' },
      handoverTab: { title: 'The handover', body: 'Your starting point every shift: what happened since your last handover. The badge shows unread notes.' },
      handoverAck: { title: 'I’ve reviewed the handover', body: 'Once you have read it, confirm here. Priority instructions are confirmed one by one first.' },
      journalNew: { title: 'Write a note', body: 'Resident, category, what happened and what you did. The microphone lets you dictate the note.' },
      priority: { title: 'Priority instruction', body: 'When writing a note, check “Priority”: each employee will have to confirm it, and the team on shift gets a notification.' },
      followUps: { title: 'Follow-ups', body: 'Actions to take that come from notes. “I’ll take it” to take one, “Mark done” when it is settled.' },
      messages: { title: 'Messages', body: 'Private messages, groups, the team thread and management announcements to confirm.' },
      agenda: { title: 'Agenda and schedule', body: 'Residents’ appointments and your work shifts. On a phone: in the “More” menu.' },
      residents: { title: 'Residents', body: 'Each resident’s file: room, emergency contact, special instructions and their notes.' },
      residentsSupervisor: { title: 'Manage residents', body: 'Add a resident, edit a file, read restricted notes and see statistics (trends by month or by year).' },
      admin: { title: 'Administration', body: 'Invite employees, set categories and shifts, read the audit log. On a phone: in the “More” menu.' },
      teamInvite: { title: 'Invite an employee', body: 'They get an email and choose their own password. Nobody else knows it.' },
      assistance: { title: 'Assistance access', body: 'In the Assistance tab, you can let the platform team view the residence, for a limited time and read-only.' },
      profile: { title: 'My profile', body: 'Your photo or avatar, your password, the language, notifications on this phone and two-factor authentication. On a phone: in “More”.' },
      help: { title: 'Need help?', body: 'The guides by role are here, and you can restart this tour whenever you like. Enjoy!' },
      platformWelcome: { title: 'Welcome to the platform', body: 'You manage residences and their managers. A residence’s content only opens with its manager’s consent.' },
      platformNew: { title: 'New residence', body: 'Name, type, time zone and its manager: she gets an email invitation, then builds her team.' },
      platformSecurity: { title: 'Security', body: 'Locked accounts, refused sign-ins, and the test email to check that invitations are sent.' },
      platformAudit: { title: 'Platform log', body: 'Every administrator action is written here, and in the log of the residence concerned.' },
      platformAdmins: { title: 'Administrators', body: 'Invite another administrator. Each one sets up two-factor authentication at their first sign-in.' },
    },
  },
} satisfies Translation<typeof fr>;
