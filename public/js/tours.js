/**
 * Tour step definitions for each page.
 * Each step: { id, attachTo: {element, on} | null, title, text, buttons[] }
 * buttons: 'skip' | 'back' | 'next' | 'finish'
 * To add a step: push a new object onto the relevant page array. No other changes needed.
 */

export const TOURS = {

  study: [
    {
      id:       'study-topic',
      attachTo: { element: '#topicInput', on: 'bottom' },
      title:    'Start Here',
      text:     'Type any theological topic, passage, or question — anything from “justification” to “Romans 9” to “why do bad things happen to good people.”',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'study-generate',
      attachTo: { element: '#generateBtn', on: 'bottom' },
      title:    'Generate',
      text:     'Click here and a structured Reformed study is built for you — with a topic overview, the key Scriptures in full, confessional context, and voices from church history.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'study-plan',
      attachTo: { element: '#planStudyBtn', on: 'bottom' },
      title:    'Plan a Study',
      text:     'Not sure exactly what to study? Talk it through with the planner first. It helps you shape an idea into a clear study, recommends the type and level, and with “Build this study” fills in the creator for you — then you click Generate.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'study-ideas',
      attachTo: { element: '#ideasToggleBtn', on: 'bottom' },
      title:    'Study Ideas',
      text:     'Keep a private list of studies you’d like to do later. “Plan it” talks an idea through with the planner; “Build it” fills in the study creator, and once the study is generated the idea comes off your list. Only you can see it.',
      buttons:  ['back', 'finish'],
    },
  ],

  // optional: true — skipped when the element isn't on the page (e.g. a member
  // with no studies yet has no views, entries or Revisit suggestion).
  'study-map': [
    {
      id:       'study-map-intro',
      attachTo: { element: '.page-title', on: 'bottom' },
      title:    'Your Study Map',
      text:     'Every study you’ve saved, gathered in one place — so you can find a past study and study it again. Only you can see it, and there’s nothing to score: it’s simply a map of where you’ve been.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'study-map-views',
      attachTo: { element: '.sm-tabs', on: 'bottom' },
      optional: true,
      title:    'Three Ways to Look',
      text:     'By area of theology, by book of the Bible, or month by month. Studies on the same subject are kept together, and an area you haven’t studied yet has a “Plan a study” link to start one.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'study-map-filter',
      attachTo: { element: '.sm-filter', on: 'bottom' },
      optional: true,
      title:    'Studying or Completed',
      text:     'When you finish a study, mark it complete — on the study itself, or after a session with the Teacher. Show all your studies here, just the ones you’re still studying, or the ones you’ve completed. You can undo it anytime.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'study-map-entry',
      attachTo: { element: '.sm-entry', on: 'bottom' },
      optional: true,
      title:    'Open It, or Check Yourself',
      text:     'Open any study, or let the Teacher check your understanding of it. A small Teacher marker shows where you’ve already had a session.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'study-map-revisit',
      attachTo: { element: '.sm-revisit', on: 'bottom' },
      optional: true,
      title:    'Worth Revisiting',
      text:     'Now and then a study is suggested here — one you completed a while ago, worth revisiting, or one you started and may want to continue. Not interested right now? “Not now” hides it.',
      buttons:  ['back', 'finish'],
    },
  ],

  scripture: [
    {
      id:       'scripture-nav',
      attachTo: { element: '.scripture-nav', on: 'bottom' },
      title:    'Browse the Bible',
      text:     'Browse any book and chapter of the Bible here.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'scripture-tracker',
      attachTo: { element: '.tracker-section', on: 'top' },
      title:    'Track Your Progress',
      text:     'Track your progress through all 66 books and set personal reading goals.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'scripture-text',
      attachTo: { element: '#scriptureBody', on: 'top' },
      title:    'Try the Highlight Tool',
      text:     'Highlight any verse or phrase and a small toolbar appears — define a word, ask a question about it, or look up a related verse, right where you’re reading. You can even pin an answer to keep it handy, or share it into a Live Room. (Press Ctrl + Alt + T to bring it up anytime.)',
      buttons:  ['back', 'finish'],
    },
  ],

  selah: [
    {
      id:       'selah-entry',
      attachTo: { element: '#selahBody', on: 'bottom' },
      title:    'Write Freely',
      text:     'Write freely here — a prayer, a reflection, a word to the Lord. Nothing is judged or graded, this is just between you and Him.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'selah-reflect',
      attachTo: { element: '#reflectBtn', on: 'top' },
      title:    'Reflect with AI',
      text:     'When you’re ready, you can ask for a warm, pastoral reflection on what you wrote — it’ll be saved right alongside your entry.',
      buttons:  ['back', 'finish'],
    },
  ],

  rooms: [
    {
      id:       'rooms-start',
      attachTo: { element: '#startRoomBtn', on: 'bottom' },
      title:    'Start a Room',
      text:     'Start a room, choose a study level, and decide if it’s open to everyone or private with an invite.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'rooms-join',
      attachTo: { element: '#roomsList', on: 'top' },
      title:    'Join a Room',
      text:     'See a room that’s open? Click it from the list to join — or accept an invitation when someone invites you.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'rooms-chat',
      attachTo: null,
      title:    'Room Chat',
      text:     'Talk with everyone in the room in real time.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'rooms-host',
      attachTo: null,
      title:    'Host Tools',
      text:     'If you’re hosting, load a study from your Library to bring it to the whole room. And anytime, highlight a word or press Ctrl + Alt + T to look something up — then share the answer straight to the room’s chat.',
      buttons:  ['back', 'finish'],
    },
  ],

  library: [
    {
      id:       'library-studies',
      attachTo: { element: '#studyCardsGrid', on: 'top' },
      title:    'Your Saved Studies',
      text:     'Every study you generate and save lives here, tagged and searchable.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'library-filter',
      attachTo: { element: '.library-filter-bar', on: 'bottom' },
      title:    'Organize Your Library',
      text:     'Rate your studies and add tags to find them again easily later.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'library-teacher',
      attachTo: null,
      title:    'Study with a Teacher',
      text:     'Open any study and you’ll find “Study with a Teacher” at the top: a teacher walks you through it in order, section by section. “Teach me this section” beside each heading takes the lesson right there, and “Check my understanding” at the end asks a few short questions, then helps with anything you missed. They’re on shared Community studies too.',
      buttons:  ['back', 'finish'],
    },
  ],

  teacher: [
    {
      id:       'teacher-split',
      attachTo: { element: '.teacher-study-pane', on: 'right' },
      title:    'The Study Stays Open',
      text:     'Your study stays right here, and it follows the lesson: the section your teacher is on is marked, so you can read along. Ask anything in the box at any time.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'teacher-quick',
      attachTo: { element: '#teacherQuickReplies', on: 'top' },
      title:    'You Set the Pace',
      text:     'Tap Continue to go on, Go deeper to stay on a point longer, Say that more simply for a plainer explanation, or Ask me a question to test yourself.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'teacher-end',
      attachTo: { element: '#teacherEndBtn', on: 'bottom' },
      title:    'Saved as You Go',
      text:     'Your lesson saves automatically, so you can pick it up later. When you’re done, End Session shows what you understand well, what’s worth revisiting, and a study to take up next.',
      buttons:  ['back', 'finish'],
    },
  ],

  dialogue: [
    {
      id:       'dialogue-topic',
      attachTo: { element: '#dialogueSetup', on: 'bottom' },
      title:    'Pick a Topic',
      text:     'Pick a topic and Claude will argue the strongest opposing case — your job is to defend the Reformed position.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'dialogue-method',
      attachTo: null,
      title:    'The Method',
      text:     'Each round sharpens your reasoning a little more. Stick with it — this is meant to challenge you.',
      buttons:  ['back', 'next'],
    },
    {
      id:       'dialogue-review',
      attachTo: null,
      title:    'Review & Grow',
      text:     'When you finish a session, you’ll get a warm, honest review — what you argued well, where to sharpen, and the single most important topic to study next, ready to open with one click. It turns each dialogue into a step forward.',
      buttons:  ['back', 'finish'],
    },
  ],

  writing: [
    {
      id:       'writing-begin',
      attachTo: { element: '#beginArticleBtn', on: 'bottom' },
      title:    'Answer the Prompts',
      text:     'Choose what you’re writing — an article, sermon, or letter — then answer a few guiding questions, and a full scaffold builds itself around your answers.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'writing-articles',
      attachTo: null,
      title:    'From Draft to Published',
      text:     'When a piece is finished, you can submit it for review — and once approved, it’s published to the community for others to read. You’ll find all your writing under My Articles.',
      buttons:  ['back', 'finish'],
    },
  ],

};
