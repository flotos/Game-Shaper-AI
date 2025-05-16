import { TextDiffInstruction } from '../models/nodeOperations'; // Assuming TextDiffInstruction is in nodeOperations

/**
 * Applies a series of text diff instructions to a given string.
 * @param currentText The original string.
 * @param edits An array of TextDiffInstruction objects.
 * @returns The modified string.
 */
export function applyTextDiffInstructions(currentText: string, edits: TextDiffInstruction[]): string {
  let newText = currentText;
  if (!edits || edits.length === 0) {
    return newText;
  }

  for (const edit of edits) {
    let { prev_txt, next_txt, occ = 1 } = edit;
    next_txt = next_txt ?? ""; // Treat null/undefined newContent as deletion intent

    if (!prev_txt) {
      // If prev_txt is empty, this implies an append. 
      // More complex insertion (e.g., at a specific index or relative to an anchor without removal) 
      // would require a more detailed TextDiffInstruction structure.
      // For now, an empty prev_txt with a non-empty next_txt means append.
      if (next_txt) { // Only append if there's something to append
        newText += next_txt;
        console.log(`applyTextDiff: Appended content. New length: ${newText.length}`);
      }
      continue;
    }

    let startIndex = -1;
    let currentOccurrence = 0;
    let searchFromIndex = 0;
    while (currentOccurrence < occ && searchFromIndex < newText.length) {
      startIndex = newText.indexOf(prev_txt, searchFromIndex);
      if (startIndex === -1) break; 
      currentOccurrence++;
      if (currentOccurrence === occ) break; 
      searchFromIndex = startIndex + prev_txt.length; 
    }

    if (startIndex !== -1 && currentOccurrence === occ) {
      newText = 
        newText.substring(0, startIndex) + 
        next_txt + 
        newText.substring(startIndex + prev_txt.length);
      console.log(`applyTextDiff: Applied edit: replaced '${prev_txt.substring(0, 50)}...' with '${next_txt.substring(0,50)}...' (occurrence ${occ})`);
    } else {
      console.warn(`applyTextDiff: Could not find occurrence ${occ} of '${prev_txt.substring(0,50)}...'. Edit skipped:`, edit);
    }
  }
  return newText;
} 