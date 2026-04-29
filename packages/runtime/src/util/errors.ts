export type LamiErrorCode =
  | 'E_EXPR_PARSE'
  | 'E_EXPR_ASSIGN'
  | 'E_BINDING'
  | 'E_BIND_TARGET'
  | 'E_RESOURCE_MISSING'
  | 'E_REPEAT_PARSE'
  | 'E_HYDRATE_MISMATCH'
  | 'E_UNSAFE_TEMPLATE';

export type LamiWarningCode =
  | 'W_RESOURCE_MISSING'
  | 'W_HYDRATE_MISMATCH';

export class LamiError extends Error {
  constructor(
    public readonly code: LamiErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'LamiError';
  }
}

export class LamiWarning {
  readonly name = 'LamiWarning';

  constructor(
    public readonly code: LamiWarningCode,
    public readonly message: string,
    public readonly details?: unknown
  ) {}
}

export interface ErrorReporter {
  onError?: (error: LamiError) => void;
  onWarn?: (warning: LamiWarning) => void;
  dev?: boolean;
}

export function toLamiError(code: LamiErrorCode, error: unknown, details?: unknown): LamiError {
  if (error instanceof LamiError) {
    return details === undefined
      ? error
      : new LamiError(error.code, error.message, enrichDetails(error.details, details));
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LamiError(code, message, details);
}

export function reportError(reporter: ErrorReporter | undefined, code: LamiErrorCode, error: unknown, details?: unknown): void {
  const lamiError = toLamiError(code, error, details);
  reporter?.onError?.(lamiError);

  if (reporter?.dev || !reporter?.onError) {
    throw lamiError;
  }
}

export function reportWarning(
  reporter: ErrorReporter | undefined,
  code: LamiWarningCode,
  message: string,
  details?: unknown
): void {
  reporter?.onWarn?.(new LamiWarning(code, message, details));
}

function enrichDetails(existing: unknown, next: unknown): unknown {
  if (existing === undefined) return next;
  return {
    cause: existing,
    context: next
  };
}
