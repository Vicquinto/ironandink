// ─── What's New — platform changelog ─────────────────────────────────────────
//
// TO ADD A NEW ENTRY: add one object to the TOP of the WHATS_NEW array below
// (entries are shown newest-first, in array order — index 0 renders first).
// Each entry is:
//   {
//     date:  'Month D, YYYY',   // display string, shown as the entry heading date
//     title: 'Short title',     // shown beside the date
//     body:  `Paragraph text.`  // one or more paragraphs; blank lines separate them
//   }
//
// `body` is plain text. Separate paragraphs with a blank line (\n\n) — the
// renderer splits on blank lines and wraps each block in its own <p>. No HTML
// or markdown needed; text is escaped before rendering.
//
// The Dashboard panel automatically shows the most recent 2 entries; the full
// /whats-new page shows all of them. Nothing else needs to change.

const WHATS_NEW = [
  {
    date:  'October 11, 2026',
    title: 'Mark a Study Complete',
    body:  `When you've finished a study, you can now mark it complete. Every study has a "Mark complete" button at the top and at the end, beside Study with a Tutor, Study with a Teacher and Check my understanding. Your studies start out as "Studying", and only you decide when one is done. Change your mind? Undo puts it back to Studying.

After a Tutor or Teacher session, the review also asks, gently, whether you're ready to mark the study complete. It never marks anything for you.

A completed study shows a small check mark with the date it was completed in your Library and on your Study Map, and both now have an All / Studying / Completed filter. The Dashboard snapshot shows what you're currently studying. Now and then, a completed study is suggested to revisit, and a study you set aside a while ago is suggested to continue. The planner in Plan a Study knows which studies you've completed, too, so it can suggest what builds on them.`
  },
  {
    date:  'October 11, 2026',
    title: 'Your Study Map',
    body:  `There's a new page in the sidebar: Study Map. It gathers every study you've saved into one place, so you can find a past study and study it again. It's yours alone — no one else can see it — and it isn't a score: no points, no streaks, nothing to keep up with. It's simply a map of where you've been.

Look at it three ways. By area of theology — God, Christ, the Holy Spirit, Scripture, Man and Sin, Salvation, the Church, Last Things, Church History and Christian Living — with studies on the same subject kept together. By book of the Bible, showing which books and passages your studies center on. Or as a timeline, month by month. An area you haven't studied yet has a "Plan a study" link that opens Plan a Study with that area as the starting idea.

Every study has two links: open it, or have the Tutor check your understanding. A small Tutor or Teacher marker shows where you've already had a session. Now and then, an older study will be suggested to revisit — one at a time, and "Not now" puts it away.

Two gentle reminders, too. When you type a topic on the Study page that you've studied before, a short note lets you open your earlier study or create a new one anyway — your choice. And the planner in Plan a Study now knows when you studied what, so it can say "you studied this in March — revisit it, or go deeper?"

On the Dashboard, the Studies Saved count is now a small Study Map snapshot: your three most recent studies, the areas you've studied, and a study worth revisiting.`
  },
  {
    date:  'October 11, 2026',
    title: 'Plan a Study',
    body:  `Not sure exactly what to study? On the Study page, tap "Plan a Study" and talk it through first. A study partner opens beside the study creator and helps you turn a half-formed interest into a clear, well-scoped study — asking a question or two at a time and offering concrete suggestions as you go.

The planner knows every study type and level, recommends the ones that fit (and tells you why), and narrows a topic that's too big for one study — or lays out a short sequence of two to four studies when a subject needs more room. It also knows the titles in your Library, so it won't suggest something you've already studied and can point you to what builds on it.

When the plan is ready, tap "Build this study" — the study type, level and subject are filled into the study creator for you. Look it over and click Generate as usual. A planned sequence gets its own Build button for each study, and the ones you've already built are checked off, so it's easy to see what's next.

Building a study doesn't end the conversation — come back to it for the next study in your plan, or keep talking. It stays in your browser until you tap "Start fresh" (or for a week if you leave it), and nothing is saved to your Library.`
  },
  {
    date:  'October 10, 2026',
    title: 'Study with a Tutor — or a Teacher',
    body:  `Every study now comes with two patient guides. Open any study — your own, one in your Library, or one shared in the Community — and choose at the top. The study stays open on one side while you talk on the other, one question at a time.

Study with a Tutor walks you through the study section by section. Start wherever you are: "Tutor me on this section" beside each heading begins right there, and "Check my understanding" at the end of a study asks a few quick questions and then helps with anything you missed.

Study with a Teacher talks through the big questions behind the study. It opens with the question the whole study answers, then follows your questions wherever they lead — even back to an earlier chapter or across to another part of Scripture when that's what makes it click.

Either way, "I don't know" is always a welcome answer — you're taught, never graded — and quick replies let you ask for a hint, a simpler explanation, or a slower pace. Your Tutor and Teacher sessions save separately as you go, so you can pick up where you left off. When you finish, you'll see what you understand well, what's worth revisiting, and a suggested next study.`
  },
  {
    date:  'September 17, 2026',
    title: 'Writing, Reimagined',
    body:  `The Writing feature has been rebuilt from the ground up. Instead of filling out a form, you now sit down with a live writing companion — a real, flowing conversation that helps you find your idea, think it through, and shape it into something worth sharing. Choose how you want to work together: write it yourself with the companion as your thinking partner, build it together side by side, or have the companion draft it for you while you steer. Pull the companion's words into your draft whenever they're worth keeping.

New: Teaching Guides. A fourth kind of writing, built for anyone who leads a Bible study — at home, in a small group, or on camera. Build one from scratch for a room with open Bibles, or pull in one of your own studies (or a shared study from the Community) and the companion will write you a script built to guide your group through it, page by page.

New: Restyle a Finished Draft. Once you've written something, give it a different voice — Warmer, Encouraging, With Conviction, Call to Respond, More Lyrical, or Plainer — and preview the result before you decide to keep it. Change your mind? One click undoes it.

Never lose your work. The Writing feature now saves silently in the background as you type and converse — even a message you started but haven't sent yet.`
  },
  {
    date:  'September 17, 2026',
    title: 'A Safer Way to Manage Your Articles',
    body:  `Deleting an article no longer removes it instantly. It now moves to a "Ready for Permanent Deletion" area, where you can restore it or delete it for good — your choice, on your time.

Unpublish, anytime. If you spot something you'd like to revise in a published article, you can now pull it back off the Community board yourself — no need to wait on an admin. Your amens and comments are kept, so they're waiting for you when you resubmit.`
  },
  {
    date:  'September 17, 2026',
    title: 'Small Fixes That Matter',
    body:  `Fixed an issue where longer articles with an extended writing-companion conversation could fail to save. Save errors now always show a clear, helpful message. Fixed AI responses occasionally cutting off mid-sentence on longer pieces.`
  },
  {
    date:  'September 17, 2026',
    title: 'Writing That Sounds More Human',
    body:  `We've added foundational guidance that shapes how the AI writes across the whole platform — Study, Writing, and Devotional alike — cutting down on repetitive phrasing, robotic transitions, and over-hedged language, so what you read feels less like a machine and more like a person who means what they're saying.`
  },
  {
    date:  'August 8, 2026',
    title: 'Smoother sidebar navigation',
    body:  `The sidebar now moves as one — scroll it top to bottom in a single, gentle motion, with every page just a glance away. When there's more below the fold, a soft fade at the edge lets you know there's further to go.

A small refinement, but one that makes finding your way around Iron & Ink feel a little more effortless.`
  },
  {
    date:  'July 29, 2026',
    title: 'Children\'s studies are here',
    body: `For the children in your home, Study now offers a Children's telling. Choose "Children's" as your study level, and any passage becomes a warm, faithful story — written for ages six to ten, and told as a story rather than a study: no outlines or sections, just Scripture told simply and reverently, pointing to Jesus wherever the passage truly leads. Each one closes with a short "For grown-ups" note: a question to ask your child, and a little prayer to pray together. Read it at bedtime, or gather the family around it.`,
  },
  {
    date:  'July 28, 2026',
    title: 'A sharper focus for Live Study Rooms',
    body: `We've refined Live Study Rooms around one purpose: working through Scripture together. A host can bring in a study from the Community or your Library and lead the group through it, shared notes and tooltip cards stay with the room, and you can now see exactly who's in the room with you in real time.`,
  },
  {
    date:  'July 28, 2026',
    title: 'Where we stand on AI',
    body: `We've written a plain, pastoral account of how Iron & Ink uses AI — and the safeguards that keep Scripture itself untouched by it. You'll find it on the About page under "Where We Stand on AI." It's built for Bereans: test everything, hold fast to what is good. The tool serves the study; the study serves the soul.`,
  },
  {
    date:  'July 20, 2026',
    title: 'Book studies',
    body: `A new study type: Book. Give it a book of the Bible and it lays out the essentials — who wrote it, when and why, its structure, major themes, and the real debates surrounding it — then points you toward chapters and themes worth studying next. A whole book can now grow into a study tree.`,
  },
  {
    date:  'July 20, 2026',
    title: 'A better way to ask questions',
    body: `The tooltip and the Ask panel are now one. Highlight a word or phrase to open it grounded in your selection, or press Ctrl+Alt+T anytime to open it on its own — either way you get the same panel, with Define, Explore, Verse Lookup, and Add Note available. You can now keep the conversation going: ask a follow-up, pin an answer to your notepad, and ask again without the panel closing on you. The panel can be moved and resized to sit wherever suits you.`,
  },
  {
    date:  'July 20, 2026',
    title: 'Live Rooms',
    body: `Rooms are now for studying together, not for building studies. Generating a study inside a room has been removed — everyone waited on an unreviewed result, and a host can prepare something better beforehand. Instead, hosts can load a study from their own Library or, new today, from anything shared to the Community, with the original author credited. Shared tooltip answers now stay in the room's chat after you leave and come back, and hosts can remove individual chat messages.`,
  },
  {
    date:  'July 20, 2026',
    title: 'Scripture in your studies',
    body: `Studies now quote Scripture more consistently. When a passage is being discussed in depth, the text itself appears rather than just a reference — and shorter quotations are woven into the sentence rather than set apart, so the reading flows better.`,
  },
  {
    date:  'July 18, 2026',
    title: 'Suggest a study type',
    body: `Not sure which study type fits your topic? Type it in and click "Suggest a study type," and Iron & Ink will recommend one with a brief explanation of why. It's only a suggestion — you're free to choose any type you like.`,
  },
  {
    date:  'July 18, 2026',
    title: 'A word of dedication',
    body: `A dedication to Pastor John MacArthur has been added to the Dedication page. Iron & Ink owes a great deal to his decades of faithful expository preaching, and we wanted to say so plainly.`,
  },
  {
    date:  'July 18, 2026',
    title: 'Readability improvements',
    body: `A number of places on the platform had text that was difficult or impossible to read — pale text sitting on pale backgrounds, left over from an earlier design. This affected status labels, error messages, and the confirmation notices you see after registering or resetting a password. All of it has been corrected, along with some button text that was rendering thin. If you come across anything else that's hard to read, please let us know.`,
  },
  {
    date:  'July 18, 2026',
    title: 'Contact Us',
    body: `You can now reach us directly. A Contact tab has been added to the About page with our email address, and the same address appears in the Help section. If you have a question, run into a problem, or have an idea for something that would make Iron & Ink more useful, please write — we read everything and we reply.`,
  },
  {
    date:  'July 18, 2026',
    title: 'Study Trees',
    body: `Studies can now branch. At the end of a study you'll find a Further Studies list; click any suggestion and Iron & Ink generates a new study from it, remembering where it came from. Over time this builds a study tree — a connected journey through a subject rather than a pile of separate studies. Open any study to see where it sits: a breadcrumb showing the path that led there, a list of studies that branched from it, and a full tree view of the whole journey. Prompts you've already explored are marked, so you won't accidentally study the same thing twice.`,
  },
  {
    date:  'July 18, 2026',
    title: 'Two new study types',
    body: `Pathway — a full study that follows its subject wherever it naturally leads, and ends by opening further paths. This is the type used when you branch from a study, and it can be chosen directly for any topic.

Subject — a study of a specific person, place, or thing in Scripture. Whether you're studying King David, the Garden of Eden, or the Ark of the Covenant, it establishes the concrete details first, then traces its place in redemptive history and how it points to Christ.`,
  },
];

// ─── Coming Soon — planned, not yet shipped ──────────────────────────────────
//
// TO ADD A NEW ITEM: add one object to the TOP of the COMING_SOON array below
// (shown in array order — index 0 renders first). Each item is:
//   {
//     title: 'Short title',
//     body:  `Paragraph text.`
//   }
//
// No date — these haven't shipped. Same body convention as WHATS_NEW entries:
// plain text, blank lines separate paragraphs, escaped before rendering.
//
// Shown at the bottom of the /whats-new page only; the Dashboard panel is
// unaffected. If this array is empty the section renders nothing at all.
// When an item ships, move it into WHATS_NEW above with a date.

const COMING_SOON = [
  {
    title: 'Study tools in Scripture reading',
    body: `We're bringing the tooltip tools you use throughout Iron & Ink — Define, Explore, and more — into the Scripture reader. We're also working on approvals to offer additional translations, including the NASB, LSB, NKJV, NIV, and CSB, and we hope to make these available soon.`,
  },
];

module.exports = { WHATS_NEW, COMING_SOON };
