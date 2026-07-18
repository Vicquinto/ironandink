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
