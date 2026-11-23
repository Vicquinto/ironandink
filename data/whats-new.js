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
    date:  'November 22, 2026',
    title: 'Hear the Hard Sounds',
    body:  `The Hebrew and Greek alphabet lessons now have small "Hear it" buttons for the sounds English doesn't have: the catch of Hebrew alef, the throaty ch of chet and Greek chi, the ü of Greek upsilon and the light r of Greek rho. We also clarified a few pronunciation notes.`
  },
  {
    date:  'November 22, 2026',
    title: 'Debate This View',
    body:  `Every Opposing Views study now ends with a "Debate this view" button. It opens Dialogue with a skilled defender of the view you just studied, arguing the same case Part 1 laid out, so you can practice answering it. At the end, Dialogue tells you where you answered well and what to study next.`
  },
  {
    date:  'November 22, 2026',
    title: 'A New Study Type: Opposing Views',
    body:  `Opposing Views is a new study type on the Study page. Name a view you disagree with, such as evolution, open theism, or Roman Catholicism, and choose your level as usual.

Every Opposing Views study has two parts. Part 1 presents the view the way its own best defenders would: their terms, their arguments, their evidence, and a list of their own sources to read. Part 2 answers it from Scripture first, then with supporting arguments. You can hide Part 2 while you read Part 1.

Our Confession now has an article on Creation, and the note on secondary matters now explains how our studies handle the days of creation.`
  },
  {
    date:  'November 21, 2026',
    title: 'Learn to Read Biblical Greek and Hebrew',
    body:  `Iron & Ink now has two courses that teach you to read the Bible in the languages it was written in. Open Languages in the sidebar and choose Greek or Hebrew.

The Greek course takes you from the alphabet to reading 1 John 1 in Greek, in 25 short lessons. The Hebrew course takes you from the alphabet to reading Genesis 1:1-5 in Hebrew, in 30 lessons. In each lesson a teacher walks you through the material beside real verses from Scripture, and you can ask questions or tap Quiz me at any point. The words you learn come back in a short vocabulary review, a little more spaced out each time you know them.

Every Greek and Hebrew word in the courses comes from scholarly data prepared by Tyndale House, Cambridge, never from the AI's memory.`
  },
  {
    date:  'November 21, 2026',
    title: 'See the Hebrew and Greek Behind Any Verse',
    body:  `The panel that opens when you highlight a verse has a new Original tab. It shows the verse in Hebrew or Greek, word by word, with each word's transliteration and meaning. Click a word to see its dictionary form, its grammar in plain English, and a short definition, then choose Explain this word to have Explore tell you more about it.

You can open it from the Scripture page or from any verse quoted in a study. The data comes from STEP Bible, based on work at Tyndale House, Cambridge.`
  },
  {
    date:  'November 21, 2026',
    title: 'A Better Check My Understanding',
    body:  `Check my understanding now asks questions you answer in your own words: explain an idea, connect it to another part of the study, or defend it. The questions match the level the study was written at, from Apprentice to Scholar. If you're stuck, Give me a hint points you to the right part of the study without giving the answer away. At the end you get an honest summary of what you understand well and what's worth another look.`
  },
  {
    date:  'November 21, 2026',
    title: 'Teacher Sessions Are Easier to Find',
    body:  `Study with a Teacher and Check my understanding are now clearly labeled, so you always know which one you're in. If you open one while the other is saved for that study, Iron & Ink tells you and offers to take you there.`
  },
  {
    date:  'November 15, 2026',
    title: 'Listen to Your Studies',
    body:  `Any study can now be read aloud. Choose Listen at the top of a study, pick a voice and a speed, and Iron & Ink reads it to you section by section, highlighting each paragraph as it goes. When it reaches a Bible passage, it tells you the reference first. Tap any paragraph while it's playing to jump there.

For the most natural voices, use Microsoft Edge on a computer. On an iPhone, you can download a much better voice for free: open Settings, then Accessibility, Spoken Content, Voices, English, and download a voice marked Premium or Enhanced. It will then appear at the top of the voice list.`
  },
  {
    date:  'November 15, 2026',
    title: 'Mark Your Place in a Study',
    body:  `Most studies take more than one sitting, so you can now mark your place. Highlight any word and choose Mark my place, and a small ribbon appears beside that paragraph. The next time you open the study, a bar at the top offers Go to my place.

If you stop Listen partway through a study, your place is saved for you. Your Library shows where you stopped in each study, and your place follows you from your computer to your phone.`
  },
  {
    date:  'November 15, 2026',
    title: 'Pick Up Where You Left Off',
    body:  `Your Dashboard now gathers everything you're in the middle of under Currently studying. Each study appears once, with a note when you have a Teacher lesson or an understanding check in progress, and a Continue link that takes you straight back to it. The Library's new In progress view shows the same thing.

The Teacher page now also says plainly whether you're in a lesson or an understanding check. When you've finished a Teacher session, choose I'm done with this session from its review, and it leaves the list while staying saved in case you want it later.`
  },
  {
    date:  'November 15, 2026',
    title: 'Archive Studies You\'re Not Using',
    body:  `If your Library is getting full, you can now archive studies instead of deleting them. Choose Archive on a study, or use Select to put away many at once. Archived studies leave your main list but keep everything: notes, bookmarks and Teacher sessions. They still appear on your Study Map.

To see them, choose Archived in the Library's dropdown. Unarchive brings any of them back.`
  },
  {
    date:  'November 15, 2026',
    title: 'Larger, Adjustable Text in the Study Panel',
    body:  `The panel that opens when you highlight a word, with Define, Explore and Verse Lookup, now uses the same comfortable text size as the Scripture page. Use the A− and A+ buttons in its corner to make the text larger or smaller, and Iron & Ink remembers your choice everywhere.`
  },
  {
    date:  'November 15, 2026',
    title: 'Fixes and Improvements',
    body:  `Notes you add to a study now always show their numbered marker in the text, including notes on Bible verses. Notes from the past day that were missing their marker have been restored. In the Library, each study card's buttons now sit on their own row, so titles are easier to read.`
  },
  {
    date:  'November 1, 2026',
    title: 'Maps for Ancient Places and Roman Roads',
    body:  `When you Explore a passage or Define a word, Iron & Ink can now show you where things were. If the answer mentions ancient cities or Roman roads, a small map appears beneath it with the cities pinned and the roads drawn in. Click a place name in the answer and the map moves to it. Defining a single place, like Philippi or Capernaum, shows its location too.

Try it with Paul's journeys in Acts 16 and 17, where the map traces the Via Egnatia through Philippi, Amphipolis and Thessalonica. Stretches of road whose exact course is uncertain are shown dashed. You can hide the map anytime with Hide map. When you pin an answer to your notes, the note remembers its map, so you can open it again later with Show map.

Map data comes from scholarly open sources: the Digital Atlas of the Roman Empire, the Pleiades gazetteer of ancient places, and the Itiner-e atlas of Roman roads. When a location can't be confirmed, Iron & Ink leaves it off the map rather than guess.`
  },
  {
    date:  'October 24, 2026',
    title: 'Chapter Notes on the Scripture Page',
    body:  `You can now take notes right in the Scripture reader. Highlight any word, phrase or passage and choose Add Note to write a note anchored to that spot. Answers from Define, Explore and Verse Lookup can be saved with Pin to Chapter Notes.

Your notes appear beside the text in verse order, each showing its reference and the passage it's tied to. Click a note to jump to its verse, or click the small numbered marker in the text to find its note. You can edit or delete notes anytime, and Hide Notes / Show Notes gives the text the full page.

Your chapter notes are private to you.`
  },
  {
    date:  'October 24, 2026',
    title: 'Listen to Scripture',
    body:  `A new Read Aloud button reads the chapter to you, verse by verse, highlighting each verse as it goes and continuing into the next chapter on its own.

Choose your voice and reading speed, and your choices are remembered. While listening, click any verse number to jump to that verse. Tip: Microsoft Edge offers the most natural-sounding voices.`
  },
  {
    date:  'October 24, 2026',
    title: 'Fixes and Improvements',
    body:  `Fixed a display problem where words in Old Testament quotations, such as "God" and "Behold," appeared split apart.

Behind the scenes, we've also improved how your notes are saved and protected.`
  },
  {
    date:  'October 12, 2026',
    title: 'Study Ideas',
    body:  `Have a study in mind for later? The Study page now has Study Ideas, beside Plan a Study: a private list of studies you'd like to do someday. Give an idea a short title, add notes if you like, and pick a study type and level if you already know them. Only you can see your ideas, and they follow you to any device you sign in on.

Each idea has "Plan it", which opens Plan a Study with the idea waiting in the box for you to send, and "Build it", which fills in the study creator so you can adjust the type or level and click Generate Study. Once the study is generated, the idea comes off your list (with an Undo, in case you change your mind). The planner can see your ideas too, so it can suggest starting from one.

In your Library, each study now has "Save as idea and delete" beside Delete. It keeps the study's title, subject, type and level as a Study Idea, then deletes the study just as Delete does, including any notes and highlights on it. Your Study Map links to your Study Ideas as well.`
  },
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
