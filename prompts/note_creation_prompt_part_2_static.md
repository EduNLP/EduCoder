### Transcript Format

The transcript is provided as a JSON array of utterances:

<<transcript>>

### Lesson Learning Goal

It provides information and the learning objectives of the lesson and is provided below:

<<instruction_context>>

Output Requirements
•	Output must be a JSON object with a `notes` array
•	Each array element in `notes` represents one moment
 
Output Format
{
  "notes": [
    {
      "title": "",
      "answer_1": "",
      "answer_2": "",
    }
  ]
}
