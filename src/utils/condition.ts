export interface ConditionContext {
  readonly env: NodeJS.ProcessEnv;
}

type Primitive = string | number | boolean | null | undefined;
type ConditionValue = Primitive;

type ConditionEvaluator = (context: ConditionContext) => ConditionValue;

interface Token {
  readonly type:
    | "identifier"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "undefined"
    | "operator"
    | "paren";
  readonly value: string;
}

const whitespacePattern = /\s+/y;
const identifierPattern = /[A-Za-z_][A-Za-z0-9_.]*/y;
const numberPattern = /(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/y;
const operatorPattern = /&&|\|\||===|!==|==|!=|<=|>=|<|>|!/y;
const stringDelimiterPattern = /['"]/;

const evaluatorCache = new Map<string, ConditionEvaluator>();

const coerceForLooseEquality = (
  value: ConditionValue,
  other: ConditionValue,
): ConditionValue => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  if (normalized === "null") {
    return null;
  }
  if (normalized === "undefined") {
    return undefined;
  }

  const shouldParseNumber = typeof other === "number" || other === null;
  if (shouldParseNumber) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }

  return value;
};

const looseEquals = (left: ConditionValue, right: ConditionValue): boolean => {
  const leftCoerced = coerceForLooseEquality(left, right);
  const rightCoerced = coerceForLooseEquality(right, left);
  // biome-ignore lint/suspicious/noDoubleEquals: Intended loose equality
  return leftCoerced == rightCoerced;
};

class ConditionParseError extends Error {}

export const evaluateCondition = (
  expression: string,
  context: ConditionContext,
): boolean => {
  const cached = evaluatorCache.get(expression);
  const evaluator = cached ?? compileExpression(expression);
  if (!cached) {
    evaluatorCache.set(expression, evaluator);
  }
  const value = evaluator(context);
  return Boolean(value);
};

const compileExpression = (expression: string): ConditionEvaluator => {
  const tokens = tokenize(expression);
  let position = 0;

  const parseExpression = (): ConditionEvaluator => parseOr();

  const parseOr = (): ConditionEvaluator => {
    let left = parseAnd();
    while (matchToken("operator", "||")) {
      const right = parseAnd();
      const previousLeft = left;
      left = (ctx) => Boolean(previousLeft(ctx)) || Boolean(right(ctx));
    }
    return left;
  };

  const parseAnd = (): ConditionEvaluator => {
    let left = parseEquality();
    while (matchToken("operator", "&&")) {
      const right = parseEquality();
      const previousLeft = left;
      left = (ctx) => Boolean(previousLeft(ctx)) && Boolean(right(ctx));
    }
    return left;
  };

  const parseEquality = (): ConditionEvaluator => {
    let left = parseRelational();
    while (true) {
      if (matchToken("operator", "===")) {
        const right = parseRelational();
        const previousLeft = left;
        left = (ctx) => previousLeft(ctx) === right(ctx);
        continue;
      }
      if (matchToken("operator", "!==")) {
        const right = parseRelational();
        const previousLeft = left;
        left = (ctx) => previousLeft(ctx) !== right(ctx);
        continue;
      }
      if (matchToken("operator", "==")) {
        const right = parseRelational();
        const previousLeft = left;
        left = (ctx) => looseEquals(previousLeft(ctx), right(ctx));
        continue;
      }
      if (matchToken("operator", "!=")) {
        const right = parseRelational();
        const previousLeft = left;
        left = (ctx) => !looseEquals(previousLeft(ctx), right(ctx));
        continue;
      }
      break;
    }
    return left;
  };

  const parseRelational = (): ConditionEvaluator => {
    let left = parseUnary();
    while (true) {
      if (matchToken("operator", "<=")) {
        const right = parseUnary();
        const previousLeft = left;
        left = (ctx) => {
          const leftValue = previousLeft(ctx);
          const rightValue = right(ctx);
          return isComparable(leftValue) && isComparable(rightValue)
            ? leftValue <= rightValue
            : false;
        };
        continue;
      }
      if (matchToken("operator", ">=")) {
        const right = parseUnary();
        const previousLeft = left;
        left = (ctx) => {
          const leftValue = previousLeft(ctx);
          const rightValue = right(ctx);
          return isComparable(leftValue) && isComparable(rightValue)
            ? leftValue >= rightValue
            : false;
        };
        continue;
      }
      if (matchToken("operator", "<")) {
        const right = parseUnary();
        const previousLeft = left;
        left = (ctx) => {
          const leftValue = previousLeft(ctx);
          const rightValue = right(ctx);
          return isComparable(leftValue) && isComparable(rightValue)
            ? leftValue < rightValue
            : false;
        };
        continue;
      }
      if (matchToken("operator", ">")) {
        const right = parseUnary();
        const previousLeft = left;
        left = (ctx) => {
          const leftValue = previousLeft(ctx);
          const rightValue = right(ctx);
          return isComparable(leftValue) && isComparable(rightValue)
            ? leftValue > rightValue
            : false;
        };
        continue;
      }
      break;
    }
    return left;
  };

  const parseUnary = (): ConditionEvaluator => {
    if (matchToken("operator", "!")) {
      const operand = parseUnary();
      return (ctx) => !operand(ctx);
    }
    return parsePrimary();
  };

  const parsePrimary = (): ConditionEvaluator => {
    const token = peek();
    if (!token) {
      throw new ConditionParseError("Unexpected end of expression");
    }

    if (consume("paren", "(")) {
      const inner = parseExpression();
      if (!consume("paren", ")")) {
        throw new ConditionParseError("Unbalanced parentheses");
      }
      return inner;
    }

    if (consume("boolean")) {
      const value = token.value === "true";
      return () => value;
    }
    if (consume("null")) {
      return () => null;
    }
    if (consume("undefined")) {
      return () => undefined;
    }
    if (consume("number")) {
      const numeric = Number.parseFloat(token.value);
      return () => numeric;
    }
    if (consume("string")) {
      const stringValue = parseStringLiteral(token.value);
      return () => stringValue;
    }
    if (consume("identifier")) {
      const path = token.value;
      return (ctx) => resolveIdentifier(path, ctx);
    }

    throw new ConditionParseError(`Unexpected token '${token.value}'`);
  };

  const matchToken = (type: Token["type"], value?: string): boolean => {
    const token = tokens[position];
    if (!token || token.type !== type) {
      return false;
    }
    if (value !== undefined && token.value !== value) {
      return false;
    }
    position += 1;
    return true;
  };

  const consume = (type: Token["type"], value?: string): boolean => {
    const token = tokens[position];
    if (!token || token.type !== type) {
      return false;
    }
    if (value !== undefined && token.value !== value) {
      return false;
    }
    position += 1;
    return true;
  };

  const peek = (): Token | undefined => tokens[position];

  const evaluator = parseExpression();
  if (position < tokens.length) {
    throw new ConditionParseError(
      `Unexpected token '${tokens[position]?.value}'`,
    );
  }
  return evaluator;
};

const tokenize = (expression: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  const source = expression.trim();
  while (index < source.length) {
    whitespacePattern.lastIndex = index;
    const whitespaceMatch = whitespacePattern.exec(source);
    if (whitespaceMatch) {
      index += whitespaceMatch[0].length;
    }

    if (index >= source.length) {
      break;
    }

    operatorPattern.lastIndex = index;
    const operatorMatch = operatorPattern.exec(source);
    if (operatorMatch) {
      tokens.push({ type: "operator", value: operatorMatch[0] });
      index += operatorMatch[0].length;
      continue;
    }

    const currentChar = source[index];
    if (stringDelimiterPattern.test(currentChar)) {
      const stringToken = readStringToken(source, index);
      tokens.push({ type: "string", value: stringToken.value });
      index = stringToken.nextIndex;
      continue;
    }

    identifierPattern.lastIndex = index;
    const identifierMatch = identifierPattern.exec(source);
    if (identifierMatch) {
      const identifier = identifierMatch[0];
      if (identifier === "true" || identifier === "false") {
        tokens.push({ type: "boolean", value: identifier });
      } else if (identifier === "null") {
        tokens.push({ type: "null", value: identifier });
      } else if (identifier === "undefined") {
        tokens.push({ type: "undefined", value: identifier });
      } else {
        tokens.push({ type: "identifier", value: identifier });
      }
      index += identifier.length;
      continue;
    }

    numberPattern.lastIndex = index;
    const numberMatch = numberPattern.exec(source);
    if (numberMatch) {
      tokens.push({ type: "number", value: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }

    if (currentChar === "(" || currentChar === ")") {
      tokens.push({ type: "paren", value: currentChar });
      index += 1;
      continue;
    }

    throw new ConditionParseError(`Unexpected character '${currentChar}'`);
  }

  return tokens;
};

const parseStringLiteral = (raw: string): string => {
  const quote = raw[0];
  const content = raw.slice(1, -1);
  const unescaped = content.replace(/\\(.)/g, (_match, captured: string) => {
    switch (captured) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "\\":
        return "\\";
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return captured;
    }
  });
  return quote === "'" ? unescaped.replace(/"/g, '"') : unescaped;
};

const readStringToken = (
  source: string,
  startIndex: number,
): { value: string; nextIndex: number } => {
  const delimiter = source[startIndex];
  let index = startIndex + 1;
  while (index < source.length) {
    const current = source[index];
    if (current === "\\") {
      index += 2;
      continue;
    }
    if (current === delimiter) {
      const token = source.slice(startIndex, index + 1);
      return { value: token, nextIndex: index + 1 };
    }
    index += 1;
  }
  throw new ConditionParseError("Unterminated string literal");
};

const resolveIdentifier = (
  path: string,
  context: ConditionContext,
): ConditionValue => {
  const segments = path.split(".");
  if (segments[0] !== "env") {
    return undefined;
  }
  let current: unknown = context.env;
  for (let index = 1; index < segments.length; index += 1) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, string | undefined>)[segments[index]];
  }
  return current as ConditionValue;
};

const isComparable = (value: ConditionValue): value is string | number => {
  return typeof value === "string" || typeof value === "number";
};
