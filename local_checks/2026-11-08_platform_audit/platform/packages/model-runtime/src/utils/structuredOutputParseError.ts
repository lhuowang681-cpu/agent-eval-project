export class StructuredOutputParseError extends Error {
  readonly rawText?: string;

  constructor(message: string, rawText?: string) {
    super(message);
    this.name = 'StructuredOutputParseError';
    this.rawText = rawText;
  }
}
