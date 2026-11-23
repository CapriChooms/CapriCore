# Communication styles

Open **Companion settings → Conversation → Communication style**. A selection
saves automatically and applies to the next reply; it does not restart a model,
clear context or replace the editable `PERSONALITY.md`.

| Style    | Default delivery                                                   |
| -------- | ------------------------------------------------------------------ |
| Neutral  | Friendly, relaxed, lightly mischievous; no unsolicited romance     |
| Romantic | Warm, affectionate and playful, following the user's pace          |
| Business | Direct answers and practical action confirmations                  |
| Wild     | Lively cyberpunk imagery and mischief while staying understandable |

Simple questions normally get one or two short sentences. Capri is asked to
finish when the answer is complete and avoid a chain of follow-up questions.
An explicit request for detail or a longer fictional scene can still get a longer
answer. Model output is not cut mid-sentence or silently regenerated to enforce
a word count. Smaller models may follow these instructions less reliably.

The style is a small shared workspace preference under `.capri/communication.json`.
The editable Personality file remains the single character document. Real tool
permissions and observed facts are independent of every style.

An untouched v0.3.5 stock personality is refreshed on initialization, with its
previous file backed up. Customized character text is retained. The delivery
preference reaches each new managed persona request without replaying history
or adding another classifier/model call.
