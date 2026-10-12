# Tool schema

The complete programmatic surface of `ask_user_question`: what the model sends, what
validation rejects, what comes back, and the event other extensions can listen to.

## Parameters

```ts
ask_user_question({
  questions: [
    {
      question: string,            // full question text, ends with "?"
      header: string,              // chip label, max 16 chars
      options: [
        {
          label: string,           // 1-5 words, max 60 chars
          description: string,     // what the choice means / its trade-off
          preview?: string,        // markdown rendered next to the options
        },
        // … 2-4 options total
      ],
      multiSelect?: boolean,       // default false
    },
    // … 1-4 questions total
  ]
})
```

### Limits

| Field | Constraint | Enforced by |
| --- | --- | --- |
| `questions` | 1-4 entries | TypeBox schema + `validateQuestionnaire` |
| `questions[].header` | max 16 characters | TypeBox schema only |
| `questions[].options` | 2-4 entries | TypeBox schema (both bounds) + `validateQuestionnaire` (minimum only) |
| `options[].label` | max 60 characters | TypeBox schema only |
| `options[].preview` | single-select questions only | tool description (multi-select tabs render checkbox rows) |

The two `maxLength` limits are checked by the parameter schema before `execute` runs;
the runtime validator does not re-check them.

### Reserved option labels

Authoring any of `"Other"`, `"Type something."`, or `"Next"` as an option label is
rejected with `reserved_label`. The last two are the runtime sentinel rows the dialog
appends itself; `"Other"` is reserved because models are conditioned to reach for it.
Reservation is unconditional — a single-select question rejects `"Next"` even though
that row is never appended there.

## Validation errors

Every rejection returns `cancelled: true`, an empty `answers` array, and an `error`
code. The `content[0].text` string is written for the model, not for a log.

| `error` | Cause |
| --- | --- |
| `no_questions` | `questions` was empty |
| `too_many_questions` | more than 4 questions in one call |
| `duplicate_question` | two questions with identical text |
| `empty_options` | a question carried fewer than 2 options |
| `reserved_label` | an option used a reserved label |
| `duplicate_option_label` | two options in one question share a label |
| `no_ui` | the run has no UI (`ctx.hasUI === false`) |
| `no_custom_ui` | the host cannot render custom UI and exposes no `select`/`input` dialogs |
| `session_load_failed` | the dialog module failed to import (dependencies changed on disk mid-session) |
| `stale_module_cache` | the loader cached a broken module after an earlier failed import; needs a Pi restart |

`reserved_label` short-circuits before `duplicate_option_label`.

## Result

```ts
{
  content: [{ type: "text", text: string }], // envelope prose, or the decline message
  details: {
    answers: Array<{
      questionIndex: number,
      question: string,
      kind: "option" | "custom" | "multi",
      answer: string | null,       // option label, typed text, or null for multi
      selected?: string[],         // chosen labels, multi-select only
      notes?: string,              // free-text note, when you wrote one
      preview?: string,            // echoed back when the chosen option carried a preview
    }>,
    cancelled: boolean,
    globalNote?: string,          // Submit-tab note; present even when cancelled is true
    unanswered?: number[],        // indexes of questions left blank on a partial submit
    error?: QuestionnaireError,    // one of the codes above
  }
}
```

### Envelope text

On success the text reads `User has answered your questions: "<question>"="<answer>". …
You can now continue with the user's answers in mind.` A chosen option's `preview` is
appended as `selected preview: <markdown>`, a per-question note as `user notes: <text>`,
and the Submit tab's global note as a trailing `global note: <text>` segment. A global
note alone still yields the answered envelope — it counts as an answer even when every
question is blank.

Cancelling, and any result with neither answer segments nor a global note, both collapse
to the single string `User declined to answer questions` so the model sees one canonical
signal. Partial submission is allowed: the questions left blank are named in an
`unanswered: "<question>", …` segment after the answers (before any global note), and their
indexes are in `details.unanswered`. Both are absent when every question is answered.
A cancelled result always reads as the decline in text; its note, if any, survives only
in `details.globalNote`.

## Event contract

The package publishes two events on Pi's event bus and listens for one. Import the
definitions from the `/events` subpath:

```ts
import {
  ASK_USER_PROMPT_EVENT,
  ASK_USER_BLOCKED_EVENT,
  ASK_USER_ANSWER_EVENT,
  ASK_USER_ANSWER_RESULT_EVENT,
  type AskUserPromptEventPayload,
  type AskUserAnswerEventPayload,
} from "@juicesharp/rpiv-ask-user-question/events";

pi.events.on(ASK_USER_PROMPT_EVENT, (payload: AskUserPromptEventPayload) => {
  // payload.questions[].{ question, header, multiSelect, options[] }
  // payload.questions[].options[].{ label, description, hasPreview }
  // payload.promptId (present on the terminal path only)
});
```

The channel names are `rpiv:ask-user:prompt` and `rpiv:ask-user:blocked`. Preview *content*
is deliberately not shipped in the prompt payload, only `hasPreview: boolean`, so listeners
forwarding the event across a process or network boundary stay cheap.

`rpiv:ask-user:blocked` brackets the wait: `{ active: true }` immediately before the dialog
opens and `{ active: false }` after it closes, so a listener can suppress its own prompts
while the user is busy answering. Both halves carry the same `promptId`.

### Questionnaire identity

`promptId` is an opaque UUID minted per tool call. It identifies one questionnaire across
the prompt event, both halves of its blocked bracket, and any answer you send back. It is
append-only and optional, and it is absent on the RPC dialog path (see below).

Pi runs tool calls in parallel, so two questionnaires can be open at once and their brackets
interleave. Match them by `promptId` rather than by "the last event I saw".

### Answering from outside the terminal

`rpiv:ask-user:answer` resolves a waiting questionnaire without synthesizing keystrokes:

```ts
pi.events.emit(ASK_USER_ANSWER_EVENT, {
  promptId, // optional: which questionnaire. Omit for the newest one.
  requestId: "msg-42", // optional: echoed back on the ack
  result: {
    answers: [{ questionIndex: 0, kind: "option", answer: "React" }],
    cancelled: false,
    globalNote: "shipping Friday", // optional
  },
} satisfies AskUserAnswerEventPayload);
```

Every attempt is answered on `rpiv:ask-user:answer-result` with
`{ ok, promptId?, reason?, requestId? }`, so a bridge never has to wonder whether its
answer landed. `promptId` names the questionnaire the verdict applies to, including the one
an untargeted answer chose.

The same delivery is exported as a function for a consumer that shares the process:
`submitAskUserAnswer(result, promptId?)` from the package root returns the verdict as a
boolean and has no side effects when it returns `false`.

**Stack semantics.** The live questionnaires form a stack, one entry per open dialog. An
answer with no `promptId` goes to the newest entry, which is the question the user sees on
top; an answer with a `promptId` goes to that entry wherever it sits. Each entry is removed
by the mount that created it, matched by identity, so an overlapping teardown can only ever
drop its own registration and the entry underneath becomes the target again. An entry is
also removed the moment it is answered, which makes a duplicate `promptId` a reported miss
rather than a second answer.

**Validation.** Every answer is checked against the params the targeted questionnaire
opened with, and rebuilt from them:

- `result` must be an object with a boolean `cancelled` and an `answers` array, and an
  answered result must carry at least one answer or a non-empty `globalNote`.
- Every entry must be an object whose `kind` is `option`, `custom`, or `multi`, whose
  `questionIndex` is within range, and which does not answer a question twice.
- An `option` answer must be exactly one of that question's labels. Every item of a `multi`
  `selected` list must be one of its labels (duplicates collapse; an omitted `selected` is
  the terminal's empty commit). A `custom` answer must be a string or nothing.
- `question` and `preview` are read from the params, never from the submission, and any
  unknown field is dropped: a remote client can choose an option, not author text the model
  will read as the questionnaire's own.
- `cancelled: true` skips the per-entry checks and ships as authored, mirroring the
  terminal's Esc. The envelope emits the canonical decline for any cancelled result, so its
  entries reach only the persisted `details` snapshot.

Nothing throws. A malformed payload from across the network is data, not code, and comes
back as `ok: false` with a `reason` that names the offending field.

**Where answers are not accepted.** On RPC/ACP hosts (VS Code, Zed, other `ctx.mode ===
"rpc"` clients) the questionnaire is walked through the host's own native dialogs, one
question at a time. Those prompts belong to the host, so nothing registers, no `promptId` is
emitted, and an inbound answer is refused as `no questionnaire is awaiting input`. A bridge
reading a prompt event without a `promptId` should render it read-only. The one legacy
exception is an RPC build that predates `ctx.mode`: the prompt event already carries a
`promptId` by the time the walker takes over, and that id stays unanswerable.

Stability policy for the `rpiv:*` namespace: channel names are immutable, payload changes
are append-only and always optional, payloads stay JSON-safe, and any breaking change ships
as a new channel (e.g. `rpiv:ask-user:prompt.v2`) rather than a version field. Inbound
channels follow the same rule: a new field on `AskUserAnswerEventPayload` is something
listeners must ignore rather than reject, and `reason` strings are diagnostics, not contract
(never branch on their text; branch on `ok`).

