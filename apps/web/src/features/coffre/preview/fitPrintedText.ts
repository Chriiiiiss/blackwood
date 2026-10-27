/** Fit the complete API-valid text on one face, preserving explicit line breaks. */
export function fitPrintedText(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  family: string,
  maximum: number,
) {
  for (let size = maximum; size >= 1; size--) {
    const font = `400 ${size}px ${family}`;
    context.font = font;
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (line && context.measureText(`${line} ${word}`).width > width) {
          lines.push(line);
          line = "";
        }
        for (const character of word) {
          if (line && context.measureText(line + character).width > width) {
            lines.push(line);
            line = "";
          }
          line += character;
        }
        line += " ";
      }
      lines.push(line.trimEnd());
    }
    const lineHeight = size * 1.3;
    if (lineHeight * lines.length <= height || size === 1)
      return { font, lines, lineHeight };
  }
  throw new Error("Cannot lay out the printed text.");
}
