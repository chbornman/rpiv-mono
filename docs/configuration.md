# Configuration

Every setting the package reads, where the file lives, and what happens when a value is
wrong.

## The config file

```
~/.config/rpiv-ask-user-question/config.json
```

The file is optional — with no config at all, every setting takes its default. This
package only ever *reads* the file; it never creates, writes or chmods it, so its
permissions are whatever you give it.

A complete example:

```json
{
  "collapseKey": "alt+o",
  "guidance": {
    "description": "Ask the user structured questions whenever requirements are ambiguous.",
    "promptSnippet": "Ask me before guessing on anything ambiguous",
    "promptGuidelines": [
      "Batch every clarifying question into one ask_user_question call.",
      "Put your recommended option first and suffix it with (Recommended)."
    ]
  }
}
```

### Where the file is looked up

1. `$XDG_CONFIG_HOME/rpiv-ask-user-question/config.json`, if `XDG_CONFIG_HOME` is set,
   non-empty and absolute. A leading `~` is expanded first; a relative value is ignored.
   Unset or ignored, the directory falls back to `~/.config`.
2. If that file does not exist, the legacy path `~/.config/rpiv-ask-user-question/config.json`
   is read. This path deliberately ignores `XDG_CONFIG_HOME`, so an existing config keeps
   working after you set the variable.
3. Neither present: all defaults.

If the XDG-path file exists, its result wins even when it is malformed — there is no
second chance at the legacy path.

### When the file is invalid

Malformed JSON is not fatal. The loader warns on stderr and continues with defaults:

```
rpiv-config: invalid JSON at <path>, using default ({}) — <parser message>
```

Valid JSON that is not an object (a string, number, `null`, or an array) is rejected too,
falling back to defaults — but silently, with no warning. Individual keys with the wrong
type are likewise dropped back to their default without a warning.

## Settings

| Setting | What it does | Default |
| --- | --- | --- |
| `renderMode` | `"inline"` mounts below the transcript in Pi's editor area; `"overlay"` draws over the transcript. | `"inline"` |
| `collapseKey` | Key that collapses and expands the dialog. | `"ctrl+]"` |
| `guidance.description` | Full text of the tool description the model sees. Replaces the built-in default entirely — no merging. | built-in description |
| `guidance.promptSnippet` | One-line snippet describing the tool in the system prompt. | built-in snippet |
| `guidance.promptGuidelines` | List of usage guidelines given to the model. | 4 built-in guidelines |

### `renderMode`

`"inline"` (the default) mounts the questionnaire in Pi's editor area, below the
transcript — where Pi's own select and input prompts appear. The transcript keeps scrolling with `PageUp`/`PageDown` and the wheel while the dialog
keeps its own keys. The dialog takes at most 70% of the terminal height (at least 12
rows); a taller questionnaire scrolls its options inside that space, keeping the header,
the question, the focused option and the key hints visible. Collapse shrinks it to one
hint row that keeps focus, and the same key expands it again.

Wheel and trackpad scrolling reach the transcript only when the terminal reports them as
mouse events. A terminal with mouse reporting turned off (Warp, for one) converts them
into ↑/↓ key presses instead, which move between the dialog's options. `PageUp`/`PageDown`
(`Fn+↑`/`Fn+↓` on a Mac keyboard) scroll the transcript either way.

Only one questionnaire can occupy the editor area. If the agent opens a second one while
an inline questionnaire is still open, the second opens as an overlay.

`"overlay"` restores the previous presentation: a focused overlay over the bottom of the
transcript, up to the full terminal height. In Pi's fullscreen mode a focused overlay
receives the transcript's scroll input, so `PageUp` and the mouse wheel do nothing until
you collapse it.

Values are trimmed and lowercased; anything other than `"overlay"` uses the inline default. The
setting is read for each questionnaire, so edits apply to the next one without
restarting Pi. RPC hosts use their native dialogs regardless of this setting.

### `collapseKey`

The value uses Pi's keybinding id format: zero or more distinct modifiers from `ctrl`,
`shift`, `alt`, `super`, joined by `+`, followed by a base key. Values are trimmed and
lowercased before matching.

The base key is either a single printable character from
`a-z 0-9 _ - ! @ # $ % ^ & * ( ) | ~ \` ' " : ; , . / < > ? [ ] { } = \`, or one of the
named keys `escape`, `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`,
`insert`, `clear`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`,
`f1`–`f12`.

Examples that work: `"ctrl+]"`, `"alt+o"`, `"ctrl+shift+h"`, `"f9"`, `"ctrl+}"`.

Set `"off"` (any casing) to disable the collapse shortcut entirely — no raw terminal
listener is registered in that case.

A spec that does not match the grammar is rejected and the default is used. This is
strict on purpose: Pi's parser takes the last `+`-separated part as the key and ignores
unknown parts, so a typo like `"ctr+]"` would otherwise silently capture every bare `]`
keypress at the terminal level.

The footer hint inside the dialog names whatever key you configure (`Alt+O to collapse`
for `"alt+o"`), as do the collapsed one-line footer and the one-shot notification shown
when the dialog is first hidden. With `"off"` the collapse hint is dropped from the
footer entirely, since no shortcut can fire.

### `guidance.description`, `guidance.promptSnippet` and `guidance.promptGuidelines`

`guidance.description` replaces the entire built-in description Pi registers for the
`ask_user_question` tool — the text the model reads when deciding how to use it. There is
no merging: a valid value wins wholesale. It is used only when it is a non-empty string;
anything else falls back to the built-in default. Like the other guidance fields it is read
once, when the extension registers the tool, so changes take effect on the next Pi restart.

These replace the text Pi puts in the system prompt about when to reach for
`ask_user_question`. Use them to make the model ask more or less often, or to enforce a
house style for options.

`promptSnippet` is used only when it is a non-empty string. `promptGuidelines` is used
only when it is a non-empty array whose entries are all non-empty strings. Anything else
falls back to the built-in defaults. Both are read once, when the extension registers the
tool, so changes take effect on the next Pi restart.

## Environment variables

| Variable | Effect |
| --- | --- |
| `XDG_CONFIG_HOME` | Relocates the config directory, as described above. Must be absolute. |

`LANG` and `LC_ALL` influence the dialog language, but they are read by
[`@juicesharp/rpiv-i18n`](https://www.npmjs.com/package/@juicesharp/rpiv-i18n) rather than
by this package — see [localization.md](./localization.md).

No other environment variables are read. The package makes no model calls, so it needs no
API keys or model settings of its own.
