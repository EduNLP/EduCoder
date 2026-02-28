### Segment

Current segment:

<<segment_label>>

### Segment Transcript

The transcript is provided as a JSON array of utterances:

[
  {
    "line_number": "",
    "speaker": "",
    "utterance": ""
  }
]

<<segment_transcript>>

### Open Ended Notes

Use the runtime notes payload below. `note_number` is the 1-based identifier for each note.

[
  {
    "note_number": 1,
    "title": "",
    "answer_1": "",
    "answer_2": ""
  }
]

<<notes>>

### Output Requirements

- Return valid JSON only.
- Output must be a JSON object with an `assignments` array.
- Each `assignment` must include `note_number`, `line_number`, `speaker`, and `utterance`.
- `note_number` must match a provided note.
- `line_number`, `speaker`, and `utterance` must exactly match a line from the segment transcript.

### Output Format

```json
{
  "assignments": [
    {
      "note_number": 1,
      "line_number": 1,
      "speaker": "",
      "utterance": ""
    }
  ]
}
```
