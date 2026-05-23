export function stripHttpScheme(value: string): string {
  if (value.startsWith("https://")) {
    return value.slice("https://".length);
  }
  if (value.startsWith("http://")) {
    return value.slice("http://".length);
  }

  return value;
}

export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }

  return value.slice(0, end);
}

export function replaceRunsWithHyphen(
  value: string,
  shouldReplace: (character: string) => boolean,
): string {
  const result: string[] = [];
  let replacing = false;
  for (const character of value) {
    if (shouldReplace(character)) {
      if (!replacing) {
        result.push("-");
      }
      replacing = true;
    } else {
      result.push(character);
      replacing = false;
    }
  }

  return result.join("");
}

export function trimHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") {
    start += 1;
  }
  while (end > start && value[end - 1] === "-") {
    end -= 1;
  }

  return value.slice(start, end);
}

export function asciiWordBreaks(value: string): string {
  const characters = [...value];
  const result: string[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const current = characters[index]!;
    const previous = characters[index - 1];
    const next = characters[index + 1];
    if (previous && shouldInsertAsciiWordBreak(previous, current, next)) {
      result.push("-");
    }
    result.push(current);
  }

  return result.join("");
}

function shouldInsertAsciiWordBreak(
  previous: string,
  current: string,
  next: string | undefined,
): boolean {
  if (isLowerAsciiLetterOrDigit(previous) && isUpperAsciiLetter(current)) {
    return true;
  }

  return Boolean(
    next &&
      isUpperAsciiLetter(previous) &&
      isUpperAsciiLetter(current) &&
      isLowerAsciiLetter(next),
  );
}

export function isLowerAsciiLetter(character: string): boolean {
  return character >= "a" && character <= "z";
}

export function isUpperAsciiLetter(character: string): boolean {
  return character >= "A" && character <= "Z";
}

export function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

export function isLowerAsciiLetterOrDigit(character: string): boolean {
  return isLowerAsciiLetter(character) || isAsciiDigit(character);
}

export function isAsciiLetterOrDigit(character: string): boolean {
  return isLowerAsciiLetter(character) ||
    isUpperAsciiLetter(character) ||
    isAsciiDigit(character);
}
