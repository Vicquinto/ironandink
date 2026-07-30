// ─── Children's story shelf — curated Bible-story picker ─────────────────────
//
// Rendered server-side into the Study page by routes/study.js (buildStoryBrowser),
// shown only while the Children's study level is selected. Each group becomes one
// collapsible accordion category; each story becomes a .story-item button that
// fills the topic box (fill + focus, not auto-generate).
//
// TO EDIT: add/remove a group object, or a string inside a group's `stories`
// array. Plain strings — the value is used verbatim as the topic (data-topic).

const STORY_GROUPS = [
  { name: "In the Beginning", stories: ["God Makes the World", "Adam and Eve", "Noah and the Ark", "God's Promise to Abraham", "Joseph Forgives His Brothers"] },
  { name: "God Rescues His People", stories: ["Moses and the Burning Bush", "Crossing the Red Sea", "Joshua and the Walls of Jericho", "Gideon's Small Army", "Ruth's Faithfulness"] },
  { name: "Kings and Prophets", stories: ["David and Goliath", "David the Shepherd Boy", "Daniel in the Lion's Den", "The Fiery Furnace", "Jonah and the Great Fish", "Elijah Trusts God"] },
  { name: "Jesus Is Born", stories: ["The First Christmas", "The Shepherds and the Angels", "Jesus as a Boy in the Temple"] },
  { name: "Jesus Among His People", stories: ["Jesus Is Baptized", "Jesus Calms the Storm", "Jesus Feeds Five Thousand", "Jesus Welcomes the Children", "Jesus Heals Blind Bartimaeus"] },
  { name: "Stories Jesus Told", stories: ["The Lost Sheep", "The Prodigal Son", "The Good Samaritan"] },
  { name: "The Cross and the Empty Tomb", stories: ["The Last Supper", "Jesus Dies for Us", "Jesus Is Alive!", "The Road to Emmaus"] },
];

module.exports = STORY_GROUPS;
