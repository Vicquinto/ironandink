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

// Standing overview — NOT a dated entry. Persistent description of the platform,
// shown below the changelog on the /whats-new page. Paragraphs separated by
// blank lines, same convention as entry bodies.
const WHATS_NEW_OVERVIEW = {
  title: 'What Iron & Ink Does',
  body: `Iron & Ink is a confessionally Reformed study platform built to help believers engage Scripture seriously and share what they find.

Study generates structured Bible studies across several types — doctrinal studies, historical studies, verse-by-verse work, studies of people and places, broad explorations of large subjects, and pathway studies that open onto further study. Each can be run at three depths: Apprentice, Journeyman, or Scholar.

Dialogue is an adversarial theological trainer — defend the Reformed position against the strongest objections from other traditions.

Writing helps you compose an article, sermon, or letter, with three levels of assistance from outline to full draft. Finished pieces can be shared with the community.

Library holds everything you've saved. Scripture is a reader for working directly in the text. Community is where members share studies, articles, and prayer requests. Live Rooms let members study together in real time.

Alongside these: a floating notepad that anchors notes to specific studies, a Scripture tooltip for looking up or exploring any word or phrase in place, Selah for private reflection, daily devotionals, and messaging between members.

All Scripture in generated studies is drawn from the American Standard Version, inserted from a verified source rather than written by the AI.`,
};

module.exports = { WHATS_NEW, WHATS_NEW_OVERVIEW };
