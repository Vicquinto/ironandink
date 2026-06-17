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
      text:     'Click here and a full six-section Reformed study guide will be built for you.',
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
      text:     'Try it now — highlight any verse or phrase and a toolbar will pop up letting you define it, ask about it, or look up a related verse.',
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
      text:     'Start a room, choose a study level, and decide if it’s open to everyone or private with an invite code.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'rooms-join',
      attachTo: { element: '#joinCodeInput', on: 'bottom' },
      title:    'Join a Room',
      text:     'Got a code from a friend? Enter it here to join their room.',
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
      text:     'If you’re hosting, you can generate studies, load from your Library, or ask a question — and share it with the whole room.',
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
      buttons:  ['back', 'finish'],
    },
  ],

  writing: [
    {
      id:       'writing-begin',
      attachTo: { element: '#beginArticleBtn', on: 'bottom' },
      title:    'Answer the Prompts',
      text:     'Answer these five prompts and a full article or sermon scaffold builds itself around your answers.',
      buttons:  ['skip', 'next'],
    },
    {
      id:       'writing-articles',
      attachTo: { element: '#myArticleList', on: 'top' },
      title:    'Saved to My Articles',
      text:     'Once finished, everything you write is saved here, ready to revisit or publish.',
      buttons:  ['back', 'finish'],
    },
  ],

};
