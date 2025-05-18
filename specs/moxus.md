Moxus job is to act as a guardrail and helper for the assistant who generate the story using LLM Calls.

Moxus should, for each interaction:
- Listen when the chat text has finished streaming, and evaluate the generation using 2 last interactions (user input, user notes, assistant replies, moxus analysis in the chat). The evaluation should be a diff edition (using same process as other place in code) to update the "chatText" memory.
- Listen when node edition is complete after the user interaction and evaluate the generated nodes, using the 2 last interactions,(same content as above), and the full list of existing nodes. The evaluation should be a diff edition (using same process as other place in code) to update the "nodeEdition" memory.
- Once both evaluation are complete, it should generate an analysis of the current state of things and provide critical feedback in the chat, guided toward the narrative AI, not the user. To do so it should read both previous analysis from its memory, its current "generalMemory", and the last 5 interactions in the chat.
- It should then update its own "generalMemory".

Then, Moxus can also update his "generalMemory" when the following things happen in the application:
- The "assistant" feature is used to generate nodes. Moxus should read the input/output and update his generalMemory if needed, using diff.
- The "regenerate" button is used for a node that was suggested from the assistant or the twine import features. Moxus should read the input/output and update his generalMemory if needed, using diff.

For most of these features, if not all, the prompts should already exist in prompts-instruct.yaml. The feature should also be somehow implemented, or remnant of it as it used to work properly before some refactoring.

The moxus triggered LLM Calls should be viewable in the "log" panel feature.

