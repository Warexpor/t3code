# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

On web and desktop, HEIC and HEIF photos are automatically converted to JPEG when you drag them into
the composer or paste them into a message.

On mobile, the model picker shows each OpenCode model's upstream provider, such as Anthropic,
GitHub Copilot, or OpenCode Zen, beneath its name. Search by that provider name to narrow the list
when starting a thread or changing an existing thread's model.

## Voice input on iPhone

On supported iPhones with iOS 26 or later, tap the microphone in the composer to record a message.
Tap the checkmark to finish. T3 Code transcribes the recording on the device and inserts the text at
the selection where recording started. If the keyboard is open when you start, it stays open during
voice input. You can review and edit the text before you send it.

The first use can download Apple's speech model and needs a network connection. Later transcription
works offline for that language. A recording can be up to five minutes long. Canceling voice input,
leaving the screen, or an audio interruption discards the new recording and keeps the existing draft
and attachments. T3 Code deletes the local audio file after transcription or cancellation. It sends
only the normal message text when you submit the draft.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

On mobile, these menus are available on the **New task** screen before you start a thread. They
use the skills and commands from the selected environment and provider.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
