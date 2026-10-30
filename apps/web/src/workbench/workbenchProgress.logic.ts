export const getWorkbenchProgressItems = (progress: string) =>
  progress.split("\n").flatMap((line, index) => {
    const match = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/u.exec(line);
    return match ? [{ line: index, text: match[2] ?? "", done: match[1] !== " " }] : [];
  });
