
### Transcript

The transcript is provided as a JSON array of utterances:

[
  {
    "line_number": "",
    "speaker": "",
    "utterance": ""
  }
]

<<transcript>>


#### Open Ended Note 

Use this runtime note payload:

```json
<<note>>
```

Title: <<note_title>>

1. What does this tell you about students’ progress towards the lesson goals?
<<note_answer_1>>

2. How might you, as a teacher, respond to this student(s)?
<<note_answer_2>>


### Output Requirements

- Return valid JSON only
- Output must be a JSON object with an `assignments` array
- Each array element in `assignments` must be an exact transcript utterance


### Output Format

```json
{
  "assignments": [
    {
      "line_number": "",
      "speaker": "",
      "utterance": ""
    }
  ]
}
```
