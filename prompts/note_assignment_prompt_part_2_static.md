
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

```
Title: json["title"]

1.	What are the students saying or doing?
json["answer_1"]
2.	How can this be interpreted in relation to the lesson goal?
json["answer_2"]
3.	What are 1–2 possible teacher responses, and why?
json["answer_3"]

```


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
