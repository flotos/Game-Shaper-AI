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

Current flow is:

1. Main User Interaction LLM Calls (Synchronous):
getRelevantNodes (conditional - only if nodes > MAX_INCLUDED_NODES)
Call Type: node_relevance_check
generateChatText (streaming)
Call Type: chat_text_generation
generateActions (parallel with #4)
Call Type: action_generation
generateNodeEdition (parallel with #3)
Call Type: node_edition_json
2. Background Moxus LLM Calls (Asynchronous):
Chat Text Feedback Generation
Call Type: moxus_feedback_on_chat_text_generation
Node Edition Feedback Generation
Call Type: moxus_feedback_on_node_edition_json
Chat Text Memory Update
Call Type: INTERNAL_MEMORY_UPDATE_FOR_chatTextFeedback
Node Edition Memory Update
Call Type: INTERNAL_MEMORY_UPDATE_FOR_node_edition
Final Report Generation (after both feedbacks complete)
Call Type: INTERNAL_FINAL_REPORT_GENERATION_STEP
General Memory Update (after final report)
Call Type: INTERNAL_MEMORY_UPDATE_FOR_synthesizeGeneralMemory
3. Image Generation LLM Calls (Background, if enabled):
Image Prompt Generation (for each node needing image updates)
Call Type: image_prompt_generation
Note: Multiple calls possible per interaction
