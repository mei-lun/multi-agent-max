import type {
  ModelProfile,
  ProviderProfile,
  ProviderProtocol
} from '../../../shared/mam/domain/execution-profile'

export type MamDesignModelRequestStage =
  | 'preparing_request'
  | 'waiting_response_headers'
  | 'reading_response_body'
  | 'complete'

export type MamDesignModelDiagnosticEvent = Readonly<{
  event: 'request_started' | 'response_headers' | 'request_completed' | 'request_failed'
  endpoint: string
  providerProtocol: ProviderProtocol
  providerProfileId: string
  providerProfileVersion: number
  modelProfileId: string
  modelProfileVersion: number
  remoteModelId: string
  formatMode: 'schema' | 'json'
  requestAttempt: number
  requestTimeoutMs: number
  stage: MamDesignModelRequestStage
  elapsedMs: number
  requestBodyBytes?: number
  status?: number
  contentType?: string
  contentLength?: number
  providerRequestId?: string
  responseBodyBytes?: number
  code?: string
}>

export type MamDesignModelDiagnosticReporter = (event: MamDesignModelDiagnosticEvent) => void

export class MamDesignModelDiagnostics {
  private readonly startedAt = Date.now()
  private currentStage: MamDesignModelRequestStage = 'preparing_request'
  private currentFormatMode: 'schema' | 'json' = 'schema'
  private currentRequestAttempt = 0
  private currentStatus: number | undefined
  private abortedStage: MamDesignModelRequestStage | undefined

  constructor(
    private readonly input: Readonly<{ model: ModelProfile; provider: ProviderProfile }>,
    private readonly endpoint: string,
    private readonly requestTimeoutMs: number,
    private readonly reporter?: MamDesignModelDiagnosticReporter
  ) {}

  requestStarted(mode: 'schema' | 'json', requestBody: string): void {
    this.currentFormatMode = mode
    this.currentRequestAttempt += 1
    this.currentStatus = undefined
    if (!this.abortedStage) this.currentStage = 'waiting_response_headers'
    this.report({
      event: 'request_started',
      requestBodyBytes: Buffer.byteLength(requestBody)
    })
  }

  responseHeaders(response: Response): void {
    if (this.abortedStage) return
    this.currentStatus = response.status
    this.currentStage = 'reading_response_body'
    this.report({
      event: 'response_headers',
      status: response.status,
      ...responseMetadata(response)
    })
  }

  requestCompleted(responseBody: string): void {
    if (this.abortedStage) return
    this.currentStage = 'complete'
    this.report({
      event: 'request_completed',
      ...(this.currentStatus !== undefined ? { status: this.currentStatus } : {}),
      responseBodyBytes: Buffer.byteLength(responseBody)
    })
  }

  requestAborted(): void {
    this.abortedStage ??= this.currentStage
  }

  requestFailed(code: string): void {
    this.report({
      event: 'request_failed',
      ...(this.currentStatus !== undefined ? { status: this.currentStatus } : {}),
      code
    })
  }

  private report(
    details: Pick<MamDesignModelDiagnosticEvent, 'event'> &
      Partial<
        Pick<
          MamDesignModelDiagnosticEvent,
          | 'requestBodyBytes'
          | 'status'
          | 'contentType'
          | 'contentLength'
          | 'providerRequestId'
          | 'responseBodyBytes'
          | 'code'
        >
      >
  ): void {
    try {
      this.reporter?.({
        ...details,
        endpoint: this.endpoint,
        providerProtocol: this.input.provider.protocol,
        providerProfileId: this.input.provider.id,
        providerProfileVersion: this.input.provider.version,
        modelProfileId: this.input.model.id,
        modelProfileVersion: this.input.model.version,
        remoteModelId: this.input.model.remoteModelId,
        formatMode: this.currentFormatMode,
        requestAttempt: Math.max(this.currentRequestAttempt, 1),
        requestTimeoutMs: this.requestTimeoutMs,
        stage: this.abortedStage ?? this.currentStage,
        elapsedMs: Date.now() - this.startedAt
      })
    } catch {
      // Diagnostics must never change the model request result.
    }
  }
}

function responseMetadata(response: Response): Partial<MamDesignModelDiagnosticEvent> {
  const contentType = response.headers.get('content-type') ?? undefined
  const length = response.headers.get('content-length')
  const contentLength = length === null ? undefined : Number(length)
  const providerRequestId =
    response.headers.get('x-request-id') ??
    response.headers.get('x-client-request-id') ??
    response.headers.get('request-id') ??
    undefined
  return {
    ...(contentType ? { contentType } : {}),
    ...(contentLength !== undefined && Number.isFinite(contentLength) ? { contentLength } : {}),
    ...(providerRequestId ? { providerRequestId } : {})
  }
}
