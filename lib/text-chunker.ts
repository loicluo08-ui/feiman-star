export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 100;
export const MAX_EXTRACTED_CHARACTERS = 500_000;

function sliceLongText(text: string) {
  const chunks: string[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk) chunks.push(chunk);
    if (start + CHUNK_SIZE >= text.length) break;
  }
  return chunks;
}

export function chunkText(input: string) {
  const text = input.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!text) return [];
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new Error("EXTRACTED_TEXT_TOO_LARGE");
  }

  const paragraphs = text.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  function flushCurrent() {
    if (!current) return;
    chunks.push(current);
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_SIZE) {
      flushCurrent();
      chunks.push(...sliceLongText(paragraph));
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= CHUNK_SIZE) {
      current = candidate;
      continue;
    }

    const overlap = current.slice(-CHUNK_OVERLAP).trim();
    flushCurrent();
    const next = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    if (next.length <= CHUNK_SIZE) current = next;
    else chunks.push(...sliceLongText(paragraph));
  }

  flushCurrent();
  return chunks;
}
