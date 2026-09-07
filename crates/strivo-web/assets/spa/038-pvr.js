// Injects the keyboard-shortcuts help overlay. Called here — after
// 037-creator.js's KBD_HELP_ROWS splice, when that file is present — rather
// than immediately in 036-pvr.js, since injectKeyboardHelp() builds its
// content once and never re-renders it.
injectKeyboardHelp();
