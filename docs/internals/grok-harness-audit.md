# Grok Build harness audit

Audit date: 2026-08-29, branch dev-warexpor, goal g8.

T3 Code wraps Grok Build via ACP. Previously the wrapper ignored several Grok-native surfaces that the CLI shows.

## What was hidden

* Context window. Grok reports `context-window.updated` via the same activity as Claude, but the UI meter was Claude-only and tiny. Users could not see how much context they had used. `slash context` did not exist.
* Compact. Claude always registered `compact` as a slash command. Grok never did, even though ACP supports compaction via the same `thread/compact` flow. The composer menu never showed it for Grok, and the meter button was disabled for non-Claude providers.
* Background completion. Grok turns can be long. Mobile had APNs pushes, but web and desktop never fired an OS notification when the app was hidden. Users missed turn completions.
* Thinking. Grok can emit reasoning chunks via ACP. The timeline rendered them as a static row with a snap dropdown. No press-to-see affordance and no smooth motion.
* Streaming. Grok streams via `ContentDelta` over the ACP PubSub. The projector batches via `deriveTimelineEntries`. The audit found no broken batching. No fix needed, leave it on.

## What g2-g7 fixed

* g2 made the context window always visible as a sticky bar above the timeline, with a progress bar, token counts, a `Compact` button, and a `Details` button. Added client-side `slash context` that shows a toast without sending to the provider, and injected synthetic `context` and `compact` into the slash menu for every provider.
* g3 made `compact` provider-agnostic. The meter button and slash routing now work when any provider reports a context window, not only Claude. The menu synthesis ensures Grok sees both commands.
* g4 added Web Notification API in `ChatView` that fires when `isWorking` transitions to settled while `document.hidden` is true. It requests permission and focuses the window on click. This covers web and Electron renderer.
* g5 verified streaming is via `GrokAdapter` `ContentDelta` events into `runtimeEventPubSub` and `deriveTimelineEntries`. No throttling was found that would snap the timeline. Decision: leave it on.
* g6 changed `PlainWorkEntryRow` from conditional render to grid `grid-rows-[0fr]` to `grid-rows-[1fr]` with opacity and fade-in, so thinking/tool bodies animate instead of snapping.
* g7 added `duration-200 ease-out` to `Popover` popup so menus scale and fade smoothly.

## Remaining Grok surfaces to surface later

* Grok model discovery already works via `discoverGrokModelsViaAcp` and surfaces reasoning effort options. No change needed now.
* Skills discovery via `discoverGrokSkills` is already surfaced in the composer skill menu.
* If Grok adds a dedicated context-window option descriptor like Claude, expose it alongside Claude's `contextWindow` select.
* Consider exposing Grok's cost ticks in the Usage page more prominently, as the current `usageTranscripts` already parses them.
